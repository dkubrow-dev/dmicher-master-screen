import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { requestHalt, requestSceneHalt, finishSceneHalt, notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";

test("delivery binds signal names to their emitter and rejects undeclared input fields", async () => {
  const f = fixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Hello! 👋", parameters: [{ name: "сообщение?!", type: "string" }] });
  await f.subscribe(signal, "Token:other", function () { assert.equal(this.parameters["сообщение?!"].value, "world"); });
  assert.throws(() => f.bus.emit(f.scene, { emitterKey: "Token:other", name: signal.name, parameters: { "сообщение?!": "world" } }));
  assert.throws(() => f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name, parameters: { "сообщение?!": 4 } }));
  const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name, parameters: { "сообщение?!": "world" } });
  assert.equal(result.status, "done"); assert.equal(result.results.length, 1);
});
test("validation waits for subscribers and any denial blocks the action with object name", async () => {
  const f = fixture(), signal = f.catalog.list().signals.find((s) => s.emitterKey === "Shop:shop" && s.name === "beforePurchase");
  let release; const delay = new Promise((resolve) => { release = resolve; });
  await f.subscribe(signal, "Token:other", async function () { await delay; this.returns.allowed.value = false; this.returns.message.value = "Insufficient stock"; });
  let done = false;
  const pending = f.bus.emit(f.scene, { emitterKey: signal.emitterKey, signalId: signal.id, parameters: { sceneUuid: "s", objectUuid: "o", shopUuid: "shop", userUuid: "u", actorUuid: "a" } }).then((value) => { done = true; return value; });
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(done, false);
  release(); const result = await pending;
  assert.equal(result.allowed, false); assert.deepEqual(result.messages[0], { ownerKey: "Token:other", name: "Other", message: "Insufficient stock" });
});
test("dialogue returns aggregate exit and interrupt while retaining both results", async () => {
  const f = fixture(), signal = f.catalog.list().signals.find((s) => s.emitterKey === "Dialogue:dialogue" && s.name === "response");
  await f.subscribe(signal, "Token:npc", function () { this.returns.exit.value = true; });
  await f.subscribe(signal, "Token:other", function () { this.returns.interrupt.value = true; });
  const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name, parameters: { sceneUuid: "s", objectUuid: "o", dialogueUuid: "d", userUuid: "u", actorUuid: "a", responseUuid: "r" } });
  assert.equal(result.exit, true); assert.equal(result.interrupt, true); assert.equal(result.results.length, 2);
});
test("bad subscriber does not stop the others, but fails validation safely", async () => {
  const f = fixture(), signal = f.catalog.list().signals.find((s) => s.emitterKey === "Group:main" && s.name === "validateStart");
  const bad = await f.subscribe(signal, "Token:npc", function () { this.returns.allowed.value = "true"; });
  let second = false; await f.subscribe(signal, "Token:other", function () { second = true; });
  const error = console.error; console.error = () => {};
  try {
    const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name, parameters: { sceneUuid: "s", groupUuid: "g", groupName: "G", stateUuid: "st", stateName: "S" } });
    assert.equal(result.status, "failed"); assert.equal(result.allowed, false); assert.equal(second, true); assert.equal(result.results[0].subscriptionId, bad.entry.id);
  } finally { console.error = error; }
});
test("nested awaited emission uses subscriber ownership and finishes without queue deadlock", async () => {
  const f = fixture(), first = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "first" }), second = await f.catalog.saveSignal({ emitterKey: "Token:other", name: "second" });
  let called = false;
  await f.subscribe(first, "Token:other", async function (context) { await context.emit("second"); });
  await f.subscribe(second, "Token:npc", () => { called = true; });
  const result = await f.bus.emit(f.scene, { emitterKey: first.emitterKey, name: first.name });
  await f.bus.whenIdle(); assert.equal(result.status, "done"); assert.equal(called, true);
});
test("idempotent in-flight delivery runs once and changed data cannot reuse the id", async () => {
  const f = fixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "once", parameters: [{ name: "value", type: "integer" }] });
  let count = 0; await f.subscribe(signal, "Token:other", () => count++);
  const input = { id: "same", emitterKey: signal.emitterKey, name: signal.name, parameters: { value: 1 } };
  const first = f.bus.emit(f.scene, input), second = f.bus.emit(f.scene, input);
  assert.equal(first, second); await first; assert.equal(count, 1);
  assert.throws(() => f.bus.emit(f.scene, { ...input, parameters: { value: 2 } }));
});
test("halt invalidates an awaited handler and its late continuation cannot emit", async () => {
  const f = fixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "wait" });
  f.data.objectBindings.bindings["Token:other"] = { groupId: "main" };
  let enter; const entered = new Promise((resolve) => { enter = resolve; }); let release; const delay = new Promise((resolve) => { release = resolve; });
  let late;
  await f.subscribe(signal, "Token:other", async function (context) { enter(); await delay; try { await context.emit("wait"); } catch (error) { late = error; } });
  const promise = f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name });
  await entered; requestHalt(f.scene, "main");
  assert.equal((await promise).status, "stale"); release(); await new Promise((resolve) => setImmediate(resolve)); assert.ok(late);
});
test("disposed signal bus rejects new signals", () => {
  const f = fixture(); f.bus.dispose(); assert.throws(() => f.bus.emit(f.scene, { emitterKey: "Scene:scene", name: "activated" }));
});
test("restart validation can run for a stopped group without restoring automation", async () => {
  const f = fixture(), signal = f.catalog.list().signals.find((entry) => entry.emitterKey === "Group:main" && entry.name === "validateStart");
  f.data.groupRuntimes.main.halted = true;
  await f.subscribe(signal, "Group:main", function () { this.returns.allowed.value = false; });
  const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name, parameters: { sceneUuid: "s", groupUuid: "g", groupName: "G", stateUuid: "st", stateName: "S" }, context: { validation: true, runId: "run", groupId: "main" } });
  assert.equal(result.allowed, false); assert.equal(result.results.length, 1); assert.equal(f.data.groupRuntimes.main.halted, true);
});
test("signal recursion is bounded and does not deadlock", async () => {
  const f = fixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "loop" });
  await f.subscribe(signal, "Token:npc", async function (context) { await context.emit("loop"); });
  const error = console.error; console.error = () => {};
  try {
    await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name });
    await f.bus.whenIdle();
    assert.equal(f.bus.history(f.scene).length, 32);
    assert.ok(f.bus.history(f.scene).some((entry) => entry.status === "failed"));
  } finally { console.error = error; }
});
test("validating another group cannot wake subscribers owned by a stopped group", async () => {
  const f = fixture(), signal = f.catalog.list().signals.find((entry) => entry.emitterKey === "Group:main" && entry.name === "validateStart");
  f.data.groupDefinitions.other = { ...structuredClone(f.definition), groupId: "other" };
  f.data.groupRuntimes.other = { ...structuredClone(f.data.groupRuntimes.main), groupId: "other", runId: "other-run", halted: true };
  f.data.objectBindings.bindings["Token:other"] = { groupId: "other" };
  let called = false;
  await f.subscribe(signal, "Token:other", function () { called = true; this.returns.allowed.value = false; });
  const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name, parameters: { sceneUuid: "s", groupUuid: "g", groupName: "G", stateUuid: "st", stateName: "S" }, context: { validation: true, runId: "run", groupId: "main" } });
  assert.equal(result.allowed, true); assert.equal(called, false);
});
test("global halt cancels ungrouped pending handlers and restart does not revive their context", async () => {
  const f = fixture(), signal = f.catalog.list().signals.find((entry) => entry.emitterKey === "Scene:scene" && entry.name === "activated");
  let begin, release, late;
  const ready = new Promise((resolve) => { begin = resolve; }), delay = new Promise((resolve) => { release = resolve; });
  await f.subscribe(signal, "Scene:scene", async function (context) { begin(); await delay; try { await context.emit("activated"); } catch (error) { late = error; } });
  const task = f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name });
  await ready; const generation = requestSceneHalt(f.scene); f.data.automationHalted = true; finishSceneHalt(f.scene, generation);
  assert.equal((await task).status, "stale");
  f.data.automationHalted = false; release(); await new Promise((resolve) => setImmediate(resolve)); assert.ok(late);
});

test("removing or reassigning a subscriber during its wait invalidates further actions", async () => {
  for (const change of [
    (f) => f.scene.tokens.delete("other"),
    (f) => { f.data.objectBindings.bindings["Token:other"] = { groupId: "main" }; }
  ]) {
    const f = fixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "wait" });
    let begin, release, late;
    const ready = new Promise((resolve) => { begin = resolve; }), delay = new Promise((resolve) => { release = resolve; });
    await f.subscribe(signal, "Token:other", async function (context) { begin(); await delay; try { await context.halt("main"); } catch (error) { late = error; } });
    const task = f.bus.emit(f.scene, { emitterKey: signal.emitterKey, name: signal.name });
    await ready; change(f); notifyExecutionChange(f.scene, "object-change");
    assert.equal((await task).status, "stale");
    release(); await new Promise((resolve) => setImmediate(resolve)); assert.ok(late); assert.equal(f.calls.length, 0);
  }
});
