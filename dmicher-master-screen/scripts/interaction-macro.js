import { ObjectVariableService } from "./object-variables.js";
import { getObjectBindings, getSceneObject, objectKey } from "./scene-objects.js";
import { createExecutionScope, isExecutionHalted } from "./execution.js";
import { getRuntime } from "./store.js";
import { text } from "./localization.js";

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const compiled = new Map();
/** Conditions are author code evaluated only by the elected GM, outside locks.
 * Discovery is read-only: a condition cannot mutate object variables. */
export async function evaluateInteractionMacro(scene,{target,conditionMacro = "",runtime,actorToken,user,current = () => true}) {
  if (!conditionMacro.trim()) return true;
  const snapshot = scene.getFlag?.("dmicher-master-screen","objectBindings")?.revision;
  const isCurrent = () => current() && scene.getFlag?.("dmicher-master-screen","objectBindings")?.revision === snapshot
    && (!runtime?.runId || getRuntime(scene,{groupId:runtime.groupId}).runId === runtime.runId && !isExecutionHalted(scene,getRuntime(scene,{groupId:runtime.groupId})))
    && Boolean(getSceneObject(scene,target));
  const lease = createExecutionScope(scene,{isCurrent});
  try {
    const scope = new ObjectVariableService().scope(scene,{object:target,current:lease.current});
    let fn = compiled.get(conditionMacro);
    if (!fn) {
      fn = new AsyncFunction("context",`"use strict"; const {GetValue,objectUuid,variables,stateId,actorTokenUuid,userId}=context;\n${conditionMacro}`);
      if(compiled.size >= 100) compiled.delete(compiled.keys().next().value);
      compiled.set(conditionMacro,fn);
    }
    const result = await lease.run(async () => fn(Object.freeze({GetValue:scope.GetValue,objectUuid:scope.objectUuid,
      variables:await scope.getVariables(),stateId:runtime?.stateId ?? null,actorTokenUuid:actorToken?.uuid ?? null,userId:user?.id})));
    if (result.stale) return false;
    if (typeof result.value !== "boolean") throw new Error(text("Макрос условия должен возвращать true или false.","A condition macro must return true or false."));
    return result.value;
  } finally { lease.dispose(); }
}
