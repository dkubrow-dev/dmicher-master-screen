import test from "node:test";
import assert from "node:assert/strict";
import {ShopRestoration} from "../dmicher-master-screen/scripts/shop-restoration.js";
import {GroupRuntime} from "../dmicher-master-screen/scripts/runtime.js";
import {MODULE_ID,emptyRuntime} from "../dmicher-master-screen/scripts/model.js";
import {normalizeObjectBinding} from "../dmicher-master-screen/scripts/object-binding-model.js";
import {normalizeShopAsset} from "../dmicher-master-screen/scripts/interaction-model.js";
import {requestSceneHalt} from "../dmicher-master-screen/scripts/execution.js";
import {getRuntime,saveRuntime,withSceneLock} from "../dmicher-master-screen/scripts/store.js";
import {validateInteractionIdentity} from "../dmicher-master-screen/scripts/interaction-access.js";
import {normalizeScript} from "../dmicher-master-screen/scripts/script-model.js";
import {resetShopInventory} from "../dmicher-master-screen/scripts/shop-inventory.js";
import {isStateEntryPreparing} from "../dmicher-master-screen/scripts/state-entry-preparation.js";
import {sceneFixture,shopData} from "./fixtures/scene.js";
import {sampleGroupDefinition} from "./fixtures/definitions.js";

function fixture(activation="state-entry") {
  const f=sceneFixture(),flags=f.scene.flags[MODULE_ID],definition=sampleGroupDefinition();
  f.scene.active=false;
  flags.groupDefinitions={main:definition};
  flags.groupRuntimes={main:{...emptyRuntime(),runId:"run",stateId:"calm",state:structuredClone(definition.states[0])}};
  flags.interactionCatalog={schemaVersion:1,revision:1,shops:[normalizeShopAsset({...shopData(),id:"shared"})],dialogues:[]};
  const binding=normalizeObjectBinding({type:"Token",id:"npc",groupId:"main",variables:[{name:"visits",type:"integer",value:2}],
    shops:[{shopId:"shared",stateIds:["calm"],conditions:{repeat:"always"}}]});
  binding.shops[0].restoration={activation,conditionMacro:""};
  flags.objectBindings={schemaVersion:1,revision:1,bindings:{"Token:npc":binding}};
  const resets=[],errors=[],callbacks=new Map();let licensed=true,serial=0,accessChanged;
  const hooks={on(name,fn){const id=++serial;callbacks.set(id,{name,fn});return id;},off(_name,id){callbacks.delete(id);}};
  const service=new ShopRestoration({available:()=>licensed,subscribeAccess:fn=>{accessChanged=fn;return()=>{accessChanged=null;};},
    reset:async(scene,shopId,{isCurrent})=>{if(!isCurrent())return {stale:true};resets.push({scene,shopId});return {items:[],revision:1};},
    onError:error=>errors.push(error)});
  const enter=()=>service.stateEntered(f.scene,flags.groupRuntimes.main);
  const change=async active=>{f.scene.active=active;return service.sceneUpdated(f.scene,{active});};
  return {...f,flags,binding,service,resets,errors,hooks,callbacks,enter,change,license(value){licensed=value;accessChanged?.();}};
}

test("automatic shop restoration is premium; saved manual rules never execute automatically",async()=>{
  const f=fixture();f.license(false);const before=f.writes();
  assert.deepEqual(await f.enter(),[]);assert.equal(f.resets.length,0);assert.equal(f.writes(),before);
  assert.equal(f.binding.shops[0].restoration.activation,"state-entry");
  f.license(true);f.binding.shops[0].restoration.activation="manual";
  assert.deepEqual(await f.enter(),[]);assert.equal(f.resets.length,0);f.service.dispose();
});

test("shared shop resets once per entry when any eligible binding condition allows it",async()=>{
  const f=fixture(),second=structuredClone(f.binding);
  f.binding.shops[0].restoration.conditionMacro="return false;";
  second.id="pc";second.shops[0].restoration.conditionMacro='return stateId === "calm" && await GetValue(objectUuid,"visits") === 2;';
  f.flags.objectBindings.bindings["Token:pc"]=second;
  const before=f.writes();
  const [first,repeated]=await Promise.all([f.enter(),f.enter()]);
  assert.deepEqual(first,["shared"]);assert.deepEqual(repeated,["shared"]);assert.equal(f.resets.length,1);assert.equal(f.writes(),before);
  f.flags.groupRuntimes.main.runId="new-entry";assert.deepEqual(await f.enter(),["shared"]);assert.equal(f.resets.length,2);
  assert.deepEqual(f.errors,[]);f.service.dispose();
});

test("state entry observes assignment states independently of player admission, distance, quota or tags",async()=>{
  const f=fixture();f.binding.shops[0].conditions={enabled:false,groupIds:["closed"],stateIds:["other"],allowTags:["customer"],repeat:"count",limit:1};
  f.flags.groupRuntimes.main.conditionCounts.any=100;f.scene.tokens.get("pc").x=100000;
  assert.deepEqual(await f.enter(),["shared"]);
  f.flags.groupRuntimes.main.runId="other-entry";f.flags.groupRuntimes.main.stateId="tension";
  assert.deepEqual(await f.enter(),[]);assert.equal(f.resets.length,1);f.service.dispose();
});

