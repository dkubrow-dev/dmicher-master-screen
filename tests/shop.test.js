import test from "node:test";
import assert from "node:assert/strict";
import { createShopService, itemTransferData, validateTradeContext, shopEntries, normalizeExchange } from "../dmicher-master-screen/scripts/shop.js";
import { requireShopSession } from "../dmicher-master-screen/scripts/shop-sessions.js";

const MODULE_ID = "dmicher-master-screen";
function fixture({ stock = 1, failSaveAt = 0, authority = true, requireGMApproval = false, onSave = () => {} } = {}) {
  const gm = { id: "gm", isGM: true, role: 4, active: true };
  const player = { id: "player", isGM: false, role: 1, active: true };
  const stranger = { id: "stranger", isGM: false, role: 1, active: true };
  let serial = 0, saves = 0, creates = 0, deletes = 0;
  const documents = new Map();
  const document = (data) => ({ ...structuredClone(data), id: data._id,
    toObject: () => structuredClone(data) });
  const actor = { id: "actor", uuid: "Actor.actor", items: documents,
    testUserPermission: (user) => user.id === player.id,
    async createEmbeddedDocuments(_type, data) {
      creates++;
      return data.map((source) => { const item = document({ ...source, _id: source._id ?? `item-${++serial}` });
        documents.set(item.id, item); return item; });
    },
    async deleteEmbeddedDocuments(_type, ids) { deletes++; for (const id of ids) documents.delete(id); }
  };
  const pc = { id: "pc", actor, x: 0, y: 0, width: 1, height: 1, object: { checkCollision: () => false } };
  const npc = { id: "npc", x: 100, y: 0, width: 1, height: 1, hidden: false };
  const tags = {};
  const scene = { id: "scene", grid: { distance: 5, size: 100 }, tokens: new Map([["pc", pc], ["npc", npc]]),
    getFlag: (_module, name) => name === "objectBindings" ? { bindings: Object.fromEntries(Object.entries(tags).map(([id, values]) => [`Token:${id}`, { type: "Token", id, tags: values }])) } : undefined };
  let runtime = { runId: "run", schemeId: "main", episodeId: "calm", disabledTokens: [], shops: {}, tradeRequests: {},
    shopSessions: { npc: { sessionId: "lease", userId: "gm", actorTokenId: "pc", runId: "run", schemeId: "main",
      shopId: "npc", actorId: "actor", target: { type: "Token", id: "npc" },
      expiresAt: Date.now() + 120000, status: "editing", revision: 0, draft: { giveItemIds: [], take: [] } } },
    episode: { tokens: { npc: { enabled: true, shop: { enabled: true, requireGMApproval, range: 5, items: [
      { id: "entry", data: { name: "Sword", type: "gear", system: { quantity: 5 } }, stock }
    ] } } } } };
  const context = () => ({ scene, runtime: structuredClone(runtime), token: npc, target: { type: "Token", id: "npc" }, shopId: "npc", behavior: structuredClone(runtime.episode.tokens.npc) });
  let queue = Promise.resolve();
  const lock = (_scene, task) => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const save = async (_scene, next) => { if (++saves === failSaveAt) throw new Error("write failed"); runtime = structuredClone(next); await onSave(runtime, saves); };
  const messages = new Map();
  globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player], [stranger.id, stranger]]), messages };
  globalThis.canvas = { scene };
  globalThis.foundry ??= {};
  foundry.utils = { ...(foundry.utils ?? {}), randomID: () => `id-${++serial}` };
  globalThis.CONFIG = { ChatMessage: { documentClass: { create: async (data) => {
    const message = { ...data, id: `message-${++serial}`, getFlag: (module, flag) => data.flags?.[module]?.[flag] };
    messages.set(message.id, message); return message;
  } } } };
  const service = createShopService({ context, save, lock, authority: () => authority });
  const intent = { sceneId: "scene", tokenId: "npc", target: { type: "Token", id: "npc" }, shopId: "npc", actorTokenId: "pc", schemeId: "main", runId: "run",
    sessionId: "lease", requestId: "request", kind: "exchange", giveItemIds: [], take: [{ entryId: "entry", count: 1 }] };
  const message = (requestId, overrides = {}, author = player) => {
    if (runtime.shopSessions.npc) runtime.shopSessions.npc.userId = author.id;
    const payload = { ...intent, requestId, ...overrides };
    const record = { id: requestId, author, payload, whisper: [gm.id, author.id],
      getFlag: (_module, flag) => flag === "trade" ? payload : undefined,
      update: async function (change) { this.change = change; } };
    messages.set(record.id, record); return record;
  };
  return { service, intent, context, actor, gm, player, stranger, pc, npc, scene, tags, document, messages,
    runtime: () => runtime, setRuntime: (value) => { runtime = value; }, counts: () => ({ creates, deletes, saves }), message };
}

