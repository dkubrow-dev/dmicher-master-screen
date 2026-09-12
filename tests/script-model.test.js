import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScript, normalizeScripts, normalizeScriptStep, scriptStepTemplate, SCRIPT_STEP_KINDS } from "../dmicher-master-screen/scripts/script-model.js";
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
test("script options have explicit defaults and initial restoration has no state requirement", () => {
  const value = normalizeScript({ steps: [] });
  assert.equal(value.enabled, true); assert.equal(value.repeat, false); assert.equal(value.stateId, undefined);
  assert.deepEqual(value.combat, { enabled: false, confirm: true, notifyWarning: true, notifyChat: false, endTurn: false, turnSeconds: 6 });
  assert.throws(() => normalizeScripts([{ steps: [] }]));
});
test("display order keeps stable identities and removes deleted destinations only", () => {
  const value = normalizeScript({ name: "Patrol", steps: [step(9, "wait", { seconds: 1 }, [1]), step(1, "wait", { seconds: 7 }, [9, 8])] });
  assert.deepEqual(value.steps.map((s) => s.id), [9, 1]); assert.deepEqual(value.steps[1].next, [9]);
  assert.throws(() => normalizeScript({ steps: [step(9, "wait", { seconds: 1 })] }));
  assert.throws(() => normalizeScripts([{ stateId: "calm", steps: [] }, { stateId: "calm", steps: [] }]));
});
test("typed script actions reject coercion, unknown fields and obsolete parameters", () => {
  assert.throws(() => normalizeScriptStep(step(1, "wait", { seconds: "7" })));
  assert.throws(() => normalizeScriptStep(step(1, "move", { x: 100, y: 0, speed: 5 })));
  assert.throws(() => normalizeScriptStep(step(1, "macro", { macroUuid: "Macro.test", parameters: {} })));
  assert.throws(() => normalizeScript({ enabled: "false", steps: [] }));
  assert.throws(() => normalizeScript({ combat: { turnSeconds: 0 }, steps: [] }));
});
test("all action templates are independent and support precise timing and optional dimensions", () => {
  for (const kind of SCRIPT_STEP_KINDS) { const draft = scriptStepTemplate(kind); assert.equal(draft.kind, kind); assert.deepEqual(draft.next, []); }
  const move = normalizeScriptStep(step(1, "move", { timeMode: "speed", position: { x: 300, y: -20, speed: 5 }, rotation: { mode: "relative", angle: -90, speed: 30 }, size: { x: 2, z: null } }));
  assert.equal(move.parameters.size.y, null); assert.equal(move.parameters.duration, 0);
  const speech = normalizeScriptStep(step(1, "speech", { duration: 1.5, chat: { text: "<b>Hello</b>", allowTags: ["hero", "hero"] }, bubble: { text: "Hi" } }));
  assert.deepEqual(speech.parameters.chat.allowTags, ["hero"]); assert.equal(speech.parameters.bubble.fontSize, 24);
  assert.equal(normalizeScriptStep(step(1, "signal", { signalId: "custom signal!", parameters: { "arbitrary key!": null }, before: 1, after: 2 })).parameters.after, 2);
});
