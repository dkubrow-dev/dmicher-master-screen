import { MODULE_ID, VERSION } from "./model.js";
import { ScreenController } from "./controller.js";
import { installControls } from "./controls.js";
import { generics } from "./generics.js";
import { theme, notifyError } from "./ui.js";
import { installScreenSettingHelp } from "./setting-help.js";
import { updateSceneNavigationBadges } from "./apps/group-badges.js";
import { findCanvasObject, canvasPointerPosition } from "./apps/canvas-object.js";
import { installSceneSignals } from "./scene-signals.js";

let controller, removeControls, unregister, removeSettingHelp, removeSceneSignals;
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
    const constructorMode = controller.mode === "constructor" && game.user.isGM;
    if (game.user.isGM && !constructorMode && !["director", "actor"].includes(controller.mode)) return;
    const target = findCanvasObject(canvas, event, { constructorMode });
    if (target) { try { controller.openObjectMenu(target, canvasPointerPosition(canvas, event)); } catch (error) { notifyError(error); } }
    else controller.objectMenu.close();
  };
  stage.on("pointertap", tap);
  controller.changed(canvas.scene);
}

Hooks.once("init", () => {
  theme.install();
  controller = new ScreenController();
  removeSettingHelp = installScreenSettingHelp((pageId, anchor) => controller.openHelp().navigate(pageId, anchor));
  removeControls = installControls(controller);
  const api = Object.freeze({ apiVersion: 1, version: VERSION,
    openPanel: () => controller.openScreen("panel"), openWindow: () => controller.openScreen("window"),
    openConstructor: () => controller.setMode("constructor"), openDirector: () => controller.setMode("director"),
    openActor: () => controller.setMode("actor"), openShops: () => controller.openShops(),
    openDialogues: () => controller.openDialogues(),
    openHelp: (pageId, anchor) => { const app = controller.openHelp(); if (pageId) void app.navigate(pageId, anchor); return app; }, close: () => controller.closeScreen(),
    transition: (stateId, options) => controller.transition(stateId, options),
    InvokeDmicherMasterScreenSignal: (emitterKey, name, parameters) => controller.emitSignal(emitterKey, name, parameters),
    resetConditions: (conditionKey) => controller.resetConditions(conditionKey),
    setConditionEnabled: (conditionKey, enabled) => controller.setConditionEnabled(conditionKey, enabled),
    haltScene: () => controller.haltScene(), haltGroup: (groupId) => controller.haltGroup(groupId),
    resumeGroup: (stateId, groupId) => controller.resumeGroup(stateId, groupId),
    getState: () => controller.getContext(), setAutomation: (tokenId, enabled) => controller.setAutomation(tokenId, enabled) });
  game.modules.get(MODULE_ID).api = api;
  globalThis.InvokeDmicherMasterScreenSignal = api.InvokeDmicherMasterScreenSignal;
  unregister = generics.modules.register(MODULE_ID, { apiVersion: 1, api, capabilities: ["openConstructor", "openDirector", "openActor", "openShops", "openHelp"] });
});

Hooks.once("ready", () => {
  controller.runtime.start();
  removeSceneSignals = installSceneSignals(controller.signals, { onError: notifyError });
  on("canvasReady", attachCanvas);
  on("renderSceneNavigation", () => updateSceneNavigationBadges(controller));
  on("updateScene", () => updateSceneNavigationBadges(controller));
  on("canvasTearDown", () => { controller.cancelPick?.(); controller.objectMenu.close(); controller.constructorIndicator.dispose(); if (stage && tap) stage.off("pointertap", tap); });
  on("createChatMessage", (message, _options, userId) => {
    void Promise.resolve().then(() => controller.dialogues.processManualInvitation(message, userId)).catch(notifyError);
    void controller.shop.processTradeRequest(message, userId).catch(notifyError);
    void controller.dialogues.processCommand(message, userId).catch(notifyError);
  });
  on(generics.chat.getChatMessageRenderHook(), (message, html) => controller.shop.renderChatMessage?.(message, html));
  attachCanvas();
});

globalThis.addEventListener?.("pagehide", () => {
  controller?.editor?.layout?.dispose();
  controller?.objectMenu.close(); controller?.constructorIndicator.dispose();
  controller?.runtime.dispose(); controller?.signals.dispose(); controller?.dialogues.dispose?.(); controller?.cancelPick?.();
  if (stage && tap) stage.off("pointertap", tap);
  for (const [name, id] of hooks) Hooks.off(name, id);
  removeControls?.(); removeSettingHelp?.(); removeSceneSignals?.(); unregister?.(); theme.dispose();
}, { once: true });
