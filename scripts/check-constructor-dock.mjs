// Browser integration check against installed Foundry styles and the real module template.
// A synthetic canvas/UI are used; no live world or user settings are read or modified.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";

const require = createRequire(import.meta.url);
const runtimeModules = process.env.CODEX_NODE_MODULES ?? path.join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules");
const { chromium } = require(path.join(runtimeModules, "playwright"));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(repo, "../artifacts/dmicher-master-screen/0.0.1/ui-preview");
execFileSync(process.execPath, ["--import", "./scripts/esm-loader.mjs", "scripts/preview-ui.mjs"], { cwd: repo, stdio: "pipe" });
const preview = fs.readFileSync(path.join(output, "constructor.html"), "utf8");
const html = preview.slice(preview.indexOf('<div class="ms-editor-shell'), preview.lastIndexOf("</div></main>"));
const genericStyle = fs.readFileSync(path.resolve(repo, "../dmicher-generics/dmicher-generics/styles/dmicher-generics.css"), "utf8");
const style = fs.readFileSync(path.join(repo, "dmicher-master-screen/styles/master-screen.css"), "utf8");
const source = fs.readFileSync(path.join(repo, "dmicher-master-screen/scripts/apps/constructor-dock.js"), "utf8").replace(/^export /gm, "") + "\nglobalThis.ConstructorDock = ConstructorDock;";
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const server = http.createServer((request, response) => response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><html><body></body></html>"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const report = [];
try {
  for (const version of ["13.351", "14.366"]) {
    const core = fs.readFileSync(`E:/Foundry Portable/Foundry VTT ${version}/App/resources/app/public/css/foundry2.css`, "utf8");
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const shellHTML = `<!doctype html><html><meta charset="utf-8"><style>${core}\n${genericStyle}\n${style}
      body{font-family:Arial,sans-serif;width:100%;height:100%;margin:0}#ui-left button,#ui-bottom button,#ui-right section{pointer-events:auto}
      #ui-right section{width:220px;height:100%;background:#202b37;padding:16px}#ui-bottom button{width:220px}
      #interface{color:#eee}#board{background:#31433b}.application{color:#e9e2d6}input,button,textarea,select{font-family:inherit}
      </style><body class="game theme-dark"><div id="interface"><section id="ui-left"><button>Scene controls</button></section><section id="ui-middle"><header id="ui-top"></header><footer id="ui-bottom"><button>Hotbar</button></footer></section><section id="ui-right"><section>Chat / sidebar</section></section></div><canvas id="board"></canvas><section id="pause" style="display:none"></section><section id="constructor" class="application dmicher-window dmicher-master-screen" data-dmicher-theme="dark">${html}</section></body></html>`;
    await page.setContent(shellHTML);
    await page.addScriptTag({ content: source });
    const initialize = () => {
      const board = document.getElementById("board");
      const listeners = new Map(); let sequence = 0;
      window.Hooks = { on(name, fn) { const id = ++sequence; listeners.set(id, { name, fn }); return id; }, off(name, id) { listeners.delete(id); },
        callAll(name) { for (const listener of listeners.values()) if (listener.name === name) listener.fn(); } };
      const renderer = { screen: { width: innerWidth, height: innerHeight }, resize(width, height) {
        this.screen = { width, height }; board.width = width; board.height = height;
      } };
      window.canvas = { ready: true, app: { renderer }, screenDimensions: [innerWidth, innerHeight],
        stage: { pivot: { x: 900, y: 700 }, scale: { x: 2, y: 2 }, position: { x: innerWidth / 2, y: innerHeight / 2, set(x, y) { this.x = x; this.y = y; } } },
        pan({ x, y }) {
          this.stage.pivot = { x, y };
          const ctx = board.getContext("2d"); ctx.fillStyle = "#31433b"; ctx.fillRect(0, 0, board.width, board.height);
          ctx.strokeStyle = "#536658"; for (let i = 0; i < board.width; i += 50) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, board.height); ctx.stroke(); }
          for (let i = 0; i < board.height; i += 50) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(board.width, i); ctx.stroke(); }
          ctx.fillStyle = "#c9b37e"; ctx.beginPath(); ctx.arc(this.stage.position.x, this.stage.position.y, 24, 0, Math.PI * 2); ctx.fill();
        } };
      // Foundry registers this native resize before module code.
      window.addEventListener("resize", () => { renderer.resize(innerWidth, innerHeight); canvas.screenDimensions = [innerWidth, innerHeight]; canvas.stage.position.set(innerWidth / 2, innerHeight / 2); });
      board.addEventListener("click", (event) => {
        const rect = board.getBoundingClientRect();
        window.clickedWorld = { x: ((event.clientX - rect.left) * renderer.screen.width / rect.width - canvas.stage.position.x) / canvas.stage.scale.x + canvas.stage.pivot.x,
          y: ((event.clientY - rect.top) * renderer.screen.height / rect.height - canvas.stage.position.y) / canvas.stage.scale.y + canvas.stage.pivot.y };
      });
      window.dock = new ConstructorDock(); dock.attach(document.getElementById("constructor")); dock.bindControls();
      window.hookCount = () => listeners.size;
    };
    await page.evaluate(initialize);
    const inspect = async () => page.evaluate(() => {
      const rect = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const scroll = document.querySelector(".ms-body");
      return { table: rect("board"), ui: rect("interface"), panel: rect("constructor"), renderer: canvas.app.renderer.screen,
        pivot: canvas.stage.pivot, overflow: scroll.scrollWidth > scroll.clientWidth + 1, hooks: hookCount(), layout: dock.layout };
    });
    let state = await inspect();
    assert.equal(state.table.right, state.panel.x); assert.equal(state.ui.right, state.panel.x);
    assert.equal(state.renderer.width, state.table.width); assert.equal(state.overflow, false);
    assert.equal(await page.evaluate(() => document.elementFromPoint(35, 25)?.closest("#ui-left")?.id), "ui-left");
    assert.equal(await page.evaluate(() => document.elementFromPoint(dock.layout.tableWidth - 50, 100)?.closest("#ui-right")?.id), "ui-right");
    await page.mouse.click(state.renderer.width / 2, state.renderer.height / 2);
    assert.deepEqual(await page.evaluate(() => clickedWorld), { x: 900, y: 700 });
    await page.locator('[name="name"]').fill("Unsaved draft");
    await page.screenshot({ path: path.join(output, `constructor-dock-${version}-right.png`) });
    await page.locator('[data-dock-side="bottom"]').click();
    state = await inspect(); assert.equal(state.table.bottom, state.panel.y); assert.equal(state.ui.bottom, state.panel.y);
    assert.equal(await page.locator('[name="name"]').inputValue(), "Unsaved draft");
    assert.deepEqual(state.pivot, { x: 900, y: 700 });
    await page.screenshot({ path: path.join(output, `constructor-dock-${version}-bottom.png`) });
    const divider = await page.locator("[data-dock-divider]").boundingBox();
    await page.mouse.move(divider.x + 100, divider.y + 2); await page.mouse.down();
    await page.mouse.move(divider.x + 100, divider.y - 80, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(40);
    state = await inspect(); assert.ok(state.layout.size > 380);
    const storedBottom = state.layout.size;
    await page.setViewportSize({ width: 1200, height: 800 }); await page.waitForTimeout(40);
    state = await inspect(); assert.equal(state.renderer.height, state.table.height); assert.equal(state.table.bottom, state.panel.y);
    await page.evaluate(() => { Hooks.callAll("canvasReady"); }); await page.waitForTimeout(40);
    assert.equal((await inspect()).hooks, 1);
    await page.evaluate(() => { dock.detach(); dock.detach(); document.getElementById("constructor").hidden = true; });
    state = await inspect(); assert.equal(state.table.width, 1200); assert.equal(state.table.height, 800);
    assert.equal(state.ui.width, 1200); assert.equal(state.renderer.height, 800); assert.equal(state.hooks, 0);
    await page.evaluate(() => { document.getElementById("constructor").hidden = false; window.dock = new ConstructorDock(); dock.attach(document.getElementById("constructor")); dock.bindControls(); });
    assert.equal((await inspect()).layout.size, storedBottom);
    assert.equal((await inspect()).layout.side, "bottom");
    await page.locator('[data-dock-side="right"]').click();
    let grip = await page.locator("[data-dock-divider]").boundingBox();
    assert.equal(grip.width, 7);
    await page.mouse.move(grip.x + 3, 200); await page.mouse.down(); await page.mouse.move(grip.x - 57, 200); await page.mouse.up();
    await page.waitForTimeout(25);
    const storedRight = (await inspect()).layout.size;
    assert.ok(storedRight > 480);
    await page.setViewportSize({ width: 600, height: 600 }); await page.waitForTimeout(25);
    assert.equal((await inspect()).layout.size, 300);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("dmicher-master-screen.constructor-dock")).right), storedRight);
    await page.reload(); await page.setContent(shellHTML); await page.addScriptTag({ content: source }); await page.evaluate(initialize);
    assert.equal((await inspect()).layout.size, 300);
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(25);
    assert.equal((await inspect()).layout.size, storedRight);
    await page.locator('[data-dock-side="bottom"]').click(); assert.equal((await inspect()).layout.size, storedBottom);
    await page.reload(); await page.setContent(shellHTML); await page.addScriptTag({ content: source }); await page.evaluate(initialize);
    assert.equal((await inspect()).layout.size, storedBottom);
    assert.equal((await inspect()).layout.side, "bottom");
    grip = await page.locator("[data-dock-divider]").boundingBox(); assert.equal(grip.height, 7);
    await page.evaluate(() => dock.detach());
    assert.equal(errors.length, 0, errors.join("\n"));
    report.push({ version, passed: true, checks: ["right/bottom disjoint geometry", "renderer pixels match CSS size", "canvas click maps to unchanged world point", "orientation preserves raw draft", "drag and viewport resize", "canvasReady", "idempotent cleanup and restored table", "visible 7px divider in both orientations", "close/reopen and page reload retain both sizes and side", "small viewport clamps without overwriting remembered size"] });
    await page.close();
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
fs.writeFileSync(path.join(output, "constructor-dock-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
