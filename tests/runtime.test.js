import { crossesRectangle, sceneDistance } from "../dmicher-master-screen/scripts/scene-object-geometry.js";
import test from "node:test";
import assert from "node:assert/strict";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { emptyRuntime, MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition as defaultDefinition } from "./fixtures/definitions.js";
import { getRuntime } from "../dmicher-master-screen/scripts/store.js";
import { speechRecipients, createFoundryEffects } from "../dmicher-master-screen/scripts/effects.js";

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
    flags: { [MODULE_ID]: { groupDefinitions: { main: defaultDefinition() }, groupRuntimes: {}, objectBindings: { schemaVersion: 1, revision: 0, bindings: {} } } },
    getFlag(scope, key) { return copy(this.flags[scope]?.[key]); },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      const parts = key.split(".");
      let target = this.flags[scope];
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      const merge = (before, after) => { if (!after || typeof after !== "object" || Array.isArray(after)) return copy(after); const result = before && typeof before === "object" ? copy(before) : {}; for (const [key, entry] of Object.entries(after)) { if (key.startsWith("-=")) delete result[key.slice(2)]; else result[key] = merge(result[key], entry); } return result; };
      target[parts.at(-1)] = merge(target[parts.at(-1)], value);
    }
  };
  game.scenes.set(scene.id, scene);
  globalThis.canvas = { scene, tokens: { controlled: [] } };
  const makeToken = (id, { x = 0, y = 0, owned = false } = {}) => {
    const token = { id, documentName: "Token", uuid: `Scene.${scene.id}.Token.${id}`, parent: scene, name: id, x, y, width: 1, height: 1, rotation: 0, hidden: false,
      sight: { enabled: true }, actor: { id: `actor-${id}`, testUserPermission: (user) => owned && user.id === "player" },
      object: { checkCollision: () => false }, updates: [],
      async update(changes) { this.updates.push(copy(changes)); Object.assign(this, changes); }
    };
    scene.tokens.set(id, token);
    return token;
  };
  const npc = makeToken("npc");
  const player = makeToken("pc", { x: 100, owned: true });
  const definition = scene.flags[MODULE_ID].groupDefinitions.main;
  const bindings = scene.flags[MODULE_ID].objectBindings.bindings;
  bindings['Token:npc'] = { type: 'Token', id: 'npc', groupId: 'main', scripts: [], transitionScripts: {} };
  bindings['Token:pc'] = { type: 'Token', id: 'pc', groupId: null, playerCharacter: true, tags: [] };
  const calls = { speech: [], sound: [], spawn: [], macro: [], workspace: [], errors: [] };
  const effects = {
    async speak(...args) { calls.speech.push(args); }, async sound(...args) { calls.sound.push(args); },
    async spawn(...args) { calls.spawn.push(args); }, async macro(...args) { calls.macro.push(args); return false; }
  };
  const runtime = new GroupRuntime({ effects, now: () => clock, onWorkspace: async (...args) => calls.workspace.push(args) });
  runtime.report = (error) => calls.errors.push(error);
  return { scene, definition, bindings, npc, player, makeToken, runtime, effects, calls, advance: (ms) => { clock += ms; } };
}

test("entry applies object script, sound, spawn and workspace once without replay on reconnect", async () => {
  const f = fixture(); f.bindings["Token:npc"].transitionScripts.calm = { steps: [{ id: 1, kind: "move", parameters: { duration: 0, position: { x: 400, y: 300 } }, next: [] }] };
  f.definition.states[0].sound = "alarm.ogg";
  f.definition.states[0].spawns = [{ id: "guard", actorUuid: "Actor.guard", count: 2, x: 0, y: 0 }];
  await f.runtime.enter(f.scene, "calm"); const runId = getRuntime(f.scene).runId;
  await f.runtime.tick();
  assert.equal(f.npc.x, 400); assert.equal(f.calls.sound.length, 1); assert.equal(f.calls.spawn.length, 1); assert.equal(f.calls.workspace.length, 1);
  const restored = new GroupRuntime({ effects: f.effects }); await restored.refresh(f.scene); await restored.tick();
  assert.equal(getRuntime(f.scene).runId, runId); assert.equal(f.calls.sound.length, 1); assert.equal(f.npc.updates.length, 1);
});

