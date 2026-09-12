import test from "node:test";
import assert from "node:assert/strict";
import { exportBundle, importBundle, validateBundle, remapReferences } from "../dmicher-master-screen/scripts/transfer.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition as defaultDefinition } from "./fixtures/definitions.js";
import { getSignalCatalog } from "../dmicher-master-screen/scripts/signal-catalog.js";

const copy = (value) => structuredClone(value);
function fixture() {
  globalThis.game = { user: { id: "gm", isGM: true }, system: { id: "test-system" } };
  const created = [], deleted = [], calls = [], docs = new Map();
  let count = 0;
  const document = (type, id, data) => {
    const doc = { id, uuid: `${type}.${id}`, documentName: type, name: data.name,
      toObject: () => copy({ _id: id, ...data }), async delete() { deleted.push(this.uuid); },
      async update(changes) { for (const [key, value] of Object.entries(changes)) { const parts = key.split("."); let owner = data; for (const part of parts.slice(0, -1)) owner = owner[part] ??= {}; owner[parts.at(-1)] = copy(value); } } };
    docs.set(doc.uuid, doc);
    return doc;
  };
  globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
  globalThis.CONFIG = Object.fromEntries(["Actor", "Macro", "JournalEntry", "Scene"].map((type) => [type, { documentClass: {
    async create(data, options) {
      const recorded = { type, data: copy(data), options: copy(options) }; calls.push(recorded);
      const doc = document(type, `new${++count}`, recorded.data);
      created.push(doc);
      return doc;
    }
  } }]));
  const actor = document("Actor", "oldActor", { name: "Guard", type: "npc", ownership: { default: 3 }, items: [{ _id: "itemOriginal", name: "Sword", type: "weapon" }] });
  const macro = document("Macro", "oldMacro", { name: "Check", type: "script", command: "return true;" });
  const journal = document("JournalEntry", "oldJournal", { name: "Notes", pages: [{ _id: "oldPage", name: "Page", type: "text" }] });
  const page = { uuid: `${journal.uuid}.JournalEntryPage.oldPage`, documentName: "JournalEntryPage", parent: journal };
  docs.set(page.uuid, page);
  const definition = defaultDefinition();
  definition.states[0].workspace.gm = [{ uuid: page.uuid, x: 0, y: 0, width: 400, height: 300 }];
  const sceneData = { name: "Market", active: true, navigation: true, background: { src: "maps/market.webp" },
    tokens: [{ _id: "oldToken", actorId: actor.id, name: "Guard", x: 100, y: 100 }],
    flags: { [MODULE_ID]: { groupDefinitions: { main: definition }, signalCatalog: { macros: [{ ownerKey: "Token:oldToken", uuid: macro.uuid }] }, objectBindings: { bindings: { "Token:oldToken": { type: "Token", id: "oldToken", groupId: "main", scripts: [{ stateId: "calm", steps: [{ id: 1, kind: "macro", parameters: { macroUuid: macro.uuid }, next: [] }] }] } } }, groupRuntimes: { main: { runId: "LIVE" } } }, other: { preserved: true } }
  };
  const scene = document("Scene", "oldScene", sceneData);
  scene.tokens = new Map([["oldToken", sceneData.tokens[0]]]);
  scene.getFlag = (scope, key) => copy(sceneData.flags[scope]?.[key]);
  return { scene, sceneData, definition, actor, macro, journal, page, docs, document, created, deleted, calls };
}

