import { text } from "./localization.js";

export const SCRIPT_INTERRUPTION_MODES = Object.freeze(["stop", "restart-step", "next-step", "restart-script"]);
export const SCRIPT_INTERRUPTION_SOURCES = Object.freeze(["combat", "interaction", "manual", "error"]);

const fail = message => { throw new Error(message); };
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    fail(text("Прерывание скрипта: ожидается объект с известными настройками.", "Script interruption: expected an object with known settings."));
  }
  return value;
}
function mode(value = "stop") {
  if (!SCRIPT_INTERRUPTION_MODES.includes(value)) {
    fail(text("Прерывание скрипта: выберите допустимое поведение.", "Script interruption: choose a supported behavior."));
  }
  return value;
}

/** Preparation only: omitted settings use safe defaults without rewriting saved documents. */
export function normalizeScriptInterruptions(raw = {}) {
  record(raw, SCRIPT_INTERRUPTION_SOURCES);
  const error = record(raw.error === undefined ? {} : raw.error, ["mode", "retries", "delaySeconds"]);
  const retries = error.retries === undefined ? 3 : error.retries;
  const delaySeconds = error.delaySeconds === undefined ? 1 : error.delaySeconds;
  if (!Number.isInteger(retries) || retries < 1 || retries > 10) {
    fail(text("Повторов после ошибки: требуется целое число от 1 до 10.", "Retries after an error: enter an integer from 1 to 10."));
  }
  if (typeof delaySeconds !== "number" || !Number.isFinite(delaySeconds) || delaySeconds < 0.1 || delaySeconds > 60) {
    fail(text("Таймаут повторений: требуется число от 0,1 до 60 секунд.", "Retry delay: enter a number from 0.1 to 60 seconds."));
  }
  return {
    combat: mode(raw.combat), interaction: mode(raw.interaction), manual: mode(raw.manual),
    error: { mode: mode(error.mode), retries, delaySeconds }
  };
}
