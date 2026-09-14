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
async function fixture({ routine, transition, initial, emitSignal, effects: suppliedEffects, combat, onChange } = {}) {
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
  const runtime = new GroupRuntime({ effects, emitSignal: emitSignal ?? (async (_scene, signal) => { calls.push(["signal", signal]); return { allowed: true }; }), now: () => now, combat, onChange });
  const progress = (slot = "routine", target = { type: "Token", id: "npc" }) => Object.entries(getRuntime(scene).scriptStates).find(([key]) => key.startsWith(`${target.type}:${target.id}:${slot}:`))?.[1];
  return { scene, flags, npc, tile, runtime, calls, progress, now: () => now, async tick(ms = 500) { now += ms; await runtime.tick(); } };
}
function recordScriptWrites(runtime) {
  const writes = [], save = runtime.saveScriptState.bind(runtime);
  runtime.saveScriptState = async (scene, state) => { writes.push(clone(state)); return save(scene, state); };
  return writes;
}
test("Focus is claimed once through the effect adapter and advances to the following step", async () => {
  const calls = [];
  const f = await fixture({ routine: script([step(1, "focus", { audience: "gm" }, [2]), step(2, "wait", { seconds: 10 })]),
    effects: { focus: async (...args) => calls.push(args) } });
  f.scene.tiles.clear(); delete f.flags.objectBindings.bindings["Tile:tile"];
  await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
  assert.equal(calls.length, 1); assert.equal(calls[0][0], f.scene); assert.equal(calls[0][1], f.npc); assert.equal(calls[0][2], "gm");
  assert.equal(calls[0][3].scriptGeneration, 0); assert.ok(calls[0][3].scriptKey.startsWith("Token:npc:routine:"));
  assert.equal(f.progress().stepId, 2);
  await f.runtime.haltAll(f.scene); assert.equal(calls[0][3].isCurrent(), false);
});
async function settlesWithoutRelease(operation) {
  let timer;
  try { return await Promise.race([operation, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Cancellation waited for the old operation")), 1000); })]); }
  finally { clearTimeout(timer); }
}
test("stop releases the scene queue while a native movement update is still unresolved", async () => {
  const f = await fixture({ routine: script([step(1, "move", { duration: 7, position: { x: 100, y: 0 } }, [2]), step(2, "visibility", { visible: false })]) });
  f.scene.tiles.clear(); delete f.flags.objectBindings.bindings["Tile:tile"];
  await f.runtime.enter(f.scene, "calm");
  let begin, release; const began = new Promise(resolve => { begin = resolve; });
  const nativeUpdate = f.npc.update.bind(f.npc);
  f.npc.update = async changes => { begin(); await new Promise(resolve => { release = resolve; }); await nativeUpdate(changes); };
  const ticking = f.tick(); await began;
  const stop = f.runtime.haltAll(f.scene);
  try {
    assert.equal(f.runtime.owns(f.scene, getRuntime(f.scene).runId), false);
    await settlesWithoutRelease(Promise.all([stop, ticking]));
    assert.equal(getRuntime(f.scene).halted, true); assert.equal(f.npc.hidden, false);
    const stoppedState = getRuntime(f.scene);
    release(); await new Promise(resolve => setImmediate(resolve)); await f.tick();
    assert.deepEqual(getRuntime(f.scene), stoppedState); assert.equal(f.npc.hidden, false);
  } finally { release(); }
});
test("stop clears timed emotion and speech immediately without consuming their remaining waits", async () => {
  for (const kind of ["wait", "emotion", "speech"]) {
    const parameters = kind === "wait" ? { seconds: 15 } : kind === "emotion" ? { emoji: "?", duration: 15, executionMode: "wait" }
      : { duration: 15, executionMode: "wait", chat: { enabled: false }, bubble: { enabled: true, text: "Waiting" } };
    const f = await fixture({ routine: script([step(1, kind, parameters, [2]), step(2, "visibility", { visible: false })]) });
    const displayed = new Map(); f.runtime.visuals = { update: (object, value) => displayed.set(object.id, value) };
    await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
    await settlesWithoutRelease(f.runtime.haltAll(f.scene));
    assert.equal(getRuntime(f.scene).halted, true); assert.equal(displayed.get("npc").emoji, ""); assert.equal(displayed.get("npc").bubble, null);
    for (let i = 0; i < 35; i++) await f.tick();
    assert.equal(f.npc.hidden, false); assert.equal(f.tile.hidden, false);
  }
});
test("stopping an individual group cancels its explicit initial script", async () => {
  const f = await fixture({ initial: script([step(1, "wait", { seconds: 10 }, [2]), step(2, "visibility", { visible: false })]) });
  await f.runtime.enter(f.scene, "calm");
  const runId = await f.runtime.restoreInitial(f.scene, { type: "Token", id: "npc" }); await f.tick();
  await f.runtime.halt(f.scene);
  assert.equal(f.runtime.owns(f.scene, runId), false); assert.equal(f.runtime.manualRuns.has(runId), false);
  for (let i = 0; i < 30; i++) await f.tick();
  assert.equal(f.npc.hidden, false);
});
test("manual cancellation during presentation persistence cannot read or restore a vanished run", async () => {
  for (const idle of [false, true]) {
    const f = await fixture({ initial: script(idle ? [] : [step(1, "wait", { seconds: 10 })]) });
    await f.runtime.restoreAllInitial(f.scene);
    let begin, release; const began = new Promise(resolve => { begin = resolve; });
    const tickEffects = f.runtime.scripts.tickEffects.bind(f.runtime.scripts);
    f.runtime.scripts.tickEffects = async (...args) => {
      if (Boolean(args[4]?.idle) === idle) { begin(); await new Promise(resolve => { release = resolve; }); }
      return tickEffects(...args);
    };
    const ticking = f.tick(); await began;
    const stopping = f.runtime.haltAll(f.scene); release();
    await settlesWithoutRelease(Promise.all([stopping, ticking]));
    assert.equal(f.runtime.manualRuns.size, 0); assert.equal(f.runtime.manualVisuals.size, 0); assert.equal(f.runtime.busy, false);
    assert.equal(getRuntime(f.scene).halted, true);
  }
});
test("a start pressed before stop persistence finishes reads the committed stopped state", async () => {
  const f = await fixture(); await f.runtime.enter(f.scene, "calm");
  let begin, release; const began = new Promise(resolve => { begin = resolve; });
  const setFlag = f.scene.setFlag.bind(f.scene);
  f.scene.setFlag = async (...args) => {
    if (args[1] === "automationHalted" && args[2] === true) { begin(); await new Promise(resolve => { release = resolve; }); }
    return setFlag(...args);
  };
  const stopping = f.runtime.haltAll(f.scene); await began;
  const starting = f.runtime.startAll(f.scene); release();
  const [, result] = await Promise.all([stopping, starting]);
  assert.equal(result.length, 1); assert.equal(result[0].error, ""); assert.equal(getRuntime(f.scene).halted, false);
});
test("a delayed expired-chat cleanup neither blocks the clock nor accumulates jobs", async () => {
  let release, cleanups = 0;
  const f = await fixture({ routine: script([step(1, "wait", { seconds: 3 })], { interruptions: { manual: "restart-step" } }), effects: {
    cleanupSpeech: () => { cleanups++; return new Promise(resolve => { release = resolve; }); }
  } });
  try {
    await f.runtime.enter(f.scene, "calm"); await settlesWithoutRelease(f.tick());
    assert.equal(f.progress().action.remainingMs, 2500);
    await f.runtime.haltAll(f.scene); await f.runtime.startAll(f.scene);
    await settlesWithoutRelease(f.tick()); await settlesWithoutRelease(f.tick());
    assert.equal(f.progress().action.remainingMs, 2000); assert.equal(cleanups, 1); assert.equal(f.runtime.busy, false);
  } finally { release(); await f.runtime.cleanupTask; }
});
test("a replacement Start cannot leave the old batch restarting later groups", async () => {
  const f = await fixture(); addGroup(f, "east");
  let begin, release, first = true;
  const began = new Promise(resolve => { begin = resolve; });
  f.runtime.onWorkspace = async () => {
    if (first) { first = false; begin(); await new Promise(resolve => { release = resolve; }); }
  };
  const older = f.runtime.startAll(f.scene); await began;
  const current = f.runtime.startAll(f.scene);
  try {
    await settlesWithoutRelease(Promise.all([older, current]));
    const starts = f.calls.filter(([type, signal]) => type === "signal" && signal.name === "started");
    assert.equal(starts.filter(([, signal]) => signal.emitterKey === "Group:east").length, 1);
    const east = getRuntime(f.scene, { groupId: "east" }); release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(getRuntime(f.scene, { groupId: "east" }), east);
  } finally { release(); }
});
test("a failed presentation adapter cannot veto persisting an emergency stop", async t => {
  let fail = false;
  const f = await fixture({ onChange: () => { if (fail) throw new Error("Render failed"); } }); await f.runtime.enter(f.scene, "calm"); fail = true;
  t.mock.method(console, "error", () => {});
  f.runtime.visuals = { update() { throw new Error("Visual render failed"); } };
  f.runtime.effects.stop = () => { throw new Error("Audio cleanup failed"); };
  await f.runtime.haltAll(f.scene);
  assert.equal(getRuntime(f.scene).halted, true); assert.equal(f.flags.automationHalted, true); assert.ok(f.flags.automationHaltId);
});
test("a late dialogue batch cannot become current again after canvas teardown", async () => {
  const f = await fixture({ routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: ["Scene.scene.Token.npc"] }, [2]), step(2, "visibility", { visible: false })]) });
  f.scene.tiles.clear(); delete f.flags.objectBindings.bindings["Tile:tile"];
  let begin, release, lateAdmission;
  const began = new Promise(resolve => { begin = resolve; });
  f.runtime.startScriptDialogues = async (_input, { isCurrent }) => {
    begin(); await new Promise(resolve => { release = resolve; }); lateAdmission = isCurrent(); return [];
  };
  await f.runtime.enter(f.scene, "calm"); const ticking = f.tick(); await began;
  notifyExecutionChange(f.scene, "canvas-teardown"); await settlesWithoutRelease(ticking);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lateAdmission, false); assert.equal(f.npc.hidden, false); assert.equal(f.runtime.scripts.jobs.size, 0);
});
test("group transition scripts finish before routines and never replay on refresh", async () => {
  const f = await fixture({ transition: script([step(1, "move", { duration: 0, position: { x: 100, y: 0 } })]), routine: script([step(1, "wait", { seconds: 2 })]) });
  await f.runtime.enter(f.scene, "calm"); await f.tick(); assert.equal(f.npc.x, 100); assert.equal(f.progress("transition").status, "done"); assert.equal(f.progress(), undefined);
  await f.tick(); assert.equal(f.progress().action.remainingMs, 1500); f.runtime.refresh(f.scene); await f.tick(); assert.equal(f.progress().action.remainingMs, 1000); assert.equal(f.npc.x, 100);
});
test("a repeating transition keeps executing and intentionally prevents the routine from starting", async (t) => {
  const f = await fixture({ transition: script([step(1, "move", { duration: 0, position: { x: 100, y: 0 } }, [2]), step(2, "emotion", { emoji: "", duration: 0 })], { repeat: true }),
    routine: script([step(1, "speech", { bubble: { enabled: true, text: "Routine reached" }, chat: { enabled: false } })]) });
  game.settings = { get: () => true }; const entries = []; t.mock.method(console, "debug", (...entry) => entries.push(entry));
  await f.runtime.enter(f.scene, "calm");
  for (let i = 0; i < 20; i++) await f.tick();
  assert.equal(f.npc.x, 100); assert.equal(f.progress(), undefined); assert.equal(f.progress("transition").status, "ready");
  assert.equal(f.runtime.busy, false); assert.equal(f.runtime.scripts.jobs.size, 0);
  assert.ok(entries.some(([name]) => name.includes("routine.blockedByRepeatingTransition")));
  assert.ok(entries.some(([name, value]) => name.includes("step.complete") && value.repeating && value.nextStepId === 1));
});
test("movement, concurrent emotion and speech reach every random branch after a finite transition", async () => {
  for (const [random, branch] of [[0, 4], [0.5, 14], [0.99, 25]]) {
    const f = await fixture({ transition: script([step(1, "move", { duration: 0, position: { x: 100, y: 0 } }, [2]), step(2, "emotion", { emoji: "", duration: 0 })]),
      routine: script([step(1, "move", { duration: 0.5, position: { x: 200, y: 0 } }, [2]), step(2, "emotion", { emoji: "?", duration: 5 }, [3]),
        step(3, "speech", { duration: 5, chat: { enabled: false }, bubble: { enabled: true, text: "Thinking", fontSize: 24 } }, [4, 14, 25]),
        ...[4, 14, 25].map(id => step(id, "wait", { seconds: 1 }))]) });
    f.runtime.scripts.random = () => random;
    const displayed = []; f.runtime.visuals = { update: (object, value) => { if (object === f.npc) displayed.push(clone(value)); } };
    await f.runtime.enter(f.scene, "calm");
    for (let i = 0; i < 25 && f.progress()?.stepId !== branch; i++) await f.tick();
    assert.equal(f.npc.x, 200); assert.equal(f.progress().stepId, branch);
    assert.ok(displayed.some(value => value.emoji === "?" && value.bubble?.text === "Thinking"));
    assert.equal(f.progress().bubble, null); assert.equal(f.runtime.busy, false);
  }
});
test("a timed transition emotion keeps its clock after the transition hands control to its routine", async () => {
  const f = await fixture({ transition: script([step(1, "emotion", { emoji: "!", duration: 2 })]), routine: script([step(1, "wait", { seconds: 10 })]) });
  await f.runtime.enter(f.scene, "calm"); await f.tick();
  assert.equal(f.progress("transition").status, "done"); assert.equal(f.progress("transition").emoji, "!");
  await f.tick(); assert.equal(f.progress("transition").emojiEffect.remainingMs, 1500);
  await f.tick(); await f.tick(); await f.tick(); assert.equal(f.progress("transition").emoji, "");
  assert.equal(f.progress().stepId, 1);
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
test("individual initial restoration notifies visible projections after retiring its completed run", async () => {
  const observed = [];
  const f = await fixture({ initial: script([step(1, "wait", { seconds: 0.1 })]),
    onChange: () => observed.push(f.runtime.manualRuns.size) });
  await f.runtime.enter(f.scene, "calm"); await f.runtime.haltAll(f.scene);
  await f.runtime.restoreInitial(f.scene, { type: "Token", id: "npc" });
  observed.length = 0;
  await f.tick(); await f.tick();
  assert.ok(observed.includes(1), "the executing initial is visible");
  assert.equal(f.runtime.manualRuns.size, 0);
  assert.equal(observed.at(-1), 0, "the final notification sees the retired run, even while the scene stays stopped");
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
  assert.deepEqual(getRuntime(f.scene).shops, old.shops); assert.deepEqual(getRuntime(f.scene).tradeRequests, old.tradeRequests); assert.deepEqual(getRuntime(f.scene).disabledObjects, [], "restoration explicitly re-enables object automation");
  assert.deepEqual(f.calls, []); assert.equal(f.flags.automationHalted, true);
});

test("one restore survives a clock tick after Foundry applies entry states but before its write resolves", async () => {
  for (const all of [true, false]) for (const prepared of [false, true]) {
    const f = await fixture({ initial: script([step(1, "move", { duration: 0, position: { x: 0, y: 0 } })]) });
    await f.runtime.enter(f.scene, "tension");
    if (prepared) { await f.runtime.restoreAllInitial(f.scene); await f.tick(); await f.tick(); }
    f.npc.x = 200;
    let begin, release, intercepted = false;
    const written = new Promise(resolve => { begin = resolve; }), pending = new Promise(resolve => { release = resolve; });
    const save = f.scene.setFlag.bind(f.scene);
    f.scene.setFlag = async (scope, key, value) => {
      await save(scope, key, value);
      if (key === "groupRuntimes.main" && value.runId === "" && f.runtime.restorations.size && !intercepted) {
        intercepted = true; begin(); await pending;
      }
    };
    const restoring = all ? f.runtime.restoreAllInitial(f.scene) : f.runtime.restoreGroupInitial(f.scene, "main");
    await written;
    const ticking = f.tick();
    await new Promise(resolve => setImmediate(resolve));
    release();
    const [runs] = await Promise.all([restoring, ticking]);
    assert.equal(runs.length, 1, "the first click must queue the initial script");
    for (let index = 0; index < 4; index++) await f.tick();
    assert.equal(f.npc.x, 0, "the initial position is restored without another click");
    assert.equal(getRuntime(f.scene).halted, true);
    assert.equal(f.runtime.isRestoringInitial(f.scene), false);
  }
});

test("an older tick cannot finish a restore while its scripts are still being prepared", async () => {
  const f = await fixture({ initial: script([step(1, "move", { duration: 0, position: { x: 0, y: 0 } })]) });
  await f.runtime.restoreAllInitial(f.scene); await f.tick(); await f.tick(); f.npc.x = 200;
  let begin, release;
  const written = new Promise(resolve => { begin = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const save = f.scene.setFlag.bind(f.scene);
  f.scene.setFlag = async (scope, key, value) => {
    await save(scope, key, value);
    if (key === "groupRuntimes.main" && value.runId === "" && f.runtime.restorations.size) { begin(); await pending; }
  };
  const restoring = f.runtime.restoreAllInitial(f.scene); await written;
  const batch = [...f.runtime.restorations.values()][0];
  const finishing = f.runtime.finishRestoration(f.scene, batch);
  await new Promise(resolve => setImmediate(resolve)); release();
  const [runs] = await Promise.all([restoring, finishing]);
  assert.equal(runs.length, 1);
  assert.equal(f.runtime.restorations.get(batch.id), batch, "preparation cannot be mistaken for a completed batch");
  await f.tick(); await f.tick();
  assert.equal(f.npc.x, 0); assert.equal(f.runtime.isRestoringInitial(f.scene), false);
});

test("emergency stop cancels restore preparation immediately while its native save is pending", async () => {
  const f = await fixture({ initial: script([step(1, "move", { duration: 0, position: { x: 0, y: 0 } })]) });
  await f.runtime.enter(f.scene, "tension"); f.npc.x = 200;
  let begin, release, intercepted = false;
  const written = new Promise(resolve => { begin = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const save = f.scene.setFlag.bind(f.scene);
  f.scene.setFlag = async (scope, key, value) => {
    await save(scope, key, value);
    if (key === "groupRuntimes.main" && value.runId === "" && f.runtime.restorations.size && !intercepted) {
      intercepted = true; begin(); await pending;
    }
  };
  const restoring = f.runtime.restoreAllInitial(f.scene); await written;
  const stopping = f.runtime.haltAll(f.scene);
  assert.equal(f.runtime.isRestoringInitial(f.scene), false, "Stop cancels locally without waiting for persistence");
  release();
  const [runs] = await Promise.all([restoring, stopping]);
  assert.deepEqual(runs, []);
  await f.tick(); await f.tick();
  assert.equal(f.npc.x, 200); assert.equal(getRuntime(f.scene).halted, true);
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
  await f.runtime.restoreAllInitial(f.scene); const old = [...f.runtime.restorations.values()][0];
  await f.runtime.restoreAllInitial(f.scene); const replacement = [...f.runtime.restorations.values()][0];
  assert.notEqual(replacement.id, old.id); await f.runtime.finishRestoration(f.scene, old); assert.equal(f.runtime.restorations.get(replacement.id), replacement);
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

test("group start, stop and restore leave another group's lifetime and routine running", async () => {
  const f = await fixture({ initial: script([step(1, "wait", { seconds: 1 }, [2]), step(2, "move", { duration: 0, position: { x: 0, y: 0 } })]),
    routine: script([step(1, "wait", { seconds: 2 }, [2]), step(2, "visibility", { visible: false })]) });
  addGroup(f, "east"); f.flags.objectBindings.bindings["Tile:tile"].groupId = "east";
  await f.runtime.startGroup(f.scene, "main", "tension"); await f.runtime.startGroup(f.scene, "east");
  const eastId = getRuntime(f.scene, { groupId: "east" }).runId;
  await f.runtime.halt(f.scene, { groupId: "main" });
  assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, false);
  f.npc.x = 200;
  const ids = await f.runtime.restoreGroupInitial(f.scene, "main");
  assert.equal(ids.length, 1); assert.equal(f.runtime.isRestoringInitial(f.scene, "main"), true);
  assert.equal(f.runtime.isRestoringInitial(f.scene, "east"), false);
  for (let index = 0; index < 7; index++) await f.tick();
  assert.equal(f.npc.x, 0); assert.equal(f.tile.hidden, true, "other group's routine completed while the first group restored");
  assert.equal(getRuntime(f.scene).stateId, "calm"); assert.equal(getRuntime(f.scene).halted, true);
  assert.equal(getRuntime(f.scene, { groupId: "east" }).runId, eastId);
  assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, false);
  assert.equal(f.flags.automationHalted, false);
  await f.runtime.startGroup(f.scene, "main");
  assert.equal(getRuntime(f.scene).halted, false); assert.equal(getRuntime(f.scene, { groupId: "east" }).runId, eastId);
});

test("two group restorations can run concurrently and stopping one leaves the other alive", async () => {
  const initial = script([step(1, "wait", { seconds: 1 }, [2]), step(2, "visibility", { visible: false })]);
  const f = await fixture({ initial }); addGroup(f, "east");
  Object.assign(f.flags.objectBindings.bindings["Tile:tile"], { groupId: "east", initialScript: initial });
  await f.runtime.startAll(f.scene);
  const mainIds = await f.runtime.restoreGroupInitial(f.scene, "main"), eastIds = await f.runtime.restoreGroupInitial(f.scene, "east");
  assert.equal(f.runtime.restorations.size, 2);
  await f.runtime.halt(f.scene, { groupId: "main" });
  assert.equal(f.runtime.owns(f.scene, mainIds[0]), false);
  assert.equal(f.runtime.owns(f.scene, eastIds[0]), true);
  await f.runtime.startGroup(f.scene, "main", "tension");
  assert.equal(f.runtime.owns(f.scene, eastIds[0]), true, "starting a different group preserves restoration ownership");
  for (let index = 0; index < 5; index++) await f.tick();
  assert.equal(f.npc.hidden, false); assert.equal(f.tile.hidden, true);
  assert.equal(getRuntime(f.scene).halted, false); assert.equal(getRuntime(f.scene).stateId, "tension");
  assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, true);
  assert.equal(f.runtime.restorations.size, 0);
});

test("full stop cancels every group restoration and a group start releases only its own stopped state", async () => {
  const initial = script([step(1, "wait", { seconds: 5 }, [2]), step(2, "visibility", { visible: false })]);
  const f = await fixture({ initial }); addGroup(f, "east");
  Object.assign(f.flags.objectBindings.bindings["Tile:tile"], { groupId: "east", initialScript: initial });
  await f.runtime.restoreGroupInitial(f.scene, "main"); await f.runtime.restoreGroupInitial(f.scene, "east");
  await f.tick(); await f.runtime.haltAll(f.scene);
  assert.equal(f.runtime.restorations.size, 0); assert.equal(f.runtime.manualRuns.size, 0);
  await f.runtime.startGroup(f.scene, "main");
  assert.equal(f.flags.automationHalted, false); assert.equal(getRuntime(f.scene).halted, false);
  assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, true);
  for (let index = 0; index < 12; index++) await f.tick();
  assert.equal(f.npc.hidden, false); assert.equal(f.tile.hidden, false);
});

test("starting another group after full Stop does not invalidate a scoped restoration", async () => {
  const f = await fixture({ initial: script([step(1, "wait", { seconds: 1 }, [2]), step(2, "visibility", { visible: false })]) });
  addGroup(f, "east"); await f.runtime.haltAll(f.scene);
  const [id] = await f.runtime.restoreGroupInitial(f.scene, "main");
  assert.equal(f.flags.automationHalted, true);
  await f.runtime.startGroup(f.scene, "east");
  assert.equal(f.flags.automationHalted, false); assert.equal(f.runtime.owns(f.scene, id), true);
  for (let index = 0; index < 5; index++) await f.tick();
  assert.equal(f.npc.hidden, true); assert.equal(getRuntime(f.scene).halted, true);
  assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, false);
});

test("a slow group validation is independent of another group and is cancelled by its own Stop", async () => {
  const f = await fixture(); addGroup(f, "east");
  let begin, release; const began = new Promise(resolve => { begin = resolve; });
  f.runtime.emitSignal = async (_scene, signal) => {
    if (signal.emitterKey === "Group:main" && signal.name === "validateStart") { begin(); await new Promise(resolve => { release = resolve; }); }
    return { allowed: true };
  };
  const starting = f.runtime.startGroup(f.scene, "main"); await began;
  await f.runtime.startGroup(f.scene, "east");
  assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, false);
  await f.runtime.halt(f.scene, { groupId: "main" }); release();
  assert.equal(await starting, null); assert.equal(getRuntime(f.scene).halted, true);
  assert.equal(getRuntime(f.scene, { groupId: "east" }).halted, false);
});
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
    // Native animation may still expose a previous frame through x/y when the
    // document-update hook fires. Record the committed turn, not that frame.
    f.tile._source = { x: 900, y: 600, width: 100, height: 100 };
    update(f.tile);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.progress().action.follow.points.at(-1), { x: 950, y: 650 });
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
      for (const ref of refs) run.dialogueSessions[ref.sessionId] = { ...ref, runId: run.runId, origin: "script", target: { type: "Token", id: "npc" }, status: "active", expiresAt: Date.now() + 60000 };
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
      run = getRuntime(f.scene); run.dialogueSessions.foreign.status = "left"; await saveRuntime(f.scene, run); await f.tick();
      assert.equal(f.npc.hidden, false); assert.equal(f.progress().status, "stopped");
    }
  }
});
test("waiting for an open dialogue does not rewrite runtime on every poll and resumes after it closes", async () => {
  const f = await fixture({ routine: script([step(1, "dialogue", { dialogueId: "talk", tokenUuids: [], waitMode: "all" }, [2]), step(2, "visibility", { visible: false })]) });
  f.flags.objectBindings.bindings["Tile:tile"].scripts = [];
  const reference = { sessionId: "session", userId: "player", actorTokenId: "pc" };
  f.runtime.startScriptDialogues = async () => {
    const run = getRuntime(f.scene);
    run.dialogueSessions.session = { ...reference, runId: run.runId, origin: "script", target: { type: "Token", id: "npc" }, status: "active", expiresAt: Date.now() + 60000 };
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
    run.dialogueSessions.session = { ...reference, runId: run.runId, origin: "script", target: { type: "Token", id: "npc" }, status: "active", expiresAt: Date.now() + 60000 };
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
    for (const reference of references) run.dialogueSessions[reference.sessionId] = { ...reference, runId: run.runId, origin: "script",
      target: { type: "Token", id: "npc" }, status: reference.sessionId === "closed" ? "left" : "active", expiresAt: Date.now() + 60000 };
    await saveRuntime(f.scene, run); return references;
  };
  await f.runtime.enter(f.scene, "calm"); await f.tick(); await f.tick();
  assert.deepEqual(f.progress().dialogueSessions, [ref("live"), ref("new")]);
});
