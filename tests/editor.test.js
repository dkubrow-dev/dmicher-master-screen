import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { buildGraphView, parsePointRows, formatPointRows, requireNumber, buildTriggerRows } from "../dmicher-master-screen/scripts/apps/editor-view.js";
import { buildTriggerFields, readTriggerFields } from "../dmicher-master-screen/scripts/apps/trigger-fields.js";
import { defaultDefinition, defaultTokenBehavior, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";

class ApplicationStub {
  constructor(options) { this.options = options; this.rendered = true; this.renderCount = 0; }
  async _prepareContext() { return {}; }
  async _onRender() {}
  async _onClose() {}
  render() { this.renderCount++; return this; }
}
globalThis.foundry = {
  applications: { api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: (base) => base,
    DialogV2: { confirm: async () => true } } },
  utils: { deepClone: structuredClone }
};
globalThis.game = { settings: { get: () => "dark" } };
const { EditorApplication, TokenEditorApplication } = await import("../dmicher-master-screen/scripts/apps/editor.js");
const { ShopsManagerApplication } = await import("../dmicher-master-screen/scripts/apps/shops-manager.js");
const { DialogueEditorApplication } = await import("../dmicher-master-screen/scripts/apps/dialogue-editor.js");
const { DialogueCatalogApplication } = await import("../dmicher-master-screen/scripts/apps/dialogue-catalog.js");

function fixture() {
  const definition = defaultDefinition();
  const runtime = emptyRuntime();
  runtime.episodeId = "calm";
  runtime.disabledTokens = ["guard"];
  const context = { definition, runtime, scene: { id: "scene", name: "Market" }, isGM: true,
    selectedEpisodeId: "calm", episode: definition.episodes[0], tokens: [{ id: "guard", name: "Guard", texture: { src: "guard.webp" } }] };
  const saved = [];
  const controller = { getContext: () => context, saveToken: async (...args) => saved.push(args) };
  return { context, controller, saved };
}

test("graph represents unrestricted incoming edges without a dense all-to-all drawing", () => {
  const graph = buildGraphView(defaultDefinition().episodes, "calm");
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 0);
  assert.ok(graph.nodes.every((node) => node.all));
  assert.equal(graph.nodes.filter((node) => node.selected).length, 1);
});

test("graph draws only existing explicit sources and preserves hostile names as text data", () => {
  const episodes = defaultDefinition().episodes;
  episodes[1].allowFromAll = false;
  episodes[1].from = ["calm", "missing", "tension"];
  episodes[1].name = "<img onerror=alert(1)>";
  const graph = buildGraphView(episodes, "tension");
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].sourceId, "calm");
  assert.equal(graph.nodes[1].name, episodes[1].name);
  assert.equal(graph.edges[0].targetId, "tension");
});

test("patrol text roundtrips optional checks and refuses malformed coordinates", () => {
  const points = parsePointRows("# waypoint\n100, 200\n300; 400 | Macro.check | alarm");
  assert.deepEqual(points, [
    { x: 100, y: 200, macroUuid: "", onTrue: "" },
    { x: 300, y: 400, macroUuid: "Macro.check", onTrue: "alarm" }
  ]);
  assert.deepEqual(parsePointRows(formatPointRows(points)), points);
  for (const invalid of ["100", "100, bad", "NaN, 1", "-2, 3", "1,2,3", "1,2 | a | b | c"]) assert.throws(() => parsePointRows(invalid));
  assert.throws(() => requireNumber("", "X"));
  assert.throws(() => requireNumber("Infinity", "X"));
});

test("director reads persisted disabled IDs and uses domain rules including emergency stop", async () => {
  const f = fixture();
  f.context.definition.episodes[1].allowFromAll = false;
  f.context.definition.episodes[3].allowFromAll = false;
  const app = new EditorApplication(f.controller, { mode: "director" });
  const view = await app._prepareContext({});
  assert.equal(view.tokens[0].disabled, true);
  assert.equal(view.episodes.find((entry) => entry.id === "tension").allowed, false);
  assert.equal(view.episodes.find((entry) => entry.id === "stop").allowed, true);
  assert.equal(view.isDirector, true);
  assert.equal(view.schemeName, f.context.definition.schemeName);
});

