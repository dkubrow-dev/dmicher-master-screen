import { getRuntime } from "./store.js";
import { MODULE_ID } from "./model.js";
import { debugError } from "./debug.js";
import { objectReferenceKey } from "./object-reference.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";

// One local cancellation barrier shared by scene effects, triggers and event subscriptions.
// The persisted halted state remains authoritative after reconnect; the barrier closes
// the interval while an already-started document operation releases the Scene lock.
const requests = new WeakMap();
const sceneRequests = new WeakMap();
const listeners = new WeakMap();
export function onExecutionChange(scene, listener) {
  let entries = listeners.get(scene);
  if (!entries) listeners.set(scene, entries = new Set());
  entries.add(listener);
  return () => { entries.delete(listener); if (!entries.size) listeners.delete(scene); };
}
export function notifyExecutionChange(scene, reason = "change") {
  if (!scene) return;
  for (const listener of [...(listeners.get(scene) ?? [])]) {
    try { listener(reason); }
    catch (error) { debugError("runtime", "cancellation.listener.failed", error, { sceneId: scene.id, reason }); }
  }
}

/** A local execution lease, never a document transaction. Cancellation releases
 * the caller immediately; a late external result cannot revive this lease.
 * Already submitted Foundry writes still settle in their own storage queue. */
export function createExecutionScope(scene, { isCurrent } = {}) {
  const controller = new AbortController();
  let resolveCancelled;
  const cancelled = new Promise(resolve => { resolveCancelled = resolve; });
  const cancel = () => {
    if (controller.signal.aborted) return;
    controller.abort(); resolveCancelled({ stale: true });
  };
  const current = () => {
    if (!controller.signal.aborted && isCurrent && !isCurrent()) cancel();
    return !controller.signal.aborted;
  };
  const dispose = onExecutionChange(scene, reason => {
    if (["canvas-teardown", "runtime-disposed"].includes(reason)) cancel(); else current();
  });
  return {
    signal: controller.signal, current, cancel, dispose,
    async run(operation) {
      if (!current()) return { stale: true };
      const task = Promise.resolve().then(async () => {
        if (!current()) return { stale: true };
        const value = await operation();
        return current() ? { value } : { stale: true };
      });
      return Promise.race([cancelled, task]);
    }
  };
}
export const executionGeneration = (scene, groupId = "main") => requests.get(scene)?.get(groupId)?.generation ?? 0;
export function requestHalt(scene, groupId = "main") {
  const generation = executionGeneration(scene, groupId) + 1;
  if (!requests.has(scene)) requests.set(scene, new Map());
  requests.get(scene).set(groupId, { generation, pending: true });
  notifyExecutionChange(scene, "halt");
  return generation;
}
export function finishHalt(scene, generation, groupId = "main") {
  const request = requests.get(scene)?.get(groupId);
  if (request?.generation === generation) request.pending = false;
}
export const sceneExecutionGeneration = (scene) => sceneRequests.get(scene)?.generation ?? 0;
export const isSceneAutomationHalted = (scene) => Boolean(sceneRequests.get(scene)?.pending || scene?.getFlag?.(MODULE_ID, "automationHalted"));
export function requestSceneHalt(scene) {
  const generation = sceneExecutionGeneration(scene) + 1;
  sceneRequests.set(scene, { generation, pending: true }); notifyExecutionChange(scene, "halt-all"); return generation;
}
export function finishSceneHalt(scene, generation) {
  const request = sceneRequests.get(scene); if (request?.generation === generation) request.pending = false;
}
export const isExecutionHalted = (scene, state = getRuntime(scene)) => Boolean(isSceneAutomationHalted(scene) || requests.get(scene)?.get(state?.groupId ?? "main")?.pending || state?.halted);

const haltId = scene => scene?.getFlag?.(MODULE_ID, "automationHaltId") ?? null;
const validGroupId = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const record = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validPresentationRun = (run, groupId) => record(run) && run.schemaVersion === 1 && run.groupId === groupId
  && typeof run.runId === "string" && (run.stateId === null || typeof run.stateId === "string")
  && typeof run.halted === "boolean" && Number.isFinite(run.haltedAt)
  && Array.isArray(run.disabledObjects) && record(run.scriptStates);

/** Admission reads only saved lease fields. Normalizing a runtime here would
 * clone every transcript/stock snapshot on each Scene update for every sound.
 * Preparation bodies and unrelated groups are not read or repaired by a view. */
