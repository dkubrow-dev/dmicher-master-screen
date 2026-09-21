import { text } from "./localization.js";
import { SCRIPT_STEP_KINDS, isPremiumScriptStep } from "./script-model.js";
import { getScriptFunction } from "./script-functions/index.js";

/** The editor and combat prompts must use the same names for script actions. */
export const scriptActionLabel = (kind, language) => {
  const label = getScriptFunction(kind)?.label;
  return label ? text(label.ru, label.en, language) : String(kind);
};
export const scriptActionOptions = (language) => SCRIPT_STEP_KINDS.map((kind) => [kind, scriptActionLabel(kind, language) + (isPremiumScriptStep(kind) ? " · Premium" : "")]);
