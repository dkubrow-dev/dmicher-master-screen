import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, getEventListeners } from "node:events";
import { pickCommandParameters, findCommandDoor } from "../dmicher-master-screen/scripts/object-command-picker.js";
import { createObjectCommandBadges } from "../dmicher-master-screen/scripts/object-command-badges.js";

function pickerFixture() {
  const stage = new EventEmitter(); stage.scale = { x: 1 };
  const view = {}, scene = { id: "one", walls: new Map() }, board = { stage, scene, app: { view } }, document = new EventTarget(), callbacks = new Map();
  const hooks = { on(name, callback) { callbacks.set(name, callback); return callback; }, off(name) { callbacks.delete(name); } };
  globalThis.canvas = board; globalThis.game = { user: { isGM: false }, i18n: { lang: "en" } };
  globalThis.ui = { notifications: { info() {} } };
  const options = { scene, actor: {}, object: {}, board, document, hooks };
  const event = (point, target = null) => ({ button: 0, target, stopped: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, getLocalPosition: () => point });
  const press = (target = view, button = 0) => {
    const event = new Event("pointerdown", { cancelable: true });
    Object.defineProperties(event, { target: { value: target }, button: { value: button } });
    document.dispatchEvent(event); return event;
  };
  return { ...options, options, event, press, callbacks };
}

test("command destination selection consumes native pointer events and clears every listener", async () => {
  const f = pickerFixture(), picking = pickCommandParameters("go", f.options), down = f.event({ x: 10.5, y: 20.1 });
  f.board.stage.emit("pointerdowncapture", down); assert.equal(down.stopped, true);
  const up = f.event({ x: 10.5, y: 20.1 }); f.board.stage.emit("pointerupcapture", up);
  assert.equal(up.defaultPrevented, false, "release must not ask Foundry to continue a drag workflow");
  const tap = f.event({ x: 10.5, y: 20.1 }); f.board.stage.emit("pointertapcapture", tap); assert.equal(tap.stopped, true);
  assert.deepEqual(await picking, { point: { x: 11, y: 20 } });
  assert.equal(f.board.stage.eventNames().length, 0); assert.equal(f.callbacks.size, 0);
  assert.equal(getEventListeners(f.document, "pointerdown").length, 0);
});

test("command picking consumes only left canvas presses before PIXI and releases DOM capture on every exit", async () => {
  for (const exit of ["choose", "cancel", "escape", "teardown"]) {
    const f = pickerFixture(), picking = pickCommandParameters("go", f.options);
    assert.equal(getEventListeners(f.document, "pointerdown").length, 1);
    assert.equal(f.press().defaultPrevented, true, "canvas press is intercepted before the native drag manager");
    assert.equal(f.press({}, 0).defaultPrevented, false, "other UI remains usable");
    assert.equal(f.press(f.board.app.view, 2).defaultPrevented, false, "right-button panning remains native");
    if (exit === "choose") f.board.stage.emit("pointerupcapture", f.event({ x: 10, y: 20 }));
    else if (exit === "cancel") picking.cancel();
    else if (exit === "teardown") f.callbacks.get("canvasTearDown")();
    else {
      const event = new Event("keydown"); Object.defineProperty(event, "key", { value: "Escape" }); f.document.dispatchEvent(event);
    }
    await picking;
    assert.equal(getEventListeners(f.document, "pointerdown").length, 0);
    assert.equal(getEventListeners(f.document, "keydown").length, 0);
    assert.equal(f.press().defaultPrevented, false, "ordinary presses work immediately after selection ends");
    assert.equal(f.board.stage.eventNames().length, 0);
  }
});

test("patrol asks for two points and Escape or scene teardown cancels without keeping handlers", async () => {
  const f = pickerFixture(), picking = pickCommandParameters("patrol", f.options);
  f.board.stage.emit("pointerupcapture", f.event({ x: 10, y: 20 }));
  f.board.stage.emit("pointerupcapture", f.event({ x: 30, y: 40 }));
  assert.deepEqual(await picking, { points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] });
  const cancelled = pickCommandParameters("go", f.options), escape = new Event("keydown"); Object.defineProperty(escape, "key", { value: "Escape" });
  f.document.dispatchEvent(escape); assert.equal(await cancelled, null);
  const teardown = pickCommandParameters("go", f.options); f.callbacks.get("canvasTearDown")(); assert.equal(await teardown, null);
  assert.equal(f.board.stage.eventNames().length, 0); assert.equal(f.callbacks.size, 0);
});

