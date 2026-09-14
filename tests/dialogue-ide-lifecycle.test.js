import test from "node:test";
import assert from "node:assert/strict";
import { sceneFixture, dialogueData } from "./fixtures/scene.js";

class ApplicationStub {
  constructor(options) { this.options = options; this.rendered = true; }
  async _prepareContext() { return {}; }
  render() { return this; }
}
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base } }, utils: { deepClone: structuredClone } };
const { MasterScreenApplication } = await import("../dmicher-master-screen/scripts/apps/ide.js");

async function editor() {
  const f = sceneFixture();
  const dialogue = await f.assets.saveDialogue({ ...dialogueData(), pages: [...dialogueData().pages, { id: "second", name: "Second", text: "Second text", responses: [] }] });
  const app = new MasterScreenApplication({ getContext: () => ({ scene: f.scene, isGM: true, definitions: [], definition: null, runtime: null }), changed() {} });
  app.layout.preferences.mainTab = "dialogues"; app.layout.preferences.detailTab = "parameters";
  app.selectionSceneId = f.scene.id; app.selection = { kind: "dialogue", id: dialogue.id };
  await app._prepareContext({});
  return { ...f, app, dialogue };
}

test("moving between a dialogue and its pages retains a shared dirty draft and baseline without confirmation", async () => {
  const f = await editor(), { app } = f, revision = app.parameterRevision;
  app.parameterDraft.name = "Unsaved name"; app.dirty = true;
  app.mayDiscard = async () => { throw new Error("Same dialogue must not ask to discard"); };
  app.pendingTabInputs = [{ name: "dialoguePageText", value: "Old page input" }];
  await app.selectNode("dialogue", f.dialogue.id, null, "second");
  let view = await app._prepareContext({});
  assert.equal(app.parameterDraft.name, "Unsaved name"); assert.equal(app.parameterRevision, revision);
  assert.equal(app.pendingTabInputs, null); assert.equal(app.selection.pageId, "second");
  assert.match(view.mainHTML, /Unsaved name/); assert.match(view.detailHTML, /Second text/);
  assert.doesNotMatch(view.detailHTML, /name="assetName"/);
  await app.selectNode("dialogue", f.dialogue.id);
  view = await app._prepareContext({});
  assert.equal(app.dirty, true); assert.equal(app.selection.pageId, null);
  assert.match(view.detailHTML, /name="assetName"/); assert.doesNotMatch(view.detailHTML, /name="dialoguePageText"/);
});

test("a disappeared page falls back to general settings and a dirty source retains conflict protection", async () => {
  const f = await editor(), { app } = f;
  app.selection.pageId = "second";
  await f.assets.saveDialogue({ ...f.dialogue, pages: [f.dialogue.pages[0]] });
  let view = await app._prepareContext({});
  assert.equal(app.selection.pageId, null); assert.match(view.detailHTML, /name="dialogueDisplayMode"/);
  const revision = app.parameterRevision;
  app.parameterDraft.name = "Local draft"; app.dirty = true;
  await f.assets.saveDialogue({ ...f.assets.getDialogue(f.dialogue.id), description: "Remote" });
  view = await app._prepareContext({});
  assert.match(view.detailHTML, /Local draft/); assert.equal(app.parameterRevision, revision);
  await assert.rejects(() => app.saveParameters());
});

test("page add, page deletion and preview affect the selected draft without writing the scene", async () => {
  const f = await editor(), { app } = f, writes = f.writes();
  await app.handleAction("addAssetPage", {}, {});
  const pageId = app.selection.pageId;
  assert.ok(pageId); assert.equal(app.parameterDraft.pages.length, 3);
  let preview;
  app.controller.previewAsset = (...args) => { preview = args; };
  await app.handleAction("previewAsset", {}, {});
  assert.equal(preview[2].pageId, pageId); assert.equal(preview[2].draft.pages.length, 3);
  await app.handleAction("deleteSelected", {}, {});
  assert.equal(app.selection.pageId, null); assert.equal(app.parameterDraft.pages.length, 2);
  assert.equal(f.writes(), writes); assert.equal(f.assets.getDialogue(f.dialogue.id).pages.length, 2);
});
