import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
import { defaultObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";
import { requestSceneHalt, finishSceneHalt, notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";
import { saveRuntime } from "../dmicher-master-screen/scripts/store.js";

const configured = id => ({ ...defaultObjectCommand(id), enabled: true });
const script = (seconds, command = "ignore") => normalizeScript({ id: "work", stateId: "calm", name: "Work", interruptions: { command },
  steps: [{ id: 1, kind: "wait", parameters: { seconds }, next: [] }] });
async function complete(f, limit = 30) { for (let i = 0; f.active() && i < limit; i++) await f.tick(1000); assert.equal(f.active(), null); }

test("authoritative command rejects wrong owner, disabled config, excessive range and busy target", async () => {
  const f = await commandFixture();
  await assert.rejects(f.accept("wait", {}, { id: "stranger" }), /own character/);
  f.pc.x = 1000; await assert.rejects(f.accept("wait"), /too far/); f.pc.x = 100;
  await assert.rejects(f.accept("patrol"), /does not accept/);
  await f.accept("wait"); await assert.rejects(f.accept("come"), /already carrying/);
  assert.equal(f.active().config.parameters.seconds, 10);
  await complete(f); assert.deepEqual(f.errors, []);
});

test("before/core/after share one lifetime and cannot take client supplied speed or duration", async () => {
  const wait = configured("wait"); wait.parameters.seconds = 0.3;
  wait.beforeScript = script(0.2); wait.afterScript = script(0.2);
  const f = await commandFixture({ commands: [wait] });
  await f.accept("wait", { seconds: 0, speed: 999 });
  assert.equal(f.active().phase, "before"); assert.deepEqual(f.active().request.parameters, {});
  const phases = new Set();
  for (let i = 0; f.active() && i < 30; i++) { phases.add(f.active().phase); await f.tick(); }
  assert.equal(f.active(), null); assert.ok(phases.has("core")); assert.ok(phases.has("after"));
  assert.equal(f.signals.filter(entry => entry.name === "commandCompleted").length, 1);
  assert.deepEqual(f.errors, []);
});

test("command waits for an existing ignore script, then executes without starting a fresh routine", async () => {
  const f = await commandFixture({ scripts: [script(0.3)] }); await f.tick(); await f.tick();
  const parent = f.current(), key = scriptProgressKey({ type: "Token", id: "npc" }, parent.state.scripts[0]);
  assert.equal(parent.scriptStates[key].status, "ready");
  await f.accept("wait"); assert.equal(f.active().phase, "waiting");
  for (let i = 0; f.active().phase === "waiting" && i < 8; i++) await f.tick();
  assert.equal(f.active().phase, "before"); assert.equal(f.current().scriptStates[key].status, "done");
  await complete(f); assert.deepEqual(f.errors, []);
});

test("default command interruption cancels routine immediately and a replacing Wait cancels movement", async () => {
  const f = await commandFixture({ scripts: [script(100, "stop")] }); await f.tick(); await f.tick();
  await f.accept("come"); const first = f.active().runId;
  const progress = Object.values(f.current().scriptStates)[0]; assert.equal(progress.status, "stopped");
  await f.accept("wait"); assert.notEqual(f.active().runId, first); assert.equal(f.active().config.id, "wait");
  await complete(f); assert.deepEqual(f.errors, []);
});

test("global pause consumes no command time; stop aborts a pending native operation without awaiting it", async () => {
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  const f = await commandFixture({ core: { async tick(_scene, run) { entered(); await new Promise(resolve => { release = resolve; }); run.core.late = true; return { done: true }; } } });
  await f.accept("wait"); await f.tick();
  game.paused = true; await f.tick(); assert.deepEqual(f.active().core, {}); game.paused = false;
  const tick = f.tick(); await waiting;
  const generation = requestSceneHalt(f.scene);
  await Promise.race([tick, new Promise((_, reject) => setTimeout(() => reject(new Error("Stop blocked")), 200))]);
  await f.tick(); assert.equal(f.active(), null);
  release(); await Promise.resolve(); assert.equal(f.active(), null);
  finishSceneHalt(f.scene, generation);
});

test("manual restart-step resumes only after explicit start with a new command lease", async () => {
  const wait = configured("wait"); wait.interruptions.manual = "restart-step";
  const f = await commandFixture({ commands: [wait] }); await f.accept("wait"); await f.tick(); await f.tick();
  const old = f.active().runId;
  const parent = f.current(); parent.halted = true; await saveRuntime(f.scene, parent); notifyExecutionChange(f.scene);
  await f.tick(); assert.equal(f.active().interruption.source, "manual");
  for (let i = 0; i < 3; i++) await f.tick(); assert.equal(f.active().runId, old);
  parent.halted = false; parent.runId = "resumed-parent"; await saveRuntime(f.scene, parent); await f.tick();
  assert.notEqual(f.active().runId, old); assert.equal(f.active().parentRunId, "resumed-parent");
  await complete(f); assert.deepEqual(f.errors, []);
});

test("state change retires a command and signal veto has no command side effects", async () => {
  const denied = await commandFixture({ emit: () => ({ allowed: false }) });
  await assert.rejects(denied.accept("wait"), /rejected/); assert.equal(denied.active(), null);
  const f = await commandFixture(); await f.accept("wait");
  const parent = f.current(); parent.stateId = "alert"; await saveRuntime(f.scene, parent); await f.tick();
  assert.equal(f.active(), null);
});

test("command failures use a bounded retry budget and the common clock delay", async () => {
  const wait = configured("wait"); wait.interruptions.error = { mode: "restart-step", retries: 2, delaySeconds: 0.3 };
  let calls = 0;
  const f = await commandFixture({ commands: [wait], core: { async tick() { calls++; throw new Error("Expected command failure"); } } });
  const report = console.error; console.error = () => {};
  try {
    await f.accept("wait"); await f.tick(); await f.tick(); assert.equal(calls, 1);
    assert.equal(f.active().errorRetries, 1);
    await f.tick(100); await f.tick(100); assert.equal(calls, 1, "retry does not run before the configured delay");
    for (let i = 0; f.active() && i < 20; i++) await f.tick();
    assert.equal(f.active(), null); assert.equal(calls, 3, "initial attempt and exactly two retries");
    for (let i = 0; i < 5; i++) await f.tick(); assert.equal(calls, 3);
  } finally { console.error = report; }
});

test("a validator cannot change accepted configuration without a fresh admission", async () => {
  const f = await commandFixture();
  f.executor.signals.emit = async (_scene, signal) => {
    if (signal.name === "commandRequested") f.flags.objectBindings.bindings["Token:npc"].commands[0].parameters.seconds = 90;
    return { allowed: true };
  };
  await assert.rejects(f.accept("wait"), /conditions changed/);
  assert.equal(f.active(), null);
});

test("an unselected secret door or a door on another level cannot be forged by UUID", async () => {
  const f = await commandFixture({ commands: ["delegate"] });
  const door = { id: "door", uuid: "Scene.scene.Wall.door", documentName: "Wall", parent: f.scene, door: 2, ds: 0, c: [0, 0, 100, 0] };
  f.scene.walls.set(door.id, door);
  f.flags.objectBindings.bindings["Wall:door"] = { type: "Wall", id: "door", commands: [configured("open")] };
  await assert.rejects(f.accept("delegate", { targetUuid: door.uuid, commandId: "open" }), /available door/);
  door.door = 1; door.levels = new Set(["upstairs"]); f.pc.level = "downstairs";
  await assert.rejects(f.accept("delegate", { targetUuid: door.uuid, commandId: "open" }), /different level/);
  assert.equal(f.active(), null);
});

test("playerCharacter commands use Players even when stored groupId names another group", async () => {
  const f = await commandFixture({ commands: ["wait"] });
  try {
    f.binding.playerCharacter = true;
    await f.runtime.enter(f.scene, "default", { groupId: "players" });
    await f.accept("wait");
    assert.equal(f.active().groupId, "players");
    assert.equal(f.binding.groupId, "main", "reading effective group must not mutate preparation");
    assert.equal(f.executor.owns(f.scene, f.active().runId), true);
    await complete(f); assert.deepEqual(f.errors, []);
  } finally { f.runtime.dispose(); }
});

test("runtime disposal releases group invocation runner", async () => {
  const f = await commandFixture(); let disposed = 0;
  const release = f.runtime.invocations.groups.dispose.bind(f.runtime.invocations.groups);
  f.runtime.invocations.groups.dispose = () => { disposed++; release(); };
  f.runtime.dispose(); assert.equal(disposed, 1);
});
