import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, defaultDefinition, defaultTokenBehavior } from "../dmicher-master-screen/scripts/model.js";
import { SchemeEditor } from "../dmicher-master-screen/scripts/scheme-editor.js";
import { SceneAssets, getInteractionCatalog } from "../dmicher-master-screen/scripts/scene-assets.js";
import { SceneObjects, getObjectBindings, materializeEpisode, resolveObjectShop, resolveObjectDialogue } from "../dmicher-master-screen/scripts/scene-objects.js";
import { EventCatalog, getEventCatalog } from "../dmicher-master-screen/scripts/event-catalog.js";
import { getDefinitions, getObjectTags, saveObjectTags } from "../dmicher-master-screen/scripts/store.js";
import { exportBundle, validateBundle, importBundle } from "../dmicher-master-screen/scripts/transfer.js";

const copy = (value) => structuredClone(value);
function merge(target, value) {
  for (const [key, next] of Object.entries(value)) {
    if (key.startsWith("-=")) { delete target[key.slice(2)]; continue; }
    if (next && typeof next === "object" && !Array.isArray(next)) { target[key] ??= {}; merge(target[key], next); }
    else target[key] = copy(next);
  }
}
function fixture() {
  let serial = 0, writes = 0;
  const gm = { id: "gm", isGM: true, role: 4, active: true };
  globalThis.game = { user: gm, users: new Map([[gm.id, gm]]), system: { id: "test" }, scenes: new Map(), modules: new Map() };
  globalThis.foundry = { utils: { randomID: () => `id${++serial}` } };
  const create = (id) => {
    const scene = { id, name: id, tokens: new Map(), tiles: new Map(), notes: new Map(), flags: { [MODULE_ID]: {} },
      getFlag(scope, key) { return copy(this.flags[scope]?.[key]); },
      async setFlag(scope, key, value) {
        writes++; let target = this.flags[scope] ??= {}; const parts = key.split(".");
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        merge(target, { [parts.at(-1)]: value });
      },
      async update(changes) { for (const [path, value] of Object.entries(changes)) { const [, scope, ...parts] = path.split("."); await this.setFlag(scope, parts.join("."), value); } },
      toObject() { return { _id: id, name: id, flags: copy(this.flags), tokens: [...this.tokens.values()].map(({ id, x, y }) => ({ _id: id, x, y })), tiles: [], notes: [] }; }
    };
    for (const tokenId of ["npc", "pc"]) scene.tokens.set(tokenId, { id: tokenId, name: tokenId, x: 0, y: 0, hidden: false });
    scene.tiles.set("counter", { id: "counter", name: "Counter", x: 0, y: 0, hidden: false });
    game.scenes.set(id, scene); return scene;
  };
  const scene = create("map");
  globalThis.canvas = { scene };
  globalThis.fromUuid = async () => null;
  return { scene, create, assets: new SceneAssets(scene), objects: new SceneObjects(scene), editor: new SchemeEditor(scene), events: new EventCatalog(scene), writes: () => writes };
}
const descriptor = { type: "Token", id: "npc" };
const shopData = (name = "Market") => ({ name, description: { ru: "Товары", en: "Goods" }, items: [{ id: "lot", data: { name: "Sword", type: "gear", system: { quantity: 7 } }, stock: 4 }] });
const dialogueData = (eventName = "") => ({ name: "Conversation", description: "A short greeting", pages: [{ id: "first", name: "Hello", text: "Welcome", responses: [{ id: "finish", label: "Bye", eventName }] }] });

test("independent catalogs can be authored on a truly empty scene without creating a scheme", async () => {
  const f = fixture(), initial = f.writes();
  assert.deepEqual(f.assets.list().shops, []); assert.deepEqual(f.objects.list().bindings, {}); assert.deepEqual(getDefinitions(f.scene), []);
  assert.equal(f.writes(), initial);
  const shop = await f.assets.saveShop(shopData()), dialogue = await f.assets.saveDialogue(dialogueData());
  assert.equal(f.assets.getShop(shop.id).items[0].data.system.quantity, 7);
  assert.equal(f.assets.getDialogue(dialogue.id).startPageId, "first");
  assert.deepEqual(getDefinitions(f.scene), []); assert.equal(f.scene.getFlag(MODULE_ID, "runtimes"), undefined);
  const revision = f.assets.list().revision;
  await f.assets.saveShop({ ...shop, name: "New market" }, { expectedRevision: revision });
  await assert.rejects(f.assets.saveDialogue(dialogue, { expectedRevision: revision }));
  await assert.rejects(f.assets.saveShop(shopData("new MARKET")));
  await assert.rejects(f.assets.saveShop({ ...shopData(), items: [{ ...shopData().items[0], stock: "2" }] }));
});

