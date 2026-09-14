import test from "node:test";
import assert from "node:assert/strict";
import { ScriptFocusService, focusRecipients } from "../dmicher-master-screen/scripts/script-focus.js";
import { normalizeScriptStep, scriptStepTemplate } from "../dmicher-master-screen/scripts/script-model.js";
import { renderScriptParameters } from "../dmicher-master-screen/scripts/apps/script-parameters.js";
import { analyzeScriptWarnings } from "../dmicher-master-screen/scripts/script-warnings.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { scriptPresentationScope, notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";
import { sceneFixture, descriptor } from "./fixtures/scene.js";

const ID = "dmicher-master-screen";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(setImmediate);
function users() {
  return new Map([
    ["gm", { id: "gm", role: 4, active: true, isGM: true }],
    ["assistant", { id: "assistant", role: 3, active: true }],
    ["player", { id: "player", role: 1, active: true }],
    ["trusted", { id: "trusted", role: 2, active: true }],
    ["offline", { id: "offline", role: 1, active: false }],
    ["none", { id: "none", role: 0, active: true }],
    ["bot", { id: "bot", role: 1, active: true, flags: { "dmicher-generics": { managedIdentity: { version: 1, ownerId: ID, key: "informer" } } } }]
  ]);
}
async function fixture() {
  const world = sceneFixture(), group = await world.editor.createGroup();
  await world.objects.save(descriptor, { groupId: group.groupId });
  const object = world.scene.tokens.get("npc"); Object.assign(object, { x: 200, y: 300, width: 2, height: 1 });
  const scriptKey = "Token:npc:routine:focus", run = getRuntime(world.scene, { groupId: group.groupId });
  run.runId = "run"; run.stateId = group.entryStateId; run.halted = false;
  run.scriptStates[scriptKey] = { stepId: 1, sequence: 1, generation: 2, status: "pending" };
  await saveRuntime(world.scene, run);
  game.users = users(); game.user = game.users.get("gm");
  const pans = [], hooks = new Map(), messages = new Map(); let serial = 0;
  globalThis.canvas.pan = point => pans.push(point);
  globalThis.Hooks = { on(name, listener) { if (!hooks.has(name)) hooks.set(name, new Set()); hooks.get(name).add(listener); return listener; }, off(name, listener) { hooks.get(name)?.delete(listener); } };
  const fire = (name, ...args) => { for (const listener of hooks.get(name) ?? []) listener(...args); };
  const chat = { createMessageService: () => ({ async create(data, options) {
    if (!options.enabled()) return [];
    const message = { ...data, id: `message-${++serial}`, whisper: options.audience.userIds,
      flags: { ...data.flags, "dmicher-generics": { chat: { apiVersion: 1, ownerId: ID, channel: "script-focus", technical: true } } } };
    messages.set(message.id, message); fire("createChatMessage", message); return [message];
  }, async remove(id) { messages.delete(id); } }) };
  const service = new ScriptFocusService(chat); service.start();
  const options = { runId: run.runId, groupId: group.groupId, scriptKey, scriptGeneration: 2, isCurrent: () => true };
  const data = { ...scriptPresentationScope(world.scene, { ...options, target: descriptor }), audience: "all", deliveryId: "delivery" };
  const message = (changes = {}) => ({ id: "remote", author: "gm", flags: { [ID]: { scriptFocus: { ...data, ...changes } },
    "dmicher-generics": { chat: { apiVersion: 1, ownerId: ID, channel: "script-focus", technical: true } } } });
  return { ...world, object, run, service, options, pans, messages, message, fire };
}

test("focus defaults to everyone, rejects unknown parameters and is an instantaneous graph action", () => {
  const step = { id: 1, ...scriptStepTemplate("focus") };
  assert.deepEqual(normalizeScriptStep(step).parameters, { audience: "all" });
  for (const audience of ["all", "players", "gm"]) assert.equal(normalizeScriptStep({ ...step, parameters: { audience } }).parameters.audience, audience);
  for (const parameters of [{ audience: "assistant" }, { audience: false }, { audience: "all", x: 20 }]) assert.throws(() => normalizeScriptStep({ ...step, parameters }));
  assert.deepEqual(analyzeScriptWarnings({ steps: [{ ...step, next: [1] }] }), { durationUnset: true, cycle: [1, 1], zeroDelayCycle: [1, 1] });
  for (const [language, labels] of [["ru", ["Привлечь внимание", "Всех", "Только игроков", "Только мастера"]], ["en", ["Draw attention", "Everyone", "Players only", "GM only"]]]) {
    globalThis.game = { i18n: { lang: language } };
    const html = renderScriptParameters(step, {});
    for (const label of labels) assert.ok(html.includes(label));
    assert.match(html, /value="all" selected/);
  }
});

