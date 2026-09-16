import { normalizeConditions } from "./model.js";
import { normalizeScript } from "./script-model.js";
import { text } from "./localization.js";

const fail = () => { throw new Error(text("Проверьте название, условия и параметры действия объекта.", "Check the object action's name, conditions and parameters.")); };
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function normalizeActionConditionMacro(value = "") {
  if (typeof value !== "string" || value.length > 32000) fail();
  return value;
}
export function normalizeObjectActions(raw = []) {
  if (!Array.isArray(raw) || raw.length > 100) fail();
  const seen = new Set();
  return raw.map(entry => {
    if (!entry || !validId(entry.id) || seen.has(entry.id) || typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 200) fail();
    seen.add(entry.id);
    for (const key of ["enabled", "showWhenUnavailable"]) if (entry[key] !== undefined && typeof entry[key] !== "boolean") fail();
    if (!["players", "gm", "all"].includes(entry.audience ?? "players")) fail();
    const range = entry.range ?? 5, order = entry.order ?? 0;
    if (!Number.isFinite(range) || range < 0 || !Number.isSafeInteger(order) || order < 0) fail();
    const parameters = structuredClone(entry.parameters ?? {});
    if (!parameters || Array.isArray(parameters) || typeof parameters !== "object" || JSON.stringify(parameters).length > 16000) fail();
    return { id: entry.id, name: entry.name.trim(), enabled: entry.enabled ?? false,
      audience: entry.audience ?? "players", range, order, parameters,
      showWhenUnavailable: entry.showWhenUnavailable ?? false,
      conditionMacro: normalizeActionConditionMacro(entry.conditionMacro), conditions: normalizeConditions(entry.conditions) };
  });
}
export function normalizeInvokedScripts(raw = [], key) {
  if (!Array.isArray(raw) || raw.length > 100) fail();
  const seen = new Set();
  return raw.map(entry => {
    if (!validId(entry?.[key]) || seen.has(entry[key])) fail();
    seen.add(entry[key]);
    return { [key]: entry[key], script: normalizeScript(entry.script) };
  });
}
