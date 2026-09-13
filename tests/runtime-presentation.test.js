import test from "node:test";
import assert from "node:assert/strict";
import { GroupRuntime } from "../dmicher-master-screen/scripts/runtime.js";
import { SCENE_OBJECT_TYPES } from "../dmicher-master-screen/scripts/scene-object-types.js";

test("native animation frames never read Scene definitions or runtime history", () => {
  const hooks = new Map(); let reads = 0, refreshes = 0, updates = 0;
  globalThis.Hooks = { on(name, callback) { hooks.set(name, callback); return name; }, off(name) { hooks.delete(name); } };
  const scene = { id: "scene", getFlag() { reads++; throw new Error("A frame read Scene data"); } };
  globalThis.canvas = { scene };
  const runtime = new GroupRuntime({ combat: {}, effects: {}, visuals: {
    refresh() { refreshes++; }, update() { updates++; }, clear() {}
  } });
  runtime.start();
  try {
    for (const type of SCENE_OBJECT_TYPES) {
      const document = { id: "object", parent: scene, documentName: type };
      for (let frame = 0; frame < 600; frame++) hooks.get(`refresh${type}`)({ document });
    }
    assert.equal(reads, 0); assert.equal(updates, 0);
    assert.equal(refreshes, SCENE_OBJECT_TYPES.length * 600);
  } finally { runtime.dispose(); delete globalThis.Hooks; }
});