for (const storage of ["group","object"]) test(`manual ${storage} behavior disable excludes restoration but another shared-shop owner may allow it`,async()=>{
  const f=fixture();
  if(storage === "group")f.flags.groupRuntimes.main.disabledObjects=["Token:npc"];
  else f.flags.objectBehaviorState={"Token:npc":false};
  assert.deepEqual(await f.enter(),[]);assert.equal(f.resets.length,0);
  const second=structuredClone(f.binding);second.id="pc";f.flags.objectBindings.bindings["Token:pc"]=second;
  f.flags.groupRuntimes.main.runId="next-entry";
  assert.deepEqual(await f.enter(),["shared"]);assert.equal(f.resets.length,1);f.service.dispose();
});

test("disabling a pending rule cancels its condition immediately and considers another enabled owner of the shared shop",async()=>{
  const f=fixture();let started,release;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  const second=structuredClone(f.binding);second.id="pc";f.flags.objectBindings.bindings["Token:pc"]=second;
  f.service.evaluate=async(_scene,{target,current})=>{if(target.id === "npc"){started();await gate;return current();}return true;};
  f.service.install(f.hooks);const result=f.enter();await waiting;
  f.flags.objectBehaviorState={"Token:npc":false};await f.service.sceneUpdated(f.scene,{flags:{[MODULE_ID]:{objectBehaviorState:f.flags.objectBehaviorState}}});
  assert.deepEqual(await result,["shared"]);assert.equal(f.resets.length,1);
  release();await Promise.resolve();assert.equal(f.resets.length,1);f.service.dispose();
});

test("disabling behavior while inventory reset waits for storage invalidates its final guard",async()=>{
  const f=fixture();let started,release;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  f.service.reset=async(_scene,_shop,{isCurrent})=>{started();await gate;if(isCurrent())f.resets.push("unexpected");return {stale:!isCurrent()};};
  const result=f.enter();await waiting;f.flags.groupRuntimes.main.disabledObjects=["Token:npc"];
  f.service.reconcile(f.scene);assert.deepEqual(await result,[]);release();await Promise.resolve();
  assert.deepEqual(f.resets,[]);f.service.dispose();
});

test("native scene restoration only observes false to true; install, view and duplicate active updates do not reset",async()=>{
  const f=fixture("scene-activation");f.scene.active=true;f.service.install(f.hooks);
  assert.equal(f.resets.length,0);assert.deepEqual(await f.change(true),[]);
  assert.deepEqual(await f.service.sceneUpdated(f.scene,{viewed:true}),[]);
  await f.change(false);assert.deepEqual(await f.change(true),["shared"]);assert.equal(f.resets.length,1);
  assert.deepEqual(await f.change(true),[]);assert.equal(f.resets.length,1);
  await f.change(false);await f.change(true);assert.equal(f.resets.length,2);
  f.service.dispose();assert.equal(f.callbacks.size,0);
});

test("scene activation can evaluate readonly conditions before the first group run and while automation is stopped",async()=>{
  const f=fixture("scene-activation");f.flags.groupRuntimes={};f.flags.automationHalted=true;
  f.binding.shops[0].restoration.conditionMacro='return stateId === "calm" && await GetValue(objectUuid,"visits") === 2;';
  f.service.install(f.hooks);assert.deepEqual(await f.change(true),["shared"]);assert.equal(f.resets.length,1);
  assert.equal(f.flags.automationHalted,true);assert.deepEqual(f.flags.groupRuntimes,{});f.service.dispose();
});

for (const invalidate of ["stop","license","preparation","catalog","state","deleted-object","object-disable","group-disable"]) test(`pending restoration cannot reset inventory after ${invalidate}`,async()=>{
  const f=fixture();let started,release;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  f.service.evaluate=async(_scene,options)=>{started();await gate;return options.current();};
  f.service.install(f.hooks);const result=f.enter();await waiting;
  if(invalidate === "stop")requestSceneHalt(f.scene);
  if(invalidate === "license")f.license(false);
  if(invalidate === "preparation")f.flags.objectBindings.revision++;
  if(invalidate === "catalog")f.flags.interactionCatalog.revision++;
  if(invalidate === "state")f.flags.groupRuntimes.main.runId="new-run";
  if(invalidate === "deleted-object")f.scene.tokens.delete("npc");
  if(invalidate === "object-disable")f.flags.objectBehaviorState={"Token:npc":false};
  if(invalidate === "group-disable")f.flags.groupRuntimes.main.disabledObjects=["Token:npc"];
  f.service.reconcile(f.scene);assert.deepEqual(await result,[]);assert.equal(f.resets.length,0);
  release();await Promise.resolve();assert.equal(f.resets.length,0);f.service.dispose();
});

