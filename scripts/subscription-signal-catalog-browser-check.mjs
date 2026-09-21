import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const output = path.resolve("../artifacts/dmicher-master-screen/0.0.1/subscription-signal-catalog"); await mkdir(output, { recursive: true });
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 960 } }), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`); await page.waitForFunction(() => globalThis.ready);
    const { id, search } = await page.evaluate(async ({ theme, language }) => {
      const { setSharedThemeGetter } = await import("/modules/dmicher-generics/scripts/theme.js"); setSharedThemeGetter(() => theme);
      const { ObjectAutomationApplication } = await import("/modules/dmicher-master-screen/scripts/apps/object-tools.js");
      const { MODULE_ID } = await import("/modules/dmicher-master-screen/scripts/model.js");
      const search = language === "ru" ? "Второй сигнал" : "Second signal";
      scene.flags[MODULE_ID].signalCatalog = { revision: 1, macros: [], subscriptions: [], signals: [
        { id: "first", emitterKey: "Group:main", name: language === "ru" ? "Первый сигнал" : "First signal", description: { ru: "Первое событие", en: "First event" }, parameters: [], returns: [] },
        { id: "second", emitterKey: "Group:main", name: search, description: { ru: "Описание второго события для подписки", en: "Description of the second subscription event" }, parameters: [], returns: [] }
      ] };
      globalThis.signalEditor = new ObjectAutomationApplication(controller, { type: "Token", id: "guard" });
      signalEditor.tab = "properties"; signalEditor.propertyTab = "subscriptions";
      signalEditor.subscriptionDraft = { ownerKey: "Token:guard", emitterKey: "Group:main", signalId: "first", handler: "script", macroUuid: "", enabled: false };
      globalThis.beforeSignalFlags = JSON.stringify(scene.flags);
      await signalEditor.render({ force: true }); signalEditor.element.dataset.dmicherTheme = theme;
      return { id: signalEditor.id, search };
    }, { theme, language });
    const app = page.locator(`[id="${id}"]`), input = app.locator("[data-subscription-signal-input]"), hidden = app.locator('[name="subscription-signal"]');
    await app.locator('[name="subscription-enabled"]').check();
    await input.fill(search); assert.equal(await hidden.inputValue(), "first");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => { signalEditor.capture(); return signalEditor.subscriptionDraft.signalId; }), "first");
    await app.locator("[data-subscription-signal-button]").click();
    const catalog = page.locator(".dmicher-catalog-dialog");
    assert.match(await catalog.evaluate(element => getComputedStyle(element).backgroundColor), /^rgb\(/);
    assert.equal(await catalog.getAttribute("data-dmicher-theme"), theme);
    await catalog.locator(".dmicher-catalog-search").fill(search);
    await page.screenshot({ path: path.join(output, `${version}-${language}-${theme}.png`) });
    await catalog.locator('[data-dmicher-catalog-entry="second"] button').click();
    await page.waitForFunction(() => signalEditor.subscriptionDraft.signalId === "second");
    assert.equal(await hidden.inputValue(), "second");
    assert.equal(await app.locator('[name="subscription-enabled"]').isChecked(), true);
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags) === beforeSignalFlags), true);
    assert.deepEqual(errors, []); await context.close();
    console.log(`${version} ${language} ${theme}: signal catalog confirms ID, preserves draft and performs no writes`);
  }
} finally { await browser.close(); await fixture.close(); }
