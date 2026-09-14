import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
import { normalizeObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";

const script = enabled => ({ enabled, steps: [{ id: 1, kind: "wait", parameters: { seconds: 0.1 }, next: [] }] });
const configure = patch => normalizeObjectCommand({ id: "wait", enabled: true, parameters: { seconds: 0.1 }, ...patch });

test("disabled before and after blocks are skipped without trapping the command lock", async () => {
  const f = await commandFixture({ commands: [configure({ beforeScript: script(false), afterScript: script(false) })] });
  await f.accept("wait");
  for (let index = 0; index < 12; index++) await f.tick(100);
  assert.equal(f.active(), null);
  assert.equal(f.signals.filter(entry => entry.name === "commandCompleted").length, 1);
  assert.deepEqual(f.errors, []);
});

test("explicit halt and immediate resume applies the command policy even before another engine tick", async () => {
  const f = await commandFixture({ commands: [configure({ parameters: { seconds: 10 }, interruptions: { manual: "restart-step" } })] });
  await f.accept("wait");
  for (let index = 0; index < 3; index++) await f.tick();
  const old = f.active();
  assert.equal(old.phase, "core");
  await f.runtime.halt(f.scene);
  await f.runtime.startGroup(f.scene, "main");
  for (let index = 0; index < 3; index++) await f.tick();
  const resumed = f.active();
  assert.ok(resumed, "the command must resume instead of being mistaken for a new-state cancellation");
  assert.notEqual(resumed.runId, old.runId);
  assert.equal(resumed.parentRunId, f.current().runId);
  assert.equal(resumed.phase, "core");
  assert.equal(f.signals.filter(entry => entry.name === "commandCancelled").length, 0);
});

test("forged or stale command targets reject with a user-readable command error", async () => {
  const f = await commandFixture();
  for (const targetUuid of ["Scene.scene.Token.missing", "Scene.other.Token.npc", "Actor.npc", "Scene.scene.Token.__proto__"]) {
    const before = f.writes();
    await assert.rejects(f.executor.accept(f.scene, { ...f.packet("wait"), targetUuid }, f.player), error => {
      assert.equal(error.name, "CommandRejection");
      assert.ok(error.code);
      assert.doesNotMatch(error.message, /undefined|null|UUID|__proto__|TypeError/);
      return true;
    });
    assert.equal(f.writes(), before);
  }
});
