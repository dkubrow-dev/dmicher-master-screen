import test from "node:test";
import assert from "node:assert/strict";
import { SchemeEditor } from "../dmicher-master-screen/scripts/scheme-editor.js";
import { EventCatalog, getEventCatalog, validateTypedTrigger, normalizeCatalog } from "../dmicher-master-screen/scripts/event-catalog.js";
import { EpisodeRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { SceneEvents } from "../dmicher-master-screen/scripts/events.js";
import { createFoundryEffects } from "../dmicher-master-screen/scripts/effects.js";
import { MODULE_ID, defaultDefinition, defaultTokenBehavior } from "../dmicher-master-screen/scripts/model.js";
import { getDefinitions, getRuntime } from "../dmicher-master-screen/scripts/store.js";

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
  await f.editor.reorderEpisodes(second.schemeId, ["tension", copied.id, added.id]);
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

test("activating a scheme refuses to seize a token already automated by another", async () => {
  const f = fixture(), second = await f.editor.createScheme({ name: "North" });
  const token = { id: "npc", parent: f.scene, async update() {} }; f.scene.tokens.set(token.id, token);
  const config = defaultTokenBehavior();
  await f.editor.updateEpisode("main", "calm", { tokens: { npc: config } });
  const episode = await f.editor.createEpisode(second.schemeId, { name: "Watch", tokens: { npc: config } });
  await f.runtime.enter(f.scene, "calm"); await assert.rejects(f.runtime.enter(f.scene, episode.id, { schemeId: second.schemeId }));
  await f.runtime.setAutomation(f.scene, token.id, false); await f.runtime.enter(f.scene, episode.id, { schemeId: second.schemeId });
  await assert.rejects(f.runtime.setAutomation(f.scene, token.id, true));
  assert.equal(getRuntime(f.scene).disabledTokens.includes(token.id), true);
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

test("a pending patrol macro does not freeze speech ticks in another scheme", async () => {
  const f = fixture(), second = await f.editor.createScheme({ name: "North" });
  for (const id of ["guard", "vendor"]) f.scene.tokens.set(id, { id, parent: f.scene, x: 0, y: 0, width: 1, height: 1, object: {}, async update(changes) { Object.assign(this, changes); } });
  const guard = defaultTokenBehavior(), vendor = defaultTokenBehavior();
  guard.patrol = { enabled: true, speed: 5, points: [{ x: 0, y: 0, macroUuid: "Macro.wait" }] };
  vendor.speech = { interval: 1, phrases: ["Goods"], range: 30 };
  await f.editor.updateEpisode("main", "calm", { tokens: { guard } });
  const episode = await f.editor.createEpisode(second.schemeId, { name: "Market", tokens: { vendor } });
  let release, started; const entered = new Promise((resolve) => { started = resolve; });
  f.runtime.effects.macro = async () => { started(); return new Promise((resolve) => { release = resolve; }); };
  await f.runtime.enter(f.scene, "calm"); await f.runtime.enter(f.scene, episode.id, { schemeId: second.schemeId });
  f.advance(1000); const pending = f.runtime.tick(); await entered;
  const count = f.calls.length; f.advance(1000); await f.runtime.tick();
  assert.ok(f.calls.length > count); release(false); await pending;
  f.runtime.dispose(); f.bus.dispose();
});

test("changing schemes does not replenish a shared NPC shop's previous inventory", async () => {
  const f = fixture(), second = await f.editor.createScheme({ name: "North" }), config = defaultTokenBehavior();
  config.shop.enabled = true; config.shop.items = [{ id: "lot", stock: 10, data: { name: "Sword", type: "weapon" } }];
  f.scene.tokens.set("npc", { id: "npc", parent: f.scene });
  await f.editor.updateEpisode("main", "calm", { tokens: { npc: config } });
  const episode = await f.editor.createEpisode(second.schemeId, { name: "Trading", tokens: { npc: config } });
  await f.runtime.enter(f.scene, "calm");
  f.scene.flags[MODULE_ID].runtimes.main.shops.npc.items[0].stock = 2;
  await f.runtime.halt(f.scene); await f.runtime.enter(f.scene, episode.id, { schemeId: second.schemeId });
  assert.equal(getRuntime(f.scene, { schemeId: second.schemeId }).shops.npc.items[0].stock, 2);
  await f.scene.setFlag(MODULE_ID, "shopInventories.npc", { items: [{ id: "lot", stock: 1, data: { name: "Sword", type: "weapon" } }] });
  await f.runtime.halt(f.scene, { schemeId: second.schemeId }); await f.runtime.enter(f.scene, "calm", { force: true });
  assert.equal(getRuntime(f.scene).shops.npc.items[0].stock, 1);
  f.runtime.dispose(); f.bus.dispose();
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

test("catalog collection includes events referenced only by NPCs, patrols or zones", async () => {
  const f = fixture(), config = defaultTokenBehavior();
  config.interaction.eventName = "npc.only";
  config.patrol.points = [{ x: 0, y: 0, eventName: "patrol.only" }];
  await f.editor.updateEpisode("main", "calm", { tokens: { npc: config }, zones: [{ id: "zone", eventName: "zone.only" }] });
  const envelope = f.editor.exportScheme("main");
  assert.ok(["npc.only", "patrol.only", "zone.only"].every((name) => envelope.catalog.events.some((event) => event.name === name)));
  const receiver = f.createScene("receiver"); await new SchemeEditor(receiver).importScheme(envelope, { name: "Imported" });
  assert.ok(["npc.only", "patrol.only", "zone.only"].every((name) => getEventCatalog(receiver).events.some((event) => event.name === name)));
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

test("100-character event names survive each reference and catalogue rename", async () => {
  const f = fixture(), name = `a${"x".repeat(99)}`, event = await f.catalog.saveEvent({ name, subscribers: [] });
  const token = defaultTokenBehavior(); token.interaction.eventName = name; token.patrol.points = [{ x: 0, y: 0, eventName: name }];
  await f.editor.updateEpisode("main", "calm", { events: [name], tokens: { npc: token },
    subscriptions: [{ id: "sub", kind: "macro", event: name, macroUuid: "Macro.test" }],
    interactions: [{ id: "interaction", eventName: name }], zones: [{ id: "zone", eventName: name }],
    dialogues: [{ id: "dialogue", nodes: [{ id: "node", responses: [{ id: "answer", eventName: name }] }] }] });
  const episode = f.editor.get("main").episodes[0];
  const refs = [episode.events[0], episode.subscriptions[0].event, episode.interactions[0].eventName, episode.zones[0].eventName,
    episode.tokens.npc.interaction.eventName, episode.tokens.npc.patrol.points[0].eventName, episode.dialogues[0].nodes[0].responses[0].eventName];
  assert.equal(refs.every((entry) => entry === name), true);
  await f.catalog.saveEvent({ ...event, name: `b${"x".repeat(99)}` });
  assert.equal(f.editor.get("main").episodes[0].dialogues[0].nodes[0].responses[0].eventName.length, 100);
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

test("patrol native macros receive an origin-bound Invoke function after asynchronous work", async () => {
  const f = fixture(), { event, trigger } = await registered(f, "patrol.invoke");
  await f.catalog.saveEvent({ ...event, subscribers: [{ kind: "builtin", action: "pause" }] });
  const guard = defaultTokenBehavior(); guard.patrol = { enabled: true, speed: 5, points: [{ x: 0, y: 0, macroUuid: "Macro.patrol" }] };
  f.scene.tokens.set("guard", { id: "guard", parent: f.scene, actor: {}, object: {}, x: 0, y: 0, width: 1, height: 1, async update(changes) { Object.assign(this, changes); } });
  await f.editor.updateEpisode("main", "calm", { tokens: { guard } });
  let started, release, rejected = false; const entered = new Promise((resolve) => { started = resolve; });
  globalThis.fromUuid = async () => ({ documentName: "Macro", type: "script", canExecute: true,
    async execute({ InvokeDmicherMasterScreenEvent }) {
      started(); await new Promise((resolve) => { release = resolve; });
      try { await InvokeDmicherMasterScreenEvent(event.name, { type: trigger.name }); }
      catch { rejected = true; }
      return false;
    } });
  f.runtime.effects.macro = createFoundryEffects().macro;
  await f.runtime.enter(f.scene, "calm"); f.advance(1000); const patrol = f.runtime.tick(); await entered;
  await f.runtime.haltAll(f.scene); await f.runtime.enter(f.scene, "tension", { force: true });
  release(); await patrol; await f.bus.whenIdle();
  assert.equal(rejected, true); assert.equal(game.paused, false);
  f.runtime.dispose(); f.bus.dispose();
});
