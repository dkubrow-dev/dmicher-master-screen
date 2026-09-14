import test from "node:test";
import assert from "node:assert/strict";

class ApplicationStub { async _onRender() {} }
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: (base) => base } },
  utils: { randomID: () => "generated" } };
const { ObjectBehaviorApplication } = await import("../dmicher-master-screen/scripts/apps/object-tools.js");
const { createGroupDefinition } = await import("../dmicher-master-screen/scripts/model.js");
const { SceneObjects } = await import("../dmicher-master-screen/scripts/scene-objects.js");
const { defaultObjectCommand } = await import("../dmicher-master-screen/scripts/object-command-model.js");
const ObjectForm = Object.getPrototypeOf(ObjectBehaviorApplication.prototype);

function root(fields = []) {
  const element = new EventTarget();
  element.ownerDocument = { defaultView: { AbortController } };
  element.querySelector = () => null;
  element.querySelectorAll = (selector) => ["input,select,textarea", "input,select,textarea,button"].includes(selector) ? fields : [];
  return element;
}

function fixture() {
  const target = { type: "Token", id: "npc" }, document = { id: "npc", documentName: "Token", name: "NPC" };
  const definition = createGroupDefinition(); definition.states[0].id = "calm"; definition.entryStateId = "calm";
  const initialScript = { name: "Initial", enabled: true, repeat: false, steps: [] };
  const binding = { ...target, groupId: "main", initialScript, transitionScripts: { calm: { ...initialScript, name: "Calm" } }, scripts: [], shops: [],
    dialogues: [{ dialogueId: "one", stateIds: ["calm"] }, { dialogueId: "two", stateIds: ["calm"] }] };
  const flags = { objectBindings: { revision: 1, bindings: { "Token:npc": binding } }, groupDefinitions: { main: definition } };
  const scene = { id: "scene", tokens: new Map([[document.id, document]]), getFlag: (_module, key) => flags[key] };
  document.parent = scene;
  globalThis.game = { scenes: new Map([[scene.id, scene]]), i18n: { lang: "en" } };
  globalThis.canvas = { scene };
  const app = new ObjectBehaviorApplication({ changed() {}, openAsset() { throw new Error("Unexpected catalog open"); } }, target);
  app.rendered = true; app.element = root(); app.context();
  app.renderedDraft = app.draft;
  return { app, flags, scene };
}

test("command script selection survives unrelated group edits and clears after its command is deleted", () => {
  const { app, flags } = fixture();
  const command = defaultObjectCommand("come");
  command.beforeScript = { name: "Before", steps: [] };
  flags.objectBindings.bindings[app.ownerKey].commands = [command];
  app.reloadRequested = true; app.context({ reload: true });
  app.tab = "commands"; app.selectedCommand = "come";
  app.selectedScript = { kind: "command", commandId: "come", phase: "beforeScript" };
  assert.equal(app.activeScript().name, "Before");
  flags.objectBindings.bindings[app.ownerKey].groupId = null;
  app.reloadRequested = true; app.context({ reload: true });
  assert.equal(app.activeCommand().id, "come"); assert.equal(app.activeScript().name, "Before");
  flags.objectBindings.bindings[app.ownerKey].commands = [];
  app.reloadRequested = true; app.context({ reload: true });
  assert.equal(app.selectedCommand, null); assert.equal(app.selectedScript, null);
});

test("runtime updates do not replace authoring controls or their selected draft", async () => {
  const { app, scene, flags } = fixture();
  app.context({ reload: true }); const draft = app.draft;
  let renders = 0; app.render = async () => { renders++; app.context({ reload: true }); };
  for (let tick = 0; tick < 100; tick++) {
    flags.groupRuntimes = { main: { stateId: "calm", scriptStates: { step: { remainingMs: tick, emojiAt: tick } } } };
    flags.dialogueSessions = { changedAt: tick };
    await app.refreshFromScene(scene);
  }
  assert.equal(renders, 0); assert.equal(app.draft, draft);
  app.capture = () => {};
  await app.handleAction("tab", { dataset: { tab: "routine" } });
  assert.equal(app.tab, "routine"); assert.equal(renders, 1);
});

