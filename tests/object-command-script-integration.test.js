import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
import { defaultObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { freezeInteractionClock } from "../dmicher-master-screen/scripts/interaction-pause.js";

const configured = id => ({ ...defaultObjectCommand(id), enabled: true });
const block = steps => normalizeScript({ name: "Command script", steps, interruptions: { command: "ignore" } });
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
const target = { type: "Token", id: "npc" };
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Command cancellation waited for a late effect")), 500); })]); }
  finally { clearTimeout(timer); }
}

test("a command's preceding dialogue waits on parent sessions without external-interaction cancellation", async () => {
  const command = configured("wait"); command.parameters.seconds = 0.1;
  command.beforeScript = block([step(1, "dialogue", { dialogueId: "greeting", tokenUuids: ["Scene.scene.Token.pc"], waitMode: "all" }, [2]),
    step(2, "visibility", { visible: false })]);
  const f = await commandFixture({ commands: [command] });
  let calls = 0;
  f.runtime.startScriptDialogues = async (packet, options) => {
    calls++;
    const parent = f.current(); assert.equal(packet.runId, parent.runId);
    const reference = { sessionId: "greeting", actorTokenId: f.pc.id, userId: f.player.id };
    parent.dialogueSessions.greeting = { ...reference, runId: parent.runId, target, origin: "script", status: "active", expiresAt: Date.now() + 60_000 };
    await saveRuntime(f.scene, parent);
    assert.equal(options.isCurrent([reference]), true);
    return [reference];
  };
  await f.accept("wait"); const runId = f.active().runId; await f.tick();
  for (let i = 0; i < 5; i++) await f.tick(1000);
  assert.equal(calls, 1); assert.equal(f.active().runId, runId); assert.equal(f.active().phase, "before");
  assert.equal(f.active().interruption, null); assert.equal(f.npc.hidden, false);
  const parent = f.current(); parent.dialogueSessions.greeting.status = "finished"; await saveRuntime(f.scene, parent);
  for (let i = 0; f.active() && i < 15; i++) await f.tick();
  assert.equal(f.active(), null); assert.equal(f.npc.hidden, true); assert.deepEqual(f.errors, []);
  assert.equal(f.signals.filter(signal => signal.name === "commandCompleted").length, 1);
});

test("short accepted interaction interrupts a command before the group acknowledges its completed marker", async () => {
  const command = configured("wait"); command.interruptions.interaction = "restart-step";
  const f = await commandFixture({ commands: [command], scripts: [{ stateId: "calm", ...block([step(1, "wait", { seconds: 100 })]), interruptions: { command: "stop" } }] });
  await f.tick(); await f.accept("wait"); await f.tick(); await f.tick(1000);
  const runId = f.active().runId, before = f.active().core.waitRemaining;
  const parent = f.current(); freezeInteractionClock(parent, target); await saveRuntime(f.scene, parent);
  await f.tick();
  assert.equal(f.active().interruption?.source, "interaction"); assert.equal(f.active().runId, runId);
  assert.equal(f.active().core.waitRemaining, before);
  await f.tick(); assert.notEqual(f.active().runId, runId); assert.equal(f.active().interruption, null);
  await f.tick(); assert.ok(f.active().core.waitRemaining > before, "restart-step starts the command phase afresh");
  assert.deepEqual(f.errors, []);
});

test("cancelling a command releases an unresolved preceding macro and ignores its late result", async () => {
  const command = configured("wait"); command.beforeScript = block([step(1, "macro", { macroUuid: "Macro.pending", before: 0, after: 0 }, [2]),
    step(2, "visibility", { visible: false })]);
  command.beforeScript.interruptions.command = "stop";
  const f = await commandFixture({ commands: [command, "cancel"] });
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  f.runtime.isObjectMacroAttached = () => true;
  f.runtime.effects.macro = async () => { entered(); await pending; };
  await f.accept("wait"); const original = f.active().runId;
  const ticking = f.tick(); await started;
  try {
    await within(f.accept("cancel")); await within(ticking);
    const replacement = f.active().runId; assert.notEqual(replacement, original);
    release(); await new Promise(setImmediate); await f.tick();
    assert.equal(f.active().runId, replacement); assert.equal(f.npc.hidden, false);
    assert.equal(f.signals.filter(signal => signal.name === "commandCancelled" && signal.id.startsWith(`${original}:`)).length, 1);
    assert.deepEqual(f.errors, []);
  } finally { release(); }
});