test("entry episode is valid, explicit, and protected from delete or move", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "North" }), other = await f.editor.createScheme({ name: "South" });
  assert.equal(scheme.episodes.length, 1); assert.equal(scheme.entryEpisodeId, scheme.episodes[0].id);
  const next = await f.editor.createEpisode(scheme.schemeId, { name: "Another" });
  await assert.rejects(f.editor.updateScheme(scheme.schemeId, { entryEpisodeId: "missing" }));
  await assert.rejects(f.editor.deleteEpisode(scheme.schemeId, scheme.entryEpisodeId));
  await assert.rejects(f.editor.transferEpisode(scheme.schemeId, other.schemeId, scheme.entryEpisodeId, { copy: false }));
  await f.editor.updateScheme(scheme.schemeId, { entryEpisodeId: next.id });
  await f.editor.deleteEpisode(scheme.schemeId, scheme.entryEpisodeId);
  assert.equal(f.editor.get(scheme.schemeId).entryEpisodeId, next.id);
  assert.equal(f.scene.getFlag(MODULE_ID, "runtimes"), undefined);
});

test("one object has one owner; reassign and release clear old controls while preserving descriptions", async () => {
  const f = fixture(), a = await f.editor.createScheme({ name: "North" }), b = await f.editor.createScheme({ name: "South" }), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { schemeId: a.schemeId, tags: ["merchant"], notes: "Note", episodes: { [a.entryEpisodeId]: { position: { x: 5, y: 6 } } }, shop: { shopId: shop.id, episodeIds: [a.entryEpisodeId], trigger: { schemeIds: [a.schemeId], episodeIds: [a.entryEpisodeId] } } });
  await assert.rejects(f.objects.save(descriptor, { schemeId: b.schemeId }));
  const revision = f.objects.list().revision;
  await f.objects.save(descriptor, { schemeId: b.schemeId }, { expectedRevision: revision, allowReassign: true });
  assert.deepEqual(f.objects.get(descriptor).episodes, {}); assert.equal(f.objects.get(descriptor).shop, null);
  assert.deepEqual(getObjectTags(f.scene, descriptor), ["merchant"]); assert.equal(f.objects.get(descriptor).notes, "Note");
  await assert.rejects(f.objects.save(descriptor, { notes: "Stale" }, { expectedRevision: revision }));
  await f.objects.remove(descriptor);
  assert.equal(f.objects.get(descriptor).schemeId, null); assert.equal(f.objects.get(descriptor).notes, "Note");
  assert.equal(f.scene.getFlag(MODULE_ID, "runtimes"), undefined);
});

test("catalog references are reusable and block deletion until explicitly unbound", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Market" }), shop = await f.assets.saveShop(shopData()), dialogue = await f.assets.saveDialogue(dialogueData());
  for (const target of [descriptor, { type: "Tile", id: "counter" }]) await f.objects.save(target, { schemeId: scheme.schemeId, shop: { shopId: shop.id }, dialogue: { dialogueId: dialogue.id } });
  await assert.rejects(f.assets.deleteShop(shop.id)); await assert.rejects(f.assets.deleteDialogue(dialogue.id));
  const episode = materializeEpisode(f.scene, f.editor.get(scheme.schemeId), f.editor.get(scheme.schemeId).episodes[0]);
  assert.equal(episode.shops.length, 2); assert.equal(episode.dialogues.length, 2); assert.equal(new Set(episode.shops.map((entry) => entry.shopId)).size, 1);
  const another = await f.editor.createScheme({ name: "Another" });
  await assert.rejects(f.editor.transferEpisode(scheme.schemeId, another.schemeId, scheme.entryEpisodeId));
  for (const target of [descriptor, { type: "Tile", id: "counter" }]) await f.objects.save(target, { shop: null, dialogue: null });
  await f.assets.deleteShop(shop.id); await f.assets.deleteDialogue(dialogue.id);
});

