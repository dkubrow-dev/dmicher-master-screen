import { getRuntimes } from "./store.js";
import { resolveObjectShop, resolveObjectDialogue, getObjectBindings } from "./scene-objects.js";
import { sceneDistance, tokenCenter } from "./effects.js";
import { getTriggerGate, getTriggerKey } from "./triggers.js";
import { isExecutionHalted } from "./execution.js";

export const objectDescriptor = (value) => typeof value === "string" ? { type: "Token", id: value } : value;
export const objectKey = (value) => { const target = objectDescriptor(value); return target ? `${target.type}:${target.id}` : ""; };
export const sceneObject = (scene, value) => {
  const target = objectDescriptor(value);
  return target?.type === "Token" ? scene?.tokens?.get(target.id) : target?.type === "Tile" ? scene?.tiles?.get(target.id) : null;
};
export const interactionTriggerId = (config) => config?.triggerId ?? (config?.shopId || config?.dialogueId ? objectKey(config.target) : config?.id);

/** All callers, including GM previews of player actions, obey the same physical access rules. */
export function validateObjectAccess({ scene, runtime, descriptor, target, triggerType }, actorTokenId, user, runId, { ignoreQuota = true } = {}) {
  const fail = (text) => { throw new Error(text); };
  if (!scene || globalThis.canvas?.scene?.id !== scene.id || !runtime?.runId || runtime.runId !== runId) fail("Сцена или эпизод изменились. Откройте взаимодействие заново.");
  if (isExecutionHalted(scene, runtime) || runtime.episode?.stop || !descriptor?.enabled || !target || target.hidden
    || getObjectBindings(scene).bindings[objectKey(descriptor?.target)]?.playerCharacter
    || (descriptor.target.type === "Token" && (runtime.disabledTokens?.includes(target.id) || runtime.episode?.tokens?.[target.id]?.enabled === false))) fail("Взаимодействие сейчас недоступно.");
  const actorToken = scene.tokens?.get(actorTokenId);
  if (!user || !actorToken?.actor || actorToken.hidden || (descriptor.target.type === "Token" && actorToken.id === target.id)
    || (!user.isGM && !actorToken.actor.testUserPermission?.(user, "OWNER"))) fail("Нужен принадлежащий вам персонаж на карте.");
  const origin = tokenCenter(actorToken, scene), destination = descriptor.target.type === "Token" ? tokenCenter(target, scene)
    : { x: Number(target.x) + Number(target.width) / 2, y: Number(target.y) + Number(target.height) / 2 };
  if (actorToken.level != null && target.level != null && actorToken.level !== target.level) fail("Объект находится на другом уровне сцены.");
  if (sceneDistance(scene, origin, destination) > Number(descriptor.range ?? 5)) fail("Персонаж слишком далеко от объекта.");
  if (!actorToken.object?.checkCollision || actorToken.object.checkCollision(destination, { origin, type: "sight", mode: "any" })) fail("Объект должен находиться в прямой видимости персонажа.");
  const gate = getTriggerGate(scene, runtime, descriptor.trigger, actorToken,
    { triggerKey: getTriggerKey(runtime, triggerType, interactionTriggerId(descriptor)), ignoreQuota });
  if (!gate.allowed) fail(gate.reason);
  return actorToken;
}

/** Read-only menu discovery. Admission is checked again by each authenticated command. */
export function listAvailableInteractions(scene, rawTarget, actorToken, user = game.user) {
  const target = objectDescriptor(rawTarget), document = sceneObject(scene, target), result = [];
  for (const runtime of getRuntimes(scene)) {
    if (!runtime.runId) continue;
    for (const [kind, resolve] of [["shop", resolveObjectShop], ["dialogue", resolveObjectDialogue]]) {
      const resolved = resolve(scene, target, { schemeId: runtime.schemeId, episodeId: runtime.episodeId });
      if (!resolved) continue;
      const config = resolved.config;
      const sessions = kind === "shop" ? Object.values(runtime.shopSessions ?? {}) : Object.values(runtime.dialogueSessions ?? {});
      const resuming = sessions.some((session) => session && session.userId === user?.id && session.actorTokenId === (actorToken?.document?.id ?? actorToken?.id)
        && session.runId === runtime.runId && objectKey(session.target) === objectKey(target)
        && (kind === "shop" ? session.status === "pending" || session.expiresAt > Date.now() : ["active", "finished"].includes(session.status)));
      try { validateObjectAccess({ scene, runtime, descriptor: config, target: document, triggerType: kind }, actorToken?.document?.id ?? actorToken?.id, user, runtime.runId, { ignoreQuota: resuming }); }
      catch { continue; }
      result.push({ kind, id: resolved.asset.id, name: resolved.asset.name, target: { ...target }, schemeId: runtime.schemeId, runId: runtime.runId });
    }
    for (const config of runtime.episode?.interactions ?? []) {
      if (objectKey(config.target) !== objectKey(target)) continue;
      try { validateObjectAccess({ scene, runtime, descriptor: config, target: document, triggerType: "interaction" }, actorToken?.document?.id ?? actorToken?.id, user, runtime.runId, { ignoreQuota: false }); }
      catch { continue; }
      result.push({ kind: "interaction", id: config.id, name: config.name, target: { ...target }, schemeId: runtime.schemeId, runId: runtime.runId });
    }
  }
  return result;
}

/** Preparation-only simulation: no game documents, current runs, messages or events. */
export function evaluateInteractionPreview({ config, kind, schemeId, episodeId, tags = [], distance = 0, visible = true,
  enabled = true, used = 0, halted = false } = {}) {
  const deny = (reason) => ({ allowed: false, reason });
  if (!config || !enabled || config.enabled === false) return deny("Взаимодействие выключено.");
  if (!Number.isFinite(distance) || distance < 0 || distance > Number(config.range ?? 5)) return deny("Персонаж слишком далеко от объекта.");
  if (!visible) return deny("Объект должен находиться в прямой видимости персонажа.");
  const actor = { id: "preview-character" };
  const scene = { id: "preview-scene", tokens: new Map([[actor.id, actor]]),
    getFlag: (_module, name) => name === "objectBindings" ? { bindings: { [`Token:${actor.id}`]: { type: "Token", id: actor.id, tags } } } : undefined };
  const state = { runId: "preview", schemeId, episodeId, episode: { stop: false }, halted, triggerCounts: {} };
  const triggerKey = getTriggerKey(state, kind, interactionTriggerId(config));
  state.triggerCounts[triggerKey] = used;
  return getTriggerGate(scene, state, config.trigger, actor, { triggerKey });
}
