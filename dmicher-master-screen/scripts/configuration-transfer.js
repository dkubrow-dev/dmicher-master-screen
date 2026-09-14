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

/** A group import owns all its states; a single-state import owns only the
 * mapped pair. Other destinations remain external references, even when their
 * state ID happens to match an imported state in another group. */
export function remapBindingStateTransitions(binding, { sourceGroupId, groupId, stateMapping = new Map() }) {
  const next = structuredClone(binding);
  for (const step of bindingScriptSteps(next)) {
    if (step.kind !== "state") continue;
    for (const transition of step.parameters.transitions) {
      if (transition.groupId !== sourceGroupId || stateMapping.size && !stateMapping.has(transition.stateId)) continue;
      transition.groupId = groupId;
      transition.stateId = stateMapping.get(transition.stateId) ?? transition.stateId;
    }
  }
  return next;
}

/** Command availability is a typed group/state reference, separate from script
 * actions and opaque macro payloads. Split partial state imports by owner. */
export function remapBindingCommandGroups(binding, { sourceGroupId, groupId, stateMapping = new Map() }) {
  const next = structuredClone(binding);
  for (const command of next.commands ?? []) {
    command.conditions.groups = command.conditions.groups.flatMap(scope => {
      if (scope.groupId !== sourceGroupId) return [scope];
      if (!stateMapping.size) return [{ ...scope, groupId }];
      if (!scope.stateIds.length) return [{ groupId, stateIds: [...stateMapping.values()] }];
      const owned = scope.stateIds.filter(id => stateMapping.has(id));
      const external = scope.stateIds.filter(id => !stateMapping.has(id));
      return [...(owned.length ? [{ groupId, stateIds: owned.map(id => stateMapping.get(id)) }] : []),
        ...(external.length ? [{ ...scope, stateIds: external }] : [])];
    });
    // Mapping may join a source group with an existing external reference.
    command.conditions.groups = mergeCommandScopes(command.conditions.groups);
  }
  return next;
}

function mergeCommandScopes(scopes) {
  const groups = new Map();
  for (const scope of scopes) {
    const current = groups.get(scope.groupId);
    groups.set(scope.groupId, !current ? scope : { groupId: scope.groupId,
      stateIds: !current.stateIds.length || !scope.stateIds.length ? [] : [...new Set([...current.stateIds, ...scope.stateIds])] });
  }
  return [...groups.values()];
}

/** Native objects keep their embedded IDs in scoped imports. Remap only these
 * actions' declared references; signal payloads and macro source are opaque. */
export function remapBindingActionReferences(binding, { assetMapping, sourceSceneUuid, sceneUuid }) {
  const next = structuredClone(binding);
  const sceneReference = (uuid) => typeof uuid === "string" && sourceSceneUuid && sceneUuid
    && uuid.startsWith(`${sourceSceneUuid}.`) ? sceneUuid + uuid.slice(sourceSceneUuid.length) : uuid;
  for (const step of bindingScriptSteps(next)) {
    if (step.kind === "dialogue") {
      step.parameters.dialogueId = assetMapping.get(`Dialogue:${step.parameters.dialogueId}`) ?? step.parameters.dialogueId;
      step.parameters.tokenUuids = step.parameters.tokenUuids.map(sceneReference);
    }
    if (step.kind === "approach" || step.kind === "follow") step.parameters.targetUuid = sceneReference(step.parameters.targetUuid);
  }
  return next;
}
