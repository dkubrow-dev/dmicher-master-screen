import test from "node:test";
import assert from "node:assert/strict";
import { defaultDefinition, emptyRuntime, MODULE_ID } from "../dmicher-master-screen/scripts/model.js";

// These are lifecycle/contract tests, not a browser renderer or a multiplayer Foundry server.
const instances = new Map();
let nextApplicationId = 0;
class ApplicationStub {
  constructor(options = {}) {
    this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options };
    this.id = this.options.id ?? `app-${++nextApplicationId}`;
    this.position = this.options.position ?? {};
    this.rendered = false;
    instances.set(this.id, this);
  }
  async _prepareContext() { return {}; }
  async _onRender() {}
  async _onClose() {}
  async render() {
    this.rendered = true;
    this.context = await this._prepareContext({});
    return this;
  }
  async close() { this.rendered = false; await this._onClose({}); instances.delete(this.id); }
  bringToFront() { this.foreground = true; }
}
globalThis.foundry = {
  applications: { instances, api: { ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: (base) => base,
    DialogV2: { confirm: async () => true } } },
  utils: { deepClone: structuredClone, randomID: () => crypto.randomUUID().replaceAll("-", "").slice(0, 16) }
};
const { ScreenController } = await import("../dmicher-master-screen/scripts/controller.js");
const { getDefinition } = await import("../dmicher-master-screen/scripts/store.js");

function createHooks() {
  let next = 0;
  const entries = new Map();
  return {
    on(name, callback) { const id = ++next; entries.set(id, { name, callback }); return id; },
    once(name, callback) { const id = ++next; entries.set(id, { name, callback, once: true }); return id; },
    off(name, id) { if (entries.get(id)?.name === name) entries.delete(id); },
    callAll(name, ...args) { for (const entry of [...entries.values()]) if (entry.name === name) entry.callback(...args); },
    async emit(name, ...args) {
      for (const [id, entry] of [...entries]) if (entry.name === name) {
        if (entry.once) entries.delete(id);
        await entry.callback(...args);
      }
    },
    size: () => entries.size
  };
}
function fixture(generation, isGM = true) {
  instances.clear();
  const gm = { id: "gm", name: "Game Master", role: 4, isGM: true, active: true, flags: {},
    getFlag(scope, key) { return structuredClone(this.flags[scope]?.[key]); },
    async setFlag(scope, key, value) { this.flags[scope] ??= {}; this.flags[scope][key] = structuredClone(value); } };
  const player = { ...gm, id: "player", name: "Player", role: 1, isGM: false, flags: {} };
  const settings = new Map(), pagehide = [], intervals = new Map(), errors = [], hookBus = createHooks();
  let timerId = 0;
  const makeScene = (id) => {
    const scene = { id, name: id, grid: { size: 100, distance: 5 }, tokens: new Map(), flags: { [MODULE_ID]: { definitions: { main: defaultDefinition() } } }, updates: [],
      getFlag(scope, key) { return structuredClone(this.flags[scope]?.[key]); },
      async setFlag(scope, key, value) {
        this.flags[scope] ??= {};
        let destination = this.flags[scope];
        const segments = key.split(".");
        for (const segment of segments.slice(0, -1)) destination = destination[segment] ??= {};
        destination[segments.at(-1)] = structuredClone(value);
        this.updates.push(key);
      }
    };
    scene.tokens.set("guard", { id: "guard", name: "Guard", parent: scene, x: 0, y: 0, width: 1, height: 1,
      texture: { src: "guard.webp" }, actor: { testUserPermission: () => false }, object: {} });
    return scene;
  };
  const scene = makeScene("scene-a"), other = makeScene("scene-b");
  const stageEvents = new Map();
  const original = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, addEventListener: globalThis.addEventListener };
  globalThis.setInterval = (callback) => { const id = ++timerId; intervals.set(id, callback); return id; };
  globalThis.clearInterval = (id) => intervals.delete(id);
  globalThis.addEventListener = (name, callback) => { if (name === "pagehide") pagehide.push(callback); };
  globalThis.document = { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  globalThis.Hooks = hookBus;
  globalThis.ui = { windows: {}, notifications: { info() {}, warn() {}, error: (message) => errors.push(message) } };
  globalThis.game = { user: isGM ? gm : player, users: new Map([[gm.id, gm], [player.id, player]]),
    modules: new Map([[MODULE_ID, { id: MODULE_ID, active: true }]]),
    scenes: new Map([[scene.id, scene], [other.id, other]]), messages: new Map(), paused: false,
    release: { generation }, version: `${generation}.0`, i18n: { localize: (key) => key },
    settings: { register(scope, key, definition) { settings.set(`${scope}.${key}`, definition.default); }, get: (scope, key) => settings.get(`${scope}.${key}`) }
  };
  globalThis.canvas = { scene, stage: { on(name, callback) { stageEvents.set(callback, name); }, off(_name, callback) { stageEvents.delete(callback); } },
    tokens: { placeables: [], controlled: [], activate() {} } };
  globalThis.CONFIG = {};
  return { scene, other, errors, intervals, hooks: hookBus, stageEvents,
    async dispose() {
      for (const callback of pagehide) callback();
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
      globalThis.addEventListener = original.addEventListener;
      await Promise.resolve();
    }
  };
}

