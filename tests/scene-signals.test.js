import test from "node:test";
import assert from "node:assert/strict";
import { installSceneSignals } from "../dmicher-master-screen/scripts/scene-signals.js";

function setup() {
  const gm = { id: "gm", role: 4, isGM: true, active: true, viewedScene: "one" };
  const player = { id: "player", role: 1, active: true, viewedScene: "one" };
  const scenes = new Map(["one", "two"].map(id => [id, { id, uuid: `Scene.${id}` }]));
  globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player]]), scenes };
  globalThis.canvas = { scene: scenes.get("one") };
  const entries = new Map(), calls = [], errors = [];
  const hooks = { on(name, callback) { const id = Symbol(name); entries.set(id, { name, callback }); return id; }, off(_name, id) { entries.delete(id); } };
  const dispose = installSceneSignals({ emit: async (scene, packet) => calls.push({ scene, ...packet }) }, { hooks, onError: error => errors.push(error) });
  const fire = async (name, ...args) => { for (const entry of entries.values()) if (entry.name === name) entry.callback(...args); await Promise.resolve(); await Promise.resolve(); };
  return { gm, player, scenes, calls, errors, fire, dispose, entries };
}
test("scene lifecycle observes navigation changes once and reconnect snapshots do not replay activation", async () => {
  const f = setup();
  assert.equal(f.calls.length, 0);
  await f.fire("renderSceneNavigation"); assert.equal(f.calls.length, 0);
  f.player.viewedScene = "two"; await f.fire("renderSceneNavigation");
  assert.deepEqual(f.calls.map(entry => [entry.name, entry.parameters.sceneUuid]), [["userLeft", "Scene.one"], ["userEntered", "Scene.two"]]);
  assert.ok(f.calls.every(entry => entry.parameters.userUuid === "User.player"));
  await f.fire("renderSceneNavigation"); assert.equal(f.calls.length, 2);
  f.player.active = false; await f.fire("userConnected", f.player, false);
  assert.equal(f.calls.at(-1).name, "userLeft");
  await f.fire("updateScene", f.scenes.get("two"), { name: "Renamed" }); assert.equal(f.calls.length, 3);
  await f.fire("updateScene", f.scenes.get("two"), { active: true }); assert.deepEqual(f.calls.at(-1).parameters, {});
  await f.fire("pauseGame", true); assert.deepEqual(f.calls.at(-1).parameters, { sceneUuid: "Scene.one", paused: true });
  f.dispose(); assert.equal(f.entries.size, 0); assert.deepEqual(f.errors, []);
});
test("non-authority clients observe state without invoking subscribers", async () => {
  const f = setup(); game.user = f.player;
  await f.fire("updateScene", f.scenes.get("one"), { active: true });
  f.player.viewedScene = "two"; await f.fire("renderSceneNavigation"); await f.fire("pauseGame", false);
  assert.deepEqual(f.calls, []); f.dispose();
});