test("preparation and reference updates still refresh dirty forms without promoting their revision", async () => {
  const { app, scene, flags } = fixture();
  app.context({ reload: true }); app.dirty = true; app.capture = () => {};
  let renders = 0; app.render = async () => { renders++; app.context({ reload: true }); };
  flags.objectBindings.revision++;
  await app.refreshFromScene(scene);
  assert.equal(renders, 1); assert.equal(app.revision, 1); assert.equal(app.dirty, true);
  flags.interactionCatalog = { revision: 1, shops: [], dialogues: [] };
  await app.refreshFromScene(scene); assert.equal(renders, 2);
  scene.tokens.get("npc").name = "Renamed";
  await app.refreshFromScene(scene); assert.equal(renders, 3);
  await app.refreshFromScene(scene); assert.equal(renders, 3);
  scene.tokens.set("other", { id: "other", name: "Other NPC", documentName: "Token", parent: scene });
  await app.refreshFromScene(scene); assert.equal(renders, 4);
  scene.tokens.get("other").name = "Another name";
  await app.refreshFromScene(scene); assert.equal(renders, 5);
  scene.tokens.delete("other");
  await app.refreshFromScene(scene); assert.equal(renders, 6);
});

test("repeated runtime notifications do not perpetually extend an authoring refresh", async () => {
  const { app, scene, flags } = fixture(); app.context({ reload: true });
  let release, renders = 0;
  app.render = async () => { renders++; app.context({ reload: true }); await new Promise(resolve => { release = resolve; }); };
  flags.objectBindings.revision++;
  const task = app.refreshFromScene(scene); await Promise.resolve();
  for (let tick = 0; tick < 20; tick++) app.refreshFromScene(scene);
  release(); await task;
  assert.equal(renders, 1); assert.equal(app.refreshTask, null);
});

test("queued refresh never removes the live initial or transition script", async () => {
  const { app } = fixture(), before = app.draft;
  let release; app.render = async () => { await new Promise((resolve) => { release = resolve; }); app.context({ reload: true }); };
  app.selectedScript = { kind: "initial" };
  const pending = app.refresh(); assert.equal(app.activeScript(), before.initialScript);
  app.selectedScript = { kind: "transition", stateId: "calm" };
  assert.equal(app.activeScript(), before.transitionScripts.calm);
  await Promise.resolve(); assert.equal(app.draft, before);
  release(); await pending; assert.notEqual(app.draft, before);
  assert.equal(app.activeScript().name, "Calm");
});

test("dirty input before refresh preparation keeps the original revision and draft", async () => {
  const { app, flags } = fixture(), before = app.draft;
  flags.objectBindings.revision = 2; app.bindEvents();
  let renders = 0; app.render = async () => { renders++; app.context({ reload: true }); };
  const pending = app.refresh(); app.element.dispatchEvent(new Event("input"));
  await pending; app.context({ reload: true });
  assert.equal(app.draft, before); assert.equal(app.revision, 1); assert.equal(renders, 1);
});

test("late input restores raw unfinished fields and the revision of their visible form", async () => {
  const { app, flags } = fixture(), before = app.draft, original = app.original;
  const json = { name: "script-json", type: "textarea", value: "{unfinished", checked: false };
  app.element = root([json]); app.bindEvents();
  app.capture = () => { throw new Error("JSON is not complete yet"); };
  let release, replacement;
  flags.objectBindings.revision = 2;
  app.render = async () => {
    app.context({ reload: true });
    await new Promise((resolve) => { release = resolve; });
    replacement = { ...json, value: "{}" }; app.element = root([replacement]);
    await ObjectForm._onRender.call(app, {}, {});
  };
  const pending = app.refresh(); await Promise.resolve();
  assert.equal(app.revision, 2);
  app.element.dispatchEvent(new Event("input")); release(); await pending;
  assert.equal(app.draft, before); assert.equal(app.original, original); assert.equal(app.revision, 1);
  assert.equal(app.dirty, true); assert.equal(replacement.value, "{unfinished");
});

