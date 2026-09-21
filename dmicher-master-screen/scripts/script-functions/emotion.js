import { text } from "../localization.js";
import { number, effectExecutionMode, seconds, DEFAULT_EMOTION_SIZE } from "./parameters.js";
import { normalizeGroupSymbol } from "../model.js";

export default Object.freeze({
  id: "emotion", label: {"ru":"Эмоция","en":"Emotion"},
  category: {"ru":"объекты.общение","en":"objects.communication"},
  description: { ru: "Показывает выбранный символ над объектом параллельно следующему шагу или до окончания длительности.", en: "Shows a selected symbol above the object, alongside the next step or until its duration ends." },
  scopes: ["object"], premium: false,
  template: {"emoji":"","executionMode":"parallel","duration":0,"size":32},
  normalize(p) {
    return { emoji: p.emoji === undefined || p.emoji === "" ? "" : normalizeGroupSymbol(p.emoji), executionMode: effectExecutionMode(p.executionMode, "parallel"), duration: seconds(p.duration),
      size: number(p.size === undefined ? DEFAULT_EMOTION_SIZE : p.size, text("Размер эмоции", "Emotion size"), 0, true) };
  }
});
