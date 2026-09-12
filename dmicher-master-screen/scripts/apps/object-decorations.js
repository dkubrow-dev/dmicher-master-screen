import { sceneObjectBounds, isSceneObjectHidden } from "../scene-object-geometry.js";

/** Canvas presentation adapter. No rules, Scene writes or script execution. */
export function createObjectDecorations() {
  const emojiLabels = new Map(), speechLabels = new Map();
  function updateLabel(labels, document, text, style, offset) {
    const object = document?.object ?? document;
    let label = labels.get(document);
    if (!text || !object?.addChild) {
      label?.destroy?.(); labels.delete(document); return;
    }
    if (!globalThis.PIXI?.Text) return;
    if (!label || label.destroyed) {
      label = new PIXI.Text(String(text), style);
      label.anchor.set(0.5, 1); label.eventMode = "none";
      labels.set(document, label);
    }
    if (label.parent !== object) object.addChild(label);
    label.text = String(text); label.style.fontSize = style.fontSize;
    const bounds = sceneObjectBounds(document, document.parent), stage = globalThis.canvas?.stage;
    // Wall and Region containers use scene coordinates, unlike a token's local origin.
    const anchor = bounds && stage && object.toLocal?.({ x: bounds.x + bounds.width / 2, y: bounds.y }, stage);
    label.position.set(anchor?.x ?? Number(object.w ?? 100) / 2, (anchor?.y ?? 0) - offset);
    label.visible = !isSceneObjectHidden(document) || globalThis.game?.user?.isGM === true;
  }
  return Object.freeze({
    update(document, { emoji = "", bubble = null }) {
      updateLabel(emojiLabels, document, emoji, { fontSize: 32, fill: 0xffffff, dropShadow: true, dropShadowDistance: 2 }, 4);
      updateLabel(speechLabels, document, bubble?.text, { fontSize: Number(bubble?.fontSize || 24), fill: 0xffffff,
        stroke: 0x111111, strokeThickness: 4, wordWrap: true, wordWrapWidth: 400, align: "center" }, 42);
    },
    remove(document) {
      for (const labels of [emojiLabels, speechLabels]) { labels.get(document)?.destroy?.(); labels.delete(document); }
    },
    clear() {
      for (const labels of [emojiLabels, speechLabels]) {
        for (const label of labels.values()) label.destroy?.();
        labels.clear();
      }
    }
  });
}
