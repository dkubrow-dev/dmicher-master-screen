import test from "node:test";
import assert from "node:assert/strict";
import { defaultDefinition, MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { EpisodeRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { createDialogueService } from "../dmicher-master-screen/scripts/dialogues.js";
import { createShopService } from "../dmicher-master-screen/scripts/shop.js";
import { isInteractionPaused, beginInteractionPause } from "../dmicher-master-screen/scripts/interaction-pause.js";
import { createFoundryEffects } from "../dmicher-master-screen/scripts/effects.js";

const clone = structuredClone;
function mergeFlags(previous, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return clone(incoming);
  const result = previous && typeof previous === 'object' && !Array.isArray(previous) ? clone(previous) : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (key.startsWith('-=')) delete result[key.slice(2)];
    else result[key] = mergeFlags(result[key], value);
  }
  return result;
}
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
async function fixture(steps = [], { repeat = false, emptyAnswers = false, nativeMerge = false } = {}) {
  let serial = 0, now = Date.now();
  const gm = { id: "gm", isGM: true, role: 4, active: true }, player = { id: "player", isGM: false, role: 1, active: true };
  globalThis.game = { user: gm, users: new Map([gm, player].map((user) => [user.id, user])), scenes: new Map(), modules: new Map(), messages: new Map(), paused: false };
  globalThis.foundry = { utils: { randomID: () => `id${++serial}` } }; globalThis.CONFIG = {};
  const flags = { definitions: { main: { ...defaultDefinition(), schemeId: "main" } } };
  const scene = { id: "map", grid: { size: 100, distance: 5 }, tokens: new Map(), tiles: new Map(), flags: { [MODULE_ID]: flags },
    getFlag(_scope, key) { return clone(flags[key]); },
    async setFlag(_scope, key, value) { const parts = key.split("."); let owner = flags;
      for (const part of parts.slice(0, -1)) owner = owner[part] ??= {}; owner[parts.at(-1)] = nativeMerge ? mergeFlags(owner[parts.at(-1)], value) : clone(value); } };
  const make = (id, x, owned = false) => { const actor = { id: `actor-${id}`, items: new Map(), testUserPermission: (user) => owned && user.id === player.id };
    const token = { id, name: id, documentName: "Token", parent: scene, actor, x, y: 0, width: 1, height: 1, hidden: false,
      object: { checkCollision: () => false }, updates: [], async update(changes) { this.updates.push(clone(changes)); Object.assign(this, changes); } };
    scene.tokens.set(id, token); return token; };
  const npc = make("npc", 0), pc = make("pc", 50, true), pc2 = make("pc2", 50, true);
  const trigger = { repeat: "always", allowTags: ["hero"] };
  flags.objectBindings = { schemaVersion: 1, revision: 1, bindings: {
    "Token:npc": { type: "Token", id: "npc", schemeId: "main", routines: [{ episodeId: "calm", repeat, steps }],
      shop: { shopId: "shop", episodeIds: ["calm"], range: 30, trigger }, dialogue: { dialogueId: "talk", episodeIds: ["calm"], range: 30, trigger } },
    "Token:pc": { type: "Token", id: "pc", schemeId: null, playerCharacter: true, tags: ["hero"] },
    "Token:pc2": { type: "Token", id: "pc2", schemeId: null, playerCharacter: true, tags: ["hero"] }
  } };
  flags.interactionCatalog = { schemaVersion: 1, revision: 1, shops: [{ id: "shop", name: "Shop", items: [], requireGMApproval: false }],
    dialogues: [{ id: "talk", name: "Talk", startPageId: "page", pages: [{ id: "page", name: "Page", text: "Hello", art: "", responses:
      emptyAnswers ? [] : [{ id: "finish", label: "Finish", nextPageId: "", eventName: "" }] }] }] };
  flags.eventCatalog = { schemaVersion: 1, revision: 0, events: [], triggers: [], macros: [{ id: "check", uuid: "Macro.check", name: "Check" }] };
  game.scenes.set(scene.id, scene); globalThis.canvas = { scene, tokens: { controlled: [] } };
  const calls = { speak: [], bubble: [], macro: [], events: [] };
  const effects = { speak: async (...args) => { calls.speak.push(args); }, bubble: async (...args) => { calls.bubble.push(args); },
    macro: async (...args) => { calls.macro.push(args); }, sound: async () => {}, spawn: async () => {} };
  const runtime = new EpisodeRuntime({ effects, now: () => now, onTypedEvent: async (...args) => { calls.events.push(args); } });
  await runtime.enter(scene, "calm");
  const dialogueEvents = [], dialogues = createDialogueService({ emitEvent: async (_scene, event) => { dialogueEvents.push(clone(event)); } });
  const shop = createShopService();
  const command = (extra = {}) => ({ sceneId: scene.id, schemeId: "main", runId: getRuntime(scene).runId,
    target: { type: "Token", id: npc.id }, tokenId: npc.id, actorTokenId: pc.id, shopId: "shop", dialogueId: "talk", ...extra });
  const dialogueCommand = async (payload, user = player) => {
    const record = { id: `message${++serial}`, author: user, whisper: [gm.id, user.id], flags: { dialogueCommand: clone(payload) },
      getFlag: (_scope, key) => record.flags[key], async update(changes) { for (const [key, value] of Object.entries(changes)) record.flags[key.split(".").at(-1)] = clone(value); }, async delete() {} };
    game.messages.set(record.id, record); await dialogues.processCommand(record, user.id); return record.flags.dialogueResult;
  };
  return { scene, flags, npc, pc, pc2, gm, player, runtime, calls, effects, dialogues, dialogueEvents, shop, command, dialogueCommand,
    advance: (ms) => { now += ms; }, now: () => now, state: () => getRuntime(scene),
    async tick(ms = 500) { now += ms; await runtime.tick(); } };
}

test("fractional waits and movement persist progress without reconnect catch-up or replay", async () => {
  const f = await fixture([step(1, "wait", { seconds: 1.25 }, [2]), step(2, "move", { x: 100, y: 0, speed: 5 }, [3]), step(3, "emotion", { emoji: "!" })]);
  await f.tick(500); assert.equal(f.state().routineStates.npc.remainingMs, 750);
  const restored = new EpisodeRuntime({ effects: f.effects, now: f.now });
  f.advance(100000); await restored.refresh(f.scene); await restored.tick();
  assert.equal(f.state().routineStates.npc.remainingMs, 750);
  f.advance(750); await restored.tick(); assert.equal(f.state().routineStates.npc.stepId, 2); assert.equal(f.npc.x, 0);
  f.advance(500); await restored.tick(); assert.equal(f.npc.x, 50);
  f.advance(500); await restored.tick(); assert.equal(f.npc.x, 100); assert.equal(f.state().routineStates.npc.status, "done");
  assert.equal(f.state().routineStates.npc.emoji, "!"); const count = f.npc.updates.length;
  f.advance(500); await restored.tick(); assert.equal(f.npc.updates.length, count);
});

test("random successors, terminal repeat and instant loops are bounded to one small tick", async () => {
  const f = await fixture([step(1, "emotion", { emoji: "a" }, [2, 3]), step(2, "emotion", { emoji: "b" }), step(3, "emotion", { emoji: "c" })]);
  f.runtime.routines.random = () => 0.99; await f.tick(); assert.equal(f.state().routineStates.npc.emoji, "c");
  const repeat = await fixture([step(1, "emotion", { emoji: "r" })], { repeat: true });
  let writes = 0; const save = repeat.scene.setFlag; repeat.scene.setFlag = async (...args) => { writes++; return save.apply(repeat.scene, args); };
  await repeat.tick(); assert.equal(writes, 16); assert.equal(repeat.state().routineStates.npc.status, "ready");
  const empty = await fixture(); await empty.tick(); assert.equal(empty.state().routineStates.npc.status, "done");
});

test("speech routing, typed events and macro parameters execute exactly once in step order", async () => {
  const f = await fixture([step(1, "speech", { text: "First", chat: false, bubble: true }, [2]),
    step(2, "speech", { text: "Second", chat: true, bubble: false }, [3]),
    step(3, "event", { eventName: "automation.changed", triggerId: "trigger-automation-changed", parameters: { tokenId: "npc", enabled: true } }, [4]),
    step(4, "macro", { macroUuid: "Macro.check", parameters: { number: 3, label: "x" } })]);
  for (let index = 0; index < 4; index++) await f.tick();
  assert.equal(f.calls.bubble.length, 1); assert.equal(f.calls.bubble[0][1], "First");
  assert.equal(f.calls.speak.length, 1); assert.equal(f.calls.speak[0][2], "Second");
  assert.deepEqual(f.calls.events[0][2], { type: "automation.changed", tokenId: "npc", enabled: true });
  assert.deepEqual(f.calls.macro[0][1].parameters, { number: 3, label: "x" });
  assert.equal(f.state().routineStates.npc.status, "done");
  await f.runtime.refresh(f.scene); await f.tick(); assert.equal(f.calls.macro.length, 1);
});

test("halt releases a never-settling routine macro and blocks its late bound event", async () => {
  const f = await fixture([step(1, "macro", { macroUuid: "Macro.check", parameters: {} })]);
  let started, scope; const ready = new Promise((resolve) => { started = resolve; });
  f.effects.macro = async (_id, input) => { scope = input; started(); return new Promise(() => {}); };
  const pending = f.tick(); await ready;
  await f.runtime.haltAll(f.scene); await pending;
  await f.runtime.enter(f.scene, "calm", { force: true });
  assert.throws(() => scope.InvokeDmicherMasterScreenEvent("automation.changed", { type: "automation.changed" }));
  f.effects.macro = async () => { f.calls.macro.push("new"); }; await f.tick(); assert.deepEqual(f.calls.macro, ["new"]);
});

test("unknown pending external outcome is never replayed after a replacement client", async () => {
  const f = await fixture([step(1, "speech", { text: "Once", chat: true, bubble: false })]);
  const state = f.state(); state.routineStates.npc = { stepId: 1, status: "pending", sequence: 4, nextStepId: null }; await saveRuntime(f.scene, state);
  const restored = new EpisodeRuntime({ effects: f.effects, now: f.now }); await restored.tick();
  assert.equal(f.state().routineStates.npc.status, "uncertain"); assert.equal(f.calls.speak.length, 0);
});

test("all conversations and trade leases pause the same NPC until the last lease ends", async () => {
  const f = await fixture([step(1, "wait", { seconds: 2 }, [2]), step(2, "move", { x: 100, y: 0, speed: 5 })], { emptyAnswers: true });
  await f.tick(); assert.equal(f.state().routineStates.npc.remainingMs, 1500);
  const first = await f.dialogueCommand(f.command({ kind: "start" })); assert.equal(first.status, "finished");
  const second = await f.dialogueCommand(f.command({ kind: "start", actorTokenId: "pc2" }));
  const trade = await f.shop.requestSession(f.command());
  assert.equal(isInteractionPaused(f.scene, "npc"), true);
  await f.tick(60000); assert.equal(f.state().routineStates.npc.remainingMs, 1500); assert.equal(f.npc.x, 0);
  const renewed = await f.dialogueCommand(f.command({ kind: "renew", sessionId: first.sessionId })); assert.equal(renewed.status, "finished");
  assert.equal(f.dialogueEvents.filter((event) => event.name === "dialogue.finished").length, 2, "renew never repeats completion");
  await f.dialogueCommand(f.command({ kind: "leave", sessionId: first.sessionId }));
  await f.shop.releaseSession({ ...f.command(), sessionId: trade.sessionId });
  assert.equal(isInteractionPaused(f.scene, "npc"), true, "second character still reads");
  await f.dialogueCommand(f.command({ kind: "leave", sessionId: second.sessionId }));
  assert.equal(isInteractionPaused(f.scene, "npc"), false);
  await f.tick(60000); assert.equal(f.state().routineStates.npc.remainingMs, 1500, "resumption tick does not catch up");
  await f.tick(500); assert.equal(f.state().routineStates.npc.remainingMs, 1000);
});

test("pending admission prevents following movement while geometry validates the latest completed move", async () => {
  const f = await fixture([step(1, "move", { x: 500, y: 0, speed: 5 })]);
  let completeMove, began; const moving = new Promise((resolve) => { began = resolve; });
  f.npc.update = async (changes) => { began(); await new Promise((resolve) => { completeMove = resolve; }); Object.assign(f.npc, changes); };
  const tick = f.tick(); await moving;
  const opening = f.dialogueCommand(f.command({ kind: "start" }));
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(isInteractionPaused(f.scene, "npc"), true);
  completeMove(); await tick; assert.equal(f.npc.x, 50);
  assert.ok((await opening).sessionId); await f.tick(); assert.equal(f.npc.x, 50);
});

test("rejected admission releases its barrier and a player-character target cannot be automated", async () => {
  const f = await fixture([step(1, "move", { x: 100, y: 0, speed: 5 })]);
  f.pc.x = 10000; const rejected = await f.dialogueCommand(f.command({ kind: "start" })); assert.ok(rejected.failure);
  assert.equal(isInteractionPaused(f.scene, "npc"), false); await f.tick(); assert.equal(f.npc.x, 50);
  f.flags.objectBindings.bindings["Token:npc"].playerCharacter = true;
  await f.tick(); assert.equal(f.npc.x, 50); assert.equal(f.runtime.currentToken(f.scene, f.state().runId, "npc"), false);
  game.user = f.player; assert.equal(f.runtime.currentToken(f.scene, f.state().runId, "npc"), false);
});

test("reference-counted pending barriers are idempotent and native bubble text is escaped", async () => {
  const f = await fixture(), target = { type: "Token", id: "npc" };
  const a = beginInteractionPause(f.scene, target), b = beginInteractionPause(f.scene, target);
  a(); a(); assert.equal(isInteractionPaused(f.scene, "npc"), true); b(); assert.equal(isInteractionPaused(f.scene, "npc"), false);
  const calls = []; canvas.hud = { bubbles: { broadcast: async (...args) => calls.push(args) } };
  await createFoundryEffects().bubble(f.npc, "<b>spoken</b>");
  assert.equal(calls[0][1], "&lt;b&gt;spoken&lt;/b&gt;"); assert.deepEqual(calls[0][2], { requireVisible: true, pan: false });
});

test("movement failures stop the routine once instead of retrying the same failed document update", async () => {
  const f = await fixture([step(1, "move", { x: 100, y: 0, speed: 5 })]);
  let attempts = 0; f.npc.update = async () => { attempts++; throw new Error("document unavailable"); };
  await f.tick(); await f.tick(); assert.equal(attempts, 1); assert.equal(f.state().routineStates.npc.status, "failed");
});

test("a previous run's pending trade remains recoverable without freezing the explicitly restarted routine", async () => {
  const f = await fixture([step(1, "move", { x: 100, y: 0, speed: 5 })]);
  const lease = await f.shop.requestSession(f.command());
  const state = f.state(); state.shopSessions.shop.status = "pending"; await saveRuntime(f.scene, state);
  assert.equal(isInteractionPaused(f.scene, "npc"), true);
  await f.runtime.halt(f.scene); await f.runtime.enter(f.scene, "calm", { force: true });
  assert.equal(f.state().shopSessions.shop.sessionId, lease.sessionId);
  assert.equal(isInteractionPaused(f.scene, "npc"), false);
  await f.tick(); assert.equal(f.npc.x, 50);
  await assert.rejects(f.shop.requestSession(f.command()), "GM must release the old pending shop offer explicitly");
});

test("interaction arriving during native Macro lookup defers its unstarted step until the dialogue closes", async () => {
  const f = await fixture([step(1, "macro", { macroUuid: "Macro.check", parameters: { role: "guard" } })]);
  let ready, resolveMacro; const lookup = new Promise((resolve) => { ready = resolve; }); const calls = [];
  const macro = { documentName: "Macro", type: "script", canExecute: true, execute: async (scope) => calls.push(scope) };
  globalThis.fromUuid = async () => { ready(); return new Promise((resolve) => { resolveMacro = resolve; }); };
  f.runtime.effects = createFoundryEffects();
  const ticking = f.tick(); await lookup;
  const session = await f.dialogueCommand(f.command({ kind: "start" }));
  resolveMacro(macro); await ticking;
  assert.equal(calls.length, 0); assert.equal(f.state().routineStates.npc.status, "ready");
  await f.dialogueCommand(f.command({ kind: "leave", sessionId: session.sessionId }));
  globalThis.fromUuid = async () => macro; await f.tick();
  assert.equal(calls.length, 1); assert.equal(calls[0].sceneObject, f.npc);
  assert.deepEqual(calls[0].objectTarget, { type: "Token", id: "npc" }); assert.deepEqual(calls[0].parameters, { role: "guard" });
});

test("expired dialogue leases resume without spending the one-use trigger twice", async () => {
  const f = await fixture([], { emptyAnswers: true });
  f.flags.objectBindings.bindings["Token:npc"].dialogue.trigger = { repeat: "limited", limit: 1 };
  const first = await f.dialogueCommand(f.command({ kind: "start" })); assert.ok(first.sessionId);
  const counts = clone(f.state().triggerCounts);
  let state = f.state(); for (const session of Object.values(state.dialogueSessions)) session.expiresAt = Date.now() - 1;
  await saveRuntime(f.scene, state); assert.equal(isInteractionPaused(f.scene, "npc"), false);
  const reopened = await f.dialogueCommand(f.command({ kind: "start" })); assert.equal(reopened.sessionId, first.sessionId);
  assert.deepEqual(f.state().triggerCounts, counts); assert.equal(f.dialogueEvents.length, 1);
});

test("native recursive flag merging preserves full seven- and ten-second waits across repeated paths", async () => {
  const f = await fixture([
    step(1, "wait", { seconds: 1 }, [4]), step(4, "move", { x: 100, y: 0, speed: 5 }, [7]),
    step(7, "wait", { seconds: 1 }, [9]), step(9, "speech", { text: "x", chat: true, bubble: false }, [12]),
    step(12, "wait", { seconds: 5 }, [16]), step(16, "wait", { seconds: 7 }, [18]),
    step(18, "wait", { seconds: 10 }, [20]),
    step(20, "event", { eventName: "automation.changed", triggerId: "trigger-automation-changed", parameters: { enabled: true } })
  ], { repeat: true, nativeMerge: true });
  const observed = []; let previous = f.state().routineStates.npc.stepId;
  for (let tick = 0; tick < 125; tick++) {
    await f.tick(500); const id = f.state().routineStates.npc.stepId;
    if (id !== previous) { observed.push({ id, at: f.now() }); previous = id; }
  }
  const sevens = observed.filter((entry) => entry.id === 16);
  const tens = observed.filter((entry) => entry.id === 18);
  assert.ok(sevens.length >= 2); assert.ok(tens.length >= 2);
  for (const entering of sevens.slice(0, 2)) assert.equal(observed.find((entry) => entry.at > entering.at && entry.id === 18).at - entering.at, 7000);
  for (const entering of tens.slice(0, 2)) assert.equal(observed.find((entry) => entry.at > entering.at && entry.id === 1).at - entering.at, 10000);
});

test("remaining time belongs to its wait ID, never to an earlier step's merged tail", async () => {
  const f = await fixture([step(1, "emotion", { emoji: "" }, [16]), step(16, "wait", { seconds: 7 }, [18]), step(18, "wait", { seconds: 10 })], { nativeMerge: true });
  const state = f.state(); Object.assign(state.routineStates.npc, { stepId: 16, waitStepId: 9, remainingMs: 500, nextStepId: 18 });
  await saveRuntime(f.scene, state); await f.tick(500);
  assert.equal(f.state().routineStates.npc.waitStepId, 16); assert.equal(f.state().routineStates.npc.remainingMs, 6500);
  await f.runtime.enter(f.scene, "calm", { force: true });
  assert.equal(f.state().routineStates.npc.remainingMs, null); assert.equal(f.state().routineStates.npc.waitStepId, null);
  await f.tick(500); assert.equal(f.state().routineStates.npc.remainingMs, 7000);
});

test("visual row order never changes the start or repeat target ID one", async () => {
  const f = await fixture([step(7, "emotion", { emoji: "b" }), step(1, "wait", { seconds: 1 }, [7])], { repeat: true });
  assert.equal(f.state().routineStates.npc.stepId, 1); await f.tick(500); assert.equal(f.state().routineStates.npc.remainingMs, 500);
  await f.tick(500); assert.equal(f.state().routineStates.npc.stepId, 1); assert.equal(f.state().routineStates.npc.emoji, "b");
  assert.equal(f.state().routineStates.npc.remainingMs, 1000);
});