test("editor drafts are isolated from saved scene configuration and survive switching maps", async () => {
  const f = fixture();
  const app = new EditorApplication(f.controller);
  await app._prepareContext({});
  app.draft.name = "Unsaved";
  app.dirty = true;
  app.refresh();
  assert.equal(app.renderCount, 0);
  assert.notEqual(f.context.episode.name, "Unsaved");
  f.context.scene.id = "other-scene";
  app.refresh();
  assert.equal(app.renderCount, 1);
  await app._prepareContext({});
  assert.notEqual(app.draft.name, "Unsaved");
  app.draft.name = "Other draft";
  app.dirty = true;
  f.context.scene.id = "scene";
  await app._prepareContext({});
  assert.equal(app.draft.name, "Unsaved");
  assert.equal(app.dirty, true);
  assert.notEqual(f.context.episode.name, "Unsaved");
});

test("new episode name input is not mistaken for unsaved episode configuration", () => {
  const app = new EditorApplication(fixture().controller);
  assert.equal(app.onDraftInput({ target: { name: "newEpisodeName", closest: () => null } }), false);
  assert.equal(app.onDraftInput({ target: { name: "graphText", closest: () => null } }), true);
  assert.equal(app.episodeDirty, false);
});

test("token form serializes independent shop choices and preserves dropped Item data", async () => {
  const f = fixture();
  const app = new TokenEditorApplication(f.controller, "guard", { episodeId: "calm" });
  await app._prepareContext({});
  app.draft.shop.items.push({ id: "stock", data: { name: "Rope", system: { quantity: 3 } }, stock: 2 });
  const values = {
    enabled: true, emoji: "!", positionEnabled: false, hidden: "keep", speechInterval: "40", phrases: "First\nSecond",
    speechRange: "25", visibleOnly: true, entrySpeech: "Welcome", patrolEnabled: true, patrolSpeed: "4", points: "10, 20",
    shopEnabled: true, shopRange: "7", shopApproval: true, shopDisplay: "tiles", "stock-0": "2",
    interactionLabel: "Ask", interactionTarget: "tension"
  };
  app.element = { querySelector(selector) {
    const key = selector.match(/name="([^"]+)"/)?.[1];
    return key in values ? { value: String(values[key]), checked: values[key] === true } : null;
  } };
  const data = app.readBehavior();
  assert.equal(data.shop.range, 7);
  assert.equal(data.shop.requireGMApproval, true);
  assert.equal(data.shop.display, "tiles");
  assert.deepEqual(data.shop.items[0].data, { name: "Rope", system: { quantity: 3 } });
  assert.deepEqual(data.speech.phrases, ["First", "Second"]);
  assert.equal(data.hidden, null);
  assert.equal(data.position, null);
});

test("a token editor refuses writes after switching scenes", async () => {
  const f = fixture();
  const app = new TokenEditorApplication(f.controller, "guard", { episodeId: "calm" });
  f.context.scene.id = "different";
  await assert.rejects(app.handleAction("saveToken"));
  assert.equal(f.saved.length, 0);
});

test("an old episode form cannot be submitted into the scene selected meanwhile", async () => {
  const f = fixture();
  const app = new EditorApplication(f.controller);
  await app._prepareContext({});
  app.element = { querySelector: () => ({ dataset: { editorContext: "scene:calm" } }) };
  f.context.scene.id = "different";
  await assert.rejects(app.handleAction("saveEpisode"));
});

