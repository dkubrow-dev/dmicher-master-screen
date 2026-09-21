import { MODULE_ID } from "./model.js";
import { isAuthority, asArray } from "./store.js";
import { getSceneObject } from "./scene-objects.js";
import { SCENE_OBJECT_TYPES } from "./scene-object-types.js";
import { evaluateInteractionMacro } from "./interaction-macro.js";
import { createExecutionScope, executionGeneration, sceneExecutionGeneration, isExecutionHalted } from "./execution.js";
import { resetShopInventory } from "./shop-inventory.js";
import { commandBehaviorEnabled } from "./object-command-state.js";
import * as premium from "./premium-provider.js";
import { debugError, debugTrace } from "./debug.js";

const list = value => Array.isArray(value) ? value : [];
const includes = (values, value) => !list(values).length || values.includes(value);
const flag = (scene, name) => scene.getFlag(MODULE_ID,name);
const snapshot = (scene, groupId) => {
  const definition = flag(scene,"groupDefinitions")?.[groupId], runtime = flag(scene,"groupRuntimes")?.[groupId];
  return {groupId,stateId:runtime?.stateId ?? definition?.entryStateId ?? null,runId:runtime?.runId ?? "",
    revision:definition?.revision,exists:definition?.schemaVersion === 1};
};

/** Automatic restoration is an event-level coordinator, not a background clock.
 * Conditions run outside storage locks. The inventory service rechecks the same
 * lease under its lock and owns cancellation of unfinished trades and writes. */
