import test from "node:test";
import assert from "node:assert/strict";

class ApplicationStub { async _onRender() {} }
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: (base) => base } },
  utils: { randomID: () => "generated" } };
const { ObjectBehaviorApplication } = await import("../dmicher-master-screen/scripts/apps/object-tools.js");
const { createGroupDefinition } = await import("../dmicher-master-screen/scripts/model.js");
const { registeredToolIds, toolRegistration } = await import("../dmicher-master-screen/scripts/object-binding-model.js");

function fixture({ grouped = true, dialogues = [], shops = [] } = {}) {
  const descriptor = { type: "Token", id: "npc" }, document = { id: "npc", documentName: "Token", name: "NPC" };
  const definition = createGroupDefinition(); definition.states[0].id = "calm"; definition.entryStateId = "calm";
  const binding = { ...descriptor, groupId: grouped ? "main" : null, initialScript: null, transitionScripts: {}, scripts: [], shops, dialogues };
  const flags = { objectBindings: { revision: 1, bindings: { "Token:npc": binding } }, groupDefinitions: { main: definition },
    interactionCatalog: { shops: [{ id: "shop", name: "Shop" }], dialogues: ["other", "one", "two"].map((id) => ({ id, name: `Dialogue ${id}`, pages: [{ id: "page", text: "Hello" }] })) } };
  const scene = { id: "scene", name: "Scene", tokens: new Map([[document.id, document]]), getFlag: (_module, key) => flags[key] };
  document.parent = scene;
  globalThis.game = { scenes: new Map([[scene.id, scene]]), i18n: { lang: "en" } };
  globalThis.canvas = { scene };
  const opened = [], app = new ObjectBehaviorApplication({ changed() {}, openAsset(...args) { opened.push(args); } }, descriptor);
  const fields = new Map();
  app.element = { querySelector: (selector) => fields.get(selector) ?? null, querySelectorAll: () => [] };
  app.render = async () => app;
  app.context(); app.renderedDraft = app.draft;
  return { app, flags, fields, opened };
}

const action = (app, command, dataset) => app.handleAction(command, { dataset });
const assignment = (id, state = "calm") => ({ dialogueId: id, stateIds: [state], range: 5, conditions: { repeat: "always" } });

test("Properties opens first without a group and keeps signals after the four resource sections", async () => {
  const { app } = fixture({ grouped: false });
  const { body } = await app._prepareContext();
  assert.equal(app.tab, "properties");
  const tabs = [...body.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["properties", "transitions", "player-actions", "commands", "routine"]);
  const sections = [...body.matchAll(/<h3>([^<]+)<\/h3>/g)].map((match) => match[1]);
  assert.deepEqual(sections, ["Shops", "Dialogues", "Object macros", "Subscriptions", "Object signals"]);
  assert.match(body, /name="register-dialogue"/);
});

test("registering a tool makes it available to scripts without enabling player actions", async () => {
  const { app, fields } = fixture();
  fields.set('[name="register-dialogue"]', { value: "one" });
  await action(app, "register-tool", { kind: "dialogue" });
  assert.deepEqual(registeredToolIds(app.draft, "dialogue"), ["one"]);
  assert.equal(app.draft.dialogues[0].playerAction, false);
  assert.equal(app.draft.dialogues[0].conditions.enabled, false);
  assert.deepEqual(app.scriptParameterContext().dialogueOptions.map((dialogue) => dialogue.id), ["one"]);
  assert.doesNotMatch(app.playerActionFields(app.context()), /data-screen-action="edit-feature"/);
  await action(app, "register-tool", { kind: "dialogue" });
  assert.equal(app.draft.dialogues.length, 1, "registration is idempotent");
});

test("player actions select only registered tools even when another dialogue is first in the scene", async () => {
  const { app } = fixture({ dialogues: [toolRegistration("dialogue", "one")] });
  app.tab = "player-actions";
  await action(app, "add-feature", { kind: "dialogue", stateId: "calm" });
  assert.equal(app.draft.dialogues.length, 1);
  assert.equal(app.activeFeature().dialogueId, "one");
  assert.equal(app.activeFeature().playerAction, true);
  const html = app.playerActionFields(app.context());
  assert.match(html, /value="one"/);
  assert.doesNotMatch(html, /value="other"|value="two"/);
});

test("an empty property list does not create a player action from the whole catalogue", async () => {
  const { app } = fixture();
  await action(app, "add-feature", { kind: "dialogue", stateId: "calm" });
  assert.deepEqual(app.draft.dialogues, []);
  assert.equal(app.dirty, false);
  assert.match(app.playerActionFields(app.context()), /First add a tool/);
});

test("removing the last player action retains registration for scripted use", async () => {
  const { app } = fixture({ dialogues: [assignment("one")] });
  await action(app, "remove-feature", { kind: "dialogue", index: "0" });
  assert.deepEqual(registeredToolIds(app.draft, "dialogue"), ["one"]);
  assert.equal(app.draft.dialogues[0].playerAction, false);
  assert.equal(app.draft.dialogues[0].conditions.enabled, false);
  assert.equal(app.selectedFeature, null);
});