test("camera audiences separate players from GM and assistants, excluding disconnected and technical users", () => {
  assert.deepEqual(focusRecipients(users(), "all"), ["gm", "assistant", "player", "trusted"]);
  assert.deepEqual(focusRecipients(users(), "gm"), ["gm", "assistant"]);
  assert.deepEqual(focusRecipients(users(), "players"), ["player", "trusted"]);
  assert.deepEqual(focusRecipients(users(), "unknown"), []);
});

test("focus uses one authenticated hidden delivery, centers native geometry and removes chat history", async () => {
  const f = await fixture();
  await f.service.focus(f.scene, f.object, "all", f.options);
  assert.deepEqual(f.pans, [{ x: 300, y: 350 }]); assert.equal(f.messages.size, 0);
  assert.equal(f.service.pending.size, 0); f.service.dispose();
});

test("remote focus includes an assistant but excludes GM when only players are selected", async () => {
  const f = await fixture();
  assert.equal(f.service.receive(f.message({ audience: "players" })), false);
  game.user = game.users.get("assistant");
  assert.equal(f.service.receive(f.message({ audience: "gm" })), true);
  assert.equal(f.service.receive({ ...f.message(), id: "duplicate-document" }), false);
  assert.equal(f.pans.length, 1); f.service.dispose();
});

test("focus rejects player-authored delivery, a replaced run, interrupted generation, and another scene", async () => {
  for (const change of ["author", "run", "generation", "halt", "scene"]) {
    const f = await fixture(), message = f.message();
    if (change === "author") message.author = "player";
    if (change === "run") f.run.runId = "replacement";
    if (change === "generation") f.run.scriptStates[f.options.scriptKey].generation++;
    if (change === "halt") f.run.halted = true;
    await saveRuntime(f.scene, f.run);
    if (change === "scene") canvas.scene = f.create("elsewhere");
    assert.equal(f.service.receive(message), false); assert.equal(f.pans.length, 0); f.service.dispose();
  }
});

test("stop releases queued focus immediately and even a late created message cannot pan", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  f.service.messages.create = async (data, options) => {
    entered.resolve(); await release.promise;
    // Simulate an already submitted Foundry write, which cannot be physically cancelled.
    const message = f.message(data.flags[ID].scriptFocus); message.id = "late";
    f.messages.set(message.id, message); f.fire("createChatMessage", message); return [message];
  };
  const operation = f.service.focus(f.scene, f.object, "all", f.options);
  await entered.promise; f.service.stop(f.scene);
  await operation;
  release.resolve(); await flush();
  assert.equal(f.pans.length, 0); assert.equal(f.messages.size, 0); f.service.dispose();
});

test("a focus waiting in the chat queue loses its execution lease on scene teardown", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const create = f.service.messages.create;
  f.service.messages.create = async (...args) => { entered.resolve(); await release.promise; return create(...args); };
  const operation = f.service.focus(f.scene, f.object, "all", f.options);
  await entered.promise; notifyExecutionChange(f.scene, "canvas-teardown"); await operation;
  release.resolve(); await flush(); assert.equal(f.pans.length, 0); assert.equal(f.messages.size, 0); f.service.dispose();
});

test("malformed delivery and failing camera adapters cannot throw out of a chat hook", async () => {
  for (const failure of ["scope", "camera", "malformed", "loading-canvas"]) {
    const f = await fixture();
    if (failure === "scope") f.service.owns = () => { throw new Error("Scope read failed"); };
    if (failure === "camera") canvas.pan = () => { throw new Error("Canvas changed"); };
    if (failure === "loading-canvas") canvas.ready = false;
    const message = f.message(failure === "malformed" ? { manual: true, groupId: { id: "unexpected" } } : {});
    assert.doesNotThrow(() => assert.equal(f.service.receive(message), false));
    assert.equal(f.pans.length, 0); f.service.dispose();
  }
});
