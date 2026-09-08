import test from "node:test";
import assert from "node:assert/strict";
import { SceneEvents, eventChatAudience } from "../dmicher-master-screen/scripts/events.js";
import { EpisodeRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { getRuntime } from "../dmicher-master-screen/scripts/store.js";
import { MODULE_ID, defaultDefinition, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";

const copy = (value) => structuredClone(value);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const users = new Map([["a", { id: "a", active: true, isGM: true, role: 4 }], ["b", { id: "b", active: true, isGM: true, role: 4 }],
    ["player", { id: "player", active: true, isGM: false, role: 1 }], ["far", { id: "far", active: true, isGM: false, role: 1 }]]);
  globalThis.game = { user: users.get("a"), users, paused: false };
  let sequence = 0;
  globalThis.foundry = { utils: { randomID: () => `id-${++sequence}` } };
  globalThis.ui = { notifications: { error() {} } };
  const definition = defaultDefinition();
  const scene = { id: "scene", name: "Market", tokenVision: true, grid: { size: 100, distance: 5 }, tokens: new Map(), tiles: new Map(),
    flags: { [MODULE_ID]: { definitions: { main: definition }, runtimes: { main: { ...emptyRuntime(), episodeId: "calm", runId: "run", episode: copy(definition.episodes[0]) } } } },
    getFlag(scope, key) { return copy(this.flags[scope]?.[key]); },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {}; const parts = key.split("."); let target = this.flags[scope];
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = copy(value);
    }
  };
  globalThis.canvas = { scene };
  const addToken = (id, x, owner) => {
    const token = { id, name: id, parent: scene, x, y: 0, width: 1, height: 1, hidden: false, sight: { enabled: true },
      actor: { id: `actor-${id}`, testUserPermission: (user) => user.id === owner }, object: { checkCollision: () => false } };
    scene.tokens.set(id, token); return token;
  };
  const npc = addToken("npc", 0, null), pc = addToken("pc", 100, "player"); addToken("far", 1000, "far");
  const calls = [], messages = [];
  const chat = { buildChatSpeaker: (speaker) => speaker,
    createMessageService: () => ({ create: async (data, options) => { messages.push({ data, options }); return [{ id: "message" }]; } }) };
  let events;
  const runtime = new EpisodeRuntime({ effects: {}, onEvent: (scene, event) => events.emit(scene, event) });
  events = new SceneEvents({ runtime, chat, executeMacro: async (uuid, event) => { calls.push({ uuid, event }); } });
  const subscribe = (subscriptions) => { scene.flags[MODULE_ID].runtimes.main.episode.subscriptions = copy(subscriptions); };
  return { scene, definition, npc, pc, events, runtime, calls, messages, subscribe };
}

test("emergency halt lets an in-flight macro finish but cancels remaining subscriptions and queued events", async () => {
  const f = fixture();
  f.subscribe([{ id: "first", event: "test.event", kind: "macro", macroUuid: "Macro.first" },
    { id: "next", event: "test.event", kind: "macro", macroUuid: "Macro.next" }]);
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  f.events.executeMacro = async (uuid) => {
    f.calls.push(uuid);
    started();
    await new Promise((resolve) => { release = resolve; });
  };
  await f.events.emit(f.scene, { id: "active", name: "test.event" });
  await entered;
  await f.events.emit(f.scene, { id: "queued", name: "test.event" });
  await f.runtime.haltAll(f.scene);
  release();
  await f.events.whenIdle();
  assert.deepEqual(f.calls, ["Macro.first"]);
  assert.equal(getRuntime(f.scene).eventClaims.queued.status, "stale");
  assert.equal(getRuntime(f.scene).halted, true);
  const later = await f.events.emit(f.scene, { id: "after-halt", name: "test.event" });
  assert.equal(later.status, "stale");
  assert.deepEqual(f.calls, ["Macro.first"]);
});

