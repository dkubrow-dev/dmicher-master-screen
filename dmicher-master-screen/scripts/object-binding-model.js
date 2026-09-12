import { message as localizedMessage } from "./localization.js";
import { normalizeConditions, normalizeTags } from "./model.js";
import { normalizeScript, normalizeScripts } from "./script-model.js";
import { SCENE_OBJECT_COLLECTIONS as collections } from "./scene-object-types.js";
import { interactionType } from "./interaction-model.js";
import { validateParameters } from "./signal-types.js";

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
    const range = entry.range ?? 5;
    if (!validId(entry[`${kind}Id`])) fail(localizedMessage("Выберите инструмент из каталога."));
    if (!Number.isFinite(range) || range < 0 || range > 100000) fail(localizedMessage("Дальность должна быть неотрицательным числом."));
    return { [`${kind}Id`]: entry[`${kind}Id`], stateIds: ids(entry.stateIds), range, conditions: normalizeConditions(entry.conditions) };
  });
}
export function normalizeObjectBinding(raw) {
  objectKey(raw);
  if (raw.groupId != null && !validId(raw.groupId)) fail(localizedMessage("Неверный ID группы объекта."));
  if (raw.playerCharacter !== undefined && typeof raw.playerCharacter !== "boolean") fail(localizedMessage("Флаг персонажа игрока должен быть логическим."));
  if (typeof (raw.notes ?? "") !== "string" || [...(raw.notes ?? "")].length > 12000) fail(localizedMessage("Заметки должны быть текстом до 12000 символов."));
  const transitions = raw.transitionScripts ?? {};
  if (!transitions || typeof transitions !== "object" || Array.isArray(transitions)) fail(localizedMessage("Ожидаются скрипты состояний."));
  const entries = Object.entries(transitions).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.some(([key]) => !validId(key))) fail(localizedMessage("Неверный ID состояния скрипта."));
  return { type: raw.type, id: raw.id, groupId: raw.groupId ?? null, playerCharacter: raw.playerCharacter ?? false,
    tags: normalizeTags(raw.tags), notes: raw.notes ?? "",
    initialScript: raw.initialScript ? normalizeScript(raw.initialScript) : null,
    transitionScripts: Object.fromEntries(entries.map(([id, script]) => [id, normalizeScript(script)])),
    scripts: normalizeScripts(raw.scripts ?? []), shops: references(raw.shops, "shop"), dialogues: references(raw.dialogues, "dialogue") };
}
export function normalizeObjectBindings(raw = {}) {
  if (!raw || raw.schemaVersion !== undefined && raw.schemaVersion !== 1 || raw.bindings != null && (typeof raw.bindings !== "object" || Array.isArray(raw.bindings))) fail(localizedMessage("Неверные привязки объектов."));
  const entries = Object.entries(raw.bindings ?? {}).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.length > 5000) fail(localizedMessage("Допустимо до 5000 объектов."));
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0,
    bindings: Object.fromEntries(entries.map(([key, value]) => { if (key !== objectKey(value)) fail(localizedMessage("Ключ привязки не соответствует объекту.")); return [key, normalizeObjectBinding(value)]; })) };
}

/** The three script purposes share the same step model. Other JSON stored on
 * the object is author data and cannot declare actions by matching field names. */
