import test from "node:test";
import assert from "node:assert/strict";
import { EpisodeRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { defaultDefinition, defaultTokenBehavior, emptyRuntime, MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { getRuntime } from "../dmicher-master-screen/scripts/store.js";
import { speechRecipients, crossesRectangle, sceneDistance, createFoundryEffects } from "../dmicher-master-screen/scripts/effects.js";

const copy = (value) => structuredClone(value);
function fixture() {
  const users = new Map([
    ["gm-a", { id: "gm-a", role: 4, isGM: true, active: true }],
    ["gm-b", { id: "gm-b", role: 4, isGM: true, active: true }],
    ["player", { id: "player", role: 1, isGM: false, active: true }]
  ]);
  globalThis.game = { user: users.get("gm-a"), users, paused: false, scenes: new Map(), modules: new Map(),
    togglePause(value) { this.paused = value; } };
  globalThis.CONFIG = {};
  let clock = 1000, counter = 0;
  globalThis.foundry = { utils: { randomID: () => `run-${++counter}` } };
  const scene = { id: "scene-a", grid: { size: 100, distance: 5 }, tokenVision: true, tokens: new Map(),
    flags: { [MODULE_ID]: { definition: defaultDefinition(), runtime: emptyRuntime() } },
    getFlag(scope, key) { return copy(this.flags[scope]?.[key]); },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      const parts = key.split(".");
      let target = this.flags[scope];
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = copy(value);
    }
  };
  game.scenes.set(scene.id, scene);
  globalThis.canvas = { scene, tokens: { controlled: [] } };
  const makeToken = (id, { x = 0, y = 0, owned = false } = {}) => {
    const token = { id, uuid: `Scene.${scene.id}.Token.${id}`, parent: scene, name: id, x, y, width: 1, height: 1, hidden: false,
      sight: { enabled: true }, actor: { id: `actor-${id}`, testUserPermission: (user) => owned && user.id === "player" },
      object: { checkCollision: () => false }, updates: [],
      async update(changes) { this.updates.push(copy(changes)); Object.assign(this, changes); }
    };
    scene.tokens.set(id, token);
    return token;
  };
  const npc = makeToken("npc");
  const player = makeToken("pc", { x: 100, owned: true });
  const definition = scene.flags[MODULE_ID].definition;
  for (const episode of definition.episodes) episode.tokens.npc = defaultTokenBehavior();
  const calls = { speech: [], sound: [], spawn: [], macro: [], workspace: [], errors: [] };
  const effects = {
    async speak(...args) { calls.speech.push(args); }, async sound(...args) { calls.sound.push(args); },
    async spawn(...args) { calls.spawn.push(args); }, async macro(...args) { calls.macro.push(args); return false; }
  };
  const runtime = new EpisodeRuntime({ effects, now: () => clock, onWorkspace: async (...args) => calls.workspace.push(args) });
  runtime.report = (error) => calls.errors.push(error);
  return { scene, definition, npc, player, makeToken, runtime, effects, calls, advance: (ms) => { clock += ms; } };
}

test("enter applies entry effects once; refresh and a new runtime never replay them", async () => {
  const f = fixture(), episode = f.definition.episodes[0];
  episode.tokens.npc.entrySpeech = "Hello";
  episode.tokens.npc.position = { x: 400, y: 300 };
  episode.sound = "alarm.ogg";
  episode.spawns = [{ id: "spawn", actorUuid: "Actor.guard", count: 2, x: 0, y: 0 }];
  await f.runtime.enter(f.scene, "calm");
  const runId = getRuntime(f.scene).runId;
  assert.equal(f.calls.speech.length, 1);
  assert.equal(f.calls.spawn.length, 1);
  assert.equal(f.calls.sound.length, 1);
  assert.equal(f.npc.x, 400);
  await f.runtime.enter(f.scene, "calm");
  const restored = new EpisodeRuntime({ effects: f.effects });
  await restored.refresh(f.scene);
  await restored.tick();
  assert.equal(getRuntime(f.scene).runId, runId);
  assert.equal(f.calls.speech.length, 1);
  assert.equal(f.calls.spawn.length, 1);
});

test("explicit reentry restores planned placement but does not replenish inventory", async () => {
  const f = fixture();
  f.definition.episodes[0].tokens.npc.position = { x: 200, y: 0 };
  await f.runtime.enter(f.scene, "calm");
  const state = getRuntime(f.scene);
  state.shops.npc.items = [{ id: "potion", stock: 0, data: { name: "Potion" } }];
  state.tradeRequests.request = { status: "done" };
  state.shopSessions = { npc: { userId: "player", runId: state.runId } };
  await f.scene.setFlag(MODULE_ID, "runtimes.main", state);
  f.npc.x = 800;
  await f.runtime.refresh(f.scene);
  assert.equal(f.npc.x, 800);
  await f.runtime.enter(f.scene, "calm", { force: true });
  assert.equal(f.npc.x, 200);
  assert.equal(getRuntime(f.scene).shops.npc.items[0].stock, 0);
  assert.equal(getRuntime(f.scene).tradeRequests.request.status, "done");
  assert.deepEqual(getRuntime(f.scene).shopSessions, {}, "a new episode releases old exclusive sessions");
});

test("manual token disable survives episode transitions and connection until explicit enable", async () => {
  const f = fixture();
  f.definition.episodes[1].tokens.npc.entrySpeech = "No automatic speech";
  await f.runtime.enter(f.scene, "calm");
  await f.runtime.setAutomation(f.scene, "npc", false);
  await f.runtime.enter(f.scene, "tension");
  assert.deepEqual(getRuntime(f.scene).disabledTokens, ["npc"]);
  assert.equal(f.calls.speech.length, 0);
  await f.runtime.refresh(f.scene);
  await f.runtime.setAutomation(f.scene, "npc", true);
  assert.deepEqual(getRuntime(f.scene).disabledTokens, []);
  assert.equal(f.calls.speech.length, 0, "enabling is not episode reentry");
});

test("Stop preserves NPC facts, inventory and global pause and stops automation", async () => {
  const f = fixture();
  const calm = f.definition.episodes[0].tokens.npc;
  calm.speech = { interval: 1, phrases: ["tick"], range: 30, visibleOnly: true };
  calm.patrol = { enabled: true, speed: 10, points: [{ x: 500, y: 0 }] };
  await f.runtime.enter(f.scene, "calm");
  f.npc.x = 333;
  game.paused = true;
  await f.runtime.enter(f.scene, "stop");
  f.advance(5000);
  await f.runtime.tick();
  assert.equal(f.npc.x, 333);
  assert.equal(game.paused, true);
  assert.equal(f.calls.speech.length, 0);
  assert.equal(getRuntime(f.scene).episode.stop, true);
});

test("a slow macro cannot hold Stop and its late result cannot switch episode", async () => {
  const f = fixture();
  let resolveMacro, markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  f.effects.macro = async () => { markStarted(); return new Promise((resolve) => { resolveMacro = resolve; }); };
  f.definition.episodes[1].tokens.npc.patrol = { enabled: true, speed: 5, points: [{ x: 0, y: 0, macroUuid: "Macro.check", onTrue: "alarm" }] };
  await f.runtime.enter(f.scene, "tension");
  f.advance(500);
  const pendingTick = f.runtime.tick();
  await started;
  await f.runtime.enter(f.scene, "stop");
  resolveMacro(true);
  await pendingTick;
  assert.equal(getRuntime(f.scene).episodeId, "stop");
});

test("only elected active full GM can execute and a newly elected GM resumes without entry", async () => {
  const f = fixture();
  f.definition.episodes[0].tokens.npc.entrySpeech = "entry";
  game.user = game.users.get("gm-b");
  await assert.rejects(f.runtime.enter(f.scene, "calm"));
  game.user = game.users.get("player");
  await assert.rejects(f.runtime.enter(f.scene, "calm"));
  game.user = game.users.get("gm-a");
  await f.runtime.enter(f.scene, "calm");
  game.users.get("gm-a").active = false;
  game.user = game.users.get("gm-b");
  await f.runtime.refresh(f.scene);
  await f.runtime.tick();
  assert.equal(f.calls.speech.length, 1);
});

test("the running snapshot is unaffected by editing until reentry", async () => {
  const f = fixture();
  f.definition.episodes[0].tokens.npc.speech = { interval: 1, phrases: ["before"], range: 30, visibleOnly: true };
  await f.runtime.enter(f.scene, "calm");
  f.definition.episodes[0].tokens.npc.speech.phrases = ["after"];
  f.advance(1000);
  await f.runtime.tick();
  assert.equal(f.calls.speech[0][2], "before");
  await f.runtime.enter(f.scene, "calm", { force: true });
  f.advance(1000);
  await f.runtime.tick();
  assert.equal(f.calls.speech[1][2], "after");
});

test("hidden scenes do not move NPCs or send speech and cannot be entered remotely", async () => {
  const f = fixture();
  f.definition.episodes[0].tokens.npc.speech = { interval: 1, phrases: ["tick"], range: 30, visibleOnly: true };
  await f.runtime.enter(f.scene, "calm");
  const other = { ...f.scene, id: "scene-b", flags: { [MODULE_ID]: { definition: defaultDefinition() } } };
  canvas.scene = other;
  f.advance(5000);
  await f.runtime.tick();
  await assert.rejects(f.runtime.enter(f.scene, "tension"));
  assert.equal(f.calls.speech.length, 0);
  canvas.scene = f.scene;
  await f.runtime.tick();
  assert.equal(f.calls.speech.length, 1, "resume has no catch-up burst");
});

test("entry claims persist before effect and an uncertain old effect is not retried", async () => {
  const f = fixture();
  f.definition.episodes[0].sound = "alarm.ogg";
  f.effects.sound = async () => {
    assert.equal(getRuntime(f.scene).effects.sound.status, "pending");
    throw new Error("sound failed");
  };
  await f.runtime.enter(f.scene, "calm");
  assert.equal(getRuntime(f.scene).effects.sound.status, "failed");
  assert.match(getRuntime(f.scene).error, /sound failed/);
  const state = getRuntime(f.scene);
  state.effects.sound.status = "pending";
  await f.scene.setFlag(MODULE_ID, "runtimes.main", state);
  await f.runtime.refresh(f.scene);
  assert.equal(getRuntime(f.scene).effects.sound.status, "pending");
  assert.equal(f.calls.errors.length, 1);
});

test("patrol respects speed and stops at walls without teleporting or repeated errors", async () => {
  const f = fixture();
  f.definition.episodes[1].tokens.npc.patrol = { enabled: true, speed: 5, points: [{ x: 500, y: 0 }] };
  await f.runtime.enter(f.scene, "tension");
  f.advance(500);
  await f.runtime.tick();
  assert.equal(f.npc.x, 50);
  f.npc.object.checkCollision = () => true;
  f.advance(500);
  await f.runtime.tick();
  assert.equal(f.npc.x, 50);
  assert.deepEqual(getRuntime(f.scene).disabledTokens, ["npc"]);
  f.advance(500);
  await f.runtime.tick();
  assert.equal(f.calls.errors.length, 1);
});

test("zone transitions react to crossing by player-owned tokens and reject stale runs", async () => {
  const f = fixture();
  f.definition.episodes[0].zones = [{ id: "gate", x: 200, y: 0, width: 100, height: 100, targetEpisodeId: "tension" }];
  await f.runtime.enter(f.scene, "calm");
  const oldRun = getRuntime(f.scene).runId;
  f.npc.x = 200;
  await f.runtime.onTokenMove(f.npc, { x: 150, y: 50 });
  assert.equal(getRuntime(f.scene).episodeId, "calm");
  f.player.x = 200;
  await f.runtime.onTokenMove(f.player, { x: 150, y: 50 });
  assert.equal(getRuntime(f.scene).episodeId, "tension");
  await f.runtime.enter(f.scene, "alarm", { expectedRunId: oldRun });
  assert.equal(getRuntime(f.scene).episodeId, "tension");
});

test("interaction checks current character ownership and proximity", async () => {
  const f = fixture();
  f.definition.episodes[0].tokens.npc.interaction.targetEpisodeId = "tension";
  await f.runtime.enter(f.scene, "calm");
  await assert.rejects(f.runtime.interact(f.scene, "npc", { sourceTokenId: "npc", user: game.users.get("player") }));
  f.player.x = 900;
  await assert.rejects(f.runtime.interact(f.scene, "npc", { sourceTokenId: "pc", user: game.users.get("player") }));
  f.player.x = 100;
  await f.runtime.interact(f.scene, "npc", { sourceTokenId: "pc", user: game.users.get("player") });
  assert.equal(getRuntime(f.scene).episodeId, "tension");
});

test("speech checks range and sight for each owned token and keeps GM oversight", () => {
  const f = fixture();
  assert.deepEqual(speechRecipients(f.scene, f.npc, { range: 10, visibleOnly: true }), ["gm-a", "gm-b", "player"]);
  f.player.object.checkCollision = () => true;
  assert.deepEqual(speechRecipients(f.scene, f.npc, { range: 10, visibleOnly: true }), ["gm-a", "gm-b"]);
  f.makeToken("pc2", { x: 150, owned: true });
  assert.ok(speechRecipients(f.scene, f.npc, { range: 10, visibleOnly: true }).includes("player"));
  f.npc.hidden = true;
  assert.deepEqual(speechRecipients(f.scene, f.npc, { range: 10, visibleOnly: false }), ["gm-a", "gm-b"]);
  assert.equal(sceneDistance(f.scene, { x: 0, y: 0 }, { x: 100, y: 0 }), 5);
});

test("rectangle crossing includes passing through a zone and ignores leaving or parallel misses", () => {
  const rectangle = { x: 10, y: 10, width: 10, height: 10 };
  assert.equal(crossesRectangle({ x: 0, y: 15 }, { x: 30, y: 15 }, rectangle), true);
  assert.equal(crossesRectangle({ x: 15, y: 15 }, { x: 30, y: 15 }, rectangle), false);
  assert.equal(crossesRectangle({ x: 0, y: 0 }, { x: 30, y: 0 }, rectangle), false);
});

test("NPC speech uses Generics explicit recipients and escaped text without provisioning identity", async () => {
  const f = fixture();
  let actual;
  const adapter = createFoundryEffects({ createMessageService: () => ({ create: async (...args) => { actual = args; return []; } }), buildChatSpeaker: (speaker) => speaker });
  await adapter.speak(f.scene, f.npc, "<script>&", { range: 5, visibleOnly: true }, "run:speech", () => true);
  assert.equal(actual[0].author, "gm-a");
  assert.equal(actual[0].speaker.token, "npc");
  assert.equal(actual[0].content, "<p>&lt;script&gt;&amp;</p>");
  assert.equal(actual[1].technical, false);
  assert.deepEqual(actual[1].audience.userIds, ["gm-a", "gm-b", "player"]);
});

test("no canvas and paused worlds do not execute periodic work", async () => {
  const f = fixture();
  f.definition.episodes[0].tokens.npc.speech = { interval: 1, phrases: ["tick"], range: 30, visibleOnly: true };
  await f.runtime.enter(f.scene, "calm");
  f.advance(5000);
  game.paused = true;
  await f.runtime.tick();
  canvas.scene = null;
  await f.runtime.tick();
  assert.equal(f.calls.speech.length, 0);
});

test("one-point patrol reaches its point once without polling the macro forever", async () => {
  const f = fixture();
  f.definition.episodes[1].tokens.npc.patrol = { enabled: true, speed: 5, points: [{ x: 0, y: 0, macroUuid: "Macro.check" }] };
  await f.runtime.enter(f.scene, "tension");
  for (let index = 0; index < 4; index++) { f.advance(500); await f.runtime.tick(); }
  assert.equal(f.calls.macro.length, 1);
  assert.equal(getRuntime(f.scene).patrol.npc.completed, true);
});

test("combat helper reuses the scene combat and adds only missing combatants", async () => {
  const f = fixture();
  const calls = [];
  const combat = { scene: f.scene, started: false, combatants: new Map([["existing", { tokenId: "npc" }]]),
    async createEmbeddedDocuments(kind, additions) { calls.push([kind, additions]); },
    async activate() { calls.push("activate"); }, async rollAll() { calls.push("roll"); },
    async startCombat() { calls.push("start"); this.started = true; }
  };
  game.combats = new Map([["combat", combat]]);
  CONFIG.Combat = { documentClass: { create: async () => { throw new Error("must reuse existing"); } } };
  await f.runtime.startCombat(f.scene);
  assert.equal(calls[0][1].length, 1);
  assert.equal(calls[0][1][0].tokenId, "pc");
  assert.deepEqual(calls.slice(1), ["activate", "roll", "start"]);
});

test("runtime activation and disposal are idempotent and release owned hooks", async () => {
  const f = fixture(), hooks = new Map();
  let id = 0;
  globalThis.Hooks = { on(name, callback) { hooks.set(++id, { name, callback }); return id; }, off(name, key) {
    assert.equal(hooks.get(key)?.name, name); hooks.delete(key);
  } };
  f.runtime.start();
  const count = hooks.size;
  try { f.runtime.start(); assert.equal(hooks.size, count); }
  finally { f.runtime.dispose(); }
  f.runtime.dispose();
  assert.equal(hooks.size, 0);
  assert.equal(f.runtime.interval, null);
  assert.equal(getRuntime(f.scene).runId, "");
});

test("zone tag rejection and exhausted quota emit nothing; explicit reset allows the next admission", async () => {
  const f = fixture(), events = [];
  f.runtime.onEvent = async (_, event) => events.push(event);
  f.definition.episodes[0].zones = [{ id: "door", x: 200, y: 0, width: 100, height: 100,
    targetEpisodeId: "", trigger: { allowTags: ["member"], resetOnEntry: false } }];
  await f.runtime.enter(f.scene, "calm");
  events.length = 0;
  f.player.x = 200;
  const move = () => f.runtime.onTokenMove(f.player, { x: 150, y: 50 });
  await move();
  assert.deepEqual(getRuntime(f.scene).triggerCounts, {});
  assert.equal(events.length, 0);
  f.scene.flags[MODULE_ID].objectTags = { Token: { pc: ["member"] } };
  await move();
  await move();
  const key = "main:calm:zone:door";
  assert.equal(getRuntime(f.scene).triggerCounts[key], 1);
  assert.equal(events.filter((event) => event.name === "zone.entered").length, 1);
  await f.runtime.enter(f.scene, "calm", { force: true });
  await move();
  assert.equal(getRuntime(f.scene).triggerCounts[key], 1, "opt-out quota survives new entry");
  await f.runtime.resetTriggerCounter(f.scene, key);
  await move();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.filter((event) => event.name === "zone.entered").length, 2);
});

