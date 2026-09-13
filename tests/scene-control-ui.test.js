import test from "node:test";
import assert from "node:assert/strict";
import { sampleGroupDefinition } from "./fixtures/definitions.js";
import { emptyRuntime } from "../dmicher-master-screen/scripts/model.js";

class ApplicationStub {
  constructor() { this.rendered = true; }
  async _prepareContext() { return {}; }
  render() { return this; }
}
globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationStub,
  HandlebarsApplicationMixin: (base) => base, DialogV2: {} } }, utils: { deepClone: structuredClone } };
const { MasterScreenApplication } = await import("../dmicher-master-screen/scripts/apps/ide.js");
const { EditorApplication } = await import("../dmicher-master-screen/scripts/apps/editor.js");
const { scenePreparationKey } = await import("../dmicher-master-screen/scripts/apps/scene-refresh.js");

const deferred = () => { let resolve; return { promise: new Promise((done) => { resolve = done; }), get resolve() { return resolve; } }; };
function fixture(Application = MasterScreenApplication) {
  const definition = sampleGroupDefinition(), runtime = emptyRuntime();
  runtime.stateId = "calm";
  const flags = { groupDefinitions: { main: definition }, groupRuntimes: { main: runtime } };
  const token = { id: "npc", name: "NPC", documentName: "Token", x: 1, y: 2 };
  const scene = { id: "scene", name: "Scene", getFlag: (_module, key) => flags[key], tokens: new Map([[token.id, token]]) };
  const context = { scene, definitions: [definition], definition, runtime, state: definition.states[0],
    isGM: true, sceneHalted: false, restoringInitial: false, tokens: [], signalLog: [] };
  const calls = [], controller = { getContext: () => context,
    haltScene: () => calls.push("stop"), startAll: () => calls.push("start"), restoreAllInitial: () => calls.push("restore") };
  globalThis.game = { user: { isGM: true }, i18n: { lang: "en" }, settings: { get: () => "dark" } };
  const app = new Application(controller, { mode: "director" });
  app.selectionSceneId = scene.id;
  app.contextKey = "scene:calm";
  app.element = { querySelector: () => null, querySelectorAll: () => [] };
  return { app, scene, context, definition, runtime, flags, token, calls };
}

test("scene controls dispatch immediately despite a stale draft and a pending render", async () => {
  for (const Application of [EditorApplication, MasterScreenApplication]) {
    const f = fixture(Application), rendering = deferred();
    f.app.contextKey = "old-scene:removed-state";
    f.app.refreshTask = rendering.promise;
    f.app.signalAction = () => { throw new Error("Scene commands must not enter the signal editor"); };
    const stopped = f.app.handleAction("haltScene", {});
    assert.deepEqual(f.calls, ["stop"], "dispatch does not wait for an editor promise or draft validation");
    const started = f.app.handleAction("resumeAll", {}), restored = f.app.handleAction("restoreAllInitial", {});
    assert.deepEqual(f.calls, ["stop", "start", "restore"]);
    await Promise.all([stopped, started, restored]);
    assert.equal(f.app.contextKey, "old-scene:removed-state");
    rendering.resolve();
  }
});

test("execution steps, movement and signals leave Director controls mounted", async () => {
  const f = fixture();
  f.app.preparedRefreshKey = f.app.sceneRefreshKey(f.scene);
  let renders = 0;
  f.app.render = async () => { renders++; f.app.preparedRefreshKey = f.app.sceneRefreshKey(f.scene); };
  for (let index = 0; index < 120; index++) {
    f.runtime.scriptStates = { "Token:npc": { stepId: index % 13 + 1, remainingMs: index } };
    f.flags.dialogueSessions = { tick: index };
    f.context.signalLog.push({ id: index });
    f.token.x++;
    await f.app.refreshFromScene(f.scene);
  }
  assert.equal(renders, 0);
  f.runtime.stateId = "tension";
  await f.app.refreshFromScene(f.scene);
  assert.equal(renders, 1, "visible group state still updates");
});

test("reference/preparation changes refresh the IDE while runtime noise cannot prolong that render", async () => {
  const f = fixture(), pending = deferred();
  f.app.preparedRefreshKey = f.app.sceneRefreshKey(f.scene);
  let renders = 0;
  f.app.render = async () => { renders++; f.app.preparedRefreshKey = f.app.sceneRefreshKey(f.scene); await pending.promise; };
  f.token.name = "Renamed";
  const task = f.app.refreshFromScene(f.scene);
  await Promise.resolve();
  for (let index = 0; index < 20; index++) {
    f.runtime.scriptStates = { wait: { remainingMs: index } };
    f.app.refreshFromScene(f.scene);
  }
  pending.resolve(); await task;
  assert.equal(renders, 1);
  assert.equal(f.app.refreshTask, null);
  const key = scenePreparationKey(f.scene);
  f.flags.objectBindings = { revision: 3, bindings: {} };
  assert.notEqual(scenePreparationKey(f.scene), key);
});

test("pending stop updates stable scene buttons before a queued render settles", async () => {
  const f = fixture(), pending = deferred();
  const controls = ["stop", "resume", "restore"].map((sceneControl) => ({ dataset: { sceneControl }, hidden: sceneControl !== "stop" }));
  f.app.element.querySelectorAll = () => controls;
  f.app.preparedRefreshKey = f.app.sceneRefreshKey(f.scene);
  f.app.refreshTask = pending.promise;
  f.context.sceneHalted = true;
  const stopped = f.app.refreshFromScene(f.scene);
  assert.deepEqual(controls.map(({ hidden }) => hidden), [true, false, false]);
  f.context.restoringInitial = true;
  const restoring = f.app.refreshFromScene(f.scene);
  assert.deepEqual(controls.map(({ hidden }) => hidden), [false, true, true], "restoration exposes emergency stop immediately");
  pending.resolve(); await Promise.all([stopped, restoring]);
});

test("only a visible runtime detail panel depends on counters or the old signal journal", () => {
  const f = fixture();
  f.app.layout.preferences.mainTab = "other";
  f.app.layout.preferences.detailTab = "parameters";
  f.app.otherBlock = "counts";
  const counts = f.app.sceneRefreshKey(f.scene);
  f.runtime.conditionCounts = { greeting: 2 };
  assert.notEqual(f.app.sceneRefreshKey(f.scene), counts);
  f.app.layout.preferences.detailTab = "console";
  const consoleKey = f.app.sceneRefreshKey(f.scene);
  f.runtime.conditionCounts.greeting++;
  f.context.signalLog.push({ id: "signal" });
  assert.equal(f.app.sceneRefreshKey(f.scene), consoleKey);
  f.app.layout.preferences.detailTab = "parameters";
  f.app.otherBlock = "journal";
  const journal = f.app.sceneRefreshKey(f.scene);
  f.context.signalLog.push({ id: "next" });
  assert.notEqual(f.app.sceneRefreshKey(f.scene), journal);
});
