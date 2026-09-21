import { message as localizedMessage, text } from "./localization.js";
import { normalizeScriptInterruptions } from "./script-interruption-model.js";
import { normalizeScriptTransition } from "./script-transitions.js";

import { fail, record, requireText, number, bool, id, only } from "./script-functions/parameters.js";
import { builtinScriptFunctions, getScriptFunction } from "./script-functions/index.js";
export { normalizeStateTransitions, DEFAULT_EMOTION_SIZE } from "./script-functions/parameters.js";
export const SCRIPT_STEP_KINDS = Object.freeze(builtinScriptFunctions.map(row => row.id));
export const PREMIUM_SCRIPT_STEP_KINDS = Object.freeze(builtinScriptFunctions.filter(row => row.premium).map(row => row.id));
export const isPremiumScriptStep = kind => getScriptFunction(kind)?.premium === true;
/** Stable identity shared by execution progress and its read-only projections. */
export const scriptProgressKey = (target, script, slot = "routine") => `${target.type}:${target.id}:${slot}:${script.id ?? script.stateId ?? "script"}`;
export function scriptStepTemplate(kind) {
  const fn = getScriptFunction(kind);
  if (!fn) fail(localizedMessage("Неизвестный вид действия скрипта."));
  return { kind, parameters: structuredClone(fn.template), next: [], transition: { mode: "next", macro: "" } };
}
export function normalizeScriptStep(raw) {
  if (!record(raw) || !getScriptFunction(raw.kind) || !Number.isSafeInteger(raw.id) || raw.id < 1) fail(localizedMessage("Шаг требует положительный целый ID и известный вид действия."));
  const p = only(raw.parameters ?? {}, Object.keys(scriptStepTemplate(raw.kind).parameters));
  if (!Array.isArray(raw.next ?? []) || raw.next?.some((value) => !Number.isSafeInteger(value) || value < 1)) fail(localizedMessage("Переходы задаются списком положительных целых ID."));
  const parameters = getScriptFunction(raw.kind).normalize(p);
  return { id: raw.id, kind: raw.kind, parameters, next: [...new Set(raw.next ?? [])], transition: normalizeScriptTransition(raw.transition) };
}
export function normalizeScriptCombat(raw = {}) {
  only(raw, ["enabled", "confirm", "notifyWarning", "notifyChat", "endTurn", "turnSeconds"]);
  return { enabled: bool(raw.enabled, false, localizedMessage("Использовать в бою")), confirm: bool(raw.confirm, true, localizedMessage("Подтверждать действие")), notifyWarning: bool(raw.notifyWarning, true, localizedMessage("Предупреждение")), notifyChat: bool(raw.notifyChat, false, localizedMessage("Уведомление в чате")), endTurn: bool(raw.endTurn, false, localizedMessage("Завершать ход")), turnSeconds: number(raw.turnSeconds ?? 6, localizedMessage("Длительность хода"), 0, true) };
}
/** The array is presentation order; ID 1 remains the entry and graph edges stay stable. */
export function normalizeScript(raw) {
  if (!record(raw) || !Array.isArray(raw.steps) || raw.steps.length > 200) fail(localizedMessage("Скрипт должен содержать до 200 шагов."));
  const steps = raw.steps.map(normalizeScriptStep), ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) fail(localizedMessage("ID шагов не должны повторяться."));
  if (steps.length && !ids.has(1)) fail(localizedMessage("Непустой скрипт должен содержать начальный шаг ID 1."));
  return { ...(raw.id === undefined ? {} : { id: id(raw.id) }), ...(raw.stateId === undefined ? {} : { stateId: id(raw.stateId) }), name: requireText(raw.name ?? "", 200, localizedMessage("Название скрипта")), enabled: bool(raw.enabled, true, localizedMessage("Включить скрипт")), repeat: bool(raw.repeat, false, localizedMessage("Повторять")), combat: normalizeScriptCombat(raw.combat), interruptions: normalizeScriptInterruptions(raw.interruptions), steps: steps.map((step) => ({ ...step, next: step.next.filter((target) => ids.has(target)) })) };
}
export function normalizeScripts(raw = []) {
  if (!Array.isArray(raw) || raw.length > 100) fail(localizedMessage("Допустимо до 100 скриптов объекта."));
  const scripts = raw.map(normalizeScript);
  if (scripts.some((script) => !script.stateId)) fail(localizedMessage("Выберите состояние для скрипта."));
  if (new Set(scripts.map((script) => script.stateId)).size !== scripts.length) fail(localizedMessage("В одном состоянии допускается один скрипт данного назначения."));
  return scripts;
}
