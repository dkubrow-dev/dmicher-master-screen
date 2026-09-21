import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
import { defaultObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";
import { SceneSignals } from "../dmicher-master-screen/scripts/signals.js";
import { ObjectCommandCore } from "../dmicher-master-screen/scripts/object-command-core.js";
import { SCENE_OBJECT_COLLECTIONS } from "../dmicher-master-screen/scripts/scene-object-types.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";

async function setup(type = "Wall", groupId = null, commandId = "open") {
  const f = await commandFixture({ commands: ["delegate"] });
  const target = { id: "target", uuid: `Scene.scene.${type}.target`, documentName: type, parent: f.scene,
    x: 200, y: 0, width: 100, height: 100, c: [200, 0, 200, 100], door: 1, ds: 0,
    shape: { width: 100, height: 100 }, shapes: [{type:"rectangle",x:200,y:0,width:100,height:100}],
    async update(changes) { Object.assign(this, changes); } };
  const collection = SCENE_OBJECT_COLLECTIONS[type];
  if (type === 'Token') { target.width=1;target.height=1;target.actor={testUserPermission:()=>true}; }
  f.scene[collection] ??= new Map(); f.scene[collection].set(target.id, target);
  const command = {...defaultObjectCommand(commandId), enabled:true};
  f.flags.objectBindings.bindings[`${type}:target`] = {type,id:target.id,groupId,commands:[command]};
  const signals = new SceneSignals({runtime:f.runtime}); f.executor.signals=signals;
  const packet = {...f.packet(commandId),targetUuid:target.uuid,method:"delegated",delegateTokenUuid:f.npc.uuid};
  return {...f,target,command,endpointPacket:packet,realSignals:signals};
}

for (const [type,commandId] of [["Wall","open"],["Tile","visible"],["Drawing","visible"],["AmbientLight","source-on"],
  ["AmbientSound","source-on"],["Region","signals-on"],["Note","visible"],["Token","signals-on"]]) {
  test(`ungrouped ${type} accepts delegated commands through real signal validation`, async()=>{
    const f=await setup(type,null,commandId);
    f.npc.x=150;
    try {
      const result=await f.executor.accept(f.scene,f.endpointPacket,f.player);
      assert.ok(result.runId);
      const validation=f.realSignals.history(f.scene).find(record=>record.name==='commandRequested');
      assert.equal(validation.allowed,true); assert.equal(validation.status,'done');
    } finally { f.realSignals.dispose();f.runtime.dispose(); }
  });
}

test('command conditions match the acting object group, never an unrelated active group',async()=>{
  const f=await setup();f.npc.x=150;
  f.flags.groupDefinitions.other={...sampleGroupDefinition(),groupId:'other',groupName:'Other'};
  await f.runtime.enter(f.scene,'calm',{groupId:'other'});
  f.flags.objectBindings.bindings['Wall:target'].groupId='other';
  try {
    f.command.conditions.groups=[{groupId:'other',stateIds:['calm']}];
    await assert.rejects(f.executor.accept(f.scene,f.endpointPacket,f.player),error=>error.code==='conditions');
    f.command.conditions.groups=[{groupId:'main',stateIds:['calm']}];
    assert.ok((await f.executor.accept(f.scene,f.endpointPacket,f.player)).runId,'different endpoint and actor groups are allowed');
  } finally {f.realSignals.dispose();f.runtime.dispose();}
});

for (const type of ['Wall','AmbientLight','Tile']) test(`${type} delegation may finish a blocked approach inside its configured command range`,async()=>{
  const f=await setup(type,null,type==='Wall'?'open':type==='Tile'?'visible':'source-on');
  // Collision with a different wall leaves the actor within the allowed radius.
  f.npc.object.checkCollision=point=>point.x>=170;
  if(type==='Tile')f.command.conditions.range=8;
  const input={targetUuid:f.target.uuid,commandId:f.command.id};
  const run={config:{id:'delegate',parameters:{speed:30}},request:{parameters:input}};
  let delivered=0;
  try {
    const result=await new ObjectCommandCore().tick(f.scene,run,f.npc,1,{delegate:()=>{delivered++;return{done:true};}});
    assert.equal(result.done,true);assert.equal(delivered,1);
    assert.ok(f.npc.x<200,'collision still blocks movement');
  }finally{f.realSignals.dispose();f.runtime.dispose();}
});

test('an obstacle outside the configured range still prevents delegation',async()=>{
  const f=await setup();f.command.conditions.range=1;f.npc.object.checkCollision=point=>point.x>=120;
  let delivered=false;
  try {
    await assert.rejects(new ObjectCommandCore().tick(f.scene,{config:{id:'delegate',parameters:{speed:30}},
      request:{parameters:{targetUuid:f.target.uuid,commandId:'open'}}},f.npc,1,
    {delegate:()=>{delivered=true;return{done:true};}}),error=>error.code==='delegation-path');
    assert.equal(delivered,false);
  }finally{f.realSignals.dispose();f.runtime.dispose();}
});

test('range to a long wall is measured to its nearest segment point, not its midpoint',async()=>{
  const f=await setup();f.target.c=[200,-1000,200,100];f.npc.x=100;
  try { assert.ok((await f.executor.accept(f.scene,f.endpointPacket,f.player)).runId); }
  finally{f.realSignals.dispose();f.runtime.dispose();}
});

for (const groupId of [null, "other"]) for (const blocked of [false, true]) {
  test(`delegation opens the door and completes through the real runtime: group=${groupId}, blocked=${blocked}`, async () => {
    const f = await setup("Wall", groupId);
    if (groupId) {
      f.flags.groupDefinitions.other = {...sampleGroupDefinition(),groupId:"other",groupName:"Other"};
      await f.runtime.enter(f.scene,"calm",{groupId:"other"});
    }
    f.npc.object.checkCollision = point => blocked && point.x >= 170;
    try {
      await f.accept("delegate",{targetUuid:f.target.uuid,commandId:"open"});
      for (let count=0;count<40 && f.executor.runs(f.scene).length;count++) {
        await f.tick(250);
        await new Promise(resolve=>setImmediate(resolve));
      }
      assert.equal(f.target.ds,1,"the native door is opened");
      assert.equal(f.executor.runs(f.scene).length,0,"both command runs complete");
      assert.deepEqual(f.errors,[]);
    } finally { f.realSignals.dispose();f.runtime.dispose(); }
  });
}
