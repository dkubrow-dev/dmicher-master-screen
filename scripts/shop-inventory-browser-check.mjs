import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/shop-inventory-review");
fs.mkdirSync(output, { recursive: true });
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(), pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async () => {
      const { SceneAssets } = await import("/modules/dmicher-master-screen/scripts/scene-assets.js");
      const { getShopInventory } = await import("/modules/dmicher-master-screen/scripts/shop-inventory.js");
      globalThis.stockAssets = new SceneAssets(scene);
      globalThis.stockSnapshot = () => getShopInventory(scene, "inventory-review");
      const item = { id: "rope", stock: 5, data: game.items.get("rope").toObject() };
      const shop = await stockAssets.saveShop({ id: "inventory-review", name: "Supply store", items: [item] });
      await stockAssets.saveShop(shop, { currentItems: [{ ...item, stock: 3 }], expectedInventoryRevision: 0 });
      await controller.editor.switchMainTab("shops");
      await controller.editor.selectNode("shop", shop.id);
      globalThis.beforeShopView = JSON.stringify(scene.flags);
      await controller.editor.render({ force: true });
    });
    const form = page.locator('[data-asset-form="shop"]');
    const zone = kind => form.locator(`[data-shop-inventory="${kind}"]`);
    const stock = (kind, id) => zone(kind).locator(`input[data-entry-id="${id}"]`);
    const copy = kind => form.locator(`[data-screen-action="copyShopInventory"][data-stock-zone="${kind}"]`);
    const save = async () => {
      await form.locator('button[type="submit"]').click();
      await page.waitForFunction(() => !controller.editor.dirty);
      await form.waitFor();
    };
    const drop = async kind => {
      await zone(kind).locator('[data-shop-stock-drop]').evaluate((element) => {
        const data = new DataTransfer(); data.setData("text/plain", JSON.stringify({ type: "Item", uuid: "Item.apple" }));
        element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
      });
      await page.waitForFunction(kind => (kind === "initial" ? controller.editor.parameterDraft.items : controller.editor.parameterDraft._inventory.items).some(item => item.data.name === "Apple"), kind);
      await zone(kind).locator('[data-shop-entry]').nth(1).waitFor();
    };
    assert.equal(await page.evaluate(() => beforeShopView === JSON.stringify(scene.flags)), true, "View must not write");
    assert.equal(await stock("initial", "rope").inputValue(), "5");
    assert.equal(await stock("current", "rope").inputValue(), "3");
    for (const kind of ["initial", "current"]) {
      const help = stock(kind, "rope").locator('..').locator('[data-dmicher-setting-help]');
      assert.equal(await help.count(), 1); assert.equal(await help.getAttribute("tabindex"), "-1");
    }
    await drop("initial"); await drop("current");
    await stock("initial", "rope").fill("7"); await stock("current", "rope").fill("2");
    await zone("current").locator('[name="shopCurrentStock"]').nth(1).fill("6");
    await zone("initial").locator('[data-screen-action="removeShopItem"]').nth(1).click();
    assert.equal(await zone("initial").locator('[data-shop-entry]').count(), 1);
    assert.equal(await zone("current").locator('[data-shop-entry]').count(), 2);
    assert.equal(await page.evaluate(() => beforeShopView === JSON.stringify(scene.flags)), true, "Drops and edits remain draft-only");
    await save();
    let saved = await page.evaluate(() => ({ shop: stockAssets.getShop("inventory-review"), inventory: stockSnapshot(), source: game.items.get("apple").toObject() }));
    assert.equal(saved.shop.items.length, 1); assert.equal(saved.shop.items[0].stock, 7);
    assert.deepEqual(saved.inventory.items.map(item => item.stock), [2, 6]); assert.equal(saved.source.system.quantity, 2);
    assert.equal("_inventory" in saved.shop, false, "Form metadata must not leak into preparation");
    const inventoryRevision = saved.inventory.revision;
    await copy("initial").click();
    assert.equal(await zone("initial").locator('[data-shop-entry]').count(), 2);
    assert.equal(await page.evaluate(() => stockAssets.getShop("inventory-review").items.length), 1);
    await save();
    saved = await page.evaluate(() => ({ shop: stockAssets.getShop("inventory-review"), inventory: stockSnapshot() }));
    assert.deepEqual(saved.shop.items, saved.inventory.items); assert.equal(saved.inventory.revision, inventoryRevision);

    // An explicit equal-stock reset still cancels a pending trade, not its receipt history.
    await page.evaluate(() => {
      const runtime = scene.flags["dmicher-master-screen"].groupRuntimes.main;
      runtime.shopSessions = { "inventory-review": { id: "pending-session" } };
      runtime.tradeRequests = { pending: { status: "pending", intent: { shopId: "inventory-review" } }, done: { status: "done", intent: { shopId: "inventory-review" } } };
    });
    await copy("current").click();
    assert.equal(await form.locator('[data-stock-reset]').count(), 1);
    assert.equal(await page.evaluate(() => Boolean(scene.flags["dmicher-master-screen"].groupRuntimes.main.shopSessions["inventory-review"])), true);
    await save();
    assert.deepEqual(await page.evaluate(() => {
      const runtime = scene.flags["dmicher-master-screen"].groupRuntimes.main;
      return [Boolean(runtime.shopSessions["inventory-review"]), runtime.tradeRequests.pending.status, runtime.tradeRequests.done.status];
    }), [false, "rejected", "done"]);

    // A sale updates untouched stock while retaining an unsaved name.
    await form.locator('[name="assetName"]').fill("Unsaved store name");
    const externalStock = async quantity => page.evaluate(async quantity => {
      const snapshot = stockSnapshot(); snapshot.items[0].stock = quantity; snapshot.revision++;
      scene.flags["dmicher-master-screen"].shopInventories["inventory-review"] = snapshot;
      await controller.editor.refreshFromScene(scene);
    }, quantity);
    await externalStock(1);
    assert.equal(await form.locator('[name="assetName"]').inputValue(), "Unsaved store name");
    assert.equal(await stock("current", "rope").inputValue(), "1");
    await stock("current", "rope").fill("9"); await externalStock(0);
    assert.equal(await stock("current", "rope").inputValue(), "9");
    assert.equal(await form.locator('[data-stock-conflict]').count(), 1);
    await form.locator('button[type="submit"]').click();
    await page.waitForFunction(() => errors.length > 0);
    assert.equal(await page.evaluate(() => stockAssets.getShop("inventory-review").name), "Supply store");
    assert.equal(await page.evaluate(() => stockSnapshot().items[0].stock), 0);
    assert.equal(await page.evaluate(() => controller.editor.dirty), true);
    await stock("current", "rope").fill("");
    await form.locator('[data-screen-action="reloadShopInventory"]').click();
    assert.equal(await stock("current", "rope").inputValue(), "0");
    assert.equal(await form.locator('[name="assetName"]').inputValue(), "Unsaved store name");
    await save();
    assert.equal(await page.evaluate(() => stockAssets.getShop("inventory-review").name), "Unsaved store name");
    await page.locator('[data-detail-content]').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, `${version}-${language}.png`) });
    await page.evaluate(async () => { controller.editor.layout.preferences.vertical = 0.2; await controller.editor.render({ force: true }); });
    await zone("initial").evaluate(element => {
      const content = element.closest('[data-detail-content]');
      content.scrollTop += element.getBoundingClientRect().top - content.getBoundingClientRect().top;
    });
    await page.screenshot({ path: path.join(output, `${version}-${language}-inventories.png`) });

    await page.evaluate(async () => { game.user.role = 3; await controller.editor.render({ force: true }); });
    assert.equal(await stock("initial", "rope").isEnabled(), true);
    assert.equal(await stock("current", "rope").isDisabled(), true);
    assert.equal(await copy("current").isDisabled(), true); assert.equal(await copy("initial").isEnabled(), true);
    assert.deepEqual(pageErrors, []);
    reports.push({ version, language, editsAndDrops: true, draftCopies: true, resetCancelsPendingOnly: true, refreshAndConflict: true, authorityControls: true, help: true, errors: pageErrors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await fixture.close(); }
