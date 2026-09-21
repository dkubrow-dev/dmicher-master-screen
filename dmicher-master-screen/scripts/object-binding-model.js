import { message as localizedMessage, text } from "./localization.js";
import { normalizeConditions, normalizeTags } from "./model.js";
import { normalizeScript, normalizeScripts, normalizeStateTransitions } from "./script-model.js";
import { SCENE_OBJECT_COLLECTIONS as collections } from "./scene-object-types.js";
import { interactionType } from "./interaction-model.js";
import { validateParameters } from "./signal-types.js";
import { normalizeObjectCommands } from "./object-command-model.js";
import { normalizeObjectVariables } from "./object-variables.js";
import { normalizeObjectSignalSettings } from "./object-signal-settings.js";
import { normalizeObjectActions, normalizeInvokedScripts, normalizeActionConditionMacro } from "./object-action-model.js";
import { objectCapabilities } from "./object-capabilities.js";
import { normalizeShopRestoration } from "./shop-restoration-policy.js";
import { PLAYERS_GROUP_ID, isPlayersGroup } from "./players-group.js";
import { getScriptFunction } from "./script-functions/index.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const ids = (value = []) => {
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => !validId(id))) fail(localizedMessage("Ожидается список ID состояний."));
  return [...new Set(value)];
};
export function objectKey({ type, id }) { if (!Object.hasOwn(collections, type) || !validId(id)) fail(localizedMessage("Неверный тип или ID объекта сцены.")); return `${type}:${id}`; }

function references(raw, kind) {
  if (!Array.isArray(raw ?? []) || (raw?.length ?? 0) > 100) fail(localizedMessage("Слишком много инструментов объекта."));
  return (raw ?? []).map((entry) => {
    if (entry.playerAction !== undefined && typeof entry.playerAction !== "boolean") fail(text("Доступ игрока должен быть логическим значением.", "Player access must be a boolean."));
    const range = entry.range ?? 5;
    if (!validId(entry[`${kind}Id`])) fail(localizedMessage("Выберите инструмент из каталога."));
    if (!Number.isFinite(range) || range < 0 || range > 100000) fail(localizedMessage("Дальность должна быть неотрицательным числом."));
    const displayName = entry.displayName ?? "", order = entry.order ?? 0;
    if (typeof displayName !== "string" || displayName.length > 200 || !Number.isSafeInteger(order) || order < 0 || entry.showWhenUnavailable !== undefined && typeof entry.showWhenUnavailable !== "boolean") fail(text("Проверьте название и порядок действия.", "Check the action's display name and order."));
    return { [`${kind}Id`]: entry[`${kind}Id`], ...(entry.playerAction === false ? { playerAction: false } : {}), stateIds: ids(entry.stateIds), range,
      displayName, order, showWhenUnavailable: entry.showWhenUnavailable ?? false, conditionMacro: normalizeActionConditionMacro(entry.conditionMacro), conditions: normalizeConditions(entry.conditions),
      ...(kind === "shop" ? { restoration: normalizeShopRestoration(entry.restoration) } : {}) };
  });
}
/** A player assignment also registers its tool. A registration-only entry never
 * admits player interaction, regardless of its condition values. */
