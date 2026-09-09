import test from "node:test";
import assert from "node:assert/strict";
import { appendRoutineStep, removeRoutineStep, readRoutineFields } from "../dmicher-master-screen/scripts/apps/routine-fields.js";
import { normalizeRoutine } from "../dmicher-master-screen/scripts/routine-model.js";

test("delete and append cannot resurrect an incoming edge to a removed step", () => {
  const routine = { episodeId: "calm", repeat: false, steps: [] };
  appendRoutineStep(routine); appendRoutineStep(routine); appendRoutineStep(routine);
  routine.steps[0].next = [3];
  removeRoutineStep(routine, 2); appendRoutineStep(routine);
  assert.deepEqual(routine.steps[0].next, []);
  assert.deepEqual(routine.steps[1].next, [3]);
  assert.deepEqual(normalizeRoutine(routine), routine);
});

test("routine field capture preserves a legacy block and does not parse missing controls", () => {
  const legacy = { episodeId: "calm", legacy: true, legacyPatrol: { points: [] }, steps: [] };
  assert.deepEqual(readRoutineFields({ querySelector() { throw Error("unexpected read"); } }, [legacy]), [legacy]);
});

test("step form preserves branching identities through normalization and rejects malformed destinations", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const fields = { "routine-0-episode": "calm", "routine-0-step-0-kind": "wait", "routine-0-step-0-parameters": '{"seconds":0.25}',
    "routine-0-step-0-next": "9, 777", "routine-0-step-1-kind": "emotion", "routine-0-step-1-parameters": '{"emoji":""}', "routine-0-step-1-next": "" };
  const root = { querySelector(selector) { const name = selector.match(/name="([^"]+)"/)[1]; return { value: fields[name], checked: name.endsWith("repeat") }; } };
  const routines = [{ episodeId: "calm", repeat: false, steps: [{ id: 4 }, { id: 9 }] }];
  const captured = readRoutineFields(root, routines)[0], result = normalizeRoutine(captured);
  assert.deepEqual(result.steps.map((step) => ({ id: step.id, next: step.next })), [{ id: 1, next: [2] }, { id: 2, next: [] }]);
  assert.equal(result.repeat, true);
  fields["routine-0-step-0-next"] = "1,,2";
  assert.throws(() => readRoutineFields(root, routines), /positive step numbers/);
});
