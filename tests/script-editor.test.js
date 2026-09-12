import test from "node:test";
import assert from "node:assert/strict";
import { appendScriptStep, removeScriptStep, moveScriptStep, readScriptFields } from "../dmicher-master-screen/scripts/apps/script-fields.js";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";

test("delete and append cannot resurrect an incoming edge to a removed step", () => {
  const script = { stateId: "calm", repeat: false, steps: [] };
  appendScriptStep(script); appendScriptStep(script); appendScriptStep(script);
  script.steps[0].next = [3];
  removeScriptStep(script, 2); appendScriptStep(script);
  assert.deepEqual(script.steps[0].next, []);
  assert.deepEqual(script.steps[1].next, [3]);
  assert.deepEqual(normalizeScript(script).steps, script.steps);
});

test("visual row movement preserves all identities and branches even after save normalization", () => {
  const script = { stateId: "calm", repeat: false, steps: [] };
  appendScriptStep(script); appendScriptStep(script); appendScriptStep(script);
  script.steps[0].next = [2, 3]; script.steps[2].next = [1];
  const before = structuredClone(script.steps);
  assert.equal(moveScriptStep(script, 0, 2), true);
  assert.deepEqual(script.steps.map((step) => step.id), [2, 3, 1]);
  assert.deepEqual(normalizeScript(script).steps.toSorted((a, b) => a.id - b.id), before);
  assert.equal(moveScriptStep(script, 3, 0), false);
});

test("entry step remains present while there are other rows, and an empty block is allowed", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const script = { stateId: "calm", repeat: false, steps: [] };
  appendScriptStep(script); appendScriptStep(script);
  assert.throws(() => removeScriptStep(script, 0), /step 1/);
  removeScriptStep(script, 1); removeScriptStep(script, 0);
  assert.deepEqual(normalizeScript(script).steps, []);
});

test("step form preserves branching identities through normalization and rejects malformed destinations", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const fields = { "script-0-name": "Patrol", "script-0-repeat": true, "script-0-enabled": true, "script-0-step-0-kind": "wait", "script-0-step-0-parameters": '{"seconds":0.25}',
    "script-0-step-0-next": "9, 777", "script-0-step-1-kind": "emotion", "script-0-step-1-parameters": '{"emoji":""}', "script-0-step-1-next": "" };
  const root = { querySelector(selector) { const name = selector.match(/name="([^"]+)"/)[1]; return Object.hasOwn(fields,name) ? { value: fields[name], checked: fields[name] === true } : null; } };
  const scripts = [{ stateId: "calm", repeat: false, steps: [{ id: 1 }, { id: 9 }] }];
  const captured = readScriptFields(root, scripts)[0], result = normalizeScript(captured);
  assert.deepEqual(result.steps.map((step) => ({ id: step.id, next: step.next })), [{ id: 1, next: [9] }, { id: 9, next: [] }]);
  assert.equal(result.repeat, true);
  fields["script-0-step-0-next"] = "1,,2";
  assert.throws(() => readScriptFields(root, scripts), /positive step numbers/);
});