for (const generation of [13, 14]) {
  test(`Foundry ${generation} init/ready exposes API, category stays passive, and constructor opens four episodes`, async () => {
    const f = fixture(generation);
    try {
      await import(`../dmicher-master-screen/scripts/main.js?bootstrap=${generation}`);
      await f.hooks.emit("init");
      const api = game.modules.get(MODULE_ID).api;
      assert.equal(api.apiVersion, 1);
      assert.equal(Object.isFrozen(api), true);
      assert.equal(instances.size, 0);
      await f.hooks.emit("ready");
      assert.equal(instances.size, 0);
      assert.equal(f.intervals.size, 1);
      const controls = {};
      await f.hooks.emit("getSceneControlButtons", controls);
      const category = controls[MODULE_ID];
      assert.equal(category.visible, true);
      assert.equal(category.tools.help.order, 0);
      assert.equal(category.tools.help.button, true);
      category.tools[category.activeTool].onChange(null, true);
      await Promise.resolve();
      assert.equal(instances.size, 0);
      await api.openConstructor();
      const editor = instances.get("dmicher-master-screen-editor");
      assert.equal(editor.context.isConstructor, true);
      assert.equal(editor.context.episodes.length, 4);
      assert.equal(api.getState().definition.episodes[0].id, "calm");
      assert.equal(f.scene.updates.length, 0, "opening a mode must not run or save an episode");
      assert.deepEqual(f.errors, []);
    } finally { await f.dispose(); }
    assert.equal(f.intervals.size, 0);
    assert.equal(f.stageEvents.size, 0);
  });

  test(`Foundry ${generation} player has no GM menu and cannot open constructor/director/actor/shops`, async () => {
    const f = fixture(generation, false);
    try {
      await import(`../dmicher-master-screen/scripts/main.js?bootstrap=player-${generation}`);
      await f.hooks.emit("init");
      await f.hooks.emit("ready");
      const api = game.modules.get(MODULE_ID).api;
      const controls = {};
      await f.hooks.emit("getSceneControlButtons", controls);
      assert.equal(controls[MODULE_ID].visible, false);
      for (const name of ["openConstructor", "openDirector", "openActor"]) await assert.rejects(api[name]());
      assert.throws(() => api.openShops());
      assert.equal(instances.size, 0);
      assert.equal(f.scene.updates.length, 0);
    } finally { await f.dispose(); }
  });
}


