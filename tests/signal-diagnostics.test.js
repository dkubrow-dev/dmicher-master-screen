import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { clearDiagnostics, getDiagnosticEntries } from "../dmicher-master-screen/scripts/diagnostics.js";
import { requestHalt } from "../dmicher-master-screen/scripts/execution.js";

function setup() {
  const f = fixture();
  globalThis.game.settings = { get: () => false };
  clearDiagnostics();
  return f;
}
const records = () => getDiagnosticEntries().filter(entry => entry.category === "signal");
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test("signals record named pending and completed subscribers with Debug off, without replaying receipts", async () => {
  const f = setup(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Greeting" });
  let begin, release;
  const entered = new Promise(resolve => { begin = resolve; }), delay = new Promise(resolve => { release = resolve; });
  const firstSubscriber = await f.subscribe(signal, "Token:other", async () => { begin(); await delay; });
  const secondSubscriber = await f.subscribe(signal, "Token:npc");
  const input = { id: "delivery-1", emitterKey: signal.emitterKey, name: signal.name };
  const first = f.bus.emit(f.scene, input), duplicate = f.bus.emit(f.scene, input);
  assert.equal(first, duplicate);
  await entered;
  assert.deepEqual(records().map(entry => entry.event), ["emitted", "subscriber.accepted"]);
  const accepted = records()[1];
  assert.equal(accepted.level, "signal");
  assert.deepEqual(accepted.context, {
    sceneId: "scene", sceneName: "Scene", deliveryId: "delivery-1",
    emitterKey: "Token:npc", emitterName: "NPC", emitterType: "Token", signalId: signal.id, signalName: "Greeting",
    subscriberKey: "Token:other", subscriberName: "Other", subscriptionId: firstSubscriber.entry.id, macroUuid: firstSubscriber.entry.macroUuid
  });
  release();
  assert.equal((await first).status, "done");
  assert.deepEqual(records().map(entry => entry.event), ["emitted", "subscriber.accepted", "subscriber.completed", "subscriber.accepted", "subscriber.completed", "completed"]);
  assert.equal(records()[3].context.subscriptionId, secondSubscriber.entry.id);
  assert.deepEqual(records()[2].context.returns, {});
  assert.equal(records().at(-1).context.status, "done");
  await f.bus.emit(f.scene, input);
  assert.equal(records().length, 6);
  assert.equal(f.bus.history(f.scene).length, 1);
});

test("signal validation failures before delivery retain source identity and original errors", async () => {
  const f = setup(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Number", parameters: [{ name: "value", type: "integer" }] });
  assert.throws(() => f.bus.emit(f.scene, { id: "invalid", emitterKey: signal.emitterKey, signalId: signal.id, parameters: { value: "wrong" } }));
  let rejected = records().at(-1);
  assert.equal(rejected.event, "rejected"); assert.equal(rejected.level, "error");
  assert.equal(rejected.context.emitterName, "NPC"); assert.equal(rejected.context.signalName, "Number");
  assert.ok(rejected.error.message); assert.equal(f.bus.history(f.scene).length, 0);
  assert.throws(() => f.bus.emit(f.scene, { emitterKey: "Token:missing", name: "Missing" }));
  rejected = records().at(-1);
  assert.equal(rejected.context.emitterKey, "Token:missing"); assert.equal(rejected.context.signalName, "Missing");
  assert.throws(() => f.bus.emit(f.scene, { emitterKey: signal.emitterKey, signalId: signal.id, parameters: { value: 1 }, context: { depth: 32 } }));
  assert.equal(records().at(-1).level, "error");
  const input = { id: "receipt", emitterKey: signal.emitterKey, signalId: signal.id, parameters: { value: 1 } };
  await f.bus.emit(f.scene, input);
  assert.throws(() => f.bus.emit(f.scene, { ...input, parameters: { value: 2 } }));
  assert.equal(records().at(-1).event, "rejected");
  assert.equal(records().filter(entry => entry.event === "emitted").length, 1);
});

test("a failed subscriber is diagnosed as an error while remaining subscribers still finish", async () => {
  const f = setup(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Failure" });
  const failed = await f.subscribe(signal, "Token:other", () => { throw new Error("Handler failed"); });
  await f.subscribe(signal, "Token:npc");
  const original = console.error; console.error = () => {};
  try {
    const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, signalId: signal.id });
    assert.equal(result.status, "failed");
    const entry = records().find(entry => entry.event === "subscriber.failed");
    assert.equal(entry.level, "error"); assert.equal(entry.error.message, "Handler failed");
    assert.equal(entry.context.subscriptionId, failed.entry.id); assert.equal(entry.context.subscriberName, "Other");
    assert.equal(records().filter(entry => entry.event === "subscriber.completed").length, 1);
    assert.equal(records().at(-1).context.status, "failed");
  } finally { console.error = original; }
});

test("subscriber denial is a completed response with explicit allowed false", async () => {
  const f = setup(), signal = f.catalog.list().signals.find(entry => entry.emitterKey === "Group:main" && entry.name === "validateStart");
  await f.subscribe(signal, "Token:other", function () { this.returns.allowed.value = false; this.returns.message.value = "Wait"; });
  const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, signalId: signal.id,
    parameters: { sceneUuid: "s", groupUuid: "g", groupName: "Group", stateUuid: "st", stateName: "State" } });
  assert.equal(result.allowed, false);
  const completed = records().find(entry => entry.event === "subscriber.completed");
  assert.equal(completed.level, "signal"); assert.equal(completed.context.allowed, false);
  assert.equal(completed.context.returns.message, "Wait");
  assert.equal(records().at(-1).context.allowed, false);
});

test("halt records stale pending subscribers and cannot report their late completion", async () => {
  const f = setup(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Wait" });
  f.data.objectBindings.bindings["Token:other"] = { groupId: "main" };
  let begin, release;
  const entered = new Promise(resolve => { begin = resolve; }), delay = new Promise(resolve => { release = resolve; });
  await f.subscribe(signal, "Token:other", async () => { begin(); await delay; });
  const pending = f.bus.emit(f.scene, { emitterKey: signal.emitterKey, signalId: signal.id });
  await entered; requestHalt(f.scene, "main");
  assert.equal((await pending).status, "stale");
  assert.deepEqual(records().map(entry => entry.event), ["emitted", "subscriber.accepted", "subscriber.stale", "completed"]);
  assert.equal(records().at(-1).context.status, "stale");
  release(); await nextTurn();
  assert.equal(records().length, 4);
});

test("skipped subscribers show the reason without claiming acceptance or execution", async () => {
  const f = setup(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Skipped" });
  await f.subscribe(signal, "Token:other", () => { throw new Error("Must not run"); });
  f.data.objectBindings.bindings["Token:other"] = { playerCharacter: true };
  await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, signalId: signal.id });
  assert.deepEqual(records().map(entry => entry.event), ["emitted", "subscriber.skipped", "completed"]);
  assert.equal(records()[1].context.reason, "player-character");
  assert.equal(records()[1].context.subscriberName, "Other");
});
