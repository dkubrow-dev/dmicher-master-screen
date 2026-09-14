import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { normalizeScriptInterruptions, SCRIPT_INTERRUPTION_MODES } from "../dmicher-master-screen/scripts/script-interruption-model.js";

test("all script interruption sources default to stop without mutating preparation", () => {
  const source = { steps: [] };
  const script = normalizeScript(source);
  assert.deepEqual(script.interruptions, {
    combat: "stop", interaction: "stop", manual: "stop", command: "stop", error: { mode: "stop", retries: 3, delaySeconds: 1 }
  });
  assert.equal(Object.hasOwn(source, "interruptions"), false);
  script.interruptions.error.retries = 8;
  assert.equal(normalizeScript(source).interruptions.error.retries, 3);
});

test("every source accepts each explicit continuation and preserves independent error limits", () => {
  for (const mode of SCRIPT_INTERRUPTION_MODES) {
    for (const retries of [1, 10]) for (const delaySeconds of [0.1, 0.25, 60]) {
      const interruptions = { combat: mode, interaction: mode, manual: mode, command: mode, error: { mode, retries, delaySeconds } };
      const before = structuredClone(interruptions);
      const actual = normalizeScript({ steps: [], interruptions }).interruptions;
      assert.deepEqual(actual, before);
      assert.deepEqual(interruptions, before);
      assert.notEqual(actual.error, interruptions.error);
    }
  }
});

test("interruption imports reject coercion, unknown fields and invalid limits even when disabled", () => {
  for (const value of [null, [], "stop", false, { unknown: "stop" }, { error: null }, { error: [] }, { error: { unknown: 1 } }]) {
    assert.throws(() => normalizeScriptInterruptions(value));
  }
  for (const source of ["combat", "interaction", "manual", "command", "error"]) {
    for (const mode of [null, true, 0, "", "STOP", "pause", {}, []]) {
      assert.throws(() => normalizeScriptInterruptions({ [source]: source === "error" ? { mode } : mode }));
    }
  }
  for (const retries of [0, 11, -1, 1.5, "3", null, true, Infinity, NaN]) {
    assert.throws(() => normalizeScriptInterruptions({ error: { mode: "stop", retries } }));
  }
  for (const delaySeconds of [0, 0.099, 60.001, -1, "1", null, true, Infinity, NaN]) {
    assert.throws(() => normalizeScriptInterruptions({ error: { mode: "stop", delaySeconds } }));
  }
});

test("only command interruption can be ignored; errors and emergency stop remain explicit", () => {
  assert.equal(normalizeScriptInterruptions({ command: "ignore" }).command, "ignore");
  for (const source of ["combat", "interaction", "manual", "error"]) {
    assert.throws(() => normalizeScriptInterruptions({ [source]: source === "error" ? { mode: "ignore" } : "ignore" }));
  }
});

test("invalid retry values identify their fields in both supported languages", () => {
  const previous = globalThis.game;
  try {
    for (const [lang, retriesLabel, delayLabel] of [["ru", "Повторов после ошибки", "Таймаут повторений"], ["en", "Retries after an error", "Retry delay"]]) {
      globalThis.game = { i18n: { lang } };
      assert.throws(() => normalizeScriptInterruptions({ error: { retries: 0 } }), error => error.message.startsWith(retriesLabel));
      assert.throws(() => normalizeScriptInterruptions({ error: { delaySeconds: 0 } }), error => error.message.startsWith(delayLabel));
    }
  } finally { globalThis.game = previous; }
});
