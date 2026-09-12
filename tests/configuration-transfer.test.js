import test from "node:test";
import assert from "node:assert/strict";
import { remapStateSignals, remapDialogueSignals, remapBindingSignals } from "../dmicher-master-screen/scripts/configuration-transfer.js";

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
  const binding = { initialScript: structuredClone(script), transitionScripts: { calm: structuredClone(script) }, scripts: [structuredClone(script)] };
  const result = remapBindingSignals(binding, mapping);
  for (const saved of [result.initialScript, result.transitionScripts.calm, ...result.scripts]) {
    assert.equal(saved.steps[0].parameters.signalId, "destination");
    assert.deepEqual(saved.steps[0].parameters.parameters, payload);
    assert.equal(saved.steps[1].parameters.text, "source");
  }
  assert.equal(binding.initialScript.steps[0].parameters.signalId, "source");
});
