import { getRuntimes } from "./store.js";
import { resolveObjectTools, getObjectBindings, getSceneObject } from "./scene-objects.js";
import { sceneDistance, tokenCenter } from "./effects.js";
import { getConditionGate, getConditionKey } from "./interaction-conditions.js";
import { isExecutionHalted } from "./execution.js";

export const objectDescriptor = (value) => typeof value === "string" ? { type: "Token", id: value } : value;
export const objectKey = (value) => { const target = objectDescriptor(value); return target ? `${target.type}:${target.id}` : ""; };
export const sceneObject = (scene, value) => {
  const target = objectDescriptor(value);
  return getSceneObject(scene, target);
};
export const interactionConditionId = (config) => config?.shopId || config?.dialogueId ? `${objectKey(config.target)}:${config.shopId ?? config.dialogueId}` : config?.id;

/** All callers, including GM previews of player actions, obey the same physical access rules. */
export function validateObjectAccess({ scene, runtime, descriptor, target, conditionType }, actorTokenId, user, runId, { ignoreQuota = true } = {}) {
  const fail = (text) => { throw new Error(text); };
  if (!scene || globalThis.canvas?.scene?.id !== scene.id || !runtime?.runId || runtime.runId !== runId) fail("Сцена или состояние изменились. Откройте взаимодействие заново.");
  if (isExecutionHalted(scene, runtime) || !descriptor?.enabled || !target || target.hidden
    || getObjectBindings(scene).bindings[objectKey(descriptor?.target)]?.playerCharacter
    || runtime.disabledObjects?.includes(objectKey(descriptor.target))) fail("Взаимодействие сейчас недоступно.");
  const actorToken = scene.tokens?.get(actorTokenId);
  if (!user || !actorToken?.actor || actorToken.hidden || (descriptor.target.type === "Token" && actorToken.id === target.id)
    || (!user.isGM && !actorToken.actor.testUserPermission?.(user, "OWNER"))) fail("Нужен принадлежащий вам персонаж на карте.");
  const origin = tokenCenter(actorToken, scene), destination = tokenCenter(target, scene);
  if (![origin.x, origin.y, destination.x, destination.y].every(Number.isFinite)) fail("Не удалось определить положение объекта на сцене.");
  if (actorToken.level != null && target.level != null && actorToken.level !== target.level) fail("Объект находится на другом уровне сцены.");
  if (sceneDistance(scene, origin, destination) > Number(descriptor.range ?? 5)) fail("Персонаж слишком далеко от объекта.");
  if (!actorToken.object?.checkCollision || actorToken.object.checkCollision(destination, { origin, type: "sight", mode: "any" })) fail("Объект должен находиться в прямой видимости персонажа.");
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
        && (kind === "shop" ? session.status === "pending" || session.expiresAt > Date.now() : ["active", "processing", "interrupted"].includes(session.status)));
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
  if (!config || !enabled || config.enabled === false) return deny("Взаимодействие выключено.");
  if (!Number.isFinite(distance) || distance < 0 || distance > Number(config.range ?? 5)) return deny("Персонаж слишком далеко от объекта.");
  if (!visible) return deny("Объект должен находиться в прямой видимости персонажа.");
  const actor = { id: "preview-character" };
  const scene = { id: "preview-scene", tokens: new Map([[actor.id, actor]]),
    getFlag: (_module, name) => name === "objectBindings" ? { bindings: { [`Token:${actor.id}`]: { type: "Token", id: actor.id, tags } } } : undefined };
  const state = { runId: "preview", groupId, stateId, state: { stop: false }, halted, conditionCounts: {} };
  const conditionKey = getConditionKey(state, kind, interactionConditionId(config));
  state.conditionCounts[conditionKey] = used;
  return getConditionGate(scene, state, config.conditions, actor, { conditionKey });
}
