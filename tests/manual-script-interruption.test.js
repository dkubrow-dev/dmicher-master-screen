import test from "node:test";
import assert from "node:assert/strict";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";
import { freezeInteractionClock } from "../dmicher-master-screen/scripts/interaction-pause.js";

const copy = structuredClone;
function fixture({ manual = "stop", transition = false } = {}) {
  const user = { id: "gm", role: 4, isGM: true, active: true };
  globalThis.game = { user, users: new Map([[user.id, user]]), modules: new Map(), paused: false };
  let clock = 1000, sequence = 0;
  globalThis.foundry = { utils: { randomID: () => `run-${++sequence}` } };
  globalThis.CONFIG = {};
  const definition = sampleGroupDefinition();
  definition.states[0].sound = "entry.ogg";
  const binding = { type: "Token", id: "npc", groupId: "main", scripts: [], transitionScripts: {} };
  const script = { stateId: "calm", name: "Interrupted script", repeat: false, interruptions: { manual }, steps: [
    { id: 1, kind: "wait", parameters: { seconds: 1 }, next: [2] },
    { id: 2, kind: "wait", parameters: { seconds: 10 }, next: [3] },
    { id: 3, kind: "wait", parameters: { seconds: 20 }, next: [] }
  ] };
  if (transition) {
    binding.transitionScripts.calm = script;
    binding.scripts.push({ stateId: "calm", steps: [{ id: 1, kind: "visibility", parameters: { visible: false }, next: [] }] });
  } else binding.scripts.push(script);
  const flags = { [MODULE_ID]: { groupDefinitions: { main: definition }, groupRuntimes: {},
    objectBindings: { schemaVersion: 1, revision: 0, bindings: { "Token:npc": binding } } } };
  const merge = (before, after) => {
    if (!after || typeof after !== "object" || Array.isArray(after)) return copy(after);
    const result = before && typeof before === "object" ? copy(before) : {};
    for (const [key, value] of Object.entries(after)) {
      if (key.startsWith("-=")) delete result[key.slice(2)]; else result[key] = merge(result[key], value);
    }
    return result;
  };
  const scene = { id: "scene", uuid: "Scene.scene", grid: { size: 100, distance: 5 }, flags, tokens: new Map(),
    getFlag(scope, key) { return copy(this.flags[scope]?.[key]); },
    async setFlag(scope, key, value) {
      let target = this.flags[scope] ??= {}; const path = key.split(".");
      for (const part of path.slice(0, -1)) target = target[part] ??= {};
      target[path.at(-1)] = merge(target[path.at(-1)], value);
    }
  };
  const token = { id: "npc", documentName: "Token", parent: scene, x: 0, y: 0, width: 1, height: 1, rotation: 0,
    hidden: false, object: { stopAnimation() {} }, async update(changes) { Object.assign(this, changes); } };
  scene.tokens.set(token.id, token); globalThis.canvas = { scene };
  const calls = { sound: [], workspace: [], errors: [] };
  const runtime = new GroupRuntime({ now: () => clock, effects: { sound: async (...args) => calls.sound.push(args), stop() {} },
    onWorkspace: async (...args) => calls.workspace.push(args) });
  runtime.canUsePremiumStep = () => true;
  runtime.report = error => calls.errors.push(error);
  const current = () => getRuntime(scene);
  const progress = () => {
    const run = current(), prepared = transition ? run.state.transitions[0] : run.state.scripts[0];
    return run.scriptStates[scriptProgressKey(binding, prepared, transition ? "transition" : "routine")];
  };
  const tick = async (milliseconds = 100) => { clock += milliseconds; await runtime.tick(); };
  const reachSecondStep = async () => { await runtime.enter(scene, "calm"); await tick(1000); await tick(200); assert.equal(progress().stepId, 2); };
  return { scene, token, binding, script, runtime, current, progress, tick, reachSecondStep, calls };
}

