import { MODULE_ID } from "./model.js";
import { isAuthority, withSceneLock } from "./store.js";
import { scriptProgressKey } from "./script-model.js";
import { isPlayerActionLockAvailable } from "./premium-provider.js";
import { isExecutionHalted, isSceneAutomationHalted, notifyExecutionChange, onExecutionChange } from "./execution.js";
import { stopObjectAnimation } from "./script-movement.js";

const FLAG = "playerScriptControls";
const active = progress => progress && !["done","stopped","failed","uncertain"].includes(progress.status);
const authorityId = () => Array.from(game.users?.values?.() ?? []).filter(user=>user.active && Number(user.role)===4).sort((a,b)=>a.id.localeCompare(b.id))[0]?.id;
const targetKey = token => `Token:${token.id}`;
const affects = changes => ["x","y","hidden"].some(key=>Object.hasOwn(changes,key));
const bindingOf = token => token.parent?.getFlag?.(MODULE_ID,"objectBindings")?.bindings?.[targetKey(token)];
const isPlayer = token => bindingOf(token)?.playerCharacter === true || bindingOf(token)?.groupId === "players";
const effectiveGroup = binding => binding?.playerCharacter ? "players" : binding?.groupId ?? null;
const groupStamp = parent => parent ? JSON.stringify([parent.runId,parent.stateId,parent.halted,parent.haltedAt]) : null;

/** This is a native update policy, not an ownership change. Persisted group and
 * command progress is already shared; only active local manual/event scripts
 * need a small replicated lease. Nothing is inspected on animation frames. */
