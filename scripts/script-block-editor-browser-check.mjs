import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const screenshotDir = path.resolve("../artifacts/dmicher-master-screen/0.0.1/script-block-editor-layout");
await mkdir(screenshotDir, { recursive: true });
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    const id = await page.evaluate(async () => {
      const { generics } = await import("/modules/dmicher-master-screen/scripts/generics.js");
      globalThis.scriptBlockPremium = generics.premium.registerProvider({
        apiVersion: 1,
        hasAccess: () => true,
        extensions: [{
          moduleId: "dmicher-master-screen",
          apiVersion: 1,
          methods: {
            resolveDialogueAudioPickerOptions: base => base(),
            resolveDialogueAudio: base => base(),
            resolveInteractivePresentation: () => true,
            canExecuteScriptKind: () => true,
            resolveShopRestoration: () => true,
            resolvePlayerActionLock: () => true
          }
        }]
      });
      const { ScriptBlockEditor } = await import("/modules/dmicher-master-screen/scripts/apps/script-block-editor.js");
      const ownerKey = "Group:main";
      const script = {
        name: "Fixture script",
        enabled: true,
        repeat: false,
        steps: [
          { id: 1, kind: "wait", parameters: { seconds: 1 }, next: [], transition: { mode: "next", macro: "" } },
          { id: 2, kind: "macro", parameters: { macroUuid: "Macro.demo", signalId: "", before: 0, after: 0 }, next: [], transition: { mode: "next", macro: "" } }
        ]
      };
      globalThis.scriptBlockFixture = new ScriptBlockEditor({
        script,
        title: "Fixture",
        context: () => ({
          ownerKey,
          scriptScope: "group",
          owner: { documentName: "Group" },
          catalog: { macros: [{ ownerKey, uuid: "Macro.demo" }], signals: [] },
          definitions: []
        }),
        save: async value => { globalThis.savedScriptBlock = structuredClone(value); }
      });
      await globalThis.scriptBlockFixture.render({ force: true });
      return globalThis.scriptBlockFixture.id;
    });
    const app = page.locator(`[id="${id}"]`);
    await app.waitFor();
    assert.equal(await app.locator('[data-screen-action="save"]').count(), 1);
    assert.equal(await app.locator('[data-dmicher-json="import"]').count(), 1);
    assert.equal(await app.locator('[data-dmicher-json="export"]').count(), 1);
    const firstRow = app.locator('[data-script-step="0"]');
    const kindCell = firstRow.locator('.ms-script-main-cell');
    const kindInput = kindCell.locator('[data-script-kind-input]');
    const kindButton = kindCell.locator('[data-script-kind-button]');
    assert.equal(await firstRow.locator(':scope > td').count(), 3);
    assert.ok(await kindInput.evaluate(element => element.getBoundingClientRect().width >= 140));
    assert.ok(await kindButton.evaluate(element => element.getBoundingClientRect().width <= 32));
    assert.equal(await kindCell.locator('[data-dmicher-setting-help]:visible').count(), 2);
    assert.equal(await kindCell.locator('.ms-script-kind-field [data-dmicher-setting-help]:visible').count(), 1);
    assert.equal(await kindCell.locator('.ms-script-json-action [data-dmicher-setting-help]:visible').count(), 1);
    const helpPlacement = await kindCell.evaluate(cell => {
      const follows = (control, help) => {
        const controlBox = control.getBoundingClientRect(), helpBox = help.getBoundingClientRect();
        return helpBox.left >= controlBox.right && Math.abs((helpBox.top + helpBox.bottom) - (controlBox.top + controlBox.bottom)) <= 2;
      };
      return follows(cell.querySelector('[data-script-kind-button]'), cell.querySelector('.ms-script-kind-field [data-dmicher-setting-help]'))
        && follows(cell.querySelector('[data-script-json]'), cell.querySelector('.ms-script-json-action [data-dmicher-setting-help]'));
    });
    assert.equal(helpPlacement, true);
    assert.equal(await firstRow.locator('[data-script-transition] [data-screen-action="remove-script-step"]').count(), 1);
    const verticalLayout = await kindCell.evaluate(cell => {
      const header = cell.querySelector('.ms-script-kind-row').getBoundingClientRect();
      const parameters = cell.querySelector('[data-script-parameter-fields]').getBoundingClientRect();
      return parameters.top >= header.bottom;
    });
    assert.equal(verticalLayout, true);
    await app.screenshot({ path: path.join(screenshotDir, `${version}-${language}-normal.png`) });
    await app.evaluate(element => { element.style.width = "620px"; });
    assert.equal(await app.locator('.ms-script-table-scroll').evaluate(element => element.scrollWidth > element.clientWidth), true);
    assert.ok(await kindInput.evaluate(element => element.getBoundingClientRect().width >= 140));
    await app.screenshot({ path: path.join(screenshotDir, `${version}-${language}-narrow.png`) });
    await app.evaluate(element => { element.style.width = "980px"; });

    await app.locator('[data-script-step="0"] [data-script-kind-button]').click();
    const functionCatalog = page.locator(".dmicher-catalog-dialog");
    await functionCatalog.waitFor();
    assert.ok(await functionCatalog.locator('[data-dmicher-catalog-entry="pause"] button').isEnabled());
    await functionCatalog.locator('[data-dmicher-catalog-entry="pause"] button').click();
    await page.waitForFunction(id => document.getElementById(id)?.querySelector('[data-script-step="0"] [data-script-kind]')?.value === "pause", id);

    const firstStep = app.locator('[data-script-step="0"]');
    await firstStep.locator("[data-script-json]").click();
    assert.equal(await firstStep.locator("[data-script-json-value]").isVisible(), true);

    const macroStep = app.locator('[data-script-step="1"]');
    assert.equal(await macroStep.locator("[data-script-macro-button]").isEnabled(), true);
    await macroStep.locator("[data-script-macro-button]").click();
    const macroCatalog = page.locator(".dmicher-catalog-dialog");
    await macroCatalog.waitFor();
    assert.ok(await macroCatalog.locator('[data-dmicher-catalog-entry="__dmicher_macro_new__"] button').isEnabled());
    await macroCatalog.locator('[data-dmicher-catalog-entry="Macro.demo"] button').click();
    assert.equal(await macroStep.locator("[data-script-macro-uuid]").inputValue(), "Macro.demo");

    await app.locator('[data-screen-action="save"]').click();
    await page.waitForFunction(() => Boolean(globalThis.savedScriptBlock));
    const saved = await page.evaluate(() => globalThis.savedScriptBlock);
    assert.equal(saved.steps[0].kind, "pause");
    assert.equal(saved.steps[1].parameters.macroUuid, "Macro.demo");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${version} ${language}: ScriptBlockEditor save, function catalog, JSON and macro catalog passed`);
  }
} finally {
  await browser.close();
  await fixture.close();
}
