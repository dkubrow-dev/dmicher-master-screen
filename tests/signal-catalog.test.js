import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { normalizeSignalFields, validateParameters, validateSignalValues } from "../dmicher-master-screen/scripts/signal-types.js";
import { exportCatalogDependencies, mergeCatalogDependencies } from "../dmicher-master-screen/scripts/signal-catalog.js";

test("reading built-ins creates no world data and covers every requested emitter", () => {
  const f = fixture(), catalog = f.catalog.list();
  assert.equal(f.writes(), 0);
  assert.deepEqual(catalog.emitters.map((e) => e.type), ["Scene", "Combat", "Group", "Token", "Token", "Shop", "Dialogue"]);
  for (const [type, count] of [["Scene", 4], ["Combat", 4], ["Group", 4], ["Shop", 4], ["Dialogue", 3]]) {
    const signals = catalog.signals.filter((s) => s.emitterKey.startsWith(`${type}:`)); assert.equal(signals.length, count);
    for (const signal of signals) { assert.ok(signal.description.ru && signal.description.en); for (const field of [...signal.parameters, ...signal.returns]) assert.ok(field.description.ru && field.description.en && field.builtin); }
  }
});
test("custom names allow any Unicode punctuation and are unique only within an emitter", async () => {
  const f = fixture(), source = { name: "!?🤖 [custom] /", parameters: [{ name: "# привет!", type: "string" }] };
  await f.catalog.saveSignal({ ...source, emitterKey: "Token:npc" });
  await f.catalog.saveSignal({ ...source, emitterKey: "Token:other" });
  await assert.rejects(f.catalog.saveSignal({ ...source, emitterKey: "Token:npc" }));
  await assert.rejects(f.catalog.saveSignal({ ...source, emitterKey: "Token:missing" }));
});
test("builtin fields are immutable, while custom fields can be added and removed", async () => {
  const f = fixture(), base = f.catalog.list().signals.find((s) => s.emitterKey === "Scene:scene" && s.name === "userEntered");
  await f.catalog.saveSignal({ ...base, parameters: [...base.parameters, { name: "extra", type: "boolean", default: false }] });
  assert.equal(f.catalog.list().signals.find((s) => s.id === base.id).parameters.length, 3);
  await f.catalog.saveSignal(base);
  await assert.rejects(f.catalog.saveSignal({ ...base, parameters: [] }));
  await assert.rejects(f.catalog.saveSignal({ ...base, name: "replacement" }));
  await assert.rejects(f.catalog.removeSignal(base.id));
});
test("strict values reject coercion, undeclared names, invalid nulls and numeric bounds", () => {
  const fields = normalizeSignalFields([{ name: "s", type: "string", minLength: 2, maxLength: 3 }, { name: "n", type: "number", min: 0, max: 2, decimals: 1 }, { name: "i", type: "integer" }, { name: "b", type: "boolean" }, { name: "optional", type: "string", nullable: true, default: null }]);
  const valid = { s: "ab", n: 1.1, i: 2, b: true };
  assert.deepEqual(validateSignalValues(fields, valid), { ...valid, optional: null });
  for (const patch of [{ s: "a" }, { s: "abcd" }, { s: null }, { n: "1" }, { n: NaN }, { n: 1.11 }, { n: 3 }, { i: 1.1 }, { b: 1 }, { extra: "x" }]) assert.throws(() => validateSignalValues(fields, { ...valid, ...patch }));
});
test("prototype-like field names stay ordinary data and cannot mutate prototypes", () => {
  const signal = { parameters: normalizeSignalFields([{ name: "__proto__", type: "string" }, { name: "constructor", type: "boolean" }]) };
  const result = validateParameters(signal, JSON.parse('{"__proto__":"safe","constructor":true}'));
  assert.equal(result.__proto__, "safe"); assert.equal(Object.getPrototypeOf(result), Object.prototype); assert.equal({}.safe, undefined);
});
test("subscription requires an owned macro and validates without executing it", async () => {
  const f = fixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "custom" });
  const macro = f.macro("Macro.m", signal); let executions = 0; macro.execute = () => { executions++; };
  await assert.rejects(f.catalog.saveSubscription({ ownerKey: "Token:other", emitterKey: signal.emitterKey, signalId: signal.id, macroUuid: "Macro.m" }));
  await f.catalog.attachMacro("Token:other", "Macro.m");
  await f.catalog.saveSubscription({ ownerKey: "Token:other", emitterKey: signal.emitterKey, signalId: signal.id, macroUuid: "Macro.m" });
  assert.equal(executions, 0);
  await assert.rejects(f.catalog.removeMacro("Token:other", "Macro.m"));
  await assert.rejects(f.catalog.removeSignal(signal.id));
});
test("concurrent editor revision rejects stale changes without world writes", async () => {
  const f = fixture(); await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "one" }, { expectedRevision: 0 });
  await assert.rejects(f.catalog.saveSignal({ emitterKey: "Token:npc", name: "two" }, { expectedRevision: 0 })); assert.equal(f.writes(), 1);
});
test("current-format transfer preserves subscriptions and maps explicit emitter owners", async () => {
  const f = fixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "portable" });
  await f.subscribe(signal, "Token:other");
  const exported = exportCatalogDependencies(f.scene), receiver = fixture();
  const merged = mergeCatalogDependencies(receiver.scene, exported, { emitterMapping: new Map([["Token:npc", "Token:other"], ["Token:other", "Token:npc"]]) });
  assert.equal(merged.signals[0].emitterKey, "Token:other"); assert.equal(merged.macros[0].ownerKey, "Token:npc");
  assert.equal(merged.subscriptions[0].signalId, merged.signals[0].id); assert.equal(merged.subscriptions[0].ownerKey, "Token:npc");
});
test("old event catalog is neither migrated nor read", () => {
  const f = fixture(); f.data.eventCatalog = { events: [{ id: "old", name: "old" }], triggers: [] };
  assert.equal(f.catalog.list().signals.some((s) => s.name === "old"), false); assert.equal(f.writes(), 0);
});
