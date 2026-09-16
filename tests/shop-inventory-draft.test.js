import test from "node:test";
import assert from "node:assert/strict";
import { copyShopInventory, refreshShopInventoryDraft, shopInventorySaveOptions } from "../dmicher-master-screen/scripts/apps/shop-inventory-draft.js";

const items = stock => [{ id: "rope", data: { name: "Rope", type: "equipment" }, stock }];
const draft = () => { const value = { items: items(9), name: "Shop" }; refreshShopInventoryDraft(value, { items: items(4), revision: 2 }); return value; };

test("stock copying is draft-only and each direction has its own save intent", () => {
  const value = draft();
  copyShopInventory(value, "initial");
  assert.equal(value.items[0].stock, 4);
  assert.deepEqual(shopInventorySaveOptions(value), { expectedInventoryRevision: 2 });
  value.items[0].stock = 8;
  assert.equal(value._inventory.items[0].stock, 4, "Copied lists do not share entries");
  copyShopInventory(value, "current");
  assert.deepEqual(shopInventorySaveOptions(value), { currentItems: items(8), expectedInventoryRevision: 2, resetInventory: true });
});

test("unchanged current stock refreshes without touching initial or other unsaved fields", () => {
  const value = draft(); value.name = "Uncommitted name"; value.items[0].stock = 17;
  assert.equal(refreshShopInventoryDraft(value, { items: [], revision: 3 }), true);
  assert.equal(value.name, "Uncommitted name"); assert.equal(value.items[0].stock, 17);
  assert.deepEqual(value._inventory.items, []); assert.deepEqual(shopInventorySaveOptions(value), {});
});

test("live stock changes never overwrite current edits, reset intent or adopted initial stock", () => {
  for (const edit of [value => { value._inventory.items[0].stock = 1; }, value => copyShopInventory(value, "current"), value => copyShopInventory(value, "initial")]) {
    const value = draft(); edit(value); const options = shopInventorySaveOptions(value);
    assert.equal(refreshShopInventoryDraft(value, { items: items(2), revision: 3 }), false);
    assert.equal(value._inventory.conflicted, true); assert.equal(value._inventory.revision, 2);
    assert.deepEqual(shopInventorySaveOptions(value), options);
  }
});

test("an explicit reset is retained even when quantities match and incomplete inputs retain the baseline", () => {
  const value = draft(); value.items = items(4); copyShopInventory(value, "current");
  assert.equal(shopInventorySaveOptions(value).resetInventory, true);
  const incomplete = draft();
  assert.equal(refreshShopInventoryDraft(incomplete, { items: items(1), revision: 3 }, { preserveInputs: true }), false);
  assert.equal(incomplete._inventory.conflicted, true); assert.equal(incomplete._inventory.items[0].stock, 4);
});
