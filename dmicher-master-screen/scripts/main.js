import { MODULE_ID, VERSION } from "./model.js";
import { ScreenController } from "./controller.js";
import { installControls } from "./controls.js";
import { generics } from "./generics.js";
import { theme, notifyError } from "./ui.js";
import { installScreenSettingHelp } from "./setting-help.js";
import { updateSceneNavigationBadges } from "./apps/group-badges.js";
import { findCanvasObject, canvasPointerPosition, clearCanvasObjectFocus, listenCanvasObjectClicks } from "./apps/canvas-object.js";
import { installSceneSignals } from "./scene-signals.js";
import { registerTemplateLocalization } from "./apps/template-localization.js";
import { registerDebugSetting } from "./debug.js";
import { registerDialogueVolume, DialogueVolumeController } from "./dialogue-volume.js";
import { syncDialogueRollMode } from "./dialogue-visibility.js";

let controller, removeControls, unregister, removeSettingHelp, removeSceneSignals, removeDialogueVolume;
const hooks = [];
let detachCanvas;
const on = (name, callback) => hooks.push([name, Hooks.on(name, callback)]);

function attachCanvas() {
  detachCanvas?.();
  controller.cancelPick?.();
  if (!globalThis.canvas?.stage) return;
  const handleTap = (event) => {
    if (controller.cancelPick || event.button > 0 || event.shiftKey || event.ctrlKey || event.altKey) return;
    const constructorMode = controller.mode === "constructor" && game.user.isGM;
    if (game.user.isGM && !constructorMode && controller.mode !== "director") return;
    const target = findCanvasObject(canvas, event, { constructorMode });
    if (target) { try { controller.openObjectMenu(target, canvasPointerPosition(canvas, event)); } catch (error) { notifyError(error); } }
    else controller.objectMenu.close();
  };
  detachCanvas = listenCanvasObjectClicks(canvas, handleTap);
  controller.changed(canvas.scene);
}

Hooks.once("init", () => {
  registerTemplateLocalization(globalThis.Handlebars);
  registerDebugSetting({ onChange: () => controller?.editor?.syncDebugControl?.() });
  registerDialogueVolume();
  theme.install();
  controller = new ScreenController();
  removeSettingHelp = installScreenSettingHelp((pageId, anchor) => controller.openHelp().navigate(pageId, anchor));
  removeControls = installControls(controller);
  const api = Object.freeze({ apiVersion: 1, version: VERSION,
    openPanel: () => controller.openScreen("panel"), openWindow: () => controller.openScreen("window"),
    openConstructor: () => controller.setMode("constructor"), openDirector: () => controller.setMode("director"),
    openShops: () => controller.openShops(),
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
  unregister = generics.modules.register(MODULE_ID, { apiVersion: 1, api, capabilities: ["openConstructor", "openDirector", "openShops", "openHelp"] });
});

Hooks.once("ready", () => {
  void syncDialogueRollMode().catch(notifyError);
  on("clientSettingChanged", key => { if (key === "core.rollMode") void syncDialogueRollMode().catch(notifyError); });
  removeDialogueVolume = new DialogueVolumeController().install();
  controller.runtime.start();
  removeSceneSignals = installSceneSignals(controller.signals, { onError: notifyError });
  on("canvasReady", attachCanvas);
  on("renderSceneNavigation", () => updateSceneNavigationBadges(controller));
  on("updateScene", () => updateSceneNavigationBadges(controller));
  on("refreshToken", (token) => controller.dialogueMarkers.refresh(token.document ?? token));
  on("updateToken", (token) => { if (token.parent?.id === globalThis.canvas?.scene?.id) controller.dialogueMarkers.sync(token.parent); });
  on("deleteToken", (token) => { if (token.parent?.id === globalThis.canvas?.scene?.id) controller.dialogueMarkers.sync(token.parent); });
  on("updateUser", () => controller.dialogueMarkers.sync(globalThis.canvas?.scene));
  on("canvasTearDown", () => { controller.cancelPick?.(); controller.objectMenu.close(); controller.constructorIndicator.dispose(); controller.dialogueMarkers.clear(); clearCanvasObjectFocus(globalThis.canvas); detachCanvas?.(); });
  on("createChatMessage", (message, _options, userId) => {
    controller.dialogueChat.created(message);
    void controller.dialogueChat.processPublication(message, userId).catch(notifyError);
    void Promise.resolve().then(() => controller.dialogues.processManualInvitation(message, userId)).catch(notifyError);
    void Promise.resolve().then(() => controller.dialogues.processScriptInvitation(message, userId)).catch(notifyError);
    void controller.shop.processTradeRequest(message, userId).catch(notifyError);
    void controller.dialogues.processCommand(message, userId).catch(notifyError);
  });
  on(generics.chat.getChatMessageRenderHook(), (message, html) => {
    controller.shop.renderChatMessage?.(message, html);
    controller.dialogueChat.render(message, html);
  });
  for (const message of game.messages?.values?.() ?? []) controller.dialogueChat.observe(message);
  attachCanvas();
});

globalThis.addEventListener?.("pagehide", () => {
  controller?.editor?.layout?.dispose();
  controller?.objectMenu.close(); controller?.constructorIndicator.dispose();
  controller?.dialogueMarkers.clear();
  clearCanvasObjectFocus(globalThis.canvas);
  controller?.runtime.dispose(); controller?.signals.dispose(); controller?.dialogues.dispose?.(); controller?.cancelPick?.();
  controller?.dialogueChat.dispose();
  detachCanvas?.();
  for (const [name, id] of hooks) Hooks.off(name, id);
  removeControls?.(); removeSettingHelp?.(); removeSceneSignals?.(); removeDialogueVolume?.(); unregister?.(); theme.dispose();
}, { once: true });