test("trigger default reset and persistent manual enable override work without editing the snapshot", async () => {
  const f = fixture(), key = "main:calm:npc-interaction:npc";
  const policy = f.definition.episodes[0].tokens.npc.interaction.trigger;
  policy.enabled = false;
  await f.runtime.enter(f.scene, "calm");
  await assert.rejects(f.runtime.interact(f.scene, "npc"));
  await f.runtime.setTriggerEnabled(f.scene, key, true);
  await f.runtime.interact(f.scene, "npc");
  await assert.rejects(f.runtime.interact(f.scene, "npc"));
  await f.runtime.enter(f.scene, "calm", { force: true });
  assert.equal(getRuntime(f.scene).triggerCounts[key], undefined);
  assert.equal(getRuntime(f.scene).triggerEnabledOverrides[key], true);
  assert.equal(getRuntime(f.scene).episode.tokens.npc.interaction.trigger.enabled, false);
  await f.runtime.interact(f.scene, "npc");
  await f.runtime.setTriggerEnabled(f.scene, key, false);
  await f.runtime.resetTriggerCounter(f.scene, key);
  await assert.rejects(f.runtime.interact(f.scene, "npc"));
  await assert.rejects(f.runtime.setTriggerEnabled(f.scene, "other:calm:zone:x", true));
  game.user = game.users.get("player");
  await assert.rejects(f.runtime.resetTriggerCounter(f.scene, key));
  await assert.rejects(f.runtime.setTriggerEnabled(f.scene, key, true));
});