test("scene export/import round trip keeps embedded IDs and remaps actors, macros and journal pages", async () => {
  const f = fixture();
  f.definition.symbol = "🌦️";
  f.definition.description = { ru: f.actor.uuid, en: "Imported weather group." };
  f.definition.states[0].description = "A quiet market before the storm.";
  const bundle = await exportBundle(f.scene);
  assert.equal(bundle.scene._id, undefined);
  assert.equal(bundle.scene.flags[MODULE_ID], undefined);
  assert.equal(bundle.scene.active, false);
  assert.equal(bundle.actors[0].data.ownership, undefined);
  assert.equal(bundle.macros.length, 1);
  assert.equal(bundle.journals.length, 1);
  const result = await importBundle(bundle);
  const sceneCall = f.calls.find((call) => call.type === "Scene");
  const actorCall = f.calls.find((call) => call.type === "Actor");
  const newActor = f.created.find((doc) => doc.documentName === "Actor");
  const newMacro = f.created.find((doc) => doc.documentName === "Macro");
  const newJournal = f.created.find((doc) => doc.documentName === "JournalEntry");
  assert.equal(sceneCall.data.tokens[0]._id, "oldToken");
  assert.equal(sceneCall.data.tokens[0].actorId, newActor.id);
  assert.equal(actorCall.data.items[0]._id, "itemOriginal");
  for (const call of f.calls) assert.equal(call.options.keepEmbeddedIds, true);
  const imported = sceneCall.data.flags[MODULE_ID].groupDefinitions.main;
  assert.equal(imported.symbol, "🌦️"); assert.deepEqual(imported.description, f.definition.description);
  assert.equal(imported.states[0].description, f.definition.states[0].description);
  assert.equal(sceneCall.data.flags[MODULE_ID].objectBindings.bindings["Token:oldToken"].scripts[0].steps[0].parameters.macroUuid, newMacro.uuid);
  assert.equal(imported.states[0].workspace.gm[0].uuid, `${newJournal.uuid}.JournalEntryPage.oldPage`);
  assert.equal(sceneCall.data.active, false);
  assert.equal(sceneCall.data.navigation, false);
  assert.equal(sceneCall.data.flags[MODULE_ID].groupRuntimes, undefined);
  assert.equal(result.scene.documentName, "Scene");
  assert.equal(f.deleted.length, 0);
});

test("Actor compendium spawn is included and its exact UUID maps to the new world Actor", async () => {
  const f = fixture();
  const compendium = f.document("Actor", "compendiumActor", { name: "Reinforcement", type: "npc" });
  f.docs.delete(compendium.uuid);
  compendium.uuid = "Compendium.test.actors.Actor.compendiumActor";
  f.docs.set(compendium.uuid, compendium);
  f.definition.states[2].spawns = [{ id: "reinforcement", actorUuid: compendium.uuid, x: 0, y: 0, count: 2, spacing: 100 }];
  const bundle = await exportBundle(f.scene);
  assert.equal(bundle.actors.length, 2);
  await importBundle(bundle);
  const sceneData = f.calls.find((call) => call.type === "Scene").data;
  const newActor = f.created.find((doc) => doc.name === "Reinforcement");
  assert.equal(sceneData.flags[MODULE_ID].groupDefinitions.main.states[2].spawns[0].actorUuid, newActor.uuid);
});

test("wrong format, version, system and malformed definitions produce no writes", async () => {
  const f = fixture();
  const good = await exportBundle(f.scene);
  for (const modify of [
    (b) => { b.format = "other"; }, (b) => { b.schemaVersion = 2; }, (b) => { b.systemId = "other"; },
    (b) => { delete b.definitions; }, (b) => { b.definitions[0].schemaVersion = 99; },
    (b) => { b.definition = b.definitions[0]; delete b.definitions; },
    (b) => { b.definitions = [null]; },
    (b) => { b.scene.name = {}; }, (b) => { b.scene.tokens = {}; }, (b) => { b.scene.notes = {}; },
    (b) => { b.actors[0].uuid = 123; }, (b) => { b.macros[0].data.name = {}; },
    (b) => { b.scene.tokens.push(copy(b.scene.tokens[0])); },
    (b) => { b.actors.push(copy(b.actors[0])); }
  ]) {
    const value = copy(good);
    modify(value);
    await assert.rejects(importBundle(value));
  }
  await assert.rejects(importBundle("{broken json"));
  assert.equal(f.calls.length, 0);
});

test("an empty scene exports and imports with zero groups and no synthetic running state", async () => {
  const f = fixture(); f.sceneData.flags[MODULE_ID] = { groupDefinitions: {} };
  const before = copy(f.sceneData.flags), bundle = await exportBundle(f.scene);
  assert.deepEqual(bundle.definitions, []); assert.equal(bundle.definition, undefined); assert.deepEqual(f.sceneData.flags, before);
  await importBundle(bundle);
  const scene = f.calls.find((call) => call.type === "Scene").data;
  assert.deepEqual(scene.flags[MODULE_ID].groupDefinitions, {});
  assert.equal(scene.flags[MODULE_ID].groupRuntimes, undefined); assert.equal(scene.flags[MODULE_ID].runtime, undefined);
});

test("non-GM cannot export or import even a valid bundle", async () => {
  const f = fixture();
  const bundle = await exportBundle(f.scene);
  game.user.isGM = false;
  await assert.rejects(exportBundle(f.scene));
  await assert.rejects(importBundle(bundle));
  assert.equal(f.calls.length, 0);
});