test("rapid full stop and start preserve manual command policy without waiting for a simulation tick", async () => {
  const command = configured("wait"); command.interruptions.manual = "restart-step";
  const f = await commandFixture({ commands: [command] });
  await f.accept("wait"); await f.tick(); await f.tick(1000);
  const original = f.active().runId;
  const stopping = f.runtime.haltAll(f.scene), starting = f.runtime.startAll(f.scene);
  await within(Promise.all([stopping, starting]));
  assert.equal(f.active().interruption?.source, "manual");
  await f.tick();
  assert.notEqual(f.active().runId, original); assert.equal(f.active().parentRunId, f.current().runId);
  assert.equal(f.active().interruption, null); assert.deepEqual(f.errors, []);
});

test("a replacement rejected after its stop barrier cancels the old pending script with an explicit warning", async () => {
  const command = configured("wait"); command.beforeScript = block([step(1, "macro", { macroUuid: "Macro.pending", before: 0, after: 0 }, [2]),
    step(2, "visibility", { visible: false })]);
  command.beforeScript.interruptions.command = "stop";
  const f = await commandFixture({ commands: [command, "cancel"] });
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  f.runtime.isObjectMacroAttached = () => true; f.runtime.effects.macro = async () => { entered(); await pending; };
  await f.accept("wait"); const ticking = f.tick(); await started;
  const stop = f.executor.stopPresentation.bind(f.executor);
  f.executor.stopPresentation = (...args) => { stop(...args); f.pc.x = 2000; };
  try {
    await assert.rejects(within(f.accept("cancel")), error => error.code === "replacement-rejected" && /previous command/i.test(error.message));
    await within(ticking); assert.equal(f.active(), null);
    release(); await new Promise(setImmediate); await f.tick();
    assert.equal(f.active(), null); assert.equal(f.npc.hidden, false);
    assert.deepEqual(f.errors, []);
  } finally { release(); }
});

test("parallel presentation from a preceding script retains its own duration during the command core", async () => {
  const command = configured("wait"); command.beforeScript = block([step(1, "emotion", { emoji: "!", size: 32, duration: 2, executionMode: "parallel" })]);
  const f = await commandFixture({ commands: [command] });
  await f.accept("wait"); await f.tick();
  assert.equal(f.active().phase, "core");
  const key = Object.keys(f.active().scriptStates)[0];
  assert.equal(f.active().scriptStates[key].emoji, "!");
  await f.tick(1000); assert.equal(f.active().scriptStates[key].emoji, "!");
  await f.tick(1000); assert.equal(f.active().scriptStates[key].emoji, "");
  assert.equal(f.active().phase, "core"); assert.deepEqual(f.errors, []);
});

test("replacing movement with Wait waits for an ignored preceding script and never executes the old core", async () => {
  const come = configured("come"); come.beforeScript = block([step(1, "wait", { seconds: 0.3 })]);
  const coreCalls = [];
  const f = await commandFixture({ commands: [come, "wait", "cancel"], core: { async tick(_scene, run) { coreCalls.push(run.config.id); return { done: true }; } } });
  await f.accept("come"); await f.tick();
  const original = f.active().runId;
  await f.accept("wait");
  assert.equal(f.active().runId, original); assert.equal(f.active().phase, "before");
  await assert.rejects(f.accept("cancel"), /waiting for an accepted command/);
  const key = Object.keys(f.active().scriptStates)[0], remaining = f.active().scriptStates[key].action.remainingMs;
  await f.tick();
  assert.equal(f.active().runId, original); assert.ok(f.active().scriptStates[key].action.remainingMs < remaining);
  for (let index = 0; f.active()?.runId === original && index < 10; index++) await f.tick();
  assert.ok(f.active()); assert.notEqual(f.active().runId, original); assert.equal(f.active().config.id, "wait");
  assert.deepEqual(coreCalls, []);
  for (let index = 0; f.active() && index < 10; index++) await f.tick();
  assert.equal(f.active(), null); assert.deepEqual(coreCalls, ["wait"]); assert.deepEqual(f.errors, []);
});

test("explicit stop policy allows an immediate replacement of a command's preceding script", async () => {
  const come = configured("come"); come.beforeScript = block([step(1, "wait", { seconds: 10 })]);
  come.beforeScript.interruptions.command = "stop";
  const coreCalls = [];
  const f = await commandFixture({ commands: [come, "wait"], core: { async tick(_scene, run) { coreCalls.push(run.config.id); return { done: true }; } } });
  await f.accept("come"); await f.tick(); const original = f.active().runId;
  await f.accept("wait");
  assert.notEqual(f.active().runId, original); assert.equal(f.active().config.id, "wait");
  for (let index = 0; f.active() && index < 10; index++) await f.tick();
  assert.deepEqual(coreCalls, ["wait"]); assert.deepEqual(f.errors, []);
});