test("deleting a scoped episode cannot turn its restricted shop or feature into all-episode automation", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Market" }), next = await f.editor.createEpisode(scheme.schemeId, { name: "Open" }), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { schemeId: scheme.schemeId, episodes: { [next.id]: { hidden: true } }, shop: { shopId: shop.id, episodeIds: [next.id] }, features: [{ id: "patrol", kind: "patrol", episodeIds: [next.id], patrol: { speed: 5, points: [] } }] });
  await f.editor.deleteEpisode(scheme.schemeId, next.id);
  assert.deepEqual(f.objects.get(descriptor).episodes, {}); assert.equal(f.objects.get(descriptor).shop, null); assert.equal(f.objects.get(descriptor).features[0].enabled, false);
  await f.editor.deleteScheme(scheme.schemeId);
  assert.equal(f.objects.get(descriptor).schemeId, null); assert.equal(f.assets.getShop(shop.id).id, shop.id);
});

test("legacy preparation remains read-only and editing tags preserves distinct episode variants", async () => {
  const f = fixture(), definition = defaultDefinition();
  for (const [index, episode] of definition.episodes.slice(0, 2).entries()) {
    const behavior = defaultTokenBehavior(); behavior.shop = { ...behavior.shop, enabled: true, items: [{ ...shopData().items[0], stock: index + 2 }] }; episode.tokens.npc = behavior;
  }
  f.scene.flags[MODULE_ID].definitions = { main: definition };
  const before = copy(f.scene.flags), count = f.writes();
  const original = resolveObjectShop(f.scene, descriptor, { schemeId: "main", episodeId: "calm" });
  assert.notEqual(original.asset.id, resolveObjectShop(f.scene, descriptor, { schemeId: "main", episodeId: "tension" }).asset.id);
  assert.deepEqual(f.scene.flags, before); assert.equal(f.writes(), count);
  await saveObjectTags(f.scene, descriptor, ["merchant"]);
  assert.equal(resolveObjectShop(f.scene, descriptor, { schemeId: "main", episodeId: "calm" }).config.legacyInventoryKey, "npc");
  assert.equal(resolveObjectShop(f.scene, descriptor, { schemeId: "main", episodeId: "tension" }).config.items[0].stock, 3);
  await f.objects.save(descriptor, { shop: { shopId: original.asset.id } });
  assert.equal(resolveObjectShop(f.scene, descriptor, { schemeId: "main", episodeId: "tension" }).config.legacyInventoryKey, "npc");
  assert.equal(f.objects.get(descriptor).legacyVariants.length, 0);
});

test("object event features validate types, enforce one patrol, and protect referenced catalog records", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Guard" });
  const event = await f.events.saveEvent({ name: "guard.check" }), trigger = await f.events.saveTrigger({ name: "guard.result", eventId: event.id, parameters: [{ name: "value", type: "integer", min: 1, max: 5 }] });
  const feature = { id: "check", kind: "trigger", eventName: event.name, triggerId: trigger.id, parameters: { value: 2 } };
  await assert.rejects(f.objects.save(descriptor, { schemeId: scheme.schemeId, features: [{ ...feature, parameters: { value: "2" } }] }));
  await f.objects.save(descriptor, { schemeId: scheme.schemeId, features: [feature] });
  await assert.rejects(f.events.deleteEvent(event.id)); await assert.rejects(f.events.deleteTrigger(trigger.id));
  await assert.rejects(f.events.saveTrigger({ ...trigger, parameters: [{ name: "value", type: "boolean" }] }));
  await f.events.saveEvent({ ...event, name: "guard.new" });
  assert.equal(f.objects.get(descriptor).features[0].eventName, "guard.new");
  const episode = materializeEpisode(f.scene, f.editor.get(scheme.schemeId), f.editor.get(scheme.schemeId).episodes[0]);
  assert.equal(episode.subscriptions[0].target.id, "npc"); assert.equal(episode.subscriptions[0].parameters.value, 2);
  const patrol = { id: "one", kind: "patrol", patrol: { points: [] } };
  await assert.rejects(f.objects.save(descriptor, { features: [patrol, { ...patrol, id: "two" }] }));
  await assert.rejects(f.objects.save({ type: "Tile", id: "counter" }, { schemeId: scheme.schemeId, features: [patrol] }));
});

