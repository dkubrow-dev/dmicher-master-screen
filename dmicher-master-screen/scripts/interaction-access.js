import { message as localizedMessage } from "./localization.js";
import { getRuntimes } from "./store.js";
import { resolveObjectTools, getObjectBindings, getSceneObject } from "./scene-objects.js";
import { sceneDistance, objectCenter } from "./scene-object-geometry.js";
import { objectReference, objectReferenceKey as objectKey } from "./object-reference.js";
import { shopSessionIsLive } from "./interaction-session-model.js";
import { getConditionGate, getConditionKey, evaluateConditionPolicy } from "./interaction-conditions.js";
import { isExecutionHalted } from "./execution.js";

export const objectDescriptor = objectReference;
export { objectKey };
export const sceneObject = (scene, value) => {
  const target = objectDescriptor(value);
  return getSceneObject(scene, target);
};
export const interactionConditionId = (config) => config?.shopId || config?.dialogueId ? `${objectKey(config.target)}:${config.shopId ?? config.dialogueId}` : config?.id;

/** All callers, including GM previews of player actions, obey the same physical access rules. */
export function validateObjectAccess({ scene, runtime, descriptor, target, conditionType }, actorTokenId, user, runId, { ignoreQuota = true } = {}) {
  const fail = (text) => { throw new Error(text); };
  if (!scene || globalThis.canvas?.scene?.id !== scene.id || !runtime?.runId || runtime.runId !== runId) fail(localizedMessage("Сцена или состояние изменились. Откройте взаимодействие заново."));
  if (isExecutionHalted(scene, runtime) || !descriptor?.enabled || !target || target.hidden
    || getObjectBindings(scene).bindings[objectKey(descriptor?.target)]?.playerCharacter
    || runtime.disabledObjects?.includes(objectKey(descriptor.target))) fail(localizedMessage("Взаимодействие сейчас недоступно."));
  const actorToken = scene.tokens?.get(actorTokenId);
  if (!user || !actorToken?.actor || actorToken.hidden || (descriptor.target.type === "Token" && actorToken.id === target.id)
    || (!user.isGM && !actorToken.actor.testUserPermission?.(user, "OWNER"))) fail(localizedMessage("Нужен принадлежащий вам персонаж на карте."));
  const origin = objectCenter(actorToken, scene), destination = objectCenter(target, scene);
  if (![origin.x, origin.y, destination.x, destination.y].every(Number.isFinite)) fail(localizedMessage("Не удалось определить положение объекта на сцене."));
  if (actorToken.level != null && target.level != null && actorToken.level !== target.level) fail(localizedMessage("Объект находится на другом уровне сцены."));
  if (sceneDistance(scene, origin, destination) > Number(descriptor.range ?? 5)) fail(localizedMessage("Персонаж слишком далеко от объекта."));
  if (!actorToken.object?.checkCollision || actorToken.object.checkCollision(destination, { origin, type: "sight", mode: "any" })) fail(localizedMessage("Объект должен находиться в прямой видимости персонажа."));
  const gate = getConditionGate(scene, runtime, descriptor.conditions, actorToken,
    { conditionKey: getConditionKey(runtime, conditionType, interactionConditionId(descriptor)), ignoreQuota });
  if (!gate.allowed) fail(gate.reason);
  return actorToken;
}

/** Read-only menu discovery. Admission is checked again by each authenticated command. */
export function listAvailableInteractions(scene, rawTarget, actorToken, user = game.user) {
  const target = objectDescriptor(rawTarget), document = sceneObject(scene, target), result = [];
  for (const runtime of getRuntimes(scene)) {
    if (!runtime.runId) continue;
    for (const kind of ["shop", "dialogue"]) for (const resolved of resolveObjectTools(scene, target, { groupId: runtime.groupId, stateId: runtime.stateId }, kind)) {
      const config = resolved.config;
      const sessions = kind === "shop" ? Object.values(runtime.shopSessions ?? {}) : Object.values(runtime.dialogueSessions ?? {});
      const resuming = sessions.some((session) => session && session.userId === user?.id && session.actorTokenId === (actorToken?.document?.id ?? actorToken?.id)
        && session.runId === runtime.runId && (session.shopId ?? session.dialogueId) === resolved.asset.id && objectKey(session.target) === objectKey(target)
        && (kind === "shop" ? shopSessionIsLive(session) : ["active", "processing", "interrupted"].includes(session.status)));
      try { validateObjectAccess({ scene, runtime, descriptor: config, target: document, conditionType: kind }, actorToken?.document?.id ?? actorToken?.id, user, runtime.runId, { ignoreQuota: resuming }); }
      catch { continue; }
      const paused = kind === "dialogue" && sessions.some((session) => session?.dialogueId === resolved.asset.id && session.userId === user?.id && session.actorTokenId === (actorToken?.document?.id ?? actorToken?.id)
        && session.runId === runtime.runId && objectKey(session.target) === objectKey(target) && session.status === "interrupted");
      result.push({ kind, id: resolved.asset.id, name: resolved.asset.name, target: { ...target }, groupId: runtime.groupId, runId: runtime.runId, paused });
    }
    for (const config of runtime.state?.interactions ?? []) {
      if (objectKey(config.target) !== objectKey(target)) continue;
      try { validateObjectAccess({ scene, runtime, descriptor: config, target: document, conditionType: "interaction" }, actorToken?.document?.id ?? actorToken?.id, user, runtime.runId, { ignoreQuota: false }); }
      catch { continue; }
      result.push({ kind: "interaction", id: config.id, name: config.name, target: { ...target }, groupId: runtime.groupId, runId: runtime.runId });
    }
  }
  return result;
}

/** Preparation-only simulation: no game documents, current runs, messages or events. */
export function evaluateInteractionPreview({ config, kind, groupId, stateId, tags = [], distance = 0, visible = true,
  enabled = true, used = 0, halted = false } = {}) {
  const deny = (reason) => ({ allowed: false, reason });
  if (!config || !enabled || config.enabled === false) return deny(localizedMessage("Взаимодействие выключено."));
  if (!Number.isFinite(distance) || distance < 0 || distance > Number(config.range ?? 5)) return deny(localizedMessage("Персонаж слишком далеко от объекта."));
  if (!visible) return deny(localizedMessage("Объект должен находиться в прямой видимости персонажа."));
  const conditionKey = getConditionKey({ groupId, stateId }, kind, interactionConditionId(config));
  return evaluateConditionPolicy({ active: Boolean(stateId), groupId, stateId, conditionKey, halted,
    count: Math.max(0, Number(used) || 0) }, config.conditions, tags);
}
