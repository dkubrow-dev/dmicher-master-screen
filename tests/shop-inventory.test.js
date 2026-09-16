import test from "node:test";
import assert from "node:assert/strict";
import { sceneFixture, shopData, clone } from "./fixtures/scene.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { getShopInventory, hasShopInventory, resetShopInventory, prepareShopInventoryChange } from "../dmicher-master-screen/scripts/shop-inventory.js";
import { withSceneLock } from "../dmicher-master-screen/scripts/store.js";
import { writeSceneFlags } from "../dmicher-master-screen/scripts/scene-flags.js";
import { shopEntries } from "../dmicher-master-screen/scripts/shop.js";

test("inventory reads neither initialize defaults nor append missing initial lot IDs", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData()), before = f.writes();
  assert.deepEqual(getShopInventory(f.scene, shop.id), { items: shop.items, revision: 0 });
  assert.equal(hasShopInventory(f.scene, shop.id), false); assert.equal(f.writes(), before);
  f.scene.flags[MODULE_ID].shopInventories = { [shop.id]: { items: [], revision: 4 } };
  assert.deepEqual(getShopInventory(f.scene, shop.id), { items: [], revision: 4 });
  assert.deepEqual(shopEntries({ shopId: shop.id, inventory: getShopInventory(f.scene, shop.id), behavior: { shop } }), []);
  assert.equal(f.writes(), before);
});

test("runtime-only stock is a read fallback, while canonical empty stock wins", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData());
  const older = [{ ...shop.items[0], stock: 2 }], newer = [{ ...shop.items[0], stock: 1 }];
  f.scene.flags[MODULE_ID].groupRuntimes = { a: { enteredAt: 1, shops: { [shop.id]: { items: older } } }, b: { enteredAt: 2, shops: { [shop.id]: { items: newer } } } };
  const before = f.writes();
  assert.deepEqual(getShopInventory(f.scene, shop.id).items, newer);
  f.scene.flags[MODULE_ID].shopInventories = { [shop.id]: { items: [], revision: 1 } };
  assert.deepEqual(getShopInventory(f.scene, shop.id).items, []); assert.equal(f.writes(), before);
});

test("saving initial stock first captures the previous current stock without replenishment", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData());
  await f.assets.saveShop({ ...shop, items: [] });
  assert.deepEqual(f.assets.getShop(shop.id).items, []);
  assert.deepEqual(getShopInventory(f.scene, shop.id), { items: shop.items, revision: 0 });
  await f.assets.saveShop(shop, { currentItems: [], expectedInventoryRevision: 0 });
  assert.deepEqual(getShopInventory(f.scene, shop.id), { items: [], revision: 1 });
  await f.assets.saveShop({ ...shop, items: [...shop.items, { ...shop.items[0], id: "other" }] });
  assert.deepEqual(getShopInventory(f.scene, shop.id).items, []);
});

test("a combined save checks both revisions and writes catalogs with current stock once", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData());
  const updates = [], originalUpdate = f.scene.update.bind(f.scene);
  f.scene.update = async fields => { updates.push(clone(fields)); return originalUpdate(fields); };
  const expectedRevision = f.assets.list().revision;
  await f.assets.saveShop({ ...shop, name: "Edited" }, { expectedRevision, currentItems: [], expectedInventoryRevision: 0 });
  assert.equal(updates.length, 1);
  assert.ok(updates[0][`flags.${MODULE_ID}.interactionCatalog`]); assert.ok(updates[0][`flags.${MODULE_ID}.shopInventories`]);
  const before = clone(f.scene.flags);
  await assert.rejects(f.assets.saveShop(shop, { expectedRevision, currentItems: shop.items, expectedInventoryRevision: 1 }));
  await assert.rejects(f.assets.saveShop(shop, { expectedRevision: expectedRevision + 1, currentItems: shop.items, expectedInventoryRevision: 0 }));
  assert.deepEqual(f.scene.flags, before);
});