test("events are claimed and visible before a subscription runs; duplicate IDs do not replay", async () => {
  const f = fixture();
  f.subscribe([{ id: "sub", enabled: true, event: "test.event", kind: "macro", macroUuid: "Macro.test" }]);
  f.events.executeMacro = async (uuid, event) => {
    const claim = getRuntime(f.scene).eventClaims[event.id];
    assert.equal(claim.status, "running"); assert.equal(claim.results[0].status, "pending");
    f.calls.push(uuid);
  };
  const receipt = await f.events.emit(f.scene, { id: "unique", name: "test.event", payload: { a: 1 } });
  assert.equal(receipt.status, "queued");
  await f.events.whenIdle();
  await f.events.emit(f.scene, { id: "unique", name: "test.event" });
  await f.events.whenIdle();
  assert.equal(f.calls.length, 1);
  assert.equal(getRuntime(f.scene).eventLog.length, 1);
  assert.equal(getRuntime(f.scene).eventLog[0].status, "done");
});

test("old-run and already handled direct routes are recorded without running subscribers", async () => {
  const f = fixture();
  f.subscribe([{ id: "sub", event: "npc.interacted", kind: "macro", macroUuid: "Macro.test" }]);
  const stale = await f.events.emit(f.scene, { name: "npc.interacted", runId: "closed-run", handled: true });
  const observed = await f.events.emit(f.scene, { name: "npc.interacted", handled: true, payload: { directRoute: true } });
  await f.events.whenIdle();
  assert.equal(stale.status, "stale"); assert.equal(observed.status, "observed");
  assert.equal(f.calls.length, 0);
});

test("only the elected full GM can admit events and invalid payloads produce no history", async () => {
  const f = fixture();
  game.user = game.users.get("b");
  await assert.rejects(f.events.emit(f.scene, { name: "test.event" }));
  game.user = game.users.get("player");
  await assert.rejects(f.events.emit(f.scene, { name: "test.event" }));
  game.user = game.users.get("a");
  await assert.rejects(f.events.emit(f.scene, { name: "bad event" }));
  await assert.rejects(f.events.emit(f.scene, { name: "test.event", payload: { text: "x".repeat(8100) } }));
  assert.equal(getRuntime(f.scene).eventLog.length, 0);
});

test("disabled and unmatched subscriptions are not invoked; failure stops remaining actions", async () => {
  const f = fixture();
  f.subscribe([{ id: "off", enabled: false, event: "test.event", kind: "macro", macroUuid: "Macro.off" },
    { id: "other", event: "other.event", kind: "macro", macroUuid: "Macro.other" },
    { id: "fail", event: "test.event", kind: "macro", macroUuid: "Macro.fail" },
    { id: "after", event: "test.event", kind: "macro", macroUuid: "Macro.after" }]);
  f.events.executeMacro = async (uuid) => { f.calls.push(uuid); throw new Error("script failed"); };
  await f.events.emit(f.scene, { name: "test.event" }); await f.events.whenIdle();
  assert.deepEqual(f.calls, ["Macro.fail"]);
  const event = getRuntime(f.scene).eventLog[0];
  assert.equal(event.status, "failed"); assert.match(event.error, /script failed/);
});

test("a script may await emitting another event without locking its own queue", async () => {
  const f = fixture();
  f.subscribe([{ id: "first", event: "first", kind: "macro", macroUuid: "Macro.first" },
    { id: "second", event: "second", kind: "macro", macroUuid: "Macro.second" }]);
  f.events.executeMacro = async (uuid) => {
    f.calls.push(uuid);
    if (uuid === "Macro.first") await f.events.emit(f.scene, { name: "second" });
  };
  await f.events.emit(f.scene, { name: "first" }); await f.events.whenIdle();
  assert.deepEqual(f.calls, ["Macro.first", "Macro.second"]);
  const log = getRuntime(f.scene).eventLog;
  assert.equal(log[1].chainId, log[0].chainId); assert.equal(log[1].depth, 1);
});

test("automatic A-B episode cycles stop visibly at the chain depth limit", { timeout: 3000 }, async () => {
  const f = fixture();
  f.definition.episodes[0].subscriptions = [{ id: "to-b", event: "episode.entered", kind: "transition", episodeId: "tension", enabled: true }];
  f.definition.episodes[1].subscriptions = [{ id: "to-a", event: "episode.entered", kind: "transition", episodeId: "calm", enabled: true }];
  await f.runtime.enter(f.scene, "calm", { force: true });
  await flush(); await f.events.whenIdle();
  const log = getRuntime(f.scene).eventLog;
  assert.equal(log.length, 17);
  assert.equal(log.at(-1).status, "failed"); assert.equal(log.at(-1).depth, 16);
  assert.match(getRuntime(f.scene).error, /16/);
});

