import test from "node:test";
import assert from "node:assert/strict";
import { defaultDefinition } from "../dmicher-master-screen/scripts/model.js";

class App {
  constructor(options = {}) { this.options = options; this.rendered = true; }
  async _prepareContext() { return {}; }
  render() { return this; }
  async close() { this.rendered = false; }
}
let sequence = 0;
globalThis.foundry = { applications: { api: { ApplicationV2: App, HandlebarsApplicationMixin: base => base } }, utils: { randomID: () => `id${++sequence}` } };
globalThis.game = { user: { id: "gm", isGM: true }, users: [], settings: { get: () => "dark" } };
const { ShopApplication } = await import("../dmicher-master-screen/scripts/apps/shop-window.js");
const { ShopsManagerApplication } = await import("../dmicher-master-screen/scripts/apps/shops-manager.js");
const { DialogueApplication } = await import("../dmicher-master-screen/scripts/apps/dialogue-window.js");
const { DialogueCatalogApplication } = await import("../dmicher-master-screen/scripts/apps/dialogue-catalog.js");

test("shop window pins the source scheme while the GM changes their selection", async () => {
  const calls = [], session = { sessionId: "s", userId: "gm", actorTokenId: "hero", runId: "east-run", draft: { giveItemIds: [], take: [] } };
  const controller = { shop: { getContext: (...args) => { calls.push(args); return { runtime: { runId: "east-run", shopSessions: { merchant: session } } }; } } };
  const window = new ShopApplication(controller, { sceneId: "map", tokenId: "merchant", actorTokenId: "hero", schemeId: "east", sessionId: "s", join: true });
  await window.ensureSession();
  assert.ok(calls.every(args => args[2] === "east"));
  assert.equal(window.intent().schemeId, "east");
  assert.match(window.options.id, /map-east-east-run/);
});

test("GM shop manager joins and releases the selected scheme's session for a repeated token ID", async () => {
  const calls = [], scene = { id: "map" };
  const shops = ["west", "east"].map(schemeId => ({ tokenId: "merchant", schemeId, session: { sessionId: `s-${schemeId}`, actorTokenId: "hero", expiresAt: Date.now() + 60000 } }));
  const controller = { getContext: () => ({ isGM: true, scene }), shop: { listSceneShops: () => shops, releaseSession: async intent => calls.push(intent) }, openShop: (...args) => calls.push(args) };
  const window = new ShopsManagerApplication(controller); window.sceneId = "map";
  await window.handleAction("join", { schemeId: "east", tokenId: "merchant", sessionId: "s-east" });
  assert.equal(calls[0][1].schemeId, "east");
  await window.handleAction("release", { schemeId: "east", tokenId: "merchant", sessionId: "s-east" });
  assert.equal(calls[1].schemeId, "east");
  await assert.rejects(window.handleAction("join", { schemeId: "west", tokenId: "merchant", sessionId: "s-east" }));
});

test("dialogue start, answer and leave retain the originating scheme", async () => {
  const calls = [];
  const view = { sessionId: "s", nodeId: "first", step: 0, status: "active", responses: [] };
  const service = { getContext: (_scene, _dialogue, schemeId) => { assert.equal(schemeId, "east"); return { runtime: { runId: "run" } }; },
    requestStart: async intent => { calls.push(intent); return view; }, requestAnswer: async intent => { calls.push(intent); return view; }, leaveSession: async intent => calls.push(intent) };
  const window = new DialogueApplication(service, { sceneId: "map", dialogueId: "talk", actorTokenId: "hero", schemeId: "east" });
  await window._prepareContext({});
  await DialogueApplication.answer.call(window, null, { dataset: { responseId: "answer" } });
  await window.close();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(intent => intent.schemeId === "east"));
  assert.match(window.options.id, /map-east-run-talk/);
});

test("manual dialogue catalog reads a chosen scheme independently of the director selection", async () => {
  const west = defaultDefinition(), east = { ...defaultDefinition(), schemeId: "east", schemeName: "East" };
  east.episodes[0].dialogues = [{ id: "talk", name: "East only", target: { type: "Token", id: "merchant" }, startNodeId: "start", nodes: [{ id: "start", text: "East", responses: [] }] }];
  const scene = { id: "map", name: "Map", tokens: new Map(), tiles: new Map(), getFlag: (_module, key) => key === "definitions" ? { main: west, east } : undefined };
  const sent = [], controller = { getContext: () => ({ isGM: true, scene, definition: west, selectedEpisodeId: "calm" }), dialogues: { openManualDialogue: descriptor => sent.push(descriptor) } };
  const window = new DialogueCatalogApplication(controller);
  await window._prepareContext({});
  window.schemeId = "east";
  const context = await window._prepareContext({});
  assert.equal(context.dialogue.name, "East only");
  await window.handleAction("self");
  assert.deepEqual(sent[0], { sceneId: "map", schemeId: "east", episodeId: "calm", dialogueId: "talk" });
});
