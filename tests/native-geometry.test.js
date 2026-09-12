import test from "node:test";
import assert from "node:assert/strict";
import { sceneObjectBounds, sceneObjectCenter, isSceneObjectHidden } from "../dmicher-master-screen/scripts/scene-object-geometry.js";
import { readObjectGeometry, planScriptMovement, advanceScriptMovement, scriptObjectCapabilities } from "../dmicher-master-screen/scripts/script-movement.js";
const scene = { grid: { size: 100, distance: 5 } };
function document(type, data) {
  const calls = [];
  return { documentName: type, parent: scene, ...data, calls, async update(changes) {
    calls.push(structuredClone(changes));
    for (const [key, value] of Object.entries(changes)) { const path = key.split("."), last = path.pop(), target = path.reduce((o, name) => o[name] ??= {}, this); target[last] = structuredClone(value); }
  } };
}
const move = (parameters) => ({ timeMode: "duration", duration: 1, ...parameters });
test("native origins and dimensions distinguish tokens, drawings, walls and point objects", () => {
  assert.deepEqual(sceneObjectCenter(document("Token", { x: 10, y: 20, width: 2, height: 1 })), { x: 110, y: 70 });
  assert.deepEqual(sceneObjectCenter(document("Drawing", { x: 10, y: 20, shape: { width: 200, height: 100 } })), { x: 110, y: 70 });
  assert.deepEqual(sceneObjectCenter(document("Wall", { c: [10, 20, 210, 120] })), { x: 110, y: 70 });
  for (const type of ["AmbientLight", "AmbientSound", "Note", "MeasuredTemplate"]) assert.deepEqual(sceneObjectCenter(document(type, { x: 10, y: 20, radius: 50 })), { x: 10, y: 20 });
  assert.equal(sceneObjectCenter({ documentName: "Note" }), null); assert.equal(isSceneObjectHidden({ hidden: false }), false);
});
test("Drawing resize writes shape dimensions and scales polygon points", async () => {
  const drawing = document("Drawing", { x: 10, y: 20, rotation: 0, hidden: false, shape: { width: 100, height: 200, points: [0, 0, 100, 0, 100, 200] } });
  assert.deepEqual(readObjectGeometry(drawing).size, { x: 1, y: 2, z: null });
  const movement = planScriptMovement(scene, drawing, move({ position: { x: 30, y: 40, speed: 5 }, size: { x: 2, y: 1, z: null, speed: 1 } }));
  await advanceScriptMovement(scene, drawing, movement, 1);
  assert.equal(drawing.x, 30); assert.deepEqual(drawing.shape, { width: 200, height: 100, points: [0, 0, 200, 0, 200, 100] });
  assert.equal(Object.hasOwn(drawing, "width"), false);
});
test("Wall movement and rotation transform native endpoints without creating x, hidden or size fields", async () => {
  const wall = document("Wall", { c: [0, 0, 100, 0] });
  assert.deepEqual(readObjectGeometry(wall), { position: { x: 50, y: 0 }, rotation: 0, size: null });
  assert.equal(scriptObjectCapabilities(wall).visibility, false);
  assert.throws(() => planScriptMovement(scene, wall, move({ size: { x: 2, speed: 1 } })));
  const movement = planScriptMovement(scene, wall, move({ position: { x: 100, y: 100, speed: 5 }, rotation: { angle: 90, mode: "relative", speed: 90 } }));
  await advanceScriptMovement(scene, wall, movement, 1);
  assert.deepEqual(wall.c, [100, 50, 100, 150]); assert.deepEqual(Object.keys(wall.calls[0]), ["c"]);
});
test("Region translation uses current documents despite stale rendering and retains holes and polygon origin", async () => {
  const region = document("Region", { shapes: [{ type: "rectangle", x: 10, y: 20, width: 100, height: 100, hole: false }, { type: "polygon", points: [20, 30, 30, 30, 30, 40], origin: { x: 20, y: 30 }, hole: true }], object: { bounds: { x: 999, y: 999, width: 100, height: 100 } } });
  assert.deepEqual(readObjectGeometry(region).position, { x: 10, y: 20 });
  const movement = planScriptMovement(scene, region, move({ position: { x: 110, y: 220, speed: 5 } }));
  await advanceScriptMovement(scene, region, movement, 0.5); await advanceScriptMovement(scene, region, movement, 0.5);
  assert.deepEqual(region.shapes[0], { type: "rectangle", x: 110, y: 220, width: 100, height: 100, hole: false });
  assert.deepEqual(region.shapes[1], { type: "polygon", points: [120, 230, 130, 230, 130, 240], origin: { x: 120, y: 230 }, hole: true });
  assert.equal(Object.hasOwn(region, "x"), false); assert.deepEqual(Object.keys(region.calls[0]), ["shapes"]);
});
test("MeasuredTemplate rotation uses direction, and other point objects reject missing native dimensions", async () => {
  const template = document("MeasuredTemplate", { x: 10, y: 20, direction: 0, hidden: false });
  const movement = planScriptMovement(scene, template, move({ rotation: { mode: "absolute", angle: 120, speed: 90 } }));
  await advanceScriptMovement(scene, template, movement, 1); assert.equal(template.direction, 120); assert.equal(Object.hasOwn(template, "rotation"), false);
  for (const type of ["AmbientLight", "AmbientSound", "Note"]) {
    const point = document(type, { x: 10, y: 20 }); assert.equal(readObjectGeometry(point).size, null);
    assert.throws(() => planScriptMovement(scene, point, move({ size: { x: 1, speed: 1 } })));
  }
  assert.equal(scriptObjectCapabilities(document("Region", { shapes: [{ type: "grid", offsets: [0] }] })).position, false);
});
