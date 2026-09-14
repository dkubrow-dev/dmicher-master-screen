import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
import { defaultObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";

const target = { type: "Token", id: "npc" };
const step = (id, kind, parameters, next = []) => ({ id, kind, parameters, next });
const initial = () => normalizeScript({ name: "Initial position", steps: [
  step(1, "move", { duration: 0, position: { x: 0, y: 0 } })
] });
async function within(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Restoration waited for an old command")), 1000); })]); }
  finally { clearTimeout(timer); }
}

async function fixture({ pending = false } = {}) {
  const command = { ...defaultObjectCommand(pending ? "come" : "wait"), enabled: true };
  command.interruptions.manual = "restart-step";
  if (pending) command.beforeScript = normalizeScript({ name: "Before movement", interruptions: { command: "ignore" },
    steps: [step(1, "wait", { seconds: 10 })] });
  const f = await commandFixture({ commands: pending ? [command, "wait"] : [command] });
  f.binding.initialScript = initial();
  f.npc.x = 200;
  await f.accept(command.id); await f.tick();
  const commandIds = [f.active().runId];
  if (pending) {
    const replacement = await f.accept("wait");
    commandIds.push(replacement.runId);
    assert.equal(f.active().pendingReplacement.runId, replacement.runId);
  }
  return { ...f, commandIds };
}

for (const all of [true, false]) for (const pending of [false, true]) {
  test(`${all ? "scene" : "group"} restoration replaces a suspended command${pending ? " and its pending replacement" : ""}`, async () => {
    const f = await fixture({ pending });
    await f.runtime.haltAll(f.scene);
    assert.equal(f.active().interruption?.source, "manual", "ordinary Stop preserves the selected resume policy");
    const runs = await (all ? f.runtime.restoreAllInitial(f.scene) : f.runtime.restoreGroupInitial(f.scene, "main"));
    assert.equal(runs.length, 1);
    for (let index = 0; index < 6; index++) await f.tick();
    assert.equal(f.npc.x, 0, "a fresh initial script must not be blocked by the former command");
    assert.equal(f.active(), null, "Restore abandons the former command rather than resuming it later");
    assert.equal(f.runtime.manualRuns.size, 0);
    assert.equal(f.runtime.isRestoringInitial(f.scene), false);
    assert.equal(f.current().halted, true);
    for (const id of f.commandIds) assert.equal(f.signals.filter(signal => signal.id === `${id}:commandCancelled`).length, 1);
    await f.runtime.startAll(f.scene); await f.tick();
    assert.equal(f.active(), null, "Start after Restore cannot resurrect an abandoned command");
    assert.equal(f.npc.x, 0); assert.deepEqual(f.errors, []);
  });
}

test("explicit object restoration replaces its running command before preparing the initial script", async () => {
  const f = await fixture();
  const [former] = f.commandIds;
  await f.runtime.restoreInitial(f.scene, target);
  for (let index = 0; index < 6; index++) await f.tick();
  assert.equal(f.npc.x, 0);
  assert.equal(f.active(), null);
  assert.equal(f.runtime.manualRuns.size, 0);
  assert.equal(f.current().halted, false, "addressed restoration does not stop the whole group");
  assert.equal(f.signals.filter(signal => signal.id === `${former}:commandCancelled`).length, 1);
  assert.deepEqual(f.errors, []);
});

for (const all of [false, true]) {
  test(`${all ? "scene" : "object"} restoration releases a pending command macro and rejects its late result`, async () => {
    const command = { ...defaultObjectCommand("wait"), enabled: true };
    command.interruptions.manual = "restart-step";
    command.beforeScript = normalizeScript({ steps: [
      step(1, "macro", { macroUuid: "Macro.pending", before: 0, after: 0 }, [2]),
      step(2, "visibility", { visible: false })
    ] });
    const f = await commandFixture({ commands: [command] });
    f.binding.initialScript = initial(); f.npc.x = 200;
    let begin, release;
    const started = new Promise(resolve => { begin = resolve; }), pending = new Promise(resolve => { release = resolve; });
    f.runtime.isObjectMacroAttached = () => true;
    f.runtime.effects.macro = async () => { begin(); await pending; };
    await f.accept("wait"); const oldRunId = f.active().runId, ticking = f.tick();
    try {
      await within(started);
      await within(Promise.all([ticking, all ? f.runtime.restoreAllInitial(f.scene) : f.runtime.restoreInitial(f.scene, target)]));
      for (let index = 0; index < 4; index++) await f.tick();
      assert.equal(f.npc.x, 0); assert.equal(f.active(), null);
      release(); await new Promise(setImmediate);
      if (all) await f.runtime.startAll(f.scene);
      await f.tick();
      assert.equal(f.active(), null); assert.equal(f.npc.hidden, false, "late completion cannot execute the old command's next step");
      assert.equal(f.signals.filter(signal => signal.id === `${oldRunId}:commandCancelled`).length, 1);
      assert.deepEqual(f.errors, []);
    } finally { release(); }
  });
}

async function stoppedObjectFixture() {
  const routine = normalizeScript({ name: "Routine", steps: [
    step(1, "visibility", { visible: false }, [2]), step(2, "wait", { seconds: 100 })
  ] });
  const f = await commandFixture({ commands: ["stop"], scripts: [{ stateId: "calm", ...routine }] });
  f.binding.initialScript = initial();
  await f.tick(); await f.tick();
  assert.equal(f.npc.hidden, true, "the routine was already executing before Stop");
  await f.accept("stop", {}, f.gm);
  for (let index = 0; index < 5; index++) await f.tick();
  assert.equal(f.active(), null, "Stop has completed and no command owns the object");
  assert.ok(f.current().disabledObjects.includes("Token:npc"));
  f.npc.x = 200; f.npc.hidden = false;
  return f;
}

for (const scope of ["object", "group", "scene"]) {
  test(`${scope} restoration re-enables an object stopped by a completed Stop command and resets its routine`, async () => {
    const f = await stoppedObjectFixture();
    if (scope === "object") await f.runtime.restoreInitial(f.scene, target);
    else if (scope === "group") await f.runtime.restoreGroupInitial(f.scene, "main");
    else await f.runtime.restoreAllInitial(f.scene);
    for (let index = 0; index < 6; index++) await f.tick();
    assert.equal(f.npc.x, 0);
    assert.equal(f.current().disabledObjects.includes("Token:npc"), false, "Restore explicitly returns object automation");
    if (scope !== "object") {
      assert.equal(f.current().halted, true, "restored groups wait for an explicit start");
      assert.equal(f.npc.hidden, false, "the routine has not started during restoration");
      await f.runtime.startGroup(f.scene, "main");
      for (let index = 0; index < 4; index++) await f.tick();
    }
    assert.equal(f.npc.hidden, true, "the former stopped routine must execute again");
    assert.equal(f.active(), null); assert.deepEqual(f.errors, []);
  });
}

test("group restoration clears its automation disables without changing another group's stopped object or execution", async () => {
  const f = await stoppedObjectFixture();
  f.flags.groupDefinitions.east = { ...sampleGroupDefinition(), groupId: "east", groupName: "East" };
  const east = { ...f.npc, id: "east", uuid: "Scene.scene.Token.east", name: "East", x: 800 };
  f.scene.tokens.set(east.id, east);
  f.flags.objectBindings.bindings["Token:east"] = { type: "Token", id: east.id, groupId: "east", initialScript: initial() };
  await f.runtime.enter(f.scene, "calm", { groupId: "east" });
  const other = getRuntime(f.scene, { groupId: "east" });
  other.disabledObjects = ["Token:east"]; await saveRuntime(f.scene, other);
  const before = getRuntime(f.scene, { groupId: "east" });
  await f.runtime.restoreGroupInitial(f.scene, "main");
  for (let index = 0; index < 6; index++) await f.tick();
  assert.deepEqual(f.current().disabledObjects, []);
  assert.equal(f.npc.x, 0);
  assert.deepEqual(getRuntime(f.scene, { groupId: "east" }), before, "another group retains its execution and disabled flags");
  assert.equal(east.x, 800);
});

test("addressed restoration re-enables only its object and leaves another disabled member unchanged", async () => {
  const f = await stoppedObjectFixture();
  const peer = { ...f.npc, id: "peer", uuid: "Scene.scene.Token.peer", name: "Peer", x: 800 };
  f.scene.tokens.set(peer.id, peer);
  f.flags.objectBindings.bindings["Token:peer"] = { type: "Token", id: peer.id, groupId: "main", initialScript: initial() };
  const parent = f.current(); parent.disabledObjects.push("Token:peer"); await saveRuntime(f.scene, parent);
  await f.runtime.restoreInitial(f.scene, target);
  for (let index = 0; index < 6; index++) await f.tick();
  assert.deepEqual(f.current().disabledObjects, ["Token:peer"]);
  assert.equal(f.current().runId, parent.runId, "addressed restoration does not replace the group execution");
  assert.equal(f.npc.x, 0); assert.equal(f.npc.hidden, true); assert.equal(peer.x, 800);
  assert.deepEqual(f.errors, []);
});

test("addressed restoration releases an unresolved native movement of an ordinary group script before the scene queue", async () => {
  const routine = normalizeScript({ name: "Moving routine", steps: [
    step(1, "move", { duration: 1, position: { x: 400, y: 0 } }, [2]), step(2, "visibility", { visible: false })
  ] });
  const f = await commandFixture({ scripts: [{ stateId: "calm", ...routine }] });
  f.binding.initialScript = initial();
  let begin, release, first = true;
  const started = new Promise(resolve => { begin = resolve; }), pending = new Promise(resolve => { release = resolve; });
  const update = f.npc.update.bind(f.npc);
  f.npc.update = async changes => {
    await update(changes);
    if (first) { first = false; begin(); await pending; }
  };
  const ticking = f.tick(); await started;
  let timeout;
  try {
    const restoring = f.runtime.restoreInitial(f.scene, target);
    await Promise.race([Promise.all([ticking, restoring]), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Restoration waited for a stale native movement")), 500);
    })]);
    assert.equal(f.runtime.manualRuns.size, 1);
    const prepared = f.current().scriptStates;
    release(); await new Promise(setImmediate);
    assert.deepEqual(f.current().scriptStates, prepared, "the delayed movement cannot advance freshly prepared progress");
    await f.tick(); await f.tick();
    assert.equal(f.npc.x, 0); assert.equal(f.npc.hidden, false);
    assert.deepEqual(f.errors, []);
  } finally { clearTimeout(timeout); release(); await ticking; }
});

