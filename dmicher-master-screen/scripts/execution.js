import { getRuntime } from "./store.js";

// One local cancellation barrier shared by scene effects, triggers and event subscriptions.
// The persisted halted state remains authoritative after reconnect; the barrier closes
// the interval while an already-started document operation releases the Scene lock.
const requests = new WeakMap();
export const executionGeneration = (scene) => requests.get(scene)?.generation ?? 0;
export function requestHalt(scene) {
  const generation = executionGeneration(scene) + 1;
  requests.set(scene, { generation, pending: true });
  return generation;
}
export function finishHalt(scene, generation) {
  const request = requests.get(scene);
  if (request?.generation === generation) request.pending = false;
}
export const isExecutionHalted = (scene, state = getRuntime(scene)) => Boolean(requests.get(scene)?.pending || state.halted);
