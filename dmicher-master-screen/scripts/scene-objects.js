import { MODULE_ID, normalizeConditions, normalizeTags } from "./model.js";
import { getDefinitions, getRuntimes, requireGM, withSceneLock } from "./store.js";
import { getInteractionCatalog, mergeInteractionAssets } from "./scene-assets.js";
import { getSignalCatalog, exportCatalogDependencies, mergeCatalogDependencies } from "./signal-catalog.js";
import { validateParameters } from "./signal-types.js";
import { stageScene, remapSignalIds } from "./configuration-transfer.js";
import { normalizeScript, normalizeScripts } from "./script-model.js";
import { SCENE_OBJECT_COLLECTIONS as collections } from "./scene-object-types.js";
import { sceneObjectCenter } from "./scene-object-geometry.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const ids = (value = []) => {
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => !validId(id))) fail("Ожидается список ID состояний.");
  return [...new Set(value)];
};
export function objectKey({ type, id }) { if (!Object.hasOwn(collections, type) || !validId(id)) fail("Неверный тип или ID объекта сцены."); return `${type}:${id}`; }
export const getSceneObject = (scene, target) => Object.hasOwn(collections, target?.type) ? scene?.[collections[target.type]]?.get?.(target?.id) ?? null : null;
export function listNativeSceneObjects(scene) {
  return Object.entries(collections).flatMap(([type, collection]) => Array.from(scene?.[collection]?.values?.() ?? []).map((document) => ({
    type, id: document.id, key: `${type}:${document.id}`, name: String(document.name || document.text || document.label || document.id),
    uuid: document.uuid ?? `Scene.${scene.id}.${type}.${document.id}`,
    position: sceneObjectCenter(document, scene),
    hidden: typeof document.hidden === "boolean" ? document.hidden : null
  })));
}
function references(raw, kind) {
  if (!Array.isArray(raw ?? []) || (raw?.length ?? 0) > 100) fail("Слишком много инструментов объекта.");
  return (raw ?? []).map((entry) => {
    const range = entry.range ?? 5;
    if (!validId(entry[`${kind}Id`])) fail("Выберите инструмент из каталога.");
    if (!Number.isFinite(range) || range < 0 || range > 100000) fail("Дальность должна быть неотрицательным числом.");
    return { [`${kind}Id`]: entry[`${kind}Id`], stateIds: ids(entry.stateIds), range, conditions: normalizeConditions(entry.conditions) };
  });
}
export function normalizeObjectBinding(raw) {
  objectKey(raw);
  if (raw.groupId != null && !validId(raw.groupId)) fail("Неверный ID группы объекта.");
  if (raw.playerCharacter !== undefined && typeof raw.playerCharacter !== "boolean") fail("Флаг персонажа игрока должен быть логическим.");
  if (typeof (raw.notes ?? "") !== "string" || [...(raw.notes ?? "")].length > 12000) fail("Заметки должны быть текстом до 12000 символов.");
  const transitions = raw.transitionScripts ?? {};
  if (!transitions || typeof transitions !== "object" || Array.isArray(transitions)) fail("Ожидаются скрипты состояний.");
  const entries = Object.entries(transitions).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.some(([key]) => !validId(key))) fail("Неверный ID состояния скрипта.");
  return { type: raw.type, id: raw.id, groupId: raw.groupId ?? null, playerCharacter: raw.playerCharacter ?? false,
    tags: normalizeTags(raw.tags), notes: raw.notes ?? "",
    initialScript: raw.initialScript ? normalizeScript(raw.initialScript) : null,
    transitionScripts: Object.fromEntries(entries.map(([id, script]) => [id, normalizeScript(script)])),
    scripts: normalizeScripts(raw.scripts ?? []), shops: references(raw.shops, "shop"), dialogues: references(raw.dialogues, "dialogue") };
}
export function normalizeObjectBindings(raw = {}) {
  if (!raw || raw.schemaVersion !== undefined && raw.schemaVersion !== 1 || raw.bindings != null && (typeof raw.bindings !== "object" || Array.isArray(raw.bindings))) fail("Неверные привязки объектов.");
  const entries = Object.entries(raw.bindings ?? {}).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.length > 5000) fail("Допустимо до 5000 объектов.");
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0,
    bindings: Object.fromEntries(entries.map(([key, value]) => { if (key !== objectKey(value)) fail("Ключ привязки не соответствует объекту."); return [key, normalizeObjectBinding(value)]; })) };
}
export const getObjectBindings = (scene) => normalizeObjectBindings(scene?.getFlag(MODULE_ID, "objectBindings") ?? {});
export function getGroupObjects(scene, groupId) {
  const native = listNativeSceneObjects(scene);
  return Object.entries(getObjectBindings(scene).bindings).filter(([, b]) => b.groupId === groupId).map(([key, binding]) => ({
    ...(native.find((entry) => entry.key === key) ?? { type: binding.type, id: binding.id, key, name: binding.id, missing: true }), binding }));
}
export const assetReferences = (scene, kind, id) => Object.values(getObjectBindings(scene).bindings).filter((binding) => binding[`${kind}s`].some((ref) => ref[`${kind}Id`] === id));
export function validateObjectBinding(scene, binding, definitions = getDefinitions(scene)) {
  const group = definitions.find((entry) => entry.groupId === binding.groupId), stateIds = new Set(group?.states.map((state) => state.id) ?? []);
  if (binding.groupId && !group) fail("Назначенная группа больше не существует.");
  if (!group && (binding.scripts.length || Object.keys(binding.transitionScripts).length || binding.shops.length || binding.dialogues.length)) fail("Сначала назначьте объект группе.");
  if (binding.playerCharacter && binding.type !== "Token") fail("Персонажем игрока может быть только токен.");
  const checkStates = (values) => { if (values.some((id) => !stateIds.has(id))) fail("Настройка ссылается на отсутствующее состояние группы."); };
  checkStates(Object.keys(binding.transitionScripts)); checkStates(binding.scripts.map((script) => script.stateId));
  const catalog = getSignalCatalog(scene), ownerKey = objectKey(binding);
  const scripts = [binding.initialScript, ...Object.values(binding.transitionScripts), ...binding.scripts].filter(Boolean);
  for (const script of scripts) for (const step of script.steps) {
    if (step.kind === "signal") {
      const signal = catalog.signals.find((entry) => entry.id === step.parameters.signalId && entry.emitterKey === ownerKey);
      if (!signal) fail("Объект может испустить только собственный объявленный сигнал.");
      validateParameters(signal, step.parameters.parameters);
    }
    if (step.kind === "macro" && !catalog.macros.some((macro) => macro.ownerKey === ownerKey && macro.uuid === step.parameters.macroUuid)) fail("Скрипт может вызвать только макрос своего объекта.");
  }
  const assets = getInteractionCatalog(scene);
  for (const kind of ["shop", "dialogue"]) for (const reference of binding[`${kind}s`]) {
    if (!assets[`${kind}s`].some((asset) => asset.id === reference[`${kind}Id`])) fail("Инструмент больше не существует.");
    checkStates(reference.stateIds); checkStates(reference.conditions.stateIds);
    if (reference.conditions.groupIds.some((id) => id !== binding.groupId)) fail("Условия объекта не могут ссылаться на чужую группу.");
  }
}
/** Replace maps explicitly: omitted keys must not return through Foundry's recursive merge. */
export function objectBindingsWriteData(previous, next) {
  const data = clone(next);
  for (const [key, old] of Object.entries(previous.bindings)) {
    if (!data.bindings[key]) { data.bindings[`-=${key}`] = null; continue; }
    for (const id of Object.keys(old.transitionScripts)) if (!Object.hasOwn(data.bindings[key].transitionScripts, id)) data.bindings[key].transitionScripts[`-=${id}`] = null;
  }
  return data;
}
const clearGroupContent = (binding) => Object.assign(binding, { transitionScripts: {}, scripts: [], shops: [], dialogues: [] });
export function reconcileDefinitionBindings(scene, previous, definitions) {
  const raw = getObjectBindings(scene), next = clone(raw); let changed = false;
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
  next.revision++; return objectBindingsWriteData(raw, next);
}
export class SceneObjects {
  constructor(scene) { this.scene = scene; }
  list() { return getObjectBindings(this.scene); }
  get(target) { return this.list().bindings[objectKey(target)] ?? null; }
  save(target, patch, { expectedRevision, allowReassign = false } = {}) {
    if (patch.groupId === null && !getSceneObject(this.scene, target)) return this.remove(target, { expectedRevision });
    return withSceneLock(this.scene, async () => {
      requireGM(); const raw = this.list(), key = objectKey(target), previous = raw.bindings[key];
      if (!getSceneObject(this.scene, target)) fail("Объект сцены больше не существует.");
      if (expectedRevision !== undefined && raw.revision !== expectedRevision) fail("Привязки изменены другим окном. Обновите форму.");
      const next = normalizeObjectBinding({ ...previous, ...clone(patch), ...target });
      if (previous?.groupId !== next.groupId) {
        if (previous?.groupId && !allowReassign) fail("Подтвердите изменение владельца объекта.");
        if (getRuntimes(this.scene).some((run) => [previous?.groupId, next.groupId].includes(run.groupId) && run.runId && !run.halted)) fail("Перед сменой владельца остановите затронутые группы.");
        if (previous?.groupId) for (const [field, value] of Object.entries({ scripts: [], shops: [], dialogues: [], transitionScripts: {} })) if (!Object.hasOwn(patch, field)) next[field] = value;
      }
      if (!next.groupId) clearGroupContent(next);
      validateObjectBinding(this.scene, next);
      await this.scene.setFlag(MODULE_ID, "objectBindings", objectBindingsWriteData(raw, { ...raw, revision: raw.revision + 1, bindings: { ...raw.bindings, [key]: next } }));
      return clone(next);
    });
  }
  remove(target, { expectedRevision } = {}) {
    if (getSceneObject(this.scene, target)) return this.save(target, { groupId: null }, { expectedRevision, allowReassign: true });
    return withSceneLock(this.scene, async () => {
      requireGM(); const raw = this.list(), key = objectKey(target);
      if (expectedRevision !== undefined && raw.revision !== expectedRevision) fail("Привязки изменены другим окном. Обновите форму.");
      const next = clone(raw); delete next.bindings[key]; next.revision++;
      await this.scene.setFlag(MODULE_ID, "objectBindings", objectBindingsWriteData(raw, next)); return null;
    });
  }
}
export function resolveObjectTools(scene, target, context, kind) {
  const binding = getObjectBindings(scene).bindings[objectKey(target)];
  if (!binding?.groupId || binding.playerCharacter || binding.groupId !== context.groupId) return [];
  const assets = getInteractionCatalog(scene)[`${kind}s`];
  const seen = new Set();
  return binding[`${kind}s`].filter((ref) => !ref.stateIds.length || ref.stateIds.includes(context.stateId)).flatMap((reference) => {
    const asset = assets.find((entry) => entry.id === reference[`${kind}Id`]);
    if (!asset || seen.has(asset.id)) return [];
    seen.add(asset.id);
    const config = { ...clone(asset), enabled: true, [`${kind}Id`]: asset.id, target: { type: target.type, id: target.id }, range: reference.range, conditions: clone(reference.conditions) };
    if (kind === "dialogue") { config.startNodeId = asset.startPageId; config.nodes = asset.pages.map((page) => ({ ...page, responses: page.responses.map((response) => ({ ...response, nextNodeId: response.nextPageId })) })); }
    return [{ asset, binding, config }];
  });
}
export const resolveObjectShop = (scene, target, context, id) => resolveObjectTools(scene, target, context, "shop").find((entry) => id ? entry.asset.id === id : true) ?? null;
export const resolveObjectDialogue = (scene, target, context, id) => resolveObjectTools(scene, target, context, "dialogue").find((entry) => id ? entry.asset.id === id : true) ?? null;
export function materializeState(scene, definition, source) {
  const state = { ...clone(source), objects: [], scripts: [], transitions: [], shops: [], dialogues: [] };
  for (const binding of Object.values(getObjectBindings(scene).bindings)) {
    if (binding.groupId !== definition.groupId || binding.playerCharacter) continue;
    const target = { type: binding.type, id: binding.id };
    state.objects.push({ target });
    const script = binding.scripts.find((entry) => entry.stateId === source.id);
    if (script?.enabled) state.scripts.push({ ...clone(script), target });
    const transition = binding.transitionScripts[source.id];
    if (transition?.enabled) state.transitions.push({ ...clone(transition), target });
    for (const kind of ["shop", "dialogue"]) state[`${kind}s`].push(...resolveObjectTools(scene, target, { groupId: definition.groupId, stateId: source.id }, kind).map((entry) => entry.config));
  }
  return state;
}

