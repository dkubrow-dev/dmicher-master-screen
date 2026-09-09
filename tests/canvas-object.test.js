import test from "node:test";
import assert from "node:assert/strict";
import { findCanvasObject, canvasPointerPosition } from "../dmicher-master-screen/scripts/apps/canvas-object.js";

const object = (type, id, extra = {}) => ({ x: 10, y: 10, w: 100, h: 100, document: { documentName: type, id }, ...extra });
const event = (x = 20, y = 20) => ({ getLocalPosition: () => ({ x, y }), global: { x, y } });
test("constructor chooses the active native edit layer and supports non-token objects", () => {
  for (const type of ["Tile", "Drawing", "AmbientLight", "AmbientSound", "Note", "MeasuredTemplate", "Region"]) {
    const target = object(type, "target"), token = object("Token", "token");
    const board = { stage: {}, activeLayer: { placeables: [target] }, tokens: { placeables: [token] } };
    assert.deepEqual(findCanvasObject(board, event(), { constructorMode: true }), { type, id: "target" });
    assert.deepEqual(findCanvasObject(board, event()), { type: "Token", id: "token" });
  }
});
test("hidden objects remain editable by GM while players cannot discover them", () => {
  const token = object("Token", "hidden", { document: { documentName: "Token", id: "hidden", hidden: true } });
  const tile = object("Tile", "tile");
  const board = { tokens: { placeables: [token] }, tiles: { placeables: [tile] } };
  assert.equal(findCanvasObject(board, event(), { constructorMode: true }).id, "hidden");
  assert.equal(findCanvasObject(board, event()).id, "tile");
  tile.isVisible = false;
  assert.equal(findCanvasObject(board, event()), null);
});
test("native local hit areas are respected instead of axis-aligned bounding boxes", () => {
  const tile = object("Tile", "rotated", { toLocal: () => ({ x: 3, y: 4 }), hitArea: { contains: (x, y) => x === 3 && y === 4 } });
  assert.equal(findCanvasObject({ tiles: { placeables: [tile] } }, event(500, 500)).id, "rotated");
  tile.hitArea.contains = () => false;
  assert.equal(findCanvasObject({ tiles: { placeables: [tile] } }, event()), null);
});
test("context menu uses client coordinates and does not confuse map zoom with screen position", () => {
  assert.deepEqual(canvasPointerPosition({}, { nativeEvent: { clientX: 900, clientY: 700 }, global: { x: 1, y: 2 } }), { x: 900, y: 700 });
});
