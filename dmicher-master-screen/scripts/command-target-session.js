import { findCanvasObject } from "./apps/canvas-object.js";
import { createCommandLinkGraphics } from "./apps/command-link-graphics.js";
import { getSceneObject } from "./scene-objects.js";
import { visibleInteractiveDocument } from "./interaction-highlights.js";
import { objectCommandName } from "./object-command-model.js";
import { SCENE_OBJECT_TYPES } from "./scene-object-types.js";
import { text as t } from "./localization.js";

/** DOM capture precedes PIXI/native door and drag handlers. Only the selection
 * result crosses the existing command request boundary; this never writes data. */
export function pickCommandTarget({ scene, actor, executor, menu, commands, header,
  board = globalThis.canvas, document = globalThis.document, hooks = globalThis.Hooks,
  visible = doc => visibleInteractiveDocument(doc, board) } = {}) {
  let cancel = () => {};
  const promise = new Promise(resolve => {
    const stage = board?.stage, view = board?.app?.renderer?.events?.domElement ?? board?.app?.view ?? board?.app?.canvas;
    if (!stage || !view || !actor || !executor || board.scene?.id !== scene?.id) { resolve(null); return; }
    let done = false, pressed = null, endpoint = null, cursor = null;
    const listeners = [], registeredHooks = [], sceneId = scene.id;
    const graphic = createCommandLinkGraphics(board, globalThis.game?.user?.color);
    const current = () => board.scene?.id === sceneId && globalThis.canvas?.scene?.id === sceneId;
    const stop = event => { event.stopImmediatePropagation?.(); event.stopPropagation?.(); };
    const isCanvas = event => event.target === view || view.contains?.(event.target);
    const draw = () => graphic.draw(endpoint ? [actor, executor, endpoint] : [actor, executor], endpoint ? null : cursor,
      current() && [actor, executor, endpoint].filter(Boolean).every(visible));
    const finish = result => {
      if (done) return; done = true;
      for (const [name, fn] of listeners) document.removeEventListener(name, fn, { capture: true });
      for (const [name, id] of registeredHooks) hooks?.off(name, id);
      graphic.destroy(); if (endpoint) menu.close(); resolve(result);
    };
    const pointEvent = event => {
      const point = { x: event.clientX, y: event.clientY };
      const mapper = board.app?.renderer?.events;
      if (mapper?.mapPositionToPoint) mapper.mapPositionToPoint(point, event.clientX, event.clientY);
      else { const rect = view.getBoundingClientRect?.(); if (rect) { point.x -= rect.left; point.y -= rect.top; } }
      return { global: point, getLocalPosition: () => stage.toLocal?.(point) ?? point };
    };
    const down = event => {
      if (event.button > 0 || !isCanvas(event) || endpoint) return;
      event.preventDefault?.(); stop(event);
      if (!current()) return finish(null);
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const up = event => {
      if (event.button > 0 || endpoint || !pressed || event.pointerId !== pressed.id) return;
      const start = pressed; pressed = null;
      // Do not preventDefault: Foundry uses that flag to continue its drag.
      stop(event); if (!current()) return finish(null);
      if (!isCanvas(event) || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const choiceSets = new Map();
      const target = findCanvasObject(board, pointEvent(event), { accepts: descriptor => {
        const doc = getSceneObject(scene, descriptor);
        if (!doc || doc === actor || doc === executor || !visible(doc)) return false;
        const key = `${descriptor.type}:${descriptor.id}`;
        if (!choiceSets.has(key)) choiceSets.set(key, commands(descriptor).filter(command => command.id !== "delegate"));
        return choiceSets.get(key).length > 0;
      } });
      if (!target) return;
      endpoint = getSceneObject(scene, target); draw();
      const choices = choiceSets.get(`${target.type}:${target.id}`);
      const items = choices.map(command => ({ label: objectCommandName(command.id, target.type),
        action: () => finish(current() && visible(endpoint) ? { target, commandId: command.id, delegateTokenId: executor.id } : null) }));
      if (!menu.open(items, { x: event.clientX, y: event.clientY, header: header?.(target), onClose: reason => { if (reason !== "select") finish(null); } })) finish(null);
    };
    const move = event => { if (!endpoint && isCanvas(event)) { cursor = pointEvent(event).getLocalPosition(); draw(); } };
    const key = event => { if (event.key === "Escape") { event.preventDefault?.(); stop(event); finish(null); } };
    const on = (name, fn) => { if (hooks?.on) registeredHooks.push([name, hooks.on(name, fn)]); };
    for (const [name, fn] of [["pointerdown", down], ["pointerup", up], ["pointermove", move], ["keydown", key], ["pointercancel", () => { pressed = null; }]]) {
      document.addEventListener(name, fn, { capture: true }); listeners.push([name, fn]);
    }
    on("canvasTearDown", () => finish(null));
    for (const type of SCENE_OBJECT_TYPES) {
      on(`delete${type}`, doc => { if ([actor, executor, endpoint].includes(doc)) finish(null); });
      on(`refresh${type}`, object => { if ([actor, executor, endpoint].includes(object.document ?? object)) draw(); });
    }
    on("sightRefresh", draw);
    cancel = () => finish(null); draw();
    globalThis.ui?.notifications?.info?.(t("Укажите объект поручения на карте. Escape — отмена.", "Choose the task target on the map. Escape cancels."));
  });
  return Object.assign(promise, { cancel: () => cancel() });
}
