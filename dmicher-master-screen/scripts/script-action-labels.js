import { text } from "./localization.js";

const labels = Object.freeze({
  wait: ["Ожидание", "Wait"], move: ["Перемещение", "Move"], visibility: ["Видимость", "Visibility"],
  speech: ["Реплика", "Speech"], emotion: ["Эмоция", "Emotion"], sound: ["Звук", "Sound"],
  signal: ["Сигнал", "Signal"], macro: ["Макрос", "Macro"]
});

/** The editor and combat prompts must use the same names for script actions. */
export const scriptActionLabel = (kind, language) => Object.hasOwn(labels, kind) ? text(...labels[kind], language) : String(kind);
export const scriptActionOptions = (language) => Object.keys(labels).map((kind) => [kind, scriptActionLabel(kind, language)]);