export const registeredToolIds = (binding, kind) => [...new Set((binding?.[`${kind}s`] ?? []).map((entry) => entry[`${kind}Id`]))];
export const toolRegistration = (kind, id) => ({ [`${kind}Id`]: id, playerAction: false, stateIds: [], range: 5, conditions: normalizeConditions({ enabled: false }) });
export function normalizeObjectBinding(raw) {
  objectKey(raw);
  if (raw.groupId != null && !validId(raw.groupId)) fail(localizedMessage("Неверный ID группы объекта."));
  if (raw.playerCharacter !== undefined && typeof raw.playerCharacter !== "boolean") fail(localizedMessage("Флаг персонажа игрока должен быть логическим."));
  if (typeof (raw.notes ?? "") !== "string" || [...(raw.notes ?? "")].length > 12000) fail(localizedMessage("Заметки должны быть текстом до 12000 символов."));
  if (typeof (raw.displayName ?? "") !== "string" || (raw.displayName ?? "").length > 200) fail(text("Отображаемое имя: не более 200 символов.", "Display name: at most 200 characters."));
  const transitions = raw.transitionScripts ?? {};
  if (!transitions || typeof transitions !== "object" || Array.isArray(transitions)) fail(localizedMessage("Ожидаются скрипты состояний."));
  const entries = Object.entries(transitions).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.some(([key]) => !validId(key))) fail(localizedMessage("Неверный ID состояния скрипта."));
  const playerCharacter = raw.playerCharacter === true || raw.type === "Token" && isPlayersGroup(raw.groupId);
  return { type: raw.type, id: raw.id, groupId: playerCharacter ? PLAYERS_GROUP_ID : raw.groupId ?? null, playerCharacter,
    displayName: (raw.displayName ?? "").trim(), tags: normalizeTags(raw.tags), notes: raw.notes ?? "",
    initialScript: raw.initialScript ? normalizeScript(raw.initialScript) : null,
    transitionScripts: Object.fromEntries(entries.map(([id, script]) => [id, normalizeScript(script)])),
    scripts: normalizeScripts(raw.scripts ?? []), shops: references(raw.shops, "shop"), dialogues: references(raw.dialogues, "dialogue"),
    commands: normalizeObjectCommands(raw.commands), variables: normalizeObjectVariables(raw.variables), signals: normalizeObjectSignalSettings(raw.signals),
    actions: normalizeObjectActions(raw.actions), eventScripts: normalizeInvokedScripts(raw.eventScripts, "subscriptionId"), reactionScripts: normalizeInvokedScripts(raw.reactionScripts, "actionId") };
}
export function normalizeObjectBindings(raw = {}) {
  if (!raw || raw.schemaVersion !== undefined && raw.schemaVersion !== 1 || raw.bindings != null && (typeof raw.bindings !== "object" || Array.isArray(raw.bindings))) fail(localizedMessage("Неверные привязки объектов."));
  const entries = Object.entries(raw.bindings ?? {}).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.length > 5000) fail(localizedMessage("Допустимо до 5000 объектов."));
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0,
    bindings: Object.fromEntries(entries.map(([key, value]) => { if (key !== objectKey(value)) fail(localizedMessage("Ключ привязки не соответствует объекту.")); return [key, normalizeObjectBinding(value)]; })) };
}

/** Object scripts and command phases share the same step model. Other JSON stored on
 * the object is author data and cannot declare actions by matching field names. */
