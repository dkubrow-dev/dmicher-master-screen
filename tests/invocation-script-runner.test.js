import test from "node:test";
import assert from "node:assert/strict";
import { InvocationScriptRunner } from "../dmicher-master-screen/scripts/invocation-script-runner.js";

test("disabled subscriptions finish without a clock, and accepted input is isolated from its caller", async () => {
  const runner=new InvocationScriptRunner(); runner.startClock=()=>{};
  const host={id:"world"}, owner={type:"Spotlight",id:"requests"};
  await runner.run({host,owner,scope:"world",script:{enabled:false,steps:[{id:1,kind:"wait",parameters:{seconds:1}}]}});
  assert.equal(runner.runs.size,0);
  const context={parameters:{value:"accepted"}};
  const pending=runner.run({host,owner,scope:"world",context,script:{steps:[{id:1,kind:"wait",parameters:{seconds:1}}]}});
  const invocation=[...runner.runs.values()][0]; context.parameters.value="mutated";
  const input=runner.variableContext(host,invocation.object,()=>true,{});
  assert.equal(input.parameters.value,"accepted"); input.parameters.value="macro-mutated";
  assert.equal(runner.variableContext(host,invocation.object,()=>true,{}).parameters.value,"accepted");
  runner.cancel(); await pending; runner.dispose();
});

test("world subscription uses the shared wait interpreter without a canvas", async () => {
  globalThis.game={paused:false}; globalThis.canvas=null;
  let now=1000;
  const runner=new InvocationScriptRunner({now:()=>now});
  runner.startClock=()=>{};
  let done=false;
  const pending=runner.run({host:{id:"world"},owner:{type:"Spotlight",id:"requests"},scope:"world",
    script:{name:"world wait",steps:[{id:1,kind:"wait",parameters:{seconds:1}}]}}).then(()=>done=true);
  await runner.tick(); now+=500; await runner.tick(); assert.equal(done,false);
  now+=600; await runner.tick(); await runner.tick(); await pending;
  assert.equal(done,true); assert.equal(runner.runs.size,0); runner.dispose();
});
test("cancellation releases a world wait and disallows scene-only functions", async () => {
  globalThis.game={paused:false};
  const runner=new InvocationScriptRunner(); runner.startClock=()=>{};
  const host={id:"world"};
  const pending=runner.run({host,owner:{type:"Spotlight",id:"requests"},scope:"world",
    script:{steps:[{id:1,kind:"wait",parameters:{seconds:60}}]}});
  await runner.tick(); runner.cancel(host); await pending;
  await assert.rejects(runner.run({host,owner:{type:"Spotlight",id:"requests"},scope:"world",
    script:{steps:[{id:1,kind:"move",parameters:{duration:1}}]}}));
  runner.dispose();
});
