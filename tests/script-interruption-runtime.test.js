import test from "node:test";
import assert from "node:assert/strict";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";
import { notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";
import { beginInteractionPause, freezeInteractionClock } from "../dmicher-master-screen/scripts/interaction-pause.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";

const clone = structuredClone;
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
const wait = (id, seconds, next = []) => step(id, "wait", { seconds }, next);
const macro = (id, next = []) => step(id, "macro", { macroUuid: "Macro.test", before: 0, after: 0 }, next);
function merge(before, after) {
  if (!after || typeof after !== "object" || Array.isArray(after)) return clone(after);
  const result = before && typeof before === "object" ? clone(before) : {};
  for (const [key, value] of Object.entries(after)) {
    if (key.startsWith("-=")) delete result[key.slice(2)]; else result[key] = merge(result[key], value);
  }
  return result;
}

function fixture({ interruptions, steps = [wait(9, 10, [4, 25]), wait(1, 1, [9]), wait(4, 10), wait(25, 20)],
  combatEnabled = false, transition = false, macroEffect = async () => {} } = {}) {
  const gm = { id: "gm", isGM: true, role: 4, active: true }, player = { id: "player", role: 1, active: true };
  globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player]]), modules: new Map(), combats: new Map(), paused: false };
  let clock = 1000, serial = 0;
  globalThis.foundry = { utils: { randomID: () => `run-${++serial}` } }; globalThis.CONFIG = {};
  const script = { stateId: "calm", name: "Interrupted script", repeat: false, interruptions,
    combat: { enabled: combatEnabled, confirm: false, notifyWarning: false, turnSeconds: 1 }, steps };
  const binding = { type: "Token", id: "npc", groupId: "main", scripts: transition ? [{ stateId: "calm", steps: [step(1, "visibility", { visible: false })] }] : [script],
    transitionScripts: transition ? { calm: script } : {} };
  const flags = { groupDefinitions: { main: sampleGroupDefinition() }, groupRuntimes: {},
    objectBindings: { schemaVersion: 1, revision: 0, bindings: { "Token:npc": binding } } };
  const scene = { id: "scene", uuid: "Scene.scene", grid: { size: 100, distance: 5 }, tokens: new Map(),
    getFlag(_scope, key) { return clone(flags[key]); },
    async setFlag(_scope, key, value) {
      let target = flags; const parts = key.split(".");
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = merge(target[parts.at(-1)], value);
    }
  };
  const token = { id: "npc", documentName: "Token", parent: scene, x: 0, y: 0, width: 1, height: 1, rotation: 0,
    hidden: false, object: { stopAnimation() {} }, async update(changes) { Object.assign(this, changes); } };
  scene.tokens.set(token.id, token); globalThis.canvas = { scene };
  const calls = { macro: 0, stop: 0, errors: [] };
  const runtime = new GroupRuntime({ now: () => clock, effects: { sound: async () => {}, stop: () => calls.stop++,
    macro: async (...args) => { calls.macro++; return macroEffect(...args); } } });
  runtime.report = error => calls.errors.push(error); runtime.isObjectMacroAttached = () => true; runtime.scripts.random = () => 0.99;
  const current = () => getRuntime(scene);
  const progress = () => {
    const run = current(), prepared = transition ? run.state.transitions[0] : run.state.scripts[0];
    return run.scriptStates[scriptProgressKey(binding, prepared, transition ? "transition" : "routine")];
  };
  const tick = async (milliseconds = 100) => { clock += milliseconds; await runtime.tick(); };
  const start = async () => { await runtime.enter(scene, "calm"); await tick(1000); };
  const reachCurrentStep = async () => { await start(); await tick(200); assert.equal(progress().stepId, 9); assert.equal(progress().action.remainingMs, 9800); };
  const dialogue = async ({ origin = "player", status = "active", id = "session" } = {}) => {
    const run = current(); run.dialogueSessions[id] = { sessionId: id, userId: player.id, actorTokenId: "pc", runId: run.runId,
      target: { type: "Token", id: token.id }, origin, status, expiresAt: Date.now() + 600_000 };
    await saveRuntime(scene, run);
    return { sessionId: id, userId: player.id, actorTokenId: "pc" };
  };
  const combat = (active, ownTurn = false, turn = 0) => {
    if (!active) { game.combats.clear(); return; }
    game.combats.set("fight", { id: "fight", scene, started: true, active: true, round: 1, turn,
      combatant: { id: ownTurn ? "npc-combatant" : "pc-combatant", tokenId: ownTurn ? token.id : "pc" } });
  };
  return { scene, token, flags, binding, script, runtime, current, progress, tick, start, reachCurrentStep, dialogue, combat, calls, now: () => clock };
}

