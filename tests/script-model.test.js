import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScript, normalizeScripts, normalizeScriptStep, scriptStepTemplate, SCRIPT_STEP_KINDS, DEFAULT_EMOTION_SIZE } from "../dmicher-master-screen/scripts/script-model.js";
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
test("emotion size accepts positive fractions and defaults only when omitted without mutating the draft", () => {
  const draft = step(1, "emotion", { emoji: "!" });
  assert.equal(scriptStepTemplate("emotion").parameters.size, DEFAULT_EMOTION_SIZE);
  assert.equal(normalizeScriptStep(draft).parameters.size, 32);
  assert.equal(Object.hasOwn(draft.parameters, "size"), false);
  assert.equal(normalizeScriptStep(step(1, "emotion", { emoji: "!", size: 18.75 })).parameters.size, 18.75);
  for (const size of [0, -1, Infinity, -Infinity, NaN, "32", null, true]) {
    assert.throws(() => normalizeScriptStep(step(1, "emotion", { size })));
  }
});
test("effect execution modes default independently and preserve explicit timing without mutating drafts", () => {
  for (const [kind, fallback] of [["emotion", "parallel"], ["speech", "wait"]]) {
    const draft = step(1, kind, { duration: 2.75 });
    assert.equal(scriptStepTemplate(kind).parameters.executionMode, fallback);
    assert.equal(normalizeScriptStep(draft).parameters.executionMode, fallback);
    assert.equal(Object.hasOwn(draft.parameters, "executionMode"), false);
    for (const executionMode of ["parallel", "wait"]) {
      for (const duration of [0, 2.75]) {
        const result = normalizeScriptStep(step(1, kind, { executionMode, duration }));
        assert.equal(result.parameters.executionMode, executionMode);
        assert.equal(result.parameters.duration, duration);
      }
    }
    for (const executionMode of [null, "", "WAIT", "after", 0, true, [], {}]) {
      assert.throws(() => normalizeScriptStep(step(1, kind, { executionMode })));
    }
  }
});
test("invalid emotion size names the parameter in the selected language", () => {
  const previous = globalThis.game;
  try {
    for (const [lang, label] of [["ru", "Размер эмоции"], ["en", "Emotion size"]]) {
      globalThis.game = { i18n: { lang } };
      assert.throws(() => normalizeScriptStep(step(1, "emotion", { size: 0 })), error => error.message.startsWith(label));
    }
  } finally { globalThis.game = previous; }
});
test("state steps keep a typed, unique group selection and permit an empty prepared action", () => {
  assert.deepEqual(normalizeScriptStep(step(1, "state", {})).parameters, { transitions: [] });
  const transitions = [{ groupId: "north", stateId: "quiet" }, { groupId: "south", stateId: "alarm" }];
  assert.deepEqual(normalizeScriptStep(step(1, "state", { transitions })).parameters.transitions, transitions);
  for (const value of [null, "north", [{ groupId: "north" }], [{ groupId: "north", stateId: "" }], [{ groupId: 1, stateId: "quiet" }],
    [{ groupId: "north", stateId: "quiet", force: true }], [...transitions, { groupId: "north", stateId: "alarm" }]]) {
    assert.throws(() => normalizeScriptStep(step(1, "state", { transitions: value })));
  }
});
