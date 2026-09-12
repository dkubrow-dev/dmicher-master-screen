import test from "node:test";
import assert from "node:assert/strict";
import { createObjectDecorations } from "../dmicher-master-screen/scripts/apps/object-decorations.js";

test("canvas decorations reuse labels, obey hidden visibility and release each owner independently", () => {
  const created = [];
  globalThis.PIXI = { Text: class {
    constructor(text, style) {
      Object.assign(this, { text, style, anchor: { set() {} }, position: { set() {} } }); created.push(this);
    }
    destroy() { assert.equal(this.destroyed, undefined); this.destroyed = true; }
  } };
  globalThis.game = { user: { isGM: false } }; globalThis.canvas = { stage: {} };
  const document = { documentName: "Wall", c: [0, 0, 100, 100], hidden: true,
    object: { addChild(label) { label.parent = this; }, toLocal: point => point } };
  const first = createObjectDecorations(), second = createObjectDecorations();
  first.update(document, { emoji: "!", bubble: { text: "Hello", fontSize: 20 } });
  second.update(document, { emoji: "?" });
  assert.equal(created.length, 3); assert.ok(created.every(label => label.visible === false));
  game.user.isGM = true;
  first.update(document, { emoji: "!", bubble: { text: "Updated", fontSize: 22 } });
  assert.equal(created.length, 3); assert.equal(created[1].text, "Updated");
  assert.equal(created[1].style.fontSize, 22); assert.equal(created[0].visible, true);
  document.object = { addChild(label) { label.parent = this; }, toLocal: point => point };
  first.update(document, { emoji: "!", bubble: { text: "Updated", fontSize: 22 } });
  assert.equal(created.length, 3); assert.equal(created[0].parent, document.object);
  first.remove(document); first.clear();
  assert.equal(created[0].destroyed, true); assert.equal(created[1].destroyed, true);
  assert.equal(created[2].destroyed, undefined);
  second.clear(); second.clear(); assert.equal(created[2].destroyed, true);
});