test("failed retry-budget persistence stops local ticking until a fresh explicit run", async () => {
  const f = fixture({ interruptions: { error: { mode: "restart-step", retries: 3, delaySeconds: 0.1 } } });
  await f.reachCurrentStep();
  const setFlag = f.scene.setFlag; let writes = 0;
  f.scene.setFlag = async () => { writes++; throw new Error("Storage unavailable"); };
  await assert.rejects(f.tick(), /Storage unavailable/);
  assert.equal(writes, 2, "one progress write and one attempt to persist its failure");
  for (let index = 0; index < 10; index++) await f.tick(1000);
  assert.equal(writes, 2, "a lost retry budget cannot generate an endless per-tick retry loop");
  f.scene.setFlag = setFlag;
  await f.runtime.startGroup(f.scene, "main"); await f.tick(100);
  assert.equal(f.progress().status, "ready");
  assert.equal(f.progress().action.remainingMs, 900);
});

for (const source of ["interaction", "combat", "command"]) {
  for (const [mode, expectedStep] of [["stop", 9], ["restart-step", 9], ["next-step", 25], ["restart-script", 1]]) {
    test(`${source} ${mode} interrupts an active step and resumes only after its source ends`, async () => {
      const f = fixture({ interruptions: { [source]: mode } }); await f.reachCurrentStep();
      if (source === "interaction") await f.dialogue();
      else if (source === "combat") f.combat(true);
      else f.runtime.scriptInterruptionSource = () => "command";
      await f.tick();
      const interrupted = f.progress(); assert.equal(interrupted.status, mode === "stop" ? "stopped" : "interrupted");
      assert.equal(interrupted.interruption.source, source); assert.equal(interrupted.interruption.resumeStepId, expectedStep);
      assert.equal(interrupted.action, null); assert.ok(interrupted.generation > 0);
      for (let index = 0; index < 3; index++) await f.tick(1000);
      assert.deepEqual(f.progress(), interrupted, "the active cause cannot repeatedly advance or recreate the interruption");
      if (source === "interaction") await f.dialogue({ status: "finished" });
      else if (source === "combat") f.combat(false);
      else f.runtime.scriptInterruptionSource = () => null;
      await f.tick();
      assert.equal(f.progress().status, mode === "stop" ? "stopped" : "ready");
      assert.equal(f.progress().stepId, expectedStep);
      assert.equal(f.progress().action, null, "resumption never consumes elapsed paused time");
      if (mode !== "stop") {
        assert.equal(f.progress().interruption, null);
        await f.tick(100);
        const expectedSeconds = f.script.steps.find(value => value.id === expectedStep).parameters.seconds;
        assert.equal(f.progress().action.remainingMs, expectedSeconds * 1000 - 100);
      }
      assert.deepEqual(f.calls.errors, []);
    });
  }
}

test("next-step follows graph IDs rather than row order and a terminal edge ends without a phantom restart", async () => {
  const f = fixture({ interruptions: { interaction: "next-step" }, steps: [wait(8, 20), wait(1, 20)] });
  await f.start(); await f.dialogue(); await f.tick();
  assert.equal(f.progress().interruption.resumeStepId, null);
  await f.dialogue({ status: "finished" }); await f.tick();
  assert.equal(f.progress().stepId, null); assert.equal(f.progress().status, "done");
});

