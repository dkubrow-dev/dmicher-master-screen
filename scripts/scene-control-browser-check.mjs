import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/control-review");
fs.mkdirSync(output, { recursive: true });
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    const app = page.locator("#dmicher-master-screen-editor");
    await app.locator('[data-screen-action="director"]').click();
    await page.evaluate(() => {
      const editor = controller.editor;
      globalThis.sceneCommands = [];
      globalThis.renderCalls = 0;
      globalThis.originalRender = editor.render.bind(editor);
      editor.render = (...args) => { renderCalls++; return originalRender(...args); };
      for (const [method, name] of [["haltScene", "stop"], ["startAll", "start"], ["restoreAllInitial", "restore"]]) {
        controller[method] = () => { sceneCommands.push(name); };
      }
      globalThis.stopButton = editor.element.querySelector('[data-screen-action="haltScene"]');
      globalThis.runtimeUpdates = () => {
        for (let step = 3; step <= 13; step++) {
          scene.flags['dmicher-master-screen'].groupRuntimes.main.scriptStates = { routine: { stepId: step, remainingMs: 10000 - step, waiting: 'duration' } };
          scene.tokens.get('guard').x += 1;
          controller.changed(scene);
        }
      };
    });
    // Keep the pointer down while steps/positions change: replacing the button
    // between down and up would silently lose a real user's click.
    const bounds = await app.locator('[data-screen-action="haltScene"]').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.evaluate(async () => { runtimeUpdates(); await Promise.resolve(); });
    assert.equal(await page.evaluate(() => stopButton.isConnected && renderCalls === 0), true);
    await page.mouse.up();
    await page.waitForFunction(() => sceneCommands.length === 1);
    assert.deepEqual(await page.evaluate(() => sceneCommands), ["stop"]);

    // Group controls retain the same dispatch contract and carry their own row
    // ID even when another group or a stale preparation draft is selected.
    await page.evaluate(() => {
      globalThis.groupCommands = [];
      for (const method of ['startGroup', 'haltGroup', 'restoreGroupInitial']) controller[method] = groupId => groupCommands.push([method, groupId]);
      globalThis.groupStopButton = controller.editor.element.querySelector('[data-screen-action="haltGroup"][data-group-id="main"]');
    });
    const groupStop = app.locator('[data-screen-action="haltGroup"][data-group-id="main"]');
    const groupBounds = await groupStop.boundingBox();
    assert.ok(groupBounds, 'group stop is visible in the main scene tree');
    await page.mouse.move(groupBounds.x + groupBounds.width / 2, groupBounds.y + groupBounds.height / 2);
    await page.mouse.down();
    await page.evaluate(async () => { runtimeUpdates(); await Promise.resolve(); });
    assert.equal(await page.evaluate(() => groupStopButton.isConnected && renderCalls === 0), true);
    await page.mouse.up();
    await page.waitForFunction(() => groupCommands.length === 1);
    assert.deepEqual(await page.evaluate(() => groupCommands), [['haltGroup', 'main']]);
    await app.locator('[data-screen-action="startGroup"][data-group-id="main"]').click();
    await app.locator('[data-screen-action="restoreGroupInitial"][data-group-id="main"]').click();
    assert.deepEqual(await page.evaluate(() => groupCommands), [['haltGroup', 'main'], ['startGroup', 'main'], ['restoreGroupInitial', 'main']]);
    const groupGeometry = await groupStop.evaluate(element => {
      const cell = element.closest('td'), row = element.closest('tr');
      return { overflow: cell.scrollWidth - cell.clientWidth, rowHeight: row.getBoundingClientRect().height,
        width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height };
    });
    assert.ok(groupGeometry.overflow <= 1, 'group controls do not overflow their table cell');
    assert.ok(groupGeometry.width >= 24 && groupGeometry.height >= 24, 'group controls remain practical pointer targets');

    // An emergency command must remain clickable while the previous stop is
    // still waiting for its persistent update. Use real DOM click dispatch.
    await page.evaluate(() => {
      globalThis.pendingStops = [];
      controller.haltScene = () => { sceneCommands.push('stop'); return new Promise(resolve => pendingStops.push(resolve)); };
    });
    await app.locator('[data-screen-action="haltScene"]').click();
    assert.equal(await app.locator('[data-screen-action="haltScene"]').isDisabled(), false);
    await app.locator('[data-screen-action="haltScene"]').click();
    assert.equal(await page.evaluate(() => pendingStops.length), 2);
    await page.evaluate(() => { for (const resolve of pendingStops) resolve(); controller.haltScene = () => sceneCommands.push('stop'); sceneCommands = ['stop']; });

    // Simulate preparation rendering which has not yet produced its new DOM.
    // The existing controls remain independently usable with stale draft keys.
    await page.evaluate(() => {
      const editor = controller.editor;
      globalThis.originalPrepare = editor._prepareContext.bind(editor);
      editor._prepareContext = async (...args) => { await new Promise((resolve) => { globalThis.releasePrepare = resolve; }); return originalPrepare(...args); };
      editor.element.querySelector('[data-editor-context]').dataset.editorContext = 'removed-scene:removed-state';
      scene.tokens.get('guard').name = 'Pending authoring refresh';
      controller.changed(scene);
    });
    await page.waitForFunction(() => globalThis.releasePrepare);
    await groupStop.click();
    assert.deepEqual(await page.evaluate(() => groupCommands.at(-1)), ['haltGroup', 'main']);
    await app.locator('[data-screen-action="haltScene"]').click();
    assert.deepEqual(await page.evaluate(() => sceneCommands), ["stop", "stop"]);
    await page.evaluate(() => {
      scene.flags['dmicher-master-screen'].automationHalted = true;
      controller.changed(scene);
    });
    await app.locator('[data-screen-action="resumeAll"]').waitFor({ state: "visible" });
    await app.locator('[data-screen-action="resumeAll"]').click();
    await app.locator('[data-screen-action="restoreAllInitial"]').click();
    assert.deepEqual(await page.evaluate(() => sceneCommands), ["stop", "stop", "start", "restore"]);
    await page.evaluate(async () => {
      const editor = controller.editor;
      editor._prepareContext = originalPrepare;
      releasePrepare();
      await editor.refreshTask;
      await editor.renderPromise;
    });
    assert.equal(await app.locator('[data-screen-action="resumeAll"]').isVisible(), true);
    assert.equal(await app.locator('[data-screen-action="haltScene"]').isVisible(), false);
    assert.equal(await app.locator('[data-screen-action="restoreAllInitial"]').isVisible(), true);
    await page.evaluate(() => {
      controller.restoreAllInitial = () => new Promise(resolve => { globalThis.releaseRestore = resolve; });
    });
    await app.locator('[data-screen-action="restoreAllInitial"]').click();
    assert.equal(await app.locator('[data-screen-action="restoreAllInitial"]').isDisabled(), true, 'ordinary commands retain pending button protection');
    await page.evaluate(() => releaseRestore());
    await page.waitForFunction(() => !document.querySelector('[data-screen-action="restoreAllInitial"]').disabled);
    const header = await app.locator('.ms-ide-scene-line').evaluate((element) => {
      const title = element.querySelector('strong'), debug = element.querySelector('.ms-check'), commands = element.querySelector('.ms-scene-commands');
      return { titleWidth: title.getBoundingClientRect().width, debugWhiteSpace: getComputedStyle(debug).whiteSpace,
        commandsTop: commands.getBoundingClientRect().top, titleBottom: title.getBoundingClientRect().bottom,
        overflow: element.scrollWidth - element.clientWidth };
    });
    assert.ok(header.titleWidth >= 120, 'scene heading keeps a readable width');
    assert.equal(header.debugWhiteSpace, 'nowrap');
    assert.ok(header.commandsTop >= header.titleBottom, 'wide stopped-state controls wrap below scene/debug');
    assert.ok(header.overflow <= 1, 'header controls stay inside the panel');
    await page.screenshot({ path: path.join(output, `${version}-${language}.png`) });
    assert.deepEqual(await page.evaluate(() => globalThis.errors), []);
    assert.deepEqual(errors, []);
    reports.push({ version, language, checks: "real pointer click survives steps 3-13 and movement notifications; no tick-induced IDE renders; stop/start/reset dispatch during pending rendering and stale draft; local stop updates controls without waiting for render", errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await fixture.close(); }
