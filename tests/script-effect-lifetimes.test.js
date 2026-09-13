import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { ObjectScriptRuntime, scriptProgressKey } from "../dmicher-master-screen/scripts/script-runtime.js";

const clone = structuredClone;
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
function merge(previous, changes) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return clone(changes);
  const result = previous && typeof previous === "object" ? clone(previous) : {};
  for (const [key, value] of Object.entries(changes)) result[key] = merge(result[key], value);
  return result;
}
function fixture(raw, { combat = { context: () => null } } = {}) {
  const script = normalizeScript({ stateId: "calm", ...raw });
  const scene = { id: "effect-scene", grid: { size: 100, distance: 5 } };
  const object = { id: "npc", documentName: "Token", name: "NPC", parent: scene, x: 0, y: 0,
    width: 1, height: 1, rotation: 0, hidden: false, object: { checkCollision: () => false },
    async update(changes) { Object.assign(this, changes); } };
  let state = { runId: "run", groupId: "group", state: { id: "calm" }, scriptStates: {} };
  let paused = false, pauseClock = false, messages = 0;
  const calls = [];
  const runtime = {
    combat, scriptState: () => clone(state),
    saveScriptState: async (_scene, value) => { state = merge(state, value); },
    currentObject: (_scene, _runId, _target, options) => !paused || options?.ignoreInteractionPause === true,
    refreshObject() {}, onChange() {},
    effects: {
      async speak(_scene, _object, text, options) {
        const id = `message-${++messages}`; calls.push({ kind: "speech", text, options, id }); return [{ id }];
      },
      async removeSpeech(ids) { calls.push({ kind: "remove", ids: clone(ids) }); },
      async clearPreviousSpeech() { calls.push({ kind: "clear" }); }
    }
  };
  const executor = new ObjectScriptRuntime(runtime);
  const progress = (selected = script, slot = "routine") => state.scriptStates[scriptProgressKey({ type: "Token", id: object.id }, selected, slot)];
  return {
    scene, object, script, runtime, executor, calls, state: () => clone(state), progress,
    pause(value = true) { paused = value; },
    // Match GroupRuntime: advance existing effects before the foreground; claim
    // all work first and execute it only after the state updates have finished.
    async tick(seconds = 0.5, { selected = script, slot = "routine", execute = true, idle = false } = {}) {
      const jobs = await executor.tickEffects(scene, state.runId, object, seconds);
      if (idle) jobs.push(...await executor.tickEffects(scene, state.runId, object, 0, { idle: true }));
      if (paused) pauseClock = true;
      else {
        const budget = pauseClock ? 0 : seconds; pauseClock = false;
        const job = await executor.tick(scene, clone(state), object, selected, budget, { slot });
        if (job) jobs.push(job);
      }
      if (execute) await Promise.all(jobs.map((job) => executor.execute(job)));
      return jobs;
    }
  };
}

test("parallel emotion advances immediately and expires even after its foreground script is done", async () => {
  const f = fixture({ steps: [step(1, "emotion", { emoji: "!", executionMode: "parallel", duration: 2 }, [2]),
    step(2, "move", { duration: 0, position: { x: 100, y: 0 } })] });
  await f.tick(0);
  assert.equal(f.object.x, 100); assert.equal(f.progress().status, "done");
  assert.equal(f.progress().emoji, "!"); assert.equal(f.progress().emojiEffect.remainingMs, 2000);
  await f.tick(1.5); assert.equal(f.progress().emoji, "!"); assert.equal(f.progress().emojiEffect.remainingMs, 500);
  await f.tick(0.5); assert.equal(f.progress().emoji, ""); assert.equal(f.progress().emojiEffect, null);
  assert.equal(f.progress().status, "done");
});

test("wait emotion holds the next action until its full duration has elapsed", async () => {
  const f = fixture({ steps: [step(1, "emotion", { emoji: "!", executionMode: "wait", duration: 2 }, [2]),
    step(2, "move", { duration: 0, position: { x: 100, y: 0 } })] });
  await f.tick(0); await f.tick(1.5);
  assert.equal(f.object.x, 0); assert.equal(f.progress().stepId, 1); assert.equal(f.progress().emoji, "!");
  assert.equal(f.progress().action.remainingMs, 500);
  await f.tick(0.5);
  assert.equal(f.object.x, 100); assert.equal(f.progress().emoji, ""); assert.equal(f.progress().status, "done");
});

