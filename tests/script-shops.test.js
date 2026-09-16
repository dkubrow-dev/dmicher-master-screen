import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { createShopSessions } from "../dmicher-master-screen/scripts/shop-sessions.js";
import { createScriptShopService, planScriptShop } from "../dmicher-master-screen/scripts/script-shops.js";
import { isInteractionPaused } from "../dmicher-master-screen/scripts/interaction-pause.js";
import { scriptShopsPending } from "../dmicher-master-screen/scripts/interaction-session-model.js";

const clone = value => structuredClone(value);
function fixture() {
  const gm = { id: "gm", isGM: true, active: true, role: 4 }, player = { id: "player", isGM: false, active: true, role: 1, character: "actor" };
  const actor = { id: "actor", testUserPermission: user => user.id === "player" }, token = { id: "pc", uuid: "Scene.scene.Token.pc", actor };
  const target = { type: "Token", id: "npc" }, source = { id: "npc" };
  let runtime = { ...emptyRuntime(), runId: "run", stateId: "calm", halted: false, state: { id: "calm" } }, count = 0, locked = false;
  const scene = { id: "scene", tokens: new Map([[token.id, token]]), getFlag: (_scope, key) => key === "groupDefinitions" ? { main: { schemaVersion: 1, groupId: "main", groupName: "Main", states: [{ id: "calm", name: "Calm" }], entryStateId: "calm" } }
    : key === "groupRuntimes" ? { main: runtime } : key === "objectBindings" ? { bindings: {} } : undefined };
  const shop = { id: "shop", target, enabled: false, items: [], conditions: { enabled: false } };
  globalThis.canvas = { scene }; globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player]]), i18n: { lang: "en" } };
  globalThis.foundry = { utils: { randomID: () => `id-${++count}` } };
  const context = () => ({ scene, runtime: clone(runtime), target, object: source, shopId: "shop", registered: { asset: { id: "shop" }, config: { ...shop, enabled: true } }, behavior: { enabled: true, shop } });
  const validations = [], macroCalls = [], signals = [];
  const sessions = createShopSessions({ context, authority: () => game.user.isGM, save: async (_scene, state) => { runtime = clone(state); },
    lock: async (_scene, task) => { assert.equal(locked, false); locked = true; try { return await task(); } finally { locked = false; } },
    validate: () => { validations.push("player"); if (!shop.enabled) throw new Error("disabled player action"); return actor; },
    scriptValidate: () => { validations.push("script"); return actor; }, validateOffer: () => ({ giveItemIds: [], take: [] }), onChange: () => {},
    evaluateOpenCondition: async () => { macroCalls.push(locked); return true; }, emitSignal: async (_scene, signal) => { signals.push(signal); return {}; } });
  const command = { sceneId: "scene", groupId: "main", runId: "run", target, shopId: "shop", actorTokenId: "pc" };
  return { gm, player, actor, token, scene, target, source, shop, context, sessions, command, validations, macroCalls, signals,
    runtime: () => runtime, setRuntime: value => { runtime = value; } };
}
test("script shop admission bypasses player launch policies and quota but retains the exclusive actor lease", async () => {
  const f = fixture();
  await assert.rejects(f.sessions.requestSession(f.command), /disabled player action/);
  const session = await f.sessions.openScriptSession(f.command, f.player, { isCurrent: () => true });
  assert.equal(session.origin, "script"); assert.equal(session.actorId, f.actor.id); assert.equal(session.userId, f.player.id);
  assert.deepEqual(f.runtime().conditionCounts, {}); assert.equal(f.macroCalls.length, 0);
  assert.equal(f.runtime().interactionClocks["Token:npc"].external, undefined);
  await assert.rejects(f.sessions.openScriptSession({ ...f.command, actorTokenId: "other" }, f.player, { isCurrent: () => true }), /already occupied|another participant|another character|another source|another object/);
});
test("script shop leases do not count as external interaction and only their exact reference unpauses the owning script", async () => {
  const f = fixture(), session = await f.sessions.openScriptSession(f.command, f.player, { isCurrent: () => true });
  const reference = { sessionId: session.sessionId, userId: f.player.id, actorTokenId: f.token.id, shopId: "shop" };
  assert.equal(isInteractionPaused(f.scene, f.target, Date.now(), { playerOnly: true, includeCompleted: true }), false);
  assert.equal(isInteractionPaused(f.scene, f.target), true);
  assert.equal(isInteractionPaused(f.scene, f.target, Date.now(), { excludeShopSessions: [reference] }), false);
  assert.equal(isInteractionPaused(f.scene, f.target, Date.now(), { excludeShopSessions: [{ ...reference, shopId: "another" }] }), true);
  assert.equal(scriptShopsPending(f.runtime(), [reference]), true);
  await f.sessions.releaseSession({ ...f.command, sessionId: session.sessionId });
  assert.equal(scriptShopsPending(f.runtime(), [reference]), false);
});
test("player shop condition macros execute outside the scene lock and forged session IDs cannot bypass them", async () => {
  const f = fixture(); f.shop.enabled = true; f.shop.conditions = { enabled: true, repeat: "always" };
  await f.sessions.requestSession({ ...f.command, sessionId: "forged" });
  assert.deepEqual(f.macroCalls, [false]);
});
test("script shop planning selects an active character owner and rejects missing registration or a foreign scene", () => {
  const f = fixture();
  const plan = planScriptShop({ ...f.command, tokenUuid: f.token.uuid }, { context: f.context });
  assert.equal(plan.user, f.player); assert.equal(plan.command.actorTokenId, f.token.id);
  assert.throws(() => planScriptShop({ ...f.command, tokenUuid: "Scene.other.Token.pc" }, { context: f.context }), /current scene/);
  assert.throws(() => planScriptShop({ ...f.command, tokenUuid: f.token.uuid }, { context: () => ({ ...f.context(), registered: null }) }), /not registered/);
});
test("a cancelled scripted shop delivery releases the admitted lease instead of blocking the object", async () => {
  const f = fixture(); let valid = true;
  const script = createScriptShopService({ context: f.context, authority: () => true, sessions: f.sessions,
    chat: { async create() { valid = false; throw new Error("delivery failed"); } } });
  await assert.rejects(script.startScriptShop({ ...f.command, tokenUuid: f.token.uuid }, { isCurrent: () => valid }), /delivery failed/);
  assert.deepEqual(f.runtime().shopSessions, {}); assert.equal(isInteractionPaused(f.scene, f.target), false);
});

