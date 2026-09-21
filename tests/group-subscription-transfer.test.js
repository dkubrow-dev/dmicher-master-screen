import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { mergeCatalogDependencies, exportCatalogDependencies, removeSignalOwner } from "../dmicher-master-screen/scripts/signal-catalog.js";
import { sceneFixture, clone } from "./fixtures/scene.js";
import { GroupEditor } from "../dmicher-master-screen/scripts/group-editor.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { remapBindingSignals, remapCatalogReferences } from "../dmicher-master-screen/scripts/configuration-transfer.js";
import { exportBundle, importBundle } from "../dmicher-master-screen/scripts/transfer.js";

const signal = (id, emitterKey, name = id) => ({ id, emitterKey, name, parameters: [], returns: [] });
const subscription = (id, steps, patch = {}) => ({ id, ownerKey: "Group:main", emitterKey: "Scene:scene",
  signalId: "builtin:Scene:scene:activated", handler: "script", script: { steps }, ...patch });
const step = (id, kind, parameters) => ({ id, kind, parameters });

test("catalog merge preserves distinct inline handlers and remaps only typed references", () => {
  const f = fixture(), inputId = f.catalog.list().signals.find(entry => entry.emitterKey === "Scene:scene").id;
  const source = { signals: [signal("source-signal", "Group:main")], macros: [{ ownerKey: "Group:main", uuid: "Macro.original" }], subscriptions: [
    subscription("one", [step(1, "signal", { signalId: "source-signal", parameters: { signalId: "source-signal", groupId: "main" } }),
      step(2, "macro", { macroUuid: "Macro.original", signalId: inputId }),
      step(3, "state", { transitions: [{ groupId: "main", stateId: "calm" }, { groupId: "external", stateId: "calm" }] })], { signalId: inputId }),
    subscription("two", [step(1, "wait", { seconds: 2 })], { signalId: inputId })
  ] };
  const before = clone(source), idMapping = new Map(), subscriptionMapping = new Map();
  const merged = mergeCatalogDependencies(f.scene, source, { emitterMapping: new Map([["Group:main", "Group:copy"], ["Scene:scene", "Scene:target"]]),
    idMapping, subscriptionMapping, sourceGroupId: "main", groupId: "copy", stateMapping: new Map([["calm", "copied"]]), macroMapping: new Map([["Macro.original", "Macro.copy"]]) });
  assert.equal(merged.subscriptions.length, 2);
  const saved = merged.subscriptions[0]; assert.equal(saved.ownerKey, "Group:copy");
  assert.equal(saved.script.steps[0].parameters.signalId, idMapping.get("source-signal"));
  assert.deepEqual(saved.script.steps[0].parameters.parameters, before.subscriptions[0].script.steps[0].parameters.parameters);
  assert.equal(saved.script.steps[1].parameters.signalId, inputId.replace("Scene:scene", "Scene:target"));
  assert.equal(saved.script.steps[1].parameters.macroUuid, "Macro.copy"); assert.equal(merged.macros[0].uuid, "Macro.copy");
  assert.deepEqual(saved.script.steps[2].parameters.transitions, [{ groupId: "copy", stateId: "copied" }, { groupId: "external", stateId: "calm" }]);
  assert.equal(subscriptionMapping.get("one"), saved.id); assert.deepEqual(source, before); assert.equal(f.writes(), 0);
});

test("dependency export includes inline macro interfaces without following opaque payload IDs", () => {
  const f = fixture(); f.data.signalCatalog = { signals: [signal("input", "Scene:scene"), signal("interface", "Token:npc"), signal("opaque", "Token:other")],
    macros: [{ ownerKey: "Group:main", uuid: "Macro.inline" }], subscriptions: [subscription("one", [
      step(1, "macro", { macroUuid: "Macro.inline", signalId: "interface" }), step(2, "signal", { signalId: "interface", parameters: { signalId: "opaque" } })
    ], { signalId: "input" })] };
  const out = exportCatalogDependencies(f.scene, ["Group:main"]);
  assert.deepEqual(out.signals.map(entry => entry.id), ["input", "interface"]); assert.equal(out.macros[0].uuid, "Macro.inline"); assert.equal(f.writes(), 0);
});

test("owner removal refuses a surviving group's prepared transition but removes owned handlers", () => {
  const catalog = { subscriptions: [subscription("one", [step(1, "state", { transitions: [{ groupId: "other", stateId: "calm" }] })])] };
  const before = clone(catalog);
  assert.throws(() => removeSignalOwner(catalog, "Group:other")); assert.deepEqual(catalog, before);
  assert.equal(removeSignalOwner(catalog, "Group:main").subscriptions.length, 0);
});

