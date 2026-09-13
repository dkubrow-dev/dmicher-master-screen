import test from "node:test";
import assert from "node:assert/strict";
import { createObjectDecorations } from "../dmicher-master-screen/scripts/apps/object-decorations.js";

test("canvas decorations reuse labels, obey hidden visibility and release each owner independently", () => {
  const created = [];
  globalThis.PIXI = { Text: class {
    constructor(text, style) {
      Object.assign(this, { text, style, anchor: { set() {} }, position: { set() {} } }); created.push(this);
    }
    getLocalBounds() { return { x: 0, y: -this.style.fontSize, width: 100, height: this.style.fontSize }; }
    destroy() { assert.equal(this.destroyed, undefined); this.destroyed = true; }
  } };
  globalThis.game = { user: { isGM: false } }; globalThis.canvas = { stage: {} };
  const document = { documentName: "Wall", c: [0, 0, 100, 100], hidden: true,
    object: { addChild(label) { label.parent = this; }, toLocal: point => point } };
  const first = createObjectDecorations(), second = createObjectDecorations();
  first.update(document, { emoji: "!", bubble: { text: "Hello", fontSize: 20 } });
  second.update(document, { emoji: "?" });
  assert.equal(created.length, 3); assert.ok(created.every(label => label.visible === false));
  assert.equal(created[0].style.fontSize, 32); assert.equal(created[2].style.fontSize, 32);
  game.user.isGM = true;
  first.update(document, { emoji: "!", emojiSize: 45.5, bubble: { text: "Updated", fontSize: 22 } });
  assert.equal(created.length, 3); assert.equal(created[1].text, "Updated");
  assert.equal(created[0].style.fontSize, 45.5); assert.equal(created[2].style.fontSize, 32);
  assert.equal(created[1].style.fontSize, 22); assert.equal(created[0].visible, true);
  document.object = { addChild(label) { label.parent = this; }, toLocal: point => point };
  first.update(document, { emoji: "!", bubble: { text: "Updated", fontSize: 22 } });
  assert.equal(created.length, 3); assert.equal(created[0].parent, document.object);
  assert.equal(created[0].style.fontSize, 32);
  first.remove(document); first.clear();
  assert.equal(created[0].destroyed, true); assert.equal(created[1].destroyed, true);
  assert.equal(created[2].destroyed, undefined);
  second.clear(); second.clear(); assert.equal(created[2].destroyed, true);
});

function canvasFixture() {
  const created = [];
  globalThis.PIXI = { Text: class {
    constructor(text, style) {
      this.text = text; this.style = style;
      this.anchor = { set: (x, y) => { this.anchor.x = x; this.anchor.y = y; } };
      this.position = { set: (x, y) => { this.position.x = x; this.position.y = y; } };
      created.push(this);
    }
    getLocalBounds() {
      // The renderer, not the decoration adapter, owns text metrics. This fake
      // changes its wrapped height immediately after text or font changes.
      const height = Math.ceil(this.text.length / 20) * this.style.fontSize + 8;
      return { x: -100, y: -this.anchor.y * height, width: 200, height };
    }
    destroy() { assert.ok(!this.destroyed); this.destroyed = true; }
  } };
  globalThis.game = { user: { isGM: true } }; globalThis.canvas = { stage: {} };
  const placeable = (originX = 0, originY = 0) => ({
    addChild(label) { label.parent = this; },
    toLocal(point, source) { assert.equal(source, canvas.stage); return { x: point.x - originX, y: point.y - originY }; }
  });
  return { created, placeable };
}

test("an emotion stays above measured speech and returns to its own offset when speech disappears", () => {
  const { created, placeable } = canvasFixture();
  const document = { documentName: "Token", x: 100, y: 200, width: 1, height: 1,
    parent: { grid: { size: 100 } }, object: placeable(100, 200) };
  const decorations = createObjectDecorations();
  decorations.update(document, { emoji: "!", emojiSize: 96.5, bubble: { text: "Hello", fontSize: 20 } });
  const [emotion, speech] = created;
  const separated = () => {
    const emotionBounds = emotion.getLocalBounds(), speechBounds = speech.getLocalBounds();
    assert.equal(emotion.position.x, 50);
    assert.equal(emotion.position.y + emotionBounds.y + emotionBounds.height,
      speech.position.y + speechBounds.y - 4);
  };
  separated();
  const initialY = emotion.position.y;
  decorations.update(document, { emoji: "?", emojiSize: 12.5,
    bubble: { text: "A longer speech wraps to several lines and changes its measured height.", fontSize: 32 } });
  assert.equal(created.length, 2); separated();
  assert.ok(emotion.position.y < initialY);
  document.object = placeable(50, 150);
  decorations.update(document, { emoji: "?", emojiSize: 12.5,
    bubble: { text: "A longer speech wraps to several lines and changes its measured height.", fontSize: 32 } });
  assert.equal(emotion.parent, document.object); assert.equal(speech.parent, document.object);
  assert.equal(emotion.position.x, 100);
  assert.equal(emotion.position.y, speech.position.y + speech.getLocalBounds().y - 4);
  decorations.update(document, { emoji: "?", emojiSize: 12.5 });
  assert.equal(speech.destroyed, true); assert.equal(emotion.position.y, 46);
  assert.equal(emotion.style.fontSize, 12.5);
  decorations.clear();
});

test("dialogue marker offsets and scene-coordinate objects remain independent of speech layout", () => {
  const { created, placeable } = canvasFixture();
  const document = { documentName: "Wall", c: [200, 350, 400, 550], object: placeable() };
  const scripted = createObjectDecorations(), marker = createObjectDecorations();
  scripted.update(document, { emoji: "!", bubble: { text: "Several words for a speech bubble", fontSize: 36 } });
  marker.update(document, { emoji: "?", emojiSize: 24, emojiOffset: 42 });
  const [emotion, speech, dialogue] = created;
  assert.equal(dialogue.position.x, 300); assert.equal(dialogue.position.y, 308);
  assert.ok(emotion.position.y < speech.position.y + speech.getLocalBounds().y);
  scripted.update(document, { emoji: "!" });
  assert.equal(emotion.position.y, 346); assert.equal(dialogue.position.y, 308);
  scripted.clear(); assert.ok(!dialogue.destroyed); marker.clear();
});

test("refresh and cleanup tolerate children already destroyed by the native canvas", () => {
  const { created, placeable } = canvasFixture();
  const document = { documentName: "Tile", x: 100, y: 200, width: 300, height: 400, object: placeable(100, 200) };
  const decorations = createObjectDecorations();
  decorations.update(document, { emoji: "!", bubble: { text: "Hello" } });
  created[0].destroy(); created[1].destroy();
  document.object = placeable(100, 200);
  decorations.update(document, { emoji: "?", bubble: { text: "Again" } });
  assert.equal(created.length, 4); assert.equal(created[2].parent, document.object);
  created[2].destroy(); created[3].destroy(); document.object.destroyed = true;
  decorations.update(document, { emoji: "?", bubble: { text: "Again" } });
  decorations.remove(document); decorations.clear();
  assert.equal(created.length, 4);
});