test("reset cancels unfinished leases in every group and retains completed and uncertain audit", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData()), other = await f.assets.saveShop(shopData("Other"));
  const receipt = status => ({ status, intent: { shopId: shop.id, sessionId: "lease" } });
  f.scene.flags[MODULE_ID].groupRuntimes = {
    a: { shopSessions: { [shop.id]: { sessionId: "lease" }, [other.id]: { sessionId: "untouched" } }, tradeRequests: { pending: receipt("pending"), done: receipt("done") } },
    b: { shopSessions: { [shop.id]: { sessionId: "second" } }, tradeRequests: { validating: receipt("validating"), uncertain: receipt("uncertain") } }
  };
  await f.assets.saveShop(shop, { currentItems: [] });
  const beforeRevision = getShopInventory(f.scene, shop.id).revision;
  const result = await resetShopInventory(f.scene, shop.id, { expectedRevision: beforeRevision });
  assert.deepEqual(result.items, shop.items); assert.equal(result.revision, beforeRevision + 1);
  const groups = f.scene.flags[MODULE_ID].groupRuntimes;
  assert.equal(groups.a.shopSessions[shop.id], undefined); assert.equal(groups.b.shopSessions[shop.id], undefined);
  assert.equal(groups.a.shopSessions[other.id].sessionId, "untouched");
  assert.equal(groups.a.tradeRequests.pending.status, "rejected"); assert.equal(groups.b.tradeRequests.validating.status, "rejected");
  assert.equal(groups.a.tradeRequests.done.status, "done"); assert.equal(groups.b.tradeRequests.uncertain.status, "uncertain");
});

test("an explicit reset cancels a lease even when current and initial stock are identical", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData());
  f.scene.flags[MODULE_ID].groupRuntimes = { a: { shopSessions: { [shop.id]: { sessionId: "lease" } } } };
  await f.assets.saveShop(shop, { currentItems: shop.items, expectedInventoryRevision: 0, resetInventory: true });
  assert.equal(f.scene.flags[MODULE_ID].groupRuntimes.a.shopSessions[shop.id], undefined);
  assert.equal(getShopInventory(f.scene, shop.id).revision, 1);
});

test("reset waits for an exchange holding the scene queue and never undoes completed actor effects", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData());
  let release, entered, actorItems = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const exchange = withSceneLock(f.scene, async () => {
    entered(); await gate; actorItems++;
    const { fields } = prepareShopInventoryChange(f.scene, shop.id, [], { cancelTrades: false });
    await writeSceneFlags(f.scene, fields);
  });
  await started;
  const reset = resetShopInventory(f.scene, shop.id);
  assert.equal(actorItems, 0); release(); await exchange; await reset;
  assert.equal(actorItems, 1); assert.deepEqual(getShopInventory(f.scene, shop.id), { items: shop.items, revision: 2 });
});

test("a reset invalidated while queued performs no writes and player calls are rejected", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData());
  let release, current = true;
  const blocker = withSceneLock(f.scene, () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  const reset = resetShopInventory(f.scene, shop.id, { isCurrent: () => current });
  current = false; const before = f.writes(); release(); await blocker;
  assert.deepEqual(await reset, { stale: true }); assert.equal(f.writes(), before);
  game.user.isGM = false;
  await assert.rejects(resetShopInventory(f.scene, shop.id)); assert.equal(f.writes(), before);
});

test("another GM may edit preparation but cannot race live inventory or its first capture", async () => {
  const f = sceneFixture(), shop = await f.assets.saveShop(shopData());
  const second = { id: "second", isGM: true, role: 4, active: true };
  game.users.set(second.id, second); game.user = second;
  await f.assets.saveShop({ ...shop, name: "Renamed" }, { currentItems: shop.items, expectedInventoryRevision: 0 });
  const before = clone(f.scene.flags);
  await assert.rejects(f.assets.saveShop({ ...shop, items: [] }));
  await assert.rejects(f.assets.saveShop(shop, { currentItems: [] }));
  await assert.rejects(resetShopInventory(f.scene, shop.id));
  assert.deepEqual(f.scene.flags, before);
  game.user = game.users.get("gm"); await resetShopInventory(f.scene, shop.id);
  game.user = second; await f.assets.saveShop({ ...shop, items: [] });
  assert.deepEqual(f.assets.getShop(shop.id).items, []);
  assert.deepEqual(getShopInventory(f.scene, shop.id).items, shop.items);
});