test("selecting a door blocks its native open handler and returns only its UUID", async () => {
  const f = pickerFixture(); let opens = 0;
  const wall = { documentName: "Wall", id: "door", parent: f.scene, door: 1, c: [0, 0, 100, 0], update() { opens++; } };
  f.scene.walls.set(wall.id, wall);
  const picking = pickCommandParameters("open-door", f.options), target = { wall: { document: wall } }, down = f.event({ x: 50, y: 0 }, target);
  f.board.stage.emit("pointerdowncapture", down); if (!down.stopped) wall.update();
  f.board.stage.emit("pointerupcapture", f.event({ x: 50, y: 0 }, target));
  assert.deepEqual(await picking, { doorUuid: "Scene.one.Wall.door" }); assert.equal(opens, 0);
  wall.door = 2; assert.equal(findCommandDoor(f.scene, f.event({ x: 50, y: 0 }, target), f.board), null);
});

test("command badge animation uses prepared text and releases removed or destroyed presentations", () => {
  const counters = { draws: 0, reads: 0 };
  class Container {
    constructor() { this.children = []; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; }
    addChild(...children) { for (const child of children) { child.parent = this; this.children.push(child); } return children[0]; }
    destroy() { this.destroyed = true; for (const child of this.children) child.destroy?.(); }
  }
  class Text extends Container {
    constructor(text, style) { super(); this.text = text; this.style = style; this.anchor = { set() {} }; }
    getLocalBounds() { return { x: -40, y: 0, width: 80, height: 36 }; }
  }
  class Graphics extends Container {
    clear() { return this; } beginFill() { return this; } lineStyle() { return this; } endFill() { return this; }
    drawRoundedRect() { counters.draws++; return this; }
  }
  globalThis.PIXI = { Container, Text, Graphics };
  globalThis.game = { user: { isGM: false }, i18n: { lang: "en" } };
  const object = new Container(); object.w = 100; object.h = 100;
  const token = { id: "npc", documentName: "Token", object };
  let runs = { "Token:npc": { command: true, target: { type: "Token", id: "npc" }, request: { actorName: "Hero" }, config: { id: "come" }, phase: "core" } };
  const scene = { id: "one", tokens: new Map([[token.id, token]]), getFlag() { counters.reads++; return runs; } }; token.parent = scene;
  globalThis.canvas = { scene };
  const badges = createObjectCommandBadges(); badges.sync(scene);
  const badge = object.children[0]; assert.match(badge.children[1].text, /Hero\nCome here/);
  assert.equal(badge.y, 124); assert.equal(counters.draws, 1);
  for (let frame = 0; frame < 1000; frame++) badges.refresh(token);
  assert.equal(counters.reads, 1); assert.equal(counters.draws, 1);
  runs["Token:npc"].phase = "waiting"; badges.sync(scene); assert.match(badge.children[1].text, /Waiting for script/);
  assert.equal(counters.draws, 2);
  runs["Token:npc"].phase = "before"; runs["Token:npc"].pendingReplacement = { config: { id: "wait" }, request: { actorName: "Another hero" } };
  badges.sync(scene); assert.equal(badge.children[1].text, "Hero\nCome here ⚙\nNext: Wait here"); assert.equal(counters.draws, 3);
  const beforePendingFrames = { ...counters };
  for (let frame = 0; frame < 1000; frame++) badges.refresh(token);
  assert.deepEqual(counters, beforePendingFrames);
  game.i18n.lang = "ru"; badges.sync(scene); assert.equal(badge.children[1].text, "Hero\nПодойди ⚙\nЗатем: Жди здесь"); assert.equal(counters.draws, 4);
  delete runs["Token:npc"].pendingReplacement; badges.sync(scene); assert.equal(badge.children[1].text, "Hero\nПодойди ⚙"); assert.equal(counters.draws, 5);
  badge.destroy(); badges.refresh(token); assert.equal(counters.draws, 6);
  runs = {}; badges.sync(scene); assert.equal(object.children.at(-1).destroyed, true);
  badges.clear();
});
