import test from "node:test";
import assert from "node:assert/strict";
import { fixture as signalFixture } from "./signal-fixture.js";

class ApplicationStub {
  constructor(options) { this.options = options; this.rendered = true; }
  async _prepareContext() { return {}; }
  render() { return this; }
}
globalThis.foundry = { applications: { api: {
  ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: (base) => base,
  DialogV2: { confirm: async () => true }
} }, utils: { deepClone: structuredClone } };
const { MasterScreenApplication } = await import("../dmicher-master-screen/scripts/apps/ide.js");
const { WorkspacePresetStore } = await import("../dmicher-master-screen/scripts/workspace-presets-store.js");
const { SceneAssets } = await import("../dmicher-master-screen/scripts/scene-assets.js");
const { getShopInventory } = await import("../dmicher-master-screen/scripts/shop-inventory.js");

function appFor(scene = null) {
  return new MasterScreenApplication({
    getContext: () => ({ scene, isGM: true, definitions: [], definition: null, runtime: null }), changed() {}
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

test("shop form refresh preserves unrelated input and stale edited stock rejects the entire save", async () => {
  const f = signalFixture(), app = appFor(f.scene), assets = new SceneAssets(f.scene);
  f.data.interactionCatalog = { shops: [], dialogues: [] };
  await assets.saveShop({ id: "stock", name: "Stock", items: [{ id: "rope", stock: 5, data: { name: "Rope", type: "equipment" } }] });
  app.selectionSceneId = f.scene.id; app.layout.preferences.mainTab = "shops"; app.selection = { kind: "shop", id: "stock" };
  const writes = f.writes(); await app._prepareContext({});
  assert.equal(f.writes(), writes, "Viewing never initializes inventory");
  app.parameterDraft.name = "Unsaved name"; app.dirty = true;
  f.data.shopInventories = { stock: { items: [], revision: 1 } };
  await app._prepareContext({});
  assert.equal(app.parameterDraft.name, "Unsaved name"); assert.deepEqual(app.parameterDraft._inventory.items, []);
  app.parameterDraft._inventory.items = [{ id: "rope", stock: 8, data: { name: "Rope", type: "equipment" } }];
  f.data.shopInventories.stock.revision = 2;
  await app._prepareContext({});
  assert.equal(app.parameterDraft._inventory.conflicted, true);
  assert.equal(app.parameterDraft._inventory.items[0].stock, 8);
  await assert.rejects(app.saveParameters(), /current stock changed|изменились/);
  assert.equal(assets.getShop("stock").name, "Stock"); assert.equal(app.dirty, true);
  assert.deepEqual(getShopInventory(f.scene, "stock").items, []);
});

async function presetDraft() {
  const f = signalFixture(), app = appFor(f.scene);
  f.data.interactionCatalog = { shops: [], dialogues: [] };
  app.selectionSceneId = f.scene.id; app.layout.preferences.mainTab = "windows";
  app.controller.workspacePresets = { capture: (_scene, _kind, { name }) => ({ id: "layout", name, entries: [] }), activePreset: () => null };
  await app.workspacePresetAction("captureWorkspacePreset", { dataset: { presetKind: "windows" } });
  return { ...f, app, store: new WorkspacePresetStore(f.scene) };
}

test("capturing a workspace is a preserved IDE draft until explicit revision-checked save", async () => {
  const f = await presetDraft();
  assert.equal(f.writes(), 0); assert.equal(f.app.dirty, true); assert.equal(f.app.selection.kind, "windowPreset");
  f.app.parameterDraft.name = "Prepared layout";
  const view = await f.app._prepareContext({});
  assert.match(view.detailHTML, /Prepared layout/); assert.equal(f.app.parameterDraft.name, "Prepared layout");
  await f.app.saveParameters();
  assert.equal(f.store.find("windows", "layout").name, "Prepared layout"); assert.equal(f.app.dirty, false);
  await f.app._prepareContext({}); f.app.parameterDraft.name = "Stale layout"; f.app.dirty = true;
  await f.store.save("windows", { id: "other", name: "Other", entries: [] });
  await assert.rejects(f.app.saveParameters(), /another window|другим окном/);
  assert.equal(f.store.find("windows", "layout").name, "Prepared layout");
});

test("a pending preset deletion cannot remove the next selection or discard its draft", async () => {
  const f = await presetDraft(); await f.app.saveParameters(); await f.app._prepareContext({});
  const confirmation = deferred();
  foundry.applications = { api: { DialogV2: { confirm: () => confirmation.promise } } };
  const task = f.app.workspacePresetAction("deleteWorkspacePreset", { dataset: { presetKind: "windows" } });
  await new Promise(setImmediate);
  f.app.selection = { kind: "windowPreset", id: "newDraft" };
  f.app.parameterDraft = { id: "newDraft", name: "Unsaved next layout", entries: [] }; f.app.dirty = true;
  confirmation.resolve(true); await task;
  assert.ok(f.store.find("windows", "layout")); assert.equal(f.app.parameterDraft.id, "newDraft"); assert.equal(f.app.dirty, true);
});

test("an open IDE handles a vanished scene even when its remembered tab is macros", async () => {
  for (const tab of ["macros", "shops", "scene"]) {
    const app = appFor();
    app.layout.preferences.mainTab = tab;
    const view = await app._prepareContext({});
    assert.equal(view.missing, true);
    assert.equal(view.presentationIcon, "fa-up-right-from-square");
    assert.equal(app.selectedMacroOwner, undefined);
    assert.equal(view.nodeActions, undefined);
  }
});

async function macroSelection() {
  const f = signalFixture(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "Message" });
  f.macro("Macro.test", signal);
  globalThis.fromUuid = async (uuid) => f.macros.get(uuid);
  await f.catalog.attachMacro("Token:npc", "Macro.test");
  const app = appFor(f.scene);
  app.selectionSceneId = f.scene.id;
  app.selection = { kind: "macro", id: JSON.stringify(["Token:npc", "Macro.test"]) };
  app.parameterDraft = { ownerKey: "Token:npc", uuid: "Macro.test" };
  return { ...f, signal, app };
}

test("removing a macro while its confirmation is open reports disappearance without dereferencing a cleared draft", async () => {
  for (const language of ["ru", "en"]) {
    const f = await macroSelection(), confirmation = deferred();
    game.i18n = { lang: language };
    f.app.inlineChoice = () => confirmation.promise;
    const deletion = f.app.changeStructure("deleteSelected");
    await new Promise(setImmediate);
    await f.catalog.removeMacro("Token:npc", "Macro.test");
    f.app.parameterDraft = null;
    const writes = f.writes();
    confirmation.resolve("delete");
    await assert.rejects(deletion, (error) => {
      assert.equal(error.message, language === "en" ? "The selected entry no longer exists." : "Выбранный элемент больше не существует.");
      return true;
    });
    assert.equal(f.writes(), writes);
  }
});

test("a pending delete cannot remove a newly selected macro", async () => {
  const f = await macroSelection(), confirmation = deferred();
  f.macro("Macro.other", f.signal);
  await f.catalog.attachMacro("Token:npc", "Macro.other");
  f.app.inlineChoice = () => confirmation.promise;
  const deletion = f.app.changeStructure("deleteSelected");
  await new Promise(setImmediate);
  f.app.selection = { kind: "macro", id: JSON.stringify(["Token:npc", "Macro.other"]) };
  f.app.parameterDraft = { ownerKey: "Token:npc", uuid: "Macro.other" };
  const writes = f.writes();
  confirmation.resolve("delete");
  await assert.rejects(deletion);
  assert.equal(f.writes(), writes);
  assert.equal(f.catalog.list().macros.length, 2);
});

async function signalDraft() {
  const f = await macroSelection();
  f.app.selection = { kind: "signal", id: f.signal.id };
  f.app.parameterDraft = { ...structuredClone(f.signal), name: "Local draft" };
  f.app.parameterRevision = f.catalog.list().revision;
  f.app.dirty = true;
  f.app.subscriptionDraft = { ownerKey: "Token:npc", emitterKey: f.signal.emitterKey, signalId: f.signal.id, macroUuid: "Macro.test", enabled: true };
  f.app.captureParameterDraft = () => {};
  f.app.captureSubscription = () => {};
  f.app.readParameterDraft = () => structuredClone(f.app.parameterDraft);
  return f;
}

test("saving a subscription preserves a stale dirty signal's conflict instead of accepting its old fields", async () => {
  const f = await signalDraft(), originalRevision = f.app.parameterRevision;
  await f.catalog.saveSignal({ ...f.signal, description: "Changed in another window" });
  await f.app.signalAction("saveSignalSubscription", {});
  assert.equal(f.app.subscriptionValidation.valid, true);
  assert.equal(f.app.parameterRevision, originalRevision);
  assert.equal(f.catalog.list().subscriptions.length, 1);
  await assert.rejects(f.app.saveParameters());
  assert.equal(f.catalog.list().signals.find((entry) => entry.id === f.signal.id).description, "Changed in another window");
  assert.equal(f.app.parameterDraft.name, "Local draft");
});

test("an isolated subscription save advances a current signal baseline so its own dirty form remains saveable", async () => {
  const f = await signalDraft(), originalRevision = f.app.parameterRevision;
  await f.app.signalAction("saveSignalSubscription", {});
  assert.equal(f.app.parameterRevision, originalRevision + 1);
  await f.app.saveParameters();
  assert.equal(f.catalog.list().signals.find((entry) => entry.id === f.signal.id).name, "Local draft");
});

test("input arriving during a background render retains the displayed signal's original revision and fields", () => {
  const app = appFor();
  app.selectionSceneId = "scene";
  app.selection = { kind: "signal", id: "signal" };
  app.parameterDraft = { id: "signal", name: "Original", parameters: [{ name: "old" }] };
  app.parameterRevision = 3;
  app.captureRefreshDraft();
  app.parameterDraft = { id: "signal", name: "Remote", parameters: [{ name: "new" }] };
  app.parameterRevision = 4;
  app.dirty = true;
  app.stateDirty = true;
  app.captureParameterDraft = () => { app.parameterDraft.name = "Typed during refresh"; app.pendingTabInputs = [{ name: "signal-name", value: "Typed during refresh" }]; };
  app.captureSubscription = () => {};
  app.captureRefreshDraft();
  assert.equal(app.parameterRevision, 3);
  assert.equal(app.stateDirty, true);
  assert.deepEqual(app.parameterDraft.parameters, [{ name: "old" }]);
  assert.equal(app.parameterDraft.name, "Typed during refresh");
  assert.equal(app.pendingTabInputs[0].value, "Typed during refresh");
});

test("refreshing an already dirty IDE updates referenced names while retaining the signal draft and its baseline", async () => {
  const f = await signalDraft(), revision = f.app.parameterRevision;
  f.data.interactionCatalog = { shops: [], dialogues: [] };
  f.app.layout.preferences.mainTab = "signals";
  f.app.subscriptionDraft = null;
  f.scene.tokens.get("npc").name = "Renamed NPC";
  await f.catalog.saveSignal({ ...f.signal, description: "Remote description" });
  f.app.captureRefreshDraft();
  const view = await f.app._prepareContext({});
  assert.match(view.detailHTML, /Renamed NPC/);
  assert.match(view.detailHTML, /Local draft/);
  assert.equal(f.app.parameterDraft.description, f.signal.description);
  assert.equal(f.app.parameterRevision, revision);
  assert.equal(f.app.dirty, true);
});