test("parallel speech deletes its before message on time while the following wait continues", async () => {
  const f = fixture({ steps: [step(1, "speech", { executionMode: "parallel", duration: 2,
    chat: { text: "Before", timing: "before", deleteAfter: true }, bubble: { text: "Visible" } }, [2]),
    step(2, "wait", { seconds: 10 })] });
  await f.tick(0);
  assert.equal(f.progress().stepId, 2); assert.equal(f.progress().bubble.text, "Visible");
  assert.equal(f.calls.filter(call => call.kind === "speech").length, 1);
  await f.tick(1);
  assert.equal(f.progress().action.remainingMs, 9000); assert.equal(f.progress().speechEffect.remainingMs, 1000);
  assert.equal(f.calls.filter(call => call.kind === "remove").length, 0);
  await f.tick(1);
  assert.equal(f.progress().action.remainingMs, 8000); assert.equal(f.progress().bubble, null);
  assert.deepEqual(f.calls.filter(call => call.kind === "remove").map(call => call.ids), [["message-1"]]);
  assert.equal(f.progress().speechEffect, null);
});

test("parallel speech posts its after message on expiry without blocking the following movement", async () => {
  const f = fixture({ steps: [step(1, "speech", { executionMode: "parallel", duration: 2,
    chat: { text: "After", timing: "after", deleteAfter: true }, bubble: { text: "Visible" } }, [2]),
    step(2, "move", { duration: 4, position: { x: 100, y: 0 } })] });
  await f.tick(0); await f.tick(1);
  assert.equal(f.object.x, 25); assert.equal(f.calls.filter(call => call.kind === "speech").length, 0);
  await f.tick(1);
  assert.equal(f.object.x, 50); assert.equal(f.progress().bubble, null);
  const [posted] = f.calls.filter(call => call.kind === "speech");
  assert.equal(posted.text, "After"); assert.equal(posted.options.expiresAfter, 2);
  await f.tick(2);
  assert.equal(f.object.x, 100); assert.equal(f.progress().status, "done");
  assert.equal(f.calls.filter(call => call.kind === "speech").length, 1);
});

for (const executionMode of ["parallel", "wait"]) {
  test(`zero-duration ${executionMode} emotion persists without delaying the following wait and is replaced by the next emotion`, async () => {
    const f = fixture({ steps: [step(1, "emotion", { emoji: "!", executionMode, duration: 0 }, [2]),
      step(2, "wait", { seconds: 1 }, [3]), step(3, "emotion", { emoji: "?", executionMode, duration: 0 })] });
    await f.tick(0);
    assert.equal(f.progress().stepId, 2); assert.equal(f.progress().emoji, "!");
    await f.tick(0.5); assert.equal(f.progress().emoji, "!"); assert.equal(f.progress().action.remainingMs, 500);
    await f.tick(0.5); assert.equal(f.progress().emoji, "?"); assert.equal(f.progress().status, "done");
    await f.tick(100); assert.equal(f.progress().emoji, "?");
  });

  test(`zero-duration ${executionMode} speech keeps its bubble until the next speech without waiting for a lifetime`, async () => {
    const f = fixture({ steps: [step(1, "speech", { executionMode, duration: 0,
      chat: { text: "First" }, bubble: { text: "First bubble" } }, [2]), step(2, "wait", { seconds: 1 }, [3]),
      step(3, "speech", { executionMode, duration: 0, chat: { text: "Second" }, bubble: { text: "Second bubble" } })] });
    await f.tick(0); await f.tick(0);
    assert.equal(f.progress().stepId, 2); assert.equal(f.progress().bubble.text, "First bubble");
    await f.tick(0.5); assert.equal(f.progress().bubble.text, "First bubble");
    await f.tick(0.5); assert.equal(f.progress().bubble.text, "Second bubble");
    assert.deepEqual(f.calls.filter(call => call.kind === "speech").map(call => call.text), ["First", "Second"]);
    await f.tick(0); await f.tick(100); assert.equal(f.progress().bubble.text, "Second bubble");
    assert.equal(f.progress().status, "done");
  });
}

