import { text } from "./localization.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compiled = new Map();
function compile(source) {
  if (compiled.has(source)) return compiled.get(source);
  const operation = new AsyncFunction("context", source);
  if (compiled.size >= 128) compiled.delete(compiled.keys().next().value);
  compiled.set(source, operation); return operation;
}
export function normalizeScriptTransition(source = {}) {
  const mode = source.mode ?? "any", macro = source.macro ?? "";
  if (!["next", "any", "macro"].includes(mode) || typeof macro !== "string" || macro.length > 32000)
    throw new Error(text("Укажите режим перехода и корректный текст макроса.", "Choose a transition mode and valid macro source."));
  if (mode === "macro") {
    if (!macro.trim()) throw new Error(text("Напишите макрос выбора следующего шага.", "Write the macro that selects the next step."));
    try { compile(macro); }
    catch (error) { throw new Error(text("Ошибка синтаксиса макроса перехода: ", "Transition macro syntax error: ") + error.message); }
  }
  return { mode, macro };
}

export function scriptRowSuccessor(script, step) {
  const index = script.steps.findIndex(entry => entry.id === step.id);
  return index < 0 ? null : script.steps[index + 1]?.id ?? (script.repeat ? 1 : null);
}

/** Macro edges are unknown without execution: graph diagnostics conservatively
 * consider every existing step, never run authored code when saving. */
export function scriptTransitionCandidates(script, step, { macroResult } = {}) {
  const mode = step.transition?.mode ?? "any";
  if (mode === "next") { const next = scriptRowSuccessor(script, step); return next === null ? [] : [next]; }
  if (mode === "macro" && macroResult === undefined) return script.steps.map(entry => entry.id);
  const candidates = mode === "macro" ? macroResult : step.next ?? [];
  if (!Array.isArray(candidates) || candidates.some(id => !Number.isSafeInteger(id) || id < 1))
    throw new Error(text("Макрос перехода должен вернуть массив положительных целых номеров шагов.", "A transition macro must return an array of positive integer step IDs."));
  const ids = new Set(script.steps.map(entry => entry.id)), valid = [...new Set(candidates)].filter(id => ids.has(id));
  return valid.length ? valid : script.repeat ? [1] : [];
}

export function chooseScriptSuccessor(script, step, random = Math.random, options) {
  const candidates = scriptTransitionCandidates(script, step, options);
  return candidates.length ? candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))] : null;
}

export function scriptTransitionMacroTemplate(script) {
  return `const { objectUuid, stepId, stateId, GetValue } = context;\nconst values = await context.getVariables();\n// values["variable name"] contains the current typed value.\nreturn ${JSON.stringify(script.steps.map(step => step.id))};`;
}

export async function executeScriptTransition(script, step, context, current) {
  if (!current()) return null;
  const { macro } = normalizeScriptTransition(step.transition);
  const result = await compile(macro)(context);
  if (!current()) return null;
  return scriptTransitionCandidates(script, step, { macroResult: result });
}
