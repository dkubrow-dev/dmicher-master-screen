import test from "node:test";
import assert from "node:assert/strict";
import { defaultDefinition, MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { getRuntime } from "../dmicher-master-screen/scripts/store.js";
import { createShopService, getShopContext, shopEntries, validateTradeContext } from "../dmicher-master-screen/scripts/shop.js";
import { createDialogueService } from "../dmicher-master-screen/scripts/dialogues.js";
import { createManualDialogueService } from "../dmicher-master-screen/scripts/manual-dialogues.js";
import { listAvailableInteractions, evaluateInteractionPreview } from "../dmicher-master-screen/scripts/interaction-access.js";
import { resolveObjectShop } from "../dmicher-master-screen/scripts/scene-objects.js";
import { requestHalt } from "../dmicher-master-screen/scripts/execution.js";
import { SceneSignals } from "../dmicher-master-screen/scripts/signals.js";
import { SignalCatalog } from "../dmicher-master-screen/scripts/signal-catalog.js";
import { signalMacroSnippet } from "../dmicher-master-screen/scripts/signal-macros.js";

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
  flags.groupDefinitions = Object.fromEntries(["main", "east"].map((groupId) => [groupId, { ...defaultDefinition(), groupId, groupName: groupId }]));
  flags.interactionCatalog = { schemaVersion: 1, revision: 1,
    shops: [{ id: "stock", name: "Common shop", requireGMApproval: false, items: [{ id: "sword", stock: 2, data: { name: "Sword", type: "gear", system: { quantity: 7 } } }] }],
    dialogues: [{ id: "talk", name: "Common conversation", startPageId: "first", pages: [
      { id: "first", name: "Welcome", text: "Hello", art: "", responses: [{ id: "next", label: "Ask", nextPageId: "last", signalId: "" }] },
      { id: "last", name: "Answer", text: "Goodbye", art: "", responses: [{ id: "finish", label: "Done", nextPageId: "", signalId: "merchant-done", parameters: {} }] }
    ] }] };
  const binding = (type, id, groupId) => ({ type, id, groupId,
    shops: [{ shopId: "stock", stateIds: ["calm"], range: 5, conditions: { repeat: "always" } }],
    dialogues: [{ dialogueId: "talk", stateIds: ["calm"], range: 5, conditions: { repeat: "always" } }] });
  flags.objectBindings = { schemaVersion: 1, revision: 1, bindings: {
    "Token:waiter": binding("Token", "waiter", "main"), "Tile:counter": binding("Tile", "counter", "east"),
    "Token:pc": { type: "Token", id: "pc", groupId: null, tags: ["hero"] }
  } };
  flags.signalCatalog = { signals: [{ id: "merchant-done", name: "merchant.done", emitterKey: "Dialogue:talk" }] };
  game.scenes.set(scene.id, scene); globalThis.canvas = { scene, tokens: { controlled: [] } };
  const runtime = new GroupRuntime({ effects: { speak: async () => {}, sound: async () => {}, spawn: async () => {} } });
  await runtime.enter(scene, undefined, { groupId: "main" }); await runtime.enter(scene, undefined, { groupId: "east" });
  const emitted = [], bus = new SceneSignals({ runtime });
  const emitSignal = async (scene, signal) => { emitted.push(copy(signal)); return bus.emit(scene, signal); };
  const shop = createShopService({ emitSignal }), dialogues = createDialogueService({ emitSignal });
  const intent = (target = { type: "Token", id: "waiter" }, groupId = "main", extra = {}) => ({ sceneId: scene.id, target, tokenId: target.id,
    shopId: "stock", actorTokenId: "pc", groupId, runId: getRuntime(scene, { groupId }).runId, ...extra });
  const message = (kind, payload, user = player) => {
    const record = { id: `message-${++serial}`, author: user, whisper: [gm.id, user.id], flags: { [kind]: copy(payload) },
      getFlag: (_module, key) => record.flags[key], async update(changes) { for (const [key, value] of Object.entries(changes)) if (key.startsWith(`flags.${MODULE_ID}.`)) record.flags[key.slice(`flags.${MODULE_ID}.`.length)] = copy(value); }, async delete() {} };
    game.messages.set(record.id, record); return record;
  };
  const dialogueCommand = async (command, user = player) => { const record = message("dialogueCommand", command, user);
    await dialogues.processCommand(record, user.id); return record.flags.dialogueResult; };
  return { scene, flags, gm, player, stranger, secondGM, pc, waiter, tile, actor, runtime, shop, dialogues, emitted, intent, message, dialogueCommand, writes: () => writes };
}