test("controller rejects an old episode draft instead of replacing a newer episode configuration", async () => {
  const f = fixture(14);
  try {
    const controller = new ScreenController();
    const oldEpisode = structuredClone(controller.getContext().episode);
    const changed = structuredClone(oldEpisode); changed.sound = "alarm.ogg";
    await controller.saveEpisode(changed, { expectedRevision: 0, sceneId: f.scene.id });
    await assert.rejects(controller.saveEpisode(oldEpisode, { expectedRevision: 0, sceneId: f.scene.id }));
    assert.equal(getDefinition(f.scene).episodes[0].sound, "alarm.ogg");
  } finally { await f.dispose(); }
});


test("switching editor modes retains independent drafts; actor observation preserves the editor", async () => {
  const f = fixture(14);
  try {
    const controller = new ScreenController();
    await controller.setMode("constructor");
    const editor = controller.editor;
    assert.equal(editor.options.window.frame, false);
    assert.equal(editor.options.window.positioned, false);
    let confirmations = 0;
    const visibility = [];
    editor.setDockVisible = (visible) => visibility.push(visible);
    editor.dirty = true;
    editor.mayDiscard = async () => { confirmations++; return true; };
    await editor.handleAction("actor");
    assert.equal(confirmations, 0);
    assert.equal(editor.rendered, true);
    assert.deepEqual(visibility, []);
    await controller.setMode("constructor");
    assert.equal(controller.editor, editor);
    assert.deepEqual(visibility, []);
    assert.equal(editor.dirty, true);
    await editor.handleAction("director");
    assert.equal(confirmations, 0);
    assert.equal(editor.hasUnsavedChanges(), true);
    assert.equal(controller.editor.mode, "director");
    assert.equal(controller.editor, editor, "director reuses the same IDE application");
    assert.equal(controller.editor.options.window.frame, false);
    await controller.setMode("constructor");
    assert.equal(editor.dirty, true);
  } finally { await f.dispose(); }
});

test("an empty scene stays empty through constructor, director and tool windows", async () => {
  const f = fixture(14);
  try {
    f.scene.flags = {};
    const controller = new ScreenController();
    assert.equal(controller.getContext().definition, null);
    await controller.setMode("constructor");
    assert.equal(controller.editor.context.missingScheme, true);
    assert.match(controller.editor.context.nodeActions, /addScheme/);
    assert.equal(controller.editor.context.badgesHTML, "");
    await controller.openObjectBehavior({ type: "Token", id: "guard" }).render();
    await controller.setMode("director");
    await controller.openDialogues().render();
    assert.deepEqual(controller.dialogueCatalog.context.dialogues, [], "the independent catalog can open before any scheme exists");
    assert.deepEqual(f.scene.flags, {});
    canvas.scene = f.other; await controller.editor.refresh();
    assert.equal(controller.getContext().definition.episodes.length, 4);
    assert.equal(controller.getContext({ schemeId: "deleted-scheme" }).definition, null, "a stale tool must not silently edit the first remaining scheme");
    canvas.scene = f.scene; await controller.editor.refresh();
    assert.equal(controller.getContext().definition, null);
    assert.deepEqual(f.errors, []);
  } finally { await f.dispose(); }
});

test("controller wires a validated Tile interaction through the event bus to an episode transition", { timeout: 3000 }, async () => {
  const f = fixture(14);
  let controller;
  try {
    controller = new ScreenController();
    f.scene.tiles = new Map([["lever", { id: "lever", name: "Lever", x: 0, y: 0, width: 100, height: 100, hidden: false }]]);
    f.scene.tokens.get("guard").object.checkCollision = () => false;
    const definition = defaultDefinition();
    definition.episodes[0].interactions = [{ id: "lever-use", name: "Pull lever", enabled: true,
      target: { type: "Tile", id: "lever" }, range: 5, eventName: "lever.used" }];
    definition.episodes[2].events = ["lever.used"];
    f.scene.flags[MODULE_ID].objectBindings = { schemaVersion: 1, revision: 0, bindings: { "Tile:lever": { type: "Tile", id: "lever", schemeId: "main", tags: [] } } };
    const { EventCatalog } = await import("../dmicher-master-screen/scripts/event-catalog.js");
    await new EventCatalog(f.scene).saveEvent({ name: "lever.used", subscribers: [] });
    await controller.saveDefinition(definition);
    await controller.transition("calm");
    await controller.events.whenIdle();
    assert.equal(controller.getContext().runtime.episode.interactions.length, 1);
    await controller.requestNamedInteraction("lever-use", "guard");
    await controller.events.whenIdle();
    assert.equal(controller.getContext().runtime.episodeId, "alarm");
    assert.ok(controller.getContext().runtime.eventLog.some((entry) => entry.name === "lever.used"));
    assert.deepEqual(f.errors, []);
  } finally { controller?.events.dispose(); controller?.runtime.dispose(); await f.dispose(); }
});