test("unregistering removes all assignments of that tool and leaves unrelated tools", async () => {
  const { app } = fixture({ dialogues: [assignment("one"), assignment("one", "alarm"), assignment("two")] });
  const html = app.registrationFields(app.context().catalog);
  assert.equal([...html.matchAll(/data-screen-action="unregister-tool"[^>]+data-id="one"/g)].length, 1);
  await action(app, "unregister-tool", { kind: "dialogue", id: "one" });
  assert.deepEqual(registeredToolIds(app.draft, "dialogue"), ["two"]);
});

test("changing a player action retains the previous registration and does not shift old DOM row indexes", () => {
  const { app, fields } = fixture({ dialogues: [toolRegistration("dialogue", "two"), assignment("one"), assignment("two", "alarm")] });
  app.tab = "player-actions"; app.selectedFeature = { kind: "dialogue", index: 1 };
  fields.set('[name="feature-asset"]', { value: "two" });
  fields.set('[name="feature-range"]', { value: "8" });
  app.capture();
  assert.equal(app.draft.dialogues[2].stateIds[0], "alarm");
  assert.equal(app.activeFeature().dialogueId, "two");
  assert.deepEqual(new Set(registeredToolIds(app.draft, "dialogue")), new Set(["one", "two"]));
  assert.equal(app.draft.dialogues.find((entry) => entry.dialogueId === "one").playerAction, false);
});

test("a removed catalog choice cannot register or open a missing tool", async () => {
  const { app, fields, opened } = fixture();
  fields.set('[name="register-dialogue"]', { value: "missing" });
  await action(app, "register-tool", { kind: "dialogue" });
  await action(app, "open-registered-tool", { kind: "dialogue", id: "missing" });
  assert.deepEqual(app.draft.dialogues, []);
  assert.deepEqual(opened, []);
  assert.equal(app.dirty, false);
});

function scriptFile(name = "Imported") {
  return { size: 200, text: async () => JSON.stringify({ format: "dmicher-master-screen", version: 1, kind: "script",
    data: { stateId: "foreign", name, enabled: true, repeat: false, steps: [{ id: 1, kind: "wait", parameters: { seconds: 2 }, next: [] }] } }) };
}
function selectInitial(app) {
  game.user = { isGM: true };
  app.selectedScript = { kind: "initial" };
  app.draft.initialScript = { name: "Original", steps: [{ id: 1, kind: "wait", parameters: { seconds: 1 }, next: [] }] };
}

test("cancelled script import preserves unfinished raw input and the draft without world writes", async () => {
  const { app, fields, flags } = fixture(); selectInitial(app);
  const initial = app.activeScript(), world = structuredClone(flags);
  fields.set('[name="script-0-step-0-parameters"]', { value: "{unfinished" }); app.dirty = true;
  foundry.applications.api.DialogV2 = { confirm: async () => false };
  await app.createScriptTransfer().importFile(scriptFile());
  assert.equal(app.activeScript(), initial); assert.equal(app.dirty, true);
  assert.equal(fields.get('[name="script-0-step-0-parameters"]').value, "{unfinished");
  assert.deepEqual(flags, world);
});

test("accepted script import replaces only the selected draft and preserves the routine state slot", async () => {
  const { app, flags } = fixture(); game.user = { isGM: true };
  app.selectedScript = { kind: "routine", stateId: "calm" };
  app.draft.scripts = [{ name: "Original", stateId: "calm", steps: [] }];
  const other = app.draft.transitionScripts, world = structuredClone(flags), revision = app.revision;
  foundry.applications.api.DialogV2 = { confirm: async () => true };
  await app.createScriptTransfer().importFile(scriptFile());
  assert.equal(app.activeScript().name, "Imported"); assert.equal(app.activeScript().stateId, "calm");
  assert.equal(app.draft.transitionScripts, other); assert.equal(app.dirty, true); assert.equal(app.revision, revision);
  assert.deepEqual(flags, world);
});

test("a selection change during import confirmation cannot overwrite another block", async () => {
  const { app } = fixture(); selectInitial(app);
  const initial = app.activeScript();
  foundry.applications.api.DialogV2 = { confirm: async () => { app.selectedScript = null; return true; } };
  await assert.rejects(app.createScriptTransfer().importFile(scriptFile()), /script block changed/);
  assert.equal(app.draft.initialScript, initial); assert.equal(app.dirty, false);
});

test("script export uses valid unsaved form fields without replacing its draft", async () => {
  const { app, fields } = fixture(); selectInitial(app);
  const initial = app.activeScript(); app.dirty = true;
  for (const [name, field] of Object.entries({ name: { value: "Latest edit" }, enabled: { checked: true }, repeat: { checked: true },
    "step-0-kind": { value: "wait" }, "step-0-parameters": { value: '{"seconds":7.5}' }, "step-0-next": { value: "" } })) fields.set(`[name="script-0-${name}"]`, field);
  const anchor = { addEventListener() {}, click() {}, remove() {} };
  const document = { defaultView: { Blob, URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} }, setTimeout: (callback) => callback() },
    createElement: () => anchor, body: { append() {} } };
  const envelope = JSON.parse(await app.createScriptTransfer().export(document));
  assert.equal(envelope.data.name, "Latest edit"); assert.equal(envelope.data.steps[0].parameters.seconds, 7.5);
  assert.equal(envelope.data.repeat, true); assert.equal(app.activeScript(), initial); assert.equal(initial.name, "Original");
  assert.equal(app.dirty, true);
});
