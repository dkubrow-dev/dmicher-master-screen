import test from "node:test";
import assert from "node:assert/strict";
import { sampleGroupDefinition } from "./fixtures/definitions.js";

let renderedDialogue, confirmations = 0, accepted = false;
class Application {
  constructor() { this.rendered = true; }
  async _prepareContext() { return {}; }
  render() { this.renders = (this.renders ?? 0) + 1; return this; }
  close() { this.rendered = false; }
}
globalThis.foundry = { applications: {
  api: { ApplicationV2: Application, HandlebarsApplicationMixin: (base) => base, DialogV2: { confirm: async () => { confirmations++; return accepted; } } },
  handlebars: { renderTemplate: async (path, data) => { assert.match(path, /\/dialogue\.hbs$/); renderedDialogue = data; return "<section>Shared transcript</section>"; } }
} };
const { InteractionPreviewApplication } = await import("../dmicher-master-screen/scripts/apps/interaction-preview.js");

function fixture() {
  confirmations = 0; accepted = false;
  const dialogue = { id: "talk", name: "Local rehearsal", startPageId: "one", pages: [
    { id: "one", name: "First", text: "Hello", art: "left.webp", imageAlignment: "left", responses: [{ id: "next", label: "Continue", nextPageId: "two" }] },
    { id: "two", name: "Last", text: "Goodbye", art: "right.webp", imageAlignment: "right", responses: [{ id: "end", label: "Accepted", signalId: "alert" }] }
  ] };
  const actor = { id: "actor", name: "Hero", img: "portrait.webp", items: new Map() };
  const npc = { id: "npc", documentName: "Token", name: "Keeper", texture: { src: "keeper.webp" } };
  const pc = { id: "pc", documentName: "Token", name: "Traveller", actor };
  const flags = { groupDefinitions: { main: sampleGroupDefinition() }, objectBindings: { schemaVersion: 1, revision: 0, bindings: {
    "Token:npc": { type: "Token", id: "npc", groupId: "main", dialogues: [{ dialogueId: "talk", stateIds: ["calm"], range: 5,
      conditions: { enabled: true, repeat: "always" } }] }
  } }, interactionCatalog: { schemaVersion: 1, revision: 0, shops: [], dialogues: [dialogue] } };
  const scene = { id: "scene", tokens: new Map([["npc", npc], ["pc", pc]]), tiles: new Map(), getFlag: (_scope, key) => structuredClone(flags[key]),
    setFlag: () => assert.fail("preview must not write scene data") };
  globalThis.game = { user: { id: "gm", isGM: true, name: "GM" }, i18n: { lang: "en" }, settings: { get: () => "dark" } };
  globalThis.Hooks = { callAll: () => assert.fail("preview must not emit signals") };
  const app = new InteractionPreviewApplication({ getContext: () => ({ scene }) }, { kind: "dialogue", assetId: dialogue.id, draft: dialogue });
  app.conditions = { groupId: "main", stateId: "calm", target: "Token:npc", actorTokenId: "pc", tags: "", distance: 0, visible: true,
    enabled: true, used: 0, halted: false, showBlocked: false };
  app.currentAsset = dialogue; app.allowed = true;
  return { app, dialogue, scene, flags };
}

test("dialogue rehearsal uses the shared transcript with selected object and character portraits", async () => {
  const f = fixture(), before = structuredClone(f.flags);
  await f.app.renderDialogue(f.dialogue);
  assert.equal(renderedDialogue.preview, true); assert.equal(renderedDialogue.canFinish, true);
  assert.equal(renderedDialogue.messages[0].imageAlignment, "left");
  await f.app.handleAction("previewAnswer", { dataset: { responseId: "next" } });
  await f.app.renderDialogue(f.dialogue);
  assert.deepEqual(renderedDialogue.messages.map((entry) => entry.text), ["Hello", "Continue", "Goodbye"]);
  assert.deepEqual(renderedDialogue.messages.map((entry) => entry.imageAlignment), ["left", "right", "right"]);
  assert.equal(renderedDialogue.messages[1].name, "Traveller"); assert.equal(renderedDialogue.messages[1].img, "portrait.webp");
  await f.app.handleAction("previewAnswer", { dataset: { responseId: "end" } });
  await f.app.renderDialogue(f.dialogue);
  assert.equal(renderedDialogue.finished, true); assert.equal(renderedDialogue.messages.length, 4);
  assert.match(f.app.feedback, /alert/); assert.deepEqual(f.flags, before);
});

test("finish leaves rehearsal history visible and close requires confirmation only while unfinished", async () => {
  const f = fixture(); await f.app.renderDialogue(f.dialogue);
  await f.app.close(); assert.equal(confirmations, 1); assert.equal(f.app.rendered, true);
  await f.app.handleAction("previewFinish"); await f.app.renderDialogue(f.dialogue);
  assert.equal(renderedDialogue.finished, true); assert.equal(renderedDialogue.canFinish, false);
  assert.equal(renderedDialogue.messages[0].text, "Hello"); assert.equal(f.app.rendered, true);
  await f.app.handleAction("previewClose"); assert.equal(confirmations, 1); assert.equal(f.app.rendered, false);
});

test("changing simulated conditions clears only local history and still honours denied admission", async () => {
  const f = fixture(); await f.app._prepareContext({});
  assert.equal(f.app.allowed, true);
  await f.app.handleAction("previewAnswer", { dataset: { responseId: "next" } });
  f.app.readConditions = () => { f.app.conditions.enabled = false; };
  await f.app.handleAction("applyPreview");
  const denied = await f.app._prepareContext({});
  assert.equal(f.app.allowed, false); assert.equal(f.app.dialogueHistory.length, 0);
  assert.doesNotMatch(denied.html, /Shared transcript/);
  await f.app.handleAction("previewAnswer", { dataset: { responseId: "next" } });
  assert.equal(f.app.dialogueHistory.length, 0);
  f.app.conditions.showBlocked = true; await f.app._prepareContext({});
  assert.equal(f.app.allowed, true); assert.equal(renderedDialogue.messages.length, 1);
});
