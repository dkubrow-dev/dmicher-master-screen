import test from "node:test";
import assert from "node:assert/strict";
import { orderNavigationRows, moveNavigationSibling, navigationOrderKey } from "../dmicher-master-screen/scripts/apps/navigation-order.js";

const rows = [
  { key: "a", parentKey: null }, { key: "a1", parentKey: "a" }, { key: "a2", parentKey: "a" },
  { key: "b", parentKey: null }, { key: "b1", parentKey: "b" }
];
test("personal sorting moves whole branches and orders children independently without changing source", () => {
  const before = structuredClone(rows);
  assert.deepEqual(orderNavigationRows(rows, { root: ["b", "a"], a: ["a2", "a1"] }).map(row => row.key), ["b", "b1", "a", "a2", "a1"]);
  assert.deepEqual(rows, before);
});
test("old missing IDs are ignored and new rows retain their relative order", () => {
  assert.deepEqual(orderNavigationRows(rows, { root: ["deleted", "b", "b"] }).map(row => row.key), ["b", "b1", "a", "a1", "a2"]);
});
test("moving siblings before or after retains hidden rows and never reparents", () => {
  const ordered = moveNavigationSibling(rows, "a", "b", true);
  assert.deepEqual(ordered, ["b", "a"]);
  assert.deepEqual(moveNavigationSibling(rows, "a2", "a1", false), ["a2", "a1"]);
  assert.equal(moveNavigationSibling(rows, "a1", "b1", false), null);
  assert.equal(moveNavigationSibling(rows, "missing", "a", false), null);
  assert.equal(moveNavigationSibling(rows, "a", "a", false), null);
});
test("personal sorting is isolated by world, user, scene and table, never by mode", () => {
  const key = navigationOrderKey({ worldId: "world", userId: "gm", sceneId: "scene", tab: "scene" });
  assert.equal(key, navigationOrderKey({ worldId: "world", userId: "gm", sceneId: "scene", tab: "scene", mode: "director" }));
  for (const field of ["worldId", "userId", "sceneId", "tab"]) {
    assert.notEqual(key, navigationOrderKey({ worldId: "world", userId: "gm", sceneId: "scene", tab: "scene", [field]: "other" }));
  }
});