for (const [manual, stepId, status] of [["stop", 2, "stopped"], ["restart-step", 2, "ready"], ["next-step", 3, "ready"], ["restart-script", 1, "ready"]]) {
  test(`manual ${manual} applies only on explicit resume, using a new execution identity`, async () => {
    const f = fixture({ manual }); await f.reachSecondStep();
    const previous = f.current(), previousRunId = previous.runId;
    await f.runtime.halt(f.scene, { groupId: "main" });
    await f.tick(1000); assert.equal(f.current().halted, true);
    assert.equal(f.runtime.owns(f.scene, previousRunId), false);
    await f.runtime.startGroup(f.scene, "main");
    const progress = f.progress(); assert.equal(progress.stepId, stepId); assert.equal(progress.status, status);
    assert.notEqual(f.current().runId, previousRunId); assert.equal(f.runtime.owns(f.scene, previousRunId), false);
    assert.equal(progress.action, null); assert.equal(progress.emoji, ""); assert.equal(progress.speechEffect, null);
    assert.deepEqual(progress.dialogueSessions, []); assert.equal(progress.combat, null);
    assert.equal(f.calls.sound.length, 1); assert.equal(f.calls.workspace.length, 1);
    assert.equal(f.current().enteredAt, previous.enteredAt);
    await f.runtime.saveScriptState(f.scene, previous);
    assert.notEqual(f.current().runId, previousRunId, "a late old result cannot overwrite resumed execution");
  });
}

test("default stopped transition does not unexpectedly start the object's routine", async () => {
  const f = fixture({ transition: true }); await f.reachSecondStep();
  await f.runtime.haltAll(f.scene); await f.runtime.startAll(f.scene);
  assert.deepEqual(f.calls.errors, []);
  for (let index = 0; index < 4; index++) await f.tick(1000);
  assert.equal(f.progress().status, "stopped"); assert.equal(f.token.hidden, false);
  await f.runtime.enter(f.scene, "calm", { force: true, restart: true });
  assert.equal(Object.keys(f.current().scriptStates).length, 0); assert.equal(f.calls.sound.length, 2);
});

test("resume retains inventory, condition counts and the running preparation snapshot", async () => {
  const f = fixture({ manual: "restart-step" }); await f.reachSecondStep();
  const run = f.current(); run.shops.stock = { items: [{ id: "spent", stock: 0 }] }; run.conditionCounts.example = 4;
  await saveRuntime(f.scene, run); await f.runtime.haltAll(f.scene);
  f.script.steps[1].parameters.seconds = 99;
  await f.runtime.startAll(f.scene);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.current().state.scripts[0].steps[1].parameters.seconds, 10);
  assert.equal(f.current().shops.stock.items[0].stock, 0); assert.equal(f.current().conditionCounts.example, 4);
});

test("restore initial clears continuation and the next group start is a clean state entry", async () => {
  const f = fixture(); await f.reachSecondStep();
  await f.runtime.restoreGroupInitial(f.scene, "main"); assert.equal(f.current().halted, true);
  await f.runtime.startGroup(f.scene, "main");
  assert.equal(Object.keys(f.current().scriptStates).length, 0); assert.equal(f.calls.sound.length, 2);
});

test("repeated stops do not advance a next-step continuation repeatedly", async () => {
  const f = fixture({ manual: "next-step" }); await f.reachSecondStep();
  await f.runtime.haltAll(f.scene); await f.runtime.haltAll(f.scene); await f.runtime.startAll(f.scene);
  assert.deepEqual(f.calls.errors, []);
  assert.equal(f.progress().stepId, 3);
});

test("choosing another state after Stop starts cleanly instead of applying a previous state's policy", async () => {
  const f = fixture({ manual: "restart-step" }); await f.reachSecondStep();
  await f.runtime.halt(f.scene, { groupId: "main" });
  await f.runtime.startGroup(f.scene, "main", "tension");
  assert.equal(f.current().stateId, "tension"); assert.equal(Object.keys(f.current().scriptStates).length, 0);
  assert.equal(f.calls.workspace.length, 2);
});

test("resuming another group never clears the interrupted group's continuation", async () => {
  const f = fixture({ manual: "restart-step" }); await f.reachSecondStep();
  const second = copy(f.scene.flags[MODULE_ID].groupDefinitions.main); second.groupId = "other"; second.groupName = "Other";
  f.scene.flags[MODULE_ID].groupDefinitions.other = second;
  await f.runtime.startGroup(f.scene, "other"); const otherRunId = getRuntime(f.scene, { groupId: "other" }).runId;
  await f.runtime.halt(f.scene, { groupId: "main" }); await f.runtime.startGroup(f.scene, "main");
  assert.equal(f.progress().stepId, 2); assert.equal(f.progress().status, "ready");
  assert.equal(getRuntime(f.scene, { groupId: "other" }).runId, otherRunId);
  assert.equal(getRuntime(f.scene, { groupId: "other" }).halted, false);
});