test("dialogue event rename updates independent pages and JSON imports the typed dependency", async () => {
  const f = fixture(), event = await f.events.saveEvent({ name: "greeting.done" });
  await f.events.saveTrigger({ name: "greeting.reply", eventId: event.id, parameters: [] });
  const dialogue = await f.assets.saveDialogue(dialogueData(event.name));
  await assert.rejects(f.events.deleteEvent(event.id));
  await f.events.saveEvent({ ...event, name: "greeting.finished" });
  assert.equal(f.assets.getDialogue(dialogue.id).pages[0].responses[0].eventName, "greeting.finished");
  const receiver = f.create("receiver"), imported = await new SceneAssets(receiver).importDialogue(f.assets.exportDialogue(dialogue.id));
  assert.equal(imported.pages[0].responses[0].eventName, "greeting.finished");
  assert.ok(getEventCatalog(receiver).triggers.some((entry) => entry.name === "greeting.reply"));
  assert.deepEqual(getDefinitions(receiver), []);
});

test("scheme JSON includes assets, ownership, typed features and rejects a receiving owner collision atomically", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Market" }), shop = await f.assets.saveShop(shopData());
  const event = await f.events.saveEvent({ name: "market.check" }), trigger = await f.events.saveTrigger({ name: "market.result", eventId: event.id, parameters: [{ name: "ok", type: "boolean" }] });
  const dialogue = await f.assets.saveDialogue(dialogueData(event.name));
  await f.objects.save(descriptor, { schemeId: scheme.schemeId, shop: { shopId: shop.id, episodeIds: [scheme.entryEpisodeId] }, dialogue: { dialogueId: dialogue.id }, features: [{ id: "check", kind: "trigger", eventName: event.name, triggerId: trigger.id, parameters: { ok: true } }] });
  const receiver = f.create("receiver"), editor = new SchemeEditor(receiver), imported = await editor.importScheme(f.editor.exportScheme(scheme.schemeId));
  const binding = new SceneObjects(receiver).get(descriptor), catalog = getInteractionCatalog(receiver);
  assert.equal(binding.schemeId, imported.schemeId); assert.equal(binding.shop.shopId, catalog.shops[0].id);
  assert.equal(resolveObjectDialogue(receiver, descriptor, { schemeId: imported.schemeId, episodeId: imported.entryEpisodeId }).config.nodes[0].responses[0].eventName, event.name);
  const before = copy(receiver.flags);
  await assert.rejects(editor.importScheme(f.editor.exportScheme(scheme.schemeId), { name: "Another" }));
  assert.deepEqual(receiver.flags, before);
});

test("scene bundles carry catalogs and explicit bindings without runtime or hidden defaults", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Market" }), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { schemeId: scheme.schemeId, shop: { shopId: shop.id }, notes: "Note" });
  const bundle = await exportBundle(f.scene); validateBundle(bundle);
  assert.equal(bundle.interactionCatalog.shops.length, 1); assert.equal(bundle.objectBindings.bindings["Token:npc"].shop.shopId, shop.id);
  assert.equal(bundle.scene.flags?.[MODULE_ID]?.runtimes, undefined);
  let imported;
  globalThis.CONFIG = { Scene: { documentClass: { async create(data) { imported = data; return { id: "imported" }; } } } };
  await importBundle(bundle);
  assert.equal(imported.flags[MODULE_ID].objectBindings.bindings["Token:npc"].notes, "Note");
  assert.equal(imported.flags[MODULE_ID].definitions[scheme.schemeId].entryEpisodeId, scheme.entryEpisodeId);
  const empty = await exportBundle(f.create("empty")); validateBundle(empty);
  assert.deepEqual(empty.definitions, []); assert.deepEqual(empty.interactionCatalog.shops, []);
});

test("episode JSON remaps its object scopes and can reuse an existing all-episode patrol without doubling it", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Guard" }), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { schemeId: scheme.schemeId, shop: { shopId: shop.id, episodeIds: [scheme.entryEpisodeId], trigger: { episodeIds: [scheme.entryEpisodeId] } },
    features: [{ id: "patrol", kind: "patrol", patrol: { speed: 5, points: [] } }] });
  const envelope = f.editor.exportEpisode(scheme.schemeId, scheme.entryEpisodeId);
  const imported = await f.editor.importEpisode(scheme.schemeId, envelope, { name: "Copy" });
  const binding = f.objects.get(descriptor);
  assert.equal(binding.features.length, 1);
  assert.ok(binding.shop.episodeIds.includes(imported.id));
  assert.ok(binding.shop.trigger.episodeIds.includes(scheme.entryEpisodeId));
  assert.ok(binding.shop.trigger.episodeIds.includes(imported.id));
  const receiver = f.create("receiver"), target = await new SchemeEditor(receiver).createScheme({ name: "Receiving" });
  const episode = await new SchemeEditor(receiver).importEpisode(target.schemeId, envelope, { name: "Imported" });
  const next = new SceneObjects(receiver).get(descriptor);
  assert.deepEqual(next.shop.episodeIds, [episode.id]); assert.deepEqual(next.shop.trigger.episodeIds, [episode.id]);
  assert.equal(next.schemeId, target.schemeId);
});

