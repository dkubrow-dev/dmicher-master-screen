import test from "node:test";
import assert from "node:assert/strict";
import { PlayerScriptControls } from "../dmicher-master-screen/scripts/player-script-controls.js";
import { interruptScriptProgress } from "../dmicher-master-screen/scripts/script-interruptions.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { commandFixture } from "./fixtures/object-commands.js";

function fixture({mode="stop",premium=false,manual=false}={}) {
  const owner={id:"owner",role:1},other={id:"other",role:1},gm={id:"gm",role:4,isGM:true,active:true};
  globalThis.game={user:gm,users:new Map([owner,other,gm].map(user=>[user.id,user])),modules:new Map()};
  let stopped=0,writes=0;
  const script={id:"script",enabled:true,interruptions:{playerAction:mode},target:{type:"Token",id:"pc"},steps:[{id:1,kind:"wait",parameters:{seconds:10}}]};
  const key="Token:pc:transition:script",progress={status:"ready",stepId:1,generation:0,action:{remainingMs:1000}};
  const run={runId:"run",groupId:"players",stateId:"default",state:{transitions:[script],objects:[{target:{type:"Token",id:"pc"}}]},scriptStates:{[key]:progress},disabledObjects:[]};
  const flags={objectBindings:{bindings:{"Token:pc":{type:"Token",id:"pc",groupId:"players",playerCharacter:true}}},groupRuntimes:{players:run}};
  const scene={id:"scene",tokens:new Map(),getFlag:(_module,key)=>flags[key],async setFlag(_module,key,value){writes++;flags[key]=structuredClone(value);}};
  const token={id:"pc",documentName:"Token",parent:scene,actor:{testUserPermission:user=>user.id===owner.id},object:{stopAnimation(){stopped++;}}};scene.tokens.set(token.id,token);globalThis.canvas={scene};
  const runtime={manualRuns:new Map(),owns:()=>true,scriptState:(_scene,id)=>id===run.runId?run:null,report:error=>{throw error;},effects:{stop(){}},
    scripts:{scriptForKey:()=>script,async interrupt(_scene,state,_token,prepared,progressKey){interruptScriptProgress(state.scriptStates[progressKey],prepared,"playerAction");}}};
  if(manual){run.manual=true;run.sceneId=scene.id;run.target=script.target;run.script=script;run.parentRunId="parent";flags.groupRuntimes.players={...run,runId:"parent",manual:false,scriptStates:{}};runtime.manualRuns.set(run.runId,run);}
  const controls=new PlayerScriptControls(runtime,{hasAccess:()=>premium});
  return {controls,runtime,scene,token,owner,other,gm,run,script,progress,key,flags,stopped:()=>stopped,writes:()=>writes};
}
test("owner changes interrupt for free and licensed forbid blocks only movement or visibility",async()=>{
  for(const [mode,premium,blocked] of [["stop",false,false],["forbid",false,false],["forbid",true,true]]){
    const f=fixture({mode,premium});game.user=f.owner;
    assert.notEqual(f.controls.preUpdate(f.token,{name:"Rename"},{},f.owner.id),false);
    assert.equal(f.controls.preUpdate(f.token,{x:100},{},f.owner.id)===false,blocked);
    game.user=f.gm;if(!blocked){await f.controls.updated(f.token,{x:100},{},f.owner.id);assert.equal(f.progress.status,"stopped");assert.equal(f.progress.interruption.source,"playerAction");}
    f.controls.dispose();
  }
});
test("GM, nonowner and completed scripts never receive an owner-action lock",()=>{
  const f=fixture({mode:"forbid",premium:true});
  for(const user of [f.gm,f.other]){game.user=user;assert.notEqual(f.controls.preUpdate(f.token,{hidden:true},{},user.id),false);}
  f.progress.status="done";game.user=f.owner;assert.notEqual(f.controls.preUpdate(f.token,{x:10},{},f.owner.id),false);f.controls.dispose();
});

