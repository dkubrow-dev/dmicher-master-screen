import { MODULE_ID, normalizeTrigger, normalizeTags, randomId } from "./model.js";
import { getDefinitions, getRuntimes, requireGM, withSceneLock } from "./store.js";
import { getInteractionCatalog, mergeInteractionAssets } from "./scene-assets.js";
import { getEventCatalog, validateTypedTrigger, exportCatalogDependencies } from "./event-catalog.js";
import { normalizeRoutines } from "./routine-model.js";

const clone = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const collections = Object.freeze({ Token: "tokens", Tile: "tiles", Drawing: "drawings", AmbientLight: "lights", AmbientSound: "sounds", Note: "notes", MeasuredTemplate: "templates", Wall: "walls", Region: "regions" });
const validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export function objectKey({ type, id }) { if (!collections[type] || !validId(id)) fail("Неверный тип или ID объекта сцены."); return `${type}:${id}`; }
export const getSceneObject = (scene, descriptor) => scene?.[collections[descriptor?.type]]?.get?.(descriptor?.id) ?? null;
export function listNativeSceneObjects(scene) {
  return Object.entries(collections).flatMap(([type, collection]) => Array.from(scene?.[collection]?.values?.() ?? []).map((document) => ({
    type, id: document.id, key: `${type}:${document.id}`, name: String(document.name || document.text || document.label || document.id),
    uuid: document.uuid ?? `Scene.${scene.id}.${type}.${document.id}`, position: Number.isFinite(document.x) && Number.isFinite(document.y) ? { x: document.x, y: document.y } : null,
    hidden: typeof document.hidden === "boolean" ? document.hidden : null
  })));
}
const ids = (value) => { if (!Array.isArray(value) || value.length > 100 || value.some((entry) => !validId(entry))) fail("Ожидается список ID эпизодов."); return [...new Set(value)]; };
const transition = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Ожидаются настройки перехода объекта.");
  if (value.position != null && (!Number.isFinite(value.position.x) || !Number.isFinite(value.position.y))) fail("Положение объекта задаётся конечными координатами x и y.");
  if (value.hidden != null && typeof value.hidden !== "boolean") fail("Видимость должна быть логическим значением.");
  return { position: value.position ? { x: value.position.x, y: value.position.y } : null, hidden: value.hidden ?? null };
};
function featureBinding(value, kind) {
  if (value == null) return null;
  const key = `${kind}Id`;
  if (!validId(value[key])) fail("Выберите инструмент из каталога.");
  const range = value.range ?? 5;
  if (typeof range !== "number" || !Number.isFinite(range) || range < 0 || range > 100000) fail("Дальность должна быть числом от 0 до 100000.");
  return { [key]: value[key], episodeIds: ids(value.episodeIds ?? []), range, trigger: normalizeTrigger(value.trigger) };
}
const featureKinds = new Set(["macro", "trigger"]);
function normalizeFeature(raw) {
  if (!raw || !featureKinds.has(raw.kind)) fail("Неизвестная особенность объекта.");
  const id = raw.id || randomId(); if (!validId(id)) fail("Неверный ID особенности.");
  if (raw.parameters != null && (typeof raw.parameters !== "object" || Array.isArray(raw.parameters) || JSON.stringify(raw.parameters).length > 8000)) fail("Параметры вызова должны быть JSON объектом до 8000 символов.");
  return { id, kind: raw.kind, enabled: raw.enabled !== false, episodeIds: ids(raw.episodeIds ?? []), eventName: String(raw.eventName ?? "").trim(),
    macroUuid: String(raw.macroUuid ?? ""), triggerId: String(raw.triggerId ?? ""), parameters: clone(raw.parameters ?? {}) };
}
export function normalizeObjectBinding(raw) {
  objectKey(raw);
  if (raw.schemeId != null && !validId(raw.schemeId)) fail("Неверный ID схемы объекта.");
  if (raw.playerCharacter !== undefined && typeof raw.playerCharacter !== "boolean") fail("Флаг персонажа игрока должен быть логическим значением.");
  if (typeof (raw.notes ?? "") !== "string" || [...(raw.notes ?? "")].length > 12000) fail("Заметки мастера должны быть текстом до 12000 символов.");
  const episodes = Object.fromEntries(Object.entries(raw.episodes ?? {}).filter(([key, value]) => !(key.startsWith("-=") && value === null)));
  if (!episodes || typeof episodes !== "object" || Array.isArray(episodes) || Object.keys(episodes).some((key) => !validId(key))) fail("Неверные настройки эпизодов объекта.");
  if (!Array.isArray(raw.features ?? []) || (raw.features?.length ?? 0) > 100) fail("Допустимо до 100 особенностей объекта.");
  // Read only supported features. Unrecognized definitions are not converted or
  // executed and must not hide an object's current routine or block its editor.
  const features = (raw.features ?? []).filter((feature) => featureKinds.has(feature?.kind)).map(normalizeFeature);
  if (new Set(features.map((entry) => entry.id)).size !== features.length) fail("ID особенностей не должны повторяться.");
  if (raw.routines !== undefined && !Array.isArray(raw.routines)) fail("Распорядки должны быть списком.");
  return { type: raw.type, id: raw.id, schemeId: raw.schemeId ?? null, playerCharacter: raw.playerCharacter ?? false, tags: normalizeTags(raw.tags), notes: raw.notes ?? "",
    entry: transition(raw.entry), episodes: Object.fromEntries(Object.entries(episodes).map(([key, value]) => [key, transition(value)])),
    shop: featureBinding(raw.shop, "shop"), dialogue: featureBinding(raw.dialogue, "dialogue"), features,
    routines: normalizeRoutines(raw.routines ?? []) };
}
export function normalizeObjectBindings(raw = {}) {
  if (!raw || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) || !raw.bindings && raw.bindings !== undefined) fail("Неверные привязки объектов сцены.");
  const entries = Object.entries(raw.bindings ?? {}).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.length > 5000) fail("Допустимо до 5000 привязок объектов.");
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, bindings: Object.fromEntries(entries.map(([key, value]) => {
    if (key !== objectKey(value)) fail("Ключ привязки не соответствует объекту."); return [key, normalizeObjectBinding(value)];
  })) };
}
/** Definitions, tags and ownership have one explicit source; reads perform no migration. */
export function getObjectBindings(scene) {
  return normalizeObjectBindings(scene?.getFlag(MODULE_ID, "objectBindings") ?? {});
}
export function getSchemeObjects(scene, schemeId) {
  const entries = getObjectBindings(scene).bindings, native = listNativeSceneObjects(scene);
  return Object.entries(entries).filter(([, value]) => value.schemeId === schemeId).map(([key, binding]) => ({ ...(native.find((entry) => entry.key === key) ?? { type: binding.type, id: binding.id, key, name: binding.id, missing: true }), binding }));
}
export function assetReferences(scene, kind, assetId) {
  return Object.values(getObjectBindings(scene).bindings).filter((binding) => binding[kind]?.[`${kind}Id`] === assetId);
}
export function validateObjectBinding(scene, binding, definitions = getDefinitions(scene)) {
  const definition = definitions.find((entry) => entry.schemeId === binding.schemeId);
  if (binding.schemeId && !definition) fail("Назначенная схема больше не существует.");
  if (!binding.schemeId && (binding.shop || binding.dialogue || binding.features.length || binding.routines.length || Object.keys(binding.episodes).length)) fail("Сначала назначьте объект схеме.");
  if (binding.playerCharacter && binding.type !== "Token") fail("Персонажем игрока может быть только токен.");
  const episodeIds = new Set(definition?.episodes.map((entry) => entry.id) ?? []), catalog = getInteractionCatalog(scene), events = getEventCatalog(scene);
  const checkEpisodes = (values) => { if (values.some((id) => !episodeIds.has(id))) fail("Настройка объекта ссылается на отсутствующий эпизод его схемы."); };
  checkEpisodes(Object.keys(binding.episodes));
  if (binding.routines.length && binding.type !== "Token") fail("Распорядок доступен только токену.");
  for (const routine of binding.routines) {
    checkEpisodes([routine.episodeId]);
    for (const step of routine.steps) {
      const p = step.parameters;
      if (step.kind === "event") {
        const event = events.events.find((entry) => entry.name === p.eventName), trigger = events.triggers.find((entry) => entry.id === p.triggerId);
        if (!event || !trigger || trigger.eventId !== event.id) fail("Шаг распорядка должен ссылаться на событие и его тип триггера.");
        validateTypedTrigger(events, event, { ...p.parameters, type: trigger.name });
      }
      if (step.kind === "macro" && !events.macros.some((entry) => entry.uuid === p.macroUuid)) fail("Макрос распорядка должен быть добавлен в каталог Ширмы.");
    }
  }
  for (const kind of ["shop", "dialogue"]) if (binding[kind]) {
    const reference = binding[kind];
    if (!["Token", "Tile"].includes(binding.type)) fail("Магазины и диалоги доступны для токенов и тайлов.");
    if (!catalog[kind === "shop" ? "shops" : "dialogues"].some((entry) => entry.id === reference[`${kind}Id`])) fail("Выбранный инструмент больше не существует.");
    checkEpisodes(reference.episodeIds);
    if (reference.trigger.schemeIds.some((id) => id !== binding.schemeId)) fail("Допуск объекта не может ссылаться на чужую схему.");
    checkEpisodes(reference.trigger.episodeIds);
  }
  for (const feature of binding.features) {
    checkEpisodes(feature.episodeIds);
    if (!events.events.some((event) => event.name === feature.eventName)) fail("Выберите существующее событие для особенности.");
    if (feature.kind === "macro" && !events.macros.some((macro) => macro.uuid === feature.macroUuid)) fail("Макрос должен быть добавлен в каталог Ширмы.");
    if (feature.kind === "trigger") {
      const trigger = events.triggers.find((entry) => entry.id === feature.triggerId), event = events.events.find((entry) => entry.id === trigger?.eventId);
      if (!event) fail("Выберите существующий тип триггера.");
      validateTypedTrigger(events, event, { ...feature.parameters, type: trigger.name });
    }
  }
  const document = getSceneObject(scene, binding);
  if (document && [...Object.values(binding.episodes), binding.entry].some((value) => value.position) && (!Number.isFinite(document.x) || !Number.isFinite(document.y))) fail("Этот тип объекта не поддерживает положение x/y.");
}
/** Foundry recursively merges flag objects; explicit deletion markers remove map keys. */
export function objectBindingsWriteData(previous, next) {
  const data = clone(next);
  for (const [key, old] of Object.entries(previous.bindings)) {
    if (!data.bindings[key]) { data.bindings[`-=${key}`] = null; continue; }
    for (const episodeId of Object.keys(old.episodes)) if (!Object.hasOwn(data.bindings[key].episodes, episodeId)) data.bindings[key].episodes[`-=${episodeId}`] = null;
  }
  return data;
}
export function reconcileDefinitionBindings(scene, previous, definitions) {
  const raw = normalizeObjectBindings(scene?.getFlag(MODULE_ID, "objectBindings") ?? {}), next = clone(raw);
  let changed = false;
  for (const binding of Object.values(next.bindings)) {
    if (!binding.schemeId) continue;
    const definition = definitions.find((entry) => entry.schemeId === binding.schemeId);
    if (!definition) { binding.schemeId = null; binding.shop = null; binding.dialogue = null; binding.features = []; binding.routines = []; binding.episodes = {}; binding.entry = transition(); changed = true; continue; }
    const removed = previous.find((entry) => entry.schemeId === binding.schemeId)?.episodes.filter((entry) => !definition.episodes.some((value) => value.id === entry.id)).map((entry) => entry.id) ?? [];
    if (!removed.length) continue;
    changed = true;
    for (const id of removed) delete binding.episodes[id];
    binding.routines = binding.routines.filter((entry) => !removed.includes(entry.episodeId));
    for (const kind of ["shop", "dialogue"]) if (binding[kind]) {
      const reference = binding[kind];
      if (reference.episodeIds.length && reference.episodeIds.every((id) => removed.includes(id))) { binding[kind] = null; continue; }
      reference.episodeIds = reference.episodeIds.filter((id) => !removed.includes(id));
      if (reference.trigger.episodeIds.length && reference.trigger.episodeIds.every((id) => removed.includes(id))) reference.trigger.enabled = false;
      reference.trigger.episodeIds = reference.trigger.episodeIds.filter((id) => !removed.includes(id));
    }
    for (const feature of binding.features) {
      if (feature.episodeIds.length && feature.episodeIds.every((id) => removed.includes(id))) feature.enabled = false;
      feature.episodeIds = feature.episodeIds.filter((id) => !removed.includes(id));
    }
  }
  if (changed) { next.revision++; return objectBindingsWriteData(raw, next); }
  return null;
}

