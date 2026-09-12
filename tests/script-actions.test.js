import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { ObjectScriptRuntime, scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";
import { planScriptMovement, advanceScriptMovement, scriptObjectCapabilities } from "../dmicher-master-screen/scripts/script-movement.js";
import { speechRecipients, createFoundryEffects, tokenCenter } from "../dmicher-master-screen/scripts/effects.js";
import { createCombatAdapter } from "../dmicher-master-screen/scripts/combat-adapter.js";
import { notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";
const clone = structuredClone;
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
function merge(a, b) { if (!b || typeof b !== "object" || Array.isArray(b)) return clone(b); const out = a && typeof a === "object" ? clone(a) : {}; for (const [key, value] of Object.entries(b)) out[key] = merge(out[key], value); return out; }
function fixture(raw, options = {}) {
  const script = normalizeScript({ stateId: "calm", ...raw }), scene = { id: "scene", grid: { size: 100, distance: 5 } };
  const object = { id: "npc", documentName: "Token", name: "NPC", parent: scene, x: 0, y: 0, width: 1, height: 1, rotation: 0, hidden: false,
    object: { checkCollision: () => false }, async update(changes) { Object.assign(this, changes); } };
  let state = { runId: "run", groupId: "group", state: { id: "calm" }, scriptStates: {} }, owned = true;
  const calls = [], combat = options.combat ?? { context: () => null };
  const runtime = { combat, scriptState: () => clone(state), saveScriptState: async (_scene, value) => { state = merge(state, value); }, currentObject: () => owned, refreshObject: () => {}, onChange: () => {},
    effects: { speak: async (...args) => { calls.push(["speech", ...args]); return [{ id: "message" }]; }, removeSpeech: async (ids) => calls.push(["remove", ids]), sound: async (...args) => calls.push(["sound", ...args]), macro: async (...args) => calls.push(["macro", ...args]) },
    emitObjectSignal: async (...args) => calls.push(["signal", ...args]), isObjectMacroAttached: () => true };
  const executor = new ObjectScriptRuntime(runtime), key = scriptProgressKey({ type: "Token", id: object.id }, script);
  return { scene, object, script, runtime, executor, calls, state: () => state, progress: () => state.scriptStates[key], stop: () => { owned = false; },
    async tick(seconds = 0.5) { const job = await executor.tick(scene, clone(state), object, script, seconds); if (job) await executor.execute(job); return job; } };
}
test("each wait owns its full duration despite recursive flag merges and stable row IDs", async () => {
  const f = fixture({ steps: [step(18, "wait", { seconds: 10 }), step(1, "wait", { seconds: 1 }, [16]), step(16, "wait", { seconds: 7 }, [18])] });
  await f.tick(1); assert.equal(f.progress().stepId, 16); assert.equal(f.progress().action.remainingMs, 7000);
  for (let i = 0; i < 13; i++) await f.tick(); assert.equal(f.progress().stepId, 16);
  await f.tick(); assert.equal(f.progress().stepId, 18); assert.equal(f.progress().action.remainingMs, 10000);
  for (let i = 0; i < 19; i++) await f.tick(); assert.equal(f.progress().stepId, 18);
  await f.tick(); assert.equal(f.progress().status, "done");
});
test("script slots maintain independent progress and disabled scripts have no side effects", async () => {
  const f = fixture({ steps: [step(1, "wait", { seconds: 2 })] });
  await f.tick(); await f.executor.tick(f.scene, f.state(), f.object, f.script, 1, { slot: "transition" });
  assert.equal(Object.keys(f.state().scriptStates).length, 2); assert.equal(f.progress().action.remainingMs, 1500);
  const disabled = fixture({ enabled: false, steps: [step(1, "visibility", { visible: false })] }); await disabled.tick(); assert.equal(disabled.object.hidden, false);
});
test("movement combines position, rotation and resize with a shared duration and rebases manual changes", async () => {
  const f = fixture({ steps: [step(1, "move", { timeMode: "duration", duration: 10, position: { x: 100, y: 0 }, rotation: { mode: "absolute", angle: 90 }, size: { x: 2, y: 3 } })] });
  await f.tick(4); assert.equal(f.object.x, 40); assert.equal(f.object.rotation, 36); assert.equal(f.object.width, 1.4);
  f.object.x = 10; f.object.rotation = 0; await f.tick(3); assert.equal(f.object.x, 55); assert.equal(f.object.rotation, 45);
  await f.tick(3); assert.equal(f.object.x, 100); assert.equal(f.object.rotation, 90); assert.equal(f.object.height, 3);
});
test("native Token depth is optional; Tile sizes convert grid spaces to pixels", async () => {
  const scene = { grid: { size: 100, distance: 5 } }, token = { documentName: "Token", x: 0, y: 0, width: 1, height: 1, rotation: 0 };
  assert.equal(scriptObjectCapabilities(token).sizeZ, false);
  assert.throws(() => planScriptMovement(scene, token, { timeMode: "duration", duration: 0, size: { z: 2, speed: 1 } }));
  token.depth = 1; assert.equal(scriptObjectCapabilities(token).sizeZ, true);
  const tile = { ...token, documentName: "Tile", width: 100, height: 100, async update(v) { Object.assign(this, v); } };
  const movement = planScriptMovement(scene, tile, { timeMode: "duration", duration: 0, size: { x: 2, y: 3, z: null, speed: 1 } });
  await advanceScriptMovement(scene, tile, movement, 0); assert.equal(tile.width, 200); assert.equal(tile.height, 300);
  assert.deepEqual(tokenCenter(tile, scene), { x: 100, y: 150 });
});
test("relative rotation preserves multiple revolutions across wrapped native angles", async () => {
  const f = fixture({ steps: [step(1, "move", { duration: 4, rotation: { mode: "relative", angle: 720 } })] });
  await f.tick(1); assert.equal(f.object.rotation, 180); await f.tick(1); assert.equal(f.object.rotation, 0);
  await f.tick(1); assert.equal(f.object.rotation, 180); await f.tick(1); assert.equal(f.object.rotation, 0); assert.equal(f.progress().status, "done");
});
test("signals and attached plain macros respect before/after delays", async () => {
  const f = fixture({ steps: [step(1, "signal", { signalId: "own", parameters: { count: 1 }, before: 1, after: 2 }, [2]), step(2, "macro", { macroUuid: "Macro.x", before: 0, after: 0 })] });
  await f.tick(); assert.equal(f.calls.length, 0); await f.tick(); assert.equal(f.calls[0][0], "signal");
  for (let i = 0; i < 3; i++) await f.tick(); assert.equal(f.progress().stepId, 1);
  await f.tick(); assert.equal(f.progress().stepId, 2); await f.tick(); assert.equal(f.calls.at(-1)[0], "macro"); assert.equal(f.calls.at(-1)[2].parameters, undefined);
  const bad = fixture({ steps: [step(1, "macro", { macroUuid: "Macro.foreign" })] }); bad.runtime.isObjectMacroAttached = () => false; await bad.tick(); assert.equal(bad.progress().status, "failed"); assert.equal(bad.calls.length, 0);
});
test("speech has explicit lifetime, bubble and owned message cleanup", async () => {
  const f = fixture({ steps: [step(1, "speech", { duration: 1, chat: { text: "<b>Hello</b>" }, bubble: { text: "Hello", fontSize: 30 } })] });
  await f.tick(); assert.equal(f.progress().bubble.text, "Hello"); assert.equal(f.progress().bubble.fontSize, 30); assert.deepEqual(f.progress().messageIds, ["message"]);
  await f.tick(); assert.equal(f.progress().status, "ready"); await f.tick(); assert.equal(f.progress().status, "done"); assert.equal(f.progress().bubble, null); assert.ok(f.calls.some((c) => c[0] === "remove"));
});
test("combat consumes one configured budget, confirms new turns, skips and resumes to fixed target", async () => {
  let turn = 1, decision = "continue", finished = 0, confirmations = 0;
  const combat = { context: () => ({ id: "fight", turnKey: `fight:${turn}`, isTurn: true }), notify: async () => {}, confirmAction: async () => { confirmations++; return decision; }, finishTurn: async () => { finished++; } };
  const f = fixture({ combat: { enabled: true, turnSeconds: 6, endTurn: true }, steps: [step(1, "move", { duration: 10, position: { x: 100, y: 0 } })] }, { combat });
  await f.tick(); assert.equal(confirmations, 1); await f.tick(); assert.equal(f.object.x, 60); await f.tick(); assert.equal(finished, 1);
  turn++; decision = "skip"; await f.tick(); await f.tick(); assert.equal(f.object.x, 60);
  turn++; decision = "continue"; f.object.x = 20; await f.tick(); await f.tick(); assert.equal(f.object.x, 100); assert.equal(f.progress().status, "done");
});
test("combat stop applies to that encounter and external actions do not run off-turn", async () => {
  let isTurn = false, combatId = "fight";
  const combat = { context: () => ({ id: combatId, turnKey: combatId, isTurn }), notify: async () => {}, confirmAction: async () => "stop" };
  const f = fixture({ combat: { enabled: true }, steps: [step(1, "sound", { src: "sound.ogg" })] }, { combat });
  await f.tick(); assert.equal(f.calls.length, 0); isTurn = true; await f.tick(); await f.tick(); assert.equal(f.calls.length, 0); assert.equal(f.progress().combat.stoppedId, "fight");
});
test("combat speech estimate includes its duration and the remaining budget of the current turn", async () => {
  const notices = [];
  const combat = { context: () => ({ id: "fight", turnKey: "fight:1", isTurn: true }), notify: async (_object, _script, step, rounds) => notices.push({ id: step.id, rounds }), confirmAction: async () => "continue" };
  const f = fixture({ combat: { enabled: true, turnSeconds: 6 }, steps: [step(1, "wait", { seconds: 5 }, [2]), step(2, "speech", { duration: 20 })] }, { combat });
  await f.tick(); await f.tick();
  assert.deepEqual(notices, [{ id: 1, rounds: 1 }, { id: 2, rounds: 5 }]);
  await f.tick(); assert.equal(f.calls[0][0], "speech"); await f.tick();
  assert.equal(f.progress().combat.remaining, 0); assert.equal(f.progress().action.remainingMs, 19000);
});
test("a claimed external action waits when its turn changes before execution", async () => {
  let isTurn = true, turn = 1;
  const combat = { context: () => ({ id: "fight", turnKey: `fight:${turn}`, isTurn }), notify: async () => {}, confirmAction: async () => "continue" };
  const f = fixture({ combat: { enabled: true }, steps: [step(1, "sound", { src: "sound.ogg" })] }, { combat });
  await f.tick();
  const job = await f.executor.tick(f.scene, f.state(), f.object, f.script, 0.5); assert.equal(job.stage, "effect");
  isTurn = false; await f.executor.execute(job); assert.equal(f.calls.length, 0); assert.equal(f.progress().status, "ready");
  isTurn = true; turn++; await f.tick(); await f.tick(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], "sound");
});
test("chat audience is deduplicated by player, checks tags and zero range is unlimited", () => {
  const player = { id: "p", role: 1 }; globalThis.game = { users: [player] };
  const npc = { id: "npc", x: 0, y: 0, width: 1, height: 1 }, observer = { id: "pc", x: 9000, y: 0, width: 1, height: 1, actor: { testUserPermission: () => true }, object: { checkCollision: () => false } };
  const scene = { grid: { size: 100, distance: 5 }, tokens: [npc, observer], getFlag: () => ({ bindings: { "Token:pc": { tags: ["hero"] } } }) };
  assert.deepEqual(speechRecipients(scene, npc, { range: 0, allowTags: ["hero"] }), ["p"]); assert.deepEqual(speechRecipients(scene, npc, { range: 30 }), []); assert.deepEqual(speechRecipients(scene, npc, { denyTags: ["hero"] }), []);
});
test("sound uses each client's environment audio channel", async () => {
  let call; globalThis.foundry = { audio: { AudioHelper: { play: (...args) => { call = args; } } } };
  await createFoundryEffects().sound("ambient.ogg", 0.5); assert.deepEqual(call, [{ src: "ambient.ogg", volume: 0.5, channel: "environment", loop: false }, true]);
});
test("unknown external outcome cannot be replayed by a replacement executor", async () => {
  const f = fixture({ steps: [step(1, "sound", { src: "alarm.ogg" })] });
  const pending = await f.executor.tick(f.scene, f.state(), f.object, f.script, 0.5); assert.ok(pending);
  const replacement = new ObjectScriptRuntime(f.runtime); await replacement.tick(f.scene, f.state(), f.object, f.script, 0.5);
  assert.equal(f.progress().status, "uncertain"); assert.equal(f.calls.length, 0); f.executor.dispose();
});
test("emergency stop releases a never-settling external action and ignores its late completion", async () => {
  const f = fixture({ steps: [step(1, "macro", { macroUuid: "Macro.wait" }, [2]), step(2, "visibility", { visible: false })] });
  let started, finish; const ready = new Promise((resolve) => { started = resolve; });
  f.runtime.effects.macro = async () => { started(); return new Promise((resolve) => { finish = resolve; }); };
  const ticking = f.tick(); await ready; f.stop(); notifyExecutionChange(f.scene, "halt"); await ticking;
  finish(); await new Promise((resolve) => setImmediate(resolve)); assert.equal(f.object.hidden, false); assert.equal(f.progress().stepId, 1); assert.equal(f.executor.jobs.size, 0);
});
test("a GM macro failure is reported without breaking the following script actions", async () => {
  const f = fixture({ steps: [step(1, "macro", { macroUuid: "Macro.fail" }, [2]), step(2, "visibility", { visible: false })] });
  const notices = [], original = console.error; console.error = (...args) => notices.push(args);
  try { f.runtime.effects.macro = async () => { throw new Error("test failure"); }; await f.tick(); await f.tick(); await f.tick(); assert.equal(f.object.hidden, true); assert.equal(notices.length, 1); }
  finally { console.error = original; }
});
test("native combat adapter emits start, round, turn and end once on authoritative updates", async () => {
  const listeners = new Map(), emitted = [], gm = { id: "gm", role: 4, isGM: true, active: true };
  globalThis.Hooks = { on: (name, fn) => { listeners.set(name, fn); return name; }, off: (name) => listeners.delete(name) };
  const combat = { id: "combat", uuid: "Combat.combat", scene: { id: "scene", uuid: "Scene.scene" }, started: false, round: 0, turn: null, combatant: null };
  globalThis.game = { user: gm, users: [gm], combats: [combat] };
  const adapter = createCombatAdapter({ emitSignal: async (_scene, name, args) => emitted.push({ name, args }) }); adapter.activate();
  Object.assign(combat, { started: true, round: 1, turn: 0, combatant: { actor: { uuid: "Actor.a" }, tokenId: "a" } }); listeners.get("updateCombat")(combat); await new Promise((resolve) => setImmediate(resolve));
  Object.assign(combat, { turn: 1, combatant: { actor: { uuid: "Actor.b" }, tokenId: "b" } }); listeners.get("updateCombat")(combat); await new Promise((resolve) => setImmediate(resolve));
  listeners.get("deleteCombat")(combat); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(emitted.map((e) => e.name), ["combatStarted", "roundStarted", "turnChanged", "combatEnded"]); assert.equal(emitted[2].args.previousActorUuid, "Actor.a"); adapter.dispose(); assert.equal(listeners.size, 0);
});
