import test from "node:test";
import assert from "node:assert/strict";
import { buildControls, installControls } from "../dmicher-master-screen/scripts/controls.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const actions = [], errors = [];
  globalThis.game = { user: { isGM: true } };
  globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
  const controller = { openHelp: () => actions.push("help"), openScreen: (presentation) => actions.push(presentation) };
  return { actions, errors, controller };
}

test("category activation uses a hidden no-op tool and never opens the first action", async () => {
  const f = fixture(), control = buildControls(f.controller);
  const active = control.tools[control.activeTool];
  assert.ok(active);
  assert.equal(active.visible, false);
  assert.equal(active.button, false);
  control.onChange?.({}, true);
  active.onChange({}, true);
  active.onChange({}, false);
  await flush();
  assert.deepEqual(f.actions, []);
  assert.equal(Object.values(control.tools).filter((tool) => tool.visible).sort((a, b) => a.order - b.order)[0].name, "help");
});

test("all second-level actions explicitly open help, the panel or the browser window", async () => {
  const f = fixture(), control = buildControls(f.controller);
  for (const key of ["help", "panel", "window"]) {
    assert.equal(control.tools[key].button, true);
    control.tools[key].onChange({}, true);
    await flush();
  }
  assert.deepEqual(f.actions, ["help", "panel", "window"]);
  assert.equal(Object.values(control.tools).filter((tool) => tool.visible).length, 3);
  assert.notEqual(control.activeTool, "help");
});

test("players have no visible category and cannot invoke a retained GM action", async () => {
  const f = fixture(), original = buildControls(f.controller);
  game.user.isGM = false;
  assert.equal(buildControls(f.controller).visible, false);
  original.tools.panel.onChange({}, true);
  await flush();
  assert.deepEqual(f.actions, []);
});

test("a rejected asynchronous action reports the useful error instead of leaking rejection", async () => {
  const f = fixture();
  f.controller.openScreen = async () => { throw new Error("Mode unavailable"); };
  buildControls(f.controller).tools.window.onChange({}, true);
  await flush();
  assert.deepEqual(f.errors, ["Mode unavailable"]);
});

test("control hook preserves other modules and disposal removes only its own hook", () => {
  const f = fixture(), hooks = new Map();
  let index = 0;
  globalThis.Hooks = { on(name, callback) { hooks.set(++index, { name, callback }); return index; }, off(name, id) {
    if (hooks.get(id)?.name === name) hooks.delete(id);
  } };
  const unrelated = Hooks.on("getSceneControlButtons", () => {});
  const dispose = installControls(f.controller);
  const controls = { other: { name: "other" } };
  hooks.get(unrelated + 1).callback(controls);
  assert.equal(controls.other.name, "other");
  assert.equal(controls[MODULE_ID].name, MODULE_ID);
  dispose(); dispose();
  assert.deepEqual([...hooks.keys()], [unrelated]);
});
