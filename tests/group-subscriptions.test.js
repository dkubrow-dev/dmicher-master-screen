import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { ObjectInvocations } from "../dmicher-master-screen/scripts/object-invocations.js";
import { normalizeGroupScript } from "../dmicher-master-screen/scripts/group-subscriptions.js";
import { requestHalt } from "../dmicher-master-screen/scripts/execution.js";

test("group subscriptions accept system functions but reject object motion", async () => {
  assert.throws(()=>normalizeGroupScript({steps:[{id:1,kind:"move",parameters:{duration:1}}]}));
  const f=fixture(), signal=await f.catalog.saveSignal({emitterKey:"Group:main",name:"start"});
  const subscription=await f.catalog.saveSubscription({ownerKey:"Group:main",emitterKey:signal.emitterKey,signalId:signal.id,handler:"script",
    script:{steps:[{id:1,kind:"wait",parameters:{seconds:0.1}}]}});
  assert.equal(f.catalog.list().subscriptions.find(entry=>entry.id===subscription.id).script.steps[0].kind,"wait");
});
test("a group event executes a shared wait and releases immediately on group stop", async () => {
  const f=fixture(), invocations=new ObjectInvocations({effects:{},canUsePremiumStep:()=>false,report:assert.fail});
  f.bus.runObjectEvent=(scene,context)=>invocations.event(scene,context);
  const signal=await f.catalog.saveSignal({emitterKey:"Group:main",name:"long"});
  await f.catalog.saveSubscription({ownerKey:"Group:main",emitterKey:signal.emitterKey,signalId:signal.id,handler:"script",
    script:{steps:[{id:1,kind:"wait",parameters:{seconds:60}}]}});
  const result=f.bus.emit(f.scene,{emitterKey:signal.emitterKey,signalId:signal.id,parameters:{}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(invocations.groups.runs.size,1);
  requestHalt(f.scene,"main"); await result;
  assert.equal(invocations.groups.runs.size,0); invocations.groups.dispose(); f.bus.dispose();
});

test("one group can attach multiple scripts to a signal, and referenced script assets cannot be removed", async () => {
  const f=fixture(), incoming=await f.catalog.saveSignal({emitterKey:"Group:main",name:"incoming"});
  const outgoing=await f.catalog.saveSignal({emitterKey:"Group:main",name:"outgoing"});
  for (let i=0;i<2;i++) await f.catalog.saveSubscription({ownerKey:"Group:main",emitterKey:incoming.emitterKey,signalId:incoming.id,handler:"script",
    script:{steps:[{id:1,kind:"signal",parameters:{signalId:outgoing.id,parameters:{}}}]}});
  assert.equal(f.catalog.list().subscriptions.length,2);
  await assert.rejects(f.catalog.removeSignal(outgoing.id));
  f.bus.dispose();
});

test("an immediate signal cycle visits each subscription once and finishes", async () => {
  const f=fixture(), a=await f.catalog.saveSignal({emitterKey:"Group:main",name:"a"}), b=await f.catalog.saveSignal({emitterKey:"Group:main",name:"b"});
  const calls=[];
  await f.subscribe(a,"Group:main",async context=>{calls.push("a");await context.emit("b");});
  await f.subscribe(b,"Group:main",async context=>{calls.push("b");await context.emit("a");});
  await f.bus.emit(f.scene,{emitterKey:a.emitterKey,signalId:a.id,parameters:{}});
  assert.deepEqual(calls,["a","b"]); f.bus.dispose();
});
