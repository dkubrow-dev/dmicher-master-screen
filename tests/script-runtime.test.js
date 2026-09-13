import test from "node:test";
import assert from "node:assert/strict";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition as defaultDefinition } from "./fixtures/definitions.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";
import { beginInteractionPause, isInteractionPaused } from "../dmicher-master-screen/scripts/interaction-pause.js";
import { notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";
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
function recordScriptWrites(runtime) {
  const writes = [], save = runtime.saveScriptState.bind(runtime);
  runtime.saveScriptState = async (scene, state) => { writes.push(clone(state)); return save(scene, state); };
  return writes;
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
test("scene restoration runs only prepared object initials, selects entry states and preserves resources while stopped", async () => {
  const f = await fixture({ initial: script([step(1, "move", { duration: 1, position: { x: 0, y: 0 } })]),
    transition: script([step(1, "visibility", { visible: false })]) });
  addGroup(f, "east"); f.flags.objectBindings.bindings["Tile:tile"].initialScript = script([step(1, "visibility", { visible: false })]);
  await f.runtime.enter(f.scene, "tension"); await f.runtime.enter(f.scene, "tension", { groupId: "east" });
  const old = getRuntime(f.scene); old.shops = { stock: { items: ["kept"] } }; old.tradeRequests = { receipt: "kept" }; old.disabledObjects = ["Token:npc"]; await saveRuntime(f.scene, old);
  f.npc.x = 200; f.calls.length = 0;
  const ids = await f.runtime.restoreAllInitial(f.scene); assert.equal(ids.length, 2);
  assert.equal(f.runtime.isRestoringInitial(f.scene), true); assert.equal(f.flags.automationHalted, true);
  await f.tick(); assert.equal(f.npc.x, 100); await f.tick(); await f.tick();
  assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(f.npc.x, 0); assert.equal(f.tile.hidden, true); assert.equal(f.npc.hidden, false);
  for (const groupId of ["main", "east"]) { const run = getRuntime(f.scene, { groupId }); assert.equal(run.stateId, "calm"); assert.equal(run.halted, true); assert.equal(run.runId, ""); }
  assert.deepEqual(getRuntime(f.scene).shops, old.shops); assert.deepEqual(getRuntime(f.scene).tradeRequests, old.tradeRequests); assert.deepEqual(getRuntime(f.scene).disabledObjects, old.disabledObjects);
  assert.deepEqual(f.calls, []); assert.equal(f.flags.automationHalted, true);
});
test("scene restoration returns to group entries after state actions in initial scripts without starting groups", async () => {
  const f = await fixture({ initial: script([step(1, "state", { transitions: [{ groupId: "main", stateId: "tension" }] }, [2]), step(2, "visibility", { visible: false })]) });
  await f.runtime.restoreAllInitial(f.scene); await f.tick(); await f.tick();
  assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(getRuntime(f.scene).stateId, "calm");
  assert.equal(getRuntime(f.scene).halted, true); assert.equal(f.flags.automationHalted, true); assert.equal(f.npc.hidden, false);
});
test("a repeated stop cancels remaining initial steps and a late external action cannot continue them", async () => {
  let started, release; const pending = new Promise(resolve => { started = resolve; });
  const f = await fixture({ initial: script([step(1, "macro", { macroUuid: "Macro.slow" }, [2]), step(2, "visibility", { visible: false })]),
    effects: { macro: async () => { started(); await new Promise(resolve => { release = resolve; }); } } });
  f.runtime.isObjectMacroAttached = () => true;
  await f.runtime.restoreAllInitial(f.scene); const ticking = f.tick(); await pending; await f.runtime.haltAll(f.scene); await ticking;
  release(); await new Promise(resolve => setImmediate(resolve)); await f.tick();
  assert.equal(f.runtime.manualRuns.size, 0); assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(f.npc.hidden, false); assert.equal(getRuntime(f.scene).halted, true);
});
test("manual state selection and a new start cancel unfinished scene restoration", async () => {
  const f = await fixture({ initial: script([step(1, "wait", { seconds: 5 }, [2]), step(2, "visibility", { visible: false })]) });
  await f.runtime.restoreAllInitial(f.scene); await f.tick();
  await f.runtime.changeStates(f.scene, [{ groupId: "main", stateId: "tension" }]);
  assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(getRuntime(f.scene).stateId, "tension");
  await f.runtime.restoreAllInitial(f.scene); await f.tick(); await f.runtime.startAll(f.scene);
  assert.equal(f.runtime.manualRuns.size, 0); assert.equal(f.flags.automationHalted, false); assert.equal(getRuntime(f.scene).halted, false);
  for (let i = 0; i < 12; i++) await f.tick(); assert.equal(f.npc.hidden, false);
});
test("scene reset skips absent and player objects and an empty scene stays stopped without creating groups", async () => {
  const f = await fixture({ initial: script([step(1, "visibility", { visible: false })]) });
  f.flags.objectBindings.bindings["Token:npc"].playerCharacter = true;
  f.flags.objectBindings.bindings["Token:missing"] = { ...f.flags.objectBindings.bindings["Token:npc"], id: "missing", playerCharacter: false };
  assert.deepEqual(await f.runtime.restoreAllInitial(f.scene), []); assert.equal(f.npc.hidden, false); assert.equal(f.runtime.isRestoringInitial(f.scene), false);
  f.flags.groupDefinitions = {}; f.flags.objectBindings = { bindings: {} }; f.flags.groupRuntimes = {};
  assert.deepEqual(await f.runtime.restoreAllInitial(f.scene), []); assert.deepEqual(f.flags.groupDefinitions, {}); assert.deepEqual(f.flags.groupRuntimes, {}); assert.equal(f.flags.automationHalted, true);
});
test("a deleted object or replaced group during restoration cannot leave a stuck batch", async () => {
  const f = await fixture({ initial: script([step(1, "wait", { seconds: 5 }, [2]), step(2, "visibility", { visible: false })]) });
  await f.runtime.restoreAllInitial(f.scene); f.scene.tokens.delete("npc"); await f.tick();
  assert.equal(f.runtime.isRestoringInitial(f.scene), false);
  f.scene.tokens.set("npc", f.npc); await f.runtime.restoreAllInitial(f.scene);
  f.flags.groupDefinitions.other = { ...f.flags.groupDefinitions.main, groupId: "other" }; delete f.flags.groupDefinitions.main;
  await f.tick(); assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(f.runtime.manualRuns.size, 0);
});
test("an old restoration callback cannot cancel its replacement and ungrouped prepared objects can restore", async () => {
  const f = await fixture({ initial: script([step(1, "wait", { seconds: 1 }, [2]), step(2, "visibility", { visible: false })]) });
  f.flags.objectBindings.bindings["Token:npc"].groupId = null;
  await f.runtime.restoreAllInitial(f.scene); const old = f.runtime.sceneRestoration;
  await f.runtime.restoreAllInitial(f.scene); const replacement = f.runtime.sceneRestoration;
  assert.notEqual(replacement.id, old.id); assert.equal(await f.runtime.selectInitialStates(f.scene, old), false); assert.equal(f.runtime.sceneRestoration, replacement);
  await f.tick(); await f.tick(); await f.tick(); await f.tick();
  assert.equal(f.npc.hidden, true); assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(f.flags.automationHalted, true);
});
test("a failed initial dialogue leaves the scene stopped and does not prevent other objects from restoring", async () => {
  const f = await fixture({ initial: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: ["Scene.scene.Token.npc"] })]) });
  f.flags.objectBindings.bindings["Tile:tile"].initialScript = script([step(1, "visibility", { visible: false })]);
  const errors = [], original = globalThis.ui; globalThis.ui = { notifications: { error: message => errors.push(message) } };
  try { await f.runtime.restoreAllInitial(f.scene); await f.tick(); await f.tick(); }
  finally { globalThis.ui = original; }
  assert.equal(errors.length, 1); assert.equal(f.tile.hidden, true); assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(f.flags.automationHalted, true); assert.equal(getRuntime(f.scene).stateId, "calm");
});
test("empty initial and transition scripts finish without blocking reset or the routine", async () => {
  const f = await fixture({ initial: script([]), transition: script([]), routine: script([step(1, "visibility", { visible: false })]) });
  await f.runtime.restoreAllInitial(f.scene); await f.tick();
  assert.equal(f.runtime.isRestoringInitial(f.scene), false); assert.equal(f.runtime.manualRuns.size, 0);
  await f.runtime.startAll(f.scene); await f.tick(); assert.equal(f.npc.hidden, true);
});
test("resume all restarts current selected states and respects a stop while validating an earlier group", async () => {
  const f = await fixture(); addGroup(f, "east");
  await f.runtime.enter(f.scene, "tension"); await f.runtime.enter(f.scene, "calm", { groupId: "east" });
  const ids = [getRuntime(f.scene).runId, getRuntime(f.scene, { groupId: "east" }).runId]; await f.runtime.haltAll(f.scene);
  await f.runtime.startAll(f.scene); assert.equal(getRuntime(f.scene).stateId, "tension"); assert.equal(getRuntime(f.scene, { groupId: "east" }).stateId, "calm");
  assert.notEqual(getRuntime(f.scene).runId, ids[0]); assert.notEqual(getRuntime(f.scene, { groupId: "east" }).runId, ids[1]);
  await f.runtime.haltAll(f.scene); let starts = 0;
  f.runtime.emitSignal = async () => { starts++; await f.runtime.haltAll(f.scene); return { allowed: true }; };
  const original = console.error; console.error = () => {};
  try { await f.runtime.startAll(f.scene); } finally { console.error = original; }
  assert.equal(starts, 1); assert.equal(f.flags.automationHalted, true); assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, true);
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
test("canvas refresh restores the saved emotion size and selects it with the latest emotion", async () => {
  const f = await fixture({ routine: script([step(1, "emotion", { emoji: "!", size: 47.5 })]) });
  await f.runtime.enter(f.scene, "calm"); await f.tick();
  assert.equal(f.progress().emojiSize, 47.5);
  const rendered = new Map(), replacement = new GroupRuntime({ visuals: { update: (object, value) => rendered.set(object.id, value) } });
  replacement.refresh(f.scene);
  assert.equal(rendered.get("npc").emoji, "!"); assert.equal(rendered.get("npc").emojiSize, 47.5);
  const at = f.progress().emojiAt;
  replacement.manualVisuals.set("manual", { sceneId: f.scene.id, scriptStates: {
    "Token:npc:initial:manual": { emoji: "?", emojiSize: 18.25, emojiAt: at + 1 },
    "Token:npc:routine:speech": { bubble: { text: "Hello", fontSize: 20 }, bubbleAt: at + 2 }
  } });
  replacement.refreshObject(f.npc);
  assert.equal(rendered.get("npc").emoji, "?"); assert.equal(rendered.get("npc").emojiSize, 18.25);
  assert.equal(rendered.get("npc").bubble.text, "Hello");
  replacement.manualVisuals.clear(); await f.runtime.haltAll(f.scene); replacement.refresh(f.scene);
  assert.equal(rendered.get("npc").emoji, "");
});
const addGroup = (f, groupId) => { f.flags.groupDefinitions[groupId] = { ...defaultDefinition(), groupId, groupName: groupId }; };
test("a state step transitions selected groups, preserves stopped status and retires its own run last", async () => {
  const transitions = [{ groupId: "main", stateId: "tension" }, { groupId: "east", stateId: "tension" }, { groupId: "west", stateId: "tension" }];
  const f = await fixture({ routine: script([step(1, "state", { transitions }, [2]), step(2, "visibility", { visible: false })]) });
  addGroup(f, "east"); addGroup(f, "west");
  await f.runtime.enter(f.scene, "calm", { groupId: "east" }); await f.runtime.halt(f.scene, { groupId: "west" });
  await f.runtime.enter(f.scene, "calm"); const oldRun = getRuntime(f.scene).runId; f.calls.length = 0;
  await f.tick(); await f.tick();
  assert.equal(getRuntime(f.scene).stateId, "tension"); assert.notEqual(getRuntime(f.scene).runId, oldRun);
  assert.equal(getRuntime(f.scene, { groupId: "east" }).stateId, "tension");
  const west = getRuntime(f.scene, { groupId: "west" }); assert.equal(west.stateId, "tension"); assert.equal(west.halted, true); assert.equal(west.runId, "");
  assert.equal(f.npc.hidden, false); assert.equal(f.runtime.owns(f.scene, oldRun), false);
  assert.deepEqual(f.calls.filter(([kind, signal]) => kind === "signal" && signal.name === "transitioned").map(([, signal]) => signal.emitterKey), ["Group:east", "Group:west", "Group:main"]);
});
test("state selection resolves all pairs and validation refusals before changing any group", async () => {
  let rejectEast = false;
  const f = await fixture({ emitSignal: async (_scene, signal) => rejectEast && signal.name === "validateTransition" && signal.emitterKey === "Group:east" ? { allowed: false, messages: ["east refused"] } : { allowed: true } });
  addGroup(f, "east"); await f.runtime.enter(f.scene, "calm"); await f.runtime.enter(f.scene, "calm", { groupId: "east" });
  const before = clone(f.flags);
  await assert.rejects(f.runtime.changeStates(f.scene, [{ groupId: "main", stateId: "tension" }, { groupId: "east", stateId: "missing" }]));
  assert.deepEqual(f.flags, before);
  rejectEast = true; const original = console.error; console.error = () => {};
  try { await assert.rejects(f.runtime.changeStates(f.scene, [{ groupId: "main", stateId: "tension" }, { groupId: "east", stateId: "tension" }]), /east refused/); }
  finally { console.error = original; }
  assert.deepEqual(f.flags, before);
});
test("manual state selection keeps the global stop and same-state or empty selections are no-ops", async () => {
  const f = await fixture(); addGroup(f, "east"); await f.runtime.enter(f.scene, "calm"); await f.runtime.haltAll(f.scene);
  await f.runtime.changeStates(f.scene, [{ groupId: "main", stateId: "tension" }, { groupId: "east", stateId: "tension" }]);
  assert.equal(f.flags.automationHalted, true); assert.equal(getRuntime(f.scene).halted, true); assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, true);
  const before = clone(f.flags); f.calls.length = 0;
  await f.runtime.changeStates(f.scene, []); await f.runtime.changeStates(f.scene, [{ groupId: "main", stateId: "tension" }]);
  assert.deepEqual(f.flags, before); assert.equal(f.calls.length, 0);
});
test("late validation cannot perform state transitions after the originating group stops", async () => {
  let started, finish;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture({ routine: script([step(1, "state", { transitions: [{ groupId: "east", stateId: "tension" }] })]),
    emitSignal: async (_scene, signal) => {
      if (signal.name === "validateTransition" && signal.emitterKey === "Group:east") { started(); return new Promise(resolve => { finish = resolve; }); }
      return { allowed: true };
    } });
  addGroup(f, "east"); await f.runtime.enter(f.scene, "calm", { groupId: "east" }); await f.runtime.enter(f.scene, "calm");
  const ticking = f.tick(); await ready; await f.runtime.halt(f.scene); await ticking;
  finish({ allowed: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(getRuntime(f.scene, { groupId: "east" }).stateId, "calm"); assert.equal(getRuntime(f.scene).halted, true);
});
test("intervention between selected transitions preserves completed changes and prevents remaining changes", async () => {
  let runtime;
  const f = await fixture({ emitSignal: async (scene, signal) => {
    if (signal.name === "transitioned" && signal.emitterKey === "Group:east") await runtime.halt(scene);
    return { allowed: true };
  } });
  runtime = f.runtime; addGroup(f, "east"); addGroup(f, "west");
  await runtime.enter(f.scene, "calm"); const originRunId = getRuntime(f.scene).runId;
  await assert.rejects(runtime.changeStates(f.scene, [{ groupId: "east", stateId: "tension" }, { groupId: "west", stateId: "tension" }], { originRunId }));
  assert.equal(getRuntime(f.scene, { groupId: "east" }).stateId, "tension"); assert.equal(getRuntime(f.scene, { groupId: "west" }).stateId, null);
});
test("a state step in initial restoration retires its manual script without starting a stopped group", async () => {
  const f = await fixture({ initial: script([step(1, "state", { transitions: [{ groupId: "main", stateId: "tension" }] }, [2]), step(2, "visibility", { visible: false })]) });
  await f.runtime.haltAll(f.scene);
  const runId = await f.runtime.restoreInitial(f.scene, { type: "Token", id: "npc" });
  await f.tick(); await f.tick();
  assert.equal(f.runtime.manualRuns.has(runId), false); assert.equal(f.npc.hidden, false);
  assert.equal(getRuntime(f.scene).stateId, "tension"); assert.equal(getRuntime(f.scene).halted, true); assert.equal(f.flags.automationHalted, true);
});
test("halting an already transitioned target stops the rest of a multi-group state action", async () => {
  let runtime;
  const f = await fixture({ emitSignal: async (scene, signal) => {
    if (signal.name === "transitioned" && signal.emitterKey === "Group:east") await runtime.halt(scene, { groupId: "east" });
    return { allowed: true };
  } });
  runtime = f.runtime; addGroup(f, "east"); addGroup(f, "west");
  await runtime.enter(f.scene, "calm"); await runtime.enter(f.scene, "calm", { groupId: "east" }); await runtime.enter(f.scene, "calm", { groupId: "west" });
  const originRunId = getRuntime(f.scene).runId;
  await assert.rejects(runtime.changeStates(f.scene, [{ groupId: "east", stateId: "tension" }, { groupId: "west", stateId: "tension" }], { originRunId }));
  assert.equal(getRuntime(f.scene, { groupId: "east" }).stateId, "tension"); assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, true);
  assert.equal(getRuntime(f.scene, { groupId: "west" }).stateId, "calm"); assert.equal(runtime.owns(f.scene, originRunId), true);
});
test("follow records target corners between ticks and keeps them through interaction pause and reconnect", async () => {
  const f = await fixture({ routine: script([step(1, "follow", { targetUuid: "Scene.scene.Tile.tile", maxDistance: 0, finishOn: "state-change" })]) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = []; f.tile.x = 500;
  await f.runtime.enter(f.scene, "calm"); await f.tick(); assert.equal(f.npc.x, 50);
  const release = beginInteractionPause(f.scene, { type: "Token", id: "npc" });
  f.tile.y = 500; const first = f.runtime.recordFollowTarget(f.tile);
  f.tile.x = 1000; const second = f.runtime.recordFollowTarget(f.tile); await first; await second;
  assert.deepEqual(f.progress().action.follow.points, [{ x: 550, y: 50 }, { x: 550, y: 550 }, { x: 1050, y: 550 }]);
  await f.tick(60000); assert.equal(f.npc.x, 50); release();
  await f.tick(60000); assert.equal(f.npc.x, 50); await f.tick(); assert.equal(f.npc.x, 100); assert.equal(f.npc.y, 0);
  const replacement = new GroupRuntime({ effects: {}, now: f.now });
  replacement.tickTimes.set("scene:main", f.now() - 500); await replacement.tick();
  assert.equal(f.npc.x, 150); assert.equal(f.npc.y, 0); assert.equal(f.progress().action.follow.points.length, 3);
});
test("follow arrival advances once whereas state-change following keeps the next step pending", async () => {
  for (const finishOn of ["arrival", "state-change"]) {
    const f = await fixture({ routine: script([step(1, "follow", { targetUuid: "Scene.scene.Tile.tile", finishOn }, [2]), step(2, "visibility", { visible: false })]) });
    f.flags.objectBindings.bindings["Tile:tile"].scripts = []; f.tile.x = 110;
    await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
    assert.equal(f.npc.hidden, finishOn === "arrival");
    if (finishOn === "state-change") assert.equal(f.progress().stepId, 1);
  }
});
test("native update hooks capture rapid follow turns and release on dispose", async () => {
  const f = await fixture({ routine: script([step(1, "follow", { targetUuid: "Scene.scene.Tile.tile", finishOn: "state-change" })]) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = []; f.tile.x = 500;
  await f.runtime.enter(f.scene, "calm"); await f.tick();
  const hooks = new Map(); let serial = 0;
  globalThis.Hooks = { on(name, callback) { hooks.set(++serial, { name, callback }); return serial; }, off(_name, id) { hooks.delete(id); } };
  f.runtime.start();
  try {
    const update = [...hooks.values()].find(hook => hook.name === "updateTile").callback;
    f.tile.y = 300; update(f.tile); f.tile.x = 800; update(f.tile);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.progress().action.follow.points.slice(-2), [{ x: 550, y: 350 }, { x: 850, y: 350 }]);
  } finally { f.runtime.dispose(); }
  assert.equal(hooks.size, 0);
});
test("dialogue wait modes advance only on their condition and ignore only this script's sessions", async () => {
  for (const waitMode of ["all", "first", "none"]) {
    const f = await fixture({ routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: ["Scene.scene.Token.pc"], waitMode }, [2]), step(2, "visibility", { visible: false })]) });
    f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
    let starts = 0;
    const refs = [1, 2].map(i => ({ sessionId: `session${i}`, userId: `player${i}`, actorTokenId: `pc${i}` }));
    f.runtime.startScriptDialogues = async (_command, { isCurrent }) => {
      starts++; assert.equal(isCurrent(), true);
      const run = getRuntime(f.scene);
      for (const ref of refs) run.dialogueSessions[ref.sessionId] = { ...ref, runId: run.runId, target: { type: "Token", id: "npc" }, status: "active", expiresAt: Date.now() + 60000 };
      await saveRuntime(f.scene, run); assert.equal(isCurrent(refs), true); return refs;
    };
    await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
    assert.equal(starts, 1); assert.equal(f.npc.hidden, waitMode === "none");
    if (waitMode === "none") continue;
    let run = getRuntime(f.scene); run.dialogueSessions.session2.status = "left"; await saveRuntime(f.scene, run);
    await f.tick(); assert.equal(f.npc.hidden, waitMode === "first");
    if (waitMode === "all") {
      run = getRuntime(f.scene); run.dialogueSessions.session1.status = "left";
      run.dialogueSessions.foreign = { ...refs[0], sessionId: "foreign", runId: run.runId, target: { type: "Token", id: "npc" }, status: "active", expiresAt: Date.now() + 60000 };
      await saveRuntime(f.scene, run); await f.tick(); assert.equal(f.npc.hidden, false);
      run = getRuntime(f.scene); run.dialogueSessions.foreign.status = "left"; await saveRuntime(f.scene, run); await f.tick(); assert.equal(f.npc.hidden, true);
    }
  }
});
test("waiting for an open dialogue does not rewrite runtime on every poll and resumes after it closes", async () => {
  const f = await fixture({ routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [], waitMode: "all" }, [2]), step(2, "visibility", { visible: false })]) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  const reference = { sessionId: "session", userId: "player", actorTokenId: "pc" };
  f.runtime.startScriptDialogues = async () => {
    const run = getRuntime(f.scene);
    run.dialogueSessions.session = { ...reference, runId: run.runId, target: { type: "Token", id: "npc" }, status: "active", expiresAt: Date.now() + 60000 };
    await saveRuntime(f.scene, run); return [reference];
  };
  await f.runtime.enter(f.scene, "calm"); await f.tick();
  const writes = recordScriptWrites(f.runtime), before = getRuntime(f.scene);
  for (let i = 0; i < 10; i++) await f.tick(100);
  assert.equal(writes.length, 0); assert.deepEqual(getRuntime(f.scene), before); assert.equal(f.npc.hidden, false);
  const run = getRuntime(f.scene); run.dialogueSessions.session.status = "left"; await saveRuntime(f.scene, run);
  await f.tick(); assert.equal(f.npc.hidden, true); assert.equal(f.progress().status, "done"); assert.ok(writes.length > 0);
});
test("an exhausted combat budget stays read-only until the next own turn", async () => {
  let turn = 1;
  const combat = { context: () => ({ id: "fight", turnKey: `turn${turn}`, isTurn: true }), notify: async () => {}, confirmAction: async () => "continue" };
  const f = await fixture({ combat, routine: script([step(1, "wait", { seconds: 2 })], { combat: { enabled: true, turnSeconds: 1, endTurn: false } }) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
  assert.equal(f.progress().combat.remaining, 0); assert.equal(f.progress().action.remainingMs, 1000);
  const writes = recordScriptWrites(f.runtime);
  for (let i = 0; i < 10; i++) await f.tick(100);
  assert.equal(writes.length, 0); assert.equal(f.progress().action.remainingMs, 1000);
  turn = 2; await f.tick(); await f.tick();
  assert.equal(f.progress().status, "done"); assert.ok(writes.length > 0);
});
test("a completed combat script persists a new turn once without repeating idle writes", async () => {
  let turn = 1;
  const combat = { context: () => ({ id: "fight", turnKey: `turn${turn}`, isTurn: true }), notify: async () => {}, confirmAction: async () => "continue" };
  const f = await fixture({ combat, routine: script([step(1, "visibility", { visible: false })], { combat: { enabled: true, endTurn: false } }) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick(); assert.equal(f.progress().status, "done");
  const writes = recordScriptWrites(f.runtime);
  for (let i = 0; i < 10; i++) await f.tick(100);
  assert.equal(writes.length, 0);
  turn = 2;
  for (let i = 0; i < 10; i++) await f.tick(100);
  assert.equal(writes.length, 1); assert.equal(f.progress().combat.turnKey, "turn2"); assert.equal(f.progress().status, "done");
});
test("dialogue waiting still spends combat time and persists leaving combat only once", async () => {
  let inCombat = true;
  const combat = { context: () => inCombat ? { id: "fight", turnKey: "turn1", isTurn: true } : null, notify: async () => {}, confirmAction: async () => "continue" };
  const f = await fixture({ combat, routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [], waitMode: "all" })], { combat: { enabled: true, turnSeconds: 1, endTurn: false } }) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  const reference = { sessionId: "session", userId: "player", actorTokenId: "pc" };
  f.runtime.startScriptDialogues = async () => {
    const run = getRuntime(f.scene);
    run.dialogueSessions.session = { ...reference, runId: run.runId, target: { type: "Token", id: "npc" }, status: "active", expiresAt: Date.now() + 60000 };
    await saveRuntime(f.scene, run); return [reference];
  };
  await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
  const writes = recordScriptWrites(f.runtime);
  await f.tick(); assert.equal(writes.length, 1); assert.equal(f.progress().combat.remaining, 0);
  for (let i = 0; i < 10; i++) await f.tick(100);
  assert.equal(writes.length, 1);
  inCombat = false; await f.tick(); assert.equal(writes.length, 2); assert.equal(f.progress().combat, null);
  for (let i = 0; i < 10; i++) await f.tick(100);
  assert.equal(writes.length, 2); assert.equal(f.progress().action.phase, "dialogue");
});
test("follow stops additional corners when the world pauses or the combat turn changes during an update", async () => {
  for (const interruption of ["pause", "turn"]) {
    let turn = 1;
    const combat = interruption === "turn" ? { context: () => ({ id: "fight", turnKey: `turn${turn}`, isTurn: turn === 1 }), notify: async () => {}, confirmAction: async () => "continue" } : undefined;
    const f = await fixture({ combat, routine: script([step(1, "follow", { targetUuid: "Scene.scene.Tile.tile", maxDistance: 0, finishOn: "state-change" })], { combat: { enabled: true, turnSeconds: 6 } }) });
    f.flags.objectBindings.bindings["Tile:tile"].scripts = []; f.tile.x = interruption === "turn" ? 500 : 20;
    await f.runtime.enter(f.scene, "calm"); await f.tick();
    f.tile.y = 500; await f.runtime.recordFollowTarget(f.tile); f.tile.x = 1000; await f.runtime.recordFollowTarget(f.tile);
    let updates = 0; f.npc.update = async changes => { Object.assign(f.npc, changes); updates++; if (interruption === "pause") game.paused = true; else turn = 2; };
    await f.tick(1000); assert.equal(updates, 1); assert.equal(f.npc.y, 0);
    game.paused = false;
  }
});
test("a paused dialogue batch keeps one claimed start and resumes without treating its partial result as completion", async () => {
  const f = await fixture({ routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [], waitMode: "none" }, [2]), step(2, "visibility", { visible: false })]) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  let started, starts = 0, deliveries = 0;
  const ready = new Promise(resolve => { started = resolve; });
  f.runtime.startScriptDialogues = async (_command, { waitForAdmission }) => {
    starts++; game.paused = true; started(); await waitForAdmission([]); deliveries++; return [];
  };
  await f.runtime.enter(f.scene, "calm"); const ticking = f.tick(); await ready;
  assert.equal(f.progress().status, "pending"); assert.equal(deliveries, 0); assert.equal(f.npc.hidden, false);
  game.paused = false; notifyExecutionChange(f.scene, "resume"); await ticking; await f.tick();
  assert.equal(starts, 1); assert.equal(deliveries, 1); assert.equal(f.npc.hidden, true);
});
test("a held dialogue batch is released by halt and its late continuation never delivers", async () => {
  const f = await fixture({ routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [], waitMode: "none" })]) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  let started, deliveries = 0; const ready = new Promise(resolve => { started = resolve; });
  f.runtime.startScriptDialogues = async (_command, { waitForAdmission }) => { game.paused = true; started(); await waitForAdmission([]); deliveries++; return []; };
  await f.runtime.enter(f.scene, "calm"); const ticking = f.tick(); await ready; await f.runtime.haltAll(f.scene); await ticking;
  game.paused = false; notifyExecutionChange(f.scene, "resume"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(deliveries, 0); assert.equal(f.runtime.scripts.cancels.size, 0);
});
test("initial restoration refuses scripted dialogue before service calls without launching its group", async () => {
  const f = await fixture({ initial: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [] })]) });
  let calls = 0; f.runtime.startScriptDialogues = async () => { calls++; return []; };
  const runId = await f.runtime.restoreInitial(f.scene, { type: "Token", id: "npc" }); await f.tick();
  assert.equal(calls, 0); assert.equal(getRuntime(f.scene).runId, "");
  assert.ok(Object.values(f.runtime.manualRuns.get(runId).scriptStates).every(progress => progress.status === "failed"));
});
test("a held dialogue batch resumes in the next own combat turn without reopening its first session", async () => {
  let turn = 1, started, deliveries = 0, starts = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const combat = { context: () => ({ id: "fight", turnKey: `turn${turn}`, isTurn: turn !== 2 }), notify: async () => {}, confirmAction: async () => "continue" };
  const f = await fixture({ combat, routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [], waitMode: "none" })], { combat: { enabled: true } }) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  f.runtime.startScriptDialogues = async (_command, { waitForAdmission }) => { starts++; turn = 2; started(); await waitForAdmission([]); deliveries++; return []; };
  await f.runtime.enter(f.scene, "calm"); await f.tick();
  const ticking = f.tick(); await ready; assert.equal(deliveries, 0); assert.equal(f.progress().status, "pending");
  turn = 3; notifyExecutionChange(f.scene, "turn"); await ticking;
  assert.equal(starts, 1); assert.equal(deliveries, 1); assert.equal(f.progress().status, "done");
});
test("repeated dialogue steps discard closed exclusions while retaining exact live participant references", async () => {
  const f = await fixture({ routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [], waitMode: "none" }, [1])]) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  const ref = id => ({ sessionId: id, userId: `user-${id}`, actorTokenId: `token-${id}` });
  let call = 0;
  f.runtime.startScriptDialogues = async () => {
    const references = ++call === 1 ? [ref("closed"), ref("live")] : [ref("new")], run = getRuntime(f.scene);
    for (const reference of references) run.dialogueSessions[reference.sessionId] = { ...reference, runId: run.runId,
      target: { type: "Token", id: "npc" }, status: reference.sessionId === "closed" ? "left" : "active", expiresAt: Date.now() + 60000 };
    await saveRuntime(f.scene, run); return references;
  };
  await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
  assert.deepEqual(f.progress().dialogueSessions, [ref("live"), ref("new")]);
});