test("a player flag uses Players controls even before the raw former group is changed", async () => {
  const f=fixture({mode:"forbid",premium:true});
  f.flags.objectBindings.bindings["Token:pc"].groupId="former";
  game.user=f.owner;
  assert.equal(f.controls.preUpdate(f.token,{x:10},{},f.owner.id),false);
  assert.equal(f.flags.objectBindings.bindings["Token:pc"].groupId,"former");
  assert.equal(f.writes(),0); f.controls.dispose();
});
test("manual control lease reaches other clients and clears after completion without ownership edits",async()=>{
  const f=fixture({mode:"forbid",premium:true,manual:true});await f.controls.sync(f.scene);
  assert.ok(Object.keys(f.flags.playerScriptControls.entries).length);const source=JSON.stringify(f.token.actor);
  const remote=new PlayerScriptControls({...f.runtime,manualRuns:new Map()},{hasAccess:()=>true});game.user=f.owner;
  assert.equal(remote.preUpdate(f.token,{x:20},{},f.owner.id),false);
  game.user=f.gm;f.progress.status="done";await f.controls.sync(f.scene);
  game.user=f.owner;assert.notEqual(remote.preUpdate(f.token,{x:20},{},f.owner.id),false);assert.equal(JSON.stringify(f.token.actor),source);
  remote.dispose();game.user=f.gm;f.controls.dispose();
});
test("playerAction interruption is always stop even for configured premium forbid",()=>{
  const f=fixture({mode:"forbid"});interruptScriptProgress(f.progress,f.script,"playerAction");assert.equal(f.progress.status,"stopped");assert.equal(f.progress.interruption.mode,"stop");f.controls.dispose();
});
test("owner action cancels a real pending initial-script job and rejects its late result",async()=>{
  const f=await commandFixture({commands:["wait"]});f.binding.playerCharacter=true;f.binding.groupId="players";
  f.binding.initialScript={id:"initial",enabled:true,interruptions:{playerAction:"forbid"},steps:[{id:1,kind:"macro",parameters:{macroUuid:"Macro.pending"},next:[2]},{id:2,kind:"wait",parameters:{seconds:10}}]};
  let release,began;const entered=new Promise(resolve=>{began=resolve;});
  f.runtime.effects.macro=async()=>{began();await new Promise(resolve=>{release=resolve;});};
  f.runtime.isObjectMacroAttached=()=>true;
  await f.runtime.restoreInitial(f.scene,{type:"Token",id:f.npc.id});
  const ticking=f.tick();await Promise.race([entered,ticking.then(()=>{throw Error("macro did not start");})]);
  const run=[...f.runtime.manualRuns.values()][0],key=Object.keys(run.scriptStates)[0];
  assert.equal(run.scriptStates[key].status,"pending");assert.ok(Object.keys(f.flags.playerScriptControls.entries).length);
  await f.runtime.playerControls.updated(f.npc,{hidden:true},{},f.player.id);
  let timer;try{await Promise.race([ticking,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("late job held tick")),1000);})]);}finally{clearTimeout(timer);}
  const stopped=structuredClone(f.runtime.manualRuns.get(run.runId)?.scriptStates[key]);
  assert.equal(stopped.status,"stopped");assert.equal(stopped.interruption.source,"playerAction");
  assert.equal(Object.keys(f.flags.playerScriptControls.entries).length,0);
  release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.runtime.manualRuns.get(run.runId)?.scriptStates[key],stopped);f.runtime.dispose();
});
test("an owner's update stops the actual command before-script without starting its core",async()=>{
  const f=await commandFixture({commands:[{id:"wait",enabled:true,beforeScript:{id:"before",enabled:true,interruptions:{playerAction:"stop"},steps:[{id:1,kind:"wait",parameters:{seconds:30}}]}}]});
  f.binding.playerCharacter=true;f.binding.groupId="players";await f.runtime.enter(f.scene,"default",{groupId:"players"});
  await f.accept("wait");await f.tick();assert.equal(f.active().phase,"before");
  await f.runtime.playerControls.updated(f.npc,{x:30},{},f.player.id);
  const stopped=Object.values(f.active().scriptStates).find(progress=>progress.interruption?.source==="playerAction");assert.equal(stopped.status,"stopped");
  await f.tick();assert.equal(f.active(),null);f.runtime.dispose();
});
test("manual leases fail open after authority loss or a mismatched group/halt stamp",async()=>{
  const f=fixture({mode:"forbid",premium:true,manual:true});await f.controls.sync(f.scene);
  const remote=new PlayerScriptControls({...f.runtime,manualRuns:new Map()},{hasAccess:()=>true});game.user=f.owner;
  assert.equal(remote.preUpdate(f.token,{hidden:true},{},f.owner.id),false);
  f.flags.automationHaltId="new";assert.notEqual(remote.preUpdate(f.token,{hidden:true},{},f.owner.id),false);
  delete f.flags.automationHaltId;f.flags.groupRuntimes.players.runId="new";assert.notEqual(remote.preUpdate(f.token,{hidden:true},{},f.owner.id),false);
  f.flags.groupRuntimes.players.runId="parent";f.gm.active=false;assert.notEqual(remote.preUpdate(f.token,{hidden:true},{},f.owner.id),false);
  remote.dispose();f.controls.dispose();
});
