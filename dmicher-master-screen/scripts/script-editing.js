import { scriptStepTemplate } from "./script-model.js";
import { text } from "./localization.js";

/** Appending and deleting preserve graph edges; display order never changes IDs. */
export function appendScriptStep(script) {
  const id = Math.max(0, ...script.steps.map((step) => step.id)) + 1;
  const previous = script.steps.at(-1);
  if (previous && !previous.next.length) previous.next = [id];
  script.steps.push({ id, ...scriptStepTemplate("wait") });
}

export function removeScriptStep(script, index) {
  if (script.steps[index]?.id === 1 && script.steps.length > 1) {
    throw new Error(text("Сначала удалите остальные шаги: шаг 1 начинает скрипт.", "Remove the other steps first: step 1 starts the script."));
  }
  const [removed] = script.steps.splice(index, 1);
  if (removed) for (const step of script.steps) step.next = step.next.filter((id) => id !== removed.id);
}

export function moveScriptStep(script, from, to) {
  if (![from, to].every((index) => Number.isInteger(index) && index >= 0 && index < script.steps.length) || from === to) return false;
  script.steps.splice(to, 0, script.steps.splice(from, 1)[0]);
  return true;
}
