import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkspacePresets, normalizeWorkspacePreset, remapWorkspacePresetReferences } from "../dmicher-master-screen/scripts/workspace-presets-model.js";
import { WorkspacePresetStore, WORKSPACE_PRESETS_FLAG } from "../dmicher-master-screen/scripts/workspace-presets-store.js";
import { WorkspacePresetsRuntime, WORKSPACE_NOTES_RUNTIME_FLAG } from "../dmicher-master-screen/scripts/workspace-presets-runtime.js";
import { WorkspaceWindowAdapter } from "../dmicher-master-screen/scripts/workspace-window-adapter.js";
import { registerKnownWorkspaceWindows } from "../dmicher-master-screen/scripts/workspace-window-targets.js";

const clone = value => structuredClone(value);
const windowEntry = (id, extra = {}) => ({ id, name: id, target: { kind: "document", uuid: `Actor.${id}` }, x: 10, y: 20, width: 500, height: 450, ...extra });
const preset = (id, entries = [], extra = {}) => ({ id, name: id, entries, ...extra });
const noteEntry = (id, extra = {}) => ({ id, name: id, data: { x: 100, y: 200, text: id, iconSize: 40 }, ...extra });
function fixture() {
  globalThis.game = { user: { id: "gm", isGM: true }, i18n: { lang: "en" } };
  const flags = {}, writes = [], notes = new Map(), apps = new Map(), files = new Map();
  const addNote = (id, data) => {
    const note = { id, ...clone(data), toObject() { const { toObject, getFlag, ...value } = this; return { ...clone(value), _id: id }; },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; } };
    notes.set(id, note); return note;
  };
  let nextNote = 0;
  const scene = { id: "scene", notes,
    getFlag(_scope, key) { return clone(flags[key]); },
    async setFlag(_scope, key, data) { writes.push({ key, data: clone(data) }); flags[key] = clone(data); },
    async createEmbeddedDocuments(type, data) { assert.equal(type, "Note"); writes.push({ create: clone(data) }); return data.map(value => addNote(`created-${++nextNote}`, value)); },
    async updateEmbeddedDocuments(type, data) { assert.equal(type, "Note"); writes.push({ update: clone(data) }); return data.map(value => addNote(value._id, value)); },
    async deleteEmbeddedDocuments(type, ids) { assert.equal(type, "Note"); writes.push({ delete: [...ids] }); for (const id of ids) notes.delete(id); return ids; }
  };
  globalThis.canvas = { scene };
  globalThis.localStorage = { getItem: key => files.get(key), setItem: (key, value) => files.set(key, value), removeItem: key => files.delete(key) };
  globalThis.foundry = { applications: { instances: apps } };
  globalThis.ui = { windows: {}, sidebar: { activeTab: "chat", async activateTab(tab) { this.activeTab = tab; } } };
  const addApp = (id, extra = {}) => {
    const document = { uuid: `Actor.${id}`, documentName: "Actor", testUserPermission: () => true };
    const app = { id, title: id, document, rendered: true, position: { left: 1, top: 2, width: 300, height: 400 },
      element: { hidden: false, style: {} }, closes: 0, renders: 0, fronts: 0,
      async render() { this.rendered = true; this.renders++; return this; },
      async close() { this.rendered = false; this.closes++; },
      setPosition(position) { this.position = { ...this.position, ...position }; },
      async minimize() { this.minimized = true; }, async maximize() { this.minimized = false; },
      async bringToFront() { this.fronts++; }, addEventListener() {}, ...extra };
    document.sheet = app; apps.set(id, app); return app;
  };
  globalThis.fromUuid = async uuid => [...apps.values()].map(app => app.document).find(document => document?.uuid === uuid);
  const runtime = new WorkspacePresetsRuntime();
  const save = (kind, value) => new WorkspacePresetStore(scene).save(kind, value);
  return { flags, writes, notes, apps, files, scene, runtime, save, addNote, addApp };
}

test("workspace preparation is explicit, revision guarded, and never writes while reading", async () => {
  const f = fixture(), store = new WorkspacePresetStore(f.scene);
  f.addApp("a"); f.addNote("original", { x: 3, y: 4, text: "Map" });
  assert.deepEqual(store.list(), { schemaVersion: 1, revision: 0, windows: [], notes: [] });
  const windows = f.runtime.capture(f.scene, "windows", { id: "windows", name: "Windows" });
  const notes = f.runtime.capture(f.scene, "notes", { id: "notes", name: "Notes" });
  assert.equal(f.writes.length, 0); assert.equal(windows.entries.length, 1); assert.equal(notes.entries[0].sourceId, "original");
  await store.save("windows", windows, { expectedRevision: 0 });
  await assert.rejects(store.save("notes", notes, { expectedRevision: 0 }), /another window/);
  assert.equal(store.list().notes.length, 0);
  game.user.isGM = false;
  assert.throws(() => f.runtime.capture(f.scene, "notes"));
  await assert.rejects(store.save("notes", notes));
  assert.equal(f.writes.length, 1);
});

