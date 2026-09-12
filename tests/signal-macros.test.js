import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { assertSignalInterface, normalizeSignalFields } from "../dmicher-master-screen/scripts/signal-types.js";
import { signalMacroSnippet, inspectSignalMacro, executeSignalMacro } from "../dmicher-master-screen/scripts/signal-macros.js";

const signal = () => ({ name: "test", parameters: normalizeSignalFields([{ name: "x", type: "integer" }, { name: "y", type: "string", nullable: true }]), returns: normalizeSignalFields([{ name: "allowed", type: "boolean", default: true }, { name: "message", type: "string", nullable: true, default: null }]) });
test("macro input subset and extra returns are valid; unknown input and missing nullable output are not", () => {
  const s = signal();
  assert.doesNotThrow(() => assertSignalInterface(s, { parameters: s.parameters.slice(0, 1), returns: [...s.returns, { name: "extra", type: "integer" }] }));
  assert.throws(() => assertSignalInterface(s, { parameters: [...s.parameters, { name: "unknown", type: "string" }], returns: s.returns }));
  assert.throws(() => assertSignalInterface(s, { parameters: s.parameters, returns: s.returns.slice(0, 1) }));
  assert.throws(() => assertSignalInterface(s, { parameters: [{ name: "x", type: "number" }], returns: s.returns }));
});
test("factory receives values and returns typed values after execute", async () => {
  const f = fixture(), s = signal(), macro = f.macro("Macro.example", s, function () { this.returns.allowed.value = this.parameters.x.value > 2; this.returns.message.value = this.parameters.y.value; });
  assert.equal(inspectSignalMacro(macro, s).valid, true);
  assert.deepEqual(await executeSignalMacro(macro, s, { x: 3, y: "yes" }), { allowed: true, message: "yes" });
});
test("missing factory members are rejected before the action, even with a valid annotation", async () => {
  const f = fixture(), s = signal(), macro = f.macro("Macro.bad", s); let executed = false;
  macro.execute = async () => ({ parameters: {}, returns: {}, execute() { executed = true; } });
  await assert.rejects(executeSignalMacro(macro, s, { x: 3, y: null })); assert.equal(executed, false);
});
test("invalid macro has an editable complete snippet and is not executed on inspection", () => {
  let executed = false;
  const result = inspectSignalMacro({ documentName: "Macro", type: "script", command: "throw new Error('executed')", execute: () => { executed = true; } }, signal());
  assert.equal(result.valid, false); assert.match(result.snippet, /dmicher-signal-interface/); assert.match(result.snippet, /async execute/); assert.equal(executed, false);
});
test("return defaults cannot hide a missing runtime output value", async () => {
  const f = fixture(), s = signal(), macro = f.macro("Macro.bad", s, function () { delete this.returns.message.value; });
  await assert.rejects(executeSignalMacro(macro, s, { x: 3, y: null }));
});
test("generated snippet is syntactically valid for Unicode and prototype-like keys", async () => {
  const s = { name: "custom", parameters: normalizeSignalFields([{ name: "__proto__", type: "string" }, { name: " a!\" */ ", type: "boolean" }]), returns: [] };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const instance = await new AsyncFunction(signalMacroSnippet(s))();
  assert.equal(Object.hasOwn(instance.parameters, "__proto__"), true); assert.equal(Object.getPrototypeOf(instance.parameters), Object.prototype);
});
