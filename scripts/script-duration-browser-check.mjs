import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/duration-review");
fs.mkdirSync(output, { recursive: true });
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
      const root = document.createElement('section'); root.id = 'duration-fixture'; root.className = 'dmicher-master-screen dmicher-window';
      root.style.cssText = 'position:fixed;inset:20px;z-index:100;background:var(--dmicher-content-bg,#20252d);padding:16px;overflow:auto';
      root.innerHTML = buildScriptFields([{ name: 'Timing', enabled: true, steps: [
        { id: 1, kind: 'move', parameters: { duration: 0 }, next: [] },
        { id: 2, kind: 'emotion', parameters: { emoji: '!', duration: 0 }, next: [] },
        { id: 3, kind: 'wait', parameters: { seconds: 0 }, next: [] }
      ] }], null, 'Token', { signals: [], macros: [] }, { open: true });
      document.body.append(root);
      globalThis.parameterChanges = 0;
      bindScriptParameters(root, () => ({}), () => parameterChanges++);
    });
    const root = page.locator('#duration-fixture'), row = root.locator('[data-script-step="0"]');
    const duration = row.locator('[data-script-duration]');
    assert.equal(await root.locator('.ms-script-zero-duration').count(), 3);
    const original = await duration.evaluate(input => { globalThis.originalDurationInput = input; return getComputedStyle(input.closest('tr')).color; });
    assert.equal(original, await duration.evaluate(input => getComputedStyle(input).color));
    await duration.fill('2.5');
    assert.equal(await row.locator('.ms-script-zero-duration').count(), 0);
    assert.equal(await duration.evaluate(input => input === originalDurationInput), true, 'ordinary input does not rebuild the row');
    await duration.fill('0');
    assert.equal(await row.locator('.ms-script-zero-duration').count(), 1);
    await duration.fill('');
    assert.equal(await row.locator('.ms-script-zero-duration').count(), 0, 'an unfinished value is not a declared zero');
    await duration.fill('0');
    await row.locator('[data-script-json]').click();
    const json = row.locator('[data-script-json-value]');
    await json.fill(JSON.stringify({ duration: 4 }));
    assert.equal(await row.locator('.ms-script-zero-duration').count(), 0);
    assert.equal(await duration.inputValue(), '4');
    await json.fill(JSON.stringify({ duration: 0 }));
    assert.equal(await row.locator('.ms-script-zero-duration').count(), 1);
    const mode = row.locator('select[data-script-param]').first();
    await mode.selectOption('speed');
    assert.equal(await row.locator('[data-script-duration]').count(), 0);
    assert.equal(await row.locator('.ms-script-zero-duration').count(), 0);
    await mode.selectOption('duration');
    assert.equal(await row.locator('.ms-script-zero-duration').count(), 1);
    assert.equal(JSON.parse(await json.inputValue()).duration, 0);
    await row.locator('[data-script-json]').click();
    await root.screenshot({ path: path.join(output, `${version}-${language}.png`) });
    await root.evaluate(element => element.dataset.dmicherTheme = 'light');
    const light = await duration.evaluate(input => getComputedStyle(input).color);
    assert.notEqual(light, original, 'the warning follows the shared theme');
    assert.equal(light, await duration.evaluate(input => getComputedStyle(input.closest('tr')).color));
    assert.deepEqual(errors, []);
    reports.push({ version, language, color: original, lightColor: light, changes: await page.evaluate(() => parameterChanges), errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
} finally { await browser.close(); await fixture.close(); }