test("emergency halt preserves current facts and reconnect stays stopped until explicit chosen episode resume", async () => {
  const f = fixture();
  f.definition.episodes[0].tokens.npc.speech = { interval: 1, phrases: ["tick"], range: 30, visibleOnly: true };
  f.definition.episodes[0].tokens.npc.patrol = { enabled: true, speed: 10, points: [{ x: 500, y: 0 }] };
  f.definition.episodes[1].allowFromAll = false;
  f.definition.episodes[1].from = [];
  await f.runtime.enter(f.scene, "calm");
  const before = getRuntime(f.scene);
  f.npc.x = 333;
  await f.runtime.haltAll(f.scene);
  const halted = getRuntime(f.scene);
  assert.equal(halted.halted, true);
  assert.equal(halted.runId, before.runId);
  assert.equal(halted.episodeId, "calm");
  assert.deepEqual(halted.shops, before.shops);
  assert.equal(game.paused, false);
  assert.equal(f.npc.x, 333);
  f.advance(5000);
  await f.runtime.tick();
  const reconnect = new EpisodeRuntime({ effects: f.effects });
  await reconnect.refresh(f.scene);
  await reconnect.tick();
  assert.equal(f.npc.x, 333);
  assert.equal(f.calls.speech.length, 0);
  await assert.rejects(f.runtime.enter(f.scene, "tension"));
  await assert.rejects(f.runtime.enter(f.scene, "tension", { force: true, expectedRunId: halted.runId }));
  await f.runtime.enter(f.scene, "tension", { force: true, schemeId: "main" });
  assert.equal(getRuntime(f.scene).halted, false);
  assert.equal(getRuntime(f.scene).episodeId, "tension");
  assert.notEqual(getRuntime(f.scene).runId, halted.runId);
});