test("storage receives a live guard, rechecking licence while its scene lock is queued",async()=>{
  const f=fixture();let started,release;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  f.service.reset=async(_scene,_shop,{isCurrent})=>{started();await gate;if(isCurrent())f.resets.push("unexpected");return {stale:!isCurrent()};};
  const result=f.enter();await waiting;f.license(false);release();
  assert.deepEqual(await result,[]);assert.deepEqual(f.resets,[]);f.service.dispose();
});

test("disposing restoration aborts a real pending condition without leaving an inner execution lease",async()=>{
  const f=fixture();let release;globalThis.pendingRestorationCondition=new Promise(resolve=>release=resolve);
  f.binding.shops[0].restoration.conditionMacro="await globalThis.pendingRestorationCondition; return true;";
  const result=f.enter();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.service.scopes.size,1);
  f.service.dispose();assert.deepEqual(await result,[]);assert.equal(f.service.scopes.size,0);
  release();delete globalThis.pendingRestorationCondition;assert.deepEqual(f.resets,[]);
});

test("runtime invokes restoration outside the scene lock on new entry, never on Continue or unchanged state",async()=>{
  const f=fixture(),runtime=new GroupRuntime({effects:{stop(){}}});let calls=0;
  runtime.shopRestoration={async stateEntered(scene,run,{current}){assert.equal(current(),true);calls++;await withSceneLock(scene,()=>scene.setFlag(MODULE_ID,"entryRestored",run.runId));}};
  await runtime.enter(f.scene,"calm",{force:true,restart:true});assert.equal(calls,1);
  await runtime.enter(f.scene,"calm");assert.equal(calls,1);
  await runtime.haltAll(f.scene);await runtime.startAll(f.scene);assert.equal(calls,1);
  await runtime.enter(f.scene,"calm",{force:true,restart:true});assert.equal(calls,2);
  f.service.dispose();runtime.dispose();
});

test("new entry holds routine and player shop admission until restoration completes, without holding the scene lock",async()=>{
  const f=fixture(),runtime=new GroupRuntime({effects:{stop(){}}});let started,release;
  const waiting=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  f.binding.scripts=[{stateId:"calm",...normalizeScript({steps:[{id:1,kind:"wait",parameters:{seconds:60},next:[]}]})}];
  f.scene.tokens.get("pc").actor={testUserPermission:()=>true};
  f.service.evaluate=async()=>{started();await gate;return true;};runtime.shopRestoration=f.service;
  const entering=runtime.enter(f.scene,"calm",{force:true,restart:true});await waiting;
  const run=getRuntime(f.scene),target={type:"Token",id:"npc"};
  assert.equal(isStateEntryPreparing(f.scene,run),true);
  await runtime.tick();assert.deepEqual(getRuntime(f.scene).scriptStates,{});
  assert.throws(()=>validateInteractionIdentity({scene:f.scene,runtime:run,descriptor:{target},target:f.scene.tokens.get("npc")},"pc",game.user,run.runId));
  release();await entering;assert.equal(isStateEntryPreparing(f.scene,getRuntime(f.scene)),false);
  assert.equal(runtime.currentObject(f.scene,run.runId,target),true);await runtime.tick();assert.equal(Object.keys(getRuntime(f.scene).scriptStates).length,1);
  f.service.dispose();runtime.dispose();
});

test("resetting inventory releases a shop-waiting script and preserves completed trade receipts",async()=>{
  const f=fixture(),runtime=new GroupRuntime({effects:{stop(){}}});
  f.binding.scripts=[{stateId:"calm",...normalizeScript({steps:[
    {id:1,kind:"shop",parameters:{shopId:"shared",tokenUuid:`${f.scene.uuid}.Token.pc`,wait:true},next:[2]},
    {id:2,kind:"wait",parameters:{seconds:60},next:[]}
  ]})}];
  const reference={shopId:"shared",sessionId:"session",userId:"gm",actorTokenId:"pc"};
  runtime.startScriptShop=async command=>{
    await withSceneLock(f.scene,async()=>{
      const run=getRuntime(f.scene);run.shopSessions.shared={...reference,origin:"script",runId:command.runId,target:{type:"Token",id:"npc"},status:"editing",expiresAt:Date.now()+60000};
      run.tradeRequests.done={status:"done",intent:{shopId:"shared"}};await saveRuntime(f.scene,run);
    });return reference;
  };
  await runtime.enter(f.scene,"calm",{force:true,restart:true});await runtime.tick();await runtime.tick();
  const progress=()=>Object.values(getRuntime(f.scene).scriptStates)[0];
  assert.equal(progress().stepId,1);assert.equal(progress().action.phase,"shop");
  await resetShopInventory(f.scene,"shared");await runtime.tick();
  assert.equal(progress().stepId,2);assert.equal(getRuntime(f.scene).shopSessions.shared,undefined);
  assert.equal(getRuntime(f.scene).tradeRequests.done.status,"done");f.service.dispose();runtime.dispose();
});
