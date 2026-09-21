import { commandDocument } from "../object-command-access.js";
import { effectiveInteractionSettings, highlightChordMatches } from "../interaction-settings-model.js";
import { getInteractionSettings, getPlayerInteractionSettings, subscribeInteractionSettings } from "../interaction-settings-store.js";
import { isInteractivePresentationAvailable, subscribeInteractivePresentationAccess } from "../premium-provider.js";
import { isTypingTarget } from "../interaction-keybinding.js";
import { visibleInteractiveDocument } from "../interaction-highlights.js";
import { SCENE_OBJECT_TYPES } from "../scene-object-types.js";
import { createCommandLinkGraphics } from "./command-link-graphics.js";

/** Runs become prepared document references on updates, never on cursor/frame
 * callbacks. Observers see only their own orders (or GM orders), with every
 * participant subject to the native visibility policy. */
export function createCommandLinks({ readWorld = getInteractionSettings, readPlayer = getPlayerInteractionSettings,
  hasAccess = isInteractivePresentationAvailable, visible = visibleInteractiveDocument, graphic = createCommandLinkGraphics } = {}) {
  let entries = [], settings, installed = false, view;
  const pressed = new Set(), hooks = [], unsubscribers = [];
  const active = () => settings?.highlight.enabled && highlightChordMatches(pressed, settings.highlight.keys);
  const draw = entry => entry.graphic.draw(entry.documents, null, active() && entry.visible);
  const refresh = document => { for (const entry of entries) if (!document || entry.documents.includes(document)) draw(entry); };
  const refreshVisibility = () => { for (const entry of entries) { entry.visible = entry.documents.every(doc => visible(doc)); draw(entry); } };
  const clear = () => { for (const entry of entries) entry.graphic.destroy(); entries = []; pressed.clear(); };
  function sync(scene = globalThis.canvas?.scene) {
    for (const entry of entries) entry.graphic.destroy(); entries = [];
    settings = effectiveInteractionSettings(readWorld(), readPlayer(), { premium:hasAccess() });
    if (!scene || scene.id !== globalThis.canvas?.scene?.id || !settings.highlight.enabled) return;
    const user = globalThis.game?.user;
    for (const run of Object.values(scene.getFlag?.("dmicher-master-screen", "objectCommandRuns") ?? {})) {
      const request = run?.request;
      if (!request || !user?.isGM && request.userId !== user?.id) continue;
      const actor = commandDocument(scene, request.actorTokenUuid);
      const executor = commandDocument(scene, request.delegateTokenUuid ?? request.targetUuid);
      const endpoint = commandDocument(scene, request.delegateTokenUuid ? request.targetUuid : run.config?.id === "delegate" ? request.parameters?.targetUuid : "");
      if (!actor || !executor || !endpoint) continue;
      const documents = [actor, executor, endpoint], issuer = globalThis.game?.users?.get(request.userId);
      entries.push({ documents, graphic:graphic(globalThis.canvas, issuer?.color ?? user?.color), visible:documents.every(doc => visible(doc)) });
    }
    refresh();
  }
  const keydown = event => { if (event.repeat || isTypingTarget(event.target)) return; pressed.add(event.code); refreshVisibility(); };
  const keyup = event => { pressed.delete(event.code); refresh(); };
  const blur = () => { pressed.clear(); refresh(); };
  function install() {
    if (installed) return; installed = true; view = globalThis.window ?? globalThis;
    view.addEventListener?.("keydown", keydown); view.addEventListener?.("keyup", keyup); view.addEventListener?.("blur", blur);
    const on = (name, fn) => hooks.push([name, Hooks.on(name, fn)]);
    on("canvasReady", () => sync()); on("canvasTearDown", clear); on("sightRefresh", refreshVisibility);
    on("updateUser", () => sync());
    on("updateScene", (scene, changes) => {
      if (scene.id !== globalThis.canvas?.scene?.id) return;
      if (changes?.flags?.["dmicher-master-screen"]?.objectCommandRuns !== undefined
        || Object.keys(changes ?? {}).some(key => key.startsWith("flags.dmicher-master-screen.objectCommandRuns"))) sync(scene);
    });
    for (const type of SCENE_OBJECT_TYPES) {
      on(`refresh${type}`, object => refresh(object.document ?? object));
      on(`update${type}`, () => refreshVisibility());
      on(`delete${type}`, document => {
        for (const entry of entries.filter(entry => entry.documents.includes(document))) entry.graphic.destroy();
        entries = entries.filter(entry => !entry.documents.includes(document));
      });
    }
    unsubscribers.push(subscribeInteractionSettings(() => sync()), subscribeInteractivePresentationAccess(() => sync())); sync();
  }
  function dispose() {
    clear(); for (const [name, id] of hooks) Hooks.off(name, id); hooks.length = 0;
    for (const unsubscribe of unsubscribers) unsubscribe?.(); unsubscribers.length = 0;
    view?.removeEventListener?.("keydown", keydown); view?.removeEventListener?.("keyup", keyup); view?.removeEventListener?.("blur", blur); installed = false;
  }
  return { install, sync, refresh, refreshVisibility, clear, dispose };
}
