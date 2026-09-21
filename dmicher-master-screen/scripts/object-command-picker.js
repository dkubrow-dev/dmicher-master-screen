import { text as t } from "./localization.js";

const needsPoint = new Set(["go", "patrol"]);

/** Returns only player-selected coordinates, never GM preparation.
 * The promise's cancel method integrates with the existing map picker lifecycle. */
export function pickCommandParameters(commandId, { scene, actor, object, board = globalThis.canvas, document = globalThis.document, hooks = globalThis.Hooks } = {}) {
  if (!needsPoint.has(commandId)) return Object.assign(Promise.resolve({}), { cancel() {} });
  let cancel = () => {};
  const promise = new Promise(resolve => {
    const stage = board?.stage;
    if (!stage || board.scene?.id !== scene?.id || !actor || !object) { resolve(null); return; }
    let done = false, finishing = false;
    const points = [], sceneId = scene.id, listeners = [];
    const view = board.app?.renderer?.events?.domElement ?? board.app?.view;
    // Foundry interprets defaultPrevented on a PIXI pointerup as a request to
    // continue dragging. Stop propagation without setting that workflow flag.
    const stop = event => { event.stopImmediatePropagation?.(); event.stopPropagation?.(); };
    const current = () => globalThis.canvas?.scene?.id === sceneId && board.scene?.id === sceneId;
    const finish = result => {
      if (done) return;
      done = true;
      for (const [name, callback] of listeners) stage.off(name, callback);
      document?.removeEventListener("pointerdown", down, { capture: true });
      document?.removeEventListener("keydown", key, { capture: true });
      if (tearDown != null) hooks?.off("canvasTearDown", tearDown);
      resolve(result);
    };
    const prompt = () => globalThis.ui?.notifications?.info(commandId === "patrol" ? points.length ? t("Укажите вторую точку патруля. Escape — отмена.", "Choose the second patrol point. Escape cancels.")
        : t("Укажите первую точку патруля. Escape — отмена.", "Choose the first patrol point. Escape cancels.")
        : t("Укажите точку для команды. Escape — отмена.", "Choose the command's destination. Escape cancels."));
    const key = event => { if (event.key === "Escape") { event.preventDefault?.(); stop(event); finish(null); } };
    // PIXI 7 still calls a sole at-target listener after its capture listener
    // stops propagation. Empty canvas clicks therefore reach Foundry's drag
    // manager unless intercepted in the DOM, before PIXI receives the press.
    // Keep PIXI release/tap capture for hit testing and any prior press target.
    const down = event => {
      if (event.button > 0 || !view || event.target !== view && !view.contains?.(event.target)) return;
      event.preventDefault?.(); stop(event);
      if (!current()) finish(null);
    };
    const consume = event => { if (event.button > 0) return; stop(event); if (!current()) finish(null); };
    const choose = event => {
      if (event.button > 0 || done) return;
      stop(event);
      if (!current()) return finish(null);
      if (finishing) return;
      const point = event.getLocalPosition(stage);
      if (![point.x, point.y].every(Number.isFinite)) return;
      points.push({ x: Math.round(point.x), y: Math.round(point.y) });
      if (commandId === "patrol" && points.length < 2) { prompt(); return; }
      const result = commandId === "patrol" ? { points } : { point: points[0] };
      // PIXI may emit pointertap in the same pointerup dispatch. Keep capture
      // installed until that dispatch completes so it cannot reopen a menu.
      finishing = true; queueMicrotask(() => finish(current() ? result : null));
    };
    const tearDown = hooks?.on("canvasTearDown", () => finish(null));
    listeners.push(["pointerdowncapture", consume], ["pointerupcapture", choose], ["pointertapcapture", consume]);
    for (const [name, callback] of listeners) stage.on(name, callback);
    document?.addEventListener("pointerdown", down, { capture: true });
    document?.addEventListener("keydown", key, { capture: true });
    cancel = () => finish(null); prompt();
  });
  return Object.assign(promise, { cancel: () => cancel() });
}
