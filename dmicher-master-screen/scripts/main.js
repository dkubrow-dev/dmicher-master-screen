import { MODULE_ID, VERSION } from "./model.js";
import { ScreenController } from "./controller.js";
import { installControls } from "./controls.js";
import { getRuntime, isAuthority } from "./store.js";
import { generics } from "./generics.js";
import { theme, notifyError } from "./ui.js";
import { installScreenSettingHelp } from "./setting-help.js";

let controller, removeControls, unregister, removeSettingHelp;
const hooks = [];
let stage, tap;
const on = (name, callback) => hooks.push([name, Hooks.on(name, callback)]);

function attachCanvas() {
  if (stage && tap) stage.off("pointertap", tap);
  controller.cancelPick?.();
  stage = globalThis.canvas?.stage;
  if (!stage) return;
  tap = (event) => {
    if (controller.cancelPick || event.button > 0 || event.shiftKey || event.ctrlKey || event.altKey) return;
    const point = event.getLocalPosition(stage);
    const token = [...(canvas.tokens?.placeables ?? [])].reverse().find((entry) => entry.isVisible !== false
      && point.x >= entry.x && point.y >= entry.y && point.x <= entry.x + entry.w && point.y <= entry.y + entry.h);
    if (controller.mode === "constructor" && game.user.isGM) { if (token) controller.openToken(token.id); return; }
    if (game.user.isGM && !["director", "actor"].includes(controller.mode)) return;
    const hasInteraction = (type, id) => {
      const options = controller.getInteractions(type, id);
      return options.behavior?.shop.enabled || options.behavior?.interaction.targetEpisodeId || options.dialogues.length || options.actions.length;
    };
    if (token && hasInteraction("Token", token.id)) { void controller.interact(token.id).catch(notifyError); return; }
    const tile = [...(canvas.tiles?.placeables ?? [])].reverse().find((entry) => entry.visible !== false && entry.document?.hidden !== true
      && hasInteraction("Tile", entry.id) && (entry.bounds?.contains?.(point.x, point.y)
        ?? (point.x >= entry.x && point.y >= entry.y && point.x <= entry.x + entry.document.width && point.y <= entry.y + entry.document.height)));
    if (tile) void controller.interact(tile.id, undefined, { targetType: "Tile" }).catch(notifyError);
  };
  stage.on("pointertap", tap);
  controller.changed(canvas.scene);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "theme", { name: "Тема ширмы", scope: "client", config: false, type: String,
    choices: { dark: "Тёмная", light: "Светлая" }, default: "dark", onChange: () => theme.apply() });
  try {
    const saved = game.settings.storage.get("client").getItem(`${MODULE_ID}.theme`);
    if (saved !== null && saved !== undefined) generics.appearance.adoptLegacyTheme(JSON.parse(saved), 20);
  } catch (_error) { /* Invalid legacy storage does not replace the common appearance. */ }
  theme.install();
  controller = new ScreenController();
  removeSettingHelp = installScreenSettingHelp((pageId, anchor) => controller.openHelp().navigate(pageId, anchor));
  removeControls = installControls(controller);
  const api = Object.freeze({ apiVersion: 1, version: VERSION,
    openConstructor: () => controller.setMode("constructor"), openDirector: () => controller.setMode("director"),
    openActor: () => controller.setMode("actor"), openShops: () => controller.openShops(),
    openDialogues: () => controller.openDialogues(),
    openHelp: (pageId, anchor) => { const app = controller.openHelp(); if (pageId) void app.navigate(pageId, anchor); return app; }, close: () => controller.closeScreen(),
    transition: (episodeId) => controller.transition(episodeId),
    emitEvent: (name, details) => controller.emitEvent(name, details),
    resetTriggers: (triggerKey) => controller.resetTriggers(triggerKey),
    setTriggerEnabled: (triggerKey, enabled) => controller.setTriggerEnabled(triggerKey, enabled),
    haltScene: () => controller.haltScene(), haltScheme: () => controller.haltScheme(),
    resumeScheme: (episodeId) => controller.resumeScheme(episodeId),
    getState: () => controller.getContext(), setAutomation: (tokenId, enabled) => controller.setAutomation(tokenId, enabled) });
  game.modules.get(MODULE_ID).api = api;
  unregister = generics.modules.register(MODULE_ID, { apiVersion: 1, api, capabilities: ["openConstructor", "openDirector", "openActor", "openShops", "openHelp"] });
});

Hooks.once("ready", () => {
  controller.runtime.start();
  on("canvasReady", attachCanvas);
  on("canvasTearDown", () => { controller.cancelPick?.(); if (stage && tap) stage.off("pointertap", tap); });
  on("createChatMessage", (message, _options, userId) => {
    void Promise.resolve().then(() => controller.dialogues.processManualInvitation(message, userId)).catch(notifyError);
    void controller.shop.processTradeRequest(message, userId).catch(notifyError);
    void controller.dialogues.processCommand(message, userId).catch(notifyError);
    const command = message.getFlag?.(MODULE_ID, "interaction");
    if (!command || !isAuthority() || command.schemeId !== "main" || command.sceneId !== canvas.scene?.id
      || command.runId !== getRuntime(canvas.scene).runId || generics.chat.getMessageAuthorId(message) !== userId
      || !message.whisper.includes(game.user.id)) return;
    void controller.runtime.interact(canvas.scene, command.tokenId, { sourceTokenId: command.sourceTokenId, user: game.users.get(userId) }).catch(notifyError);
  });
  on(generics.chat.getChatMessageRenderHook(), (message, html) => controller.shop.renderChatMessage?.(message, html));
  attachCanvas();
});

globalThis.addEventListener?.("pagehide", () => {
  controller?.runtime.dispose(); controller?.events.dispose(); controller?.dialogues.dispose?.(); controller?.cancelPick?.();
  if (stage && tap) stage.off("pointertap", tap);
  for (const [name, id] of hooks) Hooks.off(name, id);
  removeControls?.(); removeSettingHelp?.(); unregister?.(); theme.dispose();
}, { once: true });
