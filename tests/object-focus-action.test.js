import test from "node:test";
import assert from "node:assert/strict";

class ApplicationStub {}
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base } } };
const { ObjectAutomationApplication } = await import("../dmicher-master-screen/scripts/apps/object-tools.js");
const { ScreenController } = await import("../dmicher-master-screen/scripts/controller.js");

test("Object information places Go to object after Settings and preserves unsaved fields", async () => {
  for (const language of ["ru", "en"]) {
    globalThis.game = { i18n: { lang: language } };
    const calls = [], app = Object.create(ObjectAutomationApplication.prototype);
    app.tab="information";
    app.descriptor = { type: "Token", id: "npc" }; app.sceneId = "original-scene";
    app.draft = { groupId: null, tags: [], notes: "Unsaved note" }; app.dirty = true;
    app.context = () => ({ document: { id: "npc", name: "NPC", uuid: "Scene.original-scene.Token.npc" }, definitions: [] });
    app.controller = { focusObject: (...args) => { calls.push(args); return true; } };
    const { body } = await app._prepareContext();
    assert.ok(body.indexOf('data-screen-action="native-settings"') < body.indexOf('data-screen-action="focus-object"'));
    assert.match(body, language === "en" ? /Go to object/ : /К объекту/);
    await app.handleAction("focus-object");
    assert.deepEqual(calls, [[app.descriptor, { sceneId: "original-scene", explicit: true }]]);
    assert.equal(app.draft.notes, "Unsaved note"); assert.equal(app.dirty, true);
  }
});

test("an explicit GM focus works in Director, returns to its scene, and selects the native object", async () => {
  const calls = [], target = { type: "Token", id: "npc" };
  const doc = { id: "npc", x: 100, y: 150, width: 1, height: 1, documentName: "Token",
    object: { control: options => calls.push(["control", options]) } };
  const scene = { id: "original", grid: { size: 100 }, tokens: new Map([[doc.id, doc]]),
    async view() { calls.push(["view"]); canvas.scene = scene; } };
  doc.parent = scene;
  globalThis.canvas = { scene: { id: "another" }, stage: {}, tokens: {
    activate: options => calls.push(["layer", options]), releaseAll: () => calls.push(["release"])
  }, animatePan: point => calls.push(["pan", point]) };
  globalThis.ui = { controls: {} };
  globalThis.game = { user: { isGM: true }, scenes: new Map([[scene.id, scene]]) };
  const controller = Object.create(ScreenController.prototype); controller.mode = "director";
  assert.equal(await controller.focusObject(target, { sceneId: scene.id, explicit: true }), true);
  assert.equal(calls[0][0], "view"); assert.ok(calls.some(call => call[0] === "control"));
  assert.deepEqual(calls.find(call => call[0] === "pan")[1], { x: 150, y: 200, duration: 250 });
  const count = calls.length;
  assert.equal(await controller.focusObject(target), false, "ordinary Director row selection does not move the map");
  game.user.isGM = false;
  assert.equal(await controller.focusObject(target, { sceneId: scene.id, explicit: true }), false);
  assert.equal(calls.length, count);
});

test("a deleted object cannot switch scenes or write through a stale information window", async () => {
  globalThis.game = { user: { isGM: true }, scenes: new Map([["old", { id: "old", tokens: new Map(), view() { throw new Error("Unexpected scene change"); } }]]) };
  const controller = Object.create(ScreenController.prototype); controller.mode = "director";
  assert.equal(await controller.focusObject({ type: "Token", id: "deleted" }, { sceneId: "old", explicit: true }), false);
});
