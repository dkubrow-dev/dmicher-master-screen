import { commandTrace } from "./debug.js";

const pending = new WeakMap();
const SCENE_SCOPE = Symbol("scene-command");
let sequence = 0;

/** Observe a Director command without queueing it behind another command, a
 * scene write, or a render. Execution and cancellation remain runtime concerns.
 * A restore result contains scheduled runs, not finished initial scripts. */
export function runDirectorCommand(command, scene, operation, { groupId, groupName } = {}) {
  let commands = scene && pending.get(scene);
  if (scene && !commands) pending.set(scene, commands = new Map());
  const scope = groupId ?? SCENE_SCOPE;
  const context = { commandId: `director-${++sequence}`, command, sceneId: scene?.id, sceneName: scene?.name,
    initiatorId: globalThis.game?.user?.id, initiatorName: globalThis.game?.user?.name,
    ...(groupId ? { groupId, groupName } : {}) };
  const startedAt = Date.now();
  const entry = { context };
  commandTrace("requested", context);
  for (const [key, previous] of commands ?? []) {
    if (groupId && key !== SCENE_SCOPE && key !== groupId) continue;
    previous.superseded = true;
    commandTrace("cancelled", { ...previous.context, supersededBy: context.commandId });
    commands.delete(key);
  }
  commands?.set(scope, entry);
  const finish = (event, details = {}, error) => {
    if (commands?.get(scope) === entry) commands.delete(scope);
    if (!entry.superseded) commandTrace(event, { ...context, elapsedMs: Date.now() - startedAt, ...details }, error);
  };
  let result;
  try { result = operation(); }
  catch (error) { finish("failed", {}, error); return Promise.reject(error); }
  return Promise.resolve(result).then(value => {
    const failures = Array.isArray(value) ? value.filter(item => item?.error).map(({ groupId, error }) => ({ groupId, error })) : [];
    if (failures.length) finish("failed", { failures }, new Error(failures.map(item => item.error).join("; ")));
    else finish(["restore-initial", "restore-group-initial"].includes(command) && value?.length ? "scheduled" : "completed", { resultCount: Array.isArray(value) ? value.length : undefined });
    return value;
  }, error => { finish("failed", {}, error); throw error; });
}
