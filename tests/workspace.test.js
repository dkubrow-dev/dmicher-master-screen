import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceManager } from "../dmicher-master-screen/scripts/workspace.js";
import { MODULE_ID, emptyRuntime, defaultEpisode } from "../dmicher-master-screen/scripts/model.js";
import { requestHalt, finishHalt } from "../dmicher-master-screen/scripts/execution.js";

const copy = (value) => structuredClone(value);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const docs = new Map(), warnings = [], hooks = new Map();
  let hookId = 0;
  globalThis.Hooks = {
    on(name, callback) { hooks.set(++hookId, { name, callback }); return hookId; },
    off(name, id) { if (hooks.get(id)?.name === name) hooks.delete(id); },
    callAll(name, ...args) { for (const value of hooks.values()) if (value.name === name) value.callback(...args); }
  };
  const flags = {};
  globalThis.game = { user: { id: "gm", isGM: true,
    getFlag: (scope, key) => copy(flags[scope]?.[key]), async setFlag(scope, key, data) {
      flags[scope] ??= {}; flags[scope][key] = copy(data);
    }
  } };
  globalThis.ui = { windows: {}, notifications: { warn: (message) => warnings.push(message) } };
  globalThis.foundry = { applications: { instances: new Map() } };
  globalThis.fromUuid = async (uuid) => docs.get(uuid);
  const createSheet = (uuid, { rendered = false, visible = true } = {}) => {
    const listeners = new Map();
    const doc = { uuid, documentName: uuid.split(".")[0], testUserPermission: () => visible };
    const app = { document: doc, rendered, position: { left: 1, top: 2, width: 300, height: 400 }, renders: 0, closes: 0,
      async render() { this.renders++; this.rendered = true; return this; },
      async close() { this.closes++; this.rendered = false; this.emit("close"); },
      setPosition(position) { Object.assign(this.position, position); this.emit("position"); },
      addEventListener(name, listener) { let set = listeners.get(name); if (!set) listeners.set(name, set = new Set()); set.add(listener); },
      removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
      emit(name) { for (const callback of listeners.get(name) ?? []) callback(); }, listeners
    };
    doc.sheet = app; docs.set(uuid, doc); foundry.applications.instances.set(uuid, app);
    return app;
  };
  const createScene = (id, gm = [], players = []) => {
    const state = { ...emptyRuntime(), episodeId: "calm", runId: `run-${id}`, episode: { ...defaultEpisode("Calm", "calm"), workspace: { gm, players } } };
    return { id, state, getFlag: (scope, key) => scope === MODULE_ID && key === "runtimes" ? { main: copy(state) } : undefined };
  };
  globalThis.canvas = { scene: null };
  const entry = (uuid, x = 10, y = 20) => ({ uuid, x, y, width: 500, height: 450 });
  return { createSheet, createScene, entry, flags, docs, warnings, hooks };
}

test("halt blocks a delayed workspace lookup without closing sheets already shown", async () => {
  const f = fixture(), visible = f.createSheet("Actor.visible"), delayed = f.createSheet("Actor.delayed");
  const scene = f.createScene("a", [f.entry(visible.document.uuid), f.entry(delayed.document.uuid)]);
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  globalThis.fromUuid = async (uuid) => {
    if (uuid === delayed.document.uuid) { started(); await new Promise((resolve) => { release = resolve; }); }
    return f.docs.get(uuid);
  };
  const manager = new WorkspaceManager(); canvas.scene = scene;
  const presenting = manager.apply(scene);
  await entered;
  const generation = requestHalt(scene);
  assert.equal(visible.rendered, true);
  release();
  await presenting;
  scene.state.halted = true;
  finishHalt(scene, generation);
  await manager.apply(scene);
  assert.equal(delayed.renders, 0);
  assert.equal(visible.rendered, true);
  visible.setPosition({ left: 912 }); await manager.saving;
  assert.equal(f.flags[MODULE_ID].workspaces["a:main"].entries.find((entry) => entry.uuid === visible.document.uuid).x, 912);
  await manager.close();
});

test("A to B to A restores that scene's manual positions and closes only owned sheets", async () => {
  const f = fixture(), a = f.createSheet("Actor.a"), b = f.createSheet("Actor.b");
  const sceneA = f.createScene("a", [f.entry("Actor.a")]), sceneB = f.createScene("b", [f.entry("Actor.b")]);
  const manager = new WorkspaceManager();
  canvas.scene = sceneA; await manager.apply(sceneA);
  a.setPosition({ left: 222, top: 333 }); await manager.saving;
  canvas.scene = sceneB; await manager.apply(sceneB);
  assert.equal(a.rendered, false); assert.equal(b.rendered, true);
  canvas.scene = sceneA; await manager.apply(sceneA);
  assert.equal(a.rendered, true); assert.equal(b.rendered, false);
  assert.equal(a.position.left, 222); assert.equal(a.position.top, 333);
  assert.equal(f.flags[MODULE_ID].workspaces["a:main"].runId, "run-a");
  await manager.close();
});

