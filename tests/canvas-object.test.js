import test from "node:test";
import assert from "node:assert/strict";
import { findCanvasObject, canvasPointerPosition, focusCanvasObject, clearCanvasObjectFocus, listenCanvasObjectClicks } from "../dmicher-master-screen/scripts/apps/canvas-object.js";

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
test("native child targets and wall hit areas open the corresponding constructor object", () => {
  const wall = object("Wall", "wall", { document: { documentName: "Wall", id: "wall", c: [100, 0, 100, 300] } });
  const board = { stage: {}, activeLayer: { placeables: [wall] } };
  assert.deepEqual(findCanvasObject(board, { ...event(100, 150), target: { parent: wall } }, { constructorMode: true }), { type: "Wall", id: "wall" });
  assert.deepEqual(findCanvasObject(board, event(105, 150), { constructorMode: true }), { type: "Wall", id: "wall" });
  assert.equal(findCanvasObject(board, event(120, 150), { constructorMode: true }), null);
});
test("focusing activates native tools, controls and frames the object without document writes", async () => {
  const calls = [], tickers = new Set();
  class Graphics { clear() { return this; } lineStyle() { return this; } drawRect(...args) { calls.push(["frame", ...args]); return this; } destroy() { calls.push(["destroy"]); } }
  globalThis.PIXI = { Graphics };
  const drawing = { id: "drawing", documentName: "Drawing", x: 20, y: 30, shape: { width: 200, height: 100 } };
  drawing.object = { document: drawing, control: (options) => calls.push(["control", options]) };
  const layer = { activate: (options) => calls.push(["layer", options]), releaseAll: () => calls.push(["release"]) };
  const board = { scene: { id: "scene", drawings: new Map([[drawing.id, drawing]]) }, drawings: layer,
    stage: { scale: { x: 1 }, addChild(frame) { frame.parent = this; }, removeChild: () => {} },
    app: { ticker: { add: (fn) => tickers.add(fn), remove: (fn) => tickers.delete(fn) } }, animatePan: (options) => calls.push(["pan", options]) };
  assert.equal(await focusCanvasObject(board, { type: "Drawing", id: drawing.id }), true);
  assert.deepEqual(calls[0], ["layer", { tool: "select" }]); assert.ok(calls.some(([kind]) => kind === "control"));
  assert.deepEqual(calls.at(-1), ["pan", { x: 120, y: 80, duration: 250 }]); assert.equal(tickers.size, 1);
  drawing.x = 80; [...tickers][0](); assert.equal(calls.at(-1)[1], 75);
  clearCanvasObjectFocus(board); assert.equal(tickers.size, 0); assert.equal(calls.at(-1)[0], "destroy");
  assert.equal(await focusCanvasObject(board, { type: "Wall", id: "missing" }), false);
  delete globalThis.PIXI;
});
test("capture observes clicks but not drags, and disposal removes both listeners", () => {
  const listeners = new Map(), stage = { on: (name, fn) => listeners.set(name, fn), off: (name) => listeners.delete(name) }, received = [];
  const dispose = listenCanvasObjectClicks({ stage }, (event) => received.push(event));
  listeners.get("pointerdowncapture")({ global: { x: 0, y: 0 } }); listeners.get("pointertapcapture")({ global: { x: 100, y: 0 } });
  assert.equal(received.length, 0);
  listeners.get("pointerdowncapture")({ global: { x: 10, y: 10 } }); listeners.get("pointertapcapture")({ global: { x: 12, y: 10 } });
  assert.equal(received.length, 1); dispose(); assert.equal(listeners.size, 0);
});
test("constructor creation tools never fall through to tokens on inactive layers", () => {
  const token = object("Token", "token"), wall = object("Wall", "wall");
  const board = { stage: {}, tokens: { placeables: [token] }, walls: { placeables: [] }, lighting: { placeables: [] } };
  for (const layer of [board.walls, board.lighting]) {
    board.activeLayer = layer;
    assert.equal(findCanvasObject(board, event(), { constructorMode: true }), null);
    assert.equal(findCanvasObject(board, { ...event(), target: token }, { constructorMode: true }), null);
  }
  board.activeLayer = board.walls; board.walls.placeables.push(wall);
  globalThis.ui = { controls: { control: { name: "walls", tools: { select: {}, wall: {} } }, tool: { name: "wall" } } };
  assert.equal(findCanvasObject(board, { ...event(), target: wall }, { constructorMode: true }), null);
  globalThis.ui.controls.tool.name = "select";
  assert.equal(findCanvasObject(board, { ...event(), target: wall }, { constructorMode: true }).id, "wall");
  delete globalThis.ui;
});
test("focus uses available native tools in Foundry 13 and 14", async () => {
  const types = { Token: ["tokens", "select"], Wall: ["walls", "select"], AmbientLight: ["lighting", "light"], AmbientSound: ["sounds", "sound"], MeasuredTemplate: ["templates", "circle"], Region: ["regions", "select"] };
  for (const version of [13, 14]) for (const [type, [layerName, defaultTool]] of Object.entries(types)) {
    // v14 exposes templates through Regions and removes their native toolbar.
    if (version === 14 && type === "MeasuredTemplate") continue;
    const hasSelect = version === 14 || defaultTool === "select", tools = { [defaultTool]: { name: defaultTool }, ...(hasSelect ? { select: { name: "select" } } : {}) };
    globalThis.ui = { controls: { controls: { [layerName]: { tools, activeTool: defaultTool } } } };
    const collection = { AmbientLight: "lights", AmbientSound: "sounds" }[type] ?? layerName, calls = [];
    const doc = { id: "object", documentName: type, x: 10, y: 20, width: 1, height: 1, c: [0, 0, 100, 0], shapes: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }], object: { control() {} } };
    const layer = { activate: (options) => calls.push(options) }, board = { stage: {}, scene: { id: "scene", [collection]: new Map([[doc.id, doc]]) }, [layerName]: layer, animatePan() {} };
    assert.equal(await focusCanvasObject(board, { type, id: doc.id }), true);
    assert.deepEqual(calls, [{ tool: hasSelect ? "select" : defaultTool }]);
  }
  delete globalThis.ui;
});