export function bindingScripts(binding) {
  return [binding?.initialScript, ...Object.values(binding?.transitionScripts ?? {}),
    ...(Array.isArray(binding?.scripts) ? binding.scripts : []),
    ...(binding?.commands ?? []).flatMap(command => [command.beforeScript, command.afterScript]),
    ...(binding?.eventScripts ?? []).map(entry => entry.script), ...(binding?.reactionScripts ?? []).map(entry => entry.script)].filter(Boolean);
}
export function bindingScriptSteps(binding) {
  return bindingScripts(binding).flatMap((script) => Array.isArray(script.steps) ? script.steps : []);
}
export function validateBindingReferences(binding, { definitions, signals, macros, assets }) {
  const group = definitions.find((entry) => entry.groupId === binding.groupId), stateIds = new Set(group?.states.map((state) => state.id) ?? []);
  if (binding.groupId && !group) fail(localizedMessage("Назначенная группа больше не существует."));
  if (!group && (binding.scripts.length || Object.keys(binding.transitionScripts).length || [...binding.shops, ...binding.dialogues].some((entry) => entry.playerAction !== false))) fail(localizedMessage("Сначала назначьте объект группе."));
  if (binding.playerCharacter && binding.type !== "Token") fail(localizedMessage("Персонажем игрока может быть только токен."));
  if (!objectCapabilities(binding.type).tools && (binding.shops.length || binding.dialogues.length)) fail(text("Магазины и диалоги доступны токенам, тайлам, рисункам и регионам.", "Shops and dialogues are available to tokens, tiles, drawings and regions."));
  for (const entry of binding.reactionScripts ?? []) if (!binding.actions.some(action => action.id === entry.actionId)) fail(text("Реакция должна ссылаться на действие объекта.", "A reaction must refer to an object action."));
  const checkStates = (values) => { if (values.some((id) => !stateIds.has(id))) fail(localizedMessage("Настройка ссылается на отсутствующее состояние группы.")); };
  checkStates(Object.keys(binding.transitionScripts)); checkStates(binding.scripts.map((script) => script.stateId));
  for (const command of binding.commands ?? []) for (const scope of command.conditions.groups) {
    const selected = definitions.find(entry => entry.groupId === scope.groupId);
    if (!selected || scope.stateIds.some(id => !selected.states.some(state => state.id === id))) {
      fail(text("Условия команды ссылаются на отсутствующую группу или состояние.", "Command conditions refer to a missing group or state."));
    }
  }
  const ownerKey = objectKey(binding);
  for (const step of bindingScriptSteps(binding)) {
    const fn = getScriptFunction(step.kind);
    if (!fn?.scopes.includes("object") || fn.objectTypes && !fn.objectTypes.includes(binding.type)) {
      fail(text("Функция скрипта недоступна этому типу объекта.", "The script function is unavailable to this object type."));
    }
    // Import remapping can merge two formerly distinct destination groups, so
    // recheck uniqueness along with references before the complete draft is saved.
    if (step.kind === "state") for (const transition of normalizeStateTransitions(step.parameters.transitions)) {
      const destination = definitions.find((entry) => entry.groupId === transition.groupId);
      if (!destination?.states.some((state) => state.id === transition.stateId)) {
        fail(text("Переход скрипта ссылается на отсутствующую группу или состояние.", "The script transition refers to a missing group or state."));
      }
    }
    if (step.kind === "signal") {
      const signal = signals.find((entry) => entry.id === step.parameters.signalId && entry.emitterKey === ownerKey);
      if (!signal) fail(localizedMessage("Объект может испустить только собственный объявленный сигнал."));
      validateParameters(signal, step.parameters.parameters);
    }
    if (step.kind === "dialogue" && step.parameters.dialogueId) {
      const id = step.parameters.dialogueId;
      if (!registeredToolIds(binding, "dialogue").includes(id) || !assets.dialogues.some((dialogue) => dialogue.id === id)) {
        fail(text("Скрипт может запускать только диалог, зарегистрированный в свойствах этого объекта.", "A script can start only a dialogue registered in this object's properties."));
      }
    }
    if (step.kind === "macro" && !macros.some((macro) => macro.ownerKey === ownerKey && macro.uuid === step.parameters.macroUuid)) fail(localizedMessage("Скрипт может вызвать только макрос своего объекта."));
  }
  for (const kind of ["shop", "dialogue"]) for (const reference of binding[`${kind}s`]) {
    if (!assets[`${kind}s`].some((asset) => asset.id === reference[`${kind}Id`])) fail(localizedMessage("Инструмент больше не существует."));
    if (reference.playerAction === false) continue;
    checkStates(reference.stateIds); checkStates(reference.conditions.stateIds);
    if (reference.conditions.groupIds.some((id) => id !== binding.groupId)) fail(localizedMessage("Условия объекта не могут ссылаться на чужую группу."));
  }
}

export const clearGroupContent = (binding) => Object.assign(binding, { transitionScripts: {}, scripts: [],
  shops: registeredToolIds(binding, "shop").map((id) => toolRegistration("shop", id)),
  dialogues: registeredToolIds(binding, "dialogue").map((id) => toolRegistration("dialogue", id)) });