test("explicit state reentry restores preparation without replenishing shared inventory", async () => {
  const f = fixture(); f.bindings["Token:npc"].transitionScripts.calm = { steps: [{ id: 1, kind: "move", parameters: { duration: 0, position: { x: 200, y: 0 } }, next: [] }] };
  await f.runtime.enter(f.scene, "calm"); await f.runtime.tick(); f.npc.x = 800;
  const state = getRuntime(f.scene); state.shops.stock = { items: [{ id: "potion", stock: 0, data: { name: "Potion" } }] };
  await f.scene.setFlag(MODULE_ID, "groupRuntimes.main", state);
  await f.runtime.refresh(f.scene); assert.equal(f.npc.x, 800);
  await f.runtime.enter(f.scene, "calm", { force: true }); await f.runtime.tick(); assert.equal(f.npc.x, 200); assert.equal(getRuntime(f.scene).shops.stock.items[0].stock, 0);
});

test("manual automation disable survives transitions and explicit enable resumes the prepared script", async () => {
  const f = fixture(); f.bindings["Token:npc"].scripts = [{ stateId: "tension", repeat: false,
    steps: [{ id: 1, kind: "speech", parameters: { chat: { text: "Speak" }, bubble: { enabled: false } }, next: [] }] }];
  await f.runtime.enter(f.scene, "calm"); await f.runtime.setAutomation(f.scene, "npc", false);
  await f.runtime.enter(f.scene, "tension"); f.advance(500); await f.runtime.tick(); assert.equal(f.calls.speech.length, 0);
  await f.runtime.refresh(f.scene); await f.runtime.setAutomation(f.scene, "npc", true);
  f.advance(500); await f.runtime.tick(); assert.equal(f.calls.speech.length, 1);
});

test("only the elected full GM executes and another elected client resumes without repeating entry", async () => {
  const f = fixture(); f.definition.states[0].sound = "alarm.ogg";
  game.user = game.users.get("gm-b"); await assert.rejects(f.runtime.enter(f.scene, "calm"));
  game.user = game.users.get("player"); await assert.rejects(f.runtime.enter(f.scene, "calm"));
  game.user = game.users.get("gm-a"); await f.runtime.enter(f.scene, "calm");
  game.users.get("gm-a").active = false; game.user = game.users.get("gm-b"); await f.runtime.refresh(f.scene); await f.runtime.tick();
  assert.equal(f.calls.sound.length, 1);
});

test("editing a script does not alter the running state snapshot before explicit reentry", async () => {
  const f = fixture(), script = { stateId: "calm", repeat: false,
    steps: [{ id: 1, kind: "speech", parameters: { chat: { text: "before" }, bubble: { enabled: false } }, next: [] }] };
  f.bindings["Token:npc"].scripts = [script]; await f.runtime.enter(f.scene, "calm");
  script.steps[0].parameters.chat.text = "after"; f.advance(500); await f.runtime.tick(); assert.equal(f.calls.speech[0][2], "before");
  await f.runtime.enter(f.scene, "calm", { force: true }); f.advance(500); await f.runtime.tick(); assert.equal(f.calls.speech[1][2], "after");
});

test("world pause, hidden canvas and emergency halt preserve NPC facts until explicit resume", async () => {
  const f = fixture(); f.bindings["Token:npc"].scripts = [{ stateId: "calm", repeat: false,
    steps: [{ id: 1, kind: "move", parameters: { timeMode: "speed", position: { x: 500, y: 0, speed: 5 } }, next: [] }] }];
  await f.runtime.enter(f.scene, "calm"); const runId = getRuntime(f.scene).runId; f.npc.x = 333;
  game.paused = true; f.advance(5000); await f.runtime.tick(); assert.equal(f.npc.x, 333);
  game.paused = false; canvas.scene = null; await f.runtime.tick(); assert.equal(f.npc.x, 333);
  canvas.scene = f.scene; await f.runtime.haltAll(f.scene); const restored = new GroupRuntime({ effects: f.effects });
  await restored.refresh(f.scene); await restored.tick(); assert.equal(f.npc.x, 333); assert.equal(getRuntime(f.scene).runId, runId);
  await f.runtime.enter(f.scene, "tension", { force: true }); assert.notEqual(getRuntime(f.scene).runId, runId); assert.equal(getRuntime(f.scene).halted, false);
});

