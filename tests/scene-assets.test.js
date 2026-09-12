import test from "node:test";
import assert from "node:assert/strict";
import { sceneFixture, clone, descriptor, shopData, dialogueData } from "./fixtures/scene.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition as defaultDefinition } from "./fixtures/definitions.js";
import { GroupEditor } from "../dmicher-master-screen/scripts/group-editor.js";
import { SceneAssets, getInteractionCatalog } from "../dmicher-master-screen/scripts/scene-assets.js";
import { SceneObjects, materializeState, resolveObjectTools } from "../dmicher-master-screen/scripts/scene-objects.js";
import { getSignalCatalog } from "../dmicher-master-screen/scripts/signal-catalog.js";
import { signalMacroSnippet } from "../dmicher-master-screen/scripts/signal-macros.js";
import { getDefinitions, getObjectTags } from "../dmicher-master-screen/scripts/store.js";
import { exportBundle, validateBundle, importBundle } from "../dmicher-master-screen/scripts/transfer.js";
const wait = (stateId) => ({ stateId, steps: [{ id: 1, kind: "wait", parameters: { seconds: 7 }, next: [18] }, { id: 18, kind: "wait", parameters: { seconds: 10 }, next: [] }] });

test("removed models are never inferred; current catalogs may be authored without any group", async () => {
  const f = sceneFixture(), old = defaultDefinition(); old.states[0].tokens = { npc: { shop: { items: shopData().items } } }; f.scene.flags[MODULE_ID].definitions = { main: old };
  const before = clone(f.scene.flags); assert.deepEqual(f.assets.list().shops, []); assert.deepEqual(f.objects.list().bindings, {}); assert.deepEqual(getDefinitions(f.scene), []); assert.deepEqual(f.scene.flags, before);
  await f.assets.saveShop(shopData()); await f.assets.saveDialogue(dialogueData()); assert.deepEqual(getDefinitions(f.scene), []); assert.equal(f.scene.getFlag(MODULE_ID, "groupRuntimes"), undefined);
});
test("catalog revisions, names and quantities reject invalid edits before writing", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData()), revision = f.assets.list().revision;
  assert.equal(shop.items[0].data.system.quantity, 7); await f.assets.saveShop({ ...shop, name: "Renamed" }, { expectedRevision: revision });
  await assert.rejects(f.assets.saveShop(shop, { expectedRevision: revision })); await assert.rejects(f.assets.saveShop(shopData("RENAMED")));
  await assert.rejects(f.assets.saveShop({ ...shopData("Another"), items: [{ ...shopData().items[0], stock: "2" }] }));
});
test("object ownership is exclusive; reassignment clears group controls but preserves notes and tags", async () => {
  const f = sceneFixture(), a = await f.editor.createGroup({ name: "North" }), b = await f.editor.createGroup({ name: "South" }), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { groupId: a.groupId, tags: ["merchant"], notes: "Note", scripts: [wait(a.entryStateId)], shops: [{ shopId: shop.id, stateIds: [a.entryStateId] }] });
  await assert.rejects(f.objects.save(descriptor, { groupId: b.groupId })); const revision = f.objects.list().revision;
  await f.objects.save(descriptor, { groupId: b.groupId }, { allowReassign: true, expectedRevision: revision });
  assert.deepEqual(f.objects.get(descriptor).scripts, []); assert.deepEqual(f.objects.get(descriptor).shops, []); assert.equal(f.objects.get(descriptor).notes, "Note"); assert.deepEqual(getObjectTags(f.scene, descriptor), ["merchant"]);
  await assert.rejects(f.objects.save(descriptor, { notes: "Stale" }, { expectedRevision: revision })); await f.objects.remove(descriptor); assert.equal(f.objects.get(descriptor).groupId, null);
});
test("an absent native object can be unbound without deleting its shared catalog", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { groupId: group.groupId, shops: [{ shopId: shop.id }] }); f.scene.tokens.delete("npc");
  await f.objects.remove(descriptor); await f.objects.remove(descriptor); assert.equal(f.objects.get(descriptor), null); assert.equal(f.assets.getShop(shop.id).id, shop.id);
});
test("multiple shops and dialogues are selected by state and may be shared by several objects", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), state = await f.editor.createState(group.groupId, { name: "Second" }), shops = [await f.assets.saveShop(shopData("A")), await f.assets.saveShop(shopData("B"))], talk = await f.assets.saveDialogue(dialogueData());
  const assignment = { groupId: group.groupId, shops: [{ shopId: shops[0].id, stateIds: [group.entryStateId] }, { shopId: shops[1].id, stateIds: [state.id] }], dialogues: [{ dialogueId: talk.id }] };
  await f.objects.save(descriptor, assignment); await f.objects.save({ type: "Tile", id: "counter" }, assignment);
  assert.equal(resolveObjectTools(f.scene, descriptor, { groupId: group.groupId, stateId: state.id }, "shop")[0].asset.id, shops[1].id);
  assert.equal(materializeState(f.scene, f.editor.get(group.groupId), f.editor.get(group.groupId).states[0]).shops.length, 2);
  await assert.rejects(f.assets.deleteShop(shops[0].id)); await assert.rejects(f.assets.deleteDialogue(talk.id));
  for (const target of [descriptor, { type: "Tile", id: "counter" }]) await f.objects.save(target, { shops: [], dialogues: [] });
  await f.assets.deleteShop(shops[0].id); await f.assets.deleteDialogue(talk.id);
});
test("deleting a restricted state removes its scripts and tool associations without widening availability", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), state = await f.editor.createState(group.groupId, { name: "Open" }), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { groupId: group.groupId, transitionScripts: { [state.id]: wait() }, scripts: [wait(state.id)], shops: [{ shopId: shop.id, stateIds: [state.id] }] });
  await f.editor.deleteState(group.groupId, state.id); const binding = f.objects.get(descriptor);
  assert.deepEqual(binding.scripts, []); assert.deepEqual(binding.transitionScripts, {}); assert.deepEqual(binding.shops, []);
  await f.editor.deleteGroup(group.groupId); assert.equal(f.objects.get(descriptor).groupId, null); assert.equal(f.assets.getShop(shop.id).id, shop.id);
});
test("script signals are owned by the object, typed, and protected against removing used definitions", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup();
  const signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Check!", parameters: [{ name: "count", type: "integer" }], returns: [] });
  const script = { stateId: group.entryStateId, steps: [{ id: 1, kind: "signal", parameters: { signalId: signal.id, parameters: { count: 2 } }, next: [] }] };
  await f.objects.save(descriptor, { groupId: group.groupId, scripts: [script] }); await assert.rejects(f.catalog.removeSignal(signal.id));
  script.steps[0].parameters.parameters.count = "2"; await assert.rejects(f.objects.save(descriptor, { scripts: [script] }));
  script.steps[0].parameters.parameters.count = 2; await assert.rejects(f.objects.save({ type: "Token", id: "pc" }, { groupId: group.groupId, scripts: [script] }));
  await f.catalog.saveSignal({ ...signal, name: "Renamed" }); assert.equal(f.objects.get(descriptor).scripts[0].steps[0].parameters.signalId, signal.id);
});
test("group JSON carries custom signals, object macro ownership and state-scoped tools atomically", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup({ name: "Market" }), shop = await f.assets.saveShop(shopData());
  const signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Own signal", parameters: [], returns: [] });
  f.macros.set("Macro.action", { documentName: "Macro", type: "script", command: "return true;" }); await f.catalog.attachMacro("Token:npc", "Macro.action");
  await f.objects.save(descriptor, { groupId: group.groupId, shops: [{ shopId: shop.id, stateIds: [group.entryStateId] }], scripts: [{ stateId: group.entryStateId, steps: [{ id: 1, kind: "signal", parameters: { signalId: signal.id }, next: [9] }, { id: 9, kind: "macro", parameters: { macroUuid: "Macro.action" }, next: [] }] }] });
  const envelope = f.editor.exportGroup(group.groupId), receiver = f.create("receiver"), editor = new GroupEditor(receiver), imported = await editor.importGroup(envelope);
  const binding = new SceneObjects(receiver).get(descriptor), catalog = getSignalCatalog(receiver), incomingSignal = catalog.signals.find((entry) => entry.name === signal.name);
  assert.equal(binding.groupId, imported.groupId); assert.equal(binding.scripts[0].steps[0].parameters.signalId, incomingSignal.id); assert.equal(incomingSignal.emitterKey, "Token:npc"); assert.ok(catalog.macros.some((entry) => entry.ownerKey === "Token:npc" && entry.uuid === "Macro.action"));
  const before = clone(receiver.flags); await assert.rejects(editor.importGroup(envelope, { name: "Conflict" })); assert.deepEqual(receiver.flags, before);
});
test("state JSON maps state restrictions and preserves established step identities", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { groupId: group.groupId, scripts: [wait(group.entryStateId)], shops: [{ shopId: shop.id, stateIds: [group.entryStateId], conditions: { stateIds: [group.entryStateId], groupIds: [group.groupId] } }] });
  const envelope = f.editor.exportState(group.groupId, group.entryStateId), copied = await f.editor.importState(group.groupId, envelope, { name: "Copy" });
  assert.deepEqual(f.objects.get(descriptor).scripts.map((script) => script.steps.map((step) => step.id)), [[1, 18], [1, 18]]);
  assert.ok(f.objects.get(descriptor).shops.some((ref) => ref.stateIds.includes(copied.id)));
  const receiver = f.create("receiver"), editor = new GroupEditor(receiver), target = await editor.createGroup({ name: "Receiving" }), imported = await editor.importState(target.groupId, envelope, { name: "Imported" });
  const binding = new SceneObjects(receiver).get(descriptor); assert.equal(binding.groupId, target.groupId); assert.deepEqual(binding.shops[0].stateIds, [imported.id]); assert.deepEqual(binding.shops[0].conditions.groupIds, [target.groupId]); assert.deepEqual(binding.shops[0].conditions.stateIds, [imported.id]);
});
test("scoped import binds a native scene signal subscription to the receiving scene", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup({ name: "Bound" }); await f.objects.save(descriptor, { groupId: group.groupId });
  const signal = f.catalog.list().signals.find((entry) => entry.emitterKey === "Scene:map" && entry.name === "activated");
  f.macros.set("Macro.observe", { documentName: "Macro", type: "script", command: signalMacroSnippet(signal) }); await f.catalog.attachMacro("Token:npc", "Macro.observe");
  await f.catalog.saveSubscription({ ownerKey: "Token:npc", emitterKey: signal.emitterKey, signalId: signal.id, macroUuid: "Macro.observe" });
  const receiver = f.create("receiver"); await new GroupEditor(receiver).importGroup(f.editor.exportGroup(group.groupId));
  const subscription = getSignalCatalog(receiver).subscriptions[0]; assert.equal(subscription.ownerKey, "Token:npc"); assert.equal(subscription.emitterKey, "Scene:receiver"); assert.equal(subscription.signalId, "builtin:Scene:receiver:activated");
});
test("player-character flags retain saved preparation but exclude automated state snapshots", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { groupId: group.groupId, playerCharacter: true, scripts: [wait(group.entryStateId)], shops: [{ shopId: shop.id }] });
  const materialized = materializeState(f.scene, group, group.states[0]); assert.deepEqual(materialized.scripts, []); assert.deepEqual(materialized.objects, []); assert.deepEqual(materialized.shops, []); assert.equal(f.objects.get(descriptor).shops.length, 1);
  await f.objects.save({ type: "Token", id: "pc" }, { playerCharacter: true }); assert.equal(f.objects.get({ type: "Token", id: "pc" }).groupId, null); await assert.rejects(f.objects.save({ type: "Tile", id: "counter" }, { playerCharacter: true }));
});
test("whole scene bundles contain catalogs and explicit bindings but no active execution", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), shop = await f.assets.saveShop(shopData()); await f.objects.save(descriptor, { groupId: group.groupId, shops: [{ shopId: shop.id }], notes: "Note" });
  const bundle = await exportBundle(f.scene); validateBundle(bundle); assert.equal(bundle.objectBindings.bindings["Token:npc"].shops[0].shopId, shop.id);
  let imported; globalThis.CONFIG = { Scene: { documentClass: { create: async () => { imported = f.create("imported"); return imported; } } } };
  await importBundle(bundle); assert.equal(imported.flags[MODULE_ID].objectBindings.bindings["Token:npc"].notes, "Note"); assert.equal(imported.flags[MODULE_ID].groupRuntimes, undefined);
  const empty = await exportBundle(f.create("empty")); validateBundle(empty); assert.deepEqual(empty.definitions, []);
});

