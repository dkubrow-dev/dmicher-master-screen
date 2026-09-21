import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

// Real Edge DOM/timers and production module code, but synthetic ApplicationV2,
// users, settings and tool services. No Foundry world/server is contacted.
const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/spotlight-automation-review");
await fs.mkdir(output, { recursive: true });
const reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const language of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${language}`);
    await page.waitForFunction(() => globalThis.ready);
    await page.addStyleTag({ url: `${fixture.origin}/modules/dmicher-spotlight-tools/styles/dmicher-spotlight-tools.css` });
    await page.evaluate(async language => {
      await controller.editor.close(); globalThis.canvas = undefined;
      globalThis.CONST = { ...globalThis.CONST, USER_ROLES: { ASSISTANT: 3, GAMEMASTER: 4 } };
      class Users extends Map { [Symbol.iterator]() { return this.values(); } filter(fn) { return [...this.values()].filter(fn); } }
      game.users = new Users([[game.user.id, game.user]]); game.actors = new Map();
      const translations = await (await fetch(`/modules/dmicher-spotlight-tools/lang/${language}.json`)).json();
      const originalLocalize = game.i18n.localize;
      game.i18n.localize = key => key.split(".").reduce((value, part) => value?.[part], translations) ?? translations[key] ?? originalLocalize(key);
      game.i18n.format = (key, values) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), game.i18n.localize(key));
      const stored = new Map(), definitions = new Map(), writes = [];
      const originalGet = game.settings.get;
      game.settings = {
        register(module, key, definition) { definitions.set(`${module}.${key}`, definition); stored.set(`${module}.${key}`, structuredClone(definition.default)); },
        get(module, key) { return stored.has(`${module}.${key}`) ? stored.get(`${module}.${key}`) : originalGet(module, key); },
        async set(module, key, value) { stored.set(`${module}.${key}`, structuredClone(value)); writes.push(`${module}.${key}`); definitions.get(`${module}.${key}`)?.onChange?.(value); Hooks.callAll("updateSetting", { key: `${module}.${key}` }); return value; }
      };
      const { SpotlightAutomation } = await import('/modules/dmicher-spotlight-tools/scripts/automation/adapter.js');
      const { SpotlightAutomationBridge } = await import('/modules/dmicher-master-screen/scripts/spotlight-automation.js');
      const { ActiveRequestsApplication } = await import('/modules/dmicher-spotlight-tools/scripts/tools/requests/active-requests-window.js');
      const { FocusAutomationObserver } = await import('/modules/dmicher-spotlight-tools/scripts/automation/focus-observer.js');
      const { AUDIT_METRICS } = await import('/modules/dmicher-spotlight-tools/scripts/tools/focus/focus-utils.js');
      const events = await import('/modules/dmicher-spotlight-tools/scripts/automation/events.js');
      const counts = { subscriptions: 0, unsubscriptions: 0, resets: 0 }, delivered = [];
      const host = new SpotlightAutomation({ requestTool: { state: { entries: [] }, async processRequestTimeoutReset(_id, { check }) { check(); counts.resets++; } },
        pollTool: { state: { templates: {} } }, timerTool: { state: { timers: {} }, getTimerTemplates: () => [] }, stopwatchTool: {}, focusAuditTool: {} });
      host.registerSettings(); host.activate();
      const subscribe = host.subscribe.bind(host);
      host.subscribe = listener => { counts.subscriptions++; const dispose = subscribe(listener); return () => { counts.unsubscriptions++; dispose(); }; };
      const removeObserver = events.subscribeAutomation(event => delivered.push(event));
      const bridge = new SpotlightAutomationBridge({ onError: error => { throw error; } }); bridge.registerSettings();
      game.modules.set('dmicher-spotlight-tools', { active: true, api: { automation: host } });
      game.modules.set('dmicher-master-screen', { active: false });
      const app = new ActiveRequestsApplication({ getRows: () => [], getCount: () => 0, forgetWindow() {} });
      await app.render({ force: true });
      globalThis.spotlightFixture = { app, host, bridge, counts, delivered, writes, removeObserver, events, FocusAutomationObserver, AUDIT_METRICS };
    }, language);
    const app = page.locator('.dmicher-active-requests');
    await app.locator('[data-automation-tab="automation"]').click();
    assert.equal(await app.locator('.dmicher-automation-placeholder fieldset').getAttribute('disabled'), '');
    assert.equal(await app.locator('.dmicher-automation-placeholder button').isDisabled(), true);
    assert.equal(await app.locator('[data-automation-tab="automation"]').textContent(), language === 'ru' ? '\u0410\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0437\u0430\u0446\u0438\u044f' : 'Automation');
    assert.equal(await page.evaluate(() => spotlightFixture.writes.length), 0);
    await app.screenshot({ path: path.join(output, `${version}-${language}-placeholder.png`) });
    await page.evaluate(async () => {
      const { bridge, host, app } = spotlightFixture;
      game.modules.set('dmicher-master-screen', { active: true, api: { automation: bridge.api } });
      bridge.install(); bridge.connect(host); bridge.connect(host);
      await app.render({ force: true });
    });
    await app.locator('[data-world-action="add"]').waitFor();
    for (let i = 0; i < 3; i++) {
      await app.locator('[data-automation-tab="content"]').click();
      await app.locator('[data-automation-tab="automation"]').click();
    }
    assert.equal(await page.evaluate(() => spotlightFixture.bridge.listeners.size), 1);
    assert.equal(await page.evaluate(() => spotlightFixture.counts.subscriptions), 1);
    await app.locator('[data-world-action="add"]').click();
    const editor = page.locator('.application').filter({ has: page.locator('[data-world-event]') });
    const sourceLabel = language === 'ru' ? '\u0417\u0430\u044f\u0432\u043a\u0438' : 'Requests';
    const eventLabel = language === 'ru' ? '\u0417\u0430\u044f\u0432\u043a\u0430 \u043f\u043e\u0434\u0430\u043d\u0430' : 'Request submitted';
    assert.equal(await editor.locator('[data-world-event] option:checked').textContent(), `${sourceLabel} \u2014 ${eventLabel}`);
    assert.deepEqual(JSON.parse(await editor.locator('[data-world-event]').inputValue()), ['requests', 'requests', 'requests.submitted']);
    const signal = await page.evaluate(() => [...foundry.applications.instances.values()].find(app => app.element?.querySelector('[data-world-event]')).context().signalOptions[0]);
    assert.equal(signal.name, eventLabel);
    assert.equal(signal.id, 'requests:requests:requests.submitted');
    await editor.locator('[data-screen-action="add-script-step"]').click();
    await editor.locator('[data-script-kind-button]').click();
    const catalog = page.locator('.dmicher-catalog-dialog');
    await catalog.locator('[data-dmicher-catalog-entry="spotlight.requests.resetTimeouts"] button').click();
    await page.waitForFunction(() => document.querySelector('[data-world-event]')?.closest('.application').querySelector('[data-script-kind]')?.value === 'spotlight.requests.resetTimeouts');
    await editor.screenshot({ path: path.join(output, `${version}-${language}-subscription.png`) });
    await editor.locator('[data-screen-action="save"]').click();
    await app.locator('[data-world-action="save"]').click();
    await page.waitForFunction(() => spotlightFixture.host.readBindings({ type: 'requests', id: 'requests' }).revision === 1);
    assert.equal(await app.locator('td[title="requests:requests / requests.submitted"]').innerText(), `${sourceLabel}\n${eventLabel}`);
    await page.evaluate(async () => {
      const { events } = spotlightFixture;
      await events.publishAutomation({ type: 'requests', id: 'requests' }, 'requests.submitted', { id: 'native-event' });
    });
    await page.waitForFunction(() => spotlightFixture.counts.resets === 1);
    await page.waitForFunction(() => spotlightFixture.bridge.active.size === 0);
    await app.locator('[data-world-action="stop"]').click();
    await page.waitForFunction(() => spotlightFixture.bridge.paused);
    await app.locator('[data-world-action="resume"]').click();
    await page.waitForFunction(() => !spotlightFixture.bridge.paused);
    const nativeTimers = await page.evaluate(async () => {
      const { FocusAutomationObserver, AUDIT_METRICS, delivered } = spotlightFixture;
      const native = /\[native code\]/.test(globalThis.setTimeout.toString());
      let badReceiverRejected = false;
      try { const service = { schedule: globalThis.setTimeout }; service.schedule(() => {}, 1); } catch (error) { badReceiverRejected = error instanceof TypeError; }
      const stamp = Date.now(), player = { enabled: true, selfStatus: 'playing', activeRequests: {} };
      for (const { timestampKey } of Object.values(AUDIT_METRICS)) player[timestampKey] = stamp;
      const tool = { state: { players: { player } }, thresholds: Object.fromEntries(Object.keys(AUDIT_METRICS).map(key => [key, { doubt: 0.003, problem: 0.006, deadline: 0.009 }])) };
      const observer = new FocusAutomationObserver(tool); spotlightFixture.observer = observer;
      for (let index = 0; index < 8; index++) observer.observe({ baseline: true });
      await new Promise(resolve => globalThis.setTimeout(resolve, 800));
      const transitions = delivered.filter(event => event.name === 'focus.indicatorChanged');
      const allYellow = delivered.filter(event => event.name === 'focus.allYellow').length;
      const allRed = delivered.filter(event => event.name === 'focus.allRed').length;
      observer.dispose();
      const length = delivered.length;
      await new Promise(resolve => globalThis.setTimeout(resolve, 100));
      return { native, badReceiverRejected, transitions: transitions.length, allYellow, allRed, stopped: observer.timer === null && delivered.length === length };
    });
    assert.deepEqual(nativeTimers, { native: true, badReceiverRejected: true, transitions: 12, allYellow: 1, allRed: 1, stopped: true });
    await app.screenshot({ path: path.join(output, `${version}-${language}-world-editor.png`) });
    const cleaned = await page.evaluate(async () => {
      const { app, bridge, counts, removeObserver } = spotlightFixture;
      await app.close(); await Promise.resolve(); await Promise.resolve();
      const listenerCount = bridge.listeners.size;
      bridge.dispose(); removeObserver();
      return { listenerCount, interval: app.tickHandle, unsubscriptions: counts.unsubscriptions, active: bridge.active.size, errors: globalThis.errors };
    });
    assert.deepEqual(cleaned, { listenerCount: 0, interval: null, unsubscriptions: 1, active: 0, errors: [] });
    assert.deepEqual(errors, []);
    reports.push({ version, language, placeholder: true, worldEditor: true, nativeTimers, pageErrors: errors, cleanup: cleaned });
    await context.close();
    console.log(`${version} ${language}: Spotlight production tabs/editor/bridge and native receiver timers passed`);
  }
} finally { await browser.close(); await fixture.close(); }
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ environment: 'Headless Edge; real DOM/timers/production templates; synthetic Foundry ApplicationV2, users/settings/tool services; no live world', reports }, null, 2));
