import test from "node:test";
import assert from "node:assert/strict";
import { SchemeEditor } from "../dmicher-master-screen/scripts/scheme-editor.js";
import { EventCatalog, builtinCatalog, getEventCatalog, validateTypedTrigger, normalizeCatalog } from "../dmicher-master-screen/scripts/event-catalog.js";
import { EpisodeRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { SceneEvents } from "../dmicher-master-screen/scripts/events.js";
import { createFoundryEffects } from "../dmicher-master-screen/scripts/effects.js";
import { MODULE_ID, defaultDefinition, normalizeDefinition, normalizeSchemeSymbol, normalizeDescription, localizedDescription } from "../dmicher-master-screen/scripts/model.js";
import { getDefinitions, getRuntime, getRuntimes, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { SceneObjects, resolveObjectShop } from "../dmicher-master-screen/scripts/scene-objects.js";
import { SceneAssets } from "../dmicher-master-screen/scripts/scene-assets.js";

const copy = (value) => structuredClone(value);
function fixture() {
  let id = 0, clock = 1000;
  const gm = { id: "gm", role: 4, isGM: true, active: true }, users = new Map([[gm.id, gm]]);
  globalThis.game = { user: gm, users, scenes: new Map(), modules: new Map(), paused: false, togglePause(value) { this.paused = value; } };
  globalThis.foundry = { utils: { randomID: () => `id${++id}` } };
  const scene = (name) => {
    const doc = { id: name, name, tokens: new Map(), tiles: new Map(), grid: { size: 100, distance: 5 }, flags: { [MODULE_ID]: { definitions: { main: defaultDefinition() } } },
      getFlag(module, key) { return copy(this.flags[module]?.[key]); },
      async setFlag(module, key, value) {
        const parts = key.split("."), root = this.flags[module] ??= {}; let node = root;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        const field = parts.at(-1), data = copy(value);
        if (data && typeof data === "object" && !Array.isArray(data)) for (const entry of Object.keys(data)) if (entry.startsWith("-=")) { delete data[entry.slice(2)]; delete data[entry]; }
        node[field] = data;
      },
      async update(changes) { for (const [path, value] of Object.entries(changes)) { const [, module, ...parts] = path.split("."); await this.setFlag(module, parts.join("."), value); } }
    };
    game.scenes.set(name, doc); return doc;
  };
  const current = scene("scene"); globalThis.canvas = { scene: current, tokens: { controlled: [] } };
  const calls = [], runtime = new EpisodeRuntime({ effects: { speak: async (...args) => calls.push(args), spawn: async () => {}, sound: async () => {}, macro: async () => false }, now: () => clock });
  const bus = new SceneEvents({ runtime }); runtime.onEvent = (scene, event) => bus.emit(scene, event);
  runtime.onTypedEvent = (...args) => bus.invoke(...args);
  runtime.report = (error) => { throw error; };
  return { scene: current, createScene: scene, editor: new SchemeEditor(current), catalog: new EventCatalog(current), runtime, bus, calls, advance(ms) { clock += ms; } };
}
async function registered(f, name = "alert", parameters = []) {
  const event = await f.catalog.saveEvent({ name, subscribers: [] });
  const trigger = await f.catalog.saveTrigger({ name: `${name}.signal`, eventId: event.id, parameters });
  return { event, trigger };
}

test("explicit object ownership cannot be reassigned until the current scheme is halted", async () => {
  const f = fixture(), second = await f.editor.createScheme({ name: "North" }), objects = new SceneObjects(f.scene);
  const target = { type: "Token", id: "npc" }; f.scene.tokens.set(target.id, { id: target.id, parent: f.scene });
  await objects.save(target, { schemeId: "main" }); await f.runtime.enter(f.scene, "calm");
  await assert.rejects(objects.save(target, { schemeId: second.schemeId }, { allowReassign: true }));
  await f.runtime.halt(f.scene);
  await objects.save(target, { schemeId: second.schemeId }, { allowReassign: true });
  await f.runtime.enter(f.scene, second.entryEpisodeId, { schemeId: second.schemeId });
  assert.ok(getRuntime(f.scene, { schemeId: second.schemeId }).episode.tokens.npc);
  assert.equal(objects.get(target).schemeId, second.schemeId);
  f.runtime.dispose(); f.bus.dispose();
});

test("100-character event names survive current catalog, binding, zone and routine references", async () => {
  const f = fixture(), name = "a".repeat(100), event = await f.catalog.saveEvent({ name, subscribers: [] });
  const trigger = await f.catalog.saveTrigger({ name: "long.event.signal", eventId: event.id, parameters: [] });
  const objects = new SceneObjects(f.scene), assets = new SceneAssets(f.scene);
  f.scene.tokens.set("npc", { id: "npc", parent: f.scene });
  const dialogue = await assets.saveDialogue({ name: "Greeting", pages: [{ id: "first", name: "First", text: "Hello", responses: [{ id: "done", label: "Bye", eventName: name }] }] });
  await objects.save({ type: "Token", id: "npc" }, { schemeId: "main", dialogue: { dialogueId: dialogue.id },
    routines: [{ episodeId: "calm", steps: [{ id: 1, kind: "event", parameters: { eventName: name, triggerId: trigger.id, parameters: {} }, next: [] }] }],
    features: [{ id: "signal", kind: "trigger", eventName: name, triggerId: trigger.id, parameters: {} }] });
  await f.editor.updateEpisode("main", "calm", { zones: [{ id: "zone", eventName: name }], interactions: [{ id: "touch", target: { type: "Token", id: "npc" }, eventName: name }] });
  await f.editor.updateEpisode("main", "tension", { events: [name] });
  const renamed = name.slice(0, -1) + "b"; await f.catalog.saveEvent({ ...event, name: renamed });
  const binding = objects.get({ type: "Token", id: "npc" }), definition = f.editor.get("main");
  assert.equal(binding.features[0].eventName, renamed); assert.equal(binding.routines[0].steps[0].parameters.eventName, renamed);
  assert.equal(assets.getDialogue(dialogue.id).pages[0].responses[0].eventName, renamed);
  assert.equal(definition.episodes[0].zones[0].eventName, renamed); assert.equal(definition.episodes[0].interactions[0].eventName, renamed); assert.deepEqual(definition.episodes[1].events, [renamed]);
  f.runtime.dispose(); f.bus.dispose();
});

test("schemes are independent ordered groups with unique names and copy/move/import", async () => {
  const f = fixture(), second = await f.editor.createScheme({ name: "North", background: "#aabbcc", textColor: "#123456" });
  assert.equal(f.editor.get(second.schemeId).background, "#AABBCC");
  await assert.rejects(f.editor.createScheme({ name: "north" }));
  const added = await f.editor.createEpisode(second.schemeId, { name: "Watch" });
  await assert.rejects(f.editor.createEpisode(second.schemeId, { name: "watch" }));
  await f.editor.reorderSchemes([second.schemeId, "main"]);
  assert.equal(f.editor.list()[0].schemeId, second.schemeId);
  const copied = await f.editor.transferEpisode("main", second.schemeId, "calm", { copy: true });
  assert.notEqual(copied.id, "calm"); assert.equal(f.editor.get("main").episodes.length, 4);
  await f.editor.transferEpisode("main", second.schemeId, "tension", { copy: false });
  assert.equal(f.editor.get("main").episodes.length, 3);
  await f.editor.reorderEpisodes(second.schemeId, ["tension", copied.id, added.id, second.episodes[0].id]);
  const receiver = new SchemeEditor(f.createScene("receiver"));
  const imported = await receiver.importScheme(f.editor.exportScheme(second.schemeId));
  assert.notEqual(imported.schemeId, second.schemeId); assert.equal(receiver.get(imported.schemeId).episodes[0].id, "tension");
});

test("two running schemes do not replay each other and halt/resume independently", async () => {
  const f = fixture(), second = await f.editor.createScheme({ name: "North" });
  const episode = await f.editor.createEpisode(second.schemeId, { name: "Watch" });
  await f.runtime.enter(f.scene, "calm"); await f.runtime.enter(f.scene, episode.id, { schemeId: second.schemeId });
  const original = getRuntime(f.scene).runId, another = getRuntime(f.scene, { schemeId: second.schemeId }).runId;
  await f.runtime.halt(f.scene, { schemeId: "main" });
  assert.equal(getRuntime(f.scene).halted, true); assert.equal(getRuntime(f.scene, { schemeId: second.schemeId }).runId, another);
  assert.equal(f.runtime.owns(f.scene, another), true); assert.equal(f.runtime.owns(f.scene, original), false);
  await f.runtime.enter(f.scene, "tension", { force: true });
  assert.equal(getRuntime(f.scene, { schemeId: second.schemeId }).runId, another);
  await f.runtime.haltAll(f.scene);
  assert.equal(getRuntime(f.scene, { schemeId: second.schemeId }).halted, true);
  f.runtime.dispose(); f.bus.dispose();
});

test("GM transitions are unrestricted; automation needs one explicit event route per scheme", async () => {
  const f = fixture(), { event, trigger } = await registered(f);
  await f.editor.updateEpisode("main", "tension", { allowFromAll: false, from: [], events: [event.name] });
  await assert.rejects(f.editor.updateEpisode("main", "alarm", { events: [event.name] }));
  await f.runtime.enter(f.scene, "calm"); await f.runtime.enter(f.scene, "alarm");
  await assert.rejects(f.runtime.enter(f.scene, "tension", { expectedRunId: getRuntime(f.scene).runId }));
  await f.bus.invoke(f.scene, event.name, { type: trigger.name }); await f.bus.whenIdle();
  assert.equal(getRuntime(f.scene).episodeId, "tension");
  f.runtime.dispose(); f.bus.dispose();
});

test("one scene event independently routes two schemes while a halted scheme is left alone", async () => {
  const f = fixture(), { event, trigger } = await registered(f);
  const second = await f.editor.createScheme({ name: "North" });
  const before = await f.editor.createEpisode(second.schemeId, { name: "Before" }), after = await f.editor.createEpisode(second.schemeId, { name: "After", events: [event.name] });
  await f.editor.updateEpisode("main", "tension", { events: [event.name] });
  await f.runtime.enter(f.scene, "calm"); await f.runtime.enter(f.scene, before.id, { schemeId: second.schemeId });
  await f.bus.invoke(f.scene, event.name, { type: trigger.name }); await f.bus.whenIdle();
  assert.equal(getRuntime(f.scene).episodeId, "tension"); assert.equal(getRuntime(f.scene, { schemeId: second.schemeId }).episodeId, after.id);
  await f.runtime.halt(f.scene, { schemeId: second.schemeId }); await f.runtime.enter(f.scene, "calm");
  await f.bus.invoke(f.scene, event.name, { type: trigger.name }); await f.bus.whenIdle();
  assert.equal(getRuntime(f.scene).episodeId, "tension"); assert.equal(getRuntime(f.scene, { schemeId: second.schemeId }).halted, true);
  f.runtime.dispose(); f.bus.dispose();
});

test("typed payloads enforce length, integer, finite float precision, boolean and unknown fields", async () => {
  const f = fixture(), { event, trigger } = await registered(f, "typed", [
    { name: "label", type: "string", minLength: 2, maxLength: 4 }, { name: "count", type: "integer", min: 1, max: 3 },
    { name: "speed", type: "number", min: 0, max: 2, decimals: 2 }, { name: "ready", type: "boolean" }
  ]);
  const value = { type: trigger.name, label: "good", count: 2, speed: 1.25, ready: true }, catalog = f.catalog.list();
  assert.deepEqual(validateTypedTrigger(catalog, event, value), value);
  for (const patch of [{ label: "x" }, { label: "longer" }, { count: 1.5 }, { count: "2" }, { speed: NaN }, { speed: 1.255 }, { speed: 3 }, { ready: "true" }, { other: 1 }, { type: "absent" }]) assert.throws(() => validateTypedTrigger(catalog, event, { ...value, ...patch }));
  assert.throws(() => normalizeCatalog({ events: [], triggers: [{ name: "x", eventId: event.id, parameters: [{ name: "x", type: "string", minLength: 4, maxLength: 2 }] }] }));
});

test("builtin descriptors are immutable in the service, not just in UI", async () => {
  const f = fixture(), [event] = f.catalog.list().events, [trigger] = f.catalog.list().triggers;
  await assert.rejects(f.catalog.saveEvent({ ...event, name: "edited" })); await assert.rejects(f.catalog.deleteEvent(event.id));
  await assert.rejects(f.catalog.saveTrigger({ ...trigger, name: "edited" })); await assert.rejects(f.catalog.deleteTrigger(trigger.id));
});

test("renaming an event preserves routing and internal trigger references", async () => {
  const f = fixture(), { event, trigger } = await registered(f);
  await f.editor.updateEpisode("main", "tension", { events: [event.name] });
  await f.catalog.saveEvent({ ...event, name: "new.alert" });
  assert.deepEqual(f.editor.get("main").episodes[1].events, ["new.alert"]);
  assert.equal(f.catalog.list().triggers.find((entry) => entry.id === trigger.id).eventId, event.id);
  assert.equal(f.catalog.list().events.some((entry) => entry.name === event.name), false);
});

test("Foundry native macro receives typed trigger, subscriber order and nested invoke stay deadlock-free", async () => {
  const f = fixture(), first = await registered(f, "first", [{ name: "value", type: "integer" }]), second = await registered(f, "second", [{ name: "value", type: "integer" }]);
  const calls = [];
  await f.catalog.saveMacro({ uuid: "Macro.first", triggerIds: [first.trigger.id] });
  await f.catalog.saveMacro({ uuid: "Macro.second", triggerIds: [second.trigger.id] });
  await f.catalog.saveEvent({ ...first.event, subscribers: [{ kind: "macro", macroUuid: "Macro.first" }, { kind: "trigger", triggerId: second.trigger.id, parameters: { value: 9 } }] });
  await f.catalog.saveEvent({ ...second.event, subscribers: [{ kind: "macro", macroUuid: "Macro.second" }] });
  globalThis.fromUuid = async (uuid) => ({ documentName: "Macro", type: "script", canExecute: true, async execute({ trigger }) {
    calls.push([uuid, trigger]); if (uuid === "Macro.first") await f.bus.invoke(f.scene, "second", { type: second.trigger.name, value: 4 });
  } });
  await f.runtime.enter(f.scene, "calm"); await f.bus.invoke(f.scene, "first", { type: first.trigger.name, value: 3 }); await f.bus.whenIdle();
  assert.deepEqual(calls.map(([uuid, trigger]) => [uuid, trigger.value]), [["Macro.first", 3], ["Macro.second", 4], ["Macro.second", 9]]);
  f.runtime.dispose(); f.bus.dispose();
});

test("cyclic typed subscriber dispatch stops visibly at a bounded chain", { timeout: 5000 }, async () => {
  const f = fixture(), { event, trigger } = await registered(f, "cycle");
  await f.catalog.saveEvent({ ...event, subscribers: [{ kind: "trigger", triggerId: trigger.id, parameters: {} }] });
  await f.runtime.enter(f.scene, "calm"); await f.bus.invoke(f.scene, event.name, { type: trigger.name }); await f.bus.whenIdle();
  const failed = getRuntime(f.scene).eventLog.find((entry) => entry.name === "cycle" && entry.status === "failed");
  assert.equal(failed.depth, 32); assert.match(failed.error, /32/);
  f.runtime.dispose(); f.bus.dispose();
});


test("scheme JSON carries event schemas and remaps scheme-gated triggers without copying live runs", async () => {
  const f = fixture(), { event, trigger } = await registered(f);
  await f.editor.updateEpisode("main", "tension", { events: [event.name] });
  const receiver = f.createScene("receiver"), editor = new SchemeEditor(receiver), imported = await editor.importScheme(f.editor.exportScheme("main"), { name: "Imported" });
  const catalog = getEventCatalog(receiver);
  assert.ok(catalog.events.some((entry) => entry.name === event.name)); assert.ok(catalog.triggers.some((entry) => entry.name === trigger.name));
  assert.equal(getRuntime(receiver, { schemeId: imported.schemeId }).runId, "");
  const receivingCatalog = new EventCatalog(receiver), local = catalog.events.find((entry) => entry.name === event.name);
  await receivingCatalog.saveEvent({ ...local, subscribers: [{ kind: "builtin", action: "pause" }] });
  await assert.rejects(editor.importScheme(f.editor.exportScheme("main"), { name: "Conflict" }));
  assert.equal(getDefinitions(receiver).some((entry) => entry.schemeName === "Conflict"), false);
});



test("a standalone trigger import resolves the receiving parent by name and rejects collisions", async () => {
  const f = fixture(), { event, trigger } = await registered(f, "portable", [{ name: "value", type: "integer", min: 0 }]);
  const receiver = f.createScene("receiver"), catalog = new EventCatalog(receiver), data = f.catalog.exportTrigger(trigger.id);
  await assert.rejects(catalog.importTrigger(data));
  const parent = await catalog.saveEvent({ name: event.name, subscribers: [] });
  const imported = await catalog.importTrigger(data);
  assert.equal(imported.eventId, parent.id); assert.notEqual(imported.id, trigger.id);
  await assert.rejects(catalog.importTrigger(data));
});

test("native macro invocation retains its old run even after GM halts and starts a new episode", async () => {
  const f = fixture(), first = await registered(f, "slow"), second = await registered(f, "late");
  await f.catalog.saveMacro({ uuid: "Macro.slow", triggerIds: [first.trigger.id] });
  await f.catalog.saveEvent({ ...first.event, subscribers: [{ kind: "macro", macroUuid: "Macro.slow" }] });
  await f.catalog.saveEvent({ ...second.event, subscribers: [{ kind: "builtin", action: "pause" }] });
  let release, started; const entered = new Promise((resolve) => { started = resolve; });
  globalThis.fromUuid = async () => ({ documentName: "Macro", type: "script", canExecute: true,
    async execute({ InvokeDmicherMasterScreenEvent }) {
      started(); await new Promise((resolve) => { release = resolve; });
      await InvokeDmicherMasterScreenEvent(second.event.name, { type: second.trigger.name });
    }
  });
  await f.runtime.enter(f.scene, "calm"); await f.bus.invoke(f.scene, first.event.name, { type: first.trigger.name }); await entered;
  await f.runtime.haltAll(f.scene); await f.runtime.enter(f.scene, "tension", { force: true });
  release(); await f.bus.whenIdle();
  assert.equal(game.paused, false); assert.equal(getRuntime(f.scene).eventLog.some((entry) => entry.name === second.event.name), false);
  assert.equal(getRuntime(f.scene).eventLog.find((entry) => entry.name === first.event.name).status, "stale");
  f.runtime.dispose(); f.bus.dispose();
});

test("event JSON includes nested event and typed trigger dependencies", async () => {
  const f = fixture(), outer = await registered(f, "outer"), inner = await registered(f, "inner", [{ name: "value", type: "integer" }]);
  await f.catalog.saveEvent({ ...outer.event, subscribers: [{ kind: "trigger", triggerId: inner.trigger.id, parameters: { value: 2 } }] });
  const receiver = f.createScene("receiver"), catalog = new EventCatalog(receiver);
  await catalog.importEvent(f.catalog.exportEvent(outer.event.id));
  const imported = catalog.list(), entry = imported.events.find((event) => event.name === "outer");
  assert.ok(imported.events.some((event) => event.name === "inner"));
  assert.equal(imported.triggers.find((trigger) => trigger.id === entry.subscribers[0].triggerId).name, inner.trigger.name);
});


test("expected revisions reject stale parameter snapshots without deleting newer settings or subscribers", async () => {
  const f = fixture(), definition = f.editor.get("main"), oldEpisode = copy(definition.episodes[0]);
  await f.editor.updateEpisode("main", "calm", { background: "#123456" });
  await assert.rejects(f.editor.updateEpisode("main", "calm", oldEpisode, { expectedRevision: definition.revision }));
  await assert.rejects(f.editor.updateScheme("main", { name: "Stale" }, { expectedRevision: definition.revision }));
  assert.equal(f.editor.get("main").episodes[0].background, "#123456");
  const { event, trigger } = await registered(f), revision = f.catalog.list().revision;
  await f.catalog.saveEvent({ ...event, subscribers: [{ kind: "builtin", action: "pause" }] });
  await assert.rejects(f.catalog.saveEvent(event, { expectedRevision: revision }));
  await assert.rejects(f.catalog.saveTrigger({ ...trigger, parameters: [] }, { expectedRevision: revision }));
  await assert.rejects(f.catalog.saveMacro({ uuid: "Macro.stale", triggerIds: [trigger.id] }, { expectedRevision: revision }));
  assert.equal(f.catalog.list().events.find((entry) => entry.id === event.id).subscribers.length, 1);
  assert.equal(f.catalog.list().macros.length, 0);
});


test("halting detaches an unresolved macro wait so a new run drains before the old promise settles", { timeout: 2000 }, async () => {
  const f = fixture(), first = await registered(f, "old.wait"), second = await registered(f, "fresh.run");
  await f.catalog.saveMacro({ uuid: "Macro.wait", triggerIds: [first.trigger.id] });
  await f.catalog.saveEvent({ ...first.event, subscribers: [{ kind: "macro", macroUuid: "Macro.wait" }] });
  await f.catalog.saveEvent({ ...second.event, subscribers: [{ kind: "builtin", action: "pause" }] });
  let started, rejectOld; const entered = new Promise((resolve) => { started = resolve; });
  globalThis.fromUuid = async () => ({ documentName: "Macro", type: "script", canExecute: true,
    execute() { started(); return new Promise((_resolve, reject) => { rejectOld = reject; }); } });
  await f.runtime.enter(f.scene, "calm"); await f.bus.invoke(f.scene, first.event.name, { type: first.trigger.name }); await entered;
  await f.runtime.haltAll(f.scene); await f.runtime.enter(f.scene, "tension", { force: true });
  await f.bus.invoke(f.scene, second.event.name, { type: second.trigger.name }, { context: null }); await f.bus.whenIdle();
  assert.equal(game.paused, true); assert.equal(f.bus.queue.length, 0); assert.equal(f.bus.waitingRuns.size, 0);
  const oldClaim = getRuntime(f.scene).eventLog.find((entry) => entry.name === first.event.name);
  const newClaim = getRuntime(f.scene).eventLog.find((entry) => entry.name === second.event.name);
  assert.equal(oldClaim.status, "stale"); assert.equal(newClaim.status, "done");
  rejectOld(new Error("Late rejection after detach")); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getRuntime(f.scene).eventLog.find((entry) => entry.name === second.event.name).status, "done");
  assert.equal(f.bus.context, null);
  f.runtime.dispose(); f.bus.dispose();
});


test("scheme symbols count Unicode graphemes and reject empty, multiple or invisible characters", () => {
  for (const symbol of ["🎬", "🌦️", "👩🏽‍🚀", "🇷🇺", "1️⃣", "A", "e\u0301", "◈"]) assert.equal(normalizeSchemeSymbol(symbol), symbol);
  assert.equal(normalizeSchemeSymbol(), "🎬");
  for (const symbol of ["", " ", "🎬🎥", "AB", "A ", "\n", "\u200D", "\uFE0F", "\u0301", "\u200B", "A\u202E", "\ud800", 5, null]) assert.throws(() => normalizeSchemeSymbol(symbol));
});

test("every built-in and default object has independent Russian and English descriptions", () => {
  const defaults = defaultDefinition(), catalog = builtinCatalog();
  const entries = [defaults, ...defaults.episodes, ...catalog.events, ...catalog.triggers, ...catalog.triggers.flatMap((entry) => entry.parameters)];
  for (const entry of entries) {
    assert.equal(typeof entry.description.ru, "string"); assert.equal(typeof entry.description.en, "string");
    assert.ok(entry.description.ru.trim().length > 10); assert.ok(entry.description.en.trim().length > 10);
    assert.equal(localizedDescription(entry.description, "ru"), entry.description.ru);
    assert.equal(localizedDescription(entry.description, "en"), entry.description.en);
  }
  catalog.events[0].description.ru = "changed"; catalog.triggers[0].parameters[0].description.en = "changed";
  assert.notEqual(builtinCatalog().events[0].description.ru, "changed"); assert.notEqual(builtinCatalog().triggers[0].parameters[0].description.en, "changed");
  defaults.description.ru = "changed"; assert.notEqual(defaultDefinition().description.ru, "changed");
});

test("description normalization preserves authored prose and locale maps without implicit object conversion", () => {
  const text = "  A <b>literal</b> description\nwith a second line.  ";
  assert.equal(normalizeDescription(text), text); assert.equal(localizedDescription(text, "en"), text);
  const locales = { ru: "Описание", en: "Description" }, normalized = normalizeDescription(locales);
  assert.deepEqual(normalized, locales); assert.notEqual(normalized, locales);
  assert.equal(localizedDescription(locales, "ru-RU"), "Описание"); assert.equal(localizedDescription(locales, "de"), "Description");
  for (const input of [false, 7, [], { ru: "Missing English" }, { ru: "Text", en: 3 }, { ru: "Text", en: "Text", code: "alert()" }, "x".repeat(4001)]) assert.throws(() => normalizeDescription(input));
});


test("scheme and episode metadata survives edits, rename, copying, movement and contextual JSON", async () => {
  const f = fixture(), scheme = await f.editor.createScheme({ name: "Weather", symbol: "🌦️", description: { ru: "Погода", en: "Weather" } });
  const episode = await f.editor.createEpisode(scheme.schemeId, { name: "Clear", description: "Clear conditions for this location." });
  await f.editor.updateScheme(scheme.schemeId, { name: "Sky", symbol: "☀️" });
  await f.editor.updateEpisode(scheme.schemeId, episode.id, { name: "Sun" });
  const stored = f.editor.get(scheme.schemeId);
  assert.deepEqual(stored.description, { ru: "Погода", en: "Weather" }); assert.equal(stored.symbol, "☀️");
  const copied = await f.editor.transferEpisode(scheme.schemeId, "main", episode.id, { copy: true });
  assert.equal(copied.description, episode.description);
  const envelope = f.editor.exportScheme(scheme.schemeId), receiver = new SchemeEditor(f.createScene("receiver"));
  const imported = await receiver.importScheme(envelope);
  assert.equal(receiver.get(imported.schemeId).symbol, "☀️"); assert.deepEqual(receiver.get(imported.schemeId).description, stored.description);
  assert.equal(receiver.get(imported.schemeId).episodes.find((entry) => entry.id === episode.id).description, episode.description);
  const another = await f.editor.createScheme({ name: "Elsewhere" });
  const moved = await f.editor.transferEpisode(scheme.schemeId, another.schemeId, episode.id, { copy: false });
  assert.equal(moved.description, episode.description);
  const standalone = await receiver.importEpisode("main", f.editor.exportEpisode(another.schemeId, moved.id), { name: "Imported Episode" });
  assert.equal(standalone.description, episode.description);
  const previous = copy(f.scene.flags); await assert.rejects(f.editor.updateScheme("main", { symbol: "AB" })); assert.deepEqual(f.scene.flags, previous);
});

test("event, trigger and parameter descriptions survive catalog editing and all contextual transfers", async () => {
  const f = fixture(), event = await f.catalog.saveEvent({ name: "typed.description", description: "Raised when a watch post reports danger.", subscribers: [] });
  const trigger = await f.catalog.saveTrigger({ name: "watch.report", eventId: event.id, description: { ru: "Донесение", en: "Report" },
    parameters: [{ name: "count", type: "integer", min: 1, max: 10, description: "Number of observed creatures." }] });
  await f.catalog.saveEvent({ ...event, name: "watch.danger" });
  const catalog = f.catalog.list(), storedEvent = catalog.events.find((entry) => entry.id === event.id), storedTrigger = catalog.triggers.find((entry) => entry.id === trigger.id);
  assert.equal(storedEvent.description, event.description); assert.deepEqual(storedTrigger.description, trigger.description);
  assert.equal(storedTrigger.parameters[0].description, trigger.parameters[0].description);
  const receiver = new EventCatalog(f.createScene("receiver")); await receiver.importEvent(f.catalog.exportEvent(event.id));
  const imported = receiver.list();
  assert.equal(imported.events.find((entry) => entry.name === "watch.danger").description, event.description);
  assert.deepEqual(imported.triggers.find((entry) => entry.name === trigger.name).description, trigger.description);
  assert.equal(imported.triggers.find((entry) => entry.name === trigger.name).parameters[0].description, trigger.parameters[0].description);
  const separate = new EventCatalog(f.createScene("separate")); await separate.saveEvent({ name: "watch.danger", subscribers: [] });
  await separate.importTrigger(f.catalog.exportTrigger(trigger.id));
  assert.equal(separate.list().triggers.find((entry) => entry.name === trigger.name).parameters[0].description, trigger.parameters[0].description);
});

test("built-in description edits remain rejected and prose does not alter typed validation", async () => {
  const f = fixture(), catalog = f.catalog.list(), event = catalog.events[0], trigger = catalog.triggers[0];
  await assert.rejects(f.catalog.saveEvent({ ...event, description: "changed" }));
  await assert.rejects(f.catalog.saveTrigger({ ...trigger, description: "changed", parameters: trigger.parameters.map((field) => ({ ...field, description: "changed" })) }));
  const custom = await registered(f, "constraint", [{ name: "value", type: "integer", min: 1, max: 3, description: "Documentation does not widen the range." }]);
  assert.throws(() => validateTypedTrigger(f.catalog.list(), custom.event, { type: custom.trigger.name, value: 4 }));
  assert.deepEqual(validateTypedTrigger(f.catalog.list(), custom.event, { type: custom.trigger.name, value: 2 }), { type: custom.trigger.name, value: 2 });
});

test("an untouched scene stays empty during reads, event catalog inspection and runtime ticks", async () => {
  const f = fixture(); f.scene.flags = {};
  const before = copy(f.scene.flags);
  assert.deepEqual(getDefinitions(f.scene), []); assert.deepEqual(f.editor.list(), []); assert.deepEqual(getRuntimes(f.scene), []);
  assert.ok(f.catalog.list().events.every((event) => event.builtin));
  await f.runtime.refresh(f.scene); await f.runtime.tick(); await f.runtime.haltAll(f.scene);
  assert.deepEqual(f.scene.flags, before);
  await assert.rejects(f.runtime.enter(f.scene, "calm")); await assert.rejects(saveRuntime(f.scene, { ...getRuntime(f.scene), runId: "invented" }));
  assert.deepEqual(f.scene.flags, before);
  f.runtime.dispose(); f.bus.dispose();
});

test("a scheme is created explicitly with one episode and its final episode cannot be removed or moved", async () => {
  const f = fixture(); f.scene.flags = {};
  const scheme = await f.editor.createScheme({ name: "Explicit" });
  assert.equal(f.editor.list().length, 1); assert.equal(scheme.episodes.length, 1);
  assert.equal(getRuntime(f.scene, { schemeId: scheme.schemeId }).runId, "");
  const other = await f.editor.createScheme({ name: "Other" });
  const before = copy(f.scene.flags);
  await assert.rejects(f.editor.deleteEpisode(scheme.schemeId, scheme.episodes[0].id));
  await assert.rejects(f.editor.transferEpisode(scheme.schemeId, other.schemeId, scheme.episodes[0].id, { copy: false }));
  assert.deepEqual(f.scene.flags, before);
  await f.editor.transferEpisode(scheme.schemeId, other.schemeId, scheme.episodes[0].id, { copy: true, name: "Copy" });
  assert.equal(f.editor.get(other.schemeId).episodes.length, 2);
});
