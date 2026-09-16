import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/workspace-review");
await fs.mkdir(output, { recursive: true });
const reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const lang of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${lang}`); await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(() => {
      ui.sidebar = { activeTab: "actors", activateTab(tab) { this.activeTab = tab; } };
      const app = {
        id: "fixture-character-sheet", rendered: false, title: "Character reference", options: {},
        position: { left: 20, top: 120, width: 340, height: 320 },
        async render() {
          if (!this.element) { this.element = document.createElement("aside"); this.element.textContent = this.title; document.body.append(this.element); }
          Object.assign(this.element.style, { position: "absolute", background: "#303038", zIndex: "25", padding: "8px" });
          this.rendered = true; this.setPosition(this.position); return this;
        },
        setPosition(value) { Object.assign(this.position, value); Object.assign(this.element?.style ?? {}, { left: `${this.position.left}px`, top: `${this.position.top}px`, width: `${this.position.width}px`, height: `${this.position.height}px` }); },
        async minimize() { this.minimized = true; }, async maximize() { this.minimized = false; },
        async close() { this.element?.remove(); this.element = null; this.rendered = false; }, bringToFront() { ui.activeWindow = this; }
      };
      const actor = { uuid: "Actor.fixture", documentName: "Actor", testUserPermission: () => true, sheet: app };
      app.document = actor; ui.windows[app.id] = app; globalThis.presetSheet = app; void app.render();
      const resolve = fromUuid; globalThis.fromUuid = uuid => uuid === actor.uuid ? Promise.resolve(actor) : resolve(uuid);
      scene.notes = new Map(); let serial = 0;
      const note = data => {
        const source = structuredClone(data), id = source._id ?? `note-${++serial}`; source._id = id;
        const document = { ...source, id, documentName: "Note", parent: scene, getFlag: (scope, key) => source.flags?.[scope]?.[key], toObject: () => structuredClone(source) };
        scene.notes.set(id, document); return document;
      };
      globalThis.fixtureNote = note;
      note({ _id: "original-a", x: 100, y: 100, text: "Main entrance", iconSize: 40 });
      note({ _id: "original-b", x: 300, y: 180, text: "Secret passage", iconSize: 40 });
      scene.createEmbeddedDocuments = async (type, values) => { if (type !== "Note") throw new Error("Unexpected fixture type"); return values.map(note); };
      scene.updateEmbeddedDocuments = scene.createEmbeddedDocuments;
      scene.deleteEmbeddedDocuments = async (type, ids) => { if (type !== "Note") throw new Error("Unexpected fixture type"); return ids.map(id => { const value = scene.notes.get(id); scene.notes.delete(id); return value; }); };
    });
    const app = page.locator("#dmicher-master-screen-editor");
    const tab = async id => {
      const target = app.locator(`[data-screen-action="ideTab"][data-id="${id}"]`);
      if (!await target.isVisible()) await app.locator('[data-screen-action="menuCategory"][data-id="tools"]').click();
      await target.click();
    };
    const action = (id, kind) => app.locator(`[data-screen-action="${id}"][data-preset-kind="${kind}"]`).first().click();
    await tab("windows");
    const beforeCapture = await page.evaluate(() => JSON.stringify(scene.flags));
    await action("captureWorkspacePreset", "windows");
    await app.locator('[name="workspacePresetName"]').fill("GM desk");
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags)), beforeCapture, "capture must create only a draft");
    await app.locator('.ms-workspace-entry summary').first().click();
    const assertHelp = async () => {
      const help = await app.locator('[data-ide-parameters] [data-dmicher-setting-help]').evaluateAll(links => links.map(link => ({ key: link.dataset.dmicherSettingHelp, tabIndex: link.tabIndex, hint: link.title })));
      assert.ok(help.length >= 10); assert.equal(new Set(help.map(link => link.key)).size, help.length);
      for (const entry of help) { assert.equal(entry.tabIndex, -1); assert.ok(entry.hint); assert.ok(entry.key.startsWith("settings-workspace-presets#")); }
    };
    await assertHelp();
    await app.locator('[name$=":width"]').fill("360");
    await action("saveWorkspacePreset", "windows");
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].workspacePresets?.windows[0]?.name === "GM desk");
    assert.equal(await page.evaluate(() => scene.flags["dmicher-master-screen"].workspacePresets.windows[0].entries.length), 1);
    await page.evaluate(async () => { await presetSheet.close(); ui.sidebar.activeTab = "chat"; });
    await action("applyWorkspacePreset", "windows");
    await page.waitForFunction(() => presetSheet.rendered && presetSheet.position.width === 360);
    assert.equal(await page.evaluate(() => ui.sidebar.activeTab), "actors");
    const transfer = app.locator('[data-dmicher-json-id="workspace-windows"]');
    const downloadReady = page.waitForEvent("download"); await transfer.locator('[data-dmicher-json="export"]').click();
    const download = await downloadReady, envelope = JSON.parse(await fs.readFile(await download.path(), "utf8"));
    assert.equal(envelope.data.name, "GM desk"); assert.equal(envelope.data.entries[0].width, 360);
    envelope.data.name = "Imported desk";
    const beforeImport = await page.evaluate(() => JSON.stringify(scene.flags));
    const chooserReady = page.waitForEvent("filechooser"); await transfer.locator('[data-dmicher-json="import"]').click();
    await (await chooserReady).setFiles({ name: "layout.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)) });
    await page.waitForFunction(() => document.querySelector('[name="workspacePresetName"]')?.value === "Imported desk");
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags)), beforeImport, "JSON import remains a draft");
    await action("saveWorkspacePreset", "windows");
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].workspacePresets.windows.length === 2);
    await page.screenshot({ path: path.join(output, `${version}-${lang}-windows.png`) });
    await tab("notes");
    await action("captureWorkspacePreset", "notes");
    await app.locator('[name="workspacePresetName"]').fill("Map annotations");
    await action("saveWorkspacePreset", "notes");
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].workspacePresets.notes.length === 1);
    await action("applyWorkspacePreset", "notes");
    await page.waitForFunction(() => scene.notes.get("original-a").getFlag("dmicher-master-screen", "workspacePreset"));
    assert.equal(await page.evaluate(() => scene.notes.size), 2, "explicit adoption must not duplicate captured notes");
    await page.evaluate(() => fixtureNote({ _id: "unmanaged", x: 400, y: 500, text: "User note" }));
    await action("captureWorkspacePreset", "notes");
    await app.locator('[name="workspacePresetName"]').fill("Clean map");
    while (await app.locator('[data-screen-action="removeWorkspacePresetEntry"]').count()) {
      await app.locator('.ms-workspace-entry summary').first().click();
      await action("removeWorkspacePresetEntry", "notes");
    }
    await action("saveWorkspacePreset", "notes");
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].workspacePresets.notes.length === 2);
    const clean = app.locator('[data-select-kind="notePreset"]').filter({ hasText: "Clean map" });
    await clean.locator('[data-screen-action="applyWorkspacePreset"]').click();
    await page.waitForFunction(() => scene.notes.size === 1);
    assert.equal(await page.evaluate(() => scene.notes.has("unmanaged")), true, "unmanaged notes must survive configuration changes");
    const annotations = app.locator('[data-select-kind="notePreset"]').filter({ hasText: "Map annotations" });
    await annotations.locator('[data-screen-action="applyWorkspacePreset"]').click();
    await page.waitForFunction(() => scene.notes.size === 3);
    await annotations.locator('[data-screen-action="applyWorkspacePreset"]').click();
    await page.evaluate(() => controller.workspacePresets.lanes);
    assert.equal(await page.evaluate(() => scene.notes.size), 3, "reapplying a note preset must not duplicate notes");
    await annotations.locator('td').first().click();
    await app.locator('.ms-workspace-entry summary').first().click();
    // Several notes legitimately share the same help anchors; each control has
    // one icon, and rerendering must not duplicate it in its own label/cell.
    assert.equal(await app.locator('[name="workspacePresetName"]').evaluate(input => input.closest('label').querySelectorAll('[data-dmicher-setting-help]').length), 1);
    assert.equal(await app.locator('[name$=":removeOnLeave"]').first().evaluate(input => input.closest('label').querySelectorAll('[data-dmicher-setting-help]').length), 1);
    await page.screenshot({ path: path.join(output, `${version}-${lang}-notes.png`) });
    await app.locator('[data-screen-action="director"]').click();
    await page.waitForFunction(() => controller.editor.mode === "director");
    await tab("notes");
    await app.locator('[data-select-kind="notePreset"]').filter({ hasText: "Map annotations" }).locator('td').first().click();
    assert.equal(await app.locator('[name="workspacePresetName"]').isDisabled(), true);
    assert.equal(await app.locator('[data-screen-action="captureWorkspacePreset"]').count(), 0);
    assert.ok(await app.locator('[data-screen-action="applyWorkspacePreset"]').count() > 0);
    errors.push(...await page.evaluate(() => globalThis.errors)); assert.deepEqual(errors, []);
    reports.push({ version, lang, checks: "draft capture/save, window restore, sidebar, JSON import/export, note adoption/switch/revisit, unrelated note preservation, director read-only controls", errors });
    await context.close();
  }
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await fixture.close(); }