test("halt immediately blocks remaining entry effects while a started operation releases the scene lock", async () => {
  const f = fixture();
  let release, started;
  const pending = new Promise((resolve) => { started = resolve; });
  f.effects.speak = async () => { started(); await new Promise((resolve) => { release = resolve; }); };
  const episode = f.definition.episodes[0];
  episode.tokens.npc.entrySpeech = "in progress";
  episode.pause = true;
  episode.sound = "alarm.ogg";
  episode.spawns = [{ id: "reinforcement", actorUuid: "Actor.guard", x: 0, y: 0, count: 1 }];
  const entering = f.runtime.enter(f.scene, "calm");
  await pending;
  const halt = f.runtime.haltAll(f.scene);
  assert.equal(f.runtime.owns(f.scene), false, "local cancellation is immediate before persisted halt");
  release();
  await entering;
  await halt;
  assert.equal(getRuntime(f.scene).halted, true);
  assert.equal(f.calls.sound.length, 0);
  assert.equal(f.calls.spawn.length, 0);
  assert.equal(game.paused, false);
});

test("halt does not await a patrol macro and its late true result cannot switch episode", async () => {
  const f = fixture();
  let release, started;
  const pending = new Promise((resolve) => { started = resolve; });
  f.effects.macro = async () => { started(); return new Promise((resolve) => { release = resolve; }); };
  f.definition.episodes[1].tokens.npc.patrol = { enabled: true, speed: 5,
    points: [{ x: 0, y: 0, macroUuid: "Macro.check", onTrue: "alarm" }] };
  await f.runtime.enter(f.scene, "tension");
  f.advance(500);
  const tick = f.runtime.tick();
  await pending;
  await f.runtime.halt(f.scene, { schemeId: "main" });
  release(true);
  await tick;
  assert.equal(getRuntime(f.scene).episodeId, "tension");
  assert.equal(getRuntime(f.scene).halted, true);
  assert.equal(f.calls.sound.length, 0);
});

test("halt requires the elected GM and does not affect another scene or unknown scheme", async () => {
  const f = fixture();
  await f.runtime.enter(f.scene, "calm");
  await assert.rejects(f.runtime.halt(f.scene, { schemeId: "other" }));
  await assert.rejects(f.runtime.halt({ ...f.scene, id: "other" }));
  game.user = game.users.get("gm-b");
  await assert.rejects(f.runtime.haltAll(f.scene));
  game.user = game.users.get("player");
  await assert.rejects(f.runtime.haltAll(f.scene));
  assert.equal(getRuntime(f.scene).halted, false);
});
