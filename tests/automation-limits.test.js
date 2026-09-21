import test from "node:test";
import assert from "node:assert/strict";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { getAutomationLimits, getScriptLimitIssue, getCollectionLimitIssue, collectionEntryAllowed, assertCollectionGrowth } from "../dmicher-master-screen/scripts/automation-limits.js";

const free = {scriptSteps:16, subscriptions:8, actions:4, chainHandlers:8};
const unlimited = Object.fromEntries(Object.keys(free).map(key=>[key,null]));
test("free limits count every saved row without modifying preparation", () => {
  const script = {steps:Array.from({length:17},(_,id)=>({id,enabled:false}))}, before=structuredClone(script);
  assert.deepEqual(getAutomationLimits(),free);
  assert.equal(getScriptLimitIssue({steps:script.steps.slice(0,16)}),null);
  assert.ok(getScriptLimitIssue(script)); assert.deepEqual(script,before);
  const rows=script.steps.slice(0,9);
  assert.equal(collectionEntryAllowed("subscriptions",rows,rows[7]),true);
  assert.equal(collectionEntryAllowed("subscriptions",rows,rows[8]),false);
  assert.equal(collectionEntryAllowed("actions",rows,{id:3}),true);
  assert.equal(collectionEntryAllowed("actions",rows,{id:4}),false);
  assert.equal(collectionEntryAllowed("actions",rows,{id:99}),false);
  assert.equal(getCollectionLimitIssue("actions",4),null);
  assert.ok(getCollectionLimitIssue("actions",5));
  assert.throws(()=>assertCollectionGrowth("subscriptions",8,9));
  assert.doesNotThrow(()=>assertCollectionGrowth("subscriptions",10,9));
  assert.doesNotThrow(()=>assertCollectionGrowth("subscriptions",9,9));
});
test("a compatible active override unlocks counts only for its licensed module", () => {
  let active=false;
  const provider=generics.premium.registerProvider({apiVersion:1,hasAccess:()=>active,extensions:[{
    moduleId:"dmicher-master-screen",apiVersion:1,methods:{resolveAutomationLimits:()=>unlimited}
  }]});
  try {
    assert.deepEqual(getAutomationLimits(),free); active=true; provider.notifyChanged();
    assert.deepEqual(getAutomationLimits(),unlimited);
    assert.equal(getScriptLimitIssue({steps:Array(201).fill({})}),null);
    assert.doesNotThrow(()=>assertCollectionGrowth("actions",100,101));
    active=false; provider.notifyChanged(); assert.ok(getScriptLimitIssue({steps:Array(17).fill({})}));
    assert.equal(getScriptLimitIssue({steps:Array(17).fill({})},unlimited),null);
  } finally {provider.dispose();}
});