test("claiming replacement speech in another script slot cancels the former queued after message", async () => {
  const old = normalizeScript({ id: "old", stateId: "calm", steps: [step(1, "speech", { executionMode: "parallel", duration: 1,
    chat: { text: "Stale after", timing: "after" }, bubble: { text: "Old" } })] });
  const f = fixture({ id: "new", steps: [step(1, "speech", { executionMode: "parallel", duration: 2,
    chat: { text: "New before" }, bubble: { text: "New" } })] });
  await f.tick(0, { selected: old, slot: "transition" });
  assert.equal(f.progress(old, "transition").bubble.text, "Old");
  const jobs = await f.tick(1, { execute: false });
  assert.equal(jobs.length, 2); assert.equal(jobs[0].stage, "speechEnd"); assert.equal(jobs[1].stage, "effect");
  assert.equal(f.progress(old, "transition").speechEffect, null);
  await f.executor.execute(jobs[0]);
  assert.equal(f.calls.filter(call => call.kind === "speech").length, 0);
  await f.executor.execute(jobs[1]);
  assert.deepEqual(f.calls.filter(call => call.kind === "speech").map(call => call.text), ["New before"]);
  assert.equal(f.progress().bubble.text, "New"); assert.equal(f.progress().speechEffect.remainingMs, 2000);
});

test("replacement speech releases an already pending old completion without waiting for its external response", async () => {
  const old = normalizeScript({ id: "entry", stateId: "calm", steps: [step(1, "speech", { executionMode: "parallel", duration: 1,
    chat: { text: "Old after", timing: "after" }, bubble: { text: "Old" } })] });
  const f = fixture({ id: "new", steps: [step(1, "speech", { executionMode: "parallel", duration: 1, chat: { text: "New" }, bubble: { text: "New" } })] });
  await f.tick(0, { selected: old, slot: "transition" });
  const [job] = await f.tick(1, { selected: old, slot: "transition", execute: false });
  let begin;
  const started = new Promise(resolve => { begin = resolve; }), speak = f.runtime.effects.speak;
  f.runtime.effects.speak = (...args) => { if (args[2] === "Old after") { begin(); return new Promise(() => {}); } return speak(...args); };
  let finished = false;
  const executing = f.executor.execute(job).then(() => { finished = true; });
  try {
    await started; await f.tick(0); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.progress(old, "transition").speechEffect, null);
    assert.equal(f.executor.jobs.has(job.key), false);
    assert.equal(finished, true);
    assert.deepEqual(f.calls.filter(call => call.kind === "speech").map(call => call.text), ["New"]);
  } finally { f.executor.dispose(); await executing; }
});

test("interaction pause freezes concurrent emotion and speech and resumption never catches up paused time", async () => {
  const f = fixture({ steps: [step(1, "emotion", { emoji: "!", duration: 5, executionMode: "parallel" }, [2]),
    step(2, "speech", { executionMode: "parallel", duration: 5, chat: { text: "Before" }, bubble: { text: "Visible" } }, [3]),
    step(3, "wait", { seconds: 10 })] });
  await f.tick(0); await f.tick(1);
  assert.equal(f.progress().emojiEffect.remainingMs, 4000); assert.equal(f.progress().speechEffect.remainingMs, 4000);
  assert.equal(f.progress().action.remainingMs, 9000);
  f.pause(); await f.tick(30); await f.tick(30);
  assert.equal(f.progress().emojiEffect.remainingMs, 4000); assert.equal(f.progress().speechEffect.remainingMs, 4000);
  assert.equal(f.progress().action.remainingMs, 9000);
  f.pause(false); await f.tick(30);
  assert.equal(f.progress().emojiEffect.remainingMs, 4000); assert.equal(f.progress().speechEffect.remainingMs, 4000);
  assert.equal(f.progress().action.remainingMs, 9000);
  await f.tick(1);
  assert.equal(f.progress().emojiEffect.remainingMs, 3000); assert.equal(f.progress().speechEffect.remainingMs, 3000);
  assert.equal(f.progress().action.remainingMs, 8000);
});

