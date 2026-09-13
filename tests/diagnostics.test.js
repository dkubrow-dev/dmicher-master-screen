import test from "node:test";
import assert from "node:assert/strict";
import { debugTrace, debugError, signalTrace } from "../dmicher-master-screen/scripts/debug.js";
import { getDiagnosticEntries, getDiagnosticUpdate, clearDiagnostics, subscribeDiagnostics, diagnosticSnapshot, DIAGNOSTIC_LIMIT } from "../dmicher-master-screen/scripts/diagnostics.js";

function fixture(t, enabled = false) {
  globalThis.game = { user: { isGM: true }, settings: { get: () => enabled } };
  clearDiagnostics();
  t.mock.method(console, "debug", () => {}); t.mock.method(console, "error", () => {});
  return { setDebug(value) { enabled = value; } };
}

test("signals and errors remain in the GM console with Debug off, while verbose context stays lazy", (t) => {
  const f = fixture(t); let evaluated = 0;
  debugTrace("script", "step.started", () => { evaluated++; return {}; });
  signalTrace("emitted", { sceneId: "a", emitterName: "NPC", signalName: "greeting" });
  debugError("shop", "purchase.failed", new Error("No stock"), () => { evaluated++; return { sceneId: "a" }; });
  assert.equal(evaluated, 1);
  assert.deepEqual(getDiagnosticEntries({ sceneId: "a" }).map(entry => entry.level), ["signal", "error"]);
  assert.equal(getDiagnosticEntries()[1].error.message, "No stock");
  assert.equal(console.debug.mock.callCount(), 0); assert.equal(console.error.mock.callCount(), 0);
  f.setDebug(true); debugTrace("script", "step.started", { sceneId: "a", stepId: 1 });
  assert.equal(getDiagnosticEntries({ sceneId: "a", includeDebug: true }).length, 3);
  f.setDebug(false); assert.equal(getDiagnosticEntries({ sceneId: "a" }).length, 2);
  assert.equal(getDiagnosticEntries({ sceneId: "a", includeDebug: true }).length, 3);
});

test("scene filtering, scoped clear and detached snapshots preserve unrelated scene history", (t) => {
  fixture(t);
  const source = { sceneId: "a", parameters: { value: 1 } };
  signalTrace("emitted", source); signalTrace("emitted", { sceneId: "b" });
  debugError("runtime", "failed", new Error("Global"));
  source.parameters.value = 2;
  const a = getDiagnosticEntries({ sceneId: "a" });
  assert.equal(a.length, 2); assert.equal(a[0].context.parameters.value, 1);
  a[0].context.parameters.value = 3;
  assert.equal(getDiagnosticEntries({ sceneId: "a" })[0].context.parameters.value, 1);
  clearDiagnostics("a");
  assert.equal(getDiagnosticEntries({ sceneId: "a" }).length, 0);
  assert.equal(getDiagnosticEntries({ sceneId: "b" }).length, 1);
});

test("journal has a fixed capacity and observers cannot interrupt recording or survive unsubscribe", (t) => {
  fixture(t); let updates = 0;
  const stop = subscribeDiagnostics(() => { updates++; throw new Error("bad UI"); });
  for (let id = 0; id < DIAGNOSTIC_LIMIT + 20; id++) signalTrace("emitted", { deliveryId: id });
  const log = getDiagnosticEntries();
  assert.equal(log.length, DIAGNOSTIC_LIMIT); assert.equal(log[0].context.deliveryId, 20);
  assert.equal(updates, DIAGNOSTIC_LIMIT + 20); stop();
  clearDiagnostics(); assert.equal(updates, DIAGNOSTIC_LIMIT + 20);
});

test("players cannot collect or read the GM journal", (t) => {
  fixture(t, true); signalTrace("emitted", { secret: "GM" });
  game.user.isGM = false;
  signalTrace("emitted", { secret: "Player" }); debugError("runtime", "failed", new Error("Player error"));
  assert.deepEqual(getDiagnosticEntries({ includeDebug: true }), []);
  clearDiagnostics(); game.user.isGM = true;
  assert.equal(getDiagnosticEntries({ includeDebug: true }).length, 1);
});

