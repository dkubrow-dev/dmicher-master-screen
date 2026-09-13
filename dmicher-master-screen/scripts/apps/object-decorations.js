import { sceneObjectBounds, isSceneObjectHidden } from "../scene-object-geometry.js";
import { DEFAULT_EMOTION_SIZE } from "../script-model.js";

/** Canvas presentation adapter. No rules, Scene writes or script execution. */
export function createObjectDecorations() {
  const emojiLabels = new Map(), speechLabels = new Map();
  function removeLabel(labels, document) {
    const label = labels.get(document);
    // Foundry can destroy a placeable and its children before this owner refreshes.
    if (label && !label.destroyed) label.destroy();
    labels.delete(document);
  }
  function updateLabel(labels, document, object, text, style) {
    let label = labels.get(document);
    if (!text || !object?.addChild || object.destroyed) {
      removeLabel(labels, document); return null;
    }
    if (!globalThis.PIXI?.Text) return null;
    if (!label || label.destroyed) {
      label = new PIXI.Text(String(text), style);
      label.anchor.set(0.5, 1); label.eventMode = "none";
      labels.set(document, label);
    }
    if (label.parent !== object) object.addChild(label);
    if (label.text !== String(text)) label.text = String(text);
    if (label.style.fontSize !== style.fontSize) label.style.fontSize = style.fontSize;
    label.visible = !isSceneObjectHidden(document) || globalThis.game?.user?.isGM === true;
    return label;
  }
  return Object.freeze({
    update(document, { emoji = "", emojiSize = DEFAULT_EMOTION_SIZE, emojiOffset = 4, bubble = null }) {
      const object = document?.object ?? document;
      const bounds = sceneObjectBounds(document, document?.parent), stage = globalThis.canvas?.stage;
      // Wall and Region containers use scene coordinates, unlike a token's local origin.
      const anchor = bounds && stage && !object?.destroyed && object?.toLocal?.({ x: bounds.x + bounds.width / 2, y: bounds.y }, stage);
      const x = anchor?.x ?? Number(object?.w ?? 100) / 2, y = anchor?.y ?? 0;
      const emotion = updateLabel(emojiLabels, document, object, emoji, { fontSize: emojiSize, fill: 0xffffff, dropShadow: true, dropShadowDistance: 2 });
      const speech = updateLabel(speechLabels, document, object, bubble?.text, { fontSize: Number(bubble?.fontSize || 24), fill: 0xffffff,
        stroke: 0x111111, strokeThickness: 4, wordWrap: true, wordWrapWidth: 400, align: "center" });
      let emotionY = y - emojiOffset;
      if (speech) {
        const speechY = y - 42;
        speech.position.set(x, speechY);
        // PIXI measures the current text and style here, including wrapping,
        // stroke and its bottom anchor. No retained height survives a removed bubble.
        if (emotion) emotionY = Math.min(emotionY, speechY + speech.getLocalBounds().y - 4);
      }
      emotion?.position.set(x, emotionY);
    },
    remove(document) {
      for (const labels of [emojiLabels, speechLabels]) removeLabel(labels, document);
    },
    clear() {
      for (const labels of [emojiLabels, speechLabels]) {
        for (const document of labels.keys()) removeLabel(labels, document);
      }
    }
  });
}
