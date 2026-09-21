import assert from "node:assert/strict";
import fs from "node:fs";
import { startBrowserFixture, launchFixtureBrowser, workspace } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
const output = `${workspace}/artifacts/dmicher-master-screen/0.0.1/navigation-order`;
fs.mkdirSync(output, { recursive: true });
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    const app = page.locator("#dmicher-master-screen-editor"), main = app.locator("[data-main-content]");
    const ids = (kind) => main.locator(`[data-select-kind="${kind}"]`).evaluateAll(rows => rows.map(row => row.dataset.pageId || row.dataset.selectId));
    const row = (kind, id) => main.locator(`[data-select-kind="${kind}"][data-select-id="${id}"]`);
    const drag = async (source, target, after = false) => {
      await source.locator("[data-navigation-handle]").dragTo(target, { targetPosition: { x: 50, y: after ? (await target.boundingBox()).height - 2 : 2 } });
    };
    await page.evaluate(async () => {
      game.world = { id: "sort-fixture" };
      const { SceneAssets } = await import('/modules/dmicher-master-screen/scripts/scene-assets.js');
      const assets = new SceneAssets(scene);
      for (const id of ['one', 'two', 'three']) await assets.saveShop({ id, name: `Shop ${id}`, items: [] });
      for (const id of ['talk-a', 'talk-b']) await assets.saveDialogue({ id, name: id, startPageId: 'start', pages: [
        { id: 'start', name: 'Hello', text: 'Hello', responses: [] }, { id: 'end', name: 'Bye', text: 'Bye', responses: [] }
      ] });
      await controller.editor.switchMainTab('shops');
      globalThis.preSortFlags = JSON.stringify(scene.flags);
    });
    await row('shop','one').click();
    // Reorder without a render: the existing detail input and unsaved value survive.
    await page.evaluate(() => { globalThis.detailBeforeSort = document.querySelector('[data-ide-parameters] input'); });
    const input = app.locator('[data-ide-parameters] input').first();
    await input.fill('Unsaved title');
    await drag(row('shop','three'), row('shop','one'));
    assert.deepEqual(await ids('shop'), ['three', 'one', 'two']);
    assert.equal(await input.inputValue(), 'Unsaved title');
    assert.equal(await page.evaluate(() => detailBeforeSort === document.querySelector('[data-ide-parameters] input')), true);
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags)), await page.evaluate(() => preSortFlags));
    await page.evaluate(() => controller.editor.render({force:true}));
    assert.deepEqual(await ids('shop'), ['three', 'one', 'two']);
    await page.evaluate(async () => { await controller.editor.changeMode('director'); await controller.editor.switchMainTab('shops'); });
    assert.deepEqual(await ids('shop'), ['three', 'one', 'two']);
    await row('shop','two').locator('[data-navigation-handle]').focus();
    await page.keyboard.press('Alt+ArrowUp');
    assert.deepEqual(await ids('shop'), ['three', 'two', 'one']);
    await page.evaluate(async () => { await controller.editor.changeMode('constructor'); await controller.editor.switchMainTab('shops'); });
    assert.deepEqual(await ids('shop'), ['three', 'two', 'one']);
    const filter = app.locator('[data-main-filter]');
    await filter.fill('Shop');
    await drag(row('shop','three'), row('shop','one'), true);
    assert.deepEqual(await ids('shop'), ['two', 'one', 'three']);
    await filter.fill('');
    await page.evaluate(() => controller.editor.switchMainTab('dialogues'));
    await drag(row('dialogue','talk-b').filter({ has: page.locator('[data-screen-action="foldDialogue"]') }), row('dialogue','talk-a').filter({ has: page.locator('[data-screen-action="foldDialogue"]') }));
    const roots = await main.locator('tr[aria-level="1"]').evaluateAll(rows => rows.map(row => row.dataset.selectId));
    assert.deepEqual(roots, ['talk-b','talk-a']);
    const start = main.locator('[data-select-id="talk-b"][data-page-id="start"]'), end = main.locator('[data-select-id="talk-b"][data-page-id="end"]');
    await drag(end,start);
    assert.deepEqual(await main.locator('[data-select-id="talk-b"][data-page-id]').evaluateAll(rows => rows.map(row => row.dataset.pageId)), ['end','start']);
    await page.evaluate(() => controller.editor.switchMainTab('scene'));
    const originalStates=await ids('state');
    await drag(row('state','stop'),row('state','calm'));
    assert.deepEqual(await ids('state'), ['stop', ...originalStates.filter(id=>id!=='stop')]);
    await page.evaluate(() => controller.editor.switchMainTab('signals'));
    const categories = main.locator('.ms-signal-tree > details');
    const categoryOrder=await categories.evaluateAll(nodes=>nodes.map(node=>node.dataset.signalCategory));
    await categories.evaluateAll(nodes=>nodes.forEach(node=>node.open=false));
    const last = categories.last(), first = categories.first();
    await last.locator(':scope > summary > [data-navigation-handle]').dragTo(first.locator(':scope > summary'), {targetPosition:{x:70,y:2}});
    assert.deepEqual(await categories.evaluateAll(nodes=>nodes.map(node=>node.dataset.signalCategory)), [categoryOrder.at(-1),...categoryOrder.slice(0,-1)]);
    await categories.evaluateAll(nodes=>nodes.forEach(node=>node.open=true));
    const emitter = main.locator('.ms-signal-emitter').filter({ has: page.locator('tr[data-select-kind="signal"]') }).first();
    const signals = emitter.locator('tr[data-select-kind="signal"]');
    const signalOrder = await signals.evaluateAll(rows=>rows.map(row=>row.dataset.selectId));
    await drag(signals.last(),signals.first());
    assert.deepEqual(await signals.evaluateAll(rows=>rows.map(row=>row.dataset.selectId)), [signalOrder.at(-1), ...signalOrder.slice(0,-1)]);
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags)), await page.evaluate(() => preSortFlags));
    // Reload reconstructs the fixture; personal sorting is still read from storage.
    await page.reload(); await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async()=>{game.world={id:'sort-fixture'};await controller.editor.switchMainTab('scene');await controller.editor.render({force:true});});
    assert.deepEqual(await ids('state'), ['stop', ...originalStates.filter(id=>id!=='stop')]);
    await page.screenshot({path:`${output}/${version}-${language}.png`});
    assert.deepEqual(errors, []);
    reports.push({ version, language, drag: true, hierarchy: true, drafts: true, modes: true, reload: true, noWorldWrites: true });
    await context.close();
  }
} finally { await browser.close(); await fixture.close(); }
console.log(JSON.stringify(reports));