test("group imports keep shop and dialogue identities separate when their source IDs coincide", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup({ name: "Shared identifiers" });
  const shop = await f.assets.saveShop({ ...shopData(), id: "shared" });
  const dialogue = await f.assets.saveDialogue({ ...dialogueData(), id: "shared" });
  await f.catalog.saveSignal({ emitterKey: "Shop:shared", name: "Shop signal", parameters: [], returns: [] });
  await f.catalog.saveSignal({ emitterKey: "Dialogue:shared", name: "Dialogue signal", parameters: [], returns: [] });
  await f.objects.save(descriptor, { groupId: group.groupId, shops: [{ shopId: shop.id }], dialogues: [{ dialogueId: dialogue.id }] });
  const receiver = f.create("receiver");
  await new GroupEditor(receiver).importGroup(f.editor.exportGroup(group.groupId));
  const binding = new SceneObjects(receiver).get(descriptor), catalog = getInteractionCatalog(receiver), signals = getSignalCatalog(receiver).signals;
  assert.notEqual(binding.shops[0].shopId, binding.dialogues[0].dialogueId);
  assert.equal(binding.shops[0].shopId, catalog.shops[0].id);
  assert.equal(binding.dialogues[0].dialogueId, catalog.dialogues[0].id);
  assert.equal(signals.find((signal) => signal.name === "Shop signal").emitterKey, `Shop:${catalog.shops[0].id}`);
  assert.equal(signals.find((signal) => signal.name === "Dialogue signal").emitterKey, `Dialogue:${catalog.dialogues[0].id}`);
});

