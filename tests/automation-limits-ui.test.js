import test from "node:test";
import assert from "node:assert/strict";
import { buildScriptFields, readScriptFields } from "../dmicher-master-screen/scripts/apps/script-fields.js";
import { renderObjectActionList } from "../dmicher-master-screen/scripts/apps/object-property-fields.js";
import { renderSubscriptions, renderSubscriptionFields } from "../dmicher-master-screen/scripts/apps/signal-fields.js";
import { normalizeScript } from "../dmicher-master-screen/scripts/script-model.js";
import { fixture as signalFixture } from "./signal-fixture.js";

globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } }, utils: { randomID: () => "new" } };
const { ScriptBlockEditor } = await import("../dmicher-master-screen/scripts/apps/script-block-editor.js");
const { ObjectAutomationApplication } = await import("../dmicher-master-screen/scripts/apps/object-tools.js");
const { mountSpotlightAutomationEditor } = await import("../dmicher-master-screen/scripts/apps/spotlight-automation-editor.js");
const { MasterScreenApplication } = await import("../dmicher-master-screen/scripts/apps/ide.js");
const script = count => normalizeScript({ name: "Prepared", steps: Array.from({ length: count }, (_, i) => ({ id: i + 1, kind: "wait", parameters: { seconds: 1 }, transition: { mode: "next" } })) });
const setup = () => { globalThis.game = { i18n: { lang: "en" }, modules: new Map(), macros: new Map() }; };

test("sixteen steps disable adding while a longer script keeps every row and warns that the entire launch is blocked", () => {
  setup();
  const full = buildScriptFields([script(16)], null, null, {});
  assert.match(full, /data-screen-action="add-script-step"[^>]* disabled/);
  const long = buildScriptFields([script(17)], null, null, {});
  assert.equal((long.match(/data-script-step=/g) ?? []).length, 17);
  assert.match(long, /data-automation-limit-issue="scriptSteps"/);
  assert.match(long, /data-script-step="16"[^>]*data-automation-limit-locked/);
  assert.match(long, /data-script-limit-fields disabled/);
  assert.doesNotMatch(long, /data-screen-action="remove-script-step"[^>]*data-step="16"[^>]* disabled/);
});

test("capturing a locked excess row retains its full prepared data instead of taking edited controls", () => {
  setup(); const original = script(17);
  const fields = { "script-0-name": "Renamed", "script-0-enabled": true };
  for (let i = 0; i < 17; i++) Object.assign(fields, { [`script-0-step-${i}-kind`]: "wait", [`script-0-step-${i}-parameters`]: '{"seconds":8}', [`script-0-step-${i}-next`]: "", [`script-0-step-${i}-transition-mode`]: "next" });
  const root = { querySelector: selector => { const name = /name="([^"]+)"/.exec(selector)?.[1]; return name in fields ? { value: fields[name], checked: fields[name] === true } : null; } };
  const saved = readScriptFields(root, [original])[0];
  assert.equal(saved.steps[0].parameters.seconds, 8);
  assert.deepEqual(saved.steps[16], original.steps[16]);
  assert.notEqual(saved.steps[16], original.steps[16]);
});

test("a repeated direct add cannot grow a full script or action draft", async () => {
  setup();
  const editor = new ScriptBlockEditor({ script: script(16), title: "Script", context: () => ({ catalog: {} }), save() {} });
  editor.render = async () => editor;
  await assert.rejects(editor.handleAction("add-script-step", { dataset: {} }), /16/);
  assert.equal(editor.script.steps.length, 16);
  const object = Object.create(ObjectAutomationApplication.prototype);
  object.draft = { actions: Array.from({ length: 4 }, (_, i) => ({ id: String(i), enabled: false })) };
  await assert.rejects(object.propertyAction("add-action", { dataset: {} }), /4/);
  assert.equal(object.draft.actions.length, 4);
});

test("action rows count disabled entries and lock only the saved fifth entry regardless of its menu order", () => {
  setup();
  const actions = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `Action ${i}`, enabled: i === 4, order: 4 - i }));
  const html = renderObjectActionList(actions);
  assert.match(html, /data-screen-action="add-action"[^>]* disabled/);
  assert.match(html, /data-automation-limit-locked="actions"[^>]*>[\s\S]*?Action 4/);
  assert.equal((html.match(/data-automation-limit-locked="actions"/g) ?? []).length, 1);
  assert.match(html, /data-screen-action="remove-action"[^>]*data-id="a4"/);
});

test("a filtered subscription list uses the owner's complete saved order, including disabled and self subscriptions", () => {
  setup();
  const subscriptions = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, ownerKey: "Token:npc", emitterKey: "Token:npc", signalId: "own", enabled: i === 8, handler: "script" }));
  const catalog = { subscriptions, signals: [], emitters: [], macros: [] };
  const macroForm = renderSubscriptionFields({ ...subscriptions[0], handler: "macro", macroUuid: "Macro.saved" }, catalog, { fixedOwner: "Token:npc" });
  assert.match(macroForm, /data-premium-subscription-macro disabled/);
  assert.match(macroForm, /value="macro"[^>]*disabled[^>]*>Registered macro · Premium/);
  assert.match(macroForm, /dmicher-premium-badge/);
  const html = renderSubscriptions([subscriptions[8]], catalog, { ownerKey: "Token:npc" });
  assert.match(html, /data-screen-action="newSignalSubscription"[^>]* disabled/);
  assert.match(html, /data-automation-limit-locked="subscriptions"/);
  assert.match(html, /9\s*\/\s*8/);
  assert.match(html, /data-screen-action="deleteSignalSubscription"[^>]*data-id="s8"/);
});

test("world subscriptions include disabled self events in the limit and preserve every imported row", () => {
  setup();
  const owner = { type: "requests", id: "requests" };
  const subscriptions = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, source: owner, event: "requests.submitted", enabled: i === 8, script: script(1) }));
  const host = { readBindings: () => ({ revision: 1, subscriptions, registeredMacroUuids: [] }), sources: () => [{ owner, events: ["requests.submitted"] }] };
  const root = { ownerDocument: { defaultView: { AbortController } }, innerHTML: "", querySelector: () => null, addEventListener() {} };
  const dispose = mountSpotlightAutomationEditor(root, { owner, host });
  assert.equal(dispose.model.draft.subscriptions.length, 9);
  assert.match(root.innerHTML, /data-world-action="add"[^>]* disabled/);
  assert.equal((root.innerHTML.match(/data-automation-limit-locked="subscriptions"/g) ?? []).length, 1);
  dispose();
});

test("a full first owner does not prevent opening a new signal subscription for another owner", async () => {
  const f = signalFixture(), firstOwner = f.catalog.list().emitters[0].key, signal = f.catalog.list().signals[0];
  for (let i = 0; i < 8; i++) await f.subscribe(signal, firstOwner);
  const app = Object.create(MasterScreenApplication.prototype);
  Object.assign(app, { mode: "constructor", selection: { kind: "signal", id: signal.id }, parameterDraft: { emitterKey: signal.emitterKey },
    captureParameterDraft() {}, captureSubscription() {}, assertScene: () => f.scene, render: async () => {} });
  const beforeWrites = f.writes();
  await app.signalAction("newSignalSubscription", { dataset: {} });
  assert.ok(app.subscriptionDraft);
  assert.equal(app.subscriptionDraft.signalId, signal.id);
  assert.equal(f.writes(), beforeWrites);
});
