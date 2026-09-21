import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
import { commandDoorVisible } from "../dmicher-master-screen/scripts/object-command-visibility.js";
import { defaultObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";

async function doorFixture(generation = 13) {
  const f = await commandFixture({ commands: ["delegate"] });
  f.scene.tokenVision = true; game.release = { generation };
  const door = { id: "door", uuid: "Scene.scene.Wall.door", documentName: "Wall", parent: f.scene,
    door: 1, ds: 0, c: [300, 0, 300, 100] };
  f.scene.walls.set(door.id, door);
  f.flags.objectBindings.bindings["Wall:door"] = { type: "Wall", id: "door", commands: ["open", "close"].map(id => ({ ...defaultObjectCommand(id), enabled: true })) };
  const sources = [], samples = [];
  let visible = true;
  f.pc.sight = { enabled: true };
  f.pc.detectionModes = generation === 13 ? [{ id: "basicSight", enabled: true }] : { basicSight: { enabled: true } };
  Object.assign(f.pc.object, { controlled: false, hasSight: true, _getVisionSourceData: () => ({ x: 150, y: 50 }),
    control() { throw new Error("The GM must not select the player's character"); } });
  CONFIG.Canvas = {
    visionSourceClass: class {
      constructor({ object }) { this.object = object; this.blinded = {}; sources.push(this); }
      initialize(data) { this.data = data; this.los = {}; }
      destroy() { this.destroyed = true; }
    },
    detectionModes: { basicSight: { testVisibility(source, _mode, { tests }) {
      assert.equal(source.object, f.pc.object, "admission uses the issuer's sight, not the NPC's or GM's");
      samples.push(...tests.map(test => test.point));
      // The closed wall rejects its exact center and far face. The front face is visible.
      return visible && tests.some(({ point }) => point.x === 297 && point.y === 50);
    } } }
  };
  canvas.visibility = { _createVisibilityTestConfig: (input, { object }) => ({ object,
    tests: (generation >= 14 ? input : [input]).map(point => ({ point, los: new Map() })) }) };
  return { ...f, door, sources, samples, hide: () => { visible = false; } };
}

for (const generation of [13, 14]) test(`Foundry ${generation}: a player can command a visible closed door while GM has no character selected`, async () => {
  const f = await doorFixture(generation);
  await f.accept("delegate", { targetUuid: f.door.uuid, commandId: "open" });
  assert.equal(f.active().request.parameters.targetUuid, f.door.uuid);
  assert.equal(f.pc.object.controlled, false);
  assert.equal(f.pc.object.vision, undefined);
  assert.ok(f.sources.length > 0);
  assert.ok(f.sources.every(source => source.destroyed));
  assert.ok(f.samples.some(point => point.x === 297));
  assert.ok(f.samples.some(point => point.x === 303));
});

test("a truly unseen door still rejects either command without starting automation or writing the scene", async () => {
  const f = await doorFixture(); f.hide();
  const writes = f.writes(), signals = f.signals.length;
  for (const command of ["open", "close"]) {
    await assert.rejects(f.accept("delegate", { targetUuid: f.door.uuid, commandId: command }), error =>
      error.code === "visibility" && /character issuing the command.*chosen door/.test(error.message));
  }
  assert.equal(f.active(), null); assert.equal(f.writes(), writes); assert.equal(f.signals.length, signals);
  assert.ok(f.sources.every(source => source.destroyed));
});

test("a visible locked door still cannot be opened and malformed geometry never bypasses admission", async () => {
  const f = await doorFixture(); f.door.ds = 2;
  await assert.rejects(f.accept("delegate", { targetUuid: f.door.uuid, commandId: "open" }), error => error.code === "locked");
  f.scene.tokenVision = false;
  for (const coordinates of [undefined, [], [0, 0, 0, 0], [0, 0, Infinity, 2]]) {
    f.door.c = coordinates;
    assert.equal(commandDoorVisible(f.scene, f.pc, f.door), false);
  }
  assert.equal(f.active(), null);
});