test("group export/import preserves two inline scripts and retargets owned state actions", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup({ name: "Source" });
  const owner = { ownerKey: `Group:${group.groupId}`, emitterKey: "Scene:map", signalId: "builtin:Scene:map:activated" };
  f.scene.flags[MODULE_ID].signalCatalog = { subscriptions: [
    subscription("a", [step(1, "state", { transitions: [{ groupId: group.groupId, stateId: group.entryStateId }] })], owner),
    subscription("b", [step(1, "wait", { seconds: 2 })], owner)
  ] };
  const receiver = f.create("receiver"), imported = await new GroupEditor(receiver).importGroup(f.editor.exportGroup(group.groupId));
  const saved = receiver.flags[MODULE_ID].signalCatalog.subscriptions;
  assert.equal(saved.length, 2); assert.equal(saved[0].ownerKey, `Group:${imported.groupId}`);
  assert.deepEqual(saved[0].script.steps[0].parameters.transitions, [{ groupId: imported.groupId, stateId: group.entryStateId }]);
});

test("deleting a referenced state or group rejects before writes and leaves Players virtual", async () => {
  const f = sceneFixture(), owner = await f.editor.createGroup({ name: "Owner" }), destination = await f.editor.createGroup({ name: "Destination" });
  const used = await f.editor.createState(destination.groupId, { name: "Used" });
  f.scene.flags[MODULE_ID].signalCatalog = { subscriptions: [subscription("a", [step(1, "state", { transitions: [{ groupId: destination.groupId, stateId: used.id }] })],
    { ownerKey: `Group:${owner.groupId}`, emitterKey: "Scene:map", signalId: "builtin:Scene:map:activated" })] };
  const before = clone(f.scene.flags), writes = f.writes();
  await assert.rejects(f.editor.deleteState(destination.groupId, used.id));
  await assert.rejects(f.editor.deleteGroup(destination.groupId));
  assert.deepEqual(f.scene.flags, before); assert.equal(f.writes(), writes);
  assert.equal(f.scene.flags[MODULE_ID].groupDefinitions.players, undefined);
  await f.editor.deleteGroup(owner.groupId); assert.deepEqual(f.scene.flags[MODULE_ID].signalCatalog.subscriptions, []);
  await f.editor.deleteState(destination.groupId, used.id);
});

test("missing external state and detached macro references reject group import atomically", async () => {
  for (const kind of ["state", "macro", "signal"]) {
    const f = sceneFixture(), owner = await f.editor.createGroup({ name: "Owner" });
    const parameters = kind === "state" ? { transitions: [{ groupId: "missing", stateId: "missing" }] }
      : kind === "macro" ? { macroUuid: "Macro.detached" } : { signalId: "missing" };
    f.scene.flags[MODULE_ID].signalCatalog = { subscriptions: [subscription("a", [step(1, kind, parameters)],
      { ownerKey: `Group:${owner.groupId}`, emitterKey: "Scene:map", signalId: "builtin:Scene:map:activated" })] };
    const receiver = f.create("receiver"), before = clone(receiver.flags), writes = f.writes();
    await assert.rejects(new GroupEditor(receiver).importGroup(f.editor.exportGroup(owner.groupId)), kind);
    assert.deepEqual(receiver.flags, before); assert.equal(f.writes(), writes);
  }
});

test("native event import remaps its subscription identity and builtin macro interface together", () => {
  const f = fixture(), signalId = f.catalog.list().signals.find(entry => entry.emitterKey === "Scene:scene").id;
  const incoming = { subscriptions: [{ id: "old-event", ownerKey: "Token:npc", emitterKey: "Scene:scene", signalId, handler: "script" }] };
  const idMapping = new Map(), subscriptionMapping = new Map();
  const merged = mergeCatalogDependencies(f.scene, incoming, { emitterMapping: new Map([["Scene:scene", "Scene:target"]]), idMapping, subscriptionMapping });
  const binding = remapBindingSignals({ eventScripts: [{ subscriptionId: "old-event", script: { steps: [step(1, "macro", { macroUuid: "Macro.input", signalId })] } }], signals: { enabledIds: [signalId] } }, idMapping, subscriptionMapping);
  assert.equal(binding.eventScripts[0].subscriptionId, merged.subscriptions[0].id);
  assert.equal(binding.eventScripts[0].script.steps[0].parameters.signalId, merged.subscriptions[0].signalId);
  assert.deepEqual(binding.signals.enabledIds, [merged.subscriptions[0].signalId]);
});