test("diagnostic payloads have a joint size budget and failed context does not hide the original error", (t) => {
  fixture(t);
  const large = Object.fromEntries(Array.from({ length: 5000 }, (_, id) => [id, "x".repeat(20000)]));
  assert.ok(JSON.stringify(diagnosticSnapshot(large)).length < 18000);
  const circular = {}; circular.self = circular;
  assert.equal(diagnosticSnapshot(circular).self, "[Circular]");
  assert.equal(diagnosticSnapshot(new Date()), "[Non-plain object]");
  const named = diagnosticSnapshot(JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal(Object.hasOwn(named, "__proto__"), true); assert.equal({}.polluted, undefined);
  debugError("script", "failed", new Error("Actual failure"), () => { throw new Error("Bad context"); });
  assert.equal(getDiagnosticEntries()[0].error.message, "Actual failure");
  assert.equal(getDiagnosticEntries()[0].context.diagnosticContext, "[Unavailable]");
});

test("sparse arrays cannot inflate the journal or hide distinct long field names", (t) => {
  fixture(t);
  const sparse = []; sparse[0xFFFFFFFE] = "last";
  const array = diagnosticSnapshot(sparse);
  assert.equal(array.length, 101); assert.equal(array.at(-1), "[Truncated]");
  assert.ok(JSON.stringify(array).length < 600);
  const first = `${"k".repeat(250)}a`, second = `${"k".repeat(250)}b`;
  const object = diagnosticSnapshot({ [first]: 1, [second]: 2 });
  assert.equal(object[first], 1); assert.equal(object[second], 2);
  assert.deepEqual(diagnosticSnapshot({ ["k".repeat(20000)]: "unbounded key" }), {});
});

test("non-Error exceptions and failing error getters still produce readable records", (t) => {
  fixture(t);
  const error = { get message() { throw new Error("bad getter"); }, get stack() { throw new Error("bad stack"); } };
  assert.doesNotThrow(() => debugError("script", "failed", error));
  debugError("script", "failed", null); debugError("script", "failed", undefined);
  assert.deepEqual(getDiagnosticEntries().map(entry => entry.error.message), ["[Unavailable]", "null", "undefined"]);
});

test("incremental reads clone only new entries and retain an eviction cursor across filters and clears", (t) => {
  const f = fixture(t, true);
  signalTrace("emitted", { sceneId: "a", parameters: { value: 1 } });
  let update = getDiagnosticUpdate({ sceneId: "a" });
  const firstId = update.firstId;
  assert.equal(update.entries.length, 1);
  update.entries[0].context.parameters.value = 5;
  assert.equal(getDiagnosticUpdate({ sceneId: "a" }).entries[0].context.parameters.value, 1);
  const priorCursor = update.cursor;
  debugTrace("script", "hidden", { sceneId: "a" });
  signalTrace("emitted", { sceneId: "b" });
  update = getDiagnosticUpdate({ sceneId: "a", afterId: update.cursor });
  assert.equal(update.entries.length, 0);
  assert.ok(update.cursor > priorCursor, "hidden entries still advance the cursor");
  assert.equal(getDiagnosticUpdate({ sceneId: "a", includeDebug: true }).entries.length, 2);
  f.setDebug(false);
  for (let i = 0; i < DIAGNOSTIC_LIMIT; i++) signalTrace("emitted", { sceneId: "b" });
  update = getDiagnosticUpdate({ sceneId: "a", afterId: update.cursor });
  assert.equal(update.entries.length, 0);
  assert.ok(update.firstId > firstId, "another scene's traffic can expire visible rows");
  clearDiagnostics();
  update = getDiagnosticUpdate();
  assert.equal(update.entries.length, 0);
  assert.equal(update.firstId, update.cursor + 1);
  game.user.isGM = false;
  assert.deepEqual(getDiagnosticUpdate({ includeDebug: true }), { entries: [], cursor: 0, firstId: Infinity });
});
