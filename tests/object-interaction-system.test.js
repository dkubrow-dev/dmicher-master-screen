import test from "node:test";
import assert from "node:assert/strict";
import {sceneFixture,descriptor} from "./fixtures/scene.js";
import {sampleGroupDefinition} from "./fixtures/definitions.js";
import {MODULE_ID,emptyRuntime} from "../dmicher-master-screen/scripts/model.js";
import {normalizeObjectBinding,materializeStateDefinition,resolveBindingTools} from "../dmicher-master-screen/scripts/object-binding-model.js";
import {evaluateInteractionMacro} from "../dmicher-master-screen/scripts/interaction-macro.js";
import {GroupRuntime} from "../dmicher-master-screen/scripts/runtime.js";
import {normalizeScript} from "../dmicher-master-screen/scripts/script-model.js";
import {listAvailableInteractions,validateObjectActionAccess} from "../dmicher-master-screen/scripts/interaction-access.js";
import {resetStateConditions} from "../dmicher-master-screen/scripts/interaction-conditions.js";
import {notifyExecutionChange,requestSceneHalt} from "../dmicher-master-screen/scripts/execution.js";
import {scriptProgressKey} from "../dmicher-master-screen/scripts/script-runtime.js";
import {ObjectInteractionService} from "../dmicher-master-screen/scripts/object-interaction-service.js";

function fixture() {
  const f=sceneFixture(), flags=f.scene.flags[MODULE_ID],definition=sampleGroupDefinition();
  flags.groupDefinitions={main:definition};
  const binding=normalizeObjectBinding({...descriptor,groupId:"main",variables:[{name:"open",type:"integer",value:1}],
    actions:[{id:"touch",name:"Touch",enabled:true,audience:"all",conditions:{repeat:"always"}}]});
  flags.objectBindings={schemaVersion:1,revision:1,bindings:{"Token:npc":binding}};
  flags.groupRuntimes={main:{...emptyRuntime(),runId:"run",stateId:"calm",state:materializeStateDefinition(flags.objectBindings.bindings,{shops:[],dialogues:[]},definition,definition.states[0])}};
  const npc=f.scene.tokens.get("npc"),pc=f.scene.tokens.get("pc");
  for(const token of [npc,pc]) Object.assign(token,{width:1,height:1,object:{checkCollision:()=>false},actor:{testUserPermission:user=>user.id === "player" || user.isGM}});
  return {...f,flags,binding,npc,pc,run:flags.groupRuntimes.main};
}
test("actions, variables and event/reaction scripts normalize independently of native type",()=>{
  const binding=normalizeObjectBinding({type:"Wall",id:"door",actions:[{id:"knock",name:"Knock"}],variables:[{name:"visits",type:"integer",value:0}],
    eventScripts:[{subscriptionId:"sub",script:{steps:[]}}],reactionScripts:[{actionId:"knock",script:{steps:[]}}]});
  assert.equal(binding.actions[0].enabled,false);assert.deepEqual(binding.signals.enabledIds,[]);
  assert.equal(binding.eventScripts.length,1);assert.equal(binding.reactionScripts.length,1);
  assert.throws(()=>normalizeObjectBinding({...binding,variables:[{name:"x",type:"integer",value:1.5}]}));
});
test("GM direct actions do not require selecting or impersonating a character",()=>{
  const f=fixture(),action={...f.binding.actions[0],actionId:"touch",target:descriptor};
  assert.equal(validateObjectActionAccess({scene:f.scene,runtime:f.run,descriptor:action,target:f.npc,conditionType:"action"},null,game.user,"run"),null);
  assert.throws(()=>validateObjectActionAccess({scene:f.scene,runtime:f.run,descriptor:action,target:f.npc,conditionType:"action"},null,{id:"player"},"run"));
});
test("unavailable actions are shown only when requested and GM-only actions never leak",()=>{
  const f=fixture(),player={id:"player"};
  f.binding.actions[0].enabled=false;f.binding.actions[0].showWhenUnavailable=true;
  assert.equal(listAvailableInteractions(f.scene,descriptor,f.pc,player)[0].disabled,true);
  f.binding.actions[0].audience="gm";
  assert.deepEqual(listAvailableInteractions(f.scene,descriptor,f.pc,player),[]);
});
test("action counters are namespaced by object and reset only for opted-in state entry",()=>{
  const f=fixture();f.binding.actions[0].conditions.resetOnEntry=true;
  const state=materializeStateDefinition({"Token:npc":f.binding},{shops:[],dialogues:[]},sampleGroupDefinition(),sampleGroupDefinition().states[0]);
  f.run.conditionCounts={"main:calm:action:Token:npc:touch":2,"main:calm:action:Tile:other:touch":5};
  resetStateConditions(f.run,state);
  assert.equal(f.run.conditionCounts["main:calm:action:Token:npc:touch"],undefined);
  assert.equal(f.run.conditionCounts["main:calm:action:Tile:other:touch"],5);
});
test("free menu condition reads values without world writes and rejects non-booleans",async()=>{
  const f=fixture(),before=f.writes(),args={target:descriptor,runtime:f.run,actorToken:f.pc,user:game.user};
  assert.equal(await evaluateInteractionMacro(f.scene,{...args,conditionMacro:'return await GetValue(objectUuid,"open") === 1;'}),true);
  assert.equal(f.writes(),before);
  await assert.rejects(evaluateInteractionMacro(f.scene,{...args,conditionMacro:'return "yes";'}),/true|false/);
  await assert.rejects(evaluateInteractionMacro(f.scene,{...args,conditionMacro:'return await SetValue(objectUuid,"open",2);'}),/SetValue/);
});
test("a pending condition loses admission immediately on a scene stop",async()=>{
  const f=fixture(); let release; globalThis.pendingCondition=new Promise(resolve=>release=resolve);
  const result=evaluateInteractionMacro(f.scene,{target:descriptor,runtime:f.run,current:()=>true,conditionMacro:'await globalThis.pendingCondition; return true;'});
  await new Promise(resolve=>setImmediate(resolve)); requestSceneHalt(f.scene);
  assert.equal(await result,false);release();delete globalThis.pendingCondition;
});
test("reaction script shares the ordinary interpreter and completes without creating documents",async()=>{
  const f=fixture();let now=0;
  const runtime=new GroupRuntime({now:()=>now,effects:{cleanupSpeech:async()=>{}}});
  const script=normalizeScript({name:"Reaction",steps:[{id:1,kind:"wait",parameters:{seconds:0.1},next:[]}]});
  const result=runtime.invocations.run(f.scene,{target:descriptor,script,purpose:"reaction"});
  for(let i=0;i<8 && runtime.manualRuns.size;i++){now+=150;await runtime.tick();}
  assert.deepEqual(await result,{});assert.equal(runtime.manualRuns.size,0);
  assert.equal(f.scene.tokens.size,2);
});
test("a stopped reaction cannot finish a late effect or retain ownership",async()=>{
  const f=fixture(),runtime=new GroupRuntime({effects:{cleanupSpeech:async()=>{}}});
  const script=normalizeScript({name:"Wait",steps:[{id:1,kind:"wait",parameters:{seconds:60},next:[]}]});
  const result=runtime.invocations.run(f.scene,{target:descriptor,script,purpose:"reaction"});
  assert.equal(runtime.manualRuns.size,1);requestSceneHalt(f.scene);notifyExecutionChange(f.scene,"halt-all");
  assert.deepEqual(await result,{});assert.equal(runtime.manualRuns.size,0);
});