export class PlayerScriptControls {
  constructor(runtime,{hasAccess=isPlayerActionLockAvailable}={}) {
    Object.assign(this,{runtime,hasAccess});this.hooks=[];this.barriers=new Map();this.writes=new WeakMap();this.disposed=false;
    this.sessionId=globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  }
  entries(token) {
    const scene=token.parent,binding=bindingOf(token),entries=[];
    if(!isPlayer(token)||isSceneAutomationHalted(scene)||scene.getFlag?.(MODULE_ID,"objectBehaviorState")?.[targetKey(token)] === false)return entries;
    const add=(run,script,key,progress)=>{
      if(script?.enabled!==false && active(progress))entries.push({runId:run.runId,key,tokenId:token.id,script,mode:script?.interruptions?.playerAction === "forbid" ? "forbid":"stop"});
    };
    const runs=scene.getFlag?.(MODULE_ID,"groupRuntimes") ?? {};
    const group=runs[effectiveGroup(binding)];
    if(group?.runId && !isExecutionHalted(scene,group) && !group.disabledObjects?.includes(targetKey(token))) {
      for(const [slot,list]of [["transition",group.state?.transitions],["routine",group.state?.scripts]])for(const script of list ?? []){
        if(script.target?.type!=="Token"||script.target.id!==token.id)continue;
        const key=scriptProgressKey({type:"Token",id:token.id},script,slot);add(group,script,key,group.scriptStates?.[key]);
      }
    }
    const command=scene.getFlag?.(MODULE_ID,"objectCommandRuns")?.[targetKey(token)];
    if(command?.runId && !command.interruption && (!command.groupId || runs[command.groupId]?.runId===command.parentRunId && !isExecutionHalted(scene,runs[command.groupId]))) {
      for(const [key,progress]of Object.entries(command.scriptStates ?? {}))add(command,command.phaseScripts?.[key] ?? command.script,key,progress);
    }
    if(isAuthority())for(const run of this.runtime.manualRuns.values()){
      if(run.sceneId!==scene.id||run.target?.type!=="Token"||run.target.id!==token.id||!this.runtime.owns(scene,run.runId))continue;
      for(const [key,progress]of Object.entries(run.scriptStates ?? {}))add(run,run.script,key,progress);
    }
    else {
      const leases=scene.getFlag?.(MODULE_ID,FLAG);
      if(leases?.authorityId===authorityId() && leases.authorityId)for(const entry of Object.values(leases.entries ?? {})){
        if(!entry||entry.tokenId!==token.id||entry.haltId!==(scene.getFlag?.(MODULE_ID,"automationHaltId") ?? null))continue;
        const parent=entry.groupId && runs[entry.groupId];
        if(entry.groupId!==effectiveGroup(binding)||groupStamp(parent)!==entry.groupStamp||!entry.initial && entry.groupId && (!parent||isExecutionHalted(scene,parent)))continue;
        entries.push({...entry,script:null});
      }
    }
    return entries;
  }
  ownerAction(token,changes,userId) {
    const user=game.users?.get(userId);
    return !this.disposed && affects(changes) && user && !user.isGM && token.actor?.testUserPermission?.(user,"OWNER") === true;
  }
  preUpdate(token,changes,_options,userId=game.user?.id) {
    if(!this.ownerAction(token,changes,userId))return;
    const entries=this.entries(token);if(!entries.length)return;
    if(this.hasAccess() && entries.some(entry=>entry.mode==="forbid"))return false;
    stopObjectAnimation(token);
    // On an initiating player client this stops presentation immediately. The
    // elected GM consumes the authenticated native update hook after delivery.
    if(isAuthority())this.stop(token,entries);
  }
  updated(token,changes,_options,userId) {
    if(!isAuthority()||!this.ownerAction(token,changes,userId))return;
    return this.stop(token,this.entries(token));
  }
  source(scene,target,runId) {
    return [...this.barriers.values()].some(entry=>entry.scene===scene&&entry.runId===runId&&entry.tokenId===target.id) ? "playerAction":null;
  }
  stop(token,entries) {
    if(!entries.length)return;
    const scene=token.parent;
    for(const entry of entries)this.barriers.set(`${scene.id}:${entry.runId}:${entry.key}`,{...entry,scene});
    stopObjectAnimation(token);notifyExecutionChange(scene,"player-action");
    const task=withSceneLock(scene,async()=>{
      for(const entry of entries){
        const key=`${scene.id}:${entry.runId}:${entry.key}`;
        try{
          const state=this.runtime.scriptState(scene,entry.runId),progress=state?.scriptStates?.[entry.key];
          if(!state||!active(progress)||!this.runtime.owns(scene,entry.runId))continue;
          const script=this.runtime.scripts.scriptForKey(state,token,entry.key);
          if(script)await this.runtime.scripts.interrupt(scene,state,token,script,entry.key,"playerAction");
        }finally{this.barriers.delete(key);}
      }
      await this.sync(scene);
    });
    void task.catch(error=>this.runtime.report(error));return task;
  }
  sync(scene,{clear=false}={}) {
    if(!scene?.setFlag||!isAuthority())return Promise.resolve();
    const previous=this.writes.get(scene) ?? Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      if(!isAuthority())return;
      const stored=scene.getFlag?.(MODULE_ID,FLAG),entries={};
      if(!clear && !this.disposed)for(const run of this.runtime.manualRuns.values()){
        if(run.sceneId!==scene.id||run.target?.type!=="Token"||!this.runtime.owns(scene,run.runId))continue;
        const token=scene.tokens?.get(run.target.id);if(!token||!isPlayer(token))continue;
        for(const [key,progress]of Object.entries(run.scriptStates ?? {}))if(active(progress))entries[`${run.runId}:${key}`]={tokenId:token.id,runId:run.runId,key,
          mode:run.script?.interruptions?.playerAction === "forbid" ? "forbid":"stop",groupId:run.groupId ?? null,parentRunId:run.parentRunId ?? null,stateId:run.stateId ?? null,
          initial:!run.purpose,groupStamp:groupStamp(run.groupId && scene.getFlag?.(MODULE_ID,"groupRuntimes")?.[run.groupId]),
          haltId:scene.getFlag?.(MODULE_ID,"automationHaltId") ?? null};
      }
      if(!stored && !Object.keys(entries).length)return;
      const next={authorityId:game.user.id,sessionId:this.sessionId,entries};
      if(JSON.stringify(stored)===JSON.stringify(next))return;
      // Use a whole-object replacement; Foundry's recursive flag merge would
      // otherwise preserve ended script leases as invisible stale keys.
      const value={...next,entries:{...entries,...Object.fromEntries(Object.keys(stored?.entries ?? {}).filter(key=>!Object.hasOwn(entries,key)).map(key=>[`-=${key}`,null]))}};
      await scene.setFlag(MODULE_ID,FLAG,value);
    });
    this.writes.set(scene,task);return task;
  }
  watch(scene) {
    this.unsubscribe?.();this.unsubscribe=null;
    if(scene)this.unsubscribe=onExecutionChange(scene,()=>{void this.sync(scene).catch(error=>this.runtime.report(error));});
    void this.sync(scene).catch(error=>this.runtime.report(error));
  }
  install() {
    if(this.hooks.length)return;
    this.disposed=false;const on=(name,fn)=>this.hooks.push([name,Hooks.on(name,fn)]);
    on("preUpdateToken",(...args)=>this.preUpdate(...args));on("updateToken",(...args)=>this.updated(...args));
    on("deleteToken",token=>{for(const [key,entry]of this.barriers)if(entry.scene===token.parent&&entry.tokenId===token.id)this.barriers.delete(key);void this.sync(token.parent).catch(error=>this.runtime.report(error));});
    on("updateUser",()=>{void this.sync(globalThis.canvas?.scene).catch(error=>this.runtime.report(error));});
    on("updateScene",(scene,changes)=>{
      const flags=changes?.flags?.[MODULE_ID];
      if(flags && Object.keys(flags).some(key=>key!==FLAG)||Object.keys(changes ?? {}).some(key=>key.startsWith(`flags.${MODULE_ID}.`)&&!key.startsWith(`flags.${MODULE_ID}.${FLAG}`)))void this.sync(scene).catch(error=>this.runtime.report(error));
    });
    on("canvasReady",()=>this.watch(globalThis.canvas?.scene));
    on("canvasTearDown",()=>{void this.sync(globalThis.canvas?.scene,{clear:true}).catch(error=>this.runtime.report(error));this.unsubscribe?.();this.unsubscribe=null;this.barriers.clear();});
    this.watch(globalThis.canvas?.scene);
  }
  dispose() {
    this.disposed=true;this.unsubscribe?.();this.unsubscribe=null;
    for(const [name,id]of this.hooks)Hooks.off(name,id);this.hooks=[];this.barriers.clear();
    void this.sync(globalThis.canvas?.scene,{clear:true}).catch(error=>this.runtime.report(error));
  }
}