test("behavior-off discards a pending replacement and overrides the current script's Ignore policy", async () => {
  const come = configured("come"); come.beforeScript = block([step(1, "wait", { seconds: 10 })]);
  const coreCalls = [];
  const f = await commandFixture({ commands: [come, "wait", "behavior-off"], core: { async tick(_scene, run) { coreCalls.push(run.config.id); return { done: true }; } } });
  await f.accept("come"); await f.tick(); const original = f.active().runId;
  await f.accept("wait"); assert.equal(f.active().runId, original);
  await within(f.accept("behavior-off", {}, f.gm));
  assert.notEqual(f.active()?.runId, original);
  for (let index = 0; f.active() && index < 10; index++) await f.tick();
  assert.equal(f.active(), null); assert.deepEqual(coreCalls, ["behavior-off"]);
  assert.ok(f.current().disabledObjects.includes("Token:npc")); assert.deepEqual(f.errors, []);
});

test("a pending replacement wins over the old core when an external policy skips its ignored block", async () => {
  const come = configured("come"); come.beforeScript = block([step(1, "wait", { seconds: 10 })]);
  come.interruptions.interaction = "next-step";
  const coreCalls = [];
  const f = await commandFixture({ commands: [come, "wait"], core: { async tick(_scene, run) { coreCalls.push(run.config.id); return { done: true }; } } });
  await f.accept("come"); await f.tick();
  await f.accept("wait");
  const parent = f.current(); freezeInteractionClock(parent, target); await saveRuntime(f.scene, parent);
  await f.tick(); assert.equal(f.active().interruption?.source, "interaction");
  for (let index = 0; f.active() && index < 15; index++) await f.tick();
  assert.equal(f.active(), null); assert.deepEqual(coreCalls, ["wait"]); assert.deepEqual(f.errors, []);
});

test("a pending replacement still waits when an external policy restarts the same ignored block", async () => {
  const come = configured("come"); come.beforeScript = block([step(1, "wait", { seconds: 0.3 })]);
  come.interruptions.interaction = "restart-step";
  const coreCalls = [];
  const f = await commandFixture({ commands: [come, "wait"], core: { async tick(_scene, run) { coreCalls.push(run.config.id); return { done: true }; } } });
  await f.accept("come"); await f.tick(); await f.accept("wait");
  const parent = f.current(); freezeInteractionClock(parent, target); await saveRuntime(f.scene, parent);
  await f.tick(); await f.tick();
  assert.equal(f.active().config.id, "come"); assert.equal(f.active().phase, "before");
  await f.tick(); assert.equal(f.active().config.id, "come"); assert.deepEqual(coreCalls, []);
  for (let index = 0; f.active() && index < 15; index++) await f.tick();
  assert.equal(f.active(), null); assert.deepEqual(coreCalls, ["wait"]); assert.deepEqual(f.errors, []);
});

test("an ignored pending macro may finish before Cancel activates, with its own completion accepted once", async () => {
  const come = configured("come"); come.beforeScript = block([step(1, "macro", { macroUuid: "Macro.pending", before: 0, after: 0 }, [2]),
    step(2, "emotion", { emoji: "!", size: 32, duration: 0, executionMode: "parallel" })]);
  const coreCalls = [], f = await commandFixture({ commands: [come, "cancel"], core: { async tick(_scene, run) { coreCalls.push(run.config.id); return { done: true }; } } });
  let entered, release, calls = 0;
  const started = new Promise(resolve => { entered = resolve; }), pending = new Promise(resolve => { release = resolve; });
  f.runtime.isObjectMacroAttached = () => true; f.runtime.effects.macro = async () => { calls++; entered(); await pending; };
  await f.accept("come"); const original = f.active().runId;
  const ticking = f.tick(); await started;
  try {
    await within(f.accept("cancel")); assert.equal(f.active().runId, original);
    await f.tick(); assert.equal(f.active().runId, original); assert.deepEqual(coreCalls, []);
    release(); await within(ticking);
    for (let index = 0; f.active() && index < 15; index++) await f.tick();
    assert.equal(f.active(), null); assert.deepEqual(coreCalls, ["cancel"]); assert.equal(calls, 1); assert.deepEqual(f.errors, []);
  } finally { release(); }
});