test("a paused object's long reaction releases its delivery immediately when Premium expires",async()=>{
  const f=fixture(),runtime=new GroupRuntime({effects:{stop(){}}});
  let limits={scriptSteps:null}; runtime.automationLimits=()=>limits;
  const script=normalizeScript({steps:Array.from({length:17},(_,index)=>({id:index+1,kind:"wait",parameters:{seconds:60},next:[]}))});
  const result=runtime.invocations.run(f.scene,{target:descriptor,script,purpose:"reaction"});
  const rejected=assert.rejects(result,/16/); game.paused=true; limits={scriptSteps:16};
  notifyExecutionChange(f.scene,"premium-limits-changed"); await runtime.tick();
  let timer;
  try {await Promise.race([rejected,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Reaction stayed pending on pause")),500);})]);}
  finally {clearTimeout(timer);runtime.dispose();game.paused=false;}
  assert.equal(runtime.manualRuns.size,0); assert.equal(runtime.invocations.pending.size,0);
});
test("native types without shop/dialogue capabilities do not resolve old assignments",()=>{
  const binding=normalizeObjectBinding({type:"Wall",id:"wall",groupId:"main",dialogues:[{dialogueId:"talk",stateIds:[]}]});
  assert.deepEqual(resolveBindingTools(binding,{dialogues:[{id:"talk"}]},{groupId:"main",stateId:"calm"},"dialogue"),[]);
});

for (const purpose of ["event","reaction"]) test(`${purpose} resumes its manual policy with a fresh invocation lease and original input`,async()=>{
  const f=fixture();let now=0;
  const runtime=new GroupRuntime({now:()=>now,effects:{cleanupSpeech:async()=>{},stop(){}}});
  const script=normalizeScript({name:"Invoked",interruptions:{manual:"next-step"},steps:[
    {id:1,kind:"wait",parameters:{seconds:60},next:[2]}, {id:2,kind:"wait",parameters:{seconds:0.1},next:[]}
  ]});
  const signal={id:"signal",parameters:[],returns:[]},parameters={message:"retained"};
  const result=runtime.invocations.run(f.scene,{target:descriptor,script,purpose,signal,parameters});
  now+=100;await runtime.tick();
  const old=[...runtime.manualRuns.values()][0];
  assert.equal(old.scriptStates[scriptProgressKey(descriptor,script,purpose)].stepId,1);
  await runtime.haltAll(f.scene);assert.deepEqual(await result,{});
  await runtime.startAll(f.scene);
  const resumed=[...runtime.manualRuns.values()][0];
  assert.equal(resumed.purpose,purpose);assert.notEqual(resumed.runId,old.runId);
  assert.equal(resumed.parentRunId,f.scene.getFlag(MODULE_ID,"groupRuntimes").main.runId);
  assert.deepEqual(resumed.executionContext.parameters,parameters);assert.deepEqual(resumed.executionContext.signal,signal);
  assert.equal(resumed.scriptStates[scriptProgressKey(descriptor,script,purpose)].stepId,2);
  assert.equal(resumed.scriptStates[scriptProgressKey(descriptor,script,"initial")],undefined);
  await runtime.saveScriptState(f.scene,old);assert.equal(runtime.manualRuns.has(old.runId),false);
  for(let i=0;i<8 && runtime.manualRuns.size;i++){now+=150;await runtime.tick();}
  assert.equal(runtime.manualRuns.size,0);assert.equal(runtime.invocations.pending.size,0);
});

for (const invalidate of ["binding","object","group","behavior","parent"]) test(`invalid ${invalidate} releases a paused invocation without an eligible tick`,async()=>{
  const f=fixture(),runtime=new GroupRuntime({effects:{stop(){}}});
  const script=normalizeScript({steps:[{id:1,kind:"wait",parameters:{seconds:60},next:[]}]});
  const result=runtime.invocations.run(f.scene,{target:descriptor,script,purpose:"event"});
  const old=[...runtime.manualRuns.values()][0];game.paused=true;
  if(invalidate === "binding") delete f.flags.objectBindings.bindings["Token:npc"];
  if(invalidate === "object") f.scene.tokens.delete("npc");
  if(invalidate === "group") delete f.flags.groupDefinitions.main;
  if(invalidate === "behavior") f.flags.objectBehaviorState={"Token:npc":false};
  if(invalidate === "parent") f.flags.groupRuntimes.main.runId="replacement";
  await runtime.tick();assert.deepEqual(await result,{});
  assert.equal(runtime.manualRuns.size,0);assert.equal(runtime.invocations.pending.size,0);
  await runtime.saveScriptState(f.scene,old);assert.equal(runtime.manualRuns.size,0);
});

test("restoring an object revokes its active reaction instead of orphaning its awaiting delivery",async()=>{
  const f=fixture(),runtime=new GroupRuntime({effects:{stop(){}}});
  const script=normalizeScript({steps:[{id:1,kind:"wait",parameters:{seconds:60},next:[]}]});
  const result=runtime.invocations.run(f.scene,{target:descriptor,script,purpose:"reaction"});
  runtime.cancelObjectInitialRuns(f.scene,descriptor);
  assert.deepEqual(await result,{});assert.equal(runtime.invocations.pending.size,0);
});

test("disabled behavior denies both direct GM and player menu actions",()=>{
  const f=fixture(),action={...f.binding.actions[0],actionId:"touch",target:descriptor};
  f.flags.objectBehaviorState={"Token:npc":false};
  for(const [actor,user] of [[null,game.user],["pc",{id:"player"}]]) assert.throws(()=>validateObjectActionAccess({scene:f.scene,runtime:f.run,descriptor:action,target:f.npc,conditionType:"action"},actor,user,"run"));
  f.binding.actions[0].showWhenUnavailable=true;
  assert.deepEqual(listAvailableInteractions(f.scene,descriptor,f.pc,{id:"stranger"}),[]);
});

function serviceFixture() {
  const f=fixture(),runtime=new GroupRuntime({effects:{stop(){}}}),service=new ObjectInteractionService(runtime);
  f.binding.reactionScripts=[{actionId:"touch",script:normalizeScript({steps:[{id:1,kind:"wait",parameters:{seconds:60},next:[]}]})}];
  const packet={requestId:"request",kind:"action",sceneId:f.scene.id,target:descriptor,actionId:"touch"};
  return {...f,runtime,service,packet};
}

test("concurrent repeated action envelopes consume once and claim the interpreter before admitting another",async()=>{
  const f=serviceFixture();
  const results=await Promise.all([f.service.execute(f.packet,game.user),f.service.execute(f.packet,game.user)]);
  assert.deepEqual(results,[{ok:true},{ok:true}]);assert.equal(f.runtime.manualRuns.size,1);
  assert.equal(f.scene.getFlag(MODULE_ID,"groupRuntimes").main.conditionCounts["main:calm:action:Token:npc:touch"],1);
  await assert.rejects(f.service.execute({...f.packet,requestId:"other"},game.user));
  await assert.rejects(f.service.execute({...f.packet,actionId:"other"},game.user));
  f.service.dispose();await Promise.resolve();
});

test("stop during action-counter persistence cannot launch a late reaction",async()=>{
  const f=serviceFixture(),save=f.scene.setFlag.bind(f.scene);let release,started;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  f.scene.setFlag=async(...args)=>{started();await gate;return save(...args);};
  const result=f.service.execute(f.packet,game.user);
  await waiting;requestSceneHalt(f.scene);release();
  await assert.rejects(result);assert.equal(f.runtime.manualRuns.size,0);f.service.dispose();
});
