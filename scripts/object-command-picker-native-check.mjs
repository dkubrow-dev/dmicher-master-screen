import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { pickCommandParameters } from "../dmicher-master-screen/scripts/object-command-picker.js";

// Exercise the installed PIXI dispatcher and Foundry mouse state machine as-is.
// Synthetic containers replace only rendering and world data; no server is used.
function nativeClass(source, name) {
  const start = source.indexOf(`class ${name} `), end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, `Missing native ${name}`);
  return source.slice(start, end + 2);
}

class TrackedDocument extends EventTarget {
  listeners = new Map();
  addEventListener(name, callback, options) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback); super.addEventListener(name, callback, options);
  }
  removeEventListener(name, callback, options) {
    this.listeners.get(name)?.delete(callback); super.removeEventListener(name, callback, options);
  }
}

const between = Object.getOwnPropertyDescriptor(Number.prototype, "between");
Object.defineProperty(Number.prototype, "between", { configurable: true, value(min, max) { return this >= min && this <= max; } });
try {
  for (const version of ["13.351", "14.366"]) {
    const root = `E:/Foundry Portable/Foundry VTT ${version}/App/resources/app`;
    const require = createRequire(pathToFileURL(`${root}/package.json`));
    const PIXI = { ...require("@pixi/math"), ...require("@pixi/display"), ...require("@pixi/events") };
    globalThis.PIXI = PIXI;
    globalThis.CONFIG = { debug: { mouseInteraction: false } };
    const source = (await fs.readFile(`${root}/public/scripts/foundry.mjs`, "utf8")).replaceAll("\r\n", "\n");
    const MouseInteractionManager = new Function("throttle", `${nativeClass(source, "MouseInteractionManager")}\nreturn MouseInteractionManager;`)(callback => callback);

    function fixture() {
      const stage = new PIXI.Container(), child = new PIXI.Container();
      stage.eventMode = child.eventMode = "static";
      stage.addChild(child);
      const boundary = new PIXI.EventBoundary(stage), view = new EventTarget();
      view.id = "board";
      const document = new TrackedDocument(), hooks = new Map(), calls = { select: 0, drag: 0, door: 0, child: 0 };
      const scene = { id: "scene", walls: new Map() };
      const board = globalThis.canvas = { stage, scene, currentMouseManager: null,
        app: { view, ticker: { elapsedMS: 0 }, renderer: { events: { rootBoundary: boundary, supportsPointerEvents: false } } } };
      globalThis.game = { user: { isGM: false }, i18n: { lang: "en" } };
      globalThis.ui = { notifications: { info() {} } };
      const manager = board.mouseInteractionManager = new MouseInteractionManager(stage, stage, {}, {
        clickLeft() { calls.select++; }, dragLeftStart() { calls.drag++; }
      }).activate();
      let time = 1000;
      function dispatch(type, target = stage, point = { x: 20, y: 30 }, button = 0) {
        if (type === "pointerdown") {
          // Model document capture before the renderer's DOM listener. Native
          // PIXI still handles every event which reaches that listener.
          const domEvent = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(domEvent, { button: { value: button }, target: { value: view } });
          let reachedRenderer = false;
          const renderer = () => { reachedRenderer = true; };
          document.addEventListener(type, renderer);
          document.dispatchEvent(domEvent); document.removeEventListener(type, renderer);
          if (!reachedRenderer) return domEvent;
        }
        const event = new PIXI.FederatedPointerEvent(boundary);
        Object.assign(event, { type, target, button, buttons: type === "pointerdown" ? 1 : 0,
          pointerId: 1, pointerType: "mouse", timeStamp: time += 300 });
        event.global.set(point.x, point.y); event.client.set(point.x, point.y);
        boundary.trackingData(1).overTargets = [stage, ...(target === child ? [child] : [])];
        board.app.renderer.events.pointer = event;
        boundary.dispatchEvent(event);
        return event;
      }
      dispatch("pointerover");
      assert.equal(manager.state, manager.states.HOVER);
      const baseline = stage.eventNames().map(name => [name, stage.listenerCount(name)]).sort();
      const options = { scene, actor: {}, object: {}, board, document, hooks: {
        on(name, callback) { hooks.set(name, callback); return callback; }, off(name) { hooks.delete(name); }
      } };
      function click(target = stage, point) {
        dispatch("pointerdown", target, point);
        dispatch("pointerup", target, point);
        dispatch("pointertap", target, point);
      }
      function clean() {
        assert.ok(manager.state <= manager.states.HOVER, "native mouse remained pressed after release");
        assert.equal(board.currentMouseManager, null, "native mouse manager remains active");
        assert.deepEqual(stage.eventNames().map(name => [name, stage.listenerCount(name)]).sort(), baseline, "picker leaked stage listeners");
        assert.equal(hooks.size, 0, "picker leaked scene hook");
        assert.ok([...document.listeners.values()].every(listeners => listeners.size === 0), "picker leaked DOM listeners");
        assert.equal(calls.drag, 0, "released mouse started a selection drag");
        assert.equal(calls.select, 0, "destination click selected native scene objects");
      }
      function nativeDragWorks() {
        dispatch("pointerdown"); dispatch("pointermove", stage, { x: 150, y: 160 });
        assert.equal(calls.select, 1, "normal clicks were not restored after picker cleanup");
        assert.equal(calls.drag, 1, "normal drag was not restored after picker cleanup");
        dispatch("pointerup", stage, { x: 150, y: 160 });
        assert.equal(manager.state, manager.states.HOVER);
        assert.equal(board.currentMouseManager, null);
      }
      return { stage, child, manager, board, scene, document, hooks, calls, options, dispatch, click, clean, nativeDragWorks };
    }

    for (const targetName of ["stage", "child"]) {
      const f = fixture(), picking = pickCommandParameters("go", f.options);
      f.child.on("pointerdown", () => f.calls.child++);
      f.click(f[targetName]);
      assert.deepEqual(await picking, { point: { x: 20, y: 30 } });
      f.dispatch("pointermove", f.stage, { x: 150, y: 160 });
      f.clean(); assert.equal(f.calls.child, 0); f.nativeDragWorks();
    }

    {
      const f = fixture(), picking = pickCommandParameters("patrol", f.options);
      f.click(f.stage, { x: 20, y: 30 });
      f.dispatch("pointermove", f.stage, { x: 150, y: 160 });
      assert.equal(f.calls.drag, 0, "first patrol point started a drag");
      f.click(f.stage, { x: 150, y: 160 });
      assert.deepEqual(await picking, { points: [{ x: 20, y: 30 }, { x: 150, y: 160 }] });
      f.clean(); f.nativeDragWorks();
    }

    {
      const f = fixture(), wall = { documentName: "Wall", id: "door", parent: f.scene, door: 1, c: [20, 20, 20, 40] };
      f.scene.walls.set(wall.id, wall); f.child.wall = { document: wall };
      f.child.on("pointerdown", () => f.calls.door++);
      const picking = pickCommandParameters("go", f.options);
      f.click(f.child);
      assert.deepEqual(await picking, { point: { x: 20, y: 30 } });
      f.clean(); assert.equal(f.calls.door, 0, "picking a point over a door opened it natively"); f.nativeDragWorks();
    }

    for (const cancellation of ["escape", "teardown", "cancel"]) {
      const f = fixture(), picking = pickCommandParameters("go", f.options);
      if (cancellation === "escape") {
        const event = new Event("keydown"); Object.defineProperty(event, "key", { value: "Escape" }); f.document.dispatchEvent(event);
      } else if (cancellation === "teardown") f.hooks.get("canvasTearDown")();
      else picking.cancel();
      assert.equal(await picking, null); f.clean(); f.nativeDragWorks();
    }
    clearTimeout(MouseInteractionManager.longPressTimeout);
    console.log(`${version}: native stage/child clicks, released mouse, patrol, door and cancellation passed`);
  }
} finally {
  if (between) Object.defineProperty(Number.prototype, "between", between);
  else delete Number.prototype.between;
}