test("constructor context menu opens only the chosen object action and writes no scene data", async () => {
  const f = fixture(14);
  try {
    const controller = new ScreenController(); controller.mode = "constructor";
    const opened = []; let entries;
    controller.objectMenu.open = (items) => { entries = items; };
    controller.openObjectInfo = (target) => opened.push(["info", target]);
    controller.openObjectBehavior = (target) => opened.push(["behavior", target]);
    assert.equal(controller.openObjectMenu({ type: "Token", id: "guard" }), true);
    assert.equal(entries.length, 2); assert.equal(opened.length, 0);
    await entries[1].action(); assert.deepEqual(opened, [["behavior", { type: "Token", id: "guard" }]]);
    assert.deepEqual(f.scene.updates, []);
    f.scene.tiles = new Map([["console", { id: "console" }]]);
    controller.openObjectMenu({ type: "Tile", id: "console" }); assert.equal(entries.length, 2);
  } finally { await f.dispose(); }
});

test("entry episode is selected without executing and an ambiguous player selection stays unresolved", async () => {
  const f = fixture(14);
  try {
    f.scene.flags[MODULE_ID].definitions.main.entryEpisodeId = "alarm";
    const controller = new ScreenController();
    assert.equal(controller.getContext().selectedEpisodeId, "alarm");
    assert.deepEqual(f.scene.updates, []);
    const pc = (id) => ({ id, actor: { testUserPermission: () => true }, hidden: false });
    f.scene.tokens.set("pc1", pc("pc1")); f.scene.tokens.set("pc2", pc("pc2"));
    game.user = game.users.get("player");
    assert.equal(controller.getActingTokenId(undefined, "guard"), undefined);
    canvas.tokens.controlled = [{ document: f.scene.tokens.get("pc2") }];
    assert.equal(controller.getActingTokenId(undefined, "guard"), "pc2");
    assert.equal(controller.getActingTokenId("guard"), undefined);
  } finally { await f.dispose(); }
});

test("a single owned self-target selects the acting character without requiring a scheme", async () => {
  const f = fixture(14);
  try {
    const controller = new ScreenController(); game.user = game.users.get("player");
    const pc = (id, owned = true) => ({ id, hidden: false, actor: { testUserPermission: () => owned } });
    f.scene.tokens.set("pc1", pc("pc1")); f.scene.tokens.set("pc2", pc("pc2")); f.scene.tokens.set("foreign", pc("foreign", false));
    canvas.tokens.controlled = [{ document: f.scene.tokens.get("pc2") }];
    game.user.targets = new Set([{ document: f.scene.tokens.get("pc1") }]);
    assert.equal(controller.getActingTokenId(undefined, "guard"), "pc1");
    assert.equal(controller.getActingTokenId("foreign", "guard"), undefined);
    game.user.targets.add({ document: f.scene.tokens.get("pc2") });
    assert.equal(controller.getActingTokenId(undefined, "guard"), undefined);
    game.user.targets = new Set([{ document: f.scene.tokens.get("foreign") }]);
    assert.equal(controller.getActingTokenId(undefined, "guard"), "pc2");
    game.user.targets = new Set([{ document: { id: "absent" } }]);
    assert.equal(controller.getActingTokenId(undefined, "guard"), "pc2");
    assert.deepEqual(f.scene.updates, []);
  } finally { await f.dispose(); }
});
