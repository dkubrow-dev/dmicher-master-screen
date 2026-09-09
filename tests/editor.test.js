import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { requireNumber, buildTriggerRows } from "../dmicher-master-screen/scripts/apps/editor-view.js";
import { buildTriggerFields, readTriggerFields } from "../dmicher-master-screen/scripts/apps/trigger-fields.js";
import { defaultDefinition, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";

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
const { EditorApplication } = await import("../dmicher-master-screen/scripts/apps/editor.js");
const { ShopsManagerApplication } = await import("../dmicher-master-screen/scripts/apps/shops-manager.js");
const { DialogueCatalogApplication } = await import("../dmicher-master-screen/scripts/apps/dialogue-catalog.js");

function fixture() {
  const definition = defaultDefinition();
  const runtime = emptyRuntime();
  runtime.episodeId = "calm";
  runtime.disabledTokens = ["guard"];
  const context = { definition, runtime, scene: { id: "scene", name: "Market" }, isGM: true,
    selectedEpisodeId: "calm", episode: definition.episodes[0], tokens: [{ id: "guard", name: "Guard", texture: { src: "guard.webp" } }] };
  context.scene.getFlag = (_scope, key) => key === "interactionCatalog" ? context.assets : key === "definitions" ? { main: definition } : key === "runtimes" ? { main: runtime } : undefined;
  const saved = [];
  const controller = { getContext: () => context, saveToken: async (...args) => saved.push(args) };
  return { context, controller, saved };
}




test("director reads persisted disabled IDs and uses domain rules including emergency stop", async () => {
  const f = fixture();
  f.context.definition.episodes[1].allowFromAll = false;
  f.context.definition.episodes[3].allowFromAll = false;
  const app = new EditorApplication(f.controller, { mode: "director" });
  const view = await app._prepareContext({});
  assert.equal(view.tokens[0].disabled, true);
  assert.equal(view.episodes.find((entry) => entry.id === "tension").allowed, true, "manual GM transitions are unrestricted");
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
  assert.equal(app.onDraftInput({ target: { name: "unrelated", closest: () => null } }), false);
  assert.equal(app.episodeDirty, false);
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
  assert.deepEqual(f.calls, [["join", "guard", { actorTokenId: "pc", sessionId: "session-1", schemeId: "main", join: true }]]);
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

test("Tile event actions survive episode form serialization", async () => {
  const f = fixture();
  const app = new EditorApplication(f.controller);
  await app._prepareContext({});
  const formFields = (values, dataset = {}) => ({ dataset, querySelector(selector) {
    const name = selector.match(/name="([^"]+)"/)?.[1];
    return name in values ? { value: String(values[name]), checked: values[name] === true } : null;
  } });
  const interaction = formFields({ actionName: "Use lever", actionEnabled: true, actionTarget: "Tile:lever", actionRange: "5", actionEvent: "lever.used" }, { interactionRow: "lever-use" });
  const form = formFields({ name: "Calm", allowFromAll: true, sound: "", stop: false, pause: false });
  form.querySelectorAll = (selector) => selector === "[data-interaction-row]" ? [interaction] : [];
  app.element = { querySelector: () => form };
  const episode = app.readEpisode();
  assert.deepEqual(episode.interactions[0].target, { type: "Tile", id: "lever" });
  assert.equal(episode.interactions[0].eventName, "lever.used");
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
  f.context.assets = { schemaVersion: 1, revision: 0, shops: [], dialogues: [{ id: "talk", name: "Talk", startPageId: "start", pages: [{ id: "start", name: "Start", text: "Hello", responses: [{ id: "leave", label: "Leave", eventName: "alarm" }] }] }] };
  f.controller.dialogues = { invitePlayers: async (args) => calls.push(args) };
  const app = new DialogueCatalogApplication(f.controller);
  const view = await app._prepareContext({});
  assert.equal(view.dialogue.id, "talk");
  assert.equal(view.node.text, "Hello");
  globalThis.ui = { notifications: { info() {} } };
  app.recipients.add("player");
  await app.handleAction("players");
  assert.deepEqual(calls, [{ sceneId: "scene", dialogueId: view.dialogue.id, pageId: "start", userIds: ["player"] }]);
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
    f.context.tokens[0].name = '<img src=x onerror="alert(1)">';
    const editor = new EditorApplication(f.controller);
    const editorTemplate = hbs.compile(readFileSync(new URL("../dmicher-master-screen/templates/episode-tools.hbs", import.meta.url), "utf8"));
    const output = editorTemplate({ ...await editor._prepareContext({}), blocks: { tokens: true, entry: true } });
    assert.ok(output.includes("&lt;img"));
    assert.ok(!output.includes("<script>"));
    assert.ok(!output.includes("<img src=x"));
    const shops = shopsFixture();
    shops.shops[0].npcName = "<script>bad</script>";
    const manager = new ShopsManagerApplication(shops.controller);
    const managerTemplate = hbs.compile(readFileSync(new URL("../dmicher-master-screen/templates/shops-manager.hbs", import.meta.url), "utf8"));
    const managerOutput = managerTemplate(await manager._prepareContext({}));
    assert.match(managerOutput, /data-token-id="guard"[^>]*data-message-id="message-1"/);
    assert.ok(managerOutput.includes("&lt;script&gt;bad&lt;/script&gt;"));
    assert.ok(!managerOutput.includes("<script>"));
    for (const template of ["interaction", "actor-view", "shop", "dialogue", "dialogue-catalog"]) {
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