test("refresh follows a feature by its asset rather than a shifted list index", () => {
  const { app, flags } = fixture(); app.selectedFeature = { kind: "dialogue", index: 1 };
  flags.objectBindings.bindings[app.ownerKey].dialogues.shift();
  app.reloadRequested = true; app.context({ reload: true });
  assert.deepEqual(app.selectedFeature, { kind: "dialogue", index: 0 });
  assert.equal(app.activeFeature().dialogueId, "two");
  flags.objectBindings.bindings[app.ownerKey].dialogues = [];
  app.reloadRequested = true; app.context({ reload: true });
  assert.equal(app.selectedFeature, null);
});

test("feature selection distinguishes the same dialogue assigned to different states", () => {
  const { app, flags } = fixture(), binding = flags.objectBindings.bindings[app.ownerKey];
  binding.dialogues = [{ dialogueId: "one", stateIds: ["calm"] }, { dialogueId: "one", stateIds: ["alarm"] }];
  app.reloadRequested = true; app.context({ reload: true }); app.selectedFeature = { kind: "dialogue", index: 1 };
  binding.dialogues.reverse();
  app.reloadRequested = true; app.context({ reload: true });
  assert.deepEqual(app.selectedFeature, { kind: "dialogue", index: 0 });
  assert.deepEqual(app.activeFeature().stateIds, ["alarm"]);
});

test("refresh retains expanded JSON, folded parameter groups and the editing caret", async () => {
  const { app } = fixture();
  const oldEditor = { name: "script-json", type: "textarea", value: "{broken", checked: false, hidden: false, selectionStart: 3, selectionEnd: 5 };
  app.element = root([oldEditor]); app.element.ownerDocument.activeElement = oldEditor;
  app.element.contains = (element) => element === oldEditor;
  const readOld = app.element.querySelectorAll;
  app.element.querySelectorAll = (selector) => selector === "details" ? [{ open: false }, { open: true }] : selector === "[data-script-json-value]" ? [oldEditor] : readOld(selector);
  app.dirty = true; app.capture = () => {}; app.captureRefreshDraft();
  let focused = false, selection;
  const currentEditor = { ...oldEditor, hidden: true, focus() { focused = true; }, setSelectionRange(...range) { selection = range; } }, details = [{ open: true }, { open: false }];
  app.element = root([currentEditor]);
  const readCurrent = app.element.querySelectorAll;
  app.element.querySelectorAll = (selector) => selector === "details" ? details : readCurrent(selector);
  await ObjectForm._onRender.call(app, {}, {});
  assert.equal(currentEditor.hidden, false); assert.equal(focused, true); assert.deepEqual(selection, [3, 5]);
  assert.deepEqual(details.map((detail) => detail.open), [false, true]);
});

test("stale feature and state controls do not resurrect removed preparation", async () => {
  const { app, flags } = fixture();
  flags.objectBindings.bindings[app.ownerKey].dialogues = [];
  flags.objectBindings.bindings[app.ownerKey].transitionScripts = {};
  flags.groupDefinitions = {};
  app.reloadRequested = true; app.context({ reload: true }); app.renderedDraft = app.draft;
  let renders = 0; app.render = async () => { renders++; };
  app.selectedFeature = { kind: "dialogue", index: 0 };
  await app.handleAction("open-asset", { dataset: {} });
  await app.handleAction("edit-script", { dataset: { kind: "transition", stateId: "calm" } });
  assert.equal(renders, 2); assert.equal(app.selectedFeature, null); assert.equal(app.selectedScript, null);
  assert.deepEqual(app.draft.dialogues, []); assert.deepEqual(app.draft.transitionScripts, {});
  assert.equal(app.dirty, false);
});

test("an old DOM action cannot remove a newly loaded feature occupying the same index", async () => {
  const { app, flags } = fixture(), visible = app.draft;
  flags.objectBindings.bindings[app.ownerKey].dialogues.shift();
  app.reloadRequested = true; app.context({ reload: true });
  assert.notEqual(app.draft, visible);
  let renders = 0; app.render = async () => { renders++; };
  await app.handleAction("remove-feature", { dataset: { kind: "dialogue", index: "0" } });
  assert.equal(renders, 1); assert.equal(app.draft.dialogues[0].dialogueId, "two");
  assert.equal(app.dirty, false);
});

