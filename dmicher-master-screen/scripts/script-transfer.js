import { text } from "./localization.js";
import { MODULE_ID } from "./model.js";
import { normalizeScript } from "./script-model.js";
import { registeredToolIds, toolRegistration, validateBindingReferences } from "./object-binding-model.js";

/** A block carries its own steps, not the state slot or other preparation of its owner. */
function checkedBlock(raw, { binding, ...references }) {
  const script = normalizeScript(raw);
  const dialogues = new Set(script.steps.filter((step) => step.kind === "dialogue").map((step) => step.parameters.dialogueId));
  validateBindingReferences({ ...binding, initialScript: script, transitionScripts: {}, scripts: [],
    shops: [], commands: [], dialogues: registeredToolIds(binding, "dialogue").filter((id) => dialogues.has(id)).map((id) => toolRegistration("dialogue", id)) }, references);
  return script;
}

export function exportScriptBlock(raw, references) {
  const { stateId: _stateId, ...data } = checkedBlock(raw, references);
  return { format: MODULE_ID, version: 1, kind: "script", data };
}

export function importScriptBlock(envelope, target, references) {
  if (!envelope || envelope.format !== MODULE_ID || envelope.version !== 1 || envelope.kind !== "script"
    || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw new Error(text("Ожидается JSON одного блока скрипта Ширмы.", "Expected a Master screen script block JSON file."));
  }
  // A file cannot reassign the routine to another state. The destination owns this ID.
  const { stateId: _stateId, ...data } = envelope.data;
  return checkedBlock({ ...data, ...(target.stateId === undefined ? {} : { stateId: target.stateId }) }, references);
}
