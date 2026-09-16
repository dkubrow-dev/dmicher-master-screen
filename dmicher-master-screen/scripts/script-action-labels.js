import { text } from "./localization.js";
import { SCRIPT_STEP_KINDS, isPremiumScriptStep } from "./script-model.js";

const labels = Object.freeze({
  wait: ["Ожидание", "Wait"], move: ["Перемещение", "Move"], approach: ["Приблизиться", "Approach"], visibility: ["Видимость", "Visibility"], focus: ["Фокус", "Focus"],
  speech: ["Реплика", "Speech"], emotion: ["Эмоция", "Emotion"], sound: ["Звук", "Sound"],
  signal: ["Сигнал", "Signal"], macro: ["Макрос", "Macro"], state: ["Состояние", "State"],
  dialogue: ["Диалог", "Dialogue"], follow: ["Следовать", "Follow"], shop: ["Магазин", "Shop"], command: ["Команда", "Command"],
  playlist: ["Плейлист", "Playlist"], windows: ["Окна", "Windows"], notes: ["Заметки", "Notes"]
});

/** The editor and combat prompts must use the same names for script actions. */
export const scriptActionLabel = (kind, language) => Object.hasOwn(labels, kind) ? text(...labels[kind], language) : String(kind);
export const scriptActionOptions = (language) => SCRIPT_STEP_KINDS.map((kind) => [kind, scriptActionLabel(kind, language) + (isPremiumScriptStep(kind) ? " · Premium" : "")]);
