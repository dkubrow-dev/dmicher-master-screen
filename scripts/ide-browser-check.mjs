import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url)), workspace = path.dirname(repo);
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/ide-review"); fs.mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "C:/Users/dscherkasov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const appRoot = (version) => `E:/Foundry Portable/Foundry VTT ${version}/App/resources/app`;
let currentVersion = "14.366";
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".hbs": "text/plain" };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost"), pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    currentVersion = url.searchParams.get("version") || currentVersion;
    response.setHeader("Content-Type", "text/html;charset=utf-8");
    const moduleStyles = ["dmicher-generics", "dmicher-master-screen"].flatMap((id) => JSON.parse(fs.readFileSync(path.join(workspace, id, id, "module.json"), "utf8")).styles.map((style) => `<link rel="stylesheet" href="/modules/${id}/${style}">`)).join("");
    response.end(`<!doctype html><html lang="ru" class="theme-dark"><head><meta charset="utf-8"><link rel="stylesheet" href="/foundry/css/foundry2.css"><link rel="stylesheet" href="/foundry/fonts/fontawesome/css/all.min.css">${moduleStyles}<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}#board{position:absolute;inset:0;background:repeating-linear-gradient(0deg,#253139 0,#253139 48px,#34434c 49px,#34434c 50px)}#interface{pointer-events:none;position:relative;width:100%;height:100%;z-index:1}#interface>div{pointer-events:auto;padding:8px;display:flex;gap:4px;max-width:280px}.application>.window-content{height:100%;min-height:0}.application{font-family:Arial,sans-serif}.ms-ide-tree [hidden]{display:none!important}</style></head><body class="game"><div id="board"></div><div id="interface"><div><button id="open-panel">Panel</button><button id="open-window">Window</button></div></div><script src="/handlebars.js"></script><script type="module" src="/fixture-client.js"></script></body></html>`); return;
  }
  let file;
  if (pathname === "/fixture-client.js") file = path.join(repo, "scripts/ide-browser-fixture.js");
  else if (pathname === "/handlebars.js") file = path.join(appRoot(currentVersion), "node_modules/handlebars/dist/handlebars.js");
  else if (pathname.startsWith("/foundry/")) file = path.join(appRoot(currentVersion), "public", pathname.slice(9));
  else {
    const match = /^\/modules\/(dmicher-[a-z-]+)\/(.+)$/.exec(pathname);
    if (match) file = path.resolve(workspace, match[1], match[1], match[2]);
  }
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", `${mime[path.extname(file)] || "application/octet-stream"};charset=utf-8`); response.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const reports = [];
try {
  for (const version of ["13.351", "14.366"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.stack); });
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("404")) console.error(message.text()); });
    await page.goto(`${origin}/?version=${version}`); await page.waitForFunction(() => globalThis.ready);
    const app = page.locator("#dmicher-master-screen-editor");
    await app.locator('[data-ide-parameters] [name="schemeName"]').waitFor();
    assert.equal(await page.evaluate(() => controller.editor.layout.presentation), "panel");
    const geometry = await page.evaluate(() => ({ panel: controller.editor.element.getBoundingClientRect().left, table: document.getElementById("board").getBoundingClientRect().right }));
    assert.ok(Math.abs(geometry.panel - geometry.table) <= 1);
    await app.locator('[name="schemeName"]').fill("Market square"); await app.locator('[data-ide-parameters] button[type="submit"]').click();
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].definitions.main.schemeName === "Market square");
    const clickAction = (action) => app.locator(`[data-screen-action="${action}"]`).click();
    const saveParameters = () => app.locator('[data-ide-parameters] button[type="submit"]').click();
    // Real tree editing, cross-scheme copy/move and the prompt are exercised through DOM events.
    await clickAction("addScheme"); await app.locator('[name="schemeName"]').fill("Back alley"); await saveParameters();
    const alley = await page.evaluate(() => Object.values(scene.flags["dmicher-master-screen"].definitions).find((entry) => entry.schemeName === "Back alley").schemeId);
    await app.locator('[data-ide-kind="episode"][data-ide-id="calm"][data-scheme-id="main"]').dragTo(app.locator(`[data-ide-kind="scheme"][data-ide-id="${alley}"]`));
    await app.locator('[data-choice="copy"]').click();
    await page.waitForFunction((id) => scene.flags["dmicher-master-screen"].definitions[id].episodes.length === 1, alley);
    await app.locator('[data-ide-kind="episode"][data-ide-id="tension"][data-scheme-id="main"]').dragTo(app.locator(`[data-ide-kind="scheme"][data-ide-id="${alley}"]`));
    await app.locator('[data-choice="move"]').click();
    await page.waitForFunction((id) => scene.flags["dmicher-master-screen"].definitions[id].episodes.length === 2, alley);
    assert.equal(await page.evaluate(() => scene.flags["dmicher-master-screen"].definitions.main.episodes.some((entry) => entry.id === "tension")), false);
    await app.locator('[data-screen-action="selectNode"][data-id="calm"][data-scheme-id="main"]').click();
    await app.locator('[name="name"]').fill("Unsaved local draft");
    await page.evaluate(async () => { const { SchemeEditor } = await import("/modules/dmicher-master-screen/scripts/scheme-editor.js"); await new SchemeEditor(scene).updateEpisode("main", "calm", { background: "#123456" }); });
    const conflict = await page.evaluate(async () => { try { await controller.editor.saveParameters(); return false; } catch { return true; } });
    assert.equal(conflict, true); assert.equal(await app.locator('[name="name"]').inputValue(), "Unsaved local draft");
    assert.equal(await page.evaluate(() => scene.flags["dmicher-master-screen"].definitions.main.episodes[0].background), "#123456");
    await clickAction("discardParameters");
    await app.locator('[name="background"]').fill("#12");
    await app.locator('[data-screen-action="ideSide"][data-side="bottom"]').click();
    assert.equal(await app.locator('[name="background"]').inputValue(), "#12");
    assert.equal(await page.evaluate(async () => { try { await controller.editor.saveParameters(); return false; } catch { return true; } }), true);
    await app.locator('[name="background"]').fill("#123456"); await saveParameters();
    await app.locator('[data-screen-action="ideSide"][data-side="right"]').click();
    // A typed event with ordered built-in subscribers and a macro binding.
    await app.locator('[data-screen-action="ideTab"][data-id="events"]').click(); await clickAction("addEvent");
    await app.locator('[name="eventName"]').fill("bell.rang"); await clickAction("addSubscriber"); await clickAction("addSubscriber");
    await app.locator('[data-subscriber-index="1"] [name="subscriberAction"]').selectOption("unpause");
    await app.locator('[data-screen-action="moveSubscriber"][data-index="1"][data-delta="-1"]').click(); await saveParameters();
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].eventCatalog?.events?.some((entry) => entry.name === "bell.rang"));
    const eventId = await page.evaluate(() => controller.editor.selection.id);
    await clickAction("addTypedTrigger"); await app.locator('[name="triggerName"]').fill("BellRang"); await clickAction("addParameter");
    await app.locator('[name="parameterName"]').fill("volume"); await app.locator('[name="parameterType"]').selectOption("integer");
    await app.locator('[name="min"]').fill("0"); await app.locator('[name="max"]').fill("10"); await saveParameters();
    const triggerId = await page.evaluate(() => controller.editor.selection.id);
    await app.locator('[data-screen-action="ideTab"][data-id="macros"]').click();
    await app.locator('[data-macro-drop]').evaluate((element) => { const dataTransfer = new DataTransfer(); dataTransfer.setData("text/plain", JSON.stringify({ type: "Macro", uuid: "Macro.demo" })); element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer })); });
    await app.locator(`[name="macroTrigger"][value="${triggerId}"]`).check(); await saveParameters();
    await app.locator('[data-screen-action="ideTab"][data-id="events"]').click();
    await app.locator(`[data-screen-action="selectNode"][data-id="${eventId}"]`).click();
    assert.equal(await app.locator('[data-subscriber-index="0"] [name="subscriberAction"]').inputValue(), "unpause");
    await clickAction("addSubscriber");
    await app.locator('[data-subscriber-index="2"]').evaluate((element) => { const dataTransfer = new DataTransfer(); dataTransfer.setData("text/plain", JSON.stringify({ type: "Macro", uuid: "Macro.demo" })); element.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer })); });
    await app.locator('[data-subscriber-index="2"] [name="subscriberMacro"]').waitFor(); await saveParameters();
    await page.screenshot({ path: path.join(output, `${version}-events.png`) });
    // A hidden Parameters tab can always be restored by selecting a tree node.
    await app.locator('[data-screen-action="tabSettings"][data-zone="detail"]').click();
    await app.locator('[data-tab-visibility="detail"][value="parameters"]').uncheck();
    await app.locator(`[data-screen-action="selectNode"][data-id="${triggerId}"]`).click();
    await app.locator('[name="triggerName"]').waitFor();
    await app.locator('[data-screen-action="ideTab"][data-id="scene"]').click();
    // Select an episode, then a single legacy block. Saving it must preserve all hidden blocks.
    await app.locator('[data-screen-action="selectNode"][data-id="calm"][data-scheme-id="main"]').click();
    await app.locator('[data-screen-action="ideTab"][data-id="other"]').click();
    await app.locator('[data-screen-action="selectOther"][data-id="entry"]').click();
    await app.locator('[name="sound"]').fill("audio/bell.ogg");
    assert.equal(await app.locator('[data-episode-fields] [data-legacy-block]').count(), 1);
    await app.locator('[data-episode-fields] button[type="submit"]').click();
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].definitions.main.episodes[0].sound === "audio/bell.ogg");
    assert.equal(await page.evaluate(() => scene.flags["dmicher-master-screen"].definitions.main.episodes[0].workspace.gm.length), 1);
    assert.equal(await page.evaluate(() => scene.flags["dmicher-master-screen"].definitions.main.episodes[0].dialogues.length), 1);
    // Switch both orientations and resize both boundaries.
    await app.locator('[data-screen-action="ideSide"][data-side="bottom"]').click();
    const split = await app.locator("[data-ide-divider]").boundingBox();
    await page.mouse.move(split.x + 3, split.y + split.height / 2); await page.mouse.down(); await page.mouse.move(split.x + 150, split.y + split.height / 2); await page.mouse.up();
    const ratio = await page.evaluate(() => controller.editor.layout.preferences.horizontal); assert.ok(ratio > 0.4);
    const outer = await app.locator("[data-dock-divider]").boundingBox();
    await page.mouse.move(outer.x + outer.width / 2, outer.y + 3); await page.mouse.down(); await page.mouse.move(outer.x + outer.width / 2, outer.y - 100); await page.mouse.up();
    const bottomSize = await page.evaluate(() => controller.editor.dock.preferences.bottom); assert.ok(bottomSize > 400);
    await app.locator('[data-screen-action="ideTab"][data-id="scene"]').click();
    await app.locator('[data-screen-action="director"]').click();
    assert.equal(await page.locator("#dmicher-master-screen-editor").count(), 1);
    assert.equal(await app.locator('[data-screen-action="haltScene"]').count(), 1);
    await page.screenshot({ path: path.join(output, `${version}-bottom-director.png`) });
    await app.locator('[data-screen-action="constructor"]').click();
    await app.locator('[data-screen-action="ideSide"][data-side="right"]').click();
    await page.screenshot({ path: path.join(output, `${version}-right-constructor.png`) });
    // Transfer the same element into a real popup using a user click. It must not open a second world.
    const popupPromise = context.waitForEvent("page"); await app.locator('[data-screen-action="togglePresentation"]').click(); const popup = await popupPromise;
    await popup.waitForSelector("#dmicher-master-screen-editor [data-ide-parameters]");
    assert.equal(await page.locator("#dmicher-master-screen-editor").count(), 0);
    assert.equal(await page.evaluate(() => document.getElementById("board").getBoundingClientRect().width), 1440);
    assert.equal(await popup.evaluate(() => window.opener.controller.editor.element.ownerDocument === document), true);
    await popup.locator('[name="name"]').fill("Quiet market"); await popup.locator('[data-ide-parameters] button[type="submit"]').click();
    await page.waitForFunction(() => scene.flags["dmicher-master-screen"].definitions.main.episodes[0].name === "Quiet market");
    await popup.screenshot({ path: path.join(output, `${version}-popup.png`) });
    await popup.locator('[data-screen-action="togglePresentation"]').click(); await page.waitForSelector("#dmicher-master-screen-editor");
    assert.equal(await page.evaluate(() => controller.editor.element.ownerDocument === document), true);
    const nativeClosePromise = context.waitForEvent("page"); await app.locator('[data-screen-action="togglePresentation"]').click(); const nativeClose = await nativeClosePromise;
    await nativeClose.waitForSelector('[name="name"]'); await nativeClose.locator('[name="name"]').fill("Retained popup draft"); await nativeClose.close();
    await app.locator('[name="name"]').waitFor();
    assert.equal(await app.locator('[name="name"]').inputValue(), "Retained popup draft");
    await app.locator('[data-screen-action="discardParameters"]').click();
    await app.locator('[data-screen-action="close"]').click(); await app.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.getElementById("board").getBoundingClientRect().width), 1440);
    await page.locator("#open-panel").click(); await app.waitFor();
    assert.equal(await page.evaluate(() => controller.editor.layout.preferences.horizontal), ratio);
    assert.equal(await page.evaluate(() => controller.editor.dock.preferences.bottom), bottomSize);
    await page.reload(); await page.waitForFunction(() => globalThis.ready);
    assert.equal(await page.evaluate(() => controller.editor.layout.preferences.horizontal), ratio);
    assert.equal(await page.evaluate(() => controller.editor.dock.preferences.bottom), bottomSize);
    assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => globalThis.errors), []);
    reports.push({ version, layout: "right/bottom/split/outer-resize/popup/return/native-popup-close/reopen/reload", drafts: "single legacy block preserves siblings; stale save rejected; incomplete color and popup draft preserved", editing: "scheme create; episode copy/move prompt; typed event fields; ordered subscribers; macro drops; hidden tab recovery", errors });
    await context.close();
  }
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
