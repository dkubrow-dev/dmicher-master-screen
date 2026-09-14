import assert from "node:assert/strict";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    const app = page.locator("#dmicher-master-screen-editor"), filter = app.locator("[data-main-filter]");
    const visibleRows = () => app.locator("[data-main-content] tr[data-select-kind]:visible");
    await app.locator('[data-select-kind="group"] td:last-child').first().click();
    await app.locator('[name="groupName"]').waitFor();
    const flags = await page.evaluate(() => JSON.stringify(scene.flags));
    const stateName = await app.locator('[data-select-kind="state"] .ms-tree-name').first().innerText();
    // Folded matches are revealed temporarily; filtering is local and never dirties the draft.
    await app.locator('[data-screen-action="foldGroup"]').click();
    await filter.fill(stateName.replace(/^[\s\S]*?[\u25cf\u25cb]\s*/, "").trim().toUpperCase());
    assert.equal(await visibleRows().count(), 2);
    assert.equal(await page.evaluate(() => controller.editor.dirty), false);
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags)), flags);
    await filter.fill("");
    assert.equal(await visibleRows().count(), 1);
    await filter.fill("TOWN SQUARE");
    assert.equal(await visibleRows().count(), 1, "a matching parent does not admit its unrelated children");
    await filter.fill("missing-row-987");
    assert.equal(await visibleRows().count(), 0);
    assert.equal(await app.locator("[data-main-filter-empty]").isVisible(), true);
    await filter.fill("Town");
    await page.evaluate(() => { globalThis.originalDetail = controller.editor.element.querySelector('[name="groupName"]'); });
    await app.locator('[name="groupName"]').fill("Unsaved name");
    await filter.fill("square");
    assert.equal(await page.evaluate(() => originalDetail === controller.editor.element.querySelector('[name="groupName"]')), true);
    assert.equal(await app.locator('[name="groupName"]').inputValue(), "Unsaved name");
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags)), flags);
    await page.evaluate(() => controller.editor.refresh());
    assert.equal(await filter.inputValue(), "square");
    assert.equal(await app.locator('[name="groupName"]').inputValue(), "Unsaved name");
    await page.evaluate(async () => {
      const { SceneAssets } = await import('/modules/dmicher-master-screen/scripts/scene-assets.js');
      const assets = new SceneAssets(scene);
      await assets.saveDialogue({ id: 'filter-dialogue', name: 'Gate talk', startPageId: 'start', pages: [
        { id: 'start', name: 'Welcome guard', text: 'Hello', responses: [] },
        { id: 'end', name: 'Farewell', text: 'Bye', responses: [] }
      ] });
      await assets.saveShop({ id: 'filter-shop-a', name: 'South shop', items: [] });
      await assets.saveShop({ id: 'filter-shop-b', name: 'North shop', items: [] });
      await controller.editor.switchMainTab('dialogues');
    });
    assert.equal(await filter.inputValue(), "");
    await app.locator('[data-screen-action="foldDialogue"]').click();
    await filter.fill("GUARD");
    assert.equal(await visibleRows().count(), 2);
    assert.equal(await app.locator('[data-page-id="start"]').isVisible(), true);
    assert.equal(await app.locator('[data-page-id="end"]').isVisible(), false);
    await page.evaluate(() => controller.editor.switchMainTab('scene'));
    assert.equal(await filter.inputValue(), "square");
    await page.evaluate(() => controller.editor.switchMainTab('shops'));
    await filter.fill("NORTH");
    assert.equal(await visibleRows().count(), 1);
    assert.match(await visibleRows().innerText(), /North shop/);
    await page.evaluate(() => controller.editor.switchMainTab('signals'));
    const technical = await app.locator('.ms-signal-technical code').first().innerText();
    await app.locator('[data-signal-category="scene"] > summary').click();
    const foldedBranches = await page.evaluate(() => [...controller.editor.foldedSignalBranches]);
    await filter.fill(technical.toUpperCase());
    const visible = await visibleRows().allTextContents();
    assert.ok(visible.length > 0);
    assert.ok(visible.every(text => text.toLowerCase().includes(technical.toLowerCase())));
    assert.ok(await app.locator('details[data-main-filter-row]:visible').count() > 0);
    assert.deepEqual(await page.evaluate(() => [...controller.editor.foldedSignalBranches]), foldedBranches);
    await filter.fill("");
    assert.equal(await app.locator('[data-signal-category="scene"]').evaluate(element => element.open), false);
    await page.evaluate(() => controller.editor.changeMode('director'));
    assert.equal(await filter.inputValue(), "");
    await filter.fill("TOWN SQUARE");
    assert.equal(await visibleRows().count(), 1);
    assert.equal(await app.locator('[data-main-filter-empty]').isVisible(), false);
    assert.deepEqual(errors, []);
    reports.push({ version, language, filtering: true, folds: true, drafts: true, localOnly: true });
    await context.close();
  }
} finally { await browser.close(); await fixture.close(); }
console.log(JSON.stringify(reports));