test("a late successful chat delivery cannot retain the lease of a cancelled script", async () => {
  const f = fixture(); let valid = true;
  const script = createScriptShopService({ context: f.context, authority: () => true, sessions: f.sessions,
    chat: { async create() { valid = false; return [{ id: "late-message" }]; } } });
  await assert.rejects(script.startScriptShop({ ...f.command, tokenUuid: f.token.uuid }, { isCurrent: () => valid }), /stopped/);
  assert.deepEqual(f.runtime().shopSessions, {});
});

test("the GM renews an admitted script lease before delayed delivery without reopening admission", async () => {
  const f = fixture(), calls = [];
  const session = { sessionId: "lease", actorTokenId: f.token.id, userId: f.player.id, shopId: "shop" };
  const script = createScriptShopService({ context: f.context, authority: () => true,
    sessions: { async openScriptSession() { calls.push("open"); return session; }, async renewScriptSession(command, user, options) {
      assert.equal(command.sessionId, session.sessionId); assert.equal(user, f.player); assert.equal(options.isCurrent(), true); calls.push("renew");
    }, async releaseSession() { calls.push("release"); } },
    chat: { async create() { calls.push("deliver"); return [{ id: "message" }]; } } });
  await script.startScriptShop({ ...f.command, tokenUuid: f.token.uuid }, { isCurrent: () => true, waitForAdmission: async () => {} });
  assert.deepEqual(calls, ["open", "renew", "deliver"]);
});