export function exportObjectConfiguration(scene, schemeId, { episodeId } = {}) {
  const bindings = Object.values(getObjectBindings(scene).bindings).filter((binding) => binding.schemeId === schemeId).map((value) => normalizeObjectBinding(value));
  if (episodeId) for (const binding of bindings) {
    binding.episodes = binding.episodes[episodeId] ? { [episodeId]: binding.episodes[episodeId] } : {};
    for (const kind of ["shop", "dialogue"]) if (binding[kind]) {
      if (binding[kind].episodeIds.length && !binding[kind].episodeIds.includes(episodeId)
        || binding[kind].trigger.episodeIds.length && !binding[kind].trigger.episodeIds.includes(episodeId)) binding[kind] = null;
      else { binding[kind].episodeIds = [episodeId]; if (binding[kind].trigger.episodeIds.length) binding[kind].trigger.episodeIds = [episodeId]; }
    }
    binding.features = binding.features.filter((entry) => !entry.episodeIds.length || entry.episodeIds.includes(episodeId)).map((entry) => ({ ...entry, episodeIds: [episodeId] }));
    binding.routines = binding.routines.filter((entry) => entry.episodeId === episodeId);
  }
  const assets = getInteractionCatalog(scene), eventCatalog = getEventCatalog(scene), names = [];
  const related = (kind, assetId) => bindings.some((binding) => binding[kind]?.[`${kind}Id`] === assetId);
  const interactionCatalog = { schemaVersion: 1, revision: 0, shops: assets.shops.filter((entry) => related("shop", entry.id)), dialogues: assets.dialogues.filter((entry) => related("dialogue", entry.id)) };
  for (const dialogue of interactionCatalog.dialogues) for (const page of dialogue.pages) for (const response of page.responses) if (response.eventName) names.push(response.eventName);
  const macroIds = new Set();
  for (const binding of bindings) for (const routine of binding.routines) for (const step of routine.steps) {
    if (step.kind === "event") names.push(step.parameters.eventName);
    if (step.kind === "macro") macroIds.add(step.parameters.macroUuid);
  }
  for (const binding of bindings) for (const feature of binding.features) {
    if (feature.eventName) names.push(feature.eventName);
    if (feature.kind === "macro") {
      macroIds.add(feature.macroUuid);
      for (const id of eventCatalog.macros.find((entry) => entry.uuid === feature.macroUuid)?.triggerIds ?? []) {
        const trigger = eventCatalog.triggers.find((entry) => entry.id === id), event = eventCatalog.events.find((entry) => entry.id === trigger?.eventId);
        if (event) names.push(event.name);
      }
    }
    if (feature.kind === "trigger") {
      const trigger = eventCatalog.triggers.find((entry) => entry.id === feature.triggerId), event = eventCatalog.events.find((entry) => entry.id === trigger?.eventId);
      if (event) names.push(event.name);
    }
  }
  for (const macro of eventCatalog.macros) if (macroIds.has(macro.uuid)) for (const id of macro.triggerIds) {
    const trigger = eventCatalog.triggers.find((entry) => entry.id === id), event = eventCatalog.events.find((entry) => entry.id === trigger?.eventId);
    if (event) names.push(event.name);
  }
  const catalog = exportCatalogDependencies(scene, [{ events: names }]);
  for (const macro of eventCatalog.macros) if (macroIds.has(macro.uuid) && !catalog.macros.some((entry) => entry.uuid === macro.uuid)) catalog.macros.push(clone(macro));
  return { interactionCatalog, objectBindings: { schemaVersion: 1, revision: 0, bindings: Object.fromEntries(bindings.map((entry) => [objectKey(entry), entry])) }, catalog };
}

