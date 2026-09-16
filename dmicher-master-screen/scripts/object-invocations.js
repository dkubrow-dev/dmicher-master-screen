import { MODULE_ID, emptyRuntime } from "./model.js";
import { getRuntime, isAuthority } from "./store.js";
import { getObjectBindings, getSceneObject, objectKey } from "./scene-objects.js";
import { createExecutionScope, isExecutionHalted, isSceneAutomationHalted, notifyExecutionChange } from "./execution.js";
import { text } from "./localization.js";
import { scriptProgressKey } from "./script-model.js";

/** Events and reactions use the same interpreter as routine and initial scripts.
 * Only the invocation lease/completion belong here; there is no second clock. */
export class ObjectInvocations {
  constructor(runtime) { this.runtime = runtime; this.pending = new Map(); }
  current(scene, run) {
    const invocation = this.pending.get(run.runId), key = objectKey(run.target);
    const binding = scene.getFlag(MODULE_ID,"objectBindings")?.bindings?.[key];
    if (!invocation || this.runtime.disposed || globalThis.canvas?.scene?.id !== scene.id || !isAuthority()
      || !invocation.finished && !this.runtime.manualRuns.has(run.runId) || !invocation.current() || isSceneAutomationHalted(scene)
      || !getSceneObject(scene,run.target) || !binding || binding.playerCharacter
      || scene.getFlag(MODULE_ID,"objectBehaviorState")?.[key] === false) return false;
    if (!run.groupId) return !binding?.groupId;
    const parent = scene.getFlag(MODULE_ID,"groupRuntimes")?.[run.groupId];
    return scene.getFlag(MODULE_ID,"groupDefinitions")?.[run.groupId]?.schemaVersion === 1
      && binding.groupId === run.groupId && parent?.runId === run.parentRunId && parent.stateId === run.stateId
      && !isExecutionHalted(scene,parent) && !parent.disabledObjects?.includes(key);
  }
  /** Explicitly inspect local leases on data updates and ticks, including paused
   * games. An invalid invocation must release its awaiting signal even if its
   * object no longer has an eligible interpreter tick. */
  reconcile(scene) {
    for (const invocation of this.pending.values()) if (invocation.scene === scene) invocation.scope?.current();
  }
  async run(scene, {target, script, purpose, parameters = {}, signal, action, current = () => true, progress, parentRunId}) {
    this.runtime.requireAuthority(scene);
    const binding = getObjectBindings(scene).bindings[objectKey(target)];
    if (!binding || !script?.enabled || !script.steps.length) return {};
    if ([...this.runtime.manualRuns.values()].some(run => run.sceneId === scene.id && objectKey(run.target) === objectKey(target)) || this.runtime.commandExecutor?.activeForObject(scene,target)) {
      throw new Error(text("Объект занят выполнением другого действия.","The object is busy performing another action."));
    }
    const parent = binding.groupId ? getRuntime(scene,{groupId:binding.groupId}) : null;
    if (parentRunId !== undefined && parent?.runId !== parentRunId) return {};
    const run = {...emptyRuntime(binding.groupId),manual:true,purpose,sceneId:scene.id,
      runId:foundry.utils.randomID(),parentRunId:parent?.runId,stateId:parent?.stateId ?? null,state:parent?.state ?? null,
      target:structuredClone(target),script:structuredClone(script),
      executionContext:{parameters:structuredClone(parameters),signal:signal && structuredClone(signal),action:action && structuredClone(action)}};
    let resolve;
    const completed = new Promise(done => {resolve=done;});
    if (progress) run.scriptStates[scriptProgressKey(target,run.script,purpose)] = structuredClone(progress);
    const invocation = {current,resolve,scene,finished:false};
    this.pending.set(run.runId,invocation);
    this.runtime.manualRuns.set(run.runId,run);
    const scope = createExecutionScope(scene,{isCurrent:() => this.current(scene,run)});
    invocation.scope = scope;
    try {
      if (!scope.current()) return {};
      this.runtime.tickTimes.set(`${scene.id}:${run.runId}`,this.runtime.now());
      notifyExecutionChange(scene,"object-invocation.started"); this.runtime.onChange(scene);
      const result = await scope.run(() => completed);
      if (result.stale) return {};
      if (result.value?.error) throw new Error(result.value.error);
      return result.value?.values ?? {};
    } finally {
      scope.dispose(); this.pending.delete(run.runId);
      const active = this.runtime.manualRuns.get(run.runId);
      if (active) { this.runtime.stopPresentation(scene,[active]); this.runtime.manualRuns.delete(run.runId); }
      this.runtime.tickTimes.delete(`${scene.id}:${run.runId}`);
      notifyExecutionChange(scene,"object-invocation.finished");
    }
  }
  finish(run, progress) {
    const error = ["failed","uncertain"].includes(progress?.status) ? progress.error ?? text("Скрипт завершился с ошибкой.","The script failed.") : null;
    const invocation = this.pending.get(run.runId);
    if (invocation) { invocation.finished = true; invocation.resolve({error,values:progress?.returns ?? {}}); }
  }
  resume(scene, entry) {
    // The old delivery was cancelled by Stop. A resumed script has a new lease
    // and retains its input contract, without completing an obsolete receipt.
    void this.run(scene,{target:entry.target,script:entry.script,purpose:entry.purpose,progress:entry.progress,
      ...entry.executionContext}).catch(error=>this.runtime.report(error,{category:"script",event:"invocation.resume.failed",context:{sceneId:scene.id,target:entry.target}}));
  }
  event(scene,{owner,subscription,parameters,signal,current}) {
    const target = {type:owner.type,id:owner.id}, binding = getObjectBindings(scene).bindings[objectKey(target)];
    return this.run(scene,{target,script:binding?.eventScripts?.find(entry => entry.subscriptionId === subscription.id)?.script,
      purpose:"event",parameters,signal,current});
  }
}
