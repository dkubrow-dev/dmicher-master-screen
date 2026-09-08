// Local synthetic UI review. Uses the user's Foundry Handlebars, never a live world.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import http from "node:http";
import { defaultDefinition, defaultTokenBehavior, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const moduleRoot = path.join(repo, "dmicher-master-screen");
const candidates = [process.env.FOUNDRY_APP_PATH, "E:/Foundry Portable/Foundry VTT 14.366/App/resources/app", "E:/Foundry Portable/Foundry VTT 13.351/App/resources/app"].filter(Boolean);
const appRoot = candidates.find((entry) => fs.existsSync(path.join(entry, "node_modules/handlebars")));
if (!appRoot) throw new Error("Set FOUNDRY_APP_PATH to a local Foundry app directory containing Handlebars.");
const handlebars = createRequire(path.join(appRoot, "package.json"))("handlebars").create();
handlebars.registerHelper("checked", (value) => value ? "checked" : "");
handlebars.registerHelper("disabled", (value) => value ? "disabled" : "");
handlebars.registerHelper("selectOptions", (entries, options) => new handlebars.SafeString([
  ...(options.hash.blank !== undefined ? [`<option value="">${handlebars.escapeExpression(options.hash.blank)}</option>`] : []),
  ...entries.map((entry) => { const value = entry[options.hash.valueAttr ?? "value"], label = entry[options.hash.labelAttr ?? "label"];
    return `<option value="${handlebars.escapeExpression(value)}" ${value === options.hash.selected ? "selected" : ""}>${handlebars.escapeExpression(label)}</option>`; })
].join("")));
class App {
  constructor(options = {}) { this.options = options; this.rendered = false; }
  async _prepareContext() { return {}; }
}
globalThis.foundry = { applications: { api: { ApplicationV2: App, HandlebarsApplicationMixin: (base) => base, DialogV2: {} } },
  utils: { deepClone: structuredClone, randomID: () => crypto.randomUUID().replaceAll("-", "").slice(0, 16) } };
globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => "dark" }, i18n: { localize: (value) => value } };
const { EditorApplication, TokenEditorApplication } = await import("../dmicher-master-screen/scripts/apps/editor.js");
const definition = defaultDefinition(), runtime = emptyRuntime();
const portrait = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="12" fill="#26374a"/><circle cx="60" cy="43" r="24" fill="#cfc1a3"/><path d="M15 120V100Q15 70 60 70T105 100V120" fill="#9f7a52"/></svg>');
const scene = { id: "preview", name: "\u0420\u044b\u043d\u043e\u0447\u043d\u0430\u044f \u043f\u043b\u043e\u0449\u0430\u0434\u044c", tiles: new Map() };
const token = { id: "guard", name: "\u0421\u0442\u0440\u0430\u0436\u043d\u0438\u043a", texture: { src: portrait } };
scene.tokens = new Map([[token.id, token]]);
const episode = definition.episodes[0]; episode.tokens.guard = defaultTokenBehavior();
episode.subscriptions = [{ id: "notice", enabled: true, event: "bell.rang", kind: "chat", text: "\u0417\u0432\u043e\u043d\u043e\u043a \u043d\u0430\u0434 \u0434\u0432\u0435\u0440\u044c\u044e \u0437\u0432\u0435\u043d\u0438\u0442.", audience: { gms: true, interactor: true, nearby: true, range: 30, visibleOnly: true } }];
episode.interactions = [{ id: "bell", name: "\u041f\u043e\u0437\u0432\u043e\u043d\u0438\u0442\u044c", enabled: true, target: { type: "Token", id: "guard" }, range: 5, eventName: "bell.rang" }];
const context = { definition, runtime, scene, episode, tokens: [token], isGM: true, selectedEpisodeId: "calm" };
const controller = { getContext: () => context };
const editor = new EditorApplication(controller), tokenEditor = new TokenEditorApplication(controller, token.id, { episodeId: "calm" });
const render = (name, data) => handlebars.compile(fs.readFileSync(path.join(moduleRoot, "templates", name + ".hbs"), "utf8"))(data);
const views = { constructor: render("editor", await editor._prepareContext({})), token: render("token-editor", await tokenEditor._prepareContext({})),
  dialogue: render("dialogue", { title: "\u0421\u0442\u0430\u0440\u0430\u044f \u0434\u0432\u0435\u0440\u044c", targetName: token.name, text: "\u0417\u0430 \u0434\u0432\u0435\u0440\u044c\u044e \u0441\u043b\u044b\u0448\u043d\u044b \u0433\u043e\u043b\u043e\u0441\u0430. \u0427\u0442\u043e \u0432\u044b \u0434\u0435\u043b\u0430\u0435\u0442\u0435?", art: portrait, responses: [{ id: "knock", label: "\u041f\u043e\u0441\u0442\u0443\u0447\u0430\u0442\u044c" }, { id: "listen", label: "\u041f\u0440\u0438\u0441\u043b\u0443\u0448\u0430\u0442\u044c\u0441\u044f" }] }) };
