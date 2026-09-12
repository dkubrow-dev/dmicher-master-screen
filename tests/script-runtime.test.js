import test from "node:test";
import assert from "node:assert/strict";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition as defaultDefinition } from "./fixtures/definitions.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";
import { beginInteractionPause, isInteractionPaused } from "../dmicher-master-screen/scripts/interaction-pause.js";
const clone = structuredClone;
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
const script = (steps, extra = {}) => ({ name: "Script", enabled: true, repeat: false, steps, ...extra });
function merge(a, b) { if (!b || typeof b !== "object" || Array.isArray(b)) return clone(b); const result = a && typeof a === "object" ? clone(a) : {}; for (const [key, value] of Object.entries(b)) { if (key.startsWith("-=")) delete result[key.slice(2)]; else result[key] = merge(result[key], value); } return result; }
async function fixture({ routine, transition, initial, emitSignal, effects: suppliedEffects, combat } = {}) {
  let serial = 0, now = 1000;
  const gm = { id: "gm", isGM: true, role: 4, active: true };
  globalThis.game = { user: gm, users: new Map([[gm.id, gm]]), scenes: new Map(), combats: new Map(), modules: new Map(), paused: false };
  globalThis.foundry = { utils: { randomID: () => `run${++serial}` } }; globalThis.CONFIG = {};
  const flags = { groupDefinitions: { main: defaultDefinition() }, objectBindings: { bindings: {
    "Token:npc": { type: "Token", id: "npc", groupId: "main", scripts: routine ? [{ stateId: "calm", ...routine }] : [], transitionScripts: transition ? { calm: transition } : {}, initialScript: initial ?? null },
    "Tile:tile": { type: "Tile", id: "tile", groupId: "main", scripts: routine ? [{ stateId: "calm", ...routine }] : [] }
  } } };
  const scene = { id: "scene", uuid: "Scene.scene", grid: { size: 100, distance: 5 }, tokens: new Map(), tiles: new Map(),
    getFlag: (_scope, key) => clone(flags[key]), async setFlag(_scope, key, value) { const parts = key.split("."); let owner = flags; for (const part of parts.slice(0, -1)) owner = owner[part] ??= {}; owner[parts.at(-1)] = merge(owner[parts.at(-1)], value); } };
  const make = (id, type) => ({ id, documentName: type, uuid: `Scene.scene.${type}.${id}`, name: id, parent: scene, x: 0, y: 0, width: type === "Token" ? 1 : 100, height: type === "Token" ? 1 : 100, rotation: 0, hidden: false, object: { checkCollision: () => false }, async update(changes) { Object.assign(this, changes); } });
  const npc = make("npc", "Token"), tile = make("tile", "Tile"); scene.tokens.set(npc.id, npc); scene.tiles.set(tile.id, tile); game.scenes.set(scene.id, scene); globalThis.canvas = { scene };
  const calls = [], effects = { cleanupSpeech: async () => {}, sound: async (...args) => calls.push(["sound", ...args]), spawn: async () => [], ...suppliedEffects };
  const runtime = new GroupRuntime({ effects, emitSignal: emitSignal ?? (async (_scene, signal) => { calls.push(["signal", signal]); return { allowed: true }; }), now: () => now, combat });
  const progress = (slot = "routine", target = { type: "Token", id: "npc" }) => Object.entries(getRuntime(scene).scriptStates).find(([key]) => key.startsWith(`${target.type}:${target.id}:${slot}:`))?.[1];
  return { scene, flags, npc, tile, runtime, calls, progress, now: () => now, async tick(ms = 500) { now += ms; await runtime.tick(); } };
}
test("group transition scripts finish before routines and never replay on refresh", async () => {
  const f = await fixture({ transition: script([step(1, "move", { duration: 0, position: { x: 100, y: 0 } })]), routine: script([step(1, "wait", { seconds: 2 })]) });
  await f.runtime.enter(f.scene, "calm"); await f.tick(); assert.equal(f.npc.x, 100); assert.equal(f.progress("transition").status, "done"); assert.equal(f.progress(), undefined);
  await f.tick(); assert.equal(f.progress().action.remainingMs, 1500); f.runtime.refresh(f.scene); await f.tick(); assert.equal(f.progress().action.remainingMs, 1000); assert.equal(f.npc.x, 100);
});
test("Token and Tile interaction pauses freeze script duration and resume without catch-up", async () => {
  const f = await fixture({ routine: script([step(1, "wait", { seconds: 7 })]) }); await f.runtime.enter(f.scene, "calm"); await f.tick();
  const target = { type: "Tile", id: "tile" }, release = beginInteractionPause(f.scene, target); assert.equal(isInteractionPaused(f.scene, target), true);
  await f.tick(60000); const key = Object.keys(getRuntime(f.scene).scriptStates).find((key) => key.startsWith("Tile:")); assert.equal(getRuntime(f.scene).scriptStates[key].action.remainingMs, 6500);
  release(); await f.tick(60000); assert.equal(getRuntime(f.scene).scriptStates[key].action.remainingMs, 6500); await f.tick(); assert.equal(getRuntime(f.scene).scriptStates[key].action.remainingMs, 6000);
});
test("explicit initial restoration pauses regular automation and works after group stop", async () => {
  const f = await fixture({ routine: script([step(1, "move", { duration: 10, position: { x: 100, y: 0 } })]), initial: script([step(1, "move", { duration: 1, position: { x: 0, y: 0 } })]) });
  await f.runtime.enter(f.scene, "calm"); await f.tick(); assert.equal(f.npc.x, 5);
  const id = await f.runtime.restoreInitial(f.scene, { type: "Token", id: "npc" });
  assert.equal(f.runtime.currentObject(f.scene, getRuntime(f.scene).runId, { type: "Token", id: "npc" }), false);
  await f.tick(); await f.tick(); assert.equal(f.npc.x, 0); await f.tick(); assert.equal(f.runtime.manualRuns.has(id), false);
  await f.runtime.haltAll(f.scene); f.npc.x = 50; await f.runtime.restoreInitial(f.scene, { type: "Token", id: "npc" }); await f.tick(); await f.tick(); assert.equal(f.npc.x, 0); assert.equal(getRuntime(f.scene).halted, true);
});
test("validation rejection leaves group state and world untouched", async () => {
  const f = await fixture({ emitSignal: async (_scene, signal) => signal.name === "validateStart" ? { allowed: false, messages: ["Rejected"] } : { allowed: true }, transition: script([step(1, "visibility", { visible: false })]) });
  const old = console.error; console.error = () => {};
  try { await assert.rejects(f.runtime.enter(f.scene, "calm"), /Rejected/); } finally { console.error = old; }
  assert.equal(getRuntime(f.scene).runId, ""); assert.equal(f.npc.hidden, false);
});
test("state selection preserves stopped status and does not execute prepared scripts", async () => {
  const f = await fixture({ transition: script([step(1, "visibility", { visible: false })]) });
  await f.runtime.enter(f.scene, "calm", { preserveStatus: true }); await f.tick(); assert.equal(getRuntime(f.scene).runId, ""); assert.equal(f.npc.hidden, false);
  await f.runtime.enter(f.scene, "calm", { force: true, restart: true }); await f.tick(); assert.equal(f.npc.hidden, true);
  await f.runtime.haltAll(f.scene); await f.runtime.enter(f.scene, "tension", { preserveStatus: true }); assert.equal(getRuntime(f.scene).halted, true);
});
test("native document failure stops the script and does not repeat its write every tick", async () => {
  const f = await fixture({ routine: script([step(1, "move", { duration: 1, position: { x: 100, y: 0 } })]) }); let writes = 0;
  f.npc.update = async () => { writes++; throw new Error("Write failed"); }; await f.runtime.enter(f.scene, "calm");
  const old = console.error; console.error = () => {};
  try { await f.tick(); await f.tick(); } finally { console.error = old; }
  assert.equal(writes, 1); assert.equal(f.progress().status, "failed");
});
