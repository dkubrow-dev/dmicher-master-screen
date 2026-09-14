import test from "node:test";
import assert from "node:assert/strict";
import { filterNavigationRows } from "../dmicher-master-screen/scripts/apps/navigation-filter.js";

const rows = [
  { id: "group", text: "Town square" },
  { id: "calm", parentId: "group", text: "Спокойствие" },
  { id: "alarm", parentId: "group", text: "Тревога" },
  { id: "other", text: "Other group" },
  { id: "child", parentId: "other", text: "Calm visitor" }
];

test("empty navigation filter keeps all rows without changing the source", () => {
  const original = structuredClone(rows);
  assert.deepEqual([...filterNavigationRows(rows, "")], rows.map(row => row.id));
  assert.deepEqual(rows, original);
});

test("matching a child retains its ancestors and excludes unrelated siblings", () => {
  assert.deepEqual([...filterNavigationRows(rows, "КОЙСТ")], ["calm", "group"]);
  assert.deepEqual([...filterNavigationRows(rows, "visitor")], ["child", "other"]);
  assert.deepEqual([...filterNavigationRows(rows, "Town square")], ["group"]);
});

test("navigation filtering uses literal contiguous Unicode text, not regex or split words", () => {
  assert.equal(filterNavigationRows(rows, "town.*square").size, 0);
  assert.equal(filterNavigationRows(rows, "town  square").size, 0);
  assert.equal(filterNavigationRows(rows, "town square").size, 1);
  assert.equal(filterNavigationRows([{ id: 1, text: "Café" }], "CAFE\u0301").size, 1);
});

test("deep branches, orphan rows and cycles cannot duplicate results or loop", () => {
  const tree = [{ id: 1, text: "Scene" }, { id: 2, parentId: 1, text: "Shops" }, { id: 3, parentId: 2, text: "shopOpened" },
    { id: 4, parentId: 99, text: "shopClosed" }, { id: 5, parentId: 6, text: "shopCycle" }, { id: 6, parentId: 5, text: "Cycle" }];
  assert.deepEqual([...filterNavigationRows(tree, "opened")], [3, 2, 1]);
  assert.deepEqual([...filterNavigationRows(tree, "closed")], [4]);
  assert.deepEqual([...filterNavigationRows(tree, "shopCycle")], [5, 6]);
});
