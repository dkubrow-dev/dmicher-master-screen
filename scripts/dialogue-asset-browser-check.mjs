import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/dialogue-catalog-review");
fs.mkdirSync(output, { recursive: true });
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 980 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async () => {
      const { SceneAssets } = await import("/modules/dmicher-master-screen/scripts/scene-assets.js");
      globalThis.reviewAssets = new SceneAssets(scene);
      globalThis.reviewDialogue = await reviewAssets.saveDialogue({ id: "catalog-review", name: "Gatekeeper", description: "Prepared conversation", pages: [
        { id: "greeting", name: "Greeting", text: "Welcome", responses: [{ id: "next", label: "Tell me", nextPageId: "question" }] },
        { id: "question", name: "Question", text: "A question", responses: [] }
      ] });
      await controller.editor.switchMainTab("dialogues");
      await controller.editor.selectNode("dialogue", reviewDialogue.id);
    });
    const form = () => page.locator('[data-asset-form="dialogue"]');
    const pageRow = id => page.locator(`[data-select-kind="dialogue"][data-select-id="catalog-review"][data-page-id="${id}"]`);
    const generalRow = page.locator('[data-select-kind="dialogue"][data-select-id="catalog-review"]:not([data-page-id])');
    await form().locator('[name="dialogueDisplayMode"]').waitFor();
    assert.equal(await form().locator('[name="dialogueDisplayMode"]').inputValue(), "chat");
    assert.equal(await form().locator('[name="dialogueVisibility"]').inputValue(), "private");
    assert.equal(await form().locator('[name="dialoguePageText"]').count(), 0);
    await form().locator('[name="assetName"]').fill('Renamed gatekeeper');
    await form().locator('[name="dialogueDisplayMode"]').selectOption('window');
    await form().locator('[name="dialogueWindowChat"]').selectOption('confirm');
    await form().locator('[name="dialogueVisibility"]').selectOption('public');
    await form().locator('[name="dialogueAudienceAllowTags"]').fill('hero, guest');
    await form().locator('[name="dialogueAudienceRange"]').fill('15.5');
    await pageRow('question').click();
    await form().locator('[name="dialoguePageText"]').waitFor();
    assert.equal(await form().locator('[name="assetName"]').count(), 0);
    await form().locator('[name="dialoguePageText"]').fill('An edited question');
    await page.evaluate(() => { controller.previewAsset = (_kind, _id, data) => { globalThis.reviewPreview = data; }; });
    await page.locator('[data-screen-action="previewAsset"]').click();
    assert.equal(await page.evaluate(() => reviewPreview.pageId), 'question');
    assert.equal(await page.evaluate(() => reviewPreview.draft.pages[1].text), 'An edited question');
    await generalRow.click();
    await form().locator('[name="assetName"]').waitFor();
    assert.equal(await form().locator('[name="assetName"]').inputValue(), 'Renamed gatekeeper');
    assert.equal(await form().locator('[name="dialogueWindowChat"]').inputValue(), 'confirm');
    assert.equal(await form().locator('[name="dialogueAudienceRange"]').inputValue(), '15.5');
    const help = form().locator('[name="dialogueVisibility"]').locator('..').locator('[data-dmicher-setting-help]');
    assert.equal(await form().locator('[name="dialogueStartPage"]').locator('..').locator('[data-dmicher-setting-help]').count(), 1);
    assert.equal(await help.getAttribute('tabindex'), '-1');
    await help.click();
    assert.deepEqual(await page.evaluate(() => helpTarget), { page: 'settings-dialogue', anchor: 'visibility' });
    await form().locator('button[type="submit"]').click();
    await page.waitForFunction(() => reviewAssets.getDialogue('catalog-review').name === 'Renamed gatekeeper');
    const saved = await page.evaluate(() => reviewAssets.getDialogue('catalog-review'));
    assert.equal(saved.pages[1].text, 'An edited question');
    assert.deepEqual(saved.presentation.publicAudience, { allowTags: ['hero', 'guest'], denyTags: [], range: 15.5 });
    await page.locator('[data-screen-action="foldDialogue"][data-id="catalog-review"]').click();
    await pageRow('question').waitFor({ state: 'hidden' });
    await page.locator('[data-screen-action="foldDialogue"][data-id="catalog-review"]').click();
    await pageRow('question').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, `${version}-${language}.png`) });
    assert.deepEqual(errors, []);
    reports.push({ version, language, retainedDraft: true, pagePreview: true, help: true, errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await fixture.close(); }
