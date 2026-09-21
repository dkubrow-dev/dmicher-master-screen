import test from "node:test";
import assert from "node:assert/strict";
import { emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { scriptPresentationIsCurrent, scriptPresentationScope, validScriptPresentationScope } from "../dmicher-master-screen/scripts/execution.js";

function fixture() {
  const target = { type: "Token", id: "npc" }, scriptKey = "Token:npc:routine:one";
  const run = { ...emptyRuntime("hall"), runId: "run", stateId: "calm", scriptStates: { [scriptKey]: { generation: 2, stepId: 1, status: "ready" } } };
  const flags = { groupDefinitions: { hall: { schemaVersion: 1 } }, groupRuntimes: { hall: run },
    objectBindings: { bindings: { "Token:npc": { ...target, groupId: "hall" } } } };
  const scene = { id: "scene", tokens: new Map([["npc", { id: "npc" }]]), getFlag: (_owner, key) => flags[key] };
  const data = { sceneId: scene.id, runId: run.runId, manual: false, target, scriptKey, scriptGeneration: 2 };
  return { target, scriptKey, run, flags, scene, data };
}
const unreadable = (object, name) => Object.defineProperty(object, name, { enumerable: true, get() { throw new Error(`Must not read ${name}`); } });

test("sound and focus admission never reads state preparation, history, stock or unrelated runtime bodies", () => {
  const f = fixture();
  for (const key of ["dialogueSessions", "dialogueCommands", "tradeRequests", "shops", "state"]) unreadable(f.run, key);
  unreadable(f.flags.groupDefinitions.hall, "states");
  for (let index = 0; index < 100; index++) {
    const id = `other${index}`, run = { runId: `run-${index}` };
    for (const key of ["schemaVersion", "state", "scriptStates", "dialogueSessions"]) unreadable(run, key);
    f.flags.groupRuntimes[id] = run;
  }
  for (let index = 0; index < 500; index++) assert.equal(scriptPresentationIsCurrent(f.scene, f.data), true);
  const scope = scriptPresentationScope(f.scene, { ...f.data, groupId: "hall", manual: true });
  assert.equal(scope.manualGroupStamp, '["run","calm",false,0]');
  assert.equal(scriptPresentationIsCurrent(f.scene, scope), true);
});

test("a prepared group without its first run uses the existing empty-runtime stamp without writing one", () => {
  const f = fixture(); delete f.flags.groupRuntimes.hall;
  const scope = scriptPresentationScope(f.scene, { ...f.data, groupId: "hall", manual: true });
  assert.equal(scope.manualGroupStamp, '["",null,false,0]');
  assert.equal(scriptPresentationIsCurrent(f.scene, scope), true);
  assert.equal(Object.hasOwn(f.flags.groupRuntimes, "hall"), false);
  f.flags.groupRuntimes.hall = f.run;
  assert.equal(scriptPresentationIsCurrent(f.scene, scope), false);
});

test("deleted, malformed or mismatched runtime records cannot authorize remote presentation", () => {
  for (const patch of [{ schemaVersion: 2 }, { groupId: "another" }, { halted: "false" }, { haltedAt: "0" }, { scriptStates: [] }, { disabledObjects: null }]) {
    const f = fixture(); Object.assign(f.run, patch);
    assert.equal(scriptPresentationIsCurrent(f.scene, f.data), false);
  }
  const f = fixture(); delete f.flags.groupDefinitions.hall;
  assert.equal(scriptPresentationIsCurrent(f.scene, f.data), false);
  assert.equal(scriptPresentationIsCurrent(f.scene, { ...f.data, manual: true, groupId: "hall", manualHaltId: null, manualGroupStamp: undefined }), false);
  for (const malformed of [null, undefined, [], "scope"]) assert.equal(validScriptPresentationScope(malformed), false);
});

test("manual presentation rejects malformed group keys safely and remains valid outside groups", () => {
  const f = fixture();
  assert.equal(scriptPresentationIsCurrent(f.scene, { ...f.data, manual: true, groupId: "bad.group", manualGroupStamp: null, manualHaltId: null }), false);
  f.flags.objectBindings.bindings["Token:npc"].groupId = null;
  const outside = scriptPresentationScope(f.scene, { ...f.data, manual: true });
  assert.equal(outside.manualGroupStamp, null); assert.equal(scriptPresentationIsCurrent(f.scene, outside), true);
});

test("step clocks do not invalidate presentation, while generations, object disable and group halt do", () => {
  const f = fixture();
  const progress = f.run.scriptStates[f.scriptKey];
  progress.stepId = null; progress.status = "done";
  assert.equal(scriptPresentationIsCurrent(f.scene, f.data), true);
  progress.generation++;
  assert.equal(scriptPresentationIsCurrent(f.scene, f.data), false);
  progress.generation--;
  f.run.disabledObjects.push("Token:npc"); assert.equal(scriptPresentationIsCurrent(f.scene, f.data), false);
  f.run.disabledObjects.length = 0; f.run.halted = true; assert.equal(scriptPresentationIsCurrent(f.scene, f.data), false);
});

test("only the active Behavior-off or Cancel command can present while ordinary automation is disabled", () => {
  for (const id of ["behavior-off", "cancel"]) {
    const f = fixture(), scriptKey = "Token:npc:command-before:script";
    f.run.disabledObjects = ["Token:npc"];
    const command = { schemaVersion: 1, command: true, runId: "command", parentRunId: f.run.runId, groupId: "hall", target: f.target,
      config: { id }, phase: "before", scriptStates: { [scriptKey]: { generation: 2 } } };
    f.flags.objectCommandRuns = { "Token:npc": command };
    const data = { ...f.data, runId: command.runId, scriptKey };
    assert.equal(scriptPresentationIsCurrent(f.scene, data), true);
    assert.equal(scriptPresentationIsCurrent(f.scene, f.data), false, "the ordinary script remains disabled");
    command.config.id = "follow"; assert.equal(scriptPresentationIsCurrent(f.scene, data), false);
    command.config.id = id;
    command.interruption = { source: "interaction" }; assert.equal(scriptPresentationIsCurrent(f.scene, data), false);
    command.interruption = null;
    command.scriptStates[scriptKey].generation++; assert.equal(scriptPresentationIsCurrent(f.scene, data), false);
    command.scriptStates[scriptKey].generation--;
    f.run.halted = true; assert.equal(scriptPresentationIsCurrent(f.scene, data), false);
    f.run.halted = false; f.flags.automationHalted = true; assert.equal(scriptPresentationIsCurrent(f.scene, data), false);
  }
});