test("removing a deleted object clears explicit and legacy references without resurrecting its binding", async () => {
  const f = fixture(), definition = defaultDefinition(), behavior = defaultTokenBehavior();
  behavior.shop = { ...behavior.shop, enabled: true, items: shopData().items };
  definition.episodes[0].tokens.npc = behavior;
  f.scene.flags[MODULE_ID].definitions = { main: definition };
  f.scene.flags[MODULE_ID].objectTags = { Token: { npc: ["merchant"] } };
  await f.objects.save(descriptor, { notes: "Note" });
  const shopId = f.assets.list().shops[0].id;
  f.scene.tokens.delete("npc");
  await f.objects.remove(descriptor, { expectedRevision: f.objects.list().revision });
  assert.equal(f.objects.get(descriptor), null); assert.equal(getDefinitions(f.scene)[0].episodes[0].tokens.npc, undefined);
  assert.equal(f.assets.getShop(shopId).id, shopId); assert.deepEqual(getObjectTags(f.scene, descriptor), []);
  assert.equal(f.scene.getFlag(MODULE_ID, "runtimes"), undefined);
  await f.objects.remove(descriptor);
  assert.equal(f.objects.get(descriptor), null);
});

test("player character flags retain preparation but exclude all object automation from new snapshots", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Market" }), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { schemeId: scheme.schemeId, shop: { shopId: shop.id }, playerCharacter: true,
    entry: { position: { x: 25, y: 30 } }, routines: [{ episodeId: scheme.entryEpisodeId, steps: [{ id: 1, kind: "wait", parameters: { seconds: 1 }, next: [] }] }] });
  const snapshot = materializeEpisode(f.scene, f.editor.get(scheme.schemeId), f.editor.get(scheme.schemeId).episodes[0]);
  assert.equal(snapshot.tokens.npc, undefined); assert.deepEqual(snapshot.shops, []); assert.deepEqual(snapshot.objects, []); assert.deepEqual(snapshot.routines, []);
  assert.equal(f.objects.get(descriptor).shop.shopId, shop.id);
  await f.objects.save({ type: "Token", id: "pc" }, { playerCharacter: true, tags: ["hero"] });
  assert.equal(f.objects.get({ type: "Token", id: "pc" }).schemeId, null);
  await assert.rejects(f.objects.save(descriptor, { playerCharacter: "true" }));
  await assert.rejects(f.objects.save({ type: "Tile", id: "counter" }, { playerCharacter: true }));
});

test("legacy patrols are read projections until an explicit routine replaces their executor", async () => {
  const f = fixture(), definition = defaultDefinition(), behavior = defaultTokenBehavior();
  behavior.patrol = { enabled: true, speed: 5, points: [{ x: 10, y: 20, macroUuid: "Macro.old" }, { x: 30, y: 40 }] };
  behavior.entrySpeech = "Entry"; behavior.speech.phrases = ["Periodic"];
  definition.episodes[0].tokens.npc = behavior; f.scene.flags[MODULE_ID].definitions = { main: definition };
  const before = copy(f.scene.flags);
  assert.equal(f.objects.get(descriptor).routines[0].legacy, true); assert.deepEqual(f.scene.flags, before);
  await f.objects.save(descriptor, { notes: "Changed" });
  await f.objects.save(descriptor, { routines: f.objects.get(descriptor).routines });
  assert.deepEqual(f.scene.getFlag(MODULE_ID, "objectBindings").bindings["Token:npc"].routines, []);
  let snapshot = materializeEpisode(f.scene, getDefinitions(f.scene)[0], getDefinitions(f.scene)[0].episodes[0]);
  assert.equal(snapshot.tokens.npc.patrol.enabled, true); assert.equal(snapshot.routines.length, 0);
  await f.objects.save(descriptor, { routines: [{ episodeId: "calm", steps: [] }] });
  snapshot = materializeEpisode(f.scene, getDefinitions(f.scene)[0], getDefinitions(f.scene)[0].episodes[0]);
  assert.equal(snapshot.tokens.npc.patrol.enabled, false); assert.equal(snapshot.tokens.npc.entrySpeech, ""); assert.deepEqual(snapshot.tokens.npc.speech.phrases, []);
  assert.equal(snapshot.routines.length, 1); assert.deepEqual(snapshot.routines[0].steps, []);
  await f.objects.save(descriptor, { routines: [] });
  assert.deepEqual(f.objects.get(descriptor).routines, []);
  snapshot = materializeEpisode(f.scene, getDefinitions(f.scene)[0], getDefinitions(f.scene)[0].episodes[0]);
  assert.equal(snapshot.tokens.npc.patrol.enabled, false); assert.deepEqual(snapshot.tokens.npc.speech.phrases, []); assert.equal(snapshot.tokens.npc.entrySpeech, "");
  assert.deepEqual(f.objects.get(descriptor).routineOverrides, ["calm"]);
});

