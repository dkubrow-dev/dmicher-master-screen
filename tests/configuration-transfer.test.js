import test from "node:test";
import assert from "node:assert/strict";
import { remapStateSignals, remapDialogueSignals, remapBindingSignals, remapBindingStateTransitions, remapBindingActionReferences, remapBindingCommandGroups } from "../dmicher-master-screen/scripts/configuration-transfer.js";
import { bindingScripts } from "../dmicher-master-screen/scripts/object-binding-model.js";

const mapping = new Map([["source", "destination"]]);
const payload = { signalId: "source", nested: [{ signalId: "source" }], text: "source" };

test("state imports remap declared sources without changing arbitrary signal payloads", () => {
  const states = [{ zones: [{ signalId: "source", parameters: structuredClone(payload) }], interactions: [{ signalId: "source", parameters: structuredClone(payload) }] }];
  const before = structuredClone(states), result = remapStateSignals(states, mapping);
  for (const source of [...result[0].zones, ...result[0].interactions]) {
    assert.equal(source.signalId, "destination");
    assert.deepEqual(source.parameters, payload);
  }
  assert.deepEqual(states, before);
});

test("dialogue import remaps only answer references, retaining prose and payload values", () => {
  const dialogue = { pages: [{ text: "source", responses: [{ signalId: "source", parameters: structuredClone(payload) }] }] };
  const result = remapDialogueSignals(dialogue, mapping);
  assert.equal(result.pages[0].responses[0].signalId, "destination");
  assert.deepEqual(result.pages[0].responses[0].parameters, payload);
  assert.equal(result.pages[0].text, "source");
  assert.equal(dialogue.pages[0].responses[0].signalId, "source");
});

test("object import remaps signal actions in each script purpose, preserving custom parameters", () => {
  const script = { steps: [{ id: 1, kind: "signal", parameters: { signalId: "source", parameters: structuredClone(payload) } }, { id: 2, kind: "speech", parameters: { text: "source" } }] };
  const binding = { initialScript: structuredClone(script), transitionScripts: { calm: structuredClone(script) }, scripts: [structuredClone(script)],
    commands: [{ beforeScript: structuredClone(script), afterScript: structuredClone(script) }] };
  const result = remapBindingSignals(binding, mapping);
  for (const saved of bindingScripts(result)) {
    assert.equal(saved.steps[0].parameters.signalId, "destination");
    assert.deepEqual(saved.steps[0].parameters.parameters, payload);
    assert.equal(saved.steps[1].parameters.text, "source");
  }
  assert.equal(binding.initialScript.steps[0].parameters.signalId, "source");
});

test("group imports remap state destinations in every script purpose without scanning author JSON", () => {
  const transitions = [{ groupId: "source", stateId: "calm" }, { groupId: "external", stateId: "calm" }];
  const script = { steps: [
    { id: 1, kind: "state", parameters: { transitions: structuredClone(transitions) } },
    { id: 2, kind: "signal", parameters: { parameters: { transitions, kind: "state", parameters: { transitions } } } }
  ] };
  const binding = { initialScript: structuredClone(script), transitionScripts: { calm: structuredClone(script) }, scripts: [structuredClone(script)],
    commands: [{ beforeScript: structuredClone(script), afterScript: structuredClone(script) }] };
  const before = structuredClone(binding), result = remapBindingStateTransitions(binding, { sourceGroupId: "source", groupId: "destination" });
  for (const saved of bindingScripts(result)) {
    assert.deepEqual(saved.steps[0].parameters.transitions, [{ groupId: "destination", stateId: "calm" }, transitions[1]]);
    assert.deepEqual(saved.steps[1], script.steps[1]);
  }
  assert.deepEqual(binding, before);
});