test("reconnect preserves manual geometry and closed windows; a new entry resets the plan", async () => {
  const f = fixture(), app = f.createSheet("Actor.a"), closed = f.createSheet("JournalEntry.b");
  const scene = f.createScene("a", [f.entry("Actor.a"), f.entry("JournalEntry.b")]);
  canvas.scene = scene;
  const first = new WorkspaceManager(); await first.apply(scene);
  app.setPosition({ left: 700 }); await closed.close(); await first.saving;
  await first.release();
  const restored = new WorkspaceManager(); await restored.apply(scene);
  assert.equal(app.position.left, 700);
  assert.equal(closed.rendered, false);
  scene.state.runId = "new-entry";
  await restored.apply(scene);
  assert.equal(app.position.left, 10);
  assert.equal(closed.rendered, true);
  await restored.close();
});

test("an existing user sheet can be positioned but is never owned or closed by Screen", async () => {
  const f = fixture(), app = f.createSheet("Actor.existing", { rendered: true });
  const scene = f.createScene("a", [f.entry(app.document.uuid, 321)]);
  canvas.scene = scene;
  const manager = new WorkspaceManager(); await manager.apply(scene); await manager.close();
  assert.equal(app.position.left, 321);
  assert.equal(app.rendered, true);
  assert.equal(app.closes, 0);
  assert.equal([...app.listeners.values()].every((set) => set.size === 0), true);
});

test("a delayed old UUID lookup cannot open or close a new scene's sheet", async () => {
  const f = fixture(), old = f.createSheet("Actor.old"), current = f.createSheet("Actor.current");
  const a = f.createScene("a", [f.entry(old.document.uuid)]), b = f.createScene("b", [f.entry(current.document.uuid)]);
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  globalThis.fromUuid = async (uuid) => {
    if (uuid === old.document.uuid) { started(); await new Promise((resolve) => { release = resolve; }); }
    return f.docs.get(uuid);
  };
  const manager = new WorkspaceManager(); canvas.scene = a;
  const first = manager.apply(a); await entered;
  canvas.scene = b; const second = manager.apply(b); release();
  await Promise.all([first, second]);
  assert.equal(old.renders, 0); assert.equal(current.rendered, true); assert.equal(current.closes, 0);
  assert.equal(f.flags[MODULE_ID].workspaces["a:main"].entries[0].uuid, old.document.uuid, "interrupted plan is retained for return");
  await manager.close();
});

test("slow stale render is cleaned before the new lifecycle can own the same sheet", async () => {
  const f = fixture(), app = f.createSheet("Actor.shared");
  const a = f.createScene("a", [f.entry(app.document.uuid, 10)]), b = f.createScene("b", [f.entry(app.document.uuid, 80)]);
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  const actualRender = app.render;
  app.render = async function () {
    if (!this.renders) { this.renders++; started(); await new Promise((resolve) => { release = resolve; }); this.rendered = true; return this; }
    return actualRender.call(this);
  };
  const manager = new WorkspaceManager(); canvas.scene = a;
  const first = manager.apply(a); await entered;
  canvas.scene = b; const second = manager.apply(b); release();
  await Promise.all([first, second]);
  assert.equal(app.rendered, true); assert.equal(app.position.left, 80);
  assert.equal(app.closes, 1);
  await manager.close();
});

test("close suppresses automatic reopening until a new episode entry, including reconnect", async () => {
  const f = fixture(), app = f.createSheet("Actor.a"), scene = f.createScene("a", [f.entry(app.document.uuid)]);
  canvas.scene = scene;
  const manager = new WorkspaceManager(); await manager.apply(scene); await manager.close();
  await manager.apply(scene);
  assert.equal(app.rendered, false);
  const restored = new WorkspaceManager(); await restored.apply(scene);
  assert.equal(app.rendered, false);
  scene.state.runId = "reentry"; await restored.apply(scene);
  assert.equal(app.rendered, true);
  await restored.close();
});

test("player workspace checks document permissions and does not expose the GM plan", async () => {
  const f = fixture(), gm = f.createSheet("JournalEntry.secret"), allowed = f.createSheet("Actor.player"), denied = f.createSheet("Actor.denied", { visible: false });
  const scene = f.createScene("a", [f.entry(gm.document.uuid)], [f.entry(allowed.document.uuid), f.entry(denied.document.uuid)]);
  game.user.isGM = false; canvas.scene = scene;
  const manager = new WorkspaceManager(); await manager.apply(scene);
  assert.equal(gm.renders, 0); assert.equal(denied.renders, 0); assert.equal(allowed.renders, 1);
  await manager.close();
});

test("ApplicationV1 render waits for its actual hook and releases legacy listeners", async () => {
  const f = fixture(), app = f.createSheet("Actor.legacy"), scene = f.createScene("a", [f.entry(app.document.uuid, 222)]);
  delete app.addEventListener; delete app.removeEventListener;
  app.render = function () { this.renders++; return this; };
  const manager = new WorkspaceManager(); canvas.scene = scene;
  const pending = manager.apply(scene);
  await flush();
  assert.equal(app.position.left, 1);
  app.rendered = true; Hooks.callAll("renderApplication", app);
  await pending;
  assert.equal(app.position.left, 222);
  assert.equal([...f.hooks.values()].some((hook) => hook.name === "renderApplication"), false);
  await manager.close();
  assert.equal(f.hooks.size, 0);
});
