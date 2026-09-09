import test from "node:test";
import assert from "node:assert/strict";
import { defaultDefinition, defaultTokenBehavior, MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { EpisodeRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { getRuntime } from "../dmicher-master-screen/scripts/store.js";
import { createShopService, getShopContext, shopEntries, validateTradeContext } from "../dmicher-master-screen/scripts/shop.js";
import { createDialogueService } from "../dmicher-master-screen/scripts/dialogues.js";
import { createManualDialogueService } from "../dmicher-master-screen/scripts/manual-dialogues.js";
import { listAvailableInteractions, evaluateInteractionPreview } from "../dmicher-master-screen/scripts/interaction-access.js";
import { resolveObjectShop } from "../dmicher-master-screen/scripts/scene-objects.js";
import { requestHalt } from "../dmicher-master-screen/scripts/execution.js";
import { SceneEvents } from "../dmicher-master-screen/scripts/events.js";

const copy = (value) => structuredClone(value);
async function fixture() {
  let serial = 0, writes = 0;
  const gm = { id: "gm", isGM: true, role: 4, active: true }, player = { id: "player", isGM: false, role: 1, active: true };
  const stranger = { id: "other", isGM: false, role: 1, active: true }, secondGM = { id: "gm-z", isGM: true, role: 4, active: true };
  globalThis.game = { user: gm, users: new Map([gm, player, stranger, secondGM].map((user) => [user.id, user])), modules: new Map(), scenes: new Map(), messages: new Map(), paused: false };
  globalThis.foundry = { utils: { randomID: () => `id-${++serial}` } };
  const actor = { id: "hero", items: new Map(), testUserPermission: (user) => user.id === player.id,
    async createEmbeddedDocuments(_type, sources) { return sources.map((source) => { const data = { ...copy(source), _id: source._id ?? `item-${++serial}` };
      const document = { ...data, id: data._id, toObject: () => copy(data) }; this.items.set(document.id, document); return document; }); },
    async deleteEmbeddedDocuments(_type, ids) { for (const id of ids) this.items.delete(id); } };
  const scene = { id: "map", grid: { size: 100, distance: 5 }, tokens: new Map(), tiles: new Map(), flags: { [MODULE_ID]: {} },
    getFlag(scope, key) { return copy(this.flags[scope]?.[key]); },
    async setFlag(scope, key, value) { writes++; let owner = this.flags[scope] ??= {}; const parts = key.split(".");
      for (const part of parts.slice(0, -1)) owner = owner[part] ??= {}; owner[parts.at(-1)] = copy(value); } };
  const make = (type, id, x, ownerActor) => { const document = { id, documentName: type, name: id, parent: scene, x, y: 0, width: type === "Token" ? 1 : 100, height: type === "Token" ? 1 : 100,
    actor: ownerActor, hidden: false, texture: { src: `${id}.webp` }, object: { checkCollision: () => false }, updates: [],
    async update(changes) { this.updates.push(copy(changes)); Object.assign(this, changes); } };
    scene[type === "Token" ? "tokens" : "tiles"].set(id, document); return document; };
  const pc = make("Token", "pc", 0, actor), waiter = make("Token", "waiter", 100), tile = make("Tile", "counter", 100);
  const flags = scene.flags[MODULE_ID];
  flags.definitions = Object.fromEntries(["main", "east"].map((schemeId) => [schemeId, { ...defaultDefinition(), schemeId, schemeName: schemeId }]));
  flags.interactionCatalog = { schemaVersion: 1, revision: 1,
    shops: [{ id: "stock", name: "Common shop", requireGMApproval: false, items: [{ id: "sword", stock: 2, data: { name: "Sword", type: "gear", system: { quantity: 7 } } }] }],
    dialogues: [{ id: "talk", name: "Common conversation", startPageId: "first", pages: [
      { id: "first", name: "Welcome", text: "Hello", art: "", responses: [{ id: "next", label: "Ask", nextPageId: "last", eventName: "" }] },
      { id: "last", name: "Answer", text: "Goodbye", art: "", responses: [{ id: "finish", label: "Done", nextPageId: "", eventName: "merchant.done" }] }
    ] }] };
  const binding = (type, id, schemeId) => ({ type, id, schemeId,
    shop: { shopId: "stock", episodeIds: ["calm"], range: 5, trigger: { repeat: "always" } },
    dialogue: { dialogueId: "talk", episodeIds: ["calm"], range: 5, trigger: { repeat: "always" } } });
  flags.objectBindings = { schemaVersion: 1, revision: 1, bindings: {
    "Token:waiter": binding("Token", "waiter", "main"), "Tile:counter": binding("Tile", "counter", "east"),
    "Token:pc": { type: "Token", id: "pc", schemeId: null, tags: ["hero"] }
  } };
  game.scenes.set(scene.id, scene); globalThis.canvas = { scene, tokens: { controlled: [] } };
  const runtime = new EpisodeRuntime({ effects: { speak: async () => {}, sound: async () => {}, spawn: async () => {} } });
  await runtime.enter(scene, undefined, { schemeId: "main" }); await runtime.enter(scene, undefined, { schemeId: "east" });
  const shop = createShopService(), emitted = [];
  const dialogues = createDialogueService({ emitEvent: async (_scene, event) => { emitted.push(copy(event)); } });
  const intent = (target = { type: "Token", id: "waiter" }, schemeId = "main", extra = {}) => ({ sceneId: scene.id, target, tokenId: target.id,
    shopId: "stock", actorTokenId: "pc", schemeId, runId: getRuntime(scene, { schemeId }).runId, ...extra });
  const message = (kind, payload, user = player) => {
    const record = { id: `message-${++serial}`, author: user, whisper: [gm.id, user.id], flags: { [kind]: copy(payload) },
      getFlag: (_module, key) => record.flags[key], async update(changes) { for (const [key, value] of Object.entries(changes)) if (key.startsWith(`flags.${MODULE_ID}.`)) record.flags[key.slice(`flags.${MODULE_ID}.`.length)] = copy(value); }, async delete() {} };
    game.messages.set(record.id, record); return record;
  };
  const dialogueCommand = async (command, user = player) => { const record = message("dialogueCommand", command, user);
    await dialogues.processCommand(record, user.id); return record.flags.dialogueResult; };
  return { scene, flags, gm, player, stranger, secondGM, pc, waiter, tile, actor, runtime, shop, dialogues, emitted, intent, message, dialogueCommand, writes: () => writes };
}

test("one catalog shop shares a lease and whole-Item stock between a Token and Tile in independent schemes", async () => {
  const f = await fixture();
  const first = await f.shop.requestSession(f.intent());
  await assert.rejects(f.shop.requestSession(f.intent({ type: "Tile", id: "counter" }, "east")));
  assert.equal(first.shopId, "stock"); assert.equal(first.actorId, "hero");
  const trade = { ...f.intent(), kind: "exchange", sessionId: first.sessionId, requestId: "one", giveItemIds: [], take: [{ entryId: "sword", count: 1 }] };
  assert.equal((await f.shop.requestTrade(trade)).status, "done");
  assert.equal([...f.actor.items.values()][0].system.quantity, 7);
  const counter = f.intent({ type: "Tile", id: "counter" }, "east"), lease = await f.shop.requestSession(counter);
  assert.equal(shopEntries(getShopContext(f.scene.id, counter.target, "east"))[0].stock, 1);
  assert.equal((await f.shop.requestTrade({ ...counter, kind: "exchange", sessionId: lease.sessionId, requestId: "two", giveItemIds: [], take: [{ entryId: "sword", count: 1 }] })).status, "done");
  assert.equal(f.flags.shopInventories.stock.items[0].stock, 0);
  assert.equal(f.actor.items.size, 2);
  assert.equal(f.shop.listSceneShops(f.scene).length, 1);
  assert.equal(f.shop.listSceneShops(f.scene)[0].sources.length, 2);
});

test("current bindings, actor identity, tags and source descriptor are rechecked on every shop command", async () => {
  const f = await fixture(), lease = await f.shop.requestSession(f.intent());
  const trade = { ...f.intent(), kind: "exchange", sessionId: lease.sessionId, requestId: "bad", giveItemIds: [], take: [{ entryId: "sword", count: 1 }] };
  await assert.rejects(f.shop.requestTrade({ ...trade, target: { type: "Tile", id: "counter" } }));
  const oldActor = f.pc.actor; f.pc.actor = { ...oldActor, id: "replacement" };
  await assert.rejects(f.shop.requestTrade(trade)); f.pc.actor = oldActor;
  f.flags.objectBindings.bindings["Token:waiter"].shop.trigger = { allowTags: ["hero"], denyTags: ["hero"] };
  await assert.rejects(f.shop.renewSession({ ...f.intent(), sessionId: lease.sessionId }));
  f.flags.objectBindings.bindings["Token:waiter"].shop = null;
  await assert.rejects(f.shop.requestTrade(trade));
  assert.equal(f.actor.items.size, 0);
});

test("catalog shop approval executes the authenticated offer once and rejects missing Items or unauthorized author", async () => {
  const f = await fixture(); f.flags.interactionCatalog.shops[0].requireGMApproval = true;
  const open = f.message("shopCommand", { ...f.intent(), kind: "open" }); await f.shop.processTradeRequest(open, f.player.id);
  const lease = open.flags.shopCommandResult.session;
  const offer = { ...f.intent(), kind: "exchange", sessionId: lease.sessionId, requestId: "offer", giveItemIds: [], take: [{ entryId: "sword", count: 1 }] };
  const bad = f.message("trade", { ...offer, requestId: "foreign", giveItemIds: ["foreign"] });
  assert.equal((await f.shop.processTradeRequest(bad, f.player.id)).status, "rejected");
  const message = f.message("trade", offer);
  assert.equal(await f.shop.processTradeRequest(message, f.stranger.id), null);
  assert.equal((await f.shop.processTradeRequest(message, f.player.id)).status, "pending");
  assert.equal(f.actor.items.size, 0);
  assert.equal((await f.shop.approveTrade(message.id)).status, "done");
  assert.equal((await f.shop.approveTrade(message.id)).status, "done");
  assert.equal(f.actor.items.size, 1);
});

test("dialogue asset requires its own object and keeps conversation pages, actor and event target bound", async () => {
  const f = await fixture(), start = { ...f.intent(), kind: "start", dialogueId: "talk" };
  assert.ok((await f.dialogueCommand({ ...start, target: undefined })).failure);
  const opened = await f.dialogueCommand(start);
  assert.equal(opened.text, "Hello"); assert.deepEqual(opened.target, start.target);
  const answer = { sceneId: f.scene.id, schemeId: "main", kind: "answer", sessionId: opened.sessionId, nodeId: "first", step: 0, responseId: "next" };
  assert.ok((await f.dialogueCommand({ ...answer, target: { type: "Tile", id: "counter" } })).failure);
  const next = await f.dialogueCommand(answer); assert.equal(next.text, "Goodbye");
  const ended = await f.dialogueCommand({ ...answer, nodeId: "last", step: 1, responseId: "finish" });
  assert.equal(ended.status, "finished");
  assert.deepEqual(f.emitted.map((event) => event.name), ["merchant.done", "dialogue.finished"]);
  assert.deepEqual(f.emitted[0].payload.target, start.target);
  const tileOpened = await f.dialogueCommand({ ...f.intent({ type: "Tile", id: "counter" }, "east"), kind: "start", dialogueId: "talk" });
  assert.equal(tileOpened.text, "Hello"); assert.notEqual(tileOpened.sessionId, opened.sessionId);
});

test("one scheme's halt blocks its conversations and trades while another scheme remains usable", async () => {
  const f = await fixture(), start = { ...f.intent(), kind: "start", dialogueId: "talk" };
  const opened = await f.dialogueCommand(start);
  await f.runtime.halt(f.scene, { schemeId: "main" });
  assert.ok((await f.dialogueCommand({ sceneId: f.scene.id, schemeId: "main", kind: "answer", sessionId: opened.sessionId, nodeId: "first", step: 0, responseId: "next" })).failure);
  await assert.rejects(f.shop.requestSession(f.intent()));
  const lease = await f.shop.requestSession(f.intent({ type: "Tile", id: "counter" }, "east")); assert.ok(lease.sessionId);
  await f.runtime.enter(f.scene, "calm", { schemeId: "main", force: true });
  assert.ok((await f.dialogueCommand(start)).failure, "old run start cannot replay after resume");
  assert.equal(f.emitted.length, 0);
});

test("readonly interaction menu and isolated condition preview consume no flags, sessions or events", async () => {
  const f = await fixture(), before = copy(f.flags), writes = f.writes();
  assert.deepEqual(listAvailableInteractions(f.scene, { type: "Token", id: "waiter" }, f.pc, f.player).map((entry) => entry.kind), ["shop", "dialogue"]);
  assert.deepEqual(listAvailableInteractions(f.scene, { type: "Token", id: "waiter" }, f.pc, f.stranger), []);
  const config = resolveObjectShop(f.scene, { type: "Token", id: "waiter" }, { schemeId: "main", episodeId: "calm" }).config;
  config.trigger = { allowTags: ["hero"], denyTags: ["outlaw"] };
  const preview = { config, kind: "shop", schemeId: "main", episodeId: "calm", tags: ["hero"], distance: 5 };
  assert.equal(evaluateInteractionPreview(preview).allowed, true);
  assert.equal(evaluateInteractionPreview({ ...preview, tags: ["hero", "outlaw"] }).allowed, false);
  assert.equal(evaluateInteractionPreview({ ...preview, visible: false }).allowed, false);
  assert.equal(evaluateInteractionPreview({ ...preview, used: 1 }).allowed, false);
  assert.deepEqual(f.flags, before); assert.equal(f.writes(), writes); assert.deepEqual(f.emitted, []);
});

test("initial object placement is claimed once and episode placement repeats only on explicit entry", async () => {
  const f = await fixture(); await f.runtime.halt(f.scene, { schemeId: "main" });
  delete f.flags.runtimes.main.objectEntries["Token:waiter"];
  const binding = f.flags.objectBindings.bindings["Token:waiter"];
  binding.entry = { position: { x: 200, y: 300 } }; binding.episodes = { tension: { position: { x: 400, y: 500 } } };
  await f.runtime.enter(f.scene, "calm", { schemeId: "main", force: true }); assert.equal(f.waiter.x, 200);
  await f.waiter.update({ x: 999 }); const updates = f.waiter.updates.length;
  await f.runtime.refresh(f.scene); assert.equal(f.waiter.updates.length, updates);
  await f.runtime.enter(f.scene, "calm", { schemeId: "main", force: true }); assert.equal(f.waiter.x, 999);
  await f.runtime.enter(f.scene, "tension", { schemeId: "main", force: true }); assert.equal(f.waiter.x, 400);
});

test("manual catalog dialogue works unbound after halt and sends presentation without automatic events", async () => {
  const f = await fixture(); await f.runtime.haltAll(f.scene); f.flags.objectBindings.bindings = {};
  const before = copy(f.flags), opened = [];
  const service = createManualDialogueService({ openWindow: async (view) => { opened.push(view); return view; } });
  const view = await service.openManualDialogue({ sceneId: f.scene.id, dialogueId: "talk", pageId: "last" });
  assert.equal(view.dialogue.startNodeId, "last"); assert.equal(view.dialogue.nodes[1].text, "Goodbye");
  assert.deepEqual(f.flags, before); assert.deepEqual(f.emitted, []);
});

test("immediate halt during an awaited Item creation cancels further lots and compensates the created one", async () => {
  const f = await fixture(), lease = await f.shop.requestSession(f.intent()), create = f.actor.createEmbeddedDocuments;
  f.actor.createEmbeddedDocuments = async function (...args) { const documents = await create.apply(this, args); requestHalt(f.scene, "main"); return documents; };
  const receipt = await f.shop.requestTrade({ ...f.intent(), kind: "exchange", sessionId: lease.sessionId, requestId: "halted", giveItemIds: [], take: [{ entryId: "sword", count: 2 }] });
  assert.equal(receipt.status, "failed"); assert.equal(f.actor.items.size, 0);
  assert.equal(shopEntries(getShopContext(f.scene.id, { type: "Token", id: "waiter" }, "main"))[0].stock, 2);
});

test("object feature subscriptions cannot execute after reassignment, removal or manual disable", async () => {
  const f = await fixture(), binding = f.flags.objectBindings.bindings["Token:waiter"], calls = [];
  binding.features = [{ id: "react", kind: "macro", enabled: true, episodeIds: ["calm"], eventName: "test.react", macroUuid: "Macro.react" }];
  await f.runtime.enter(f.scene, "calm", { force: true });
  const events = new SceneEvents({ runtime: f.runtime, executeMacro: async (uuid) => calls.push(uuid) });
  const fire = async (id) => { await events.emit(f.scene, { id, name: "test.react", schemeId: "main", runId: getRuntime(f.scene).runId }); await events.whenIdle(); };
  await fire("one"); assert.deepEqual(calls, ["Macro.react"]);
  f.flags.runtimes.main.disabledTokens.push("waiter"); await fire("two"); assert.equal(calls.length, 1);
  f.flags.runtimes.main.disabledTokens = []; binding.schemeId = "east"; await fire("three"); assert.equal(calls.length, 1);
  binding.schemeId = "main"; binding.features = []; await fire("four"); assert.equal(calls.length, 1);
  events.dispose();
});

test("legacy episode shop variants preserve the depleted NPC inventory and existing trigger keys", async () => {
  const f = await fixture(); delete f.flags.interactionCatalog; delete f.flags.objectBindings; f.flags.runtimes = {};
  for (const episode of f.flags.definitions.main.episodes.slice(0, 2)) episode.tokens.waiter = { ...defaultTokenBehavior(),
    shop: { enabled: true, range: 5, requireGMApproval: false, trigger: { repeat: "always", resetOnEntry: false }, items: [{ id: "sword", stock: 2, data: { name: "Sword", type: "gear" } }] } };
  f.flags.shopInventories = { waiter: { items: [{ id: "sword", stock: 1, data: { name: "Sword", type: "gear" } }] } };
  await f.runtime.enter(f.scene, "calm", { force: true });
  const target = { type: "Token", id: "waiter" }, current = getShopContext(f.scene.id, target, "main");
  const intent = { ...f.intent(target), shopId: current.shopId }, lease = await f.shop.requestSession(intent);
  assert.equal(f.flags.runtimes.main.triggerCounts["main:calm:shop:waiter"], 1);
  await f.shop.requestTrade({ ...intent, kind: "exchange", sessionId: lease.sessionId, requestId: "legacy", giveItemIds: [], take: [{ entryId: "sword", count: 1 }] });
  await f.runtime.enter(f.scene, "tension", { force: true });
  assert.equal(shopEntries(getShopContext(f.scene.id, target, "main"))[0].stock, 0);
  assert.equal(f.flags.shopInventories.waiter.items[0].stock, 0);
});

test("one native macro receives each subscribing NPC document without changing the original trigger", async () => {
  const f = await fixture(), second = { ...f.waiter, id: "server", name: "Second NPC", updates: [] };
  f.scene.tokens.set(second.id, second);
  const feature = { id: "react", kind: "macro", enabled: true, episodeIds: ["calm"], eventName: "test.object", macroUuid: "Macro.shared" };
  f.flags.objectBindings.bindings["Token:waiter"].features = [feature];
  f.flags.objectBindings.bindings["Token:server"] = { type: "Token", id: "server", schemeId: "main", features: [{ ...feature, id: "react-second" }] };
  await f.runtime.enter(f.scene, "calm", { force: true });
  const calls = [], previous = globalThis.fromUuid;
  globalThis.fromUuid = async (uuid) => { assert.equal(uuid, "Macro.shared"); return { documentName: "Macro", type: "script", canExecute: true,
    execute: async (scope) => { calls.push(scope); } }; };
  const events = new SceneEvents({ runtime: f.runtime });
  try {
    await events.emit(f.scene, { id: "two-npcs", name: "test.object", schemeId: "main", runId: getRuntime(f.scene).runId,
      payload: { value: 42 } });
    await events.whenIdle();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((scope) => scope.objectTarget), [{ type: "Token", id: "waiter" }, { type: "Token", id: "server" }]);
    assert.deepEqual(calls.map((scope) => scope.featureId), ["react", "react-second"]);
    assert.equal(calls[0].sceneObject, f.waiter); assert.equal(calls[1].sceneObject, second);
    for (const scope of calls) {
      assert.equal(scope.scene, f.scene);
      assert.deepEqual(scope.trigger, { type: "test.object", value: 42 });
      assert.deepEqual(scope.event.objectTarget, scope.objectTarget);
      assert.equal(scope.event.featureId, scope.featureId);
      assert.equal(typeof scope.InvokeDmicherMasterScreenEvent, "function");
    }
    f.flags.runtimes.main.disabledTokens.push("waiter");
    assert.throws(() => calls[0].InvokeDmicherMasterScreenEvent("test.object", { type: "test.object", value: 42 }));
    f.flags.runtimes.main.disabledTokens = [];
    globalThis.fromUuid = async () => {
      f.flags.runtimes.main.disabledTokens = ["waiter"];
      return { documentName: "Macro", type: "script", canExecute: true, execute: async (scope) => calls.push(scope) };
    };
    await events.emit(f.scene, { id: "disabled-during-resolution", name: "test.object", schemeId: "main", runId: getRuntime(f.scene).runId, payload: { value: 42 } });
    await events.whenIdle();
    assert.equal(calls.length, 3, "manual disable during fromUuid prevents the first NPC macro from starting");
    assert.equal(calls[2].sceneObject, second);
  } finally { events.dispose(); globalThis.fromUuid = previous; }
});

test("catalog edits preserve existing live lots and cannot forge unavailable stock", async () => {
  const f = await fixture(), target = { type: "Token", id: "waiter" };
  const prepared = f.flags.interactionCatalog.shops[0];
  const actual = () => shopEntries(getShopContext(f.scene.id, target, "main"));
  prepared.items[0].stock = 99;
  assert.equal(actual()[0].stock, 2, "editing initial stock does not replenish an existing lot");
  prepared.items = [];
  assert.equal(actual()[0].stock, 2, "removing preparation does not silently destroy existing stock");
  prepared.items.push({ id: "rope", stock: 3, data: { name: "Rope", type: "gear" } });
  assert.deepEqual(actual().map(({ id, stock }) => ({ id, stock })), [{ id: "sword", stock: 2 }, { id: "rope", stock: 3 }]);
  const lease = await f.shop.requestSession(f.intent());
  const base = { ...f.intent(), kind: "exchange", sessionId: lease.sessionId, giveItemIds: [] };
  const before = copy(f.flags);
  await assert.rejects(f.shop.requestTrade({ ...base, requestId: "forged", take: [{ entryId: "invented", count: 1, data: { name: "Forged", type: "gear" }, stock: 999 }] }));
  await assert.rejects(f.shop.requestTrade({ ...base, requestId: "overstock", take: [{ entryId: "sword", count: 3 }] }));
  assert.deepEqual(f.flags, before); assert.equal(f.actor.items.size, 0);
  assert.equal((await f.shop.requestTrade({ ...base, requestId: "existing", take: [{ entryId: "sword", count: 1 }] })).status, "done");
  assert.equal(f.flags.shopInventories.stock.items.find((entry) => entry.id === "sword").stock, 1);
});