test("state copies remap condition scopes without interpreting similarly named payload fields", async () => {
  const f = sceneFixture(), source = await f.editor.createGroup({ name: "Source" }), destination = await f.editor.createGroup({ name: "Destination" });
  const parameters = { groupIds: [source.groupId], stateIds: [source.entryStateId], nested: { groupIds: [source.groupId] } };
  await f.editor.updateState(source.groupId, source.entryStateId, { zones: [{ id: "zone", x: 0, y: 0, width: 10, height: 10,
    parameters, conditions: { groupIds: [source.groupId], stateIds: [source.entryStateId] } }] });
  const state = await f.editor.transferState(source.groupId, destination.groupId, source.entryStateId, { name: "Copied" });
  assert.deepEqual(state.zones[0].parameters, parameters);
  assert.deepEqual(state.zones[0].conditions.groupIds, [destination.groupId]);
  assert.deepEqual(state.zones[0].conditions.stateIds, [state.id]);
});

test("state materialization reads one catalog snapshot and returns detached runtime configuration", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), dialogue = await f.assets.saveDialogue(dialogueData());
  for (const target of [descriptor, { type: "Tile", id: "counter" }]) await f.objects.save(target, { groupId: group.groupId, dialogues: [{ dialogueId: dialogue.id }] });
  const read = f.scene.getFlag.bind(f.scene), reads = [];
  f.scene.getFlag = (scope, key) => { reads.push(key); return read(scope, key); };
  const result = materializeState(f.scene, group, group.states[0]);
  assert.deepEqual(reads, ["objectBindings", "interactionCatalog"]);
  assert.equal(result.dialogues.length, 2);
  assert.equal(result.dialogues[0].startPageId, "first");
  assert.equal(result.dialogues[0].nodes, undefined);
  result.dialogues[0].pages[0].text = "Changed runtime";
  assert.equal(result.dialogues[1].pages[0].text, "Welcome");
  assert.equal(f.assets.getDialogue(dialogue.id).pages[0].text, "Welcome");
});

test("rejected atomic group import leaves every related catalog untouched", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), dialogue = await f.assets.saveDialogue(dialogueData());
  await f.objects.save(descriptor, { groupId: group.groupId, dialogues: [{ dialogueId: dialogue.id }] });
  const receiver = f.create("receiver"), before = clone(receiver.flags), updates = [];
  receiver.update = async (fields) => { updates.push(fields); throw new Error("Document rejected"); };
  await assert.rejects(new GroupEditor(receiver).importGroup(f.editor.exportGroup(group.groupId)), /Document rejected/);
  assert.equal(updates.length, 1);
  for (const key of ["groupDefinitions", "interactionCatalog", "objectBindings", "signalCatalog"]) assert.ok(Object.hasOwn(updates[0], `flags.${MODULE_ID}.${key}`));
  assert.deepEqual(receiver.flags, before);
});

test("missing state JSON data never falls back to creating a new default state", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), before = clone(f.scene.flags);
  for (const data of [undefined, null, [], "state"]) {
    assert.throws(() => f.editor.importState(group.groupId, { format: MODULE_ID, kind: "state", version: 1, groupId: "source", data }));
  }
  assert.deepEqual(f.scene.flags, before);
});