test("zone entry emits only for owned characters and rejects old execution runs", async () => {
  const f = fixture(), events = []; f.runtime.emitSignal = async (_scene, event) => { events.push(event); return { allowed: true }; };
  f.definition.states[0].zones = [{ id: "gate", x: 200, y: 0, width: 100, height: 100, signalId: "zone-entered" }];
  await f.runtime.enter(f.scene, "calm"); const oldRun = getRuntime(f.scene).runId;
  f.npc.x = 200; await f.runtime.onTokenMove(f.npc, { x: 150, y: 50 }); assert.equal(events.filter((e) => e.signalId === "zone-entered").length, 0);
  f.player.x = 200; await f.runtime.onTokenMove(f.player, { x: 150, y: 50 });
  assert.equal(events.filter((e) => e.signalId === "zone-entered").length, 1);
  await f.runtime.enter(f.scene, "tension"); assert.equal(f.runtime.owns(f.scene, oldRun), false); await f.runtime.onTokenMove(f.player, { x: 150, y: 50 });
  assert.equal(events.filter((e) => e.signalId === "zone-entered").length, 1);
});

test("halt blocks later entry effects while a started sound resolves", async () => {
  const f = fixture(); let release, started; const ready = new Promise((resolve) => { started = resolve; });
  f.effects.sound = async () => { started(); await new Promise((resolve) => { release = resolve; }); };
  const state = f.definition.states[0]; state.sound = "alarm.ogg";
  state.spawns = [{ id: "guard", actorUuid: "Actor.guard", count: 1, x: 0, y: 0 }];
  const entering = f.runtime.enter(f.scene, "calm"); await ready; const halt = f.runtime.haltAll(f.scene);
  assert.equal(f.runtime.owns(f.scene, getRuntime(f.scene).runId), false); release(); await entering; await halt;
  assert.equal(f.calls.sound.length, 0); assert.equal(f.calls.spawn.length, 0); assert.equal(game.paused, false);
});

test("entry claims persist before effect and an uncertain old effect is not retried", async () => {
  const f = fixture();
  f.definition.states[0].sound = "alarm.ogg";
  f.effects.sound = async () => {
    assert.equal(getRuntime(f.scene).effects.sound.status, "pending");
    throw new Error("sound failed");
  };
  await f.runtime.enter(f.scene, "calm");
  assert.equal(getRuntime(f.scene).effects.sound.status, "failed");
  assert.match(getRuntime(f.scene).error, /sound failed/);
  const state = getRuntime(f.scene);
  state.effects.sound.status = "pending";
  await f.scene.setFlag(MODULE_ID, "groupRuntimes.main", state);
  await f.runtime.refresh(f.scene);
  assert.equal(getRuntime(f.scene).effects.sound.status, "pending");
  assert.equal(f.calls.errors.length, 1);
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
  f.runtime.emitSignal = async (_, event) => { events.push(event); return { allowed: true }; };
  f.definition.states[0].zones = [{ id: "door", x: 200, y: 0, width: 100, height: 100,
    signalId: "zone-entered", conditions: { allowTags: ["member"], resetOnEntry: false } }];
  await f.runtime.enter(f.scene, "calm");
  events.length = 0;
  f.player.x = 200;
  const move = () => f.runtime.onTokenMove(f.player, { x: 150, y: 50 });
  await move();
  assert.deepEqual(getRuntime(f.scene).conditionCounts, {});
  assert.equal(events.length, 0);
  f.bindings["Token:pc"].tags = ["member"];
  await move();
  await move();
  const key = "main:calm:zone:door";
  assert.equal(getRuntime(f.scene).conditionCounts[key], 1);
  assert.equal(events.filter((event) => event.signalId === "zone-entered").length, 1);
  await f.runtime.enter(f.scene, "calm", { force: true });
  await move();
  assert.equal(getRuntime(f.scene).conditionCounts[key], 1, "opt-out quota survives new entry");
  await f.runtime.resetConditions(f.scene, { conditionKey: key });
  await move();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.filter((event) => event.signalId === "zone-entered").length, 2);
});

test("halt requires the elected GM and does not affect another scene or unknown group", async () => {
  const f = fixture();
  await f.runtime.enter(f.scene, "calm");
  await assert.rejects(f.runtime.halt(f.scene, { groupId: "other" }));
  await assert.rejects(f.runtime.halt({ ...f.scene, id: "other" }));
  game.user = game.users.get("gm-b");
  await assert.rejects(f.runtime.haltAll(f.scene));
  game.user = game.users.get("player");
  await assert.rejects(f.runtime.haltAll(f.scene));
  assert.equal(getRuntime(f.scene).halted, false);
});
