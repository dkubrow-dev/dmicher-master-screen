import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/interaction-settings-review"); await fs.mkdir(output, { recursive: true });
try {
  for (const version of ["13.351", "14.366"]) for (const lang of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${lang}`); await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async () => {
      const { generics } = await import("/modules/dmicher-master-screen/scripts/generics.js");
      const { masterScreenExtension } = await import("/modules/dmicher-premium/sctipts/features/master-screen/index.js");
      const settings = await import("/modules/dmicher-master-screen/scripts/interaction-settings.js");
      globalThis.settingValues = new Map(); globalThis.settingMenus = new Map(); globalThis.premiumAllowed = false;
      game.settings = {
        register: (_scope, key, definition) => settingValues.set(key, structuredClone(definition.default)),
        registerMenu: (_scope, key, definition) => settingMenus.set(key, definition),
        get: (_scope, key) => settingValues.get(key), set: async (_scope, key, value) => settingValues.set(key, structuredClone(value))
      };
      globalThis.premiumRegistration = generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => premiumAllowed, extensions: [masterScreenExtension] });
      settings.registerInteractionSettings(); globalThis.masterSettings = new settings.MasterInteractionSettings();
      await masterSettings.render();
      // Fixture applications use a div; native settings apps have tag=form.
      masterSettings.element.reportValidity = () => [...masterSettings.element.querySelectorAll("input,select")].every(element => element.checkValidity());
    });
    const app = page.locator(".ms-interaction-settings");
    assert.equal(await app.locator("fieldset").count(), 2); assert.equal(await app.locator("fieldset:disabled").count(), 2);
    assert.equal(await app.locator(".dmicher-premium-badge").count(), 3);
    assert.equal(await app.locator('[name^="frame-"][name$="-enabled"]').count(), 8);
    assert.equal(await app.locator('[name^="frame-"][name$="-enabled"]:checked').count(), 4);
    assert.equal(await page.evaluate(() => settingMenus.get("masterInteractionSettings").restricted), true);
    assert.equal(await page.evaluate(() => settingMenus.get("playerInteractionSettings").restricted), false);
    await page.evaluate(() => { premiumAllowed = true; premiumRegistration.notifyChanged(); });
    assert.equal(await app.locator("fieldset:disabled").count(), 0);
    await app.locator('[name="interaction-activation"]').selectOption("always");
    assert.equal(await app.locator('[data-highlight-shortcut]').isVisible(), false);
    await app.locator('[name="interaction-activation"]').selectOption("keys");
    const original = await app.locator('[name="interaction-shortcut"]').inputValue();
    await app.locator('[data-screen-action="shortcut"]').click(); await page.locator("dialog.ms-highlight-key-dialog").waitFor();
    await page.keyboard.press("Escape"); await page.locator("dialog.ms-highlight-key-dialog").waitFor({ state: "detached" });
    assert.equal(await app.locator('[name="interaction-shortcut"]').inputValue(), original);
    await app.locator('[data-screen-action="shortcut"]').click();
    await page.keyboard.down("ControlLeft"); await page.keyboard.down("KeyI");
    await page.locator("dialog.ms-highlight-key-dialog").waitFor({ state: "detached", timeout: 5000 });
    await page.keyboard.up("KeyI"); await page.keyboard.up("ControlLeft");
    assert.ok((await app.locator('[name="interaction-shortcut"]').inputValue()).includes("Ctrl"));
    await app.locator('[name="frame-Token-size"]').fill("3.5");
    assert.ok(await app.locator('[data-dmicher-setting-help]').count() > 0);
    await app.screenshot({ path: path.join(output, `${version}-${lang}-settings.png`) });
    await app.locator('[data-screen-action="save"]').click(); await app.waitFor({ state: "detached" });
    const saved = await page.evaluate(() => settingValues.get("interactiveObjects"));
    assert.deepEqual(saved.highlight.keys, ["ControlLeft", "KeyI"]); assert.equal(saved.highlight.frames.Token.size, 3.5);
    assert.deepEqual(errors, []); await context.close(); console.log(`${version} ${lang}: Premium visibility, field gating, key capture and save passed`);
  }
} finally { await browser.close(); await fixture.close(); }
