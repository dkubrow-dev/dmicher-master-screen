import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/interruption-review");
fs.mkdirSync(output, { recursive: true });
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async () => {
      const { buildScriptFields, bindScriptInterruptions, readScriptFields } = await import('/modules/dmicher-master-screen/scripts/apps/script-fields.js');
      const { normalizeScript } = await import('/modules/dmicher-master-screen/scripts/script-model.js');
      const { generics } = await import('/modules/dmicher-master-screen/scripts/generics.js');
      const { getScreenSettingHelp } = await import('/modules/dmicher-master-screen/scripts/help-content.js');
      await controller.editor.close();
      const root = document.createElement('section'); root.id = 'interruption-fixture'; root.className = 'dmicher-master-screen dmicher-window';
      root.style.cssText = 'position:fixed;inset:20px;z-index:100;background:var(--dmicher-content-bg,#20252d);padding:16px;overflow:auto';
      const scripts = ['Initial state', 'Transition', 'Routine'].map(name => normalizeScript({ name, steps: [] }));
      root.innerHTML = `<div class="ms-object-form">${buildScriptFields(scripts, null, 'Token', { signals: [], macros: [] }, { open: true, combatSupported: true })}</div>`;
      document.body.append(root);
      bindScriptInterruptions(root);
      generics.help.bindSettingHelp(root, { entries: getScreenSettingHelp(), tabIndex: -1, open: (page, anchor) => { globalThis.helpTarget = { page, anchor }; } });
      globalThis.readInterruptions = () => readScriptFields(root, scripts).map(value => normalizeScript(value).interruptions);
    });
    const root = page.locator('#interruption-fixture'), block = root.locator('.ms-script-interruptions').first();
    assert.equal(await root.locator('.ms-script-interruptions').count(), 3);
    assert.equal(await root.locator('.ms-script-interruptions [data-dmicher-setting-help]').count(), 18);
    assert.equal(await root.locator('.ms-script-interruptions [data-dmicher-setting-help]:not([tabindex="-1"])').count(), 0);
    const mode = block.locator('[data-script-error-mode]'), retries = block.locator('input[name$="-retries"]'), delay = block.locator('input[name$="-delay"]');
    assert.equal(await retries.isDisabled(), true);
    assert.equal(await delay.isDisabled(), true);
    await retries.evaluate(input => { globalThis.originalRetryInput = input; });
    await mode.selectOption('restart-step');
    assert.equal(await retries.isDisabled(), false);
    await retries.fill('9'); await delay.fill('0.25');
    await mode.selectOption('stop');
    assert.equal(await retries.isDisabled(), true);
    assert.equal(await retries.evaluate(input => input === originalRetryInput), true);
    const saved = await page.evaluate(() => readInterruptions());
    assert.deepEqual(saved[0].error, { mode: 'stop', retries: 9, delaySeconds: 0.25 });
    assert.deepEqual(saved[1].error, { mode: 'stop', retries: 3, delaySeconds: 1 });
    await block.locator('[data-dmicher-setting-help]').first().click();
    assert.deepEqual(await page.evaluate(() => helpTarget), { page: 'settings-scripts', anchor: 'interruption-combat' });
    await mode.selectOption('next-step');
    await block.screenshot({ path: path.join(output, `${version}-${language}.png`) });
    assert.deepEqual(errors, []);
    reports.push({ version, language, scriptBlocks: 3, helpLinks: 18, preservedInput: true, errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await fixture.close(); }