test("scene draft cache retains incomplete raw values as well as its last valid draft", async () => {
  const f = fixture();
  const app = new EditorApplication(f.controller);
  await app._prepareContext({});
  app.dirty = true;
  app.element = { querySelectorAll: () => [{ name: "spawnX", type: "number", value: "", checked: false }] };
  f.context.scene.id = "other";
  await app._prepareContext({});
  f.context.scene.id = "scene";
  await app._prepareContext({});
  assert.equal(app.pendingInputs[0].value, "");
  assert.equal(app.dirty, true);
});

function shopsFixture() {
  const f = fixture();
  const calls = [];
  const shops = [{ tokenId: "guard", npcName: "Guard", enabled: true,
    session: { id: "session-1", actorTokenId: "pc", userName: "Player", actorName: "Hero", expiresAt: Date.now() + 60000 },
    pending: [{ messageId: "message-1", status: "pending", summary: { give: "Rope", take: "Sword" } }] }];
  f.controller.shop = {
    listSceneShops: () => shops,
    releaseSession: async (args) => calls.push(["release", args]),
    approveTrade: async (messageId) => calls.push(["approve", messageId]),
    rejectTrade: async (messageId) => calls.push(["reject", messageId])
  };
  f.controller.openShop = async (...args) => calls.push(["join", ...args]);
  return { ...f, shops, calls };
}

test("shop manager joins the current session participant, ignoring supplied actor fields", async () => {
  const f = shopsFixture();
  const app = new ShopsManagerApplication(f.controller);
  const view = await app._prepareContext({});
  assert.equal(view.shops[0].occupied, true);
  await app.handleAction("join", { tokenId: "guard", sessionId: "session-1", actorTokenId: "foreign" });
  assert.deepEqual(f.calls, [["join", "guard", { actorTokenId: "pc", sessionId: "session-1", join: true }]]);
});

test("shop manager refuses stale sessions and already processed exchange requests", async () => {
  const f = shopsFixture();
  const app = new ShopsManagerApplication(f.controller);
  await app._prepareContext({});
  f.shops[0].session.id = "replacement-session";
  await assert.rejects(app.handleAction("release", { tokenId: "guard", sessionId: "session-1" }));
  f.shops[0].pending[0].status = "done";
  await assert.rejects(app.handleAction("approve", { tokenId: "guard", messageId: "message-1" }));
  assert.equal(f.calls.length, 0);
});

test("shop manager dispatches a reviewed pending message and restricts actions to GM context", async () => {
  const f = shopsFixture();
  const app = new ShopsManagerApplication(f.controller);
  await app._prepareContext({});
  await app.handleAction("approve", { tokenId: "guard", messageId: "message-1" });
  assert.deepEqual(f.calls, [["approve", "message-1"]]);
  f.context.isGM = false;
  await assert.rejects(app.handleAction("reject", { tokenId: "guard", messageId: "message-1" }));
});

test("chat audience opt-outs and Tile event actions survive episode form serialization", async () => {
  const f = fixture();
  const app = new EditorApplication(f.controller);
  await app._prepareContext({});
  const formFields = (values, dataset = {}) => ({ dataset, querySelector(selector) {
    const name = selector.match(/name="([^"]+)"/)?.[1];
    return name in values ? { value: String(values[name]), checked: values[name] === true } : null;
  } });
  const subscription = formFields({ subscriptionEnabled: true, subscriptionEvent: "lever.used", subscriptionKind: "chat",
    subscriptionMacro: "", subscriptionEpisode: "", subscriptionText: "The lever moves.", audienceGMs: false,
    audienceInteractor: true, audienceNearby: false, audienceRange: "20", audienceVisible: true }, { subscriptionRow: "notice" });
  const interaction = formFields({ actionName: "Use lever", actionEnabled: true, actionTarget: "Tile:lever", actionRange: "5", actionEvent: "lever.used" }, { interactionRow: "lever-use" });
  const form = formFields({ name: "Calm", allowFromAll: true, sound: "", stop: false, pause: false });
  form.querySelectorAll = (selector) => selector === "[data-subscription-row]" ? [subscription] : selector === "[data-interaction-row]" ? [interaction] : [];
  app.element = { querySelector: () => form };
  const episode = app.readEpisode();
  assert.equal(episode.subscriptions[0].audience.gms, false);
  assert.equal(episode.subscriptions[0].audience.interactor, true);
  assert.equal(episode.subscriptions[0].audience.range, 20);
  assert.deepEqual(episode.interactions[0].target, { type: "Tile", id: "lever" });
  assert.equal(episode.interactions[0].eventName, "lever.used");
});