function presentationRunForId(scene, runId) {
  if (typeof runId !== "string" || !runId) return null;
  const definitions = scene.getFlag?.(MODULE_ID, "groupDefinitions") ?? {};
  const runs = scene.getFlag?.(MODULE_ID, "groupRuntimes") ?? {};
  for (const [groupId, run] of Object.entries(runs)) {
    if (run?.runId === runId && validGroupId(groupId) && definitions[groupId]?.schemaVersion === 1
      && validPresentationRun(run, groupId)) return run;
  }
  return null;
}
const groupStamp = (scene, groupId) => {
  if (!groupId) return null;
  if (!validGroupId(groupId) || scene.getFlag?.(MODULE_ID, "groupDefinitions")?.[groupId]?.schemaVersion !== 1) return undefined;
  const run = scene.getFlag?.(MODULE_ID, "groupRuntimes")?.[groupId];
  // A prepared group without its first run has the same initial stamp as
  // emptyRuntime; this is an absent execution, not a saved-format migration.
  if (run === undefined) return JSON.stringify(["", null, false, 0]);
  if (!validPresentationRun(run, groupId)) return undefined;
  return JSON.stringify([run.runId, run.stateId, run.halted, run.haltedAt]);
};
const hasScriptScope = data => data.scriptKey != null;
export const validScriptPresentationScope = data => record(data) && (!hasScriptScope(data) ? data.scriptGeneration == null
  : typeof data.scriptKey === "string" && Boolean(objectReferenceKey(data.target))
    && data.scriptKey.startsWith(`${objectReferenceKey(data.target)}:`)
    && Number.isSafeInteger(data.scriptGeneration ?? 0) && (data.scriptGeneration ?? 0) >= 0);

export function scriptPresentationScope(scene, { runId, groupId, manual = false, target, scriptKey, scriptGeneration = 0 } = {}) {
  return { sceneId: scene.id, runId, manual: Boolean(manual),
    ...(manual ? { groupId: groupId ?? null, manualHaltId: haltId(scene), manualGroupStamp: groupStamp(scene, groupId) } : {}),
    ...(scriptKey != null ? { scriptKey, scriptGeneration } : {}), ...(target ? { target: structuredClone(target) } : {}) };
}

/** Remote sound and camera delivery share the script's ownership contract. */
export function scriptPresentationIsCurrent(scene, data) {
  if (!scene || !validScriptPresentationScope(data)) return false;
  const key = data.target && objectReferenceKey(data.target);
  const binding = key && scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings?.[key];
  if (data.target && (!key || !scene[SCENE_OBJECT_COLLECTIONS[data.target.type]]?.get(data.target.id) || !binding || binding.playerCharacter)) return false;
  // Manual initial runs are local to the GM. Scene/group stamps gate remote
  // admission, while the creating client also checks its live execution lease.
  if (data.manual) {
    const stamp = groupStamp(scene, data.groupId);
    return stamp !== undefined && data.manualHaltId === haltId(scene) && data.manualGroupStamp === stamp;
  }
  const groupRun = presentationRunForId(scene, data.runId);
  const command = !groupRun && key && scene.getFlag?.(MODULE_ID, "objectCommandRuns")?.[key];
  const commandCurrent = command?.schemaVersion === 1 && command.command === true && command.runId === data.runId
    && ["before", "core", "after"].includes(command.phase) && !command.interruption && objectReferenceKey(command.target) === key;
  const run = commandCurrent ? presentationRunForId(scene, command.parentRunId) : groupRun;
  if (commandCurrent && run?.groupId !== command.groupId) return false;
  const progress = hasScriptScope(data) && (commandCurrent ? command : run)?.scriptStates?.[data.scriptKey];
  const scriptCurrent = !hasScriptScope(data) || progress && (progress.generation ?? 0) === (data.scriptGeneration ?? 0);
  // Stop disables the object's ordinary automation at admission. Its own
  // before/after scripts (and Cancel) retain the executor's narrow exception;
  // group halts, interruptions and generation changes still revoke delivery.
  const permitsDisabled = commandCurrent && ["stop", "cancel"].includes(command.config?.id);
  return Boolean(run && scriptCurrent && !isExecutionHalted(scene, run)
    && (!key || binding.groupId === run.groupId && (permitsDisabled || !run.disabledObjects.includes(key))));
}