test("refresh preserves unnamed parameter input, custom validity and focus by its step identity", async () => {
  const { app } = fixture();
  const parameter = (id, value, error = "") => {
    const step = { dataset: { stepId: id }, closest: () => ({ dataset: { scriptIndex: "0" } }) };
    return { name: "", type: "number", dataset: { scriptParam: '["seconds"]' }, value, checked: false,
      validity: { customError: !!error }, validationMessage: error, closest: () => step };
  };
  const first = parameter("7", "", "Enter a number"), second = parameter("9", "5");
  app.element = root([first, second]); app.element.ownerDocument.activeElement = first;
  app.element.contains = (element) => element === first;
  app.dirty = true; app.capture = () => { throw new Error("Invalid number"); }; app.captureRefreshDraft();
  let error, focused = false;
  const replacement = { ...parameter("7", "3"), focus() { focused = true; }, setCustomValidity(message) { error = message; } };
  const other = parameter("9", "10");
  app.element = root([other, replacement]);
  await ObjectForm._onRender.call(app, {}, {});
  assert.equal(replacement.value, ""); assert.equal(error, "Enter a number"); assert.equal(focused, true);
  assert.equal(other.value, "5", "another step with the same parameter has its own value");
});

test("an in-flight save locks edits, coalesces duplicate saves and restores disabled states", async () => {
  const { app, flags } = fixture(), previousSave = SceneObjects.prototype.save;
  const editable = { name: "notes", type: "textarea", value: "Saved", disabled: false }, unavailable = { name: "unused", type: "text", disabled: true };
  app.element = root([editable, unavailable]); app.draft.notes = "Saved"; app.dirty = true;
  let release, writes = 0, renders = 0;
  SceneObjects.prototype.save = async (_target, patch) => {
    writes++; await new Promise((resolve) => { release = resolve; });
    Object.assign(flags.objectBindings.bindings[app.ownerKey], patch); flags.objectBindings.revision++;
  };
  app.render = async () => { renders++; app.context({ reload: true }); await ObjectForm._onRender.call(app, {}, {}); };
  try {
    const pending = app.persist();
    assert.equal(editable.disabled, true); assert.equal(unavailable.disabled, true);
    assert.equal(app.persist(), pending);
    await Promise.resolve(); assert.equal(writes, 1);
    assert.equal(app.refresh(), undefined); assert.equal(renders, 0);
    release(); await pending;
    assert.equal(writes, 1); assert.equal(renders, 1); assert.equal(flags.objectBindings.bindings[app.ownerKey].notes, "Saved");
    assert.equal(editable.disabled, false); assert.equal(unavailable.disabled, true); assert.equal(app.persistTask, null);
  } finally { SceneObjects.prototype.save = previousSave; }
});

test("a rejected save unlocks the form and preserves its dirty draft for correction", async () => {
  const { app } = fixture(), previousSave = SceneObjects.prototype.save, before = app.draft;
  const editable = { name: "notes", type: "textarea", disabled: false };
  app.element = root([editable]); app.draft.notes = "Uncommitted"; app.dirty = true;
  SceneObjects.prototype.save = async () => { throw new Error("Revision changed"); };
  try {
    await assert.rejects(app.persist(), /Revision changed/);
    assert.equal(editable.disabled, false); assert.equal(app.persistTask, null);
    assert.equal(app.draft, before); assert.equal(app.dirty, true); assert.equal(app.revision, 1);
  } finally { SceneObjects.prototype.save = previousSave; }
});

