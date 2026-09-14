import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { ObjectScriptRuntime, scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";
import { notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";

const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ finished = true } = {}) {
  globalThis.game = { paused: false };
  const target = { type: "Token", id: "npc" }, scene = { id: "background" };
  let animationStops = 0;
  const object = { ...target, documentName: "Token", parent: scene, object: { stopAnimation() { animationStops++; } } };
  const script = { ...normalizeScript({ stateId: "calm", interruptions: { combat: "restart-step", interaction: "restart-step" }, steps: [
    { id: 1, kind: "speech", parameters: { executionMode: "parallel", duration: 1,
      chat: { text: "After", timing: "after" }, bubble: { text: "Visible" } }, next: finished ? [] : [2] },
    ...(!finished ? [{ id: 2, kind: "wait", parameters: { seconds: 10 }, next: [] }] : [])
  ] }), target };
  const key = scriptProgressKey(target, script);
  let combat = null, interaction = false, state = { runId: "run", groupId: "group", scriptStates: {}, state: { id: "calm", scripts: [script], transitions: [] } };
  const pending = deferred(), calls = [];
  const runtime = {
    now: () => 1000, combat: { context: () => combat },
    scriptInterruptionSource: () => interaction ? "interaction" : null,
    scriptState: () => structuredClone(state), saveScriptState: async (_scene, next) => { state = structuredClone(next); },
    currentObject: () => true, refreshObject() {}, onChange() {},
    effects: { async speak() { calls.push("after"); return pending.promise; }, stop() { calls.push("stop"); } }
  };
  const executor = new ObjectScriptRuntime(runtime);
  return { scene, object, script, key, executor, pending, calls, animationStops: () => animationStops,
    state: () => structuredClone(state), progress: () => state.scriptStates[key],
    interrupt(source, active) {
      if (source === "combat") combat = active ? { id: "combat", turnKey: "combat:1", isTurn: true } : null;
      else interaction = active;
      notifyExecutionChange(scene, `${source}-change`);
    } };
}

for (const source of ["combat", "interaction"]) for (const finished of [true, false]) test(`short ${source} interruption settles pending background speech with foreground ${finished ? "finished" : "active"}`, async () => {
  const f = fixture({ finished });
  const start = await f.executor.tick(f.scene, f.state(), f.object, f.script, 0);
  await f.executor.execute(start);
  if (!finished) await f.executor.tick(f.scene, f.state(), f.object, f.script, 0.1);
  const [after] = await f.executor.tickEffects(f.scene, "run", f.object, 1);
  assert.equal(after.background.status, "pending");
  const executing = f.executor.execute(after); await settle();
  assert.deepEqual(f.calls, ["after"]);
  f.interrupt(source, true); f.interrupt(source, false); // The cause ends before another simulation tick.
  await executing;
  await f.executor.tickEffects(f.scene, "run", f.object, 0);
  assert.equal(f.progress().speechEffect, null, "known cancellation must not become an unknown pending result");
  assert.equal(f.progress().status, finished ? "done" : "interrupted");
  assert.ok(f.progress().generation > 0);
  assert.equal(f.animationStops(), finished ? 0 : 1, "completed presentation cannot stop a later script's native animation");
  const snapshot = f.state(); f.pending.resolve([{ id: "late-message" }]); await settle();
  assert.deepEqual(f.state(), snapshot, "late completion cannot revive or overwrite the interrupted script");
  f.executor.dispose();
});