function initialProgress(f) {
  const run = [...f.runtime.manualRuns.values()].find(entry => entry.target.id === "npc");
  return run && { run, progress: run.scriptStates[scriptProgressKey(run.target, run.script, "initial")] };
}

for (const [manual, expectedStep] of [["stop", null], ["restart-step", 2], ["next-step", 3], ["restart-script", 1]]) {
  test(`manual initial restoration uses ${manual} through the shared continuation policy`, async () => {
    const f = fixture({ manual }); f.binding.initialScript = copy(f.script);
    await f.runtime.restoreInitial(f.scene, f.binding); await f.tick(1000); await f.tick(200);
    const previous = initialProgress(f); assert.equal(previous.progress.stepId, 2);
    await f.runtime.halt(f.scene, { groupId: "main" });
    assert.equal(f.runtime.manualRuns.size, 0); await f.tick(1000); assert.equal(f.runtime.manualRuns.size, 0);
    await f.runtime.startGroup(f.scene, "main");
    const resumed = initialProgress(f);
    if (expectedStep === null) { assert.equal(resumed, undefined); return; }
    assert.equal(resumed.progress.stepId, expectedStep); assert.equal(resumed.progress.action, null);
    assert.notEqual(resumed.run.runId, previous.run.runId); assert.equal(f.runtime.owns(f.scene, previous.run.runId), false);
    assert.equal(f.runtime.currentObject(f.scene, f.current().runId, f.binding), false,
      "the resumed initial script temporarily owns this object");
    assert.equal(f.current().initialContinuations, undefined);
  });
}

test("full resume also restores a manually stopped initial script without any groups", async () => {
  const f = fixture({ manual: "restart-step" }); f.binding.initialScript = copy(f.script);
  f.binding.groupId = null; f.binding.scripts = []; f.scene.flags[MODULE_ID].groupDefinitions = {};
  await f.runtime.restoreInitial(f.scene, f.binding); await f.tick(1000); await f.tick(200);
  const previousId = initialProgress(f).run.runId;
  await f.runtime.haltAll(f.scene); assert.equal(f.runtime.manualRuns.size, 0);
  assert.equal(f.scene.getFlag(MODULE_ID, "initialContinuations").length, 1);
  await f.runtime.startAll(f.scene); const resumed = initialProgress(f);
  assert.equal(resumed.progress.stepId, 2); assert.notEqual(resumed.run.runId, previousId);
  assert.equal(f.scene.getFlag(MODULE_ID, "initialContinuations").length, 0);
  assert.equal(f.scene.getFlag(MODULE_ID, "automationHalted"), false);
});

test("a fresh initial restoration discards the old continuation for that object", async () => {
  const f = fixture({ manual: "next-step" }); f.binding.initialScript = copy(f.script);
  await f.runtime.restoreInitial(f.scene, f.binding); await f.tick(1000); await f.tick(200);
  await f.runtime.halt(f.scene, { groupId: "main" }); assert.equal(f.current().initialContinuations.length, 1);
  await f.runtime.restoreInitial(f.scene, f.binding);
  assert.deepEqual(f.current().initialContinuations, []);
  const initial = initialProgress(f); assert.equal(initial.progress, undefined);
  await f.tick(100); assert.equal(initialProgress(f).progress.stepId, 1);
});

test("a player interaction during manual initial restoration releases the group's external latch", async () => {
  const f = fixture(); f.binding.initialScript = { ...copy(f.script), interruptions: { interaction: "restart-step" } };
  await f.runtime.enter(f.scene, "calm"); await f.runtime.restoreInitial(f.scene, f.binding);
  await f.tick(1000); await f.tick(200); assert.equal(initialProgress(f).progress.stepId, 2);
  const active = f.current();
  active.shopSessions.shop = { runId: active.runId, target: { type: "Token", id: "npc" }, status: "pending" };
  freezeInteractionClock(active, f.binding); await saveRuntime(f.scene, active);
  await f.tick(100); assert.equal(initialProgress(f).progress.status, "interrupted");
  const finished = f.current(); finished.shopSessions = {}; await saveRuntime(f.scene, finished);
  await f.tick(100); await f.tick(100);
  assert.equal(initialProgress(f).progress.status, "ready", "the completed player interaction must let the manual initial script resume");
  assert.equal(Boolean(f.current().interactionClocks["Token:npc"]?.external), false);
});