test("failed scene creation removes only this import's new dependencies in reverse order", async () => {
  const f = fixture();
  const bundle = await exportBundle(f.scene);
  CONFIG.Scene.documentClass.create = async () => { throw new Error("Scene failed"); };
  await assert.rejects(importBundle(bundle), /Scene failed/);
  assert.deepEqual(f.deleted, f.created.map((doc) => doc.uuid).reverse());
  assert.ok(!f.deleted.includes(f.actor.uuid));
  assert.ok(!f.deleted.includes(f.scene.uuid));
});

test("failed compensation reports the newly created documents still present", async () => {
  const f = fixture();
  const bundle = await exportBundle(f.scene);
  const originalCreate = CONFIG.Actor.documentClass.create;
  CONFIG.Actor.documentClass.create = async (...args) => {
    const doc = await originalCreate(...args);
    doc.delete = async () => { throw new Error("deletion refused"); };
    return doc;
  };
  CONFIG.Scene.documentClass.create = async () => { throw new Error("Scene failed"); };
  await assert.rejects(importBundle(bundle), /Actor.new1/);
  assert.equal(f.deleted.length, 2);
});

test("reference remapping keeps IDs, descriptions and unrelated paths intact", () => {
  const remapped = remapReferences({ raw: "oldToken", page: "JournalEntry.old.Page.page", media: "images/Actor.old.webp",
    description: { ru: "Actor.old", en: "JournalEntry.old.Page.page" } }, new Map([
    ["Actor.old", "Actor.new"], ["JournalEntry.old", "JournalEntry.new"]
  ]));
  assert.equal(remapped.raw, "oldToken");
  assert.equal(remapped.page, "JournalEntry.new.Page.page");
  assert.equal(remapped.media, "images/Actor.old.webp");
  assert.deepEqual(remapped.description, { ru: "Actor.old", en: "JournalEntry.old.Page.page" });
});

test("validating a bundle does not mutate the original export", async () => {
  const f = fixture();
  const bundle = await exportBundle(f.scene), before = copy(bundle);
  validateBundle(bundle);
  assert.deepEqual(bundle, before);
});

test("native map notes bring their Journal and retain Page IDs under the new Journal", async () => {
  const f = fixture();
  f.definition.states[0].workspace.gm = [];
  const note = { _id: "noteOriginal", entryId: f.journal.id, pageId: "oldPage", x: 500, y: 100 };
  f.scene.notes = new Map([[note._id, note]]);
  f.sceneData.notes = [note];
  const bundle = await exportBundle(f.scene);
  assert.equal(bundle.journals.length, 1);
  await importBundle(bundle);
  const sceneData = f.calls.find((call) => call.type === "Scene").data;
  const journal = f.created.find((doc) => doc.documentName === "JournalEntry");
  assert.equal(sceneData.notes[0].entryId, journal.id);
  assert.equal(sceneData.notes[0].pageId, "oldPage");
  assert.equal(sceneData.notes[0]._id, "noteOriginal");
});
test("whole scene import remaps native emitter IDs, built-in subscriptions and custom signal UUID values", async () => {
  const f = fixture(), source = f.sceneData.flags[MODULE_ID].signalCatalog;
  const builtin = getSignalCatalog(f.scene).signals.find((signal) => signal.emitterKey === "Scene:oldScene" && signal.name === "activated");
  source.signals = [{ ...builtin, parameters: [{ name: "optional", type: "string", nullable: true, default: null }] },
    { id: "custom", emitterKey: "Scene:oldScene", name: "Custom!", parameters: [{ name: "source", type: "string", default: "Scene.oldScene" }], returns: [] }];
  source.subscriptions = [{ id: "sub", ownerKey: "Token:oldToken", emitterKey: "Scene:oldScene", signalId: builtin.id, macroUuid: f.macro.uuid }];
  const bundle = await exportBundle(f.scene), result = await importBundle(bundle), installed = f.calls.find((call) => call.type === "Scene").data.flags[MODULE_ID].signalCatalog;
  const importedBuiltin = installed.signals.find((signal) => signal.name === "activated"), importedCustom = installed.signals.find((signal) => signal.id === "custom");
  assert.equal(importedBuiltin.emitterKey, `Scene:${result.scene.id}`); assert.equal(importedBuiltin.id, `builtin:Scene:${result.scene.id}:activated`);
  assert.equal(installed.subscriptions[0].signalId, importedBuiltin.id); assert.equal(installed.subscriptions[0].emitterKey, importedBuiltin.emitterKey);
  assert.equal(installed.subscriptions[0].ownerKey, "Token:oldToken"); assert.equal(installed.subscriptions[0].macroUuid, f.created.find((doc) => doc.documentName === "Macro").uuid);
  assert.equal(importedCustom.parameters[0].default, result.scene.uuid);
});