test("combat spends a parallel emotion and following wait against one shared six-second budget", async () => {
  const combat = { context: () => ({ id: "fight", turnKey: "turn-1", isTurn: true }),
    notify: async () => {}, confirmAction: async () => "continue" };
  const f = fixture({ combat: { enabled: true, turnSeconds: 6 },
    steps: [step(1, "emotion", { emoji: "!", duration: 10, executionMode: "parallel" }, [2]),
      step(2, "wait", { seconds: 6 })] }, { combat });
  await f.tick(0); // Confirm emotion.
  await f.tick(0); // Emotion is instant; confirm the following wait.
  assert.equal(f.progress().emojiEffect.remainingMs, 10000); assert.equal(f.progress().combat.remaining, 6);
  await f.tick(0);
  assert.equal(f.progress().status, "done"); assert.equal(f.progress().combat.remaining, 0);
  assert.equal(f.progress().emojiEffect.remainingMs, 4000); assert.equal(f.progress().emoji, "!");
  await f.tick(100);
  assert.equal(f.progress().emojiEffect.remainingMs, 4000);
});

for (const kind of ["emotion", "speech"]) test(`completed foreground ${kind} effect spends idle combat time only once per turn`, async () => {
  let turnKey = "turn-1", isTurn = true;
  const combat = { context: () => ({ id: "fight", turnKey, isTurn }), notify: async () => {}, confirmAction: async () => "continue" };
  const parameters = kind === "emotion" ? { emoji: "!" } : { chat: { text: "After", timing: "after" }, bubble: { text: "Visible" } };
  const field = kind === "emotion" ? "emojiEffect" : "speechEffect";
  const f = fixture({ combat: { enabled: true, turnSeconds: 6 }, steps: [step(1, kind, { ...parameters, duration: 10, executionMode: "parallel" })] }, { combat });
  await f.tick(0); await f.tick(0);
  assert.equal(f.progress().status, "done"); assert.equal(f.progress()[field].remainingMs, 10000);
  await f.tick(0, { idle: true });
  assert.equal(f.progress()[field].remainingMs, 4000); assert.equal(f.progress().combat.remaining, 0);
  for (let i = 0; i < 3; i++) await f.tick(100, { idle: true });
  assert.equal(f.progress()[field].remainingMs, 4000);
  isTurn = false; turnKey = "other-turn"; await f.tick(100, { idle: true });
  assert.equal(f.progress()[field].remainingMs, 4000);
  isTurn = true; turnKey = "turn-2"; await f.tick(0, { idle: true });
  assert.equal(f.progress()[field], null); assert.equal(f.progress().combat.remaining, 2);
  if (kind === "emotion") assert.equal(f.progress().emoji, "");
  else { assert.equal(f.progress().bubble, null); assert.deepEqual(f.calls.filter(call => call.kind === "speech").map(call => call.text), ["After"]); }
});

