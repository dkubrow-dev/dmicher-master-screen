import test from "node:test";
import assert from "node:assert/strict";
import { sceneFixture, clone, descriptor } from "./fixtures/scene.js";
import { GroupEditor } from "../dmicher-master-screen/scripts/group-editor.js";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { builtinCatalog, getSignalCatalog } from "../dmicher-master-screen/scripts/signal-catalog.js";
import { MODULE_ID, defaultDefinition, normalizeGroupSymbol, normalizeDescription, localizedDescription } from "../dmicher-master-screen/scripts/model.js";
import { getDefinitions, getRuntime, getRuntimes } from "../dmicher-master-screen/scripts/store.js";
import { validateParameters } from "../dmicher-master-screen/scripts/signal-types.js";

test("groups and states have independent order, unique names, copy and move", async () => {
  const f = sceneFixture(), a = await f.editor.createGroup({ name: "North" }), b = await f.editor.createGroup({ name: "South" });
  const second = await f.editor.createState(a.groupId, { name: "Tension" });
  await assert.rejects(f.editor.createGroup({ name: "NORTH" })); await assert.rejects(f.editor.createState(a.groupId, { name: "TENSION" }));
  await f.editor.reorderGroups([b.groupId, a.groupId]); assert.deepEqual(f.editor.list().map((entry) => entry.groupId), [b.groupId, a.groupId]);
  await f.editor.reorderStates(a.groupId, [second.id, a.entryStateId]); assert.equal(f.editor.get(a.groupId).states[0].id, second.id);
  const copied = await f.editor.transferState(a.groupId, b.groupId, second.id, { copy: true }); assert.notEqual(copied.id, second.id);
  const moved = await f.editor.transferState(a.groupId, b.groupId, second.id, { copy: false, name: "Moved" }); assert.equal(moved.id, second.id); assert.equal(f.editor.get(a.groupId).states.length, 1);
  const before = clone(f.scene.flags); await assert.rejects(f.editor.reorderGroups([a.groupId, a.groupId])); assert.deepEqual(f.scene.flags, before);
});
test("existing groups retain one valid entry state; an empty scene may have no groups", async () => {
  const f = sceneFixture(), before = clone(f.scene.flags), runtime = new GroupRuntime({ effects: {} });
  runtime.refresh(f.scene); await runtime.tick(); assert.deepEqual(f.scene.flags, before);
  await runtime.haltAll(f.scene); assert.deepEqual(f.scene.flags, { [MODULE_ID]: { automationHalted: true } });
  assert.deepEqual(getRuntimes(f.scene), []); assert.ok(getSignalCatalog(f.scene).signals.every((entry) => entry.builtin));
  const group = await f.editor.createGroup({ name: "Explicit" }), other = await f.editor.createGroup({ name: "Other" });
  assert.equal(group.states.length, 1); assert.equal(getRuntime(f.scene, { groupId: group.groupId }).runId, "");
  await assert.rejects(f.editor.deleteState(group.groupId, group.entryStateId)); await assert.rejects(f.editor.transferState(group.groupId, other.groupId, group.entryStateId, { copy: false }));
  await f.editor.deleteGroup(group.groupId); await f.editor.deleteGroup(other.groupId); assert.deepEqual(getDefinitions(f.scene), []);
});
test("two running groups halt, restart and change states independently", async () => {
  const f = sceneFixture(), a = await f.editor.createGroup({ name: "A" }), b = await f.editor.createGroup({ name: "B" }), next = await f.editor.createState(a.groupId, { name: "Next" });
  const calls = [], runtime = new GroupRuntime({ effects: {}, emitSignal: async (_scene, signal) => { calls.push(signal); return { allowed: true }; } });
  await runtime.enter(f.scene, a.entryStateId, { groupId: a.groupId }); await runtime.enter(f.scene, b.entryStateId, { groupId: b.groupId }); const other = clone(getRuntime(f.scene, { groupId: b.groupId }));
  await runtime.halt(f.scene, { groupId: a.groupId }); assert.deepEqual(getRuntime(f.scene, { groupId: b.groupId }), other);
  await runtime.enter(f.scene, next.id, { groupId: a.groupId }); assert.equal(getRuntime(f.scene, { groupId: a.groupId }).halted, false); assert.deepEqual(getRuntime(f.scene, { groupId: b.groupId }), other);
  assert.equal(calls.filter((signal) => signal.emitterKey === `Group:${b.groupId}` && signal.name === "started").length, 1);
});
test("an active owner must be halted before explicit object reassignment", async () => {
  const f = sceneFixture(), a = await f.editor.createGroup({ name: "A" }), b = await f.editor.createGroup({ name: "B" }), runtime = new GroupRuntime({ effects: {} });
  await f.objects.save(descriptor, { groupId: a.groupId }); await runtime.enter(f.scene, a.entryStateId, { groupId: a.groupId });
  await assert.rejects(f.objects.save(descriptor, { groupId: b.groupId }, { allowReassign: true })); await runtime.halt(f.scene, { groupId: a.groupId }); await f.objects.save(descriptor, { groupId: b.groupId }, { allowReassign: true }); assert.equal(f.objects.get(descriptor).groupId, b.groupId);
});
test("author metadata survives rename, copy, movement and scoped JSON", async () => {
  const f = sceneFixture(), a = await f.editor.createGroup({ name: "Weather", symbol: "🌦️", description: { ru: "Погода", en: "Weather" } }), b = await f.editor.createGroup({ name: "Other" });
  const state = await f.editor.createState(a.groupId, { name: "Clear", description: "Clear conditions", background: "#001122", textColor: "#aabbcc" });
  await f.editor.updateGroup(a.groupId, { name: "Sky", symbol: "☀️" }); await f.editor.updateState(a.groupId, state.id, { name: "Sun" });
  const moved = await f.editor.transferState(a.groupId, b.groupId, state.id, { copy: false }); assert.equal(moved.description, "Clear conditions"); assert.equal(moved.textColor, "#AABBCC");
  const receiver = new GroupEditor(f.create("receiver")), imported = await receiver.importGroup(f.editor.exportGroup(a.groupId)); assert.equal(imported.symbol, "☀️"); assert.deepEqual(imported.description, { ru: "Погода", en: "Weather" });
  const importedState = await receiver.importState(imported.groupId, f.editor.exportState(b.groupId, moved.id)); assert.equal(importedState.description, "Clear conditions");
});
test("optimistic group revisions reject stale edits without discarding newer content", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(); const original = f.editor.get(group.groupId);
  await f.editor.updateGroup(group.groupId, { name: "Updated" }, { expectedRevision: original.revision });
  const before = clone(f.scene.flags); await assert.rejects(f.editor.updateGroup(group.groupId, { name: "Stale" }, { expectedRevision: original.revision })); assert.deepEqual(f.scene.flags, before);
});
test("group symbols are single visible Unicode graphemes including composed emoji", () => {
  for (const value of ["A", "▥", "🌦️", "👨‍👩‍👧‍👦"]) assert.equal(normalizeGroupSymbol(value), value);
  for (const value of ["", "AB", "  ", "\u200b", "\n", "😀😀"]) assert.throws(() => normalizeGroupSymbol(value));
});
test("builtin and default descriptions have detached Russian and English content", () => {
  const f = sceneFixture(), catalog = builtinCatalog(f.scene), defaults = defaultDefinition();
  const entries = [...catalog.signals, ...catalog.signals.flatMap((signal) => [...signal.parameters, ...signal.returns]), defaults, ...defaults.states];
  for (const entry of entries) { assert.ok(entry.description.ru.trim()); assert.ok(entry.description.en.trim()); assert.equal(localizedDescription(entry.description, "ru"), entry.description.ru); }
  catalog.signals[0].description.ru = "Changed"; assert.notEqual(builtinCatalog(f.scene).signals[0].description.ru, "Changed");
});
test("authored descriptions remain literal and preserve locale maps", () => {
  const text = "  <b>literal</b>\nsecond line  "; assert.equal(normalizeDescription(text), text);
  const locales = { ru: "Описание", en: "Description" }; assert.deepEqual(normalizeDescription(locales), locales); assert.equal(localizedDescription(locales, "de"), "Description");
  for (const raw of [false, 7, [], { ru: "Missing English" }, { ru: "Text", en: 3 }, "x".repeat(4001)]) assert.throws(() => normalizeDescription(raw));
});
test("built-in contracts cannot be removed or changed but accept explicitly added custom fields", async () => {
  const f = sceneFixture(), builtin = f.catalog.list().signals.find((signal) => signal.name === "pauseChanged"); await assert.rejects(f.catalog.removeSignal(builtin.id));
  await assert.rejects(f.catalog.saveSignal({ ...builtin, name: "renamed" })); await assert.rejects(f.catalog.saveSignal({ ...builtin, parameters: [] }));
  const extended = await f.catalog.saveSignal({ ...builtin, parameters: [...builtin.parameters, { name: "Custom key!", type: "string", nullable: true, default: null }] });
  assert.equal(extended.parameters.length, builtin.parameters.length + 1);
  assert.deepEqual(validateParameters(extended, { sceneUuid: "Scene.map", paused: true }), { sceneUuid: "Scene.map", paused: true, "Custom key!": null });
});
