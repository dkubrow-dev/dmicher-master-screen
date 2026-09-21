import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { mergeCatalogDependencies, normalizeCatalog } from "../dmicher-master-screen/scripts/signal-catalog.js";
import { sceneFixture, descriptor } from "./fixtures/scene.js";
import { MODULE_ID, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { normalizeObjectBinding } from "../dmicher-master-screen/scripts/object-binding-model.js";
import { listAvailableInteractions, validateObjectActionAccess } from "../dmicher-master-screen/scripts/interaction-access.js";
import { potentialInteractiveDocuments } from "../dmicher-master-screen/scripts/interactive-object-projection.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { ObjectInteractionService } from "../dmicher-master-screen/scripts/object-interaction-service.js";

const row = (signal, index, ownerKey = "Group:main") => ({ id: `sub-${index}`, ownerKey, emitterKey: signal.emitterKey,
  signalId: signal.id, handler: "script", enabled: true, script: { steps: [] } });
const grant = () => generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => true, extensions: [{ moduleId: MODULE_ID,
  apiVersion: 1, methods: { resolveAutomationLimits: () => ({ scriptSteps: null, subscriptions: null, actions: null, chainHandlers: null }) } }] });
function otherGroup(f) {
  f.data.groupDefinitions.other={...structuredClone(f.definition),groupId:"other"};
  f.data.groupRuntimes.other={...structuredClone(f.data.groupRuntimes.main),groupId:"other",runId:"other-run"};
}

test("subscription save counts disabled and self rows per owner and preserves edited positions", async () => {
  const f = fixture({premiumMacros:false}), signal = f.catalog.list().signals.find(entry => entry.emitterKey === "Group:main");
  for (let index = 0; index < 8; index++) await f.catalog.saveSubscription({ ...row(signal,index), enabled: false });
  const before = f.writes();
  await assert.rejects(f.catalog.saveSubscription(row(signal,8)), /8/);
  assert.equal(f.writes(),before);
  await f.catalog.saveSubscription({ ...row(signal,0), enabled: true });
  assert.equal(f.catalog.list().subscriptions[0].id,"sub-0");
  await f.catalog.saveSubscription(row(signal,9,"Token:other"));
  assert.equal(f.catalog.list().subscriptions.length,9);
});

test("imported subscriptions above eight remain intact and editable but cannot grow without Premium", async () => {
  const f = fixture({premiumMacros:false}), signal = f.catalog.list().signals.find(entry => entry.emitterKey === "Group:main");
  f.data.signalCatalog = mergeCatalogDependencies(f.scene, { subscriptions: Array.from({length:10},(_,index)=>row(signal,index)) });
  assert.equal(f.catalog.list().subscriptions.length,10);
  const selected = f.catalog.list().subscriptions[0];
  await f.catalog.saveSubscription({...selected,enabled:false});
  await assert.rejects(f.catalog.saveSubscription(row(signal,11)),/8/);
  await f.catalog.removeSubscription(f.catalog.list().subscriptions.at(-1).id);
  assert.equal(f.catalog.list().subscriptions.length,9);
  const premium = grant();
  try { await f.catalog.saveSubscription(row(signal,12)); assert.equal(f.catalog.list().subscriptions.length,10); }
  finally { premium.dispose(); }
  assert.equal(f.catalog.list().subscriptions.length,10);
});

test("scene delivery uses saved owner order and a shared eight-handler fan-out budget", async () => {
  const f = fixture({premiumMacros:false}), signal = await f.catalog.saveSignal({emitterKey:"Token:npc",name:"Fanout"});
  otherGroup(f);
  f.data.objectBindings.bindings["Token:npc"]={signals:{enabled:true,enabledIds:[signal.id]}};
  f.data.signalCatalog.subscriptions = Array.from({length:10},(_,index)=>row(signal,index));
  f.data.signalCatalog.subscriptions[0].enabled=false;
  f.data.signalCatalog.subscriptions.push(...Array.from({length:3},(_,index)=>row(signal,index+10,"Group:other")));
  const calls=[];
  f.bus.runObjectEvent=async (_scene,{subscription})=>{calls.push(subscription.id);return {};};
  const input={emitterKey:signal.emitterKey,signalId:signal.id};
  await f.bus.emit(f.scene,input);
  assert.deepEqual(calls,["sub-1","sub-2","sub-3","sub-4","sub-5","sub-6","sub-7","sub-10"]);
  const before=structuredClone(f.data.signalCatalog);
  const premium=grant();
  try {calls.length=0;await f.bus.emit(f.scene,input);assert.equal(calls.length,12);} finally {premium.dispose();}
  assert.deepEqual(f.data.signalCatalog,before);
});

