import test from "node:test";
import assert from "node:assert/strict";
import { getDefinitions, getDefinition, getExecutionDefinitions } from "../dmicher-master-screen/scripts/store.js";
import { normalizeObjectBinding, materializeStateDefinition, resolveBindingTools } from "../dmicher-master-screen/scripts/object-binding-model.js";
import { objectCapabilities } from "../dmicher-master-screen/scripts/object-capabilities.js";
import { normalizeScriptInterruptions } from "../dmicher-master-screen/scripts/script-interruption-model.js";

test("Players exists on an untouched scene without creating stored data", () => {
  const scene = { id: "s", getFlag: () => undefined, setFlag: () => assert.fail("read wrote preparation") };
  const groups = getDefinitions(scene);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupId, "players");
  assert.equal(groups[0].states.length, 1);
  assert.deepEqual(getDefinitions(null), []);
  assert.deepEqual(getExecutionDefinitions(scene), []);
});
test("a player flag assigns Players and excludes routine, but keeps other automation", () => {
  const scene = { id: "s", getFlag: () => undefined };
  const group = getDefinition(scene, { groupId: "players" });
  const state = group.states[0];
  const script = { id: "script", name: "step", enabled: true, steps: [{id:1,kind:"wait",parameters:{seconds:1}}] };
  const binding = normalizeObjectBinding({ type: "Token", id: "pc", playerCharacter: true, groupId: "old",
    scripts: [{...script, stateId:state.id}], transitionScripts:{[state.id]:script} });
  assert.equal(binding.groupId, "players");
  const prepared = materializeStateDefinition({pc:binding}, {shops:[],dialogues:[]}, group, state);
  assert.equal(prepared.scripts.length, 0);
  assert.equal(prepared.transitions.length, 1);
  assert.equal(prepared.objects.length, 1);
});
test("player action policy defaults to stop and admits only stop or forbid", () => {
  assert.equal(normalizeScriptInterruptions({}).playerAction, "stop");
  assert.equal(normalizeScriptInterruptions({playerAction:"forbid"}).playerAction, "forbid");
  assert.throws(()=>normalizeScriptInterruptions({playerAction:"restart-script"}));
});

test("player characters cannot host shops or dialogues, and reading preserves their stored preparation", () => {
  for (const marker of [{playerCharacter:true}, {groupId:"players"}]) {
    const binding = normalizeObjectBinding({type:"Token",id:"pc",...marker,
      shops:[{shopId:"shop",stateIds:["default"]}],dialogues:[{dialogueId:"dialogue",stateIds:["default"]}]});
    const catalog = {shops:[{id:"shop"}],dialogues:[{id:"dialogue"}]};
    const before = structuredClone(binding);
    assert.equal(objectCapabilities("Token",binding).tools,false);
    for (const kind of ["shop","dialogue"]) assert.deepEqual(resolveBindingTools(binding,catalog,{groupId:"players",stateId:"default"},kind),[]);
    assert.deepEqual(binding,before);
  }
  assert.equal(objectCapabilities("Token",{groupId:"npc"}).tools,true);
});
