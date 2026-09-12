import { getRuntime } from "./store.js";
import { MODULE_ID } from "./model.js";

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
  for (const listener of [...(listeners.get(scene) ?? [])]) listener(reason);
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