test("nested scene emissions share the handler budget instead of granting eight to each event", async () => {
  const f=fixture({premiumMacros:false});otherGroup(f);
  const first=await f.catalog.saveSignal({emitterKey:"Group:main",name:"First"}),second=await f.catalog.saveSignal({emitterKey:"Group:other",name:"Second"});
  f.data.signalCatalog.subscriptions=[...Array.from({length:6},(_,index)=>row(first,index,"Group:other")),...Array.from({length:6},(_,index)=>row(second,index+6,"Group:main"))];
  const calls=[];
  f.bus.runObjectEvent=async (_scene,{subscription,context})=>{calls.push(subscription.id);if(subscription.id === "sub-0") await context.emit("Second");return {};};
  await f.bus.emit(f.scene,{emitterKey:first.emitterKey,signalId:first.id});
  assert.equal(calls.length,8);assert.equal(calls.includes("sub-2"),false);
});

test("direct subscription macros require Premium at dispatch and after asynchronous resolution", async () => {
  const f=fixture({premiumMacros:false}),signal=await f.catalog.saveSignal({emitterKey:"Token:npc",name:"Macro"});
  let calls=0;
  await f.subscribe(signal,"Token:other",()=>{calls++;});
  const input={emitterKey:signal.emitterKey,signalId:signal.id};
  assert.equal((await f.bus.emit(f.scene,input)).results.length,0);assert.equal(calls,0);
  const premium=generics.premium.registerProvider({apiVersion:1,hasAccess:()=>true,extensions:[{moduleId:MODULE_ID,apiVersion:1,methods:{
    canExecuteScriptKind:()=>true,resolveInteractivePresentation:()=>true,resolveShopRestoration:()=>true,resolvePlayerActionLock:()=>true
  }}]});
  await f.bus.emit(f.scene,input);assert.equal(calls,1);
  let release,begin;
  const ready=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
  f.bus.resolveMacro=async uuid=>{begin();await gate;return f.macros.get(uuid);};
  const pending=f.bus.emit(f.scene,input);
  await ready;premium.dispose();release();
  assert.equal((await pending).status,"stale");assert.equal(calls,1);
});

test("downgrade while an excess subscription waits prevents its late continuation", async () => {
  const f=fixture({premiumMacros:false}),signal=await f.catalog.saveSignal({emitterKey:"Group:main",name:"Wait"});
  f.data.signalCatalog.subscriptions=Array.from({length:9},(_,index)=>({...row(signal,index),enabled:index===8}));
  const premium=grant();
  let release,begin,lateAllowed;
  const ready=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
  f.bus.runObjectEvent=async (_scene,{current})=>{begin();await gate;lateAllowed=current();return {};};
  const pending=f.bus.emit(f.scene,{emitterKey:signal.emitterKey,signalId:signal.id});
  await ready;premium.dispose();release();
  assert.equal((await pending).status,"stale");assert.equal(lateAllowed,false);
  assert.equal(f.data.signalCatalog.subscriptions.length,9);
});

function actionFixture(count=5) {
  const f=sceneFixture(),flags=f.scene.flags[MODULE_ID],definition=sampleGroupDefinition();
  flags.groupDefinitions={main:definition};
  const binding=normalizeObjectBinding({...descriptor,groupId:"main",actions:Array.from({length:count},(_,index)=>({id:`action-${index}`,name:`Action ${index}`,enabled:index>=3,audience:"all",order:count-index}))});
  flags.objectBindings={schemaVersion:1,revision:1,bindings:{"Token:npc":binding}};
  flags.groupRuntimes={main:{...emptyRuntime(),groupId:"main",runId:"run",stateId:"calm",state:definition.states[0]}};
  return {...f,flags,binding,run:flags.groupRuntimes.main};
}

