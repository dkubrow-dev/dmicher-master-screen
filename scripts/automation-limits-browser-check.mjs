import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const screenshotDir = path.resolve("../artifacts/dmicher-master-screen/0.0.1/automation-limits-ui");
await mkdir(screenshotDir, { recursive: true });
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    const id = await page.evaluate(async () => {
      const { ScriptBlockEditor } = await import("/modules/dmicher-master-screen/scripts/apps/script-block-editor.js");
      const { normalizeScript } = await import("/modules/dmicher-master-screen/scripts/script-model.js");
      globalThis.limitEditor = new ScriptBlockEditor({ title: "Automation limits", script: normalizeScript({ name: "Prepared script", steps: Array.from({ length: 17 }, (_, i) => ({ id: i + 1, kind: "wait", parameters: { seconds: 1 }, transition: { mode: "next" } })) }),
        context: () => ({ ownerKey: "Group:main", scriptScope: "group", catalog: { macros: [], signals: [] }, definitions: [] }), save() {} });
      await limitEditor.render({ force: true }); return limitEditor.id;
    });
    const app = page.locator(`[id="${id}"]`), add = () => app.locator('[data-screen-action="add-script-step"]');
    assert.equal(await app.locator('[data-script-step]').count(), 17);
    assert.equal(await app.locator('[data-automation-limit-issue="scriptSteps"]').isVisible(), true);
    assert.equal(await add().isDisabled(), true);
    assert.equal(await app.locator('[data-script-step="16"] [data-script-kind-input]').isDisabled(), true);
    assert.equal(await app.locator('[data-script-step="16"] [data-screen-action="remove-script-step"]').isEnabled(), true);
    await app.screenshot({ path: path.join(screenshotDir, `${version}-${language}-blocked.png`) });
    await app.locator('[data-step-id="16"] [data-script-param]').fill("9");
    await app.locator('[data-step-id="17"] [data-script-drag]').focus();
    await page.keyboard.press("Alt+ArrowUp");
    assert.equal(await app.locator('[data-step-id="17"] [data-script-kind-input]').isEnabled(), true);
    assert.equal(await app.locator('[data-step-id="16"] [data-script-kind-input]').isDisabled(), true);
    const reordered = await page.evaluate(() => { limitEditor.capture(); return structuredClone(limitEditor.script); });
    assert.deepEqual(reordered.steps.slice(15).map(row => row.id), [17, 16]);
    assert.equal(reordered.steps[16].parameters.seconds, 9);
    await app.locator('[data-step-id="16"] [data-screen-action="remove-script-step"]').click();
    await page.waitForFunction(() => limitEditor.script.steps.length === 16 && !limitEditor.element.querySelector('[data-automation-limit-issue="scriptSteps"]'));
    assert.equal(await add().isDisabled(), true);
    await app.locator('[data-step-id="17"] [data-screen-action="remove-script-step"]').click();
    await page.waitForFunction(() => limitEditor.script.steps.length === 15);
    assert.equal(await add().isEnabled(), true);
    await add().click();
    await page.waitForFunction(() => limitEditor.script.steps.length === 16);
    await page.evaluate(async () => {
      const { generics } = await import("/modules/dmicher-master-screen/scripts/generics.js");
      globalThis.limitsPremium = generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => true, extensions: [{ moduleId: "dmicher-master-screen", apiVersion: 1,
        methods: { resolveAutomationLimits: () => ({ scriptSteps: null, subscriptions: null, actions: null, chainHandlers: null }) } }] });
      limitEditor.capture(); await limitEditor.render({ force: true });
    });
    assert.equal(await add().isEnabled(), true);
    await add().click();
    await page.waitForFunction(() => limitEditor.script.steps.length === 17);
    assert.equal(await app.locator('[data-script-step="16"] [data-script-kind-input]').isEnabled(), true);
    await page.evaluate(async () => { limitEditor.capture(); limitsPremium.dispose(); await limitEditor.render({ force: true }); });
    assert.equal(await app.locator('[data-script-step]').count(), 17);
    assert.equal(await app.locator('[data-script-step="16"] [data-script-kind-input]').isDisabled(), true);
    await page.evaluate(async () => {
      await limitEditor.close();
      const { mountSpotlightAutomationEditor } = await import("/modules/dmicher-master-screen/scripts/apps/spotlight-automation-editor.js");
      const owner = { type: "requests", id: "requests" };
      const root = document.createElement("div"); root.id = "world-limits"; root.className = "dmicher-master-screen";
      Object.assign(root.style, { position: "absolute", inset: "30px", zIndex: "100", overflow: "auto", padding: "16px", background: "#20252d" }); document.body.append(root);
      const host = { readBindings: () => ({ revision: 1, registeredMacroUuids: [], subscriptions: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, source: owner, event: "requests.submitted", enabled: i === 8, script: { name: `Handler ${i + 1}`, steps: [] } })) }), sources: () => [{ owner, events: ["requests.submitted"] }] };
      globalThis.worldLimitsDispose = mountSpotlightAutomationEditor(root, { owner, host });
    });
    const world = page.locator("#world-limits");
    assert.equal(await world.locator('[data-world-action="add"]').isDisabled(), true);
    assert.equal(await world.locator('[data-automation-limit-locked="subscriptions"]').count(), 1);
    await world.screenshot({ path: path.join(screenshotDir, `${version}-${language}-subscriptions.png`) });
    await world.locator('[data-world-action="remove"][data-id="s0"]').click();
    assert.equal(await world.locator('[data-automation-limit-locked="subscriptions"]').count(), 0);
    assert.equal(await world.locator('[data-world-action="add"]').isDisabled(), true);
    await world.locator('[data-world-action="remove"][data-id="s1"]').click();
    assert.equal(await world.locator('[data-world-action="add"]').isEnabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${version} ${language}: limits, locked fields, reorder capture, reduction, Premium restore/revoke and world subscriptions passed`);
  }
} finally { await browser.close(); await fixture.close(); }