test("workspace configuration validates finite geometry, unique targets and names", () => {
  assert.throws(() => normalizeWorkspacePreset("windows", preset("p", [windowEntry("a", { x: Infinity })])));
  assert.throws(() => normalizeWorkspacePreset("windows", preset("p", [windowEntry("a"), windowEntry("b", { target: { kind: "document", uuid: "Actor.a" } })])));
  assert.throws(() => normalizeWorkspacePresets({ windows: [preset("a"), preset("b", [], { name: "A" })] }));
  assert.throws(() => normalizeWorkspacePreset("notes", preset("p", [noteEntry("a", { data: { x: "bad" } })])));
  assert.throws(() => normalizeWorkspacePresets({ schemaVersion: 0 }));
});

test("switching and deactivating windows honors each close rule and preserves active identity after manual changes", async () => {
  const f = fixture(), a = f.addApp("a"), pinned = f.addApp("pinned"), b = f.addApp("b");
  await f.save("windows", preset("first", [windowEntry("a"), windowEntry("pinned", { closeOnLeave: false })]));
  await f.save("windows", preset("second", [windowEntry("b", { minimized: true })]));
  await f.runtime.activate(f.scene, "windows", "first");
  a.position.left = 700; await a.close();
  assert.equal(f.runtime.activePreset(f.scene, "windows"), "first");
  await f.runtime.activate(f.scene, "windows", "second");
  assert.equal(pinned.closes, 0); assert.equal(b.minimized, true); assert.equal(b.position.left, 10);
  await f.runtime.deactivate(f.scene, "windows");
  assert.equal(b.rendered, false); assert.equal(pinned.rendered, true); assert.equal(f.runtime.activePreset(f.scene, "windows"), null);
});

test("window activation restores focus and sidebar, and closes unrelated windows only by explicit option", async () => {
  const f = fixture(), a = f.addApp("a"), unrelated = f.addApp("unrelated");
  await f.save("windows", preset("layout", [windowEntry("a")], { activeWindowId: "a", sidebarTab: "journal", closeUnmanaged: true }));
  await f.runtime.activate(f.scene, "windows", "layout");
  assert.equal(unrelated.closes, 1); assert.equal(a.fronts, 1); assert.equal(ui.sidebar.activeTab, "journal");
  const reloaded = new WorkspacePresetsRuntime();
  assert.equal(reloaded.activePreset(f.scene, "windows"), "layout");
  await reloaded.deactivate(f.scene, "windows"); assert.equal(a.closes, 1);
});

test("unavailable windows report the missing reference before closing the previous layout", async () => {
  const f = fixture(), a = f.addApp("a");
  await f.save("windows", preset("a", [windowEntry("a")]));
  await f.save("windows", preset("missing", [windowEntry("missing")]));
  await f.runtime.activate(f.scene, "windows", "a");
  await assert.rejects(f.runtime.activate(f.scene, "windows", "missing"), /missing or unavailable/);
  assert.equal(a.closes, 0); assert.equal(f.runtime.activePreset(f.scene, "windows"), "a");
});

test("stale document lookup cannot open the old window or overwrite the next active preset", async () => {
  const f = fixture(), old = f.addApp("old", { rendered: false }), fresh = f.addApp("fresh", { rendered: false });
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  fromUuid = async uuid => { if (uuid === "Actor.old") { entered(); await new Promise(resolve => { release = resolve; }); } return f.apps.get(uuid.split(".")[1]).document; };
  await f.save("windows", preset("old", [windowEntry("old")])); await f.save("windows", preset("fresh", [windowEntry("fresh")]));
  const first = f.runtime.activate(f.scene, "windows", "old"); await started;
  const second = f.runtime.activate(f.scene, "windows", "fresh"); release();
  assert.equal(await first, false); assert.equal(await second, true);
  assert.equal(old.renders, 0); assert.equal(fresh.renders, 1); assert.equal(f.runtime.activePreset(f.scene, "windows"), "fresh");
});

test("note capture adopts originals only on explicit activation and revisiting never duplicates notes", async () => {
  const f = fixture(); f.addNote("original", { x: 5, y: 6, text: "Original" });
  const captured = f.runtime.capture(f.scene, "notes", { id: "first", name: "First" });
  await f.save("notes", captured); assert.equal(f.writes.some(write => write.update), false);
  f.addNote("unrelated", { x: 30, y: 40, text: "Unrelated" });
  await f.save("notes", preset("second", [noteEntry("new")]));
  await f.runtime.activate(f.scene, "notes", "first");
  assert.equal(f.notes.size, 2); assert.equal(f.notes.has("original"), true);
  await f.runtime.activate(f.scene, "notes", "second");
  assert.equal(f.notes.has("original"), false); assert.equal(f.notes.has("unrelated"), true); assert.equal(f.notes.size, 2);
  await f.runtime.activate(f.scene, "notes", "first"); await f.runtime.activate(f.scene, "notes", "first");
  assert.equal(f.notes.size, 2);
  const restored = [...f.notes.values()].find(note => note.text === "Original");
  assert.notEqual(restored.id, "original"); assert.equal(restored.x, 5);
});

