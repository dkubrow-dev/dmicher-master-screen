import { MODULE_ID } from "./model.js";
import { bindingScriptSteps } from "./object-binding-model.js";

/** Validate a complete draft without writing partially imported flags to the world. */
export function stageScene(scene, flags) {
  const staged = Object.create(scene);
  staged.getFlag = (scope, key) => scope === MODULE_ID && Object.hasOwn(flags, key) ? flags[key] : scene.getFlag(scope, key);
  return staged;
}

const remapSignalReference = (reference, mapping) => {
  if (reference?.signalId) reference.signalId = mapping.get(reference.signalId) ?? reference.signalId;
};

/** Follow the current domain schema, never arbitrary author JSON. A signal's
 * payload may contain its own signalId without being an editor reference. */
export function remapStateSignals(states, mapping) {
  const next = structuredClone(states);
  for (const state of next) for (const source of [...state.zones, ...state.interactions]) remapSignalReference(source, mapping);
  return next;
}

export function remapDialogueSignals(dialogue, mapping) {
  const next = structuredClone(dialogue);
  for (const page of next.pages) for (const response of page.responses) remapSignalReference(response, mapping);
  return next;
}

export function remapBindingSignals(binding, mapping) {
  const next = structuredClone(binding);
  for (const step of bindingScriptSteps(next)) {
    if (step.kind === "signal") remapSignalReference(step.parameters, mapping);
  }
  return next;
}
