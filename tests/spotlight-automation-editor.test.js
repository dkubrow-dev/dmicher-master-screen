import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base, DialogV2: {} } } };
const { createSpotlightEditorModel, mountSpotlightAutomationEditor, spotlightEventLabels } = await import("../dmicher-master-screen/scripts/apps/spotlight-automation-editor.js");
const owner = { type: "requests", id: "requests" };
function fixture() {
  const saved = [], state = { revision: 7, subscriptions: [{ id: "one", enabled: true, source: owner, event: "requests.submitted", script: { name: "Wait", steps: [{ id: 1, kind: "wait", parameters: { seconds: 1 } }] } }], registeredMacroUuids: ["Macro.registered"] };
  const host = { readBindings: () => structuredClone(state), async saveBindings(owner, value, options) { saved.push({ owner, value, options }); return { ...value, revision: 8 }; }, sources: () => [{ owner, events: ["requests.submitted"] }] };
  let listener, unsubscribeCount = 0;
  const bridge = { host, refresh() {}, status: () => ({ active: 0, paused: false }), subscribe(callback) { listener = callback; return () => { unsubscribeCount++; }; } };
  globalThis.game = { i18n: { lang: "en" }, macros: new Map() };
  return { host, bridge, saved, state, get unsubscribeCount() { return unsubscribeCount; }, get listener() { return listener; } };
}
test("world editor captures one revision and preserves explicitly registered macros", async () => {
  const f = fixture(), model = createSpotlightEditorModel({ owner, ...f });
  assert.equal(f.saved.length, 0);
  model.draft.subscriptions[0].script.name = "Edited"; model.dirty = true;
  assert.equal(f.state.subscriptions[0].script.name, "Wait");
  await model.save();
  assert.equal(f.saved[0].options.expectedRevision, 7);
  assert.deepEqual(f.saved[0].value.registeredMacroUuids, ["Macro.registered"]);
  assert.equal(model.draft.revision, 8); assert.equal(model.dirty, false);
});
test("a conflicting world save preserves the exact dirty draft and original revision", async () => {
  const f = fixture(), model = createSpotlightEditorModel({ owner, ...f });
  f.host.saveBindings = async () => { throw new Error("revision conflict"); };
  model.dirty = true;
  await assert.rejects(model.save(), /conflict/);
  assert.equal(model.draft.revision, 7); assert.equal(model.dirty, true);
});
test("world JSON cannot introduce a scene-only action", async () => {
  const f = fixture(), model = createSpotlightEditorModel({ owner, ...f });
  model.draft.subscriptions[0].script.steps[0] = { id: 1, kind: "move", parameters: { duration: 1 } };
  await assert.rejects(model.save()); assert.equal(f.saved.length, 0);
});
test("mount/dispose is read-only, localized, escapes author text and frees handlers", () => {
  for (const language of ["ru", "en"]) {
    const f = fixture(); game.i18n.lang = language;
    f.state.subscriptions[0].script.name = '<img src=x onerror="attack()">';
    const root = { ownerDocument: { defaultView: { AbortController } }, innerHTML: "", listeners: [],
      querySelector: () => null, addEventListener(name, callback, options) { this.listeners.push({ name, callback, options }); } };
    const release = mountSpotlightAutomationEditor(root, { owner, host: f.host, bridge: f.bridge });
    assert.equal(f.saved.length, 0);
    assert.match(root.innerHTML, /&lt;img/);
    assert.doesNotMatch(root.innerHTML, /<img/);
    assert.match(root.innerHTML, /data-world-action="stop"/);
    assert.match(root.innerHTML, language === "ru" ? /Подписки действуют/ : /Subscriptions operate/);
    release(); assert.equal(f.unsubscribeCount, 1);
    assert.equal(root.listeners.every(listener => listener.options.signal.aborted), true);
  }
});
test("subscription editor reuses the shared ScriptBlockEditor and its macro catalog", () => {
  const source = readFileSync(new URL("../dmicher-master-screen/scripts/apps/spotlight-automation-editor.js", import.meta.url), "utf8");
  assert.match(source, /new ScriptBlockEditor/);
  assert.match(source, /onCreateMacro/);
  assert.match(source, /registeredMacroUuids/);
  assert.doesNotMatch(source, /new ObjectScriptRuntime/);
});

test("event labels localize presentation while IDs survive save and missing metadata falls back", async () => {
  for (const language of ["ru", "en"]) {
    const f = fixture(); game.i18n.lang = language;
    const source = { owner, label: { ru: "Заявки", en: "Requests" }, events: ["requests.submitted"],
      eventLabels: { "requests.submitted": { ru: "Заявка подана", en: "Request submitted" } } };
    f.host.sources = () => [source];
    const expected = language === "ru" ? { source: "Заявки", event: "Заявка подана" } : { source: "Requests", event: "Request submitted" };
    assert.deepEqual(spotlightEventLabels(source, owner, "requests.submitted"), expected);
    assert.deepEqual(spotlightEventLabels(undefined, owner, "requests.submitted"), { source: "requests:requests", event: "requests.submitted" });
    assert.deepEqual(spotlightEventLabels({ label: "Named template", eventLabels: {} }, owner, "unknown"), { source: "Named template", event: "unknown" });
    const root = { ownerDocument: { defaultView: { AbortController } }, innerHTML: "", querySelector: () => null, addEventListener() {} };
    const release = mountSpotlightAutomationEditor(root, { owner, host: f.host, bridge: f.bridge });
    assert.ok(root.innerHTML.includes(`>${expected.source}<br>${expected.event}</td>`));
    assert.ok(root.innerHTML.includes('title="requests:requests / requests.submitted"'));
    await release.model.save();
    assert.equal(f.saved[0].value.subscriptions[0].event, "requests.submitted");
    assert.deepEqual(f.saved[0].value.subscriptions[0].source, owner);
    release();
  }
});
