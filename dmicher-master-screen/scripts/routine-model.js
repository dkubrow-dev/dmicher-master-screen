import { normalizeSchemeSymbol } from "./model.js";

const fail = (message) => { throw new Error(message); };
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value, max, label) => typeof value === "string" && value.length <= max ? value : fail(`${label}: ожидается текст до ${max} символов.`);
const finite = (value, label, positive = false) => typeof value === "number" && Number.isFinite(value) && (!positive || value > 0) ? value : fail(`${label}: требуется ${positive ? "положительное " : ""}конечное число.`);
const boolean = (value, fallback, label) => value === undefined ? fallback : typeof value === "boolean" ? value : fail(`${label}: требуется логическое значение.`);
const identifier = (value, label) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : fail(`${label}: неверный ID.`);
const objectParameters = (value = {}) => {
  if (!record(value) || JSON.stringify(value).length > 8000) fail("Параметры шага должны быть JSON объектом до 8000 символов.");
  const visit = (entry, depth = 0) => {
    if (depth > 20) fail("Параметры шага слишком глубоко вложены.");
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number" && Number.isFinite(entry)) return;
    if (Array.isArray(entry)) { entry.forEach((item) => visit(item, depth + 1)); return; }
    if (record(entry) && Object.getPrototypeOf(entry) === Object.prototype) { Object.values(entry).forEach((item) => visit(item, depth + 1)); return; }
    fail("Параметры шага могут содержать только значения JSON.");
  };
  visit(value); return structuredClone(value);
};

/** New editor rows are drafts. Required event/macro references are selected before save. */
export function routineStepTemplate(kind) {
  const templates = {
    wait: { seconds: 1 }, move: { x: 0, y: 0, speed: 5 },
    speech: { text: "", chat: true, bubble: true }, emotion: { emoji: "" },
    event: { eventName: "", triggerId: "", parameters: {} }, macro: { macroUuid: "", parameters: {} }
  };
  if (!Object.hasOwn(templates, kind)) fail("Неизвестный вид шага распорядка.");
  return { kind, parameters: structuredClone(templates[kind]), next: [] };
}
export const ROUTINE_STEP_KINDS = Object.freeze(["wait", "move", "speech", "emotion", "event", "macro"]);

export function normalizeRoutineStep(raw) {
  if (!record(raw) || !ROUTINE_STEP_KINDS.includes(raw.kind) || !Number.isSafeInteger(raw.id) || raw.id < 1) fail("Шаг требует положительный целый ID и известный вид действия.");
  const p = raw.parameters ?? {}; if (!record(p)) fail("Параметры шага должны быть объектом.");
  const allowed = Object.keys(routineStepTemplate(raw.kind).parameters);
  if (Object.keys(p).some((key) => !allowed.includes(key))) fail("В параметрах шага есть неизвестное поле.");
  if (!Array.isArray(raw.next ?? []) || raw.next?.some((id) => !Number.isSafeInteger(id) || id < 1)) fail("Следующие шаги задаются списком положительных целых ID.");
  let parameters;
  switch (raw.kind) {
    case "wait": parameters = { seconds: finite(p.seconds, "Время ожидания", true) }; break;
    case "move": parameters = { x: finite(p.x, "Координата X"), y: finite(p.y, "Координата Y"), speed: finite(p.speed, "Скорость", true) }; break;
    case "speech":
      parameters = { text: text(p.text ?? "", 12000, "Реплика"), chat: boolean(p.chat, true, "Вывод в чат"), bubble: boolean(p.bubble, true, "Облачко речи") };
      if (!parameters.chat && !parameters.bubble) fail("Для реплики включите чат или облачко речи.");
      break;
    case "emotion": {
      const emoji = p.emoji === undefined ? "" : p.emoji;
      if (typeof emoji !== "string") fail("Эмоция должна быть символом или пустой строкой.");
      parameters = { emoji: emoji === "" ? "" : normalizeSchemeSymbol(emoji) }; break;
    }
    case "event": parameters = { eventName: text(p.eventName, 100, "Событие").trim(), triggerId: identifier(p.triggerId, "Тип триггера"), parameters: objectParameters(p.parameters) };
      if (!parameters.eventName) fail("Выберите событие шага."); break;
    case "macro": parameters = { macroUuid: text(p.macroUuid, 256, "Макрос"), parameters: objectParameters(p.parameters) };
      if (!parameters.macroUuid) fail("Выберите макрос шага."); break;
  }
  return { id: raw.id, kind: raw.kind, parameters, next: [...new Set(raw.next ?? [])] };
}

/** Row order is presentation only. Stable IDs and graph edges survive reordering;
 * deleting a row removes its incoming edges instead of redirecting them. */
export function normalizeRoutine(raw) {
  if (!record(raw) || !Array.isArray(raw.steps) || raw.steps.length > 200) fail("Распорядок должен содержать список до 200 шагов.");
  const steps = raw.steps.map(normalizeRoutineStep), ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) fail("ID шагов распорядка не должны повторяться.");
  if (steps.length && !ids.has(1)) fail("Непустой распорядок должен содержать начальный шаг ID 1.");
  return { ...(raw.id === undefined ? {} : { id: identifier(raw.id, "Распорядок") }), episodeId: identifier(raw.episodeId, "Эпизод распорядка"),
    repeat: boolean(raw.repeat, false, "Повтор распорядка"), steps: steps.map((step) => ({ ...step, next: step.next.filter((id) => ids.has(id)) })) };
}
export function normalizeRoutines(value = []) {
  if (!Array.isArray(value) || value.length > 100) fail("Допустимо до 100 распорядков объекта.");
  const routines = value.map(normalizeRoutine);
  if (new Set(routines.map((routine) => routine.episodeId)).size !== routines.length) fail("В одном эпизоде у объекта может быть только один распорядок.");
  return routines;
}