test("actions count all saved rows, show a quota reason when requested and never highlight excess alone", () => {
  const f=actionFixture();
  assert.deepEqual(listAvailableInteractions(f.scene,descriptor,null,game.user).map(entry=>entry.id),["action-3"]);
  f.binding.actions[4].showWhenUnavailable=true;
  const excess=listAvailableInteractions(f.scene,descriptor,null,game.user).find(entry=>entry.id === "action-4");
  assert.equal(excess.disabled,true);assert.match(excess.reason,/4/);
  assert.throws(()=>validateObjectActionAccess({scene:f.scene,runtime:f.run,descriptor:{...f.binding.actions[4],actionId:"action-4",target:descriptor},target:f.scene.tokens.get("npc")},null,game.user,"run"),/4/);
  f.binding.actions[3].enabled=false;
  assert.deepEqual(potentialInteractiveDocuments(f.scene,game.user),[]);
  const premium=grant();
  try { assert.equal(listAvailableInteractions(f.scene,descriptor,null,game.user).some(entry=>entry.id === "action-4" && !entry.disabled),true); }
  finally { premium.dispose(); }
});

test("object API allows four actions and edits/reductions of imported excess but rejects growth", async () => {
  const f=actionFixture(4);
  await f.objects.save(descriptor,{actions:f.binding.actions});
  const fifth={...f.binding.actions[3],id:"fifth"};
  await assert.rejects(f.objects.save(descriptor,{actions:[...f.binding.actions,fifth]}),/4/);
  f.flags.objectBindings.bindings["Token:npc"].actions.push(fifth);
  await f.objects.save(descriptor,{notes:"Retain imported actions"});
  assert.equal(f.objects.get(descriptor).actions.length,5);
  await f.objects.save(descriptor,{actions:f.objects.get(descriptor).actions.slice(0,4)});
  assert.equal(f.objects.get(descriptor).actions.length,4);
});

test("custom action service rejects forged excess requests and revocation during persistence", async () => {
  const f=actionFixture(),launched=[];
  const runtime={manualRuns:new Map(),invocations:{run:async (_scene,args)=>{launched.push(args);},reconcile(){}},report:error=>assert.fail(error.message)};
  const service=new ObjectInteractionService(runtime),packet={kind:"action",requestId:"forged",sceneId:f.scene.id,target:descriptor,actionId:"action-4"};
  await assert.rejects(service.execute(packet,game.user));assert.equal(launched.length,0);
  const premium=grant(),save=f.scene.setFlag.bind(f.scene);let release,begin;
  const ready=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>release=resolve);
  f.scene.setFlag=async (...args)=>{begin();await gate;return save(...args);};
  const pending=service.execute({...packet,requestId:"admitted"},game.user);
  await ready;premium.dispose();release();
  await assert.rejects(pending);assert.equal(launched.length,0);service.dispose();
});

test("custom action continuation loses its admission when Premium expires", async () => {
  const f=actionFixture(),launched=[];
  const runtime={manualRuns:new Map(),invocations:{run:async (_scene,args)=>{launched.push(args);},reconcile(){}},report:error=>assert.fail(error.message)};
  const service=new ObjectInteractionService(runtime),premium=grant();
  try {
    await service.execute({kind:"action",requestId:"admitted",sceneId:f.scene.id,target:descriptor,actionId:"action-4"},game.user);
    assert.equal(launched[0].current(),true);premium.dispose();assert.equal(launched[0].current(),false);
    assert.equal(f.flags.objectBindings.bindings["Token:npc"].actions.length,5);
  } finally {premium.dispose();service.dispose();}
});

test("authoring normalization preserves collections beyond former arbitrary preparation caps", () => {
  const signal={id:"source",emitterKey:"Group:main"};
  assert.equal(normalizeCatalog({subscriptions:Array.from({length:2001},(_,index)=>row(signal,index))}).subscriptions.length,2001);
  const f=actionFixture(101);
  assert.equal(f.binding.actions.length,101);
  assert.equal(normalizeObjectBinding({...f.binding,reactionScripts:f.binding.actions.map(action=>({actionId:action.id,script:{steps:[]}}))}).reactionScripts.length,101);
});
