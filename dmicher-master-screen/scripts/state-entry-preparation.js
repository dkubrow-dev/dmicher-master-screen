import { notifyExecutionChange } from "./execution.js";

// Local authority barrier, installed before publishing a new group run. The
// pending preparation can use the scene storage queue without holding it, while
// object scripts and player admission wait for the resulting inventory state.
const preparations=new WeakMap();
export function beginStateEntryPreparation(scene,run) {
  let groups=preparations.get(scene);
  if(!groups) preparations.set(scene,groups=new Map());
  const token={runId:run.runId};groups.set(run.groupId,token);
  return ()=>{
    if(groups.get(run.groupId) !== token) return;
    groups.delete(run.groupId);if(!groups.size) preparations.delete(scene);
    notifyExecutionChange(scene,"state-preparation-complete");
  };
}
export function isStateEntryPreparing(scene,run) {
  const entry=preparations.get(scene)?.get(run?.groupId);
  return Boolean(entry && entry.runId === (run?.parentRunId ?? run?.runId));
}
export function clearStateEntryPreparations(scene) {
  if(scene) preparations.delete(scene);
}