export function importObjectConfiguration(scene, source, { schemeId, episodeMapping = new Map(), definitions, eventCatalog, sourceEventCatalog } = {}) {
  if (!source?.objectBindings && !source?.interactionCatalog) return {};
  const current = normalizeObjectBindings(scene.getFlag(MODULE_ID, "objectBindings") ?? {}), projected = getObjectBindings(scene).bindings;
  const incoming = normalizeObjectBindings(source.objectBindings ?? {}), { catalog, mapping } = mergeInteractionAssets(scene, source.interactionCatalog ?? {});
  const next = clone(current);
  const remap = (values) => values.map((id) => episodeMapping.get(id) ?? id);
  for (const [key, raw] of Object.entries(incoming.bindings)) {
    if (projected[key]?.schemeId && projected[key].schemeId !== schemeId) fail(`Объект ${key} уже принадлежит другой схеме. Импорт не меняет владельца автоматически.`);
    const binding = clone(raw), previousScheme = binding.schemeId;
    binding.schemeId = schemeId;
    binding.episodes = Object.fromEntries(Object.entries(binding.episodes).map(([id, value]) => [episodeMapping.get(id) ?? id, value]));
    for (const kind of ["shop", "dialogue"]) if (binding[kind]) {
      const entry = binding[kind]; entry[`${kind}Id`] = mapping.get(entry[`${kind}Id`]) ?? entry[`${kind}Id`]; entry.episodeIds = remap(entry.episodeIds);
      entry.trigger.episodeIds = remap(entry.trigger.episodeIds); entry.trigger.schemeIds = entry.trigger.schemeIds.map((id) => id === previousScheme ? schemeId : id);
    }
    for (const feature of binding.features) {
      feature.episodeIds = remap(feature.episodeIds);
      const sourceTrigger = sourceEventCatalog?.triggers?.find((entry) => entry.id === feature.triggerId);
      if (sourceTrigger) feature.triggerId = eventCatalog.triggers.find((entry) => entry.name === sourceTrigger.name)?.id ?? feature.triggerId;
    }
    for (const routine of binding.routines) {
      routine.episodeId = episodeMapping.get(routine.episodeId) ?? routine.episodeId;
      for (const step of routine.steps) if (step.kind === "event") {
        const trigger = sourceEventCatalog?.triggers?.find((entry) => entry.id === step.parameters.triggerId);
        if (trigger) step.parameters.triggerId = eventCatalog.triggers.find((entry) => entry.name === trigger.name)?.id ?? step.parameters.triggerId;
      }
    }
    const existing = current.bindings[key];
    if (existing?.schemeId === schemeId) {
      for (const kind of ["shop", "dialogue"]) {
        if (existing[kind] && binding[kind] && existing[kind][`${kind}Id`] !== binding[kind][`${kind}Id`]) fail(`Объект ${key} уже использует другой ${kind}. Выберите привязку вручную.`);
        if (!binding[kind]) binding[kind] = clone(existing[kind]);
        else if (existing[kind]) {
          const content = ({ episodeIds, trigger: { episodeIds: scoped, ...trigger }, ...value }) => ({ ...value, trigger });
          if (JSON.stringify(content(existing[kind])) !== JSON.stringify(content(binding[kind]))) fail(`У объекта ${key} отличаются условия ${kind}. Согласуйте их перед импортом.`);
          const union = (a, b) => !a.length || !b.length ? [] : [...new Set([...a, ...b])];
          binding[kind].episodeIds = union(existing[kind].episodeIds, binding[kind].episodeIds);
          binding[kind].trigger.episodeIds = union(existing[kind].trigger.episodeIds, binding[kind].trigger.episodeIds);
        }
      }
      binding.entry = clone(existing.entry); binding.tags = clone(existing.tags); binding.notes = existing.notes; binding.playerCharacter = existing.playerCharacter;
      binding.episodes = { ...existing.episodes, ...binding.episodes };
      const features = clone(existing.features);
      for (const feature of binding.features) {
        const match = features.find((entry) => entry.id === feature.id);
        const content = ({ episodeIds, ...value }) => value;
        if (match && JSON.stringify(content(match)) === JSON.stringify(content(feature))) {
          match.episodeIds = !match.episodeIds.length || !feature.episodeIds.length ? [] : [...new Set([...match.episodeIds, ...feature.episodeIds])];
        } else features.push({ ...feature, id: match ? randomId() : feature.id });
      }
      binding.features = features;
      const routines = clone(existing.routines);
      for (const routine of binding.routines) {
        const previous = routines.find((entry) => entry.episodeId === routine.episodeId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(routine)) fail(`У объекта ${key} уже есть другой распорядок этого эпизода.`);
        if (!previous) routines.push(routine);
      }
      binding.routines = routines;
    }
    next.bindings[key] = binding;
  }
  next.revision++;
  const staged = Object.create(scene);
  staged.getFlag = (scope, key) => scope !== MODULE_ID ? scene.getFlag(scope, key) : key === "objectBindings" ? next : key === "interactionCatalog" ? catalog
    : key === "definitions" ? Object.fromEntries(definitions.map((entry) => [entry.schemeId, entry])) : key === "eventCatalog" ? eventCatalog : scene.getFlag(scope, key);
  for (const binding of Object.values(incoming.bindings)) validateObjectBinding(staged, next.bindings[objectKey(binding)], definitions);
  return { interactionCatalog: catalog, objectBindings: objectBindingsWriteData(current, next) };
}
export class SceneObjects {
  constructor(scene) { this.scene = scene; }
  list() { return getObjectBindings(this.scene); }
  get(descriptor) { return this.list().bindings[objectKey(descriptor)] ?? null; }
  save(descriptor, patch, { expectedRevision, allowReassign = false } = {}) {
    if (patch.schemeId === null && !getSceneObject(this.scene, descriptor)) return this.remove(descriptor, { expectedRevision });
    return withSceneLock(this.scene, async () => {
      requireGM(); const raw = normalizeObjectBindings(this.scene.getFlag(MODULE_ID, "objectBindings") ?? {}), key = objectKey(descriptor), previous = this.get(descriptor);
      if (!getSceneObject(this.scene, descriptor)) fail("Объект сцены больше не существует.");
      if (expectedRevision !== undefined && raw.revision !== expectedRevision) fail("Привязки объектов изменены другим окном. Обновите форму.");
      const authored = clone(patch);
      const next = normalizeObjectBinding({ ...previous, ...authored, ...descriptor });
      const changingOwner = previous?.schemeId !== next.schemeId;
      if (changingOwner && previous?.schemeId && !allowReassign) fail("Подтвердите изменение владельца объекта.");
      if (changingOwner && getRuntimes(this.scene).some((runtime) => [previous?.schemeId, next.schemeId].includes(runtime.schemeId) && runtime.runId && !runtime.halted && !runtime.episode?.stop)) fail("Перед сменой владельца остановите автоматизацию затронутых схем.");
      // A scope change cannot interpret old episode IDs in a different scheme.
      // Preserve descriptive data; only explicitly supplied new preparation survives.
      if (changingOwner && previous?.schemeId) {
        for (const [field, fallback] of Object.entries({ shop: null, dialogue: null, features: [], routines: [], episodes: {}, entry: transition() })) if (!Object.hasOwn(patch, field)) next[field] = fallback;
      }
      if (!next.schemeId) { next.shop = null; next.dialogue = null; next.features = []; next.routines = []; next.episodes = {}; next.entry = transition(); }
      validateObjectBinding(this.scene, next);
      await this.scene.setFlag(MODULE_ID, "objectBindings", objectBindingsWriteData(raw, { ...raw, revision: raw.revision + 1, bindings: { ...raw.bindings, [key]: next } }));
      return clone(next);
    });
  }
  remove(descriptor, options = {}) {
    if (getSceneObject(this.scene, descriptor)) return this.save(descriptor, { schemeId: null }, { ...options, allowReassign: true });
    return withSceneLock(this.scene, async () => {
      requireGM(); const raw = normalizeObjectBindings(this.scene.getFlag(MODULE_ID, "objectBindings") ?? {}), key = objectKey(descriptor);
      if (options.expectedRevision !== undefined && raw.revision !== options.expectedRevision) fail("Привязки объектов изменены другим окном. Обновите форму.");
      const next = clone(raw);
      delete next.bindings[key]; next.revision++;
      const fields = { objectBindings: objectBindingsWriteData(raw, next) };
      if (this.scene.update) await this.scene.update(Object.fromEntries(Object.entries(fields).map(([field, value]) => [`flags.${MODULE_ID}.${field}`, value])));
      else for (const [field, value] of Object.entries(fields)) await this.scene.setFlag(MODULE_ID, field, value);
      return null;
    });
  }
}