test("addressed restoration permits a new execution after an interruption progress write previously failed", async () => {
  const routine = normalizeScript({ name: "Recoverable movement", steps: [
    step(1, "move", { duration: 0, position: { x: 400, y: 0 } })
  ] });
  const f = await commandFixture({ scripts: [{ stateId: "calm", ...routine }] });
  f.binding.initialScript = initial();
  let rejectMovement = true, rejectFailureWrite = true;
  const update = f.npc.update.bind(f.npc), saveFlag = f.scene.setFlag.bind(f.scene);
  f.npc.update = async changes => {
    if (rejectMovement) { rejectMovement = false; throw new Error("Native movement failed"); }
    return update(changes);
  };
  f.scene.setFlag = async (scope, key, value) => {
    if (rejectFailureWrite && key === "groupRuntimes.main" && Object.values(value.scriptStates ?? {}).some(progress => progress.status === "failed")) {
      rejectFailureWrite = false; throw new Error("The interrupted progress could not be saved");
    }
    return saveFlag(scope, key, value);
  };
  await assert.rejects(f.tick(), /interrupted progress could not be saved/);
  const parentId = f.current().runId;
  await f.runtime.restoreInitial(f.scene, target);
  for (let index = 0; index < 6; index++) await f.tick();
  assert.equal(f.current().runId, parentId);
  assert.equal(f.npc.x, 400, "the new routine must not inherit the local failure barrier of the discarded progress");
  assert.equal(f.runtime.manualRuns.size, 0);
});