export function bindingScripts(binding) {
  return [binding?.initialScript, ...Object.values(binding?.transitionScripts ?? {}),
    ...(Array.isArray(binding?.scripts) ? binding.scripts : [])].filter(Boolean);
}
export function bindingScriptSteps(binding) {
  return bindingScripts(binding).flatMap((script) => Array.isArray(script.steps) ? script.steps : []);
}
export function validateBindingReferences(binding, { definitions, signals, macros, assets }) {
  const group = definitions.find((entry) => entry.groupId === binding.groupId), stateIds = new Set(group?.states.map((state) => state.id) ?? []);
  if (binding.groupId && !group) fail(localizedMessage("Назначенная группа больше не существует."));
  if (!group && (binding.scripts.length || Object.keys(binding.transitionScripts).length || binding.shops.length || binding.dialogues.length)) fail(localizedMessage("Сначала назначьте объект группе."));
  if (binding.playerCharacter && binding.type !== "Token") fail(localizedMessage("Персонажем игрока может быть только токен."));
  const checkStates = (values) => { if (values.some((id) => !stateIds.has(id))) fail(localizedMessage("Настройка ссылается на отсутствующее состояние группы.")); };
  checkStates(Object.keys(binding.transitionScripts)); checkStates(binding.scripts.map((script) => script.stateId));
  const ownerKey = objectKey(binding);
  for (const step of bindingScriptSteps(binding)) {
    if (step.kind === "signal") {
      const signal = signals.find((entry) => entry.id === step.parameters.signalId && entry.emitterKey === ownerKey);
      if (!signal) fail(localizedMessage("Объект может испустить только собственный объявленный сигнал."));
      validateParameters(signal, step.parameters.parameters);
    }
    if (step.kind === "macro" && !macros.some((macro) => macro.ownerKey === ownerKey && macro.uuid === step.parameters.macroUuid)) fail(localizedMessage("Скрипт может вызвать только макрос своего объекта."));
  }
  for (const kind of ["shop", "dialogue"]) for (const reference of binding[`${kind}s`]) {
    if (!assets[`${kind}s`].some((asset) => asset.id === reference[`${kind}Id`])) fail(localizedMessage("Инструмент больше не существует."));
    checkStates(reference.stateIds); checkStates(reference.conditions.stateIds);
    if (reference.conditions.groupIds.some((id) => id !== binding.groupId)) fail(localizedMessage("Условия объекта не могут ссылаться на чужую группу."));
  }
}

export const clearGroupContent = (binding) => Object.assign(binding, { transitionScripts: {}, scripts: [], shops: [], dialogues: [] });
export function reconcileBindingGroups(raw, previous, definitions) {
  const next = clone(raw); let changed = false;
  for (const binding of Object.values(next.bindings)) {
    if (!binding.groupId) continue;
    const group = definitions.find((entry) => entry.groupId === binding.groupId);
    if (!group) { binding.groupId = null; clearGroupContent(binding); changed = true; continue; }
    const removed = previous.find((entry) => entry.groupId === binding.groupId)?.states.filter((state) => !group.states.some((entry) => entry.id === state.id)).map((state) => state.id) ?? [];
    if (!removed.length) continue;
    changed = true;
    for (const id of removed) delete binding.transitionScripts[id];
    binding.scripts = binding.scripts.filter((script) => !removed.includes(script.stateId));
    for (const kind of ["shops", "dialogues"]) binding[kind] = binding[kind].filter((ref) => !ref.stateIds.length || !ref.stateIds.every((id) => removed.includes(id))).map((ref) => ({ ...ref,
      stateIds: ref.stateIds.filter((id) => !removed.includes(id)), conditions: { ...ref.conditions,
        enabled: ref.conditions.enabled && !(ref.conditions.stateIds.length && ref.conditions.stateIds.every((id) => removed.includes(id))),
        stateIds: ref.conditions.stateIds.filter((id) => !removed.includes(id)) } }));
  }
  if (!changed) return null;
  next.revision++; return next;
}

export function resolveBindingTools(binding, catalog, context, kind) {
  if (!binding?.groupId || binding.playerCharacter || binding.groupId !== context.groupId) return [];
  const { collection, referenceId } = interactionType(kind), assets = catalog[collection];
  const seen = new Set();
  return binding[collection].filter((ref) => !ref.stateIds.length || ref.stateIds.includes(context.stateId)).flatMap((reference) => {
    const asset = assets.find((entry) => entry.id === reference[referenceId]);
    if (!asset || seen.has(asset.id)) return [];
    seen.add(asset.id);
    const config = { ...clone(asset), enabled: true, [referenceId]: asset.id, target: { type: binding.type, id: binding.id }, range: reference.range, conditions: clone(reference.conditions) };
    return [{ asset, binding, config }];
  });
}

export function materializeStateDefinition(bindings, assets, definition, source) {
  const state = { ...clone(source), objects: [], scripts: [], transitions: [], shops: [], dialogues: [] };
  for (const binding of Object.values(bindings)) {
    if (binding.groupId !== definition.groupId || binding.playerCharacter) continue;
    const target = { type: binding.type, id: binding.id };
    state.objects.push({ target });
    const script = binding.scripts.find((entry) => entry.stateId === source.id);
    if (script?.enabled) state.scripts.push({ ...clone(script), target });
    const transition = binding.transitionScripts[source.id];
    if (transition?.enabled) state.transitions.push({ ...clone(transition), target });
    for (const kind of ["shop", "dialogue"]) state[`${kind}s`].push(...resolveBindingTools(binding, assets, { groupId: definition.groupId, stateId: source.id }, kind).map((entry) => entry.config));
  }
  return state;
}
