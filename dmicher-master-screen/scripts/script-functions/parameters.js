import { message as localizedMessage, text } from "../localization.js";
export const fail = (message) => { throw new Error(message); };
export const record = (value) => value && typeof value === "object" && !Array.isArray(value);
export const requireText = (value, max, label) => typeof value === "string" && value.length <= max ? value : fail(localizedMessage("{0}: ожидается текст до {1} символов.", [label, max]));
export const number = (value, label, minimum = -Infinity, exclusive = false) => typeof value === "number" && Number.isFinite(value) && (exclusive ? value > minimum : value >= minimum) ? value : fail(localizedMessage("{0}: недопустимое число.", [label]));
export const bool = (value, fallback, label) => value === undefined ? fallback : typeof value === "boolean" ? value : fail(localizedMessage("{0}: требуется логическое значение.", [label]));
export const choice = (value, choices, fallback) => choices.includes(value ?? fallback) ? value ?? fallback : fail(localizedMessage("Ожидается один из вариантов: {0}.", [choices.join(", ")]));
export const effectExecutionMode = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!["parallel", "wait"].includes(value)) fail(text("Режим выполнения: выберите parallel или wait.", "Execution mode: choose parallel or wait."));
  return value;
};
export const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : fail(localizedMessage("Неверный ID скрипта или состояния."));
export const seconds = (value = 0) => number(value, localizedMessage("Длительность"), 0);
export const speed = (value) => number(value, localizedMessage("Скорость"), 0, true);
export const tags = (value = []) => Array.isArray(value) && value.length <= 100 ? [...new Set(value.map((tag) => requireText(tag, 100, localizedMessage("Тег")).trim()).filter(Boolean))] : fail(localizedMessage("Теги должны быть списком."));
export const only = (value, keys) => { if (!record(value) || Object.keys(value).some((key) => !keys.includes(key))) fail(localizedMessage("Неизвестное поле параметров шага.")); return value; };
export function json(value = {}) {
  if (!record(value) || JSON.stringify(value).length > 16000) fail(localizedMessage("Параметры сигнала должны быть JSON объектом до 16000 символов."));
  const visit = (entry, depth = 0) => {
    if (depth > 20) fail(localizedMessage("Параметры слишком глубоко вложены."));
    if (entry === null || typeof entry === "string" || typeof entry === "boolean" || typeof entry === "number" && Number.isFinite(entry)) return;
    if (Array.isArray(entry)) { entry.forEach((item) => visit(item, depth + 1)); return; }
    if (record(entry) && Object.getPrototypeOf(entry) === Object.prototype) { Object.values(entry).forEach((item) => visit(item, depth + 1)); return; }
    fail(localizedMessage("Параметры могут содержать только значения JSON."));
  };
  visit(value); return structuredClone(value);
}
export function movement(p) {
  const result = { timeMode: choice(p.timeMode, ["duration", "speed"], "duration"), duration: seconds(p.duration), position: null, rotation: null, size: null };
  if (p.position != null) { const v = only(p.position, ["x", "y", "speed"]); result.position = { x: number(v.x, "X"), y: number(v.y, "Y"), speed: speed(v.speed ?? 5) }; }
  if (p.rotation != null) { const v = only(p.rotation, ["mode", "angle", "speed"]); result.rotation = { mode: choice(v.mode, ["relative", "absolute"], "relative"), angle: number(v.angle ?? 0, localizedMessage("Угол")), speed: speed(v.speed ?? 90) }; }
  if (p.size != null) { const v = only(p.size, ["x", "y", "z", "speed"]); result.size = { x: v.x == null ? null : number(v.x, localizedMessage("Размер X"), 0, true), y: v.y == null ? null : number(v.y, localizedMessage("Размер Y"), 0, true), z: v.z == null ? null : number(v.z, localizedMessage("Размер Z"), 0), speed: speed(v.speed ?? 1) }; }
  return result;
}
/** Empty selections are a prepared no-op. A group can only have one destination. */
export function normalizeStateTransitions(value = []) {
  if (!Array.isArray(value) || value.length > 100) fail(text("Выберите до 100 переходов групп.", "Select up to 100 group transitions."));
  const groups = new Set();
  return value.map((entry) => {
    const pair = only(entry, ["groupId", "stateId"]);
    for (const field of ["groupId", "stateId"]) {
      if (typeof pair[field] !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(pair[field])) {
        fail(text("Для перехода нужны корректные ID группы и состояния.", "A transition requires valid group and state IDs."));
      }
    }
    if (groups.has(pair.groupId)) fail(text("Для каждой группы можно выбрать только одно состояние.", "Select only one state per group."));
    groups.add(pair.groupId); return { groupId: pair.groupId, stateId: pair.stateId };
  });
}

export const DEFAULT_EMOTION_SIZE = 32;
