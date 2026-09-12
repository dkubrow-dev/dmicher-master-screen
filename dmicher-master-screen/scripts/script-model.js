import { normalizeGroupSymbol } from "./model.js";

const fail = (message) => { throw new Error(message); };
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value, max, label) => typeof value === "string" && value.length <= max ? value : fail(`${label}: ожидается текст до ${max} символов.`);
const number = (value, label, minimum = -Infinity, exclusive = false) => typeof value === "number" && Number.isFinite(value) && (exclusive ? value > minimum : value >= minimum) ? value : fail(`${label}: недопустимое число.`);
const bool = (value, fallback, label) => value === undefined ? fallback : typeof value === "boolean" ? value : fail(`${label}: требуется логическое значение.`);
const choice = (value, choices, fallback) => choices.includes(value ?? fallback) ? value ?? fallback : fail(`Ожидается один из вариантов: ${choices.join(", ")}.`);
const id = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : fail("Неверный ID скрипта или состояния.");
const seconds = (value = 0) => number(value, "Длительность", 0);
const speed = (value) => number(value, "Скорость", 0, true);
const tags = (value = []) => Array.isArray(value) && value.length <= 100 ? [...new Set(value.map((tag) => text(tag, 100, "Тег").trim()).filter(Boolean))] : fail("Теги должны быть списком.");
const only = (value, keys) => { if (!record(value) || Object.keys(value).some((key) => !keys.includes(key))) fail("Неизвестное поле параметров шага."); return value; };
function json(value = {}) {
  if (!record(value) || JSON.stringify(value).length > 16000) fail("Параметры сигнала должны быть JSON объектом до 16000 символов.");
  const visit = (entry, depth = 0) => {
    if (depth > 20) fail("Параметры слишком глубоко вложены.");
    if (entry === null || typeof entry === "string" || typeof entry === "boolean" || typeof entry === "number" && Number.isFinite(entry)) return;
    if (Array.isArray(entry)) { entry.forEach((item) => visit(item, depth + 1)); return; }
    if (record(entry) && Object.getPrototypeOf(entry) === Object.prototype) { Object.values(entry).forEach((item) => visit(item, depth + 1)); return; }
    fail("Параметры могут содержать только значения JSON.");
  };
  visit(value); return structuredClone(value);
}
export const SCRIPT_STEP_KINDS = Object.freeze(["wait", "move", "visibility", "speech", "emotion", "sound", "signal", "macro"]);
export function scriptStepTemplate(kind) {
  const templates = {
    wait: { seconds: 1 }, move: { timeMode: "duration", duration: 0, position: null, rotation: null, size: null }, visibility: { visible: true },
    speech: { duration: 0, chat: { enabled: true, timing: "before", text: "", allowTags: [], denyTags: [], range: 0, deleteAfter: true }, bubble: { enabled: true, text: "", fontSize: 24 } },
    emotion: { emoji: "", duration: 0 }, sound: { src: "", volume: 1 }, signal: { signalId: "", parameters: {}, before: 0, after: 0 }, macro: { macroUuid: "", before: 0, after: 0 }
  };
  if (!Object.hasOwn(templates, kind)) fail("Неизвестный вид действия скрипта.");
  return { kind, parameters: structuredClone(templates[kind]), next: [] };
}
function movement(p) {
  const result = { timeMode: choice(p.timeMode, ["duration", "speed"], "duration"), duration: seconds(p.duration), position: null, rotation: null, size: null };
  if (p.position != null) { const v = only(p.position, ["x", "y", "speed"]); result.position = { x: number(v.x, "X"), y: number(v.y, "Y"), speed: speed(v.speed ?? 5) }; }
  if (p.rotation != null) { const v = only(p.rotation, ["mode", "angle", "speed"]); result.rotation = { mode: choice(v.mode, ["relative", "absolute"], "relative"), angle: number(v.angle ?? 0, "Угол"), speed: speed(v.speed ?? 90) }; }
  if (p.size != null) { const v = only(p.size, ["x", "y", "z", "speed"]); result.size = { x: v.x == null ? null : number(v.x, "Размер X", 0, true), y: v.y == null ? null : number(v.y, "Размер Y", 0, true), z: v.z == null ? null : number(v.z, "Размер Z", 0), speed: speed(v.speed ?? 1) }; }
  return result;
}
export function normalizeScriptStep(raw) {
  if (!record(raw) || !SCRIPT_STEP_KINDS.includes(raw.kind) || !Number.isSafeInteger(raw.id) || raw.id < 1) fail("Шаг требует положительный целый ID и известный вид действия.");
  const p = only(raw.parameters ?? {}, Object.keys(scriptStepTemplate(raw.kind).parameters));
  if (!Array.isArray(raw.next ?? []) || raw.next?.some((value) => !Number.isSafeInteger(value) || value < 1)) fail("Переходы задаются списком положительных целых ID.");
  let parameters;
  switch (raw.kind) {
    case "wait": parameters = { seconds: number(p.seconds, "Ожидание", 0, true) }; break;
    case "move": parameters = movement(p); break;
    case "visibility": parameters = { visible: bool(p.visible, true, "Видимость") }; break;
    case "speech": {
      const c = only(p.chat ?? {}, ["enabled", "timing", "text", "allowTags", "denyTags", "range", "deleteAfter"]), b = only(p.bubble ?? {}, ["enabled", "text", "fontSize"]);
      parameters = { duration: seconds(p.duration), chat: { enabled: bool(c.enabled, true, "Чат"), timing: choice(c.timing, ["before", "after"], "before"), text: text(c.text ?? "", 12000, "Текст чата"), allowTags: tags(c.allowTags), denyTags: tags(c.denyTags), range: number(c.range ?? 0, "Расстояние", 0), deleteAfter: bool(c.deleteAfter, true, "Удалять сообщение") }, bubble: { enabled: bool(b.enabled, true, "Пузырь"), text: text(b.text ?? "", 4000, "Текст пузыря"), fontSize: number(b.fontSize ?? 24, "Размер текста", 1) } };
      if (parameters.bubble.fontSize > 200) fail("Размер текста пузыря не больше 200.");
      if (!parameters.chat.enabled && !parameters.bubble.enabled) fail("Для реплики включите чат или пузырь."); break;
    }
    case "emotion": parameters = { emoji: p.emoji === undefined || p.emoji === "" ? "" : normalizeGroupSymbol(p.emoji), duration: seconds(p.duration) }; break;
    case "sound": parameters = { src: text(p.src, 2048, "Файл звука").trim(), volume: speed(p.volume ?? 1) }; if (!parameters.src) fail("Выберите файл звука."); break;
    case "signal": parameters = { signalId: text(p.signalId, 256, "Сигнал"), parameters: json(p.parameters), before: seconds(p.before), after: seconds(p.after) }; if (!parameters.signalId) fail("Выберите сигнал."); break;
    case "macro": parameters = { macroUuid: text(p.macroUuid, 256, "Макрос"), before: seconds(p.before), after: seconds(p.after) }; if (!parameters.macroUuid) fail("Выберите макрос."); break;
  }
  return { id: raw.id, kind: raw.kind, parameters, next: [...new Set(raw.next ?? [])] };
}
export function normalizeScriptCombat(raw = {}) {
  only(raw, ["enabled", "confirm", "notifyWarning", "notifyChat", "endTurn", "turnSeconds"]);
  return { enabled: bool(raw.enabled, false, "Использовать в бою"), confirm: bool(raw.confirm, true, "Подтверждать действие"), notifyWarning: bool(raw.notifyWarning, true, "Предупреждение"), notifyChat: bool(raw.notifyChat, false, "Уведомление в чате"), endTurn: bool(raw.endTurn, false, "Завершать ход"), turnSeconds: number(raw.turnSeconds ?? 6, "Длительность хода", 0, true) };
}
/** The array is presentation order; ID 1 remains the entry and graph edges stay stable. */
export function normalizeScript(raw) {
  if (!record(raw) || !Array.isArray(raw.steps) || raw.steps.length > 200) fail("Скрипт должен содержать до 200 шагов.");
  const steps = raw.steps.map(normalizeScriptStep), ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) fail("ID шагов не должны повторяться.");
  if (steps.length && !ids.has(1)) fail("Непустой скрипт должен содержать начальный шаг ID 1.");
  return { ...(raw.id === undefined ? {} : { id: id(raw.id) }), ...(raw.stateId === undefined ? {} : { stateId: id(raw.stateId) }), name: text(raw.name ?? "", 200, "Название скрипта"), enabled: bool(raw.enabled, true, "Включить скрипт"), repeat: bool(raw.repeat, false, "Повторять"), combat: normalizeScriptCombat(raw.combat), steps: steps.map((step) => ({ ...step, next: step.next.filter((target) => ids.has(target)) })) };
}
export function normalizeScripts(raw = []) {
  if (!Array.isArray(raw) || raw.length > 100) fail("Допустимо до 100 скриптов объекта.");
  const scripts = raw.map(normalizeScript);
  if (scripts.some((script) => !script.stateId)) fail("Выберите состояние для скрипта.");
  if (new Set(scripts.map((script) => script.stateId)).size !== scripts.length) fail("В одном состоянии допускается один скрипт данного назначения.");
  return scripts;
}
