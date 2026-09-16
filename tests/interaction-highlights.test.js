import test from "node:test";
import assert from "node:assert/strict";
import { createInteractiveHighlights, visibleInteractiveDocument } from "../dmicher-master-screen/scripts/interaction-highlights.js";
import { defaultInteractionSettings } from "../dmicher-master-screen/scripts/interaction-settings-model.js";

class Position { set(x, y) { this.x = x; this.y = y; } }
class Container {
  constructor() { this.children = []; this.position = new Position(); this.pivot = new Position(); this.visible = true; }
  addChild(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  destroy() { this.destroyed = true; for (const child of this.children) child.destroy?.(); this.parent && (this.parent.children = this.parent.children.filter(child => child !== this)); }
}
class Graphics extends Container {
  clear() { this.drawn = []; return this; } lineStyle() { return this; } beginFill() { return this; } endFill() { return this; }
  drawRect(...value) { this.drawn = value; return this; } drawRoundedRect(...value) { return this.drawRect(...value); }
  drawCircle(...value) { return this.drawRect(...value); } moveTo(...value) { return this.drawRect(...value); } lineTo(...value) { return this.drawRect(...value); }
}
class Label extends Container { constructor(text, style) { super(); this.text = text; this.style = style; this.width = 20; this.height = 20; this.anchor = new Position(); } }
function fixture({ gm = false, masked = true } = {}) {
  const old = { game: globalThis.game, canvas: globalThis.canvas, PIXI: globalThis.PIXI, foundry: globalThis.foundry, Hooks: globalThis.Hooks, window: globalThis.window };
  const scene = { id: "scene", grid: { size: 100 } }, object = new Container(); object.position.set(10, 20);
  const doc = { id: "npc", documentName: "Token", x: 10, y: 20, width: 1, height: 1, parent: scene, object };
  let vision = true, access = true, eligibilityReads = 0, visionReads = 0;
  const hooks = new Map(), keys = new Map();
  globalThis.game = { user: { isGM: gm }, settings: { get: () => ({}) } };
  globalThis.canvas = { scene, interface: new Container(), masks: { vision: { renderTexture: {} } }, visibility: { testVisibility() { visionReads++; return vision; } } };
  globalThis.PIXI = { Container, Graphics, Text: Label };
  globalThis.foundry = { canvas: { rendering: { filters: masked ? { VisionMaskFilter: { create: () => ({ destroy() { this.destroyed = true; } }) } } : {} } } };
  globalThis.Hooks = { on(name, callback) { hooks.set(name, callback); return name; }, off: name => hooks.delete(name) };
  globalThis.window = { addEventListener: (name, callback) => keys.set(name, callback), removeEventListener: name => keys.delete(name) };
  const settings = defaultInteractionSettings(); settings.highlight.activation = "always"; settings.icons.enabled = true;
  const controller = createInteractiveHighlights({ getInteractiveDocuments() { eligibilityReads++; return [doc]; }, readWorld: () => settings, readPlayer: () => ({}), hasAccess: () => access });
  return { old, scene, doc, hooks, keys, settings, controller, get root() { return canvas.interface.children[0]; },
    get eligibilityReads() { return eligibilityReads; }, get visionReads() { return visionReads; },
    vision: value => { vision = value; }, access: value => { access = value; }, dispose() { controller.dispose(); Object.assign(globalThis, old); } };
}

test("prepared highlights refresh moving geometry without re-reading eligibility or visibility per frame", () => {
  const f = fixture();
  try {
    f.controller.install(); assert.equal(f.eligibilityReads, 1); const reads = f.visionReads;
    assert.equal(f.root.filters.length, 1, "player contours and icons share native fog/vision clipping");
    const entry = f.root.children[0]; assert.equal(entry.visible, true);
    for (let n = 0; n < 300; n++) { f.doc.object.position.set(n, 20); f.hooks.get("refreshToken")({ document: f.doc }); }
    assert.equal(f.eligibilityReads, 1); assert.equal(f.visionReads, reads);
    assert.equal(entry.children[0].position.x, 349); assert.equal(f.hooks.has("updateScene"), false, "runtime clock writes have no presentation preparation listener");
    f.vision(false); f.controller.refreshVisibility(); assert.equal(entry.visible, false);
    f.vision(true); f.controller.refreshVisibility(); assert.equal(entry.visible, true);
    f.access(false); f.controller.sync(f.scene); assert.equal(f.root, undefined, "revocation removes already prepared visuals");
  } finally { f.dispose(); }
  assert.equal(f.hooks.size, 0); assert.equal(f.keys.size, 0);
});

test("visibility rejects hidden, invisible, secret and out-of-sight objects independently of menu eligibility", () => {
  const f = fixture();
  try {
    assert.equal(visibleInteractiveDocument(f.doc), true);
    f.doc.hidden = true; assert.equal(visibleInteractiveDocument(f.doc), false); f.doc.hidden = false;
    f.doc.object.isVisible = false; assert.equal(visibleInteractiveDocument(f.doc), false); f.doc.object.isVisible = true;
    f.doc.door = 2; assert.equal(visibleInteractiveDocument(f.doc), false); delete f.doc.door;
    f.vision(false); assert.equal(visibleInteractiveDocument(f.doc), false);
  } finally { f.dispose(); }
});

test("players get no unmasked fallback if native visibility support is unavailable", () => {
  const f = fixture({ masked: false });
  try { f.controller.install(); assert.equal(f.root, undefined); assert.equal(f.eligibilityReads, 0); }
  finally { f.dispose(); }
});

test("AltLeft holds outlines, blur releases them, and typing never starts highlighting", () => {
  const f = fixture({ gm: true });
  f.settings.icons.enabled = false; f.settings.highlight.activation = "keys";
  try {
    f.controller.install(); const entry = f.root.children[0]; assert.equal(entry.visible, false);
    const event = (code, typing = false) => ({ code, preventDefault() {}, target: { closest: () => typing } });
    f.keys.get("keydown")(event("AltLeft", true)); assert.equal(entry.visible, false);
    f.keys.get("keydown")(event("AltLeft")); assert.equal(entry.visible, true);
    f.keys.get("blur")(); assert.equal(entry.visible, false);
    f.keys.get("keydown")(event("AltRight")); assert.equal(entry.visible, false);
    f.keys.get("keyup")(event("AltRight")); f.keys.get("keydown")(event("AltLeft")); assert.equal(entry.visible, true);
    f.keys.get("keyup")(event("AltLeft")); assert.equal(entry.visible, false);
  } finally { f.dispose(); }
});