test("discarding a converted legacy routine before its first save still suppresses the original patrol", async () => {
  const f = fixture(), definition = defaultDefinition(), behavior = defaultTokenBehavior();
  behavior.patrol = { enabled: true, speed: 5, points: [{ x: 10, y: 20 }] };
  definition.episodes[0].tokens.npc = behavior; f.scene.flags[MODULE_ID].definitions = { main: definition };
  assert.equal(f.objects.get(descriptor).routines[0].legacy, true);
  await f.objects.save(descriptor, { routines: [] });
  assert.deepEqual(f.objects.get(descriptor).routines, []);
  assert.deepEqual(f.objects.get(descriptor).routineOverrides, ["calm"]);
  const snapshot = materializeEpisode(f.scene, getDefinitions(f.scene)[0], getDefinitions(f.scene)[0].episodes[0]);
  assert.equal(snapshot.tokens.npc.patrol.enabled, false);
});

test("routine events and macros participate in catalog reference checks, rename, and scoped JSON", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Market" }), event = await f.events.saveEvent({ name: "routine.done" });
  const trigger = await f.events.saveTrigger({ name: "routine.result", eventId: event.id, parameters: [{ name: "count", type: "integer" }] });
  await f.events.saveMacro({ uuid: "Macro.action", triggerIds: [trigger.id] });
  const steps = [{ id: 5, kind: "event", parameters: { eventName: event.name, triggerId: trigger.id, parameters: { count: 2 } }, next: [9] },
    { id: 9, kind: "macro", parameters: { macroUuid: "Macro.action", parameters: { note: "data" } }, next: [] }];
  await f.objects.save(descriptor, { schemeId: scheme.schemeId, routines: [{ episodeId: scheme.entryEpisodeId, steps }] });
  await assert.rejects(f.events.deleteTrigger(trigger.id)); await assert.rejects(f.events.removeMacro("Macro.action"));
  await assert.rejects(f.events.saveTrigger({ ...trigger, parameters: [{ name: "count", type: "boolean" }] }));
  const other = await f.events.saveEvent({ name: "other.event" });
  await assert.rejects(f.events.saveTrigger({ ...trigger, eventId: other.id }));
  await f.events.saveEvent({ ...event, name: "routine.complete" });
  assert.equal(f.objects.get(descriptor).routines[0].steps[0].parameters.eventName, "routine.complete");
  const receiver = f.create("receiver"), imported = await new SchemeEditor(receiver).importScheme(f.editor.exportScheme(scheme.schemeId));
  const binding = new SceneObjects(receiver).get(descriptor), catalog = getEventCatalog(receiver);
  assert.equal(binding.routines[0].episodeId, imported.entryEpisodeId);
  assert.equal(binding.routines[0].steps[0].parameters.triggerId, catalog.triggers.find((entry) => entry.name === trigger.name).id);
  assert.ok(catalog.macros.some((entry) => entry.uuid === "Macro.action"));
  const replacement = await f.editor.createEpisode(scheme.schemeId, { name: "New entry" });
  await f.editor.updateScheme(scheme.schemeId, { entryEpisodeId: replacement.id }); await f.editor.deleteEpisode(scheme.schemeId, scheme.entryEpisodeId);
  assert.deepEqual(f.objects.get(descriptor).routines, []);
});
