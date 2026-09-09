// Synthetic Foundry lifecycle for browser QA. It never connects to a world or a Foundry server.
const version = new URL(location.href).searchParams.get("version") || "14.366";
const instances = new Map(), hookEntries = new Map();
let hookId = 0;
globalThis.Hooks = { on(name, callback) { const id = ++hookId; hookEntries.set(id, { name, callback }); return id; }, off(name, id) { if (hookEntries.get(id)?.name === name) hookEntries.delete(id); }, callAll(name, ...args) { for (const entry of hookEntries.values()) if (entry.name === name) entry.callback(...args); } };
globalThis.errors = [];
globalThis.ui = { windows: {}, notifications: { error(message) { errors.push(message); }, warn(message) { globalThis.lastWarning = message; }, info(message) { globalThis.lastInfo = message; } }, hotbar: { _onResize() {} } };
const escape = Handlebars.escapeExpression;
Handlebars.registerHelper("checked", (flag) => flag ? "checked" : "");
Handlebars.registerHelper("localize", (value) => value);
Handlebars.registerHelper("selectOptions", (entries, { hash }) => new Handlebars.SafeString((hash.blank !== undefined ? `<option value="">${escape(hash.blank)}</option>` : "") + (entries ?? []).map((entry) => {
  const value = entry[hash.valueAttr ?? "value"], label = entry[hash.labelAttr ?? "label"];
  return `<option value="${escape(value)}" ${value === hash.selected ? "selected" : ""}>${escape(label)}</option>`;
}).join("")));
const templates = new Map();
async function renderTemplate(path, data) { if (!templates.has(path)) templates.set(path, Handlebars.compile(await (await fetch("/" + path)).text())); return templates.get(path)(data); }
class Application {
  constructor(options = {}) {
    this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options };
    this.id = this.options.id || crypto.randomUUID(); this.rendered = false; this.position = this.options.position || {};
    instances.set(this.id, this);
  }
  async _prepareContext() { return {}; }
  async _onRender() {}
  async _onClose() {}
  _insertElement(element) { document.body.append(element); if (this.options.window?.frame !== false) Object.assign(element.style, { position:"absolute", width:`${this.position.width ?? 800}px`, height:`${this.position.height ?? 700}px`, left:"100px", top:"80px", zIndex:"40" }); }
  render() {
    this.renderPromise = (this.renderPromise ?? Promise.resolve()).then(async () => {
      const context = await this._prepareContext({});
      const html = await renderTemplate(this.constructor.PARTS.main.template, context);
      if (!this.element) {
        this.element = document.createElement("div"); this.element.id = this.id;
        this.element.className = ["application", ...(this.options.classes ?? [])].join(" "); this.element.dataset.dmicherTheme = "dark";
        this.element.innerHTML = '<div class="window-content"></div>'; this._insertElement(this.element);
      }
      const scroll = (this.constructor.PARTS.main.scrollable ?? []).map((selector) => [selector, this.element.querySelector(selector)?.scrollTop ?? 0]);
      this.element.querySelector(".window-content").innerHTML = html;
      for (const [selector, top] of scroll) { const target = this.element.querySelector(selector); if (target) target.scrollTop = top; }
      this.rendered = true; this.fixtureContext = context;
      await this._onRender(context, {}); Hooks.callAll("renderApplicationV2", this, this.element);
      return this;
    });
    return this.renderPromise;
  }
  async close() { await this._onClose({}); this.element?.remove(); this.element = null; this.rendered = false; instances.delete(this.id); }
  bringToFront() {}
}
globalThis.foundry = { applications: { instances, api: { ApplicationV2: Application, HandlebarsApplicationMixin: (base) => base, DialogV2: { confirm: async () => { globalThis.confirmations = (globalThis.confirmations ?? 0) + 1; return true; } } },
  handlebars: { renderTemplate }, apps: { FilePicker: { implementation: class { constructor(options) { globalThis.lastFilePicker = options; } render() { return this; } } } }, ux: { TextEditor: { implementation: { getDragEventData: (event) => JSON.parse(event.dataTransfer.getData("text/plain")) } } } },
  utils: { deepClone: (value) => structuredClone(value), randomID: () => crypto.randomUUID().replaceAll("-", "").slice(0, 16) }, documents: {} };
const gm = { id: "gm", isGM: true, role: 4, active: true, name: "GM", getFlag: () => null, async setFlag() {} };
globalThis.game = { user: gm, users: new Map([["gm", gm]]), scenes: new Map(), macros: new Map(), modules: new Map(), messages: new Map(), paused: false,
  release: { generation: Number(version.split(".")[0]) }, i18n: { lang: "ru", localize: (value) => value }, settings: { get: (_module, key) => key === "theme" ? "dark" : undefined }, async togglePause(value) { this.paused = value; } };