test("single-state imports remap only their owned pair, retaining other states and groups", () => {
  const pair = (groupId, stateId) => ({ steps: [{ kind: "state", parameters: { transitions: [{ groupId, stateId }] } }] });
  const binding = { scripts: [pair("source", "calm"), pair("source", "alarm"), pair("external", "calm")] };
  const result = remapBindingStateTransitions(binding, { sourceGroupId: "source", groupId: "destination", stateMapping: new Map([["calm", "copy"]]) });
  assert.deepEqual(result.scripts.map((script) => script.steps[0].parameters.transitions[0]), [
    { groupId: "destination", stateId: "copy" }, { groupId: "source", stateId: "alarm" }, { groupId: "external", stateId: "calm" }
  ]);
});

test("command state filters remap owned pairs without interpreting arbitrary action JSON", () => {
  const groups = [{ groupId: "source", stateIds: ["calm", "alarm"] }, { groupId: "external", stateIds: [] }];
  const binding = { commands: [{ conditions: { groups }, parameters: { groups: structuredClone(groups) } }] };
  const before = structuredClone(binding);
  const result = remapBindingCommandGroups(binding, { sourceGroupId: "source", groupId: "destination", stateMapping: new Map([["calm", "copy"]]) });
  assert.deepEqual(result.commands[0].conditions.groups, [
    { groupId: "destination", stateIds: ["copy"] }, { groupId: "source", stateIds: ["alarm"] }, { groupId: "external", stateIds: [] }
  ]);
  assert.deepEqual(result.commands[0].parameters.groups, groups);
  assert.deepEqual(binding, before);
  const full = remapBindingCommandGroups(binding, { sourceGroupId: "source", groupId: "destination" });
  assert.deepEqual(full.commands[0].conditions.groups, [{ groupId: "destination", stateIds: ["calm", "alarm"] }, groups[1]]);
});

test("partial command scope import limits all-state selection to the imported state and merges matching owners", () => {
  const binding = { commands: [{ conditions: { groups: [{ groupId: "source", stateIds: [] }, { groupId: "destination", stateIds: ["existing"] }] } }] };
  const result = remapBindingCommandGroups(binding, { sourceGroupId: "source", groupId: "destination", stateMapping: new Map([["calm", "copy"]]) });
  assert.deepEqual(result.commands[0].conditions.groups, [{ groupId: "destination", stateIds: ["copy", "existing"] }]);
});

test("dialogue and movement imports remap only typed catalog and native action references", () => {
  const actions = [
    { kind: "dialogue", parameters: { dialogueId: "shared", tokenUuids: ["Scene.source.Token.pc", "Scene.external.Token.pc"] } },
    { kind: "approach", parameters: { targetUuid: "Scene.source.Tile.counter" } },
    { kind: "follow", parameters: { targetUuid: "Scene.source.Token.pc" } },
    { kind: "signal", parameters: { parameters: { dialogueId: "shared", tokenUuids: ["Scene.source.Token.pc"], targetUuid: "Scene.source.Token.pc" } } },
    { kind: "macro", parameters: { macroUuid: "Macro.original" } }
  ];
  const binding = { initialScript: { steps: structuredClone(actions) }, transitionScripts: { state: { steps: structuredClone(actions) } }, scripts: [{ steps: structuredClone(actions) }] };
  const before = structuredClone(binding), result = remapBindingActionReferences(binding, {
    assetMapping: new Map([["Shop:shared", "shopCopy"], ["Dialogue:shared", "dialogueCopy"]]), sourceSceneUuid: "Scene.source", sceneUuid: "Scene.target"
  });
  for (const script of [result.initialScript, result.transitionScripts.state, ...result.scripts]) {
    assert.deepEqual(script.steps[0].parameters, { dialogueId: "dialogueCopy", tokenUuids: ["Scene.target.Token.pc", "Scene.external.Token.pc"] });
    assert.equal(script.steps[1].parameters.targetUuid, "Scene.target.Tile.counter");
    assert.equal(script.steps[2].parameters.targetUuid, "Scene.target.Token.pc");
    assert.deepEqual(script.steps.slice(3), actions.slice(3));
  }
  assert.deepEqual(binding, before);
});
