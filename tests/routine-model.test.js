import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRoutine, normalizeRoutines, normalizeRoutineStep, routineStepTemplate, ROUTINE_STEP_KINDS } from "../dmicher-master-screen/scripts/routine-model.js";

test("routine graph renumbering retains identities after reorder/deletion and removes dangling edges", () => {
  const step = (id, next) => ({ id, kind: "wait", parameters: { seconds: 0.5 }, next });
  const result = normalizeRoutine({ episodeId: "calm", steps: [step(30, [10, 90, 10]), step(10, [30, 50]), step(50, [])] });
  assert.deepEqual(result.steps.map(({ id, next }) => ({ id, next })), [{ id: 1, next: [2] }, { id: 2, next: [1, 3] }, { id: 3, next: [] }]);
  assert.equal(result.repeat, false);
  assert.throws(() => normalizeRoutine({ episodeId: "calm", steps: [step(1, []), step(1, [])] }));
  assert.throws(() => normalizeRoutines([{ episodeId: "calm", steps: [] }, { episodeId: "calm", steps: [] }]));
  assert.deepEqual(normalizeRoutines(), []);
});

test("routine parameters are strict typed templates, without coercion or unknown fields", () => {
  const check = (kind, parameters) => normalizeRoutineStep({ id: 1, kind, parameters, next: [] });
  for (const value of ["1", 0, -1, Infinity, NaN]) assert.throws(() => check("wait", { seconds: value }));
  assert.equal(check("wait", { seconds: 0.25 }).parameters.seconds, 0.25);
  assert.throws(() => check("wait", { seconds: 1, second: 2 }));
  assert.throws(() => check("move", { x: "0", y: 0, speed: 1 }));
  assert.throws(() => check("move", { x: 0, y: 0, speed: 0 }));
  assert.throws(() => check("speech", { text: "Hello", chat: "false", bubble: true }));
  assert.throws(() => check("speech", { text: "Hello", chat: false, bubble: false }));
  assert.equal(check("emotion", { emoji: "🌦️" }).parameters.emoji, "🌦️");
  assert.equal(check("emotion", { emoji: "" }).parameters.emoji, "");
  assert.throws(() => check("emotion", { emoji: "🙂😠" }));
  assert.throws(() => check("emotion", { emoji: null }));
  assert.throws(() => check("event", { eventName: "alert", triggerId: "", parameters: {} }));
  assert.throws(() => check("macro", { macroUuid: "Macro.id", parameters: { invalid: undefined } }));
  assert.throws(() => check("unknown", {}));
});

test("templates are independent drafts and preserve graph terminal semantics", () => {
  assert.equal(ROUTINE_STEP_KINDS.length, 6);
  const first = routineStepTemplate("macro"); first.parameters.parameters.key = "changed";
  assert.deepEqual(routineStepTemplate("macro").parameters.parameters, {});
  assert.deepEqual(routineStepTemplate("wait").next, []);
  assert.equal(normalizeRoutine({ episodeId: "calm", repeat: true, steps: [] }).repeat, true);
  assert.throws(() => normalizeRoutine({ episodeId: "calm", repeat: "true", steps: [] }));
});