test("notes kept on leave survive switching, deactivation and reload; unowned notes are never deleted", async () => {
  const f = fixture(); f.addNote("unrelated", { x: 1, y: 1, text: "Original" });
  await f.save("notes", preset("first", [noteEntry("pinned", { removeOnLeave: false }), noteEntry("temporary")]));
  await f.runtime.activate(f.scene, "notes", "first");
  const reloaded = new WorkspacePresetsRuntime();
  assert.equal(reloaded.activePreset(f.scene, "notes"), "first");
  await reloaded.deactivate(f.scene, "notes");
  assert.equal(f.notes.size, 2); assert.equal([...f.notes.values()].some(note => note.text === "pinned"), true);
  assert.equal(f.notes.has("unrelated"), true); assert.equal(f.flags[WORKSPACE_NOTES_RUNTIME_FLAG].presetId, "");
});

test("late native note creation is retired before a newer preset takes ownership", async () => {
  const f = fixture(); let release, entered;
  const create = f.scene.createEmbeddedDocuments, started = new Promise(resolve => { entered = resolve; });
  f.scene.createEmbeddedDocuments = async (type, data) => { if (data[0].text === "old") { entered(); await new Promise(resolve => { release = resolve; }); } return create(type, data); };
  await f.save("notes", preset("old", [noteEntry("old")])); await f.save("notes", preset("fresh", [noteEntry("fresh")]));
  const old = f.runtime.activate(f.scene, "notes", "old"); await started;
  const fresh = f.runtime.activate(f.scene, "notes", "fresh"); release();
  assert.equal(await old, false); assert.equal(await fresh, true);
  assert.deepEqual([...f.notes.values()].map(note => note.text), ["fresh"]);
});

test("a deleted or manually reassigned note is not deleted by its former configuration", async () => {
  const f = fixture(); await f.save("notes", preset("p", [noteEntry("a")]));
  await f.runtime.activate(f.scene, "notes", "p");
  const note = [...f.notes.values()][0]; note.flags = {};
  await f.runtime.deactivate(f.scene, "notes"); assert.equal(f.notes.has(note.id), true);
});

test("configuration transfer remaps typed links and drops foreign note capture hints without rewriting arbitrary data", () => {
  const source = normalizeWorkspacePresets({ windows: [preset("w", [windowEntry("a")])], notes: [preset("n", [noteEntry("note", {
    sourceSceneId: "old", sourceId: "original", data: { x: 1, y: 2, entryId: "journal", pageId: "page", flags: { other: { uuid: "Actor.a" } } }
  })])] });
  const result = remapWorkspacePresetReferences(source, { uuid: value => `${value}-copy`, journal: value => `${value}-copy`, page: value => `${value}-copy`, sceneId: "new" });
  assert.equal(result.windows[0].entries[0].target.uuid, "Actor.a-copy");
  const note = result.notes[0].entries[0]; assert.equal(note.data.entryId, "journal-copy"); assert.equal(note.data.pageId, "page-copy");
  assert.equal(note.data.flags.other.uuid, "Actor.a"); assert.equal(note.sourceId, ""); assert.equal(source.notes[0].entries[0].sourceId, "original");
});

test("explicit window factories restore module windows after reload without constructing saved classes", async () => {
  const f = fixture(), app = f.addApp("module-window", { document: null, rendered: false });
  const adapter = new WorkspaceWindowAdapter(); let calls = 0;
  adapter.register("dmicher:help", { match: candidate => candidate === app, open: () => { calls++; return app; } });
  assert.equal(await adapter.resolve({ kind: "application", id: "dmicher:help" }), app); assert.equal(calls, 1);
  await assert.rejects(adapter.resolve({ kind: "application", id: "globalThis.constructor" }), /unavailable/);
  adapter.dispose(); assert.equal(adapter.factories.size, 0);
});

test("automation windows capture typed object references and reopen only on their own scene", async () => {
  const f = fixture(), app = f.addApp("runtime-generated-id", { document: null, rendered: false });
  Object.assign(app, { sceneId: f.scene.id, descriptor: { type: "Tile", id: "tile" } });
  const controller = { objectWindows: new Map([["object", app]]), openObjectAutomation: descriptor => { assert.deepEqual(descriptor, app.descriptor); return app; } };
  const adapter = new WorkspaceWindowAdapter(), dispose = registerKnownWorkspaceWindows(controller, adapter);
  const target = adapter.target(app);
  assert.deepEqual(target, { kind: "application", id: "dmicher-master-screen-automation", uuid: "Scene.scene.Tile.tile" });
  assert.equal(await adapter.resolve(target), app);
  const imported = remapWorkspacePresetReferences({ windows: [preset("layout", [windowEntry("automation", { target })])] }, { uuid: value => value.replace("Scene.scene.", "Scene.copy.") });
  assert.equal(imported.windows[0].entries[0].target.uuid, "Scene.copy.Tile.tile");
  await assert.rejects(adapter.resolve(imported.windows[0].entries[0].target), /another scene/);
  dispose(); assert.equal(adapter.factories.size, 0);
});
