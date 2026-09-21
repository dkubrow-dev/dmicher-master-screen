import { message as localizedMessage } from "./localization.js";
import { getRuntimes } from "./store.js";
import { MODULE_ID } from "./model.js";
import { resolveObjectTools, getObjectBindings, getSceneObject } from "./scene-objects.js";
import { sceneDistance, objectCenter, isSceneObjectHidden } from "./scene-object-geometry.js";
import { objectReference, objectReferenceKey as objectKey } from "./object-reference.js";
import { shopSessionIsLive } from "./interaction-session-model.js";
import { getConditionGate, getConditionKey, evaluateConditionPolicy } from "./interaction-conditions.js";
import { isExecutionHalted } from "./execution.js";
import { isStateEntryPreparing } from "./state-entry-preparation.js";
import { collectionEntryAllowed, getCollectionLimitIssue } from "./automation-limits.js";

export const objectDescriptor = objectReference;
export { objectKey };
export const sceneObject = (scene, value) => {
  const target = objectDescriptor(value);
  return getSceneObject(scene, target);
};
export const interactionConditionId = (config) => config?.shopId || config?.dialogueId || config?.actionId ? `${objectKey(config.target)}:${config.shopId ?? config.dialogueId ?? config.actionId}` : config?.id;

/** Shared identity and execution checks. A GM-authored script does not use the
 * player's physical admission rules, but never gains another character or run. */
export function validateInteractionIdentity({ scene, runtime, descriptor, target }, actorTokenId, user, runId) {
  const fail = (text) => { throw new Error(text); };
  const binding = descriptor?.target && getObjectBindings(scene).bindings[objectKey(descriptor.target)];
  if (!scene || globalThis.canvas?.scene?.id !== scene.id || !runtime?.runId || runtime.runId !== runId) fail(localizedMessage("Сцена или состояние изменились. Откройте взаимодействие заново."));
  if (isExecutionHalted(scene, runtime) || isStateEntryPreparing(scene,runtime) || !descriptor || !target
    || binding && binding.groupId !== runtime.groupId
    || scene.getFlag(MODULE_ID,"objectBehaviorState")?.[objectKey(descriptor?.target)] === false
    || runtime.disabledObjects?.includes(objectKey(descriptor.target))) fail(localizedMessage("Взаимодействие сейчас недоступно."));
  const actorToken = scene.tokens?.get(actorTokenId);
  if (!user || !actorToken?.actor || (descriptor.target.type === "Token" && actorToken.id === target.id)
    || (!user.isGM && !actorToken.actor.testUserPermission?.(user, "OWNER"))) fail(localizedMessage("Нужен принадлежащий вам персонаж на карте."));
  return actorToken;
}

