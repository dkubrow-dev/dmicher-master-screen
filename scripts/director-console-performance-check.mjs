import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

// Synthetic scene only. CPU timings are regression evidence, not a GPU/FPS claim.
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/console-review");
fs.mkdirSync(output, { recursive: true });
const label = process.argv[2] ?? "current";
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const version of ["13.351", "14.366"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${fixture.origin}/?version=${version}&lang=en`);
    await page.waitForFunction(() => globalThis.ready);
    await page.locator('[data-screen-action="director"]').click();
    await page.locator('[data-screen-action="ideTab"][data-zone="detail"][data-id="console"]').click();
    const result = await page.evaluate(async () => {
      const journal = await import('/modules/dmicher-master-screen/scripts/diagnostics.js');
      const view = controller.editor.directorConsole;
      view.isDebugEnabled = () => true;
      view.schedule = () => 1;
      view.cancel = () => {};
      const payload = Object.fromEntries(Array.from({ length: 20 }, (_, id) => [`parameter${id}`, { value: id, description: 'x'.repeat(100) }]));
      const append = () => journal.appendDiagnostic({ at: '2026-09-14T12:00:00.000Z', level: 'debug', category: 'script', event: 'step.completed',
        context: { sceneId: scene.id, objectName: 'Guard', scriptName: 'Patrol', stepId: 3, parameters: payload } });
      const rows = [];
      for (const initialEntries of [50, 500]) {
        journal.clearDiagnostics();
        for (let i = 0; i < initialEntries; i++) append();
        view.refresh();
        await new Promise(requestAnimationFrame);
        const elapsed = [];
        let layoutReads = 0, clonedEntries = 0;
        const rect = Element.prototype.getBoundingClientRect, clone = globalThis.structuredClone;
        Element.prototype.getBoundingClientRect = function(...args) { layoutReads++; return rect.apply(this, args); };
        globalThis.structuredClone = function(value, ...args) { if (Array.isArray(value)) clonedEntries += value.length; return clone.call(this, value, ...args); };
        try {
          for (let i = 0; i < 100; i++) {
            const start = performance.now();
            append(); view.refresh();
            elapsed.push(performance.now() - start);
            await new Promise(requestAnimationFrame);
          }
        } finally { Element.prototype.getBoundingClientRect = rect; globalThis.structuredClone = clone; }
        elapsed.sort((a, b) => a - b);
        rows.push({ initialEntries, finalEntries: view.rows.size, updates: elapsed.length, medianMs: elapsed[50], p95Ms: elapsed[95],
          totalMs: elapsed.reduce((sum, value) => sum + value, 0), layoutReads, clonedEntries });
      }
      return rows;
    });
    if (label !== "baseline") for (const row of result) {
      assert.equal(row.clonedEntries, row.updates, "append consumes only the new snapshot");
      assert.equal(row.layoutReads, 0, "following the log never searches row rectangles");
      assert.ok(row.finalEntries <= 500, "rendered history remains bounded");
    }
    reports.push({ version, results: result });
    await page.close();
  }
  fs.writeFileSync(path.join(output, `performance-${label}.json`), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await fixture.close(); }