test("item transfer strips document identity but retains opaque system stack and module data", () => {
  const data = itemTransferData({ _id: "old", ownership: { default: 3 }, folder: "folder", name: "Coins", type: "gear",
    system: { quantity: 80, denomination: "unknown" }, flags: { other: { value: 2 } } });
  assert.equal(data._id, undefined);
  assert.equal(data.ownership, undefined);
  assert.deepEqual(data.system, { quantity: 80, denomination: "unknown" });
  assert.equal(data.flags.other.value, 2);
});

test("take transfers one whole Item and persists stock across a new run", async () => {
  const f = fixture({ stock: 2 });
  const receipt = await f.service.requestTrade(f.intent);
  assert.equal(receipt.status, "done");
  assert.equal(f.actor.items.size, 1);
  assert.equal([...f.actor.items.values()][0].system.quantity, 5);
  assert.equal(f.runtime().shops.npc.items[0].stock, 1);
  const next = f.runtime(); next.runId = "next"; f.setRuntime(next);
  assert.equal(shopEntries(f.context())[0].stock, 1);
});

test("give creates stock before deleting the original embedded Item", async () => {
  const f = fixture();
  f.actor.items.set("owned", f.document({ _id: "owned", name: "Rope", type: "gear", system: { quantity: 7 } }));
  const receipt = await f.service.requestTrade({ ...f.intent, giveItemIds: ["owned"], take: [] });
  assert.equal(receipt.status, "done");
  assert.equal(f.actor.items.has("owned"), false);
  const last = f.runtime().shops.npc.items.at(-1);
  assert.equal(last.stock, 1);
  assert.equal(last.data.system.quantity, 7);
  assert.equal(last.data._id, undefined);
});

test("concurrent requests serialize and cannot oversell the last Item", async () => {
  const f = fixture();
  const results = await Promise.all([
    f.service.processTradeRequest(f.message("one"), f.player.id),
    f.service.processTradeRequest(f.message("two"), f.player.id)
  ]);
  assert.deepEqual(results.map((result) => result.status), ["done", "rejected"]);
  assert.equal(f.actor.items.size, 1);
  assert.equal(f.runtime().shops.npc.items[0].stock, 0);
});

test("a persisted receipt prevents duplicate creation and pending work is never replayed", async () => {
  const f = fixture({ stock: 3 });
  const message = f.message("one");
  await f.service.processTradeRequest(message, f.player.id);
  await f.service.processTradeRequest(message, f.player.id);
  assert.equal(f.actor.items.size, 1);
  const runtime = f.runtime(); runtime.tradeRequests[`${f.player.id}:pending`] = { status: "processing" }; f.setRuntime(runtime);
  assert.equal((await f.service.processTradeRequest(f.message("pending"), f.player.id)).status, "processing");
  assert.equal(f.actor.items.size, 1);
});

test("failed stock write removes the newly created Item and restores the unchanged stock", async () => {
  const f = fixture({ failSaveAt: 2 });
  assert.equal((await f.service.requestTrade(f.intent)).status, "failed");
  assert.equal(f.actor.items.size, 0);
  assert.equal(shopEntries(f.context())[0].stock, 1);
  assert.equal(Object.values(f.runtime().tradeRequests)[0].status, "failed");
});