test("dialogue editor lists scene targets and keeps its source revision", async () => {
  const f = fixture();
  f.context.scene.tiles = new Map([["lever", { id: "lever", name: "Lever" }]]);
  f.context.definition.revision = 7;
  f.context.episode.dialogues = [{ id: "talk", name: "Guard", enabled: true, target: { type: "Token", id: "guard" }, range: 5,
    startNodeId: "start", nodes: [{ id: "start", text: "Hello", art: "", responses: [] }] }];
  const app = new DialogueEditorApplication(f.controller, "talk", { episodeId: "calm" });
  const view = await app._prepareContext({});
  assert.equal(view.targets.length, 2);
  assert.equal(view.targets[1].value, "Tile:lever");
  assert.equal(app.draftRevision, 7);
  app.dirty = true;
  app.draft.name = "Local draft";
  f.context.definition.revision = 8;
  await app._prepareContext({});
  assert.equal(app.draftRevision, 7);
  assert.equal(app.draft.name, "Local draft");
});

test("shared trigger markup escapes every configured label, tag, and attribute value", () => {
  const html = buildTriggerFields({ allowTags: ['" onfocus="alert(1)'], denyTags: ["<script>bad</script>"] },
    [{ id: 'episode"evil', name: "<script>name</script>" }], { schemeName: "<img src=x>" });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x>"));
  assert.ok(!html.includes('value="" onfocus="alert(1)"'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&quot;"));
  assert.throws(() => buildTriggerFields({}, [], { prefix: 'bad" onclick="evil' }));
});

test("trigger parser keeps explicit opt-outs, tag lists, scopes and manual reset policy", () => {
  const values = { "trigger-enabled": false, "trigger-repeat": "limited", "trigger-limit": "3", "trigger-reset": false,
    "trigger-allow": "hero, trusted, hero", "trigger-deny": "hostile" };
  const root = { querySelector(selector) {
    const key = selector.match(/name="([^"]+)"/)?.[1];
    return key in values ? { value: String(values[key]), checked: values[key] === true } : null;
  }, querySelectorAll(selector) { return selector.includes("trigger-episode") ? [{ value: "calm" }] : []; } };
  const trigger = readTriggerFields(root);
  assert.equal(trigger.enabled, false);
  assert.equal(trigger.resetOnEntry, false);
  assert.deepEqual(trigger.allowTags, ["hero", "trusted"]);
  assert.deepEqual(trigger.denyTags, ["hostile"]);
  assert.deepEqual(trigger.episodeIds, ["calm"]);
  assert.equal(trigger.limit, 3);
  values["trigger-limit"] = "1.5";
  assert.throws(() => readTriggerFields(root));
});

test("director shows unconsumed trigger controls and preserves manual enabled overrides", () => {
  const f = fixture();
  f.context.runtime.episode = structuredClone(f.context.episode);
  f.context.runtime.episode.interactions = [{ id: "lever", name: "Lever", trigger: { enabled: false } }];
  f.context.runtime.triggerEnabledOverrides = { "main:calm:interaction:lever": true };
  const rows = buildTriggerRows(f.context);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 0);
  assert.equal(rows[0].enabled, true);
  assert.equal(rows[0].canToggle, true);
});