export function reconcileBindingGroups(raw, previous, definitions) {
  const next = clone(raw); let changed = false;
  for (const binding of Object.values(next.bindings)) {
    // Command scopes may reference other groups, even on an ungrouped object.
    // Removing the last allowed state must never turn a restricted command public.
    for (const command of binding.commands ?? []) {
      const scopes = [];
      for (const scope of command.conditions.groups) {
        const selected = definitions.find(entry => entry.groupId === scope.groupId);
        if (!selected) { command.enabled = false; changed = true; continue; }
        const stateIds = scope.stateIds.filter(id => selected.states.some(state => state.id === id));
        if (stateIds.length !== scope.stateIds.length) {
          changed = true;
          if (!stateIds.length) command.enabled = false;
        }
        scopes.push({ ...scope, stateIds });
      }
      command.conditions.groups = scopes;
    }
    if (!binding.groupId) continue;
    const group = definitions.find((entry) => entry.groupId === binding.groupId);
    if (!group) { binding.groupId = null; clearGroupContent(binding); changed = true; continue; }
    const removed = previous.find((entry) => entry.groupId === binding.groupId)?.states.filter((state) => !group.states.some((entry) => entry.id === state.id)).map((state) => state.id) ?? [];
    if (!removed.length) continue;
    changed = true;
    for (const id of removed) delete binding.transitionScripts[id];
    binding.scripts = binding.scripts.filter((script) => !removed.includes(script.stateId));
    for (const kind of ["shops", "dialogues"]) {
      const registered = registeredToolIds(binding, kind.slice(0, -1));
      binding[kind] = binding[kind].filter((ref) => ref.playerAction === false || !ref.stateIds.length || !ref.stateIds.every((id) => removed.includes(id))).map((ref) => ({ ...ref,
      stateIds: ref.stateIds.filter((id) => !removed.includes(id)), conditions: { ...ref.conditions,
        enabled: ref.conditions.enabled && !(ref.conditions.stateIds.length && ref.conditions.stateIds.every((id) => removed.includes(id))),
        stateIds: ref.conditions.stateIds.filter((id) => !removed.includes(id)) } }));
      for (const id of registered) if (!registeredToolIds(binding, kind.slice(0, -1)).includes(id)) binding[kind].push(toolRegistration(kind.slice(0, -1), id));
    }
  }
  if (!changed) return null;
  next.revision++; return next;
}

export function resolveBindingTools(binding, catalog, context, kind) {
  if (!binding?.groupId || binding.groupId !== context.groupId || !objectCapabilities(binding.type).tools) return [];
  const { collection, referenceId } = interactionType(kind), assets = catalog[collection];
  const seen = new Set();
  return binding[collection].filter((ref) => ref.playerAction !== false && (!ref.stateIds.length || ref.stateIds.includes(context.stateId))).flatMap((reference) => {
    const asset = assets.find((entry) => entry.id === reference[referenceId]);
    if (!asset || seen.has(asset.id)) return [];
    seen.add(asset.id);
    const config = { ...clone(asset), enabled: true, [referenceId]: asset.id, target: { type: binding.type, id: binding.id }, range: reference.range,
      displayName: reference.displayName, order: reference.order, showWhenUnavailable: reference.showWhenUnavailable, conditionMacro: reference.conditionMacro, conditions: clone(reference.conditions) };
    return [{ asset, binding, config }];
  });
}

export function materializeStateDefinition(bindings, assets, definition, source) {
  const state = { ...clone(source), objects: [], scripts: [], transitions: [], shops: [], dialogues: [], actions: [] };
  for (const binding of Object.values(bindings)) {
    if (binding.groupId !== definition.groupId) continue;
    const target = { type: binding.type, id: binding.id };
    state.objects.push({ target });
    state.actions.push(...(binding.actions ?? []).map(action=>({...clone(action),target})));
    const script = binding.scripts.find((entry) => entry.stateId === source.id);
    if (script?.enabled && !binding.playerCharacter) state.scripts.push({ ...clone(script), target });
    const transition = binding.transitionScripts[source.id];
    if (transition?.enabled) state.transitions.push({ ...clone(transition), target });
    for (const kind of ["shop", "dialogue"]) state[`${kind}s`].push(...resolveBindingTools(binding, assets, { groupId: definition.groupId, stateId: source.id }, kind).map((entry) => entry.config));
  }
  return state;
}