test("an ignored command waits for the active block and prevents a new routine from starting", async () => {
  const f = fixture({ interruptions: { command: "ignore" }, transition: true, steps: [wait(1, 3)] });
  await f.start();
  let waiting = true, executed = 0;
  f.runtime.commandExecutor = {
    has: () => false, runs: () => [],
    interruptionSource: () => waiting ? "command" : null,
    blocksScript: (_scene, target, script, runId) => {
      if (!waiting) return false;
      const state = f.runtime.scriptState(f.scene, runId);
      const progress = script && state.scriptStates[scriptProgressKey(target, script, script.name === f.script.name ? "transition" : "routine")];
      return script?.interruptions.command !== "ignore" || !progress || progress.status === "done";
    },
    async tick() { if (waiting && f.progress().status === "done") { waiting = false; executed++; } return []; }
  };
  await f.tick(1000);
  assert.equal(waiting, true); assert.equal(executed, 0);
  assert.equal(f.progress().action.remainingMs, 1000);
  assert.equal(f.progress().interruption, null);
  await f.tick(1000);
  assert.equal(f.progress().status, "done"); assert.equal(executed, 0);
  assert.equal(f.token.hidden, false, "new routine cannot run before the waiting command");
  await f.tick(); assert.equal(f.token.hidden, true);
  assert.equal(executed, 1);
});

test("command before/after blocks use the shared executor, persistence and parent dialogue sessions", async () => {
  const f = fixture({ steps: [wait(1, 10)] }); await f.start();
  const parent = f.current();
  const script = normalizeScript({ steps: [step(1, "dialogue", { dialogueId: "own-dialogue", tokenUuids: ["Scene.scene.Token.pc"], waitMode: "all" }, [2]),
    step(2, "visibility", { visible: false })], interruptions: { command: "ignore" } });
  let command = { ...clone(parent), command: true, runId: "command-run", parentRunId: parent.runId, sceneId: f.scene.id,
    target: { type: "Token", id: f.token.id }, script, scriptSlot: "command-before", scriptStates: {} };
  const own = runId => runId === command?.runId;
  f.runtime.commandExecutor = {
    has: own, owns: (_scene, runId) => own(runId), runs: () => command ? [clone(command)] : [],
    state: () => clone(command), save: async (_scene, state) => { command = clone(state); },
    current: (_scene, run, target, options) => own(run.runId) && target.id === f.token.id
      && (options.ignoreInteractionPause || !f.runtime.scriptInteractionPaused(f.scene, run, target, options.scriptKey, options.excludeDialogueSessions)),
    interruptionSource: (_scene, _target, _script, runId) => own(runId) ? null : "command",
    blocksScript: () => true,
    async tick(scene, elapsed) {
      const job = await f.runtime.scripts.tick(scene, command, f.token, command.script, elapsed, { slot: command.scriptSlot });
      return job ? [job] : [];
    }
  };
  const requests = [];
  f.runtime.startScriptDialogues = async (request, options) => {
    requests.push(request); assert.equal(request.runId, parent.runId);
    const reference = await f.dialogue({ origin: "script", id: "command-dialogue" });
    assert.equal(options.isCurrent([reference]), true, "own command dialogue does not interrupt its opening block");
    return [reference];
  };
  await f.tick();
  const key = scriptProgressKey(command.target, command.script, command.scriptSlot);
  assert.equal(requests.length, 1); assert.equal(command.scriptStates[key].action.phase, "dialogue");
  for (let index = 0; index < 3; index++) await f.tick(1000);
  assert.equal(command.scriptStates[key].stepId, 1); assert.equal(f.token.hidden, false);
  await f.dialogue({ origin: "script", status: "finished", id: "command-dialogue" }); await f.tick();
  assert.equal(f.token.hidden, true); assert.equal(command.scriptStates[key].status, "done");
  assert.equal(Object.hasOwn(f.current().scriptStates, key), false, "command progress cannot overwrite group progress");
});

