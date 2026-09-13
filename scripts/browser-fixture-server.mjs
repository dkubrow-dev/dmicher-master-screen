import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const repo = fileURLToPath(new URL("../", import.meta.url)), workspace = path.dirname(repo);
const require = createRequire(import.meta.url);
const appRoot = (version) => `E:/Foundry Portable/Foundry VTT ${version}/App/resources/app`;
const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".hbs": "text/plain" };

/** The fixtures use real module templates/CSS but never connect to a user world. */
export async function startBrowserFixture() {
  let currentVersion = "14.366";
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
    else if (pathname === "/scene-navigation.hbs") file = path.join(appRoot(currentVersion), "templates/ui/scene-navigation.hbs");
    else if (pathname === "/handlebars.js") file = path.join(appRoot(currentVersion), "node_modules/handlebars/dist/handlebars.js");
    else if (pathname.startsWith("/foundry/")) file = path.join(appRoot(currentVersion), "public", pathname.slice(9));
    else if (pathname.startsWith("/icons/")) file = path.join(appRoot(currentVersion), "public", pathname.slice(1));
    else {
      const match = /^\/modules\/(dmicher-[a-z-]+)\/(.+)$/.exec(pathname);
      if (match) file = path.resolve(workspace, match[1], match[1], match[2]);
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", `${mime[path.extname(file)] || "application/octet-stream"};charset=utf-8`); response.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function launchFixtureBrowser() {
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || "C:/Users/dscherkasov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
  return chromium.launch({ executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
}
