import assert from "node:assert/strict";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    const app = page.locator("#dmicher-master-screen-editor");
    await app.locator('[data-select-kind="group"] td:last-child').first().click();
    const input = app.locator('[name="groupSymbol"]'); await input.waitFor();
    await app.locator("[data-group-symbol-picker]").click();
    const picker = page.locator(".dmicher-unicode-picker"); await picker.waitFor();
    assert.equal(await picker.locator("[data-dmicher-unicode-section]").count(), 4);
    assert.equal(await picker.locator("[data-dmicher-unicode-value]").count(), 140);
    const choice = picker.locator("[data-dmicher-unicode-value]").nth(1), symbol = await choice.textContent();
    await choice.click(); assert.equal(await input.inputValue(), symbol);
    assert.equal(await picker.count(), 0); assert.deepEqual(errors, []);
    await context.close();
    console.log(`${version} ${language}: shared group Unicode picker passed`);
  }
} finally { await browser.close(); await fixture.close(); }
