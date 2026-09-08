import { getRuntime } from "./store.js";

// One local cancellation barrier shared by scene effects, triggers and event subscriptions.
// The persisted halted state remains authoritative after reconnect; the barrier closes
// the interval while an already-started document operation releases the Scene lock.
const requests = new WeakMap();
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
export const executionGeneration = (scene, schemeId = "main") => requests.get(scene)?.get(schemeId)?.generation ?? 0;
export function requestHalt(scene, schemeId = "main") {
  const generation = executionGeneration(scene, schemeId) + 1;
  if (!requests.has(scene)) requests.set(scene, new Map());
  requests.get(scene).set(schemeId, { generation, pending: true });
  notifyExecutionChange(scene, "halt");
  return generation;
}
export function finishHalt(scene, generation, schemeId = "main") {
  const request = requests.get(scene)?.get(schemeId);
  if (request?.generation === generation) request.pending = false;
}
export const isExecutionHalted = (scene, state = getRuntime(scene)) => Boolean(requests.get(scene)?.get(state?.schemeId ?? "main")?.pending || state?.halted);