export class ShopRestoration {
  constructor({ reset = resetShopInventory, evaluate = evaluateInteractionMacro, authority = isAuthority,
    available = () => premium.isShopRestorationAvailable?.() === true,
    subscribeAccess = listener => premium.subscribeShopRestorationAccess?.(listener),
    onError = (error,context) => debugError("shop","restoration.failed",error,context) } = {}) {
    Object.assign(this,{reset,evaluate,authority,available,subscribeAccess,onError});
    this.events = new WeakMap(); this.active = new WeakMap(); this.scopes = new Set();
    this.hooks = []; this.disposed = false; this.sequence = 0;
  }
  install(hooks = globalThis.Hooks) {
    if (this.hooks.length || this.disposed) return this;
    for (const scene of asArray(globalThis.game?.scenes)) this.active.set(scene,Boolean(scene.active));
    const on = (name,callback) => this.hooks.push([hooks,name,hooks.on(name,callback)]);
    on("updateScene",(scene,changes)=>{
      void this.sceneUpdated(scene,changes).catch(error=>this.onError(error,{sceneId:scene.id}));
    });
    on("createScene",scene=>this.active.set(scene,Boolean(scene.active)));
    on("deleteScene",scene=>{this.active.delete(scene);this.reconcile(scene);});
    for (const type of SCENE_OBJECT_TYPES) on(`delete${type}`,document=>this.reconcile(document.parent));
    this.removeAccess = this.subscribeAccess(()=>this.reconcile());
    return this;
  }
  reconcile(scene) {
    for (const entry of this.scopes) if (!scene || entry.scene === scene) entry.scope.current();
  }
  sceneUpdated(scene,changes) {
    this.reconcile(scene);
    if (!Object.hasOwn(changes,"active")) return Promise.resolve([]);
    const previous=this.active.get(scene),next=changes.active === true;
    this.active.set(scene,next);
    // View changes, reconnect, initial snapshots and repeated active:true never
    // synthesize an activation. Only an observed false -> true transition does.
    if (previous !== false || !next) return Promise.resolve([]);
    return this.restore(scene,"scene-activation",{eventId:`activation:${++this.sequence}`,current:()=>scene.active === true});
  }
  stateEntered(scene,run,{current=()=>true}={}) {
    if (!run?.runId || !run.stateId || !run.groupId) return Promise.resolve([]);
    const expected={runId:run.runId,stateId:run.stateId,groupId:run.groupId};
    return this.restore(scene,"state-entry",{eventId:`state:${run.groupId}:${run.runId}`,groupId:run.groupId,current:()=>{
      const live=flag(scene,"groupRuntimes")?.[expected.groupId];
      return current() && live?.runId === expected.runId && live.stateId === expected.stateId && !isExecutionHalted(scene,live);
    }});
  }
  restore(scene,activation,{eventId,groupId,current}) {
    if (this.disposed || !this.authority() || !this.available()) return Promise.resolve([]);
    let events=this.events.get(scene);
    if (!events) this.events.set(scene,events=new Map());
    if (events.has(eventId)) return events.get(eventId).promise;
    while (events.size >= 100) {
      const finished=[...events].find(([,entry])=>entry.done);
      if (!finished) return Promise.resolve([]);
      events.delete(finished[0]);
    }
    const receipt={done:false};
    receipt.promise=this.perform(scene,activation,{groupId,current}).finally(()=>{receipt.done=true;});
    events.set(eventId,receipt);return receipt.promise;
  }
  async perform(scene,activation,{groupId,current}) {
    const bindings=flag(scene,"objectBindings") ?? {},catalog=flag(scene,"interactionCatalog") ?? {};
    const sceneGeneration=sceneExecutionGeneration(scene),haltId=flag(scene,"automationHaltId");
    const valid=()=>{
      try {
        return !this.disposed && this.authority() && this.available() && current()
          && globalThis.game?.scenes?.get(scene.id) === scene && sceneExecutionGeneration(scene) === sceneGeneration
          && flag(scene,"automationHaltId") === haltId && flag(scene,"objectBindings")?.revision === bindings.revision
          && flag(scene,"interactionCatalog")?.revision === catalog.revision;
      } catch { return false; }
    };
    const byShop=new Map(),assets=new Set(list(catalog.shops).map(shop=>shop.id));
    for (const binding of Object.values(bindings.bindings ?? {})) {
      if (!binding.groupId || groupId && binding.groupId !== groupId || !getSceneObject(scene,binding)) continue;
      if (!commandBehaviorEnabled(scene,binding,flag(scene,"groupRuntimes")?.[binding.groupId])) continue;
      const state=snapshot(scene,binding.groupId);
      if (!state.exists || !state.stateId) continue;
      const generation=executionGeneration(scene,binding.groupId);
      for (const reference of list(binding.shops)) {
        const policy=reference.restoration;
        // Player admission is independent: a closed or unavailable shop can
        // still replenish. Only assignment states and the restoration policy
        // participate, never player tags, distance, quota or admission toggles.
        if (policy?.activation !== activation || !assets.has(reference.shopId) || !includes(reference.stateIds,state.stateId)) continue;
        const rules=byShop.get(reference.shopId) ?? [];
        rules.push({target:{type:binding.type,id:binding.id},conditionMacro:policy.conditionMacro ?? "",state,generation});
        byShop.set(reference.shopId,rules);
      }
    }
    const restored=[];
    for (const [shopId,rules] of byShop) {
      if (!valid()) break;
      for (const rule of rules) {
        const isCurrent=()=>{
          const live=snapshot(scene,rule.state.groupId);
          return valid() && Boolean(getSceneObject(scene,rule.target)) && live.exists
            && commandBehaviorEnabled(scene,rule.target,flag(scene,"groupRuntimes")?.[rule.state.groupId])
            && live.runId === rule.state.runId && live.stateId === rule.state.stateId && live.revision === rule.state.revision
            && executionGeneration(scene,rule.state.groupId) === rule.generation;
        };
        const scope=createExecutionScope(scene,{isCurrent}),entry={scene,scope};this.scopes.add(entry);let attempted=false;
        try {
          // Scene activation may precede any group start or retain stopped
          // groups. The outer lease checks actual state; this read-only macro
          // receives stateId without pretending it owns a running script.
          const allowed=await scope.run(()=>this.evaluate(scene,{target:rule.target,conditionMacro:rule.conditionMacro,
            runtime:{groupId:rule.state.groupId,stateId:rule.state.stateId,runId:""},user:globalThis.game?.user,current:scope.current,signal:scope.signal}));
          if (allowed.stale || allowed.value !== true) continue;
          const result=await scope.run(()=>{attempted=true;return this.reset(scene,shopId,{isCurrent:scope.current});});
          if (result.stale || result.value?.stale) { if(attempted) break;continue; }
          restored.push(shopId);
          debugTrace("shop","restoration.completed",()=>({sceneId:scene.id,shopId,activation,target:rule.target,groupId:rule.state.groupId,stateId:rule.state.stateId}));
          break; // Shared asset: the first allowed rule restores it once.
        } catch(error) {
          if(scope.current()) this.onError(error,{sceneId:scene.id,shopId,activation,target:rule.target});
          // A failed/late storage acknowledgement can follow an applied write.
          // Never issue a second reset of this asset through another binding.
          if(attempted) break;
        }
        finally {scope.dispose();this.scopes.delete(entry);}
      }
    }
    return restored;
  }
  dispose() {
    this.disposed=true;for (const {scope} of this.scopes) scope.cancel();this.scopes.clear();
    for (const [hooks,name,id] of this.hooks) hooks.off(name,id);this.hooks=[];this.removeAccess?.();
    this.events=new WeakMap();this.active=new WeakMap();
  }
}