/** Scoped exports carry current definitions; no conversion of previous formats. */
export function exportObjectConfiguration(scene, groupId, { stateId } = {}) {
  const bindings = Object.values(getObjectBindings(scene).bindings).filter((binding) => binding.groupId === groupId).map(clone);
  if (stateId) for (const binding of bindings) {
    binding.transitionScripts = binding.transitionScripts[stateId] ? { [stateId]: binding.transitionScripts[stateId] } : {};
    binding.scripts = binding.scripts.filter((script) => script.stateId === stateId);
    for (const kind of ["shops", "dialogues"]) binding[kind] = binding[kind].filter((ref) => !ref.stateIds.length || ref.stateIds.includes(stateId)).map((ref) => ({ ...ref, stateIds: [stateId] }));
  }
  const assets = getInteractionCatalog(scene), keys = new Set(bindings.map(objectKey));
  const interactionCatalog = { schemaVersion: 1, revision: 0, shops: assets.shops.filter((asset) => bindings.some((b) => b.shops.some((ref) => ref.shopId === asset.id))),
    dialogues: assets.dialogues.filter((asset) => bindings.some((b) => b.dialogues.some((ref) => ref.dialogueId === asset.id))) };
  keys.add(`Group:${groupId}`);
  for (const kind of ["shop", "dialogue"]) for (const asset of interactionCatalog[`${kind}s`]) keys.add(`${kind === "shop" ? "Shop" : "Dialogue"}:${asset.id}`);
  return { sourceSceneId: scene.id, sourceSceneUuid: scene.uuid ?? `Scene.${scene.id}`, interactionCatalog, objectBindings: { schemaVersion: 1, revision: 0, bindings: Object.fromEntries(bindings.map((b) => [objectKey(b), b])) },
    catalog: exportCatalogDependencies(scene, [...keys]) };
}
export function importObjectConfiguration(scene, source, { groupId, sourceGroupId, stateMapping = new Map(), definitions } = {}) {
  const current = getObjectBindings(scene), incoming = normalizeObjectBindings(source.objectBindings ?? {});
  const { catalog, mapping } = mergeInteractionAssets(scene, source.interactionCatalog ?? {}), next = clone(current);
  const emitterMapping = new Map([[`Group:${sourceGroupId}`, `Group:${groupId}`]]), idMapping = new Map();
  if (!validId(source.sourceSceneId)) fail("В JSON отсутствует ID исходной сцены.");
  for (const type of ["Scene", "Combat"]) emitterMapping.set(`${type}:${source.sourceSceneId}`, `${type}:${scene.id}`);
  for (const [from, to] of mapping) for (const kind of ["Shop", "Dialogue"]) emitterMapping.set(`${kind}:${from}`, `${kind}:${to}`);
  const flags = { groupDefinitions: Object.fromEntries(definitions.map((entry) => [entry.groupId, entry])), interactionCatalog: catalog, objectBindings: next };
  const staged = stageScene(scene, flags);
  const signalCatalog = mergeCatalogDependencies(staged, source.catalog ?? {}, { emitterMapping, idMapping });
  flags.signalCatalog = signalCatalog;
  for (const definition of definitions) if (definition.groupId === groupId) definition.states = remapSignalIds(definition.states, idMapping);
  for (const asset of catalog.dialogues) if ([...mapping.values()].includes(asset.id)) asset.pages = remapSignalIds(asset.pages, idMapping);
  const remap = (values) => values.map((id) => stateMapping.get(id) ?? id);
  for (const [key, original] of Object.entries(incoming.bindings)) {
    if (current.bindings[key]?.groupId && current.bindings[key].groupId !== groupId) fail(`Объект ${key} уже принадлежит другой группе.`);
    const binding = remapSignalIds(original, idMapping), previousGroup = binding.groupId; binding.groupId = groupId;
    binding.transitionScripts = Object.fromEntries(Object.entries(binding.transitionScripts).map(([id, script]) => [stateMapping.get(id) ?? id, script]));
    binding.scripts.forEach((script) => { script.stateId = stateMapping.get(script.stateId) ?? script.stateId; });
    for (const kind of ["shop", "dialogue"]) for (const ref of binding[`${kind}s`]) {
      ref[`${kind}Id`] = mapping.get(ref[`${kind}Id`]) ?? ref[`${kind}Id`]; ref.stateIds = remap(ref.stateIds);
      ref.conditions.stateIds = remap(ref.conditions.stateIds); ref.conditions.groupIds = ref.conditions.groupIds.map((id) => id === previousGroup ? groupId : id);
    }
    const existing = current.bindings[key];
    if (existing?.groupId === groupId) {
      const stateKeys = new Set(binding.scripts.map((script) => script.stateId));
      if (existing.scripts.some((script) => stateKeys.has(script.stateId))) fail(`Объект ${key} уже содержит скрипт импортируемого состояния.`);
      binding.scripts = [...existing.scripts, ...binding.scripts]; binding.transitionScripts = { ...existing.transitionScripts, ...binding.transitionScripts };
      binding.shops = [...existing.shops, ...binding.shops]; binding.dialogues = [...existing.dialogues, ...binding.dialogues];
      binding.initialScript = existing.initialScript; binding.tags = existing.tags; binding.notes = existing.notes; binding.playerCharacter = existing.playerCharacter;
    }
    next.bindings[key] = binding;
  }
  for (const binding of Object.values(incoming.bindings)) validateObjectBinding(staged, next.bindings[objectKey(binding)], definitions);
  next.revision++; return { signalCatalog, interactionCatalog: catalog, objectBindings: objectBindingsWriteData(current, next) };
}