test("manual dialogue catalog reads preparation while halted and calls only manual invitation service", async () => {
  const f = fixture(), calls = [];
  f.context.runtime.episodeId = null;
  f.context.runtime.halted = true;
  f.context.scene.tokens = new Map([["guard", { id: "guard", name: "Guard" }]]);
  f.context.episode.dialogues = [{ id: "talk", name: "Talk", enabled: false, target: { type: "Token", id: "guard" }, startNodeId: "start",
    nodes: [{ id: "start", text: "Hello", responses: [{ id: "leave", label: "Leave", eventName: "alarm" }] }] }];
  f.controller.dialogues = { invitePlayers: async (args) => calls.push(args) };
  const app = new DialogueCatalogApplication(f.controller);
  const view = await app._prepareContext({});
  assert.equal(view.dialogue.id, "talk");
  assert.equal(view.node.text, "Hello");
  globalThis.ui = { notifications: { info() {} } };
  app.recipients.add("player");
  await app.handleAction("players");
  assert.deepEqual(calls, [{ sceneId: "scene", episodeId: "calm", dialogueId: "talk", userIds: ["player"] }]);
  assert.equal(f.context.runtime.halted, true);
});

// Use the installed Foundry Handlebars runtime when available; no production dependency is added.
const require = createRequire(import.meta.url);
for (const version of ["13.351", "14.366"]) {
  const library = `E:/Foundry Portable/Foundry VTT ${version}/App/resources/app/node_modules/handlebars`;
  test(`Foundry ${version} templates compile and escape scene, token, and episode text`, { skip: !existsSync(library) }, async () => {
    const hbs = require(library).create();
    hbs.registerHelper("checked", (flag) => flag ? "checked" : "");
    hbs.registerHelper("selectOptions", () => "");
    const f = fixture();
    f.context.scene.name = '<script>alert("scene")</script>';
    f.context.episode.name = '<img src=x onerror="alert(1)">';
    const editor = new EditorApplication(f.controller);
    const editorTemplate = hbs.compile(readFileSync(new URL("../dmicher-master-screen/templates/editor.hbs", import.meta.url), "utf8"));
    const output = editorTemplate(await editor._prepareContext({}));
    assert.ok(output.includes("&lt;script&gt;"));
    assert.ok(!output.includes("<script>"));
    assert.ok(!output.includes("<img src=x"));
    const token = new TokenEditorApplication(f.controller, "guard", { episodeId: "calm" });
    const view = await token._prepareContext({});
    const tokenTemplate = hbs.compile(readFileSync(new URL("../dmicher-master-screen/templates/token-editor.hbs", import.meta.url), "utf8"));
    assert.ok(tokenTemplate(view).includes("speechInterval"));
    assert.ok(tokenTemplate(view).includes("shopApproval"));
    const shops = shopsFixture();
    shops.shops[0].npcName = "<script>bad</script>";
    const manager = new ShopsManagerApplication(shops.controller);
    const managerTemplate = hbs.compile(readFileSync(new URL("../dmicher-master-screen/templates/shops-manager.hbs", import.meta.url), "utf8"));
    const managerOutput = managerTemplate(await manager._prepareContext({}));
    assert.ok(managerOutput.includes('data-token-id="guard" data-message-id="message-1"'));
    assert.ok(managerOutput.includes("&lt;script&gt;bad&lt;/script&gt;"));
    assert.ok(!managerOutput.includes("<script>"));
    for (const template of ["help", "interaction", "actor-view", "shop", "dialogue", "dialogue-editor", "dialogue-catalog"]) {
      const compiled = hbs.compile(readFileSync(new URL(`../dmicher-master-screen/templates/${template}.hbs`, import.meta.url), "utf8"));
      const html = compiled({ name: "<script>bad</script>", npcName: "<script>bad</script>", sceneName: "<script>bad</script>",
        shop: true, transition: true, label: "<script>bad</script>", characters: [], groups: [], tokens: [],
        node: { id: "start", text: "<script>bad</script>", responses: [] }, dialogue: { id: "talk", name: "<script>bad</script>" } });
      assert.ok(html.length > 100);
      assert.ok(!html.includes("<script>"));
      if (template === "shop") assert.ok(html.includes("data-currency-adapter hidden"));
    }
  });
}
