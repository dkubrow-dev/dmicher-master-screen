import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { pickCommandTarget } from "../dmicher-master-screen/scripts/command-target-session.js";

function fixture() {
  const document = new EventTarget(), stage = new EventEmitter(), view = {}, callbacks = new Map();
  stage.toLocal = point => point;
  const scene = { id: "scene", grid: { size: 100 }, tokens: new Map(), lights: new Map() };
  const make = (id, type, x) => {
    const doc = { id, documentName: type, parent: scene, x, y: 0, width: 1, height: 1 };
    doc.object = { document: doc, x, y: 0, w: 100, h: 100 }; return doc;
  };
  const actor = make("actor", "Token", 0), executor = make("executor", "Token", 100), target = make("light", "AmbientLight", 200);
  for (const token of [actor, executor]) scene.tokens.set(token.id, token); scene.lights.set(target.id, target);
  const board = { scene, stage, tokens: { placeables: [actor.object, executor.object] }, lighting: { placeables: [target.object] }, app: { view } };
  globalThis.canvas = board; globalThis.game = { user: { id: "player" }, i18n: { lang: "en" } };
  const hooks = { on(name, fn) { callbacks.set(name, fn); return fn; }, off(name) { callbacks.delete(name); } };
  let menuState;
  const menu = { open(items, options) { menuState = { items, options }; return true; }, close(reason) { const previous = menuState; menuState = null; previous?.options.onClose?.(reason); } };
  const options = { scene, actor, executor, board, document, hooks, menu, visible: () => true,
    commands: descriptor => descriptor.type === "AmbientLight" ? [{ id: "light-on" }] : [] };
  const pointer = (type, target = view, x = 220) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { target: { value: target }, button: { value: 0 }, clientX: { value: x }, clientY: { value: 20 } });
    document.dispatchEvent(event); return event;
  };
  return { ...options, options, callbacks, pointer, menuState: () => menuState };
}
test("delegation captures the press before native drag, opens target commands and resolves only selected command", async () => {
  const f = fixture(), picking = pickCommandTarget(f.options);
  assert.equal(f.pointer("pointerdown").defaultPrevented, true);
  assert.equal(f.pointer("pointerup").defaultPrevented, false);
  const state = f.menuState(); assert.equal(state.items[0].label, "Light on");
  f.menu.close("select"); state.items[0].action();
  assert.deepEqual(await picking, { target: { type: "AmbientLight", id: "light" }, commandId: "light-on", delegateTokenId: "executor" });
  assert.equal(f.callbacks.size, 0);
  for (const name of ["pointerdown", "pointerup", "pointermove", "keydown"]) assert.equal(getEventListeners(f.document, name).length, 0);
});
test("Escape, scene teardown, deletion and menu close release capture without accepting a task", async () => {
  for (const reason of ["escape", "scene", "delete", "menu", "cancel"]) {
    const f = fixture(), picking = pickCommandTarget(f.options);
    if (reason === "escape") { const event = new Event("keydown"); Object.defineProperty(event, "key", { value: "Escape" }); f.document.dispatchEvent(event); }
    if (reason === "scene") f.callbacks.get("canvasTearDown")();
    if (reason === "delete") f.callbacks.get("deleteToken")(f.executor);
    if (reason === "menu") { f.pointer("pointerdown"); f.pointer("pointerup"); f.menu.close(); }
    if (reason === "cancel") picking.cancel();
    assert.equal(await picking, null, reason); assert.equal(f.callbacks.size, 0, reason);
    assert.equal(f.pointer("pointerdown").defaultPrevented, false, reason);
  }
});
test("selection requires a matching press and excludes invisible endpoints", async () => {
  const f = fixture(), picking = pickCommandTarget({ ...f.options, visible: doc => doc.documentName !== "AmbientLight" });
  f.pointer("pointerup"); assert.equal(f.menuState(), undefined);
  f.pointer("pointerdown"); f.pointer("pointerup"); assert.equal(f.menuState(), undefined);
  picking.cancel(); assert.equal(await picking, null);
});