const genericStyle = fs.readFileSync(path.resolve(repo, "..", "dmicher-generics", "dmicher-generics/styles/dmicher-generics.css"), "utf8");
Object.assign(runtime, { episodeId: "calm", runId: "preview-run", episode: structuredClone(episode), halted: true });
views.director = render("editor", await new EditorApplication(controller, { mode: "director" })._prepareContext({}));
views.shop = render("shop", { npcName: token.name, npcImg: portrait, actorName: "Hero", ownerName: "Player", needsApproval: true,
  groups: [{ name: "Equipment", items: [{ id: "torch", name: "Torch", img: portrait, stock: 3 }, { id: "potion", name: "Potion", img: portrait, stock: 2 }] }],
  offeredGive: [{ id: "dagger", name: "Dagger", img: portrait }], offeredTake: [{ id: "torch", name: "Torch", img: portrait, count: 1 }], inventory: [] });
const style = fs.readFileSync(path.join(moduleRoot, "styles/master-screen.css"), "utf8");
const output = path.resolve(repo, "..", "artifacts/dmicher-master-screen/0.0.1/ui-preview"); fs.mkdirSync(output, { recursive: true });
for (const [name, html] of Object.entries(views)) fs.writeFileSync(path.join(output, name + ".html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Master screen UI review</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#141922;font:15px Arial,sans-serif;color:#e6e2d8}nav{display:flex;gap:16px;margin-bottom:16px}a{color:#b1cff7}.application{width:920px;max-width:100%;height:760px;margin:0 auto;border:1px solid #546274;border-radius:9px;overflow:hidden}.window-header{height:38px;padding:10px 16px;background:#202734}.window-content{height:calc(100% - 38px)}input,select,textarea,button{font:inherit;color:inherit;background:#242d39;border:1px solid #566473;border-radius:4px;padding:5px}input[type=checkbox]{width:16px;height:16px}button{cursor:pointer}h2{font-weight:600}
${genericStyle}\n${style}</style><nav>${Object.keys(views).map((entry) => `<a href="/${entry}.html">${entry}</a>`).join("")}</nav><main class="application dmicher-window dmicher-master-screen" data-dmicher-theme="dark"><header class="window-header">\u25a5 Master screen - UI review</header><div class="window-content">${html}</div></main></html>`);
console.log(output);
if (process.argv.includes("--serve")) http.createServer((request, response) => {
  const name = request.url?.split("?")[0]?.replace(/^\//, "") || "constructor.html";
  if (!Object.keys(views).some((view) => name === view + ".html")) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(fs.readFileSync(path.join(output, name)));
}).listen(18763, "127.0.0.1", () => console.log("UI preview: http://127.0.0.1:18763/constructor.html"));
