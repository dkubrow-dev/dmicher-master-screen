import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { SCENE_OBJECT_COLLECTIONS } from "../dmicher-master-screen/scripts/scene-object-types.js";

class ApplicationStub { constructor(options) { this.options = options; } async _prepareContext() { return {}; } }
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: (base) => base } } };
const { InteractionApplication } = await import("../dmicher-master-screen/scripts/apps/interaction-window.js");

function fixture() {
  const runtime = { ...emptyRuntime("hall"), runId: "run", stateId: "open" };
  const scene = { id: "map", getFlag: (scope, key) => scope === MODULE_ID && key === "groupRuntimes" ? { hall: runtime } : undefined };
  for (const collection of Object.values(SCENE_OBJECT_COLLECTIONS)) scene[collection] = new Map();
  globalThis.game = { scenes: new Map([[scene.id, scene]]), user: { isGM: true }, i18n: { lang: "en" } };
  globalThis.canvas = { scene };
  const calls = [], controller = { getPlayerTokens: () => [], openShop: (...args) => calls.push(args) };
  return { scene, runtime, controller, calls };
}

test("interaction window resolves every supported native scene object", async () => {
  for (const [type, collection] of Object.entries(SCENE_OBJECT_COLLECTIONS)) {
    const f = fixture();
    f.scene[collection].set("interactive", { id: "interactive", name: `${type} target` });
    const app = new InteractionApplication(f.controller, { sceneId: "map", tokenId: "interactive", targetType: type, groupId: "hall" });
    const context = await app._prepareContext({});
    assert.equal(context.missing, false);
    assert.equal(context.name, `${type} target`);
  }
});

test("interaction window opens the selected shop catalog and rejects a stale run", async () => {
  const f = fixture(), target = { type: "Drawing", id: "terminal" };
  const app = new InteractionApplication(f.controller, { sceneId: "map", tokenId: target.id, targetType: target.type, groupId: "hall" });
  const choice = { kind: "shop", id: "second-shop", groupId: "hall", runId: "run" };
  await app.choose(choice, "pc");
  assert.deepEqual(f.calls, [[target, { actorTokenId: "pc", groupId: "hall", shopId: "second-shop" }]]);
  f.runtime.runId = "new-run";
  await assert.rejects(() => app.choose(choice, "pc"), /changed/);
  assert.equal(f.calls.length, 1);
});