class MacroFixture { constructor(data) { Object.assign(this, data, { documentName: "Macro", uuid: `Macro.${data.id}` }); this.sheet = { render: () => { globalThis.editedMacro = this.uuid; } }; } }
foundry.documents.Macro = { implementation: { async create(data) { const macro = new MacroFixture({ ...data, id: crypto.randomUUID() }); game.macros.set(macro.id, macro); return macro; } } };
game.macros.set("demo", new MacroFixture({ id: "demo", name: "Example macro" }));
game.items = new Map();
for (const data of [{ id: "rope", name: "Rope", type: "equipment", img: "icons/svg/item-bag.svg", system: { quantity: 7 } }, { id: "apple", name: "Apple", type: "consumable", img: "icons/svg/item-bag.svg", system: { quantity: 2 } }]) game.items.set(data.id, { ...data, documentName: "Item", uuid: `Item.${data.id}`, toObject: () => structuredClone(data) });
globalThis.fromUuid = async (uuid) => uuid?.startsWith("Item.") ? game.items.get(uuid.split(".")[1]) : game.macros.get(uuid?.split(".")[1]);
// Item sheets use their own change/submit owner, as in Foundry DocumentSheetV2
// with submitOnChange. This external form must not be handled by the docked editor.
globalThis.openNativeItemForm = () => {
  document.getElementById("native-item-fixture")?.remove();
  const form = document.createElement("form"); form.id = "native-item-fixture"; form.className = "application item";
  Object.assign(form.style, { position: "fixed", left: "120px", top: "140px", width: "320px", height: "140px", padding: "15px", zIndex: "80", background: "#303038" });
  form.innerHTML = '<label>Native Item name<input name="name" value="New Item" required></label><button type="submit">Save Item</button>';
  const item = { id: "native-fixture", name: "New Item", updates: [] }; globalThis.nativeItem = item;
  const save = (event) => { event.preventDefault(); if (!form.checkValidity()) return; const name = new FormData(form).get("name"); item.name = name; item.updates.push(name); };
  form.addEventListener("submit", save); form.addEventListener("change", save);
  document.body.append(form); Hooks.callAll("renderApplicationV2", { element: form }, form); form.elements.name.focus();
};
const { defaultDefinition, defaultTokenBehavior, emptyRuntime, MODULE_ID } = await import("/modules/dmicher-master-screen/scripts/model.js");
const definition = defaultDefinition(); definition.schemeName = "Town square";
definition.episodes[0].tokens.guard = defaultTokenBehavior();
definition.episodes[0].tokens.guard.speech.phrases = ["Hello traveller"];
definition.episodes[0].dialogues = [{ id: "talk", name: "Guard conversation", enabled: true, target: { type: "Token", id: "guard" }, range: 5, startNodeId: "start", nodes: [{ id: "start", text: "Welcome", responses: [] }] }];
definition.episodes[0].spawns = [{ id: "spawn", actorUuid: "Actor.guard", x: 100, y: 200, count: 1, spacing: 100 }];
definition.episodes[0].workspace.gm = [{ uuid: "JournalEntry.note", x: 10, y: 20, width: 300, height: 200 }];
const scene = { id: "scene-a", name: "Synthetic scene - no live world", tokens: new Map(), tiles: new Map(), grid: { size: 100, distance: 5 },
 flags: { [MODULE_ID]: { definitions: { main: definition }, runtimes: { main: emptyRuntime() } } },
 getFlag(scope, key) { return structuredClone(key.split(".").reduce((value, segment) => value?.[segment], this.flags[scope])); },
 async setFlag(scope, key, value) {
   let target = this.flags[scope] ??= {}; const parts = key.split(".");
   for (const part of parts.slice(0, -1)) target = target[part] ??= {};
   target[parts.at(-1)] = structuredClone(value);
   for (const [id] of Object.entries(target[parts.at(-1)] ?? {})) if (id.startsWith("-=")) { delete target[parts.at(-1)][id.slice(2)]; delete target[parts.at(-1)][id]; }
 } };
const token = { id: "guard", name: "Guard", x: 100, y: 100, texture: { src: "" }, getFlag() {}, actor: { id: "guard-actor", name: "Guard actor", testUserPermission: () => false } };
token.update = async function (changes) { Object.assign(this, structuredClone(changes)); return this; };
scene.tokens.set(token.id, token); game.scenes.set(scene.id, scene);
scene.tiles.set("menu", { id: "menu", name: "Menu", x: 150, y: 150, hidden: false, width: 100, height: 100, texture: { src: "" } });
scene.tokens.set("waiter", { ...token, id: "waiter", name: "Waiter", actor: { id: "waiter-actor", name: "Waiter actor", testUserPermission: () => false } });
globalThis.emptyScene = { ...scene, id: "scene-empty", name: "Empty scene", flags: {}, tokens: new Map(), tiles: new Map() };
game.scenes.set(emptyScene.id, emptyScene);
const navigation = Handlebars.compile(await (await fetch("/scene-navigation.hbs")).text());
document.getElementById("interface").insertAdjacentHTML("beforeend", navigation({ scenes: { active: [{ id: scene.id, name: scene.name, users: [{ name: "Player", letter: "P", color: "#999", border: "#222" }] }, { id: emptyScene.id, name: emptyScene.name }], levels: Number(version.split(".")[0]) === 14 ? [{ id: "level-a", sceneId: scene.id, name: "Ground floor" }] : [] } }));
const renderer = { screen: { width: innerWidth, height: innerHeight }, resize(width, height) { Object.assign(this.screen, { width, height }); } };
globalThis.canvas = { scene, ready: true, app: { renderer }, screenDimensions: [innerWidth, innerHeight], stage: { pivot: { x: 0, y: 0 }, position: { x: innerWidth / 2, y: innerHeight / 2, set(x, y) { this.x = x; this.y = y; } }, on() {}, off() {} }, pan() {}, tokens: { activate() {}, placeables: [], controlled: [] } };
const { ScreenController } = await import("/modules/dmicher-master-screen/scripts/controller.js");
const { installScreenSettingHelp } = await import("/modules/dmicher-master-screen/scripts/setting-help.js");
installScreenSettingHelp((page, anchor) => { globalThis.helpTarget = { page, anchor }; });
globalThis.controller = new ScreenController();
globalThis.scene = scene;
globalThis.controller.openScreen("panel");
await controller.editorOpening;
document.getElementById("open-panel").onclick = () => controller.openScreen("panel");
document.getElementById("open-window").onclick = () => controller.openScreen("window");
globalThis.ready = true;
