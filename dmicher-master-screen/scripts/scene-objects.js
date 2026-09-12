import { message as localizedMessage } from "./localization.js";
import { MODULE_ID } from "./model.js";
import { getDefinitions, getRuntimes, requireGM, withSceneLock } from "./store.js";
import { getInteractionCatalog, mergeInteractionAssets } from "./scene-assets.js";
import { getSignalCatalog, exportCatalogDependencies, mergeCatalogDependencies } from "./signal-catalog.js";
import { stageScene, remapStateSignals, remapDialogueSignals, remapBindingSignals } from "./configuration-transfer.js";
import { normalizeObjectBinding, normalizeObjectBindings, objectKey, validateBindingReferences, clearGroupContent, reconcileBindingGroups, resolveBindingTools, materializeStateDefinition } from "./object-binding-model.js";
import { interactionType } from "./interaction-model.js";
import { replacementFlagData } from "./scene-flags.js";
export { normalizeObjectBinding, normalizeObjectBindings, objectKey } from "./object-binding-model.js";
import { SCENE_OBJECT_COLLECTIONS as collections } from "./scene-object-types.js";
import { sceneObjectCenter } from "./scene-object-geometry.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export const getSceneObject = (scene, target) => Object.hasOwn(collections, target?.type) ? scene?.[collections[target.type]]?.get?.(target?.id) ?? null : null;
export function listNativeSceneObjects(scene) {
  return Object.entries(collections).flatMap(([type, collection]) => Array.from(scene?.[collection]?.values?.() ?? []).map((document) => ({
    type, id: document.id, key: `${type}:${document.id}`, name: String(document.name || document.text || document.label || document.id),
    uuid: document.uuid ?? `Scene.${scene.id}.${type}.${document.id}`,
    position: sceneObjectCenter(document, scene),
    hidden: typeof document.hidden === "boolean" ? document.hidden : null
  })));
}
export const getObjectBindings = (scene) => normalizeObjectBindings(scene?.getFlag(MODULE_ID, "objectBindings") ?? {});
export function getGroupObjects(scene, groupId) {
  const native = listNativeSceneObjects(scene);
  return Object.entries(getObjectBindings(scene).bindings).filter(([, b]) => b.groupId === groupId).map(([key, binding]) => ({
    ...(native.find((entry) => entry.key === key) ?? { type: binding.type, id: binding.id, key, name: binding.id, missing: true }), binding }));
}
export const assetReferences = (scene, kind, id) => Object.values(getObjectBindings(scene).bindings).filter((binding) => binding[interactionType(kind).collection].some((ref) => ref[interactionType(kind).referenceId] === id));
export function validateObjectBinding(scene, binding, definitions = getDefinitions(scene)) {
  const { signals, macros } = getSignalCatalog(scene);
  validateBindingReferences(binding, { definitions, signals, macros, assets: getInteractionCatalog(scene) });
}
export const objectBindingsWriteData = replacementFlagData;
export function reconcileDefinitionBindings(scene, previous, definitions) {
  const raw = getObjectBindings(scene), next = reconcileBindingGroups(raw, previous, definitions);
  return next ? objectBindingsWriteData(raw, next) : null;
}
export class SceneObjects {
  constructor(scene) { this.scene = scene; }
  list() { return getObjectBindings(this.scene); }
  get(target) { return this.list().bindings[objectKey(target)] ?? null; }
  save(target, patch, { expectedRevision, allowReassign = false } = {}) {
    if (patch.groupId === null && !getSceneObject(this.scene, target)) return this.remove(target, { expectedRevision });
    return withSceneLock(this.scene, async () => {
      requireGM(); const raw = this.list(), key = objectKey(target), previous = raw.bindings[key];
      if (!getSceneObject(this.scene, target)) fail(localizedMessage("Объект сцены больше не существует."));
      if (expectedRevision !== undefined && raw.revision !== expectedRevision) fail(localizedMessage("Привязки изменены другим окном. Обновите форму."));
      const next = normalizeObjectBinding({ ...previous, ...clone(patch), ...target });
      if (previous?.groupId !== next.groupId) {
        if (previous?.groupId && !allowReassign) fail(localizedMessage("Подтвердите изменение владельца объекта."));
        if (getRuntimes(this.scene).some((run) => [previous?.groupId, next.groupId].includes(run.groupId) && run.runId && !run.halted)) fail(localizedMessage("Перед сменой владельца остановите затронутые группы."));
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
      if (expectedRevision !== undefined && raw.revision !== expectedRevision) fail(localizedMessage("Привязки изменены другим окном. Обновите форму."));
      const next = clone(raw); delete next.bindings[key]; next.revision++;
      await this.scene.setFlag(MODULE_ID, "objectBindings", objectBindingsWriteData(raw, next)); return null;
    });
  }
}
export function resolveObjectTools(scene, target, context, kind) {
  return resolveBindingTools(getObjectBindings(scene).bindings[objectKey(target)], getInteractionCatalog(scene), context, kind);
}
export const resolveObjectShop = (scene, target, context, id) => resolveObjectTools(scene, target, context, "shop").find((entry) => id ? entry.asset.id === id : true) ?? null;
export const resolveObjectDialogue = (scene, target, context, id) => resolveObjectTools(scene, target, context, "dialogue").find((entry) => id ? entry.asset.id === id : true) ?? null;
/** Read catalogs once so every object in the runtime snapshot uses the same preparation. */
export function materializeState(scene, definition, source) {
  return materializeStateDefinition(getObjectBindings(scene).bindings, getInteractionCatalog(scene), definition, source);
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
  if (!validId(source.sourceSceneId)) fail(localizedMessage("В JSON отсутствует ID исходной сцены."));
  for (const type of ["Scene", "Combat"]) emitterMapping.set(`${type}:${source.sourceSceneId}`, `${type}:${scene.id}`);
  for (const [from, to] of mapping) emitterMapping.set(from, `${from.split(":")[0]}:${to}`);
  const flags = { groupDefinitions: Object.fromEntries(definitions.map((entry) => [entry.groupId, entry])), interactionCatalog: catalog, objectBindings: next };
  const staged = stageScene(scene, flags);
  const signalCatalog = mergeCatalogDependencies(staged, source.catalog ?? {}, { emitterMapping, idMapping });
  flags.signalCatalog = signalCatalog;
  for (const definition of definitions) if (definition.groupId === groupId) definition.states = remapStateSignals(definition.states, idMapping);
  const importedDialogueIds = new Set([...mapping].filter(([key]) => key.startsWith("Dialogue:")).map(([, id]) => id));
  catalog.dialogues = catalog.dialogues.map((asset) => importedDialogueIds.has(asset.id) ? remapDialogueSignals(asset, idMapping) : asset);
  const remap = (values) => values.map((id) => stateMapping.get(id) ?? id);
  for (const [key, original] of Object.entries(incoming.bindings)) {
    if (current.bindings[key]?.groupId && current.bindings[key].groupId !== groupId) fail(localizedMessage("Объект {0} уже принадлежит другой группе.", [key]));
    const binding = remapBindingSignals(original, idMapping), previousGroup = binding.groupId; binding.groupId = groupId;
    binding.transitionScripts = Object.fromEntries(Object.entries(binding.transitionScripts).map(([id, script]) => [stateMapping.get(id) ?? id, script]));
    binding.scripts.forEach((script) => { script.stateId = stateMapping.get(script.stateId) ?? script.stateId; });
    for (const kind of ["shop", "dialogue"]) for (const ref of binding[`${kind}s`]) {
      ref[`${kind}Id`] = mapping.get(`${interactionType(kind).emitterType}:${ref[`${kind}Id`]}`) ?? ref[`${kind}Id`]; ref.stateIds = remap(ref.stateIds);
      ref.conditions.stateIds = remap(ref.conditions.stateIds); ref.conditions.groupIds = ref.conditions.groupIds.map((id) => id === previousGroup ? groupId : id);
    }
    const existing = current.bindings[key];
    if (existing?.groupId === groupId) {
      const stateKeys = new Set(binding.scripts.map((script) => script.stateId));
      if (existing.scripts.some((script) => stateKeys.has(script.stateId))) fail(localizedMessage("Объект {0} уже содержит скрипт импортируемого состояния.", [key]));
      binding.scripts = [...existing.scripts, ...binding.scripts]; binding.transitionScripts = { ...existing.transitionScripts, ...binding.transitionScripts };
      binding.shops = [...existing.shops, ...binding.shops]; binding.dialogues = [...existing.dialogues, ...binding.dialogues];
      binding.initialScript = existing.initialScript; binding.tags = existing.tags; binding.notes = existing.notes; binding.playerCharacter = existing.playerCharacter;
    }
    next.bindings[key] = binding;
  }
  for (const binding of Object.values(incoming.bindings)) validateObjectBinding(staged, next.bindings[objectKey(binding)], definitions);
  next.revision++; return { signalCatalog, interactionCatalog: catalog, objectBindings: objectBindingsWriteData(current, next) };
}