test("combat-enabled scripts retain their current step at combat start and turn boundaries", async () => {
  const f = fixture({ combatEnabled: true, interruptions: { combat: "stop" }, steps: [wait(1, 20)] });
  await f.start(); const before = f.progress(); f.combat(true, false); await f.tick(1000);
  assert.equal(f.progress().interruption, null); assert.equal(f.progress().generation, 0);
  assert.equal(f.progress().action.remainingMs, before.action.remainingMs);
  f.combat(true, true, 1); await f.tick(); await f.tick();
  const afterTurn = f.progress(); assert.equal(afterTurn.action.remainingMs, before.action.remainingMs - 1000);
  f.combat(true, false, 2); await f.tick(1000);
  assert.equal(f.progress().action.remainingMs, afterTurn.action.remainingMs);
  assert.equal(f.progress().interruption, null); assert.equal(f.progress().generation, 0);
  f.combat(false); await f.tick(100);
  assert.equal(f.progress().action.remainingMs, afterTurn.action.remainingMs - 100);
  assert.deepEqual(f.calls.errors, []);
});

for (const delaySeconds of [0.1, 1, 60]) {
  test(`error retries stop after the initial call plus three retries and wait ${delaySeconds} seconds before each`, async () => {
    const f = fixture({ interruptions: { error: { mode: "restart-step", retries: 3, delaySeconds } }, steps: [macro(1)],
      macroEffect: async () => { throw new Error("Expected test failure"); } });
    await f.start(); assert.equal(f.calls.macro, 1);
    for (let retry = 1; retry <= 3; retry++) {
      const interrupted = f.progress(); assert.equal(interrupted.status, "interrupted");
      assert.equal(interrupted.errorRetries, retry); assert.equal(interrupted.interruption.retryAt, f.now() + delaySeconds * 1000);
      await f.tick(delaySeconds * 1000 - 1); assert.equal(f.progress().status, "interrupted"); assert.equal(f.calls.macro, retry);
      await f.tick(1); assert.equal(f.progress().status, "ready"); assert.equal(f.calls.macro, retry);
      await f.tick(0); assert.equal(f.calls.macro, retry + 1);
    }
    assert.equal(f.progress().status, "failed"); assert.equal(f.progress().errorRetries, 3);
    for (let index = 0; index < 3; index++) await f.tick(60_000);
    assert.equal(f.calls.macro, 4); assert.equal(f.progress().status, "failed");
  });
}

for (const [mode, expectedStep] of [["stop", 9], ["restart-step", 9], ["next-step", 25], ["restart-script", 1]]) {
  test(`error ${mode} uses the authored continuation with bounded retries`, async () => {
    const f = fixture({ interruptions: { error: { mode, retries: 1, delaySeconds: 0.1 } },
      steps: [macro(9, [4, 25]), wait(1, 1, [9]), wait(4, 10), wait(25, 20)],
      macroEffect: async () => { throw new Error("Expected test failure"); } });
    await f.start(); assert.equal(f.calls.macro, 1);
    assert.equal(f.progress().interruption.resumeStepId, expectedStep);
    await f.tick(100);
    assert.equal(f.progress().status, mode === "stop" ? "failed" : "ready");
    assert.equal(f.progress().stepId, expectedStep);
    assert.equal(f.progress().errorRetries, mode === "stop" ? 0 : 1);
  });
}

