import { MODULE_ID } from "./model.js";
import { bindingScriptSteps } from "./object-binding-model.js";
import { text } from "./localization.js";

/** Validate a complete draft without writing partially imported flags to the world. */
export function stageScene(scene, flags) {
  const staged = Object.create(scene);
  staged.getFlag = (scope, key) => scope === MODULE_ID && Object.hasOwn(flags, key) ? flags[key] : scene.getFlag(scope, key);
  return staged;
}

/** Inline handlers carry typed references alongside opaque signal input JSON. */
export function validateInlineSubscriptionReferences(catalog, definitions) {
  for (const entry of catalog.subscriptions ?? []) if (entry.script) {
    if (!definitions.some(group => `Group:${group.groupId}` === entry.ownerKey)) throw new Error(text("Группа скрипта подписки не найдена.", "The subscription script's group is missing."));
    const input = catalog.signals.find(signal => signal.id === entry.signalId && signal.emitterKey === entry.emitterKey);
    if (!input) throw new Error(text("Сигнал скрипта подписки не найден.", "The subscription script's signal is missing."));
    for (const step of entry.script.steps) {
      const p = step.parameters;
      if (step.kind === "macro" && (!catalog.macros.some(macro => macro.ownerKey === entry.ownerKey && macro.uuid === p.macroUuid)
        || p.signalId && p.signalId !== entry.signalId)) throw new Error(text("Макрос или его интерфейс не принадлежит скрипту подписки.", "The macro or its interface does not belong to the subscription script."));
      if (step.kind === "signal" && !catalog.signals.some(signal => signal.id === p.signalId && signal.emitterKey === entry.ownerKey)) throw new Error(text("Скрипт группы ссылается на чужой или отсутствующий сигнал.", "The group script refers to another owner's or a missing signal."));
      if (step.kind === "state" && p.transitions.some(pair => !definitions.some(group => group.groupId === pair.groupId && group.states.some(state => state.id === pair.stateId)))) throw new Error(text("Переход скрипта подписки ссылается на отсутствующую группу или состояние.", "The subscription script transition refers to a missing group or state."));
    }
  }
}

/** Full-scene imports recreate documents but preserve preparation values which
 * merely resemble UUIDs, including signal payloads and script source text. */
export function remapCatalogReferences(catalog, mapping, remapSignalData = value => structuredClone(value)) {
  const next = structuredClone(catalog);
  const reference = value => {
    if (mapping.has(value)) return mapping.get(value);
    for (const [from, to] of mapping) if (value?.startsWith(`builtin:${from}:`)) return `builtin:${to}:${value.slice(`builtin:${from}:`.length)}`;
    return value;
  };
  next.signals = (next.signals ?? []).map(signal => {
    const remapped = remapSignalData(signal, mapping);
    remapped.id = reference(signal.id); remapped.emitterKey = reference(signal.emitterKey); return remapped;
  });
  for (const macro of next.macros ?? []) { macro.ownerKey = reference(macro.ownerKey); macro.uuid = reference(macro.uuid); }
  for (const entry of next.subscriptions ?? []) {
    entry.ownerKey = reference(entry.ownerKey); entry.emitterKey = reference(entry.emitterKey); entry.signalId = reference(entry.signalId);
    if (entry.macroUuid) entry.macroUuid = reference(entry.macroUuid);
    for (const step of entry.script?.steps ?? []) {
      if (["signal", "macro"].includes(step.kind) && step.parameters.signalId) step.parameters.signalId = reference(step.parameters.signalId);
      if (step.kind === "macro") step.parameters.macroUuid = reference(step.parameters.macroUuid);
    }
  }
  return next;
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

export function remapBindingSignals(binding, mapping, subscriptionMapping = new Map()) {
  const next = structuredClone(binding);
  for (const step of bindingScriptSteps(next)) {
    if (["signal", "macro"].includes(step.kind)) remapSignalReference(step.parameters, mapping);
  }
  for (const event of next.eventScripts ?? []) event.subscriptionId = subscriptionMapping.get(event.subscriptionId) ?? event.subscriptionId;
  if (next.signals?.enabledIds) next.signals.enabledIds = next.signals.enabledIds.map(id => mapping.get(id) ?? id);
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