for (const kind of ["emotion", "speech"]) test(`a transition ${kind} effect does not spend the routine's combat time again while idle`, async () => {
  let turnKey = "turn-1";
  const combat = { context: () => ({ id: "fight", turnKey, isTurn: true }), notify: async () => {}, confirmAction: async () => "continue" };
  const parameters = kind === "emotion" ? { emoji: "!" } : { chat: { text: "After", timing: "after" }, bubble: { text: "Visible" } };
  const field = kind === "emotion" ? "emojiEffect" : "speechEffect";
  const transition = normalizeScript({ id: "entry", stateId: "calm", combat: { enabled: true, turnSeconds: 6 },
    steps: [step(1, kind, { ...parameters, duration: 10, executionMode: "parallel" })] });
  const f = fixture({ id: "routine", combat: { enabled: true, turnSeconds: 6 }, steps: [step(1, "wait", { seconds: 8 })] }, { combat });
  await f.tick(0, { selected: transition, slot: "transition" }); await f.tick(0, { selected: transition, slot: "transition" });
  await f.tick(0); await f.tick(0);
  assert.equal(f.progress(transition, "transition")[field].remainingMs, 4000);
  assert.equal(f.progress(transition, "transition").combat.remaining, 0);
  assert.equal(f.progress().combat.remaining, 0);
  await f.tick(0, { idle: true });
  assert.equal(f.progress(transition, "transition")[field].remainingMs, 4000);
  // The old transition slot must join the new turn before the routine consumes
  // another two seconds. Idle may spend only the four seconds still unused.
  turnKey = "turn-2";
  await f.tick(0); await f.tick(0);
  assert.equal(f.progress().status, "done");
  assert.equal(f.progress(transition, "transition")[field].remainingMs, 2000);
  assert.equal(f.progress(transition, "transition").combat.turnKey, "turn-2");
  assert.equal(f.progress(transition, "transition").combat.remaining, 4);
  await f.tick(0, { idle: true });
  assert.equal(f.progress(transition, "transition")[field], null);
  assert.equal(f.progress(transition, "transition").combat.remaining, 2);
  if (kind === "speech") assert.deepEqual(f.calls.filter(call => call.kind === "speech").map(call => call.text), ["After"]);
});

test("a completed transition effect cannot spend more than its turn when another slot has a separate budget", async () => {
  const combat = { context: () => ({ id: "fight", turnKey: "turn-1", isTurn: true }), notify: async () => {}, confirmAction: async () => "continue" };
  const transition = normalizeScript({ id: "entry", stateId: "calm", combat: { enabled: true, turnSeconds: 6 },
    steps: [step(1, "emotion", { emoji: "!", duration: 15, executionMode: "parallel" }, [2]), step(2, "wait", { seconds: 6 })] });
  const f = fixture({ id: "routine", combat: { enabled: true, turnSeconds: 6 }, steps: [step(1, "wait", { seconds: 6 })] }, { combat });
  await f.tick(0, { selected: transition, slot: "transition" }); await f.tick(0, { selected: transition, slot: "transition" });
  await f.tick(0, { selected: transition, slot: "transition" });
  assert.equal(f.progress(transition, "transition").emojiEffect.remainingMs, 9000);
  await f.tick(0); await f.tick(0); await f.tick(0, { idle: true });
  assert.equal(f.progress(transition, "transition").emojiEffect.remainingMs, 9000);
});

for (const kind of ["emotion", "speech"]) test(`combat stop freezes a pending ${kind} lifetime without writes until the encounter ends`, async () => {
  let inCombat = true;
  const combat = { context: () => inCombat ? { id: "fight", turnKey: "turn-1", isTurn: true } : null,
    notify: async () => {}, confirmAction: async () => "continue" };
  const parameters = kind === "emotion" ? { emoji: "!" } : { chat: { text: "After", timing: "after" }, bubble: { text: "Visible" } };
  const field = kind === "emotion" ? "emojiEffect" : "speechEffect";
  const f = fixture({ combat: { enabled: true, turnSeconds: 6 }, steps: [step(1, kind, { ...parameters, duration: 2, executionMode: "parallel" })] }, { combat });
  await f.tick(0); await f.tick(0);
  const stopped = f.state(), key = scriptProgressKey({ type: "Token", id: f.object.id }, f.script);
  stopped.scriptStates[key].combat.stoppedId = "fight";
  await f.runtime.saveScriptState(f.scene, stopped);
  const save = f.runtime.saveScriptState; let writes = 0;
  f.runtime.saveScriptState = (...args) => { writes++; return save(...args); };
  for (let i = 0; i < 3; i++) await f.tick(100, { idle: true });
  assert.equal(f.progress()[field].remainingMs, 2000); assert.equal(writes, 0);
  assert.equal(f.calls.filter(call => call.kind === "speech").length, 0);
  inCombat = false;
  await f.tick(1); assert.equal(f.progress()[field].remainingMs, 1000);
  await f.tick(1); assert.equal(f.progress()[field], null);
  if (kind === "speech") assert.deepEqual(f.calls.filter(call => call.kind === "speech").map(call => call.text), ["After"]);
});
