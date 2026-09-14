import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/activity-review");
fs.mkdirSync(output, { recursive: true });
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser(), reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    const app = page.locator("#dmicher-master-screen-editor");
    assert.equal(await app.locator('[data-screen-action="ideTab"][data-id="activity"]').count(), 0);
    await app.locator('[data-select-kind="group"] td:last-child').first().click();
    await page.evaluate(async () => {
      const model = await import('/modules/dmicher-master-screen/scripts/script-model.js');
      const flags = scene.flags['dmicher-master-screen'], run = flags.groupRuntimes.main;
      const script = model.normalizeScript({ id: 'routine1', stateId: 'calm', name: 'Watch entrance', enabled: true,
        steps: [{ id: 1, kind: 'wait', parameters: { seconds: 5 }, next: [7] }, { id: 7, kind: 'wait', parameters: { seconds: 10 }, next: [] }] });
      script.target = { type: 'Token', id: 'guard' };
      Object.assign(run, { runId: 'run-activity', stateId: 'calm', state: { ...flags.groupDefinitions.main.states[0], scripts: [script] },
        scriptStates: { [model.scriptProgressKey(script.target, script)]: { status: 'ready', stepId: 7, action: { remainingMs: 9000 } } } });
      globalThis.activityProgressKey = model.scriptProgressKey(script.target, script);
      const target = { type: 'Token', id: 'guard' };
      run.dialogueSessions = { greeting: { sessionId: 'dialogue-1', groupId: 'main', runId: run.runId, dialogueId: 'greeting', target,
        actorTokenId: 'waiter', userId: 'player', title: 'Greeting', status: 'active', expiresAt: Date.now() + 120000,
        presentation: { visibility: 'private' }, participants: [], history: [] } };
      run.shopSessions = { inn: { sessionId: 'shop-1', groupId: 'main', runId: run.runId, shopId: 'inn', target,
        actorTokenId: 'waiter', userId: 'player', title: 'Inn', status: 'pending', expiresAt: Date.now() - 1000 } };
      game.users.set('player', { id: 'player', name: 'Player', isGM: false });
      globalThis.activityCalls = [];
      controller.openModeratorDialogue = packet => activityCalls.push({ kind: 'dialogue-join', packet });
      controller.dialogues = { ...controller.dialogues, requestModeratorFinish: packet => activityCalls.push({ kind: 'dialogue-finish', packet }) };
      controller.openShop = (target, options) => activityCalls.push({ kind: 'shop-join', target, options });
      controller.shop = { ...controller.shop, releaseSession: packet => activityCalls.push({ kind: 'shop-finish', packet }) };
    });
    await app.locator('[data-screen-action="director"]').click();
    await app.locator('[data-screen-action="ideTab"][data-zone="detail"][data-id="activity"]').click();
    await app.locator('[data-director-activity]').waitFor();
    assert.equal(await app.locator('[data-activity-interactions] tr').count(), 2);
    assert.equal(await app.locator('[data-activity-executions] tr').count(), 1);
    assert.ok((await app.locator('[data-activity-executions]').textContent()).includes('Watch entrance'));
    assert.match(await app.locator('[data-activity-executions] [data-activity-cell="step"]').textContent(), /^7 /);
    await page.screenshot({ path: path.join(output, `${version}-${language}-active.png`) });
    for (const kind of ['dialogue', 'shop']) for (const action of ['join', 'finish']) {
      await app.locator(`[data-activity-key="${kind}:${kind}-1"] [data-activity-action="${action}"]`).click();
    }
    assert.deepEqual(await page.evaluate(() => activityCalls.map(call => call.kind)), ['dialogue-join', 'dialogue-finish', 'shop-join', 'shop-finish']);
    assert.equal(await page.evaluate(() => activityCalls[2].options.join), true);
    assert.equal(await page.evaluate(() => activityCalls[2].options.sessionId), 'shop-1');
    await app.locator('[data-activity-action="focus"]').click();
    assert.equal(await page.evaluate(() => focusedMapObject), 'Token:guard');
    await page.evaluate(() => {
      globalThis.activityRenders = 0;
      const render = controller.editor.render.bind(controller.editor);
      controller.editor.render = (...args) => { activityRenders++; return render(...args); };
      globalThis.retainedRow = document.querySelector('[data-activity-executions] tr');
      globalThis.retainedButton = retainedRow.querySelector('button');
      globalThis.activityMutations = [];
      globalThis.activityObserver = new MutationObserver(records => activityMutations.push(...records));
      activityObserver.observe(document.querySelector('[data-director-activity]'), { childList: true, characterData: true, subtree: true });
      const flags = scene.flags['dmicher-master-screen'], run = flags.groupRuntimes.main;
      for (let i = 0; i < 150; i++) {
        run.scriptStates[activityProgressKey].action.remainingMs -= 1;
        run.dialogueSessions.greeting.expiresAt += 1;
        controller.editor.directorActivity.refresh(scene);
      }
    });
    assert.equal(await page.evaluate(() => activityMutations.length), 0, 'clock-only updates leave DOM unchanged');
    await page.evaluate(() => {
      const run = scene.flags['dmicher-master-screen'].groupRuntimes.main;
      run.scriptStates[activityProgressKey].stepId = 1;
      controller.changed(scene);
    });
    await page.waitForFunction(() => document.querySelector('[data-activity-cell="step"]').textContent.startsWith('1 '));
    assert.equal(await page.evaluate(() => activityRenders), 0, 'a changed step updates the activity table only');
    assert.equal(await page.evaluate(() => retainedRow.isConnected && retainedRow.querySelector('button') === retainedButton), true);
    await page.evaluate(() => {
      const run = scene.flags['dmicher-master-screen'].groupRuntimes.main;
      run.dialogueSessions.greeting.status = 'finished'; delete run.shopSessions.inn;
      controller.changed(scene);
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-activity-interactions] tr').length === 0);
    await page.evaluate(() => {
      const run = scene.flags['dmicher-master-screen'].groupRuntimes.main;
      run.dialogueSessions.greeting.status = 'active'; run.dialogueSessions.greeting.expiresAt = Date.now() + 120;
      controller.editor.directorActivity.refresh(scene);
    });
    assert.equal(await app.locator('[data-activity-interactions] tr').count(), 1);
    await page.waitForFunction(() => document.querySelectorAll('[data-activity-interactions] tr').length === 0);
    assert.equal(await page.evaluate(() => activityRenders), 0, 'idle expiry needs no IDE render');
    await page.screenshot({ path: path.join(output, `${version}-${language}.png`) });
    await page.evaluate(() => { game.user.isGM = false; controller.editor.directorActivity.refresh(scene); });
    assert.equal(await app.locator('[data-activity-executions] tr').count(), 0, 'losing GM permission clears data');
    await page.evaluate(() => { game.user.isGM = true; controller.editor.directorActivity.refresh(scene); });
    await app.locator('[data-screen-action="ideTab"][data-zone="detail"][data-id="parameters"]').click();
    await page.evaluate(() => {
      controller.editor.directorActivity.read = () => { throw new Error('Hidden activity must not read'); };
      controller.editor.directorActivity.refresh(scene);
    });
    assert.deepEqual(errors, []);
    reports.push({ version, language, interactions: 2, scriptStep: true, stableDOM: true, independentRefresh: true, leaseExpiry: true });
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
  process.stdout.write(JSON.stringify(reports) + '\n');
} finally { await browser.close(); await fixture.close(); }
