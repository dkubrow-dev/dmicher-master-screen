import { normalizeScript } from "./script-model.js";
import { getScriptFunction } from "./script-functions/index.js";
import { text } from "./localization.js";

export const isGroupOwner = key => typeof key === "string" && /^Group:[A-Za-z0-9_-]{1,64}$/.test(key);
export function normalizeGroupScript(raw = { steps: [] }) {
  const script = normalizeScript(raw);
  if (script.steps.some(step => !getScriptFunction(step.kind)?.scopes.includes("group"))) {
    throw new Error(text("Скрипт группы может использовать только общие системные функции.", "Group scripts can use only general system functions."));
  }
  return script;
}