test("full catalog remap preserves arbitrary inline payloads and transition source code", () => {
  const raw = { macros: [{ ownerKey: "Group:main", uuid: "Macro.old" }], subscriptions: [subscription("sub", [
    { ...step(1, "signal", { signalId: "custom", parameters: { uuid: "Macro.old", text: "Scene.old" } }), transition: { mode: "macro", macro: 'return [1]; // Macro.old' } },
    step(2, "macro", { macroUuid: "Macro.old", signalId: "builtin:Scene:old:activated" })
  ], { emitterKey: "Scene:old", signalId: "builtin:Scene:old:activated" })] };
  const before = clone(raw), mapped = remapCatalogReferences(raw, new Map([["Macro.old", "Macro.new"], ["Scene:old", "Scene:new"], ["Scene.old", "Scene.new"]]));
  assert.equal(mapped.subscriptions[0].script.steps[1].parameters.macroUuid, "Macro.new");
  assert.equal(mapped.subscriptions[0].script.steps[1].parameters.signalId, "builtin:Scene:new:activated");
  assert.deepEqual(mapped.subscriptions[0].script.steps[0], before.subscriptions[0].script.steps[0]); assert.deepEqual(raw, before);
});

test("full scene import validates inline destinations before creating any document", async () => {
  const f = sceneFixture(), owner = await f.editor.createGroup({ name: "Owner" });
  f.scene.flags[MODULE_ID].signalCatalog = { subscriptions: [subscription("a", [step(1, "state", { transitions: [{ groupId: "missing", stateId: "missing" }] })],
    { ownerKey: `Group:${owner.groupId}`, emitterKey: "Scene:map", signalId: "builtin:Scene:map:activated" })] };
  const bundle = await exportBundle(f.scene); let creates = 0;
  globalThis.CONFIG = { Scene: { documentClass: { create: async () => { creates++; return f.create("imported"); } } } };
  await assert.rejects(importBundle(bundle)); assert.equal(creates, 0);
});

test("copying one state remaps only its inline destination while retaining the original handler", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup({ name: "Owner" }), other = await f.editor.createState(group.groupId, { name: "Other" });
  f.scene.flags[MODULE_ID].signalCatalog = { subscriptions: [subscription("a", [
    step(1, "state", { transitions: [{ groupId: group.groupId, stateId: group.entryStateId }] }),
    step(2, "state", { transitions: [{ groupId: group.groupId, stateId: other.id }] })
  ], { ownerKey: `Group:${group.groupId}`, emitterKey: "Scene:map", signalId: "builtin:Scene:map:activated" })] };
  const original = clone(f.scene.flags[MODULE_ID].signalCatalog.subscriptions[0]);
  const copied = await f.editor.importState(group.groupId, f.editor.exportState(group.groupId, group.entryStateId), { name: "Copy" });
  const saved = f.scene.flags[MODULE_ID].signalCatalog.subscriptions;
  assert.equal(saved.length, 2); assert.notEqual(saved[0].id, saved[1].id);
  assert.deepEqual(saved[0].script.steps.map(row => row.parameters.transitions[0]), original.script.steps.map(row => row.parameters.transitions[0]));
  assert.deepEqual(saved[1].script.steps.map(row => row.parameters.transitions[0]), [{ groupId: group.groupId, stateId: copied.id }, { groupId: group.groupId, stateId: other.id }]);
});

test("full scene round trip keeps inline handlers and rebinds their native input signal", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup({ name: "Owner" });
  f.scene.flags[MODULE_ID].signalCatalog = { subscriptions: [subscription("a", [step(1, "state", { transitions: [{ groupId: group.groupId, stateId: group.entryStateId }] })],
    { ownerKey: `Group:${group.groupId}`, emitterKey: "Scene:map", signalId: "builtin:Scene:map:activated" })] };
  const bundle = await exportBundle(f.scene), before = clone(bundle);
  globalThis.CONFIG = { Scene: { documentClass: { create: async () => f.create("imported") } } };
  const result = await importBundle(bundle), saved = result.scene.flags[MODULE_ID].signalCatalog.subscriptions[0];
  assert.equal(saved.signalId, "builtin:Scene:imported:activated"); assert.equal(saved.emitterKey, "Scene:imported");
  assert.deepEqual(saved.script.steps[0].parameters.transitions, [{ groupId: group.groupId, stateId: group.entryStateId }]);
  assert.deepEqual(bundle, before);
});
