import test from "node:test";
import assert from "node:assert/strict";
import { dockLayout, resizeTableCanvas } from "../dmicher-master-screen/scripts/apps/constructor-dock.js";

test("docking reserves a disjoint table viewport and limits resizing in both orientations", () => {
  const right = dockLayout({ width: 1280, height: 900, side: "right", size: 480 });
  assert.equal(right.tableWidth, 800);
  assert.equal(right.tableHeight, 900);
  assert.equal(right.tableWidth + right.size, 1280);
  const bottom = dockLayout({ width: 1280, height: 900, side: "bottom", size: 380 });
  assert.equal(bottom.tableWidth, 1280);
  assert.equal(bottom.tableHeight + bottom.size, 900);
  assert.equal(dockLayout({ width: 1280, height: 900, size: 1e8 }).tableWidth, 480);
  assert.equal(dockLayout({ width: 1280, height: 900, size: -1 }).size, 360);
  assert.equal(dockLayout({ width: 1280, height: 900, side: "bottom", size: 1e8 }).tableHeight, 260);
});

test("a narrow or resized browser retains a usable share of its table", () => {
  const layout = dockLayout({ width: 600, height: 400, size: 950 });
  assert.equal(layout.size, 300);
  assert.equal(layout.tableWidth, 300);
  const bottom = dockLayout({ width: 600, height: 400, side: "bottom", size: 900 });
  assert.equal(bottom.size, 200);
  assert.equal(bottom.tableHeight, 200);
});

test("real renderer resizing keeps the viewed world point, zoom and client coordinates consistent", () => {
  const renderer = { screen: { width: 1280, height: 900 }, calls: [], resize(width, height) {
    this.calls.push([width, height]); Object.assign(this.screen, { width, height });
  } };
  const canvas = { ready: true, app: { renderer }, screenDimensions: [1280, 900],
    stage: { pivot: { x: 900, y: 700 }, scale: { x: 2, y: 2 }, position: { x: 640, y: 450,
      set(x, y) { Object.assign(this, { x, y }); } } },
    pan(position) { assert.deepEqual(position, this.stage.pivot); } };
  assert.equal(resizeTableCanvas(canvas, 800, 900), true);
  assert.deepEqual(canvas.screenDimensions, [800, 900]);
  assert.deepEqual(canvas.stage.pivot, { x: 900, y: 700 });
  assert.deepEqual(canvas.stage.scale, { x: 2, y: 2 });
  assert.equal(canvas.stage.position.x, 400);
  assert.equal(resizeTableCanvas(canvas, 800, 900), false);
  assert.equal(renderer.calls.length, 1);
  assert.equal(resizeTableCanvas(canvas, 1280, 900), true);
  assert.equal(canvas.stage.position.x, 640);
  assert.equal(resizeTableCanvas({ ...canvas, ready: false }, 800, 600), false);
});
