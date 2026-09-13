import test from "node:test";
import assert from "node:assert/strict";
import { debugTrace, debugError, debugEnabled, registerDebugSetting, setDebugEnabled } from "../dmicher-master-screen/scripts/debug.js";

test("Debug is off by default and never evaluates disabled diagnostic context", (t) => {
  t.mock.method(console, "debug", () => {});
  t.mock.method(console, "error", () => {});
  globalThis.game = { settings: { get: () => false } };
  let calls = 0;
  debugTrace("script", "step", () => { calls++; throw new Error("must not run"); });
  debugError("script", "step", new Error("failure"), () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(console.debug.mock.callCount(), 0);
  assert.equal(console.error.mock.callCount(), 0);
  game.settings.get = () => { throw new Error("not registered"); };
  assert.equal(debugEnabled(), false);
});

test("Debug writes detached plain snapshots and cannot break execution", (t) => {
  t.mock.method(console, "debug", () => {});
  t.mock.method(console, "error", () => {});
  globalThis.game = { settings: { get: () => true } };
  class Document { constructor() { this.id = "native"; } }
  const context = { step: 2, parameters: { value: 12 }, native: new Document() };
  context.circular = context;
  debugTrace("script", "step.started", () => context);
  context.parameters.value = 24;
  const [label, logged] = console.debug.mock.calls[0].arguments;
  assert.match(label, /\[script\] step.started/);
  assert.equal(logged.parameters.value, 12);
  assert.equal(logged.native, "[Non-plain object]");
  assert.equal(logged.circular, "[Circular]");
  assert.doesNotThrow(() => debugTrace("script", "step", () => { throw new Error("diagnostic failure"); }));
  const failure = new Error("action failed");
  debugError("script", "step.failed", failure, { step: 3 });
  assert.equal(console.error.mock.calls[0].arguments[1].error.message, failure.message);
  assert.equal(console.error.mock.calls[0].arguments[1].error.stack, failure.stack);
});

test("Debug is a restricted world switch, changes immediately, and rejects players", async () => {
  let setting, enabled = false, changed = 0;
  globalThis.game = { user: { isGM: true }, i18n: { lang: "en" }, settings: {
    register: (moduleId, key, options) => { assert.equal(moduleId, "dmicher-master-screen"); assert.equal(key, "debug"); setting = options; },
    get: () => enabled,
    set: async (_moduleId, _key, value) => { enabled = value; setting.onChange(value); return value; }
  } };
  registerDebugSetting({ onChange: () => changed++ });
  assert.equal(setting.name, "Debug");
  assert.equal(setting.scope, "world");
  assert.equal(setting.restricted, true);
  assert.equal(setting.default, false);
  await setDebugEnabled(true);
  assert.equal(debugEnabled(), true);
  assert.equal(changed, 1);
  await setDebugEnabled(false);
  assert.equal(debugEnabled(), false);
  game.user.isGM = false;
  await assert.rejects(() => setDebugEnabled(true), /Only a GM/);
  assert.equal(debugEnabled(), false);
});