test("failed final receipt restores a deposited Item with its original ID", async () => {
  const f = fixture({ failSaveAt: 3 });
  f.actor.items.set("owned", f.document({ _id: "owned", name: "Rope", type: "gear" }));
  assert.equal((await f.service.requestTrade({ ...f.intent, giveItemIds: ["owned"], take: [] })).status, "failed");
  assert.equal(f.actor.items.has("owned"), true);
  assert.equal(shopEntries(f.context()).length, 1);
});

test("a failed compensation marks uncertain and retains depleted stock instead of duplicating it", async () => {
  const f = fixture({ failSaveAt: 2 });
  f.actor.deleteEmbeddedDocuments = async () => { throw new Error("delete denied"); };
  assert.equal((await f.service.requestTrade(f.intent)).status, "uncertain");
  assert.equal(f.actor.items.size, 1);
  assert.equal(f.runtime().shops.npc.items[0].stock, 0);
  assert.equal(Object.values(f.runtime().tradeRequests)[0].status, "uncertain");
});

test("author must match the user ID supplied by Foundry, and the GM must receive the whisper", async () => {
  const f = fixture();
  assert.equal(await f.service.processTradeRequest(f.message("one"), f.stranger.id), null);
  const privateMessage = f.message("two"); privateMessage.whisper = [f.player.id];
  assert.equal(await f.service.processTradeRequest(privateMessage, f.player.id), null);
  assert.equal(f.actor.items.size, 0);
});

test("ownership, run, scheme, range, walls, hidden NPC and disabled automation are checked at execution", () => {
  const f = fixture();
  assert.throws(() => validateTradeContext(f.context(), f.intent, f.stranger));
  assert.throws(() => validateTradeContext(f.context(), { ...f.intent, runId: "old" }, f.player));
  assert.throws(() => validateTradeContext(f.context(), { ...f.intent, schemeId: "other" }, f.player));
  f.npc.x = 300;
  assert.throws(() => validateTradeContext(f.context(), f.intent, f.player));
  f.npc.x = 100; f.npc.hidden = true;
  assert.throws(() => validateTradeContext(f.context(), f.intent, f.player));
  f.npc.hidden = false; f.pc.object.checkCollision = () => true;
  assert.throws(() => validateTradeContext(f.context(), f.intent, f.player));
  f.pc.object.checkCollision = () => false;
  const next = f.runtime(); next.disabledTokens = ["npc"]; f.setRuntime(next);
  assert.throws(() => validateTradeContext(f.context(), f.intent, f.player));
});

test("player double clicks produce one private authenticated request while it awaits a result", async () => {
  const f = fixture({ authority: false });
  game.user = f.player;
  const [first, second] = await Promise.all([f.service.requestTrade(f.intent), f.service.requestTrade(f.intent)]);
  assert.equal(first.id, second.id);
  assert.equal(f.messages.size, 1);
  assert.deepEqual(first.whisper.sort(), [f.gm.id, f.player.id].sort());
  assert.equal(first.author, f.player.id);
  assert.equal(first.getFlag(MODULE_ID, "trade").schemeId, "main");
  assert.equal((await f.service.requestTrade(f.intent)).id, first.id);
});