/** Player-initiated actions, including GM previews, obey the same physical rules. */
export function validateObjectAccess({ scene, runtime, descriptor, target, conditionType }, actorTokenId, user, runId, { ignoreQuota = true } = {}) {
  const actorToken = validateInteractionIdentity({ scene, runtime, descriptor, target }, actorTokenId, user, runId);
  const fail = (text) => { throw new Error(text); };
  if (!descriptor.enabled || isSceneObjectHidden(target)) fail(localizedMessage("Взаимодействие сейчас недоступно."));
  if (actorToken.hidden) fail(localizedMessage("Нужен принадлежащий вам персонаж на карте."));
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

/** Direct GM actions do not need an impersonated player character. */
export function validateObjectActionAccess(context,actorTokenId,user,runId) {
  const {scene,runtime,descriptor,target}=context;
  const binding=getObjectBindings(scene).bindings[objectKey(descriptor.target)];
  if(!collectionEntryAllowed("actions",binding?.actions ?? [],descriptor)) throw new Error(
    getCollectionLimitIssue("actions",binding?.actions.length ?? 0) ?? localizedMessage("Взаимодействие сейчас недоступно."));
  if(descriptor.audience === "gm" && !user?.isGM) throw new Error(localizedMessage("Взаимодействие сейчас недоступно."));
  if(!user?.isGM || actorTokenId) return validateObjectAccess(context,actorTokenId,user,runId,{ignoreQuota:false});
  if(!scene || canvas.scene?.id !== scene.id || !target || !binding || !descriptor.enabled
    || scene.getFlag(MODULE_ID,"objectBehaviorState")?.[objectKey(descriptor.target)] === false
    || !runtime?.runId || isStateEntryPreparing(scene,runtime) || runtime.runId !== runId || runtime.disabledObjects.includes(objectKey(descriptor.target))) throw new Error(localizedMessage("Взаимодействие сейчас недоступно."));
  const gate=getConditionGate(scene,runtime,descriptor.conditions,null,{conditionKey:getConditionKey(runtime,"action",interactionConditionId(descriptor))});
  if(!gate.allowed) throw new Error(gate.reason);
  return null;
}

/** Read-only menu discovery. Admission is checked again by each authenticated command. */
export function listAvailableInteractions(scene, rawTarget, actorToken, user = game.user) {
  const target = objectDescriptor(rawTarget), document = sceneObject(scene, target), result = [];
  if (!document || !user || !user.isGM && (isSceneObjectHidden(document) || !actorToken?.actor || actorToken.hidden
    || !actorToken.actor.testUserPermission?.(user,"OWNER"))) return result;
  for (const runtime of getRuntimes(scene)) {
    if (!runtime.runId) continue;
    for (const kind of ["shop", "dialogue"]) for (const resolved of resolveObjectTools(scene, target, { groupId: runtime.groupId, stateId: runtime.stateId }, kind)) {
      const config = resolved.config;
      const sessions = kind === "shop" ? Object.values(runtime.shopSessions ?? {}) : Object.values(runtime.dialogueSessions ?? {});
      const resuming = sessions.some((session) => session && session.userId === user?.id && session.actorTokenId === (actorToken?.document?.id ?? actorToken?.id)
        && session.runId === runtime.runId && (session.shopId ?? session.dialogueId) === resolved.asset.id && objectKey(session.target) === objectKey(target)
        && (kind === "shop" ? shopSessionIsLive(session) : ["active", "processing", "interrupted"].includes(session.status)));
      let disabled=false,reason="";
      try { validateObjectAccess({ scene, runtime, descriptor: config, target: document, conditionType: kind }, actorToken?.document?.id ?? actorToken?.id, user, runtime.runId, { ignoreQuota: resuming }); }
      catch(error) { if(!config.showWhenUnavailable || isSceneObjectHidden(document) || !actorToken?.actor || !user?.isGM && !actorToken.actor.testUserPermission?.(user,"OWNER")) continue; disabled=true; reason=error.message; }
      const paused = kind === "dialogue" && sessions.some((session) => session?.dialogueId === resolved.asset.id && session.userId === user?.id && session.actorTokenId === (actorToken?.document?.id ?? actorToken?.id)
        && session.runId === runtime.runId && objectKey(session.target) === objectKey(target) && session.status === "interrupted");
      result.push({ kind, id: resolved.asset.id, name: config.displayName || resolved.asset.name, order:config.order ?? 0, disabled, reason,
        conditionMacro:resuming ? "" : config.conditionMacro,showWhenUnavailable:config.showWhenUnavailable,target: { ...target }, groupId: runtime.groupId, runId: runtime.runId, paused });
    }
    for (const config of runtime.state?.interactions ?? []) {
      if (objectKey(config.target) !== objectKey(target)) continue;
      try { validateObjectAccess({ scene, runtime, descriptor: config, target: document, conditionType: "interaction" }, actorToken?.document?.id ?? actorToken?.id, user, runtime.runId, { ignoreQuota: false }); }
      catch { continue; }
      result.push({ kind: "interaction", id: config.id, name: config.name, target: { ...target }, groupId: runtime.groupId, runId: runtime.runId });
    }
  }
  const binding=getObjectBindings(scene).bindings[objectKey(target)];
  const runtime=getRuntimes(scene).find(run=>run.groupId===binding?.groupId);
  if(runtime?.runId) for(const action of binding?.actions ?? []) {
    if(action.audience === "gm" && !user?.isGM) continue;
    let disabled=false,reason="";
    try { validateObjectActionAccess({scene,runtime,descriptor:{...action,actionId:action.id,target},target:document,conditionType:"action"},actorToken?.id,user,runtime.runId); }
    catch(error) { if(!action.showWhenUnavailable || isSceneObjectHidden(document)) continue; disabled=true;reason=error.message; }
    result.push({kind:"action",id:action.id,name:action.name,order:action.order,gmOnly:action.audience === "gm",disabled,reason,conditionMacro:action.conditionMacro,showWhenUnavailable:action.showWhenUnavailable,target:{...target},groupId:runtime.groupId,runId:runtime.runId});
  }
  return result.sort((a,b)=>(a.order ?? 0)-(b.order ?? 0) || a.name.localeCompare(b.name));
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