test("script warnings combine in one confirmation; cancelling keeps the full draft and prevents restoration", async () => {
  const { app } = fixture(), previousSave = SceneObjects.prototype.save, api = foundry.applications.api, previousDialog = api.DialogV2;
  const editable = { name: "script", type: "textarea", disabled: false };
  app.element = root([editable]); app.dirty = true; app.capture = () => {};
  app.draft.initialScript = { name: "<Instant>", repeat: true, steps: [{ id: 1, kind: "emotion", parameters: {}, next: [] }] };
  app.draft.transitionScripts.calm = { name: "State entry", steps: [{ id: 1, kind: "speech", parameters: {}, next: [] }] };
  const draft = app.draft, snapshot = structuredClone(draft); let prompts = 0, writes = 0, restores = 0, closed = 0;
  api.DialogV2 = { async confirm({ content }) {
    prompts++; assert.ok(content.includes("Duration is not set")); assert.ok(content.includes("infinite step cycle"));
    assert.ok(content.includes("Zero-delay cycle (0 sec.)"));
    assert.ok(content.indexOf("Zero-delay cycle") < content.indexOf("Duration is not set"));
    assert.ok(content.includes("&lt;Instant&gt;") && !content.includes("<Instant>")); assert.ok(content.includes("State entry")); return false;
  } };
  SceneObjects.prototype.save = async () => { writes++; };
  app.controller.restoreObjectInitial = () => { restores++; }; app.close = async () => { closed++; };
  try {
    assert.equal(await app.persist({ close: true }), false);
    assert.equal(prompts, 1); assert.equal(writes, 0); assert.equal(closed, 0); assert.equal(editable.disabled, false);
    assert.equal(app.draft, draft); assert.deepEqual(app.draft, snapshot); assert.equal(app.dirty, true); assert.equal(app.revision, 1);
    await app.handleAction("restore-initial", { dataset: {} });
    assert.equal(restores, 0); assert.equal(writes, 0); assert.equal(prompts, 2);
  } finally { SceneObjects.prototype.save = previousSave; api.DialogV2 = previousDialog; }
});

test("zero-delay cycle confirmation identifies the steps and keeps saving available in both languages", async () => {
  const api = foundry.applications.api, previousDialog = api.DialogV2;
  try {
    for (const [lang, label, allowed] of [["ru", "Цикл без задержек (0 с)", "Такая настройка допустима"], ["en", "Zero-delay cycle (0 sec.)", "This configuration is allowed"]]) {
      const { app } = fixture(); game.i18n.lang = lang;
      app.draft.initialScript = { name: "Parallel", repeat: true, steps: [
        { id: 1, kind: "emotion", parameters: { duration: 10, executionMode: "parallel" }, next: [4] },
        { id: 4, kind: "speech", parameters: { duration: 20, executionMode: "parallel" }, next: [] }
      ] };
      let prompted = false;
      api.DialogV2 = { async confirm({ content }) { prompted = true; assert.ok(content.includes(label)); assert.ok(content.includes("1 → 4 → 1")); assert.ok(content.includes(allowed)); return false; } };
      assert.equal(await app.persist(), false); assert.equal(prompted, true);
    }
  } finally { api.DialogV2 = previousDialog; }
});

test("confirmed instant scripts save normally and unchanged blocks are not confirmed again", async () => {
  const { app, flags } = fixture(), previousSave = SceneObjects.prototype.save, api = foundry.applications.api, previousDialog = api.DialogV2;
  app.draft.initialScript = { name: "Instant", repeat: true, steps: [{ id: 1, kind: "emotion", parameters: {}, next: [] }] };
  app.dirty = true; let prompts = 0, writes = 0;
  api.DialogV2 = { async confirm() { prompts++; return true; } };
  SceneObjects.prototype.save = async (_target, patch) => {
    writes++; Object.assign(flags.objectBindings.bindings[app.ownerKey], patch); flags.objectBindings.revision++;
  };
  app.render = async () => { app.context({ reload: true }); await ObjectForm._onRender.call(app, {}, {}); };
  try {
    assert.equal(await app.persist(), true); assert.equal(prompts, 1); assert.equal(writes, 1); assert.equal(app.dirty, false);
    assert.equal(await app.persist(), true); assert.equal(prompts, 1); assert.equal(writes, 1);
    app.draft.notes = "New note"; app.dirty = true;
    await app.persist(); assert.equal(prompts, 1); assert.equal(writes, 2);
    app.draft.initialScript.steps[0].parameters.emoji = "!"; app.dirty = true;
    await app.persist(); assert.equal(prompts, 2); assert.equal(writes, 3);
  } finally { SceneObjects.prototype.save = previousSave; api.DialogV2 = previousDialog; }
});