test("shop trigger tag veto precedes session admission and an admitted session ignores only its consumed quota", async () => {
  const f = fixture();
  const runtime = f.runtime(); runtime.shopSessions = {};
  runtime.episode.tokens.npc.shop.trigger = { allowTags: ["trusted"], denyTags: ["wanted"], limit: 1 };
  f.setRuntime(runtime); f.tags.pc = ["TRUSTED", "Wanted"];
  await assert.rejects(f.service.requestSession(f.intent));
  assert.deepEqual(f.runtime().shopSessions, {});
  assert.equal(f.runtime().triggerCounts, undefined);
  f.tags.pc = ["trusted"];
  const session = await f.service.requestSession(f.intent);
  const nextIntent = { ...f.intent, sessionId: session.sessionId };
  const key = "main:calm:shop:npc";
  assert.equal(f.runtime().triggerCounts[key], 1);
  await f.service.requestSession(nextIntent);
  await f.service.renewSession(nextIntent);
  assert.equal(f.runtime().triggerCounts[key], 1);
  assert.equal((await f.service.requestTrade(nextIntent)).status, "done");
  assert.equal(f.runtime().triggerCounts[key], 1);
  await assert.rejects(f.service.requestSession(nextIntent));
});

test("parallel shop opens consume one use and rejected competitors consume none", async () => {
  const f = fixture();
  const runtime = f.runtime(); runtime.shopSessions = {}; f.setRuntime(runtime);
  f.scene.tokens.set("pc2", { ...f.pc, id: "pc2" });
  const results = await Promise.allSettled([f.service.requestSession(f.intent), f.service.requestSession({ ...f.intent, actorTokenId: "pc2" })]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  assert.equal(f.runtime().triggerCounts["main:calm:shop:npc"], 1);
});

test("new forbidden tags or emergency halt reject an approved shop offer without inventory effects", async () => {
  const f = fixture({ requireGMApproval: true });
  const runtime = f.runtime(); runtime.episode.tokens.npc.shop.trigger = { denyTags: ["wanted"] }; f.setRuntime(runtime);
  const request = f.message("pending"); await f.service.processTradeRequest(request, f.player.id);
  f.tags.pc = ["wanted"];
  assert.equal((await f.service.approveTrade(request.id)).status, "failed");
  assert.equal(f.actor.items.size, 0);
  f.tags.pc = []; const halted = f.runtime(); halted.halted = true; f.setRuntime(halted);
  await assert.rejects(f.service.requestSession(f.intent));
});

test("bulk barter moves the whole offer only once after GM approval", async () => {
  const f = fixture({ stock: 3, requireGMApproval: true });
  f.actor.items.set("rope", f.document({ _id: "rope", name: "Rope", type: "gear", system: { quantity: 4 } }));
  f.actor.items.set("torch", f.document({ _id: "torch", name: "Torch", type: "gear" }));
  const request = f.message("barter", { giveItemIds: ["rope", "torch"], take: [{ entryId: "entry", count: 2 }] });
  assert.equal((await f.service.processTradeRequest(request, f.player.id)).status, "pending");
  assert.equal(f.actor.items.size, 2);
  assert.equal(f.counts().creates, 0);
  assert.equal(f.runtime().shopSessions.npc.status, "pending");
  const results = await Promise.all([f.service.approveTrade(request.id), f.service.approveTrade(request.id)]);
  assert.deepEqual(results.map((result) => result.status), ["done", "done"]);
  assert.equal(f.actor.items.size, 2);
  assert.equal(f.actor.items.has("rope"), false);
  assert.equal(f.actor.items.has("torch"), false);
  assert.equal(f.runtime().shops.npc.items[0].stock, 1);
  assert.equal(f.runtime().shops.npc.items.length, 3);
  assert.equal(f.runtime().shopSessions.npc, undefined);
});

test("GM rejection and stale episode approval leave all inventories unchanged", async () => {
  const f = fixture({ requireGMApproval: true });
  const request = f.message("pending");
  await f.service.processTradeRequest(request, f.player.id);
  const next = f.runtime(); next.runId = "other"; f.setRuntime(next);
  assert.equal((await f.service.approveTrade(request.id)).status, "failed");
  assert.equal(f.actor.items.size, 0);
  const second = fixture({ requireGMApproval: true });
  const request2 = second.message("pending2");
  await second.service.processTradeRequest(request2, second.player.id);
  assert.equal((await second.service.rejectTrade(request2.id)).status, "rejected");
  assert.equal(second.actor.items.size, 0);
});

test("edited player flags cannot replace the durable approved offer", async () => {
  const f = fixture({ stock: 4, requireGMApproval: true });
  const request = f.message("pending");
  await f.service.processTradeRequest(request, f.player.id);
  request.payload.take = [{ entryId: "entry", count: 4 }];
  assert.equal((await f.service.approveTrade(request.id)).status, "done");
  assert.equal(f.actor.items.size, 1);
  assert.equal(f.runtime().shops.npc.items[0].stock, 3);
});

test("offer validation rejects foreign Items, missing stock, duplicate IDs and excess quantity before effects", async () => {
  const f = fixture();
  await assert.rejects(f.service.requestTrade({ ...f.intent, giveItemIds: ["foreign"] }));
  await assert.rejects(f.service.requestTrade({ ...f.intent, take: [{ entryId: "missing", count: 1 }] }));
  await assert.rejects(f.service.requestTrade({ ...f.intent, take: [{ entryId: "entry", count: 2 }] }));
  assert.throws(() => normalizeExchange({ ...f.intent, giveItemIds: ["same", "same"] }));
  assert.throws(() => normalizeExchange({ ...f.intent, take: [{ entryId: "entry", count: -1 }] }));
  assert.equal(f.counts().creates, 0);
});

test("exclusive lease rejects another character and persists a validated draft without transferring Items", async () => {
  const f = fixture({ stock: 2 });
  f.scene.tokens.set("pc2", { ...f.pc, id: "pc2" });
  await assert.rejects(f.service.requestSession({ ...f.intent, actorTokenId: "pc2" }));
  const lease = await f.service.requestSession(f.intent);
  assert.equal(lease.sessionId, "lease");
  const updated = await f.service.updateOffer({ ...f.intent, revision: 1, draft: { giveItemIds: [], take: [{ entryId: "entry", count: 2 }], extra: "discard" } });
  assert.equal(updated.draft.take[0].count, 2);
  assert.equal(updated.draft.extra, undefined);
  assert.equal(f.actor.items.size, 0);
  const unchanged = await f.service.updateOffer({ ...f.intent, revision: 1, draft: { giveItemIds: [], take: [] } });
  assert.equal(unchanged.draft.take[0].count, 2);
  await assert.rejects(f.service.updateOffer({ ...f.intent, revision: 2, draft: { giveItemIds: [], take: [{ entryId: "entry", count: 3 }] } }));
  await f.service.releaseSession(f.intent);
  assert.equal(f.runtime().shopSessions.npc, undefined);
  assert.equal((await f.service.requestSession({ ...f.intent, actorTokenId: "pc2" })).actorTokenId, "pc2");
});

test("expired editing sessions are replaced, pending sessions remain exclusive until a decision", async () => {
  const f = fixture({ requireGMApproval: true });
  f.scene.tokens.set("pc2", { ...f.pc, id: "pc2" });
  let next = f.runtime(); next.shopSessions.npc.expiresAt = Date.now() - 1; f.setRuntime(next);
  const lease = await f.service.requestSession({ ...f.intent, actorTokenId: "pc2" });
  assert.notEqual(lease.sessionId, "lease");
  next = f.runtime(); next.shopSessions.npc.status = "pending"; next.shopSessions.npc.expiresAt = 1; f.setRuntime(next);
  await assert.rejects(f.service.requestSession(f.intent));
});

test("non-authority cannot approve and a forged session command cannot acquire a shop", async () => {
  const f = fixture({ authority: false });
  await assert.rejects(f.service.approveTrade("anything"));
  const active = fixture();
  const message = { id: "forged", author: active.player, whisper: [active.gm.id],
    getFlag: (_module, flag) => flag === "shopCommand" ? { ...active.intent, kind: "release" } : undefined,
    update: async () => { throw new Error("must not update"); } };
  assert.equal(await active.service.processCommand(message, active.stranger.id), true);
  assert.equal(active.runtime().shopSessions.npc.sessionId, "lease");
});

test("partial removal of a multi-Item offer restores every original and removes new destination Items", async () => {
  const f = fixture({ stock: 2 });
  f.actor.items.set("one", f.document({ _id: "one", name: "One", type: "gear" }));
  f.actor.items.set("two", f.document({ _id: "two", name: "Two", type: "gear" }));
  const remove = f.actor.deleteEmbeddedDocuments;
  let failed = false;
  f.actor.deleteEmbeddedDocuments = async (type, ids) => {
    if (!failed && ids.includes("one")) { failed = true; f.actor.items.delete("one"); throw new Error("partial deletion"); }
    return remove(type, ids);
  };
  const result = await f.service.requestTrade({ ...f.intent, giveItemIds: ["one", "two"], take: [{ entryId: "entry", count: 2 }] });
  assert.equal(result.status, "failed");
  assert.deepEqual([...f.actor.items.keys()].sort(), ["one", "two"]);
  assert.equal(shopEntries(f.context())[0].stock, 2);
});

test("approval rechecks current stock and ownership after the proposal was shown", async () => {
  const f = fixture({ requireGMApproval: true });
  const request = f.message("pending");
  await f.service.processTradeRequest(request, f.player.id);
  f.actor.testUserPermission = () => false;
  assert.equal((await f.service.approveTrade(request.id)).status, "failed");
  assert.equal(f.actor.items.size, 0);
});

test("offer payload cannot replace the character, run or session bound by the lease", async () => {
  const f = fixture();
  const otherActor = { ...f.actor, id: "other-actor", items: new Map([["foreign", f.document({ _id: "foreign", name: "Foreign", type: "gear" })]]) };
  f.scene.tokens.set("other-pc", { ...f.pc, id: "other-pc", actor: otherActor });
  await assert.rejects(f.service.updateOffer({ ...f.intent, revision: 1,
    draft: { actorTokenId: "other-pc", giveItemIds: ["foreign"], take: [] } }));
  f.actor.items.set("owned", f.document({ _id: "owned", name: "Owned", type: "gear" }));
  const session = await f.service.updateOffer({ ...f.intent, revision: 1,
    draft: { actorTokenId: "other-pc", runId: "forged", sessionId: "forged", schemeId: "forged", kind: "other",
      requestId: "forged", giveItemIds: ["owned"], take: [] } });
  assert.deepEqual(session.draft, { giveItemIds: ["owned"], take: [] });
  assert.equal(session.actorTokenId, "pc"); assert.equal(session.runId, "run"); assert.equal(session.sessionId, "lease");
});

test("opening from a stale screen cannot silently acquire a shop in the new episode", async () => {
  const f = fixture();
  const next = f.runtime(); next.runId = "new-run"; next.shopSessions = {}; f.setRuntime(next);
  await assert.rejects(f.service.requestSession(f.intent));
  assert.equal(Object.keys(f.runtime().shopSessions).length, 0);
  const current = await f.service.requestSession({ ...f.intent, runId: "new-run" });
  assert.equal(current.runId, "new-run");
});

test("a session from a closed run is not live authority even if its pending lease has no expiry", () => {
  const f = fixture();
  const next = f.runtime(); next.runId = "new-run"; next.shopSessions.npc.status = "pending"; f.setRuntime(next);
  assert.throws(() => requireShopSession(f.context(), f.intent, f.gm));
});

test("a shop lease must contain its exact actor, source target and shop identity", async () => {
  for (const field of ["actorId", "target", "shopId"]) {
    const f = fixture(), state = f.runtime(); delete state.shopSessions.npc[field]; f.setRuntime(state);
    assert.throws(() => requireShopSession(f.context(), f.intent, f.gm), field);
    await assert.rejects(f.service.requestSession(f.intent), undefined, field);
    assert.equal(f.counts().creates, 0);
  }
  const f = fixture(); f.runtime().shopSessions = {};
  const session = await f.service.requestSession(f.intent);
  assert.equal(session.actorId, f.actor.id); assert.equal(session.shopId, "npc");
  assert.deepEqual(session.target, { type: "Token", id: "npc" });
});

test("rejecting an old proposal does not release another participant's new session", async () => {
  const f = fixture({ requireGMApproval: true });
  const request = f.message("old-proposal");
  await f.service.processTradeRequest(request, f.player.id);
  const next = f.runtime(); next.runId = "new-run";
  next.shopSessions.npc = { ...next.shopSessions.npc, sessionId: "new-session", runId: "new-run", userId: f.stranger.id, status: "editing" };
  f.setRuntime(next);
  assert.equal((await f.service.rejectTrade(request.id)).status, "rejected");
  assert.equal(f.runtime().shopSessions.npc.sessionId, "new-session");
  assert.equal(f.runtime().shopSessions.npc.userId, f.stranger.id);
});

test("a concurrent Item change during destination creation aborts barter and preserves that edit", async () => {
  const f = fixture();
  f.actor.items.set("owned", f.document({ _id: "owned", name: "Rope", type: "gear", system: { quantity: 7 } }));
  const create = f.actor.createEmbeddedDocuments;
  f.actor.createEmbeddedDocuments = async (...args) => {
    const items = await create(...args);
    f.actor.items.set("owned", f.document({ _id: "owned", name: "Rope", type: "gear", system: { quantity: 99 } }));
    return items;
  };
  const receipt = await f.service.requestTrade({ ...f.intent, giveItemIds: ["owned"] });
  assert.equal(receipt.status, "failed");
  assert.equal(f.actor.items.get("owned").system.quantity, 99);
  assert.deepEqual([...f.actor.items.keys()], ["owned"]);
  assert.equal(shopEntries(f.context())[0].stock, 1);
});

test("an Item deleted by another action before our delete is never resurrected by compensation", async () => {
  const f = fixture();
  f.actor.items.set("owned", f.document({ _id: "owned", name: "Rope", type: "gear" }));
  const create = f.actor.createEmbeddedDocuments;
  f.actor.createEmbeddedDocuments = async (...args) => { const items = await create(...args); f.actor.items.delete("owned"); return items; };
  const receipt = await f.service.requestTrade({ ...f.intent, giveItemIds: ["owned"] });
  assert.equal(receipt.status, "failed");
  assert.equal(f.actor.items.has("owned"), false);
  assert.equal(f.actor.items.size, 0);
  assert.equal(shopEntries(f.context())[0].stock, 1);
});

test("source data is checked again after the stock write immediately before deletion", async () => {
  const f = fixture({ onSave: (_state, count) => {
    if (count === 2) f.actor.items.set("owned", f.document({ _id: "owned", name: "Edited after write", type: "gear" }));
  } });
  f.actor.items.set("owned", f.document({ _id: "owned", name: "Rope", type: "gear" }));
  const receipt = await f.service.requestTrade({ ...f.intent, giveItemIds: ["owned"], take: [] });
  assert.equal(receipt.status, "failed");
  assert.equal(f.actor.items.get("owned").name, "Edited after write");
  assert.equal(shopEntries(f.context()).length, 1);
  assert.equal(f.counts().deletes, 0);
});

test("edited message identifiers cannot redirect approval to a different durable proposal", async () => {
  const f = fixture({ requireGMApproval: true });
  const request = f.message("visible-proposal");
  await f.service.processTradeRequest(request, f.player.id);
  const next = f.runtime();
  next.tradeRequests[`${f.player.id}:other-proposal`] = { ...structuredClone(next.tradeRequests[`${f.player.id}:visible-proposal`]),
    messageId: "other-message", intent: { ...f.intent, requestId: "other-proposal" } };
  f.setRuntime(next);
  request.payload.requestId = "other-proposal";
  await assert.rejects(f.service.approveTrade(request.id));
  assert.equal(f.runtime().tradeRequests[`${f.player.id}:other-proposal`].status, "pending");
  assert.equal(f.actor.items.size, 0);
});
