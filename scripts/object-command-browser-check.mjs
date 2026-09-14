import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/commands-review"); await fs.mkdir(output, { recursive: true });
try {
  for (const version of ["13.351", "14.366"]) for (const lang of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${lang}`); await page.waitForFunction(() => globalThis.ready);
    await page.evaluate(() => controller.openObjectBehavior({ type: "Token", id: "guard" }));
    const app = page.locator(".ms-object-behavior");
    const checkInterruptionHelp = async (hasScript = false) => {
      const rows = await app.locator('.ms-script-interruptions tr').evaluateAll(rows => rows.map(row => ({
        name: row.querySelector('input,select').name,
        links: [...row.querySelectorAll('[data-dmicher-setting-help]')].map(link => ({
          key: link.dataset.dmicherSettingHelp, tabIndex: link.tabIndex, hint: link.title
        }))
      })));
      assert.equal(rows.length, hasScript ? 13 : 6);
      for (const { name, links } of rows) {
        const source = name.split('-interruption-')[1];
        const key = name.startsWith('command-') ? `settings-commands#${source}` : `settings-scripts#interruption-${source}`;
        assert.equal(links.length, 1, `${name} must have one contextual help link`);
        assert.equal(links[0].key, key, `${name} must explain its own command or script semantics`);
        assert.equal(links[0].tabIndex, -1); assert.ok(links[0].hint);
      }
    };
    await app.locator('[data-screen-action="tab"][data-tab="commands"]').click();
    assert.equal(await app.locator("[data-command-enabled]").count(), 12);
    assert.equal(await app.locator("[data-command-enabled]:checked").count(), 0);
    await app.locator('[data-screen-action="edit-command"][data-command-id="come"]').click();
    await app.locator('[data-command-fields="come"]').waitFor();
    await checkInterruptionHelp();
    await app.locator('[data-command-enabled="come"]').check();
    await app.locator('[name="command-allow"]').fill("trusted");
    await app.locator('[name="command-param-duration"]').fill("3.5");
    await app.locator('[data-command-fields] details').first().locator('summary').first().click();
    const group = app.locator('[name="command-group"]').first();
    await group.locator('xpath=ancestor::details[1]').locator('summary').first().click();
    assert.equal(await app.locator('[name="command-state"]').first().isDisabled(), true);
    await group.check(); await app.locator('[name="command-state"]').first().check();
    await app.locator('[data-screen-action="edit-command-script"][data-phase="beforeScript"]').click();
    await checkInterruptionHelp(true);
    assert.equal(await app.locator('[name="script-0-interruption-command"]').inputValue(), "ignore");
    assert.equal(await app.locator('[data-dmicher-json-id="script-block-0"]').count(), 1);
    await app.locator('[data-screen-action="add-script-step"]').click();
    await checkInterruptionHelp(true);
    await app.locator('[name="script-0-name"]').fill("Before come");
    await app.locator('[data-screen-action="edit-command-script"][data-phase="afterScript"]').click();
    await checkInterruptionHelp(true);
    await app.locator('[name="script-0-name"]').fill("After come");
    const transfer = app.locator('[data-dmicher-json-id="script-block-0"]');
    const downloadReady = page.waitForEvent("download"); await transfer.locator('[data-dmicher-json="export"]').click();
    const downloaded = await downloadReady, envelope = JSON.parse(await fs.readFile(await downloaded.path(), "utf8"));
    assert.equal(envelope.data.name, "After come"); assert.equal(envelope.data.interruptions.command, "ignore");
    assert.equal(Object.hasOwn(envelope.data, "stateId"), false);
    const beforeImport = await page.evaluate(() => JSON.stringify(scene.flags));
    envelope.data.name = "Imported after come";
    const chooserReady = page.waitForEvent("filechooser"); await transfer.locator('[data-dmicher-json="import"]').click();
    await (await chooserReady).setFiles({ name: "command-script.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(envelope)) });
    await page.waitForFunction(() => document.querySelector('.ms-object-behavior [name="script-0-name"]')?.value === "Imported after come");
    assert.equal(await page.evaluate(() => JSON.stringify(scene.flags)), beforeImport);
    await checkInterruptionHelp(true);
    await app.locator('[data-screen-action="edit-command"][data-command-id="wait"]').click();
    await app.locator('[data-command-enabled="wait"]').check();
    await app.locator('[name="command-param-seconds"]').fill("2.5");
    await app.locator('footer [data-screen-action="save"]').click();
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"].commands?.length === 2);
    const commands = await page.evaluate(() => scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"].commands);
    const come = commands.find(command => command.id === "come"), wait = commands.find(command => command.id === "wait");
    assert.equal(come.enabled, true); assert.deepEqual(come.conditions.allowTags, ["trusted"]); assert.equal(come.parameters.duration, 3.5);
    assert.equal(come.beforeScript.name, "Before come"); assert.equal(come.afterScript.name, "Imported after come"); assert.equal(come.beforeScript.steps.length, 1);
    assert.equal(come.conditions.groups.length, 1); assert.equal(come.conditions.groups[0].stateIds.length, 1);
    assert.equal(wait.parameters.seconds, 2.5); assert.equal(wait.enabled, true);
    assert.ok(await app.locator(".dmicher-setting-help").count() > 0);
    await app.screenshot({ path: path.join(output, `${version}-${lang}-commands.png`) });
    await page.evaluate(() => {
      const moduleId = "dmicher-master-screen", actor = scene.tokens.get("waiter");
      actor.uuid = `Scene.${scene.id}.Token.waiter`;
      scene.flags[moduleId].objectBindings.bindings["Token:waiter"] = { type: "Token", id: "waiter", groupId: null, tags: ["trusted"], playerCharacter: true };
      Object.assign(scene.flags[moduleId].groupRuntimes.main, { runId: "synthetic-command-menu", stateId: "calm", halted: false });
      controller.mode = "director"; game.user.targets = new Set([actor.object]);
      controller.commandService = { request(packet) { globalThis.commandRequest = { target: packet.target, actorTokenId: packet.actorTokenId, commandId: packet.commandId, parameters: packet.parameters }; return Promise.resolve(); } };
      controller.openObjectMenu({ type: "Token", id: "guard" }, { x: 20, y: 120 });
    });
    const menu = page.locator(".ms-object-menu");
    await menu.waitFor(); assert.equal(await menu.locator(".ms-object-menu-heading").count(), 1);
    assert.equal(await menu.locator("button").count(), 2);
    await page.keyboard.press("End"); assert.equal(await menu.locator("button").last().evaluate(button => button === document.activeElement), true);
    await page.keyboard.press("Enter"); await page.waitForFunction(() => globalThis.commandRequest);
    assert.deepEqual(await page.evaluate(() => commandRequest), { target: { type: "Token", id: "guard" }, actorTokenId: "waiter", commandId: "wait", parameters: {} });
    assert.deepEqual(errors, []); console.log(`${version} ${lang}: command editor saved conditions, parameters and before/after scripts`);
    await context.close();
  }
} finally { await browser.close(); await fixture.close(); }
