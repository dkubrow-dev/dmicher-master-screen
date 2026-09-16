import test from "node:test";
import assert from "node:assert/strict";
import {potentialInteractiveDocuments} from "../dmicher-master-screen/scripts/interactive-object-projection.js";
import {sceneFixture} from "./fixtures/scene.js";
import {MODULE_ID,emptyRuntime} from "../dmicher-master-screen/scripts/model.js";

test("potential highlight membership survives distance and selected-character changes without evaluating author conditions",()=>{
  const {scene}=sceneFixture(),flags=scene.flags[MODULE_ID],player={id:"player"};
  flags.groupDefinitions={main:{schemaVersion:1}};
  flags.groupRuntimes={main:{...emptyRuntime(),runId:"run",stateId:"calm",state:{}}};
  flags.interactionCatalog={dialogues:[{id:"talk"}]};
  flags.objectBindings={bindings:{"Token:npc":{type:"Token",id:"npc",groupId:"main",dialogues:[{
    dialogueId:"talk",stateIds:["calm"],range:5,conditionMacro:'throw new Error("must not execute");'
  }]}}};
  scene.tokens.get("pc").x=100000;
  assert.deepEqual(potentialInteractiveDocuments(scene,player),[scene.tokens.get("npc")]);
  scene.tokens.delete("pc");assert.equal(potentialInteractiveDocuments(scene,player).length,1);
  flags.groupRuntimes.main.stateId="alert";assert.deepEqual(potentialInteractiveDocuments(scene,player),[]);
});

test("projection respects registered native capability, roles, state and object behavior without creating preparation",()=>{
  const f=sceneFixture(),flags=f.scene.flags[MODULE_ID],before=f.writes(),npc=f.scene.tokens.get("npc");
  flags.objectBindings={bindings:{"Token:npc":{type:"Token",id:"npc",groupId:null,commands:[{id:"wait",enabled:true,permissions:{gm:true,player:false,delegated:false}}]}}};
  assert.deepEqual(potentialInteractiveDocuments(f.scene,{id:"player"}),[]);
  assert.deepEqual(potentialInteractiveDocuments(f.scene,game.user),[npc]);
  flags.objectBehaviorState={"Token:npc":false};assert.deepEqual(potentialInteractiveDocuments(f.scene,game.user),[]);
  flags.objectBindings.bindings["Token:npc"].commands=[{id:"behavior-on",enabled:true}];
  assert.deepEqual(potentialInteractiveDocuments(f.scene,game.user),[npc]);
  assert.equal(f.writes(),before);
});
