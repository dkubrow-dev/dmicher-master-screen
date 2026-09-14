import assert from "node:assert/strict";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(async () => {
      const { buildScriptFields } = await import('/modules/dmicher-master-screen/scripts/apps/script-fields.js');
      const { bindScriptParameters } = await import('/modules/dmicher-master-screen/scripts/apps/script-parameters.js');
      await controller.editor.close();
      const root = document.createElement('section'); root.id = 'focus-fixture'; root.className = 'dmicher-master-screen dmicher-window';
      root.style.cssText = 'position:fixed;inset:20px;z-index:100;background:#20252d;padding:16px;overflow:auto';
      root.innerHTML = buildScriptFields([{ name: 'Camera', enabled: true, steps: [
        { id: 1, kind: 'focus', parameters: { audience: 'all' }, next: [] }
      ] }], null, 'Token', { signals: [], macros: [] }, { open: true });
      document.body.append(root);
      bindScriptParameters(root, () => ({}), () => {});
    });
    const root = page.locator('#focus-fixture'), options = root.locator('select[data-script-param]');
    assert.equal(await options.inputValue(), 'all');
    assert.equal(await options.getAttribute('aria-label'), language === 'en' ? 'Draw attention' : '\u041f\u0440\u0438\u0432\u043b\u0435\u0447\u044c \u0432\u043d\u0438\u043c\u0430\u043d\u0438\u0435');
    assert.deepEqual(await options.locator('option').evaluateAll(entries => entries.map(entry => entry.value)), ['all', 'players', 'gm']);
    const json = root.locator('[data-script-json-value]');
    await options.selectOption('players');
    assert.equal(JSON.parse(await json.inputValue()).audience, 'players');
    await root.locator('[data-script-json]').click();
    await json.fill(JSON.stringify({ audience: 'gm' }));
    assert.equal(await options.inputValue(), 'gm');
    assert.equal(await root.locator('[data-script-duration]').count(), 0);
    assert.deepEqual(errors, []);
    reports.push({ version, language, selector: true, jsonSync: true });
    await context.close();
  }
} finally { await browser.close(); await fixture.close(); }
console.log(JSON.stringify(reports));