test("a running macro does not hold Stop and cannot run its next subscription afterward", async () => {
  const f = fixture();
  f.subscribe([{ id: "slow", event: "test", kind: "macro", macroUuid: "Macro.slow" },
    { id: "after", event: "test", kind: "transition", episodeId: "alarm" }]);
  let release, started;
  const gate = new Promise((resolve) => { started = resolve; });
  f.events.executeMacro = async () => { started(); await new Promise((resolve) => { release = resolve; }); };
  await f.events.emit(f.scene, { name: "test" }); await gate;
  await f.runtime.enter(f.scene, "stop"); release(); await f.events.whenIdle();
  assert.equal(getRuntime(f.scene).episodeId, "stop");
  const first = getRuntime(f.scene).eventLog.find((event) => event.name === "test");
  assert.equal(first.results.length, 1);
});

test("a new event manager never replays queued or completed history", async () => {
  const f = fixture();
  f.subscribe([{ id: "sub", event: "test", kind: "macro", macroUuid: "Macro.test" }]);
  f.scene.flags[MODULE_ID].runtimes.main.eventClaims.previous = { id: "previous", name: "test", status: "queued" };
  const restored = new SceneEvents({ runtime: f.runtime, executeMacro: async () => { f.calls.push("unexpected"); } });
  await restored.whenIdle();
  await restored.emit(f.scene, { id: "previous", name: "test" }); await restored.whenIdle();
  assert.equal(f.calls.length, 0);
});

test("stop episode allows an event record but executes no automated subscriptions", async () => {
  const f = fixture();
  f.subscribe([{ id: "sub", event: "test", kind: "macro", macroUuid: "Macro.test" }]);
  f.scene.flags[MODULE_ID].runtimes.main.episode.stop = true;
  await f.events.emit(f.scene, { name: "test" }); await f.events.whenIdle();
  assert.equal(f.calls.length, 0);
});

test("chat subscriptions combine only explicit GM, interactor and nearby audiences", async () => {
  const f = fixture();
  f.subscribe([{ id: "chat", event: "touch", kind: "chat", text: "<b>Notice</b>",
    audience: { gms: false, interactor: true, nearby: true, range: 10, visibleOnly: true } }]);
  const event = { name: "touch", actorTokenId: "pc", payload: { userId: "player", target: { type: "Token", id: "npc" } } };
  await f.events.emit(f.scene, event); await f.events.whenIdle();
  assert.deepEqual(f.messages[0].options.audience.userIds, ["player"]);
  assert.equal(f.messages[0].data.content, "<p>&lt;b&gt;Notice&lt;/b&gt;</p>");
  assert.equal(f.messages[0].data.speaker.token, "npc");
  assert.deepEqual(getRuntime(f.scene).eventLog[0].results[0].messageIds, ["message"]);
  assert.deepEqual(eventChatAudience(f.scene, event, { gms: true }).userIds, ["a", "b"]);
});

test("nearby Tile recipients use pixel center, while private empty audiences stay empty", () => {
  const f = fixture();
  f.scene.tiles.set("tile", { id: "tile", x: 0, y: 0, width: 100, height: 100, hidden: false });
  const event = { actorTokenId: "pc", payload: { userId: "far", target: { type: "Tile", id: "tile" } } };
  assert.deepEqual(eventChatAudience(f.scene, event, { nearby: true, range: 10, visibleOnly: true }).userIds, ["player"]);
  assert.deepEqual(eventChatAudience(f.scene, event, { interactor: true }).userIds, [], "ownership is rechecked");
  f.pc.object.checkCollision = () => true;
  assert.deepEqual(eventChatAudience(f.scene, event, { nearby: true, range: 10, visibleOnly: true }).userIds, []);
});

test("event history is bounded while queued claims are retained until resolved", async () => {
  const f = fixture();
  for (let index = 0; index < 105; index++) await f.events.emit(f.scene, { name: "notice", id: `event-${index}`, handled: true });
  assert.equal(getRuntime(f.scene).eventLog.length, 100);
  assert.equal(getRuntime(f.scene).eventLog[0].id, "event-5");
  assert.equal(Object.keys(getRuntime(f.scene).eventClaims).length, 105);
});