function resolved(scene, descriptor, context, kind) {
  const binding = getObjectBindings(scene).bindings[objectKey(descriptor)];
  if (!binding || binding.playerCharacter || !binding.schemeId || binding.schemeId !== context.schemeId) return null;
  const reference = binding[kind];
  if (!reference || reference.episodeIds.length && !reference.episodeIds.includes(context.episodeId)) return null;
  const asset = getInteractionCatalog(scene)[kind === "shop" ? "shops" : "dialogues"].find((entry) => entry.id === reference[`${kind}Id`]);
  if (!asset) return null;
  const config = { ...clone(asset), enabled: true, [`${kind}Id`]: asset.id, target: { type: descriptor.type, id: descriptor.id }, range: reference.range, trigger: clone(reference.trigger) };
  if (kind === "dialogue") { config.startNodeId = asset.startPageId; config.nodes = asset.pages.map((page) => ({ ...page, responses: page.responses.map((response) => ({ ...response, nextNodeId: response.nextPageId })) })); }
  return { asset, binding, config };
}
export const resolveObjectShop = (scene, descriptor, context) => resolved(scene, descriptor, context, "shop");
export const resolveObjectDialogue = (scene, descriptor, context) => resolved(scene, descriptor, context, "dialogue");
/** A new execution snapshot combines preparation with the current catalog once. */
export function materializeEpisode(scene, definition, source) {
  const episode = clone(source), bindings = getObjectBindings(scene).bindings, context = { schemeId: definition.schemeId, episodeId: source.id };
  episode.tokens = {}; episode.shops = []; episode.dialogues = []; episode.objects = []; episode.routines = []; episode.subscriptions = [];
  episode.interactions = episode.interactions.filter((entry) => validId(entry.target?.id) && bindings[objectKey(entry.target)]?.schemeId === definition.schemeId && !bindings[objectKey(entry.target)]?.playerCharacter);
  for (const binding of Object.values(bindings)) {
    if (binding.playerCharacter || binding.schemeId !== definition.schemeId) continue;
    const target = { type: binding.type, id: binding.id };
    if (target.type === "Token") episode.tokens[target.id] = { enabled: true };
    const routine = binding.routines.find((entry) => entry.episodeId === source.id);
    if (routine) episode.routines.push({ ...clone(routine), target });
    episode.objects.push({ target, entry: clone(binding.entry), transition: clone(binding.episodes[source.id] ?? transition()) });
    const shop = resolveObjectShop(scene, target, context), dialogue = resolveObjectDialogue(scene, target, context);
    if (shop) episode.shops.push(shop.config);
    if (dialogue) episode.dialogues.push(dialogue.config);
    for (const feature of binding.features) {
      if (!feature.enabled || feature.episodeIds.length && !feature.episodeIds.includes(source.id)) continue;
      episode.subscriptions.push({ id: 'object-' + binding.type + '-' + binding.id + '-' + feature.id, featureId: feature.id, target,
        enabled: true, event: feature.eventName, kind: feature.kind, macroUuid: feature.macroUuid, triggerId: feature.triggerId, parameters: clone(feature.parameters) });
    }
  }
  return episode;
}