test("one catalog shop shares a lease and whole-Item stock between a Token and Tile in independent groups", async () => {
  const f = await fixture();
  const first = await f.shop.requestSession(f.intent());
  await assert.rejects(f.shop.requestSession(f.intent({ type: "Tile", id: "counter" }, "east")));
  assert.equal(first.shopId, "stock"); assert.equal(first.actorId, "hero");
  const trade = { ...f.intent(), kind: "exchange", sessionId: first.sessionId, requestId: "one", giveItemIds: [], take: [{ entryId: "sword", count: 1 }] };
  assert.equal((await f.shop.requestTrade(trade)).status, "done");
  assert.equal([...f.actor.items.values()][0].system.quantity, 7);
  const counter = f.intent({ type: "Tile", id: "counter" }, "east"), lease = await f.shop.requestSession(counter);
  assert.equal(shopEntries(getShopContext(f.scene.id, counter.target, "east", "stock"))[0].stock, 1);
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
  f.flags.objectBindings.bindings["Token:waiter"].shops[0].conditions = { allowTags: ["hero"], denyTags: ["hero"] };
  await assert.rejects(f.shop.renewSession({ ...f.intent(), sessionId: lease.sessionId }));
  f.flags.objectBindings.bindings["Token:waiter"].shops = [];
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
  const answer = { sceneId: f.scene.id, groupId: "main", kind: "answer", sessionId: opened.sessionId, nodeId: "first", step: 0, responseId: "next" };
  assert.ok((await f.dialogueCommand({ ...answer, target: { type: "Tile", id: "counter" } })).failure);
  const next = await f.dialogueCommand(answer); assert.equal(next.text, "Goodbye");
  const ended = await f.dialogueCommand({ ...answer, nodeId: "last", step: 1, responseId: "finish" });
  assert.equal(ended.status, "finished");
  assert.deepEqual(f.emitted.map((event) => event.name), ["opened", "response", "response", "merchant.done", "closed"]);
  assert.equal(f.emitted[0].parameters.objectUuid, "Scene.map.Token.waiter");
  const tileOpened = await f.dialogueCommand({ ...f.intent({ type: "Tile", id: "counter" }, "east"), kind: "start", dialogueId: "talk" });
  assert.equal(tileOpened.text, "Hello"); assert.notEqual(tileOpened.sessionId, opened.sessionId);
});

test("one group's halt blocks its conversations and trades while another group remains usable", async () => {
  const f = await fixture(), start = { ...f.intent(), kind: "start", dialogueId: "talk" };
  const opened = await f.dialogueCommand(start);
  await f.runtime.halt(f.scene, { groupId: "main" });
  assert.ok((await f.dialogueCommand({ sceneId: f.scene.id, groupId: "main", kind: "answer", sessionId: opened.sessionId, nodeId: "first", step: 0, responseId: "next" })).failure);
  await assert.rejects(f.shop.requestSession(f.intent()));
  const lease = await f.shop.requestSession(f.intent({ type: "Tile", id: "counter" }, "east")); assert.ok(lease.sessionId);
  await f.runtime.enter(f.scene, "calm", { groupId: "main", force: true });
  assert.ok((await f.dialogueCommand(start)).failure, "old run start cannot replay after resume");
  assert.equal(f.emitted.some((packet) => packet.name === "response"), false);
});

test("readonly interaction menu and isolated condition preview consume no flags, sessions or events", async () => {
  const f = await fixture(), before = copy(f.flags), writes = f.writes();
  assert.deepEqual(listAvailableInteractions(f.scene, { type: "Token", id: "waiter" }, f.pc, f.player).map((entry) => entry.kind), ["shop", "dialogue"]);
  assert.deepEqual(listAvailableInteractions(f.scene, { type: "Token", id: "waiter" }, f.pc, f.stranger), []);
  const config = resolveObjectShop(f.scene, { type: "Token", id: "waiter" }, { groupId: "main", stateId: "calm" }).config;
  config.conditions = { allowTags: ["hero"], denyTags: ["outlaw"] };
  const preview = { config, kind: "shop", groupId: "main", stateId: "calm", tags: ["hero"], distance: 5 };
  assert.equal(evaluateInteractionPreview(preview).allowed, true);
  assert.equal(evaluateInteractionPreview({ ...preview, tags: ["hero", "outlaw"] }).allowed, false);
  assert.equal(evaluateInteractionPreview({ ...preview, visible: false }).allowed, false);
  assert.equal(evaluateInteractionPreview({ ...preview, used: 1 }).allowed, false);
  assert.deepEqual(f.flags, before); assert.equal(f.writes(), writes); assert.deepEqual(f.emitted, []);
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
  assert.equal(shopEntries(getShopContext(f.scene.id, { type: "Token", id: "waiter" }, "main", "stock"))[0].stock, 2);
});

