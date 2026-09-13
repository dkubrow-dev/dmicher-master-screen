import test from "node:test";
import assert from "node:assert/strict";
import { runDirectorCommand } from "../dmicher-master-screen/scripts/director-commands.js";
import { clearDiagnostics, getDiagnosticEntries } from "../dmicher-master-screen/scripts/diagnostics.js";

function fixture() {
  globalThis.game = { user: { id: "gm", name: "Master", isGM: true }, settings: { get: () => false }, i18n: { lang: "en" } };
  clearDiagnostics();
  const scene = { id: "scene", name: "Hall" };
  return { scene, entries: () => getDiagnosticEntries({ sceneId: scene.id }) };
}

test("Director command is recorded before execution without Debug, rendering or signal subscribers", async () => {
  const f = fixture();
  let finish;
  const result = runDirectorCommand("stop-all", f.scene, () => {
    const [entry] = f.entries();
    assert.equal(entry.event, "requested"); assert.equal(entry.level, "command");
    assert.equal(entry.context.initiatorId, "gm"); assert.equal(entry.context.initiatorName, "Master");
    assert.equal(entry.context.sceneName, "Hall");
    return new Promise(resolve => { finish = resolve; });
  });
  assert.equal(f.entries().length, 1);
  finish(["stopped"]); assert.deepEqual(await result, ["stopped"]);
  assert.deepEqual(f.entries().map(entry => entry.event), ["requested", "completed"]);
  assert.equal(f.entries()[1].context.commandId, f.entries()[0].context.commandId);
});

test("A new Stop executes immediately and supersedes only the pending command on its scene", async () => {
  const f = fixture(), other = { id: "other", name: "Street" };
  let finishStart, finishOther;
  const start = runDirectorCommand("start-all", f.scene, () => new Promise(resolve => { finishStart = resolve; }));
  const otherStart = runDirectorCommand("start-all", other, () => new Promise(resolve => { finishOther = resolve; }));
  let stopped = false;
  const stop = runDirectorCommand("stop-all", f.scene, () => { stopped = true; return []; });
  assert.equal(stopped, true);
  await stop; finishStart([]); finishOther([]); await Promise.all([start, otherStart]);
  const own = f.entries();
  assert.deepEqual(own.map(entry => [entry.context.command, entry.event]), [
    ["start-all", "requested"], ["stop-all", "requested"], ["start-all", "cancelled"], ["stop-all", "completed"]
  ]);
  assert.equal(own[2].context.supersededBy, own[1].context.commandId);
  assert.deepEqual(getDiagnosticEntries({ sceneId: other.id }).map(entry => entry.event), ["requested", "completed"]);
});

test("Command failures remain errors and partial group failures cannot be logged as success", async () => {
  const f = fixture(), failure = new Error("storage refused");
  await assert.rejects(runDirectorCommand("stop-all", f.scene, () => { throw failure; }), error => error === failure);
  assert.deepEqual(f.entries().map(entry => entry.event), ["requested", "failed"]);
  assert.equal(f.entries()[1].error.message, "storage refused");
  await assert.rejects(runDirectorCommand("resume-all", f.scene, () => Promise.reject(failure)), error => error === failure);
  const partial = [{ groupId: "west", error: "denied" }];
  assert.equal(await runDirectorCommand("start-all", f.scene, () => partial), partial);
  const last = f.entries().at(-1);
  assert.equal(last.event, "failed"); assert.equal(last.level, "error");
  assert.deepEqual(last.context.failures, partial);
  await runDirectorCommand("start-all", f.scene, () => Promise.reject(undefined)).catch(() => {});
  assert.equal(f.entries().at(-1).level, "error");
  assert.equal(f.entries().at(-1).error.message, "undefined");
});

test("Initial scripts are logged as scheduled rather than completed on the runtime queue result", async () => {
  const f = fixture();
  await runDirectorCommand("restore-initial", f.scene, () => ["manual-run"]);
  assert.equal(f.entries().at(-1).event, "scheduled");
  assert.equal(f.entries().at(-1).context.resultCount, 1);
  await runDirectorCommand("restore-initial", f.scene, () => []);
  assert.equal(f.entries().at(-1).event, "completed");
});