test("a player's interaction cancels a pending macro without accepting its eventual completion", async () => {
  let release, began;
  const entered = new Promise(resolve => { began = resolve; });
  const f = fixture({ interruptions: { interaction: "next-step" }, steps: [macro(1, [9]), wait(9, 20)],
    macroEffect: async () => { began(); await new Promise(resolve => { release = resolve; }); } });
  await f.runtime.enter(f.scene, "calm"); const ticking = f.tick(); await entered;
  try {
    assert.equal(f.progress().status, "pending"); await f.dialogue(); await f.tick();
    let timer;
    try { await Promise.race([ticking, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The interrupted macro still owns the tick")), 1000); })]); }
    finally { clearTimeout(timer); }
    assert.equal(f.progress().status, "interrupted"); const stopped = clone(f.progress());
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.progress(), stopped, "the old promise cannot commit into the interrupted generation");
    await f.dialogue({ status: "finished" }); await f.tick();
    assert.equal(f.progress().stepId, 9); assert.equal(f.progress().status, "ready"); assert.equal(f.calls.macro, 1);
  } finally { release?.(); f.runtime.dispose(); }
});

test("a short accepted interaction remains an interruption even when it finishes before the next tick", async () => {
  let release, began;
  const entered = new Promise(resolve => { began = resolve; });
  const f = fixture({ interruptions: { interaction: "next-step" }, steps: [macro(1, [9]), wait(9, 20)],
    macroEffect: async () => { began(); await new Promise(resolve => { release = resolve; }); } });
  await f.runtime.enter(f.scene, "calm"); const ticking = f.tick(); await entered;
  try {
    await f.dialogue(); notifyExecutionChange(f.scene, "dialogue-opened");
    await f.dialogue({ status: "finished" }); notifyExecutionChange(f.scene, "dialogue-finished");
    let timer;
    try { await Promise.race([ticking, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The short interaction did not cancel the pending macro")), 1000); })]); }
    finally { clearTimeout(timer); }
    await f.tick();
    assert.equal(f.progress().stepId, 9); assert.equal(f.progress().status, "ready");
    assert.equal(f.progress().generation, 1); assert.equal(f.calls.macro, 1);
    const resumed = clone(f.progress()); release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.progress(), resumed); assert.notEqual(f.progress().status, "uncertain");
  } finally { release?.(); f.runtime.dispose(); }
});

async function briefAcceptedDialogue(f) {
  await f.dialogue();
  const run = f.current(); freezeInteractionClock(run, { type: "Token", id: "npc" }, f.now());
  await saveRuntime(f.scene, run);
  await f.dialogue({ status: "finished" });
}

for (const [mode, expectedStep] of [["restart-step", 9], ["next-step", 25]]) {
  test(`a short completed interaction applies ${mode} to an active wait exactly once`, async () => {
    const f = fixture({ interruptions: { interaction: mode } }); await f.reachCurrentStep();
    await briefAcceptedDialogue(f);
    assert.equal(f.current().interactionClocks["Token:npc"].external, true);
    await f.tick();
    assert.equal(f.progress().status, "ready"); assert.equal(f.progress().stepId, expectedStep); assert.equal(f.progress().generation, 1);
    assert.equal(f.progress().action, null); assert.equal(f.current().interactionClocks["Token:npc"], null);
    await f.tick(); assert.equal(f.progress().generation, 1, "the completed interaction marker is consumed once");
    assert.equal(f.progress().stepId, expectedStep);
  });
}

for (const [mode, expectedStep] of [["restart-step", 1], ["next-step", 9]]) {
  test(`the first native movement preserves ${mode} when an accepted interaction finishes before the clock ticks`, async () => {
    const f = fixture({ interruptions: { interaction: mode }, steps: [step(1, "move", { duration: 10, position: { x: 100, y: 0 } }, [9]), wait(9, 20)] });
    let releaseNative, entered;
    const enteredNative = new Promise(resolve => { entered = resolve; });
    f.token.update = async changes => { entered(); await new Promise(resolve => { releaseNative = resolve; }); Object.assign(f.token, changes); };
    await f.runtime.enter(f.scene, "calm"); const ticking = f.tick(100); await enteredNative;
    assert.equal(f.progress().action.started, true, "the initial movement is recorded before native I/O");
    const releaseAdmission = beginInteractionPause(f.scene, { type: "Token", id: "npc" });
    try {
      await ticking;
      await briefAcceptedDialogue(f); releaseAdmission();
      await f.tick();
      assert.equal(f.progress().status, "ready"); assert.equal(f.progress().stepId, expectedStep); assert.equal(f.progress().generation, 1);
      assert.equal(f.progress().action, null); const continued = clone(f.progress());
      releaseNative(); await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(f.progress(), continued, "a late native write does not advance or overwrite the chosen continuation");
    } finally { releaseAdmission(); releaseNative?.(); f.runtime.dispose(); }
  });
}

test("a rejected interaction admission never interrupts an active wait", async () => {
  const f = fixture(); await f.reachCurrentStep(); const before = f.progress();
  const release = beginInteractionPause(f.scene, { type: "Token", id: "npc" });
  await f.tick(1000);
  assert.equal(f.progress().status, "ready"); assert.equal(f.progress().generation, 0); assert.equal(f.progress().interruption, null);
  assert.equal(f.progress().action.remainingMs, before.action.remainingMs);
  release(); await f.tick();
  assert.equal(f.progress().interruption, null); assert.equal(f.progress().action.remainingMs, before.action.remainingMs);
  await f.tick(); assert.equal(f.progress().action.remainingMs, before.action.remainingMs - 100);
  assert.equal(f.progress().generation, 0); assert.equal(f.progress().status, "ready");
});

test("a manual stop during an error delay prevents every scheduled retry", async () => {
  const f = fixture({ interruptions: { error: { mode: "restart-step", retries: 3, delaySeconds: 1 } }, steps: [macro(1)],
    macroEffect: async () => { throw new Error("Expected test failure"); } });
  await f.start(); assert.equal(f.calls.macro, 1); assert.equal(f.progress().status, "interrupted");
  await f.tick(200); await f.runtime.haltAll(f.scene);
  const halted = clone(f.current());
  for (let index = 0; index < 3; index++) await f.tick(60_000);
  assert.equal(f.current().halted, true); assert.equal(f.calls.macro, 1);
  assert.deepEqual(f.current(), halted, "the retry timer cannot write or restart a stopped execution");
});

test("successful steps do not replenish the retry budget for the same script run", async () => {
  const attempts = new Map();
  const f = fixture({ interruptions: { error: { mode: "restart-step", retries: 2, delaySeconds: 0.1 } }, steps: [macro(1, [9]), macro(9)],
    macroEffect: async (_uuid, { stepId }) => {
      const count = (attempts.get(stepId) ?? 0) + 1; attempts.set(stepId, count);
      if (stepId === 9 || count === 1) throw new Error("Expected test failure");
    } });
  await f.start(); assert.equal(f.progress().errorRetries, 1);
  await f.tick(100); await f.tick(0); await f.tick(0);
  assert.equal(f.progress().stepId, 9); assert.equal(f.progress().errorRetries, 2);
  await f.tick(100); await f.tick(0);
  assert.equal(f.progress().status, "failed"); assert.equal(f.progress().errorRetries, 2);
  assert.equal(attempts.get(1), 2); assert.equal(attempts.get(9), 2);
});

test("a script's own dialogue uses its wait policy without becoming player interruption", async () => {
  const f = fixture({ steps: [step(1, "dialogue", { dialogueId: "talk", tokenUuids: ["Scene.scene.Token.pc"], waitMode: "all" }, [9]), wait(9, 20)] });
  f.runtime.startScriptDialogues = async () => [await f.dialogue({ origin: "script" })];
  await f.start();
  assert.equal(f.progress().action.phase, "dialogue"); assert.equal(f.progress().interruption, null);
  for (let index = 0; index < 3; index++) await f.tick(1000);
  assert.equal(f.progress().status, "ready"); assert.equal(f.progress().action.phase, "dialogue"); assert.equal(f.progress().generation, 0);
  await f.dialogue({ origin: "script", status: "finished" }); await f.tick();
  assert.equal(f.progress().stepId, 9); assert.equal(f.progress().interruption, null); assert.equal(f.progress().generation, 0);
});

test("the default stopped transition cannot fall through into a different routine", async () => {
  const f = fixture({ transition: true }); await f.reachCurrentStep();
  await f.dialogue(); await f.tick(); assert.equal(f.progress().status, "stopped");
  await f.dialogue({ status: "finished" });
  for (let index = 0; index < 4; index++) await f.tick(1000);
  assert.equal(f.progress().status, "stopped"); assert.equal(f.token.hidden, false);
});