test("catalog edits preserve existing live lots and cannot forge unavailable stock", async () => {
  const f = await fixture(), target = { type: "Token", id: "waiter" };
  const opened = await f.shop.requestSession(f.intent()); await f.shop.releaseSession({ ...f.intent(), sessionId: opened.sessionId });
  const prepared = f.flags.interactionCatalog.shops[0];
  const actual = () => shopEntries(getShopContext(f.scene.id, target, "main", "stock"));
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
test("one object offers multiple shops with separate identities, sessions and inventories", async () => {
  const f = await fixture(), owner = f.flags.objectBindings.bindings["Token:waiter"];
  f.flags.interactionCatalog.shops.push({ id: "second", name: "Second shop", requireGMApproval: false, items: [{ id: "rope", stock: 1, data: { name: "Rope", type: "gear" } }] });
  owner.shops.push({ shopId: "second", stateIds: ["calm"], range: 5, conditions: { repeat: "always" } });
  const target = { type: "Token", id: "waiter" };
  assert.deepEqual(listAvailableInteractions(f.scene, target, f.pc, f.player).filter((entry) => entry.kind === "shop").map((entry) => entry.id), ["stock", "second"]);
  const first = await f.shop.requestSession(f.intent()), second = await f.shop.requestSession(f.intent(target, "main", { shopId: "second" }));
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(getShopContext(f.scene.id, target, "main", "second").asset.name, "Second shop");
  await assert.rejects(f.shop.requestTrade({ ...f.intent(target, "main", { shopId: "second" }), kind: "exchange", sessionId: first.sessionId, requestId: "wrong", giveItemIds: [], take: [{ entryId: "rope", count: 1 }] }));
  assert.equal((await f.shop.requestTrade({ ...f.intent(target, "main", { shopId: "second" }), kind: "exchange", sessionId: second.sessionId, requestId: "right", giveItemIds: [], take: [{ entryId: "rope", count: 1 }] })).status, "done");
  assert.equal(shopEntries(getShopContext(f.scene.id, target, "main", "stock"))[0].stock, 2);
  assert.equal(f.flags.shopInventories.second.items[0].stock, 0);
});
test("two dialogues on one object keep separate pages and cannot exchange session identities", async () => {
  const f = await fixture(), owner = f.flags.objectBindings.bindings["Token:waiter"];
  const alternate = copy(f.flags.interactionCatalog.dialogues[0]); alternate.id = "alternate"; alternate.name = "Alternative"; alternate.pages[0].text = "Another topic";
  alternate.pages[1].responses[0].signalId = "";
  f.flags.interactionCatalog.dialogues.push(alternate); owner.dialogues.push({ dialogueId: "alternate", stateIds: ["calm"], range: 5, conditions: { repeat: "always" } });
  const first = await f.dialogueCommand({ ...f.intent(), kind: "start", dialogueId: "talk" }), second = await f.dialogueCommand({ ...f.intent(), kind: "start", dialogueId: "alternate" });
  assert.notEqual(first.sessionId, second.sessionId); assert.equal(second.text, "Another topic");
  const answer = { sceneId: f.scene.id, groupId: "main", kind: "answer", sessionId: first.sessionId, nodeId: "first", step: 0, responseId: "next" };
  assert.ok((await f.dialogueCommand({ ...answer, dialogueId: "alternate" })).failure);
  assert.equal((await f.dialogueCommand({ ...answer, dialogueId: "talk" })).text, "Goodbye");
  assert.equal((await f.dialogueCommand({ ...f.intent(), kind: "start", dialogueId: "alternate" })).text, "Another topic");
});
test("haltAll blocks ungrouped scene subscribers, explicit restart validates and reopens execution", async () => {
  const f = await fixture(), macros = new Map(); let calls = 0;
  const resolveMacro = async (uuid) => macros.get(uuid), catalog = new SignalCatalog(f.scene, { resolveMacro });
  const bus = new SceneSignals({ runtime: f.runtime, resolveMacro }); f.runtime.emitSignal = (scene, packet) => bus.emit(scene, packet);
  const signal = catalog.list().signals.find((entry) => entry.emitterKey === "Scene:map" && entry.name === "activated");
  macros.set("Macro.counter", { documentName: "Macro", type: "script", canExecute: true, command: signalMacroSnippet(signal),
    execute: async () => ({ parameters: {}, returns: {}, execute() { calls++; } }) });
  await catalog.attachMacro("Scene:map", "Macro.counter"); await catalog.saveSubscription({ ownerKey: "Scene:map", emitterKey: signal.emitterKey, signalId: signal.id, macroUuid: "Macro.counter" });
  await f.runtime.haltAll(f.scene); assert.equal(f.flags.automationHalted, true);
  assert.equal((await bus.emit(f.scene, { emitterKey: "Scene:map", name: "activated" })).status, "stale"); assert.equal(calls, 0);
  const manual = createManualDialogueService({ openWindow: async (view) => view });
  assert.equal((await manual.openManualDialogue({ sceneId: "map", dialogueId: "talk" })).dialogue.name, "Common conversation");
  await f.runtime.enter(f.scene, "calm", { groupId: "main", restart: true }); assert.equal(f.flags.automationHalted, false);
  assert.equal((await bus.emit(f.scene, { emitterKey: "Scene:map", name: "activated" })).status, "done"); assert.equal(calls, 1);
  await f.runtime.halt(f.scene, { groupId: "main" });
  await bus.emit(f.scene, { emitterKey: "Scene:map", name: "activated" }); assert.equal(calls, 2);
});
