import { commandTrace } from "./debug.js";

const pending = new WeakMap();
let sequence = 0;

/** Observe a Director command without queueing it behind another command, a
 * scene write, or a render. Execution and cancellation remain runtime concerns.
 * A restore result contains scheduled runs, not finished initial scripts. */
export function runDirectorCommand(command, scene, operation) {
  const previous = scene && pending.get(scene);
  const context = { commandId: `director-${++sequence}`, command, sceneId: scene?.id, sceneName: scene?.name,
    initiatorId: globalThis.game?.user?.id, initiatorName: globalThis.game?.user?.name };
  const startedAt = Date.now();
  const entry = { context };
  commandTrace("requested", context);
  if (previous) {
    previous.superseded = true;
    commandTrace("cancelled", { ...previous.context, supersededBy: context.commandId });
  }
  if (scene) pending.set(scene, entry);
  const finish = (event, details = {}, error) => {
    if (scene && pending.get(scene) === entry) pending.delete(scene);
    if (!entry.superseded) commandTrace(event, { ...context, elapsedMs: Date.now() - startedAt, ...details }, error);
  };
  let result;
  try { result = operation(); }
  catch (error) { finish("failed", {}, error); return Promise.reject(error); }
  return Promise.resolve(result).then(value => {
    const failures = Array.isArray(value) ? value.filter(item => item?.error).map(({ groupId, error }) => ({ groupId, error })) : [];
    if (failures.length) finish("failed", { failures }, new Error(failures.map(item => item.error).join("; ")));
    else finish(command === "restore-initial" && value?.length ? "scheduled" : "completed", { resultCount: Array.isArray(value) ? value.length : undefined });
    return value;
  }, error => { finish("failed", {}, error); throw error; });
}
