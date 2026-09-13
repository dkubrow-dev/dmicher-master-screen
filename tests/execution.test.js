import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionScope, notifyExecutionChange, onExecutionChange } from "../dmicher-master-screen/scripts/execution.js";

test("execution scope cancels a pending await and never revives after a later start", async () => {
  const scene = {}, scope = createExecutionScope(scene, { isCurrent: () => active });
  let active = true, release;
  const pending = scope.run(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); active = false; notifyExecutionChange(scene);
  assert.deepEqual(await pending, { stale: true });
  active = true; release("late");
  assert.equal(scope.current(), false); assert.equal(scope.signal.aborted, true);
  let called = false;
  assert.deepEqual(await scope.run(() => { called = true; }), { stale: true });
  assert.equal(called, false); scope.dispose();
});

test("scope disposal removes its listener and unrelated scene changes cannot cancel it", async () => {
  const scene = {}, other = {}, scope = createExecutionScope(scene, { isCurrent: () => true });
  notifyExecutionChange(other, "runtime-disposed");
  assert.deepEqual(await scope.run(() => 42), { value: 42 });
  scope.dispose(); notifyExecutionChange(scene, "canvas-teardown");
  assert.equal(scope.signal.aborted, false);
});

test("a broken execution observer cannot prevent cancellation of later listeners", async () => {
  const scene = {}, unsubscribe = onExecutionChange(scene, () => { throw new Error("broken observer"); });
  const scope = createExecutionScope(scene, { isCurrent: () => true });
  const pending = scope.run(() => new Promise(() => {}));
  notifyExecutionChange(scene, "runtime-disposed");
  assert.deepEqual(await pending, { stale: true });
  scope.dispose(); unsubscribe();
});

test("late rejection of a cancelled native operation is handled without a new result", async () => {
  const scope = createExecutionScope({}, { isCurrent: () => true });
  let reject;
  const pending = scope.run(() => new Promise((_resolve, fail) => { reject = fail; }));
  await Promise.resolve(); scope.cancel(); assert.deepEqual(await pending, { stale: true });
  reject(new Error("late failure")); await new Promise(resolve => setImmediate(resolve));
  scope.dispose();
});
