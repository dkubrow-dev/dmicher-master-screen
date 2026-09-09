import { MODULE_ID, defaultTokenBehavior, normalizeTokenBehavior, normalizeTrigger, normalizeTags, randomId } from "./model.js";
import { getDefinitions, getRuntimes, requireGM, withSceneLock } from "./store.js";
import { getInteractionCatalog, legacyInteractions, mergeInteractionAssets } from "./scene-assets.js";
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
function normalizeFeature(raw) {
  if (!raw || !["patrol", "macro", "trigger"].includes(raw.kind)) fail("Неизвестная особенность объекта.");
  const id = raw.id || randomId(); if (!validId(id)) fail("Неверный ID особенности.");
  if (raw.parameters != null && (typeof raw.parameters !== "object" || Array.isArray(raw.parameters) || JSON.stringify(raw.parameters).length > 8000)) fail("Параметры вызова должны быть JSON объектом до 8000 символов.");
  return { id, kind: raw.kind, enabled: raw.enabled !== false, episodeIds: ids(raw.episodeIds ?? []), eventName: String(raw.eventName ?? "").trim(),
    macroUuid: String(raw.macroUuid ?? ""), triggerId: String(raw.triggerId ?? ""), parameters: clone(raw.parameters ?? {}),
    patrol: normalizeTokenBehavior({ patrol: { ...raw.patrol, enabled: true } }).patrol };
}
export function normalizeObjectBinding(raw) {
  objectKey(raw);
  if (raw.schemeId != null && !validId(raw.schemeId)) fail("Неверный ID схемы объекта.");
  if (raw.playerCharacter !== undefined && typeof raw.playerCharacter !== "boolean") fail("Флаг персонажа игрока должен быть логическим значением.");
  if (typeof (raw.notes ?? "") !== "string" || [...(raw.notes ?? "")].length > 12000) fail("Заметки мастера должны быть текстом до 12000 символов.");
  const episodes = Object.fromEntries(Object.entries(raw.episodes ?? {}).filter(([key, value]) => !(key.startsWith("-=") && value === null)));
  if (!episodes || typeof episodes !== "object" || Array.isArray(episodes) || Object.keys(episodes).some((key) => !validId(key))) fail("Неверные настройки эпизодов объекта.");
  if (!Array.isArray(raw.features ?? []) || (raw.features?.length ?? 0) > 100) fail("Допустимо до 100 особенностей объекта.");
  const features = (raw.features ?? []).map(normalizeFeature);
  if (new Set(features.map((entry) => entry.id)).size !== features.length) fail("ID особенностей не должны повторяться.");
  const legacyVariants = (raw.legacyVariants ?? []).map((entry) => {
    if (!["shop", "dialogue"].includes(entry.kind) || !validId(entry.assetId) || !validId(entry.episodeId)) fail("Некорректная ссылка старой настройки взаимодействия.");
    return { kind: entry.kind, assetId: entry.assetId, episodeId: entry.episodeId, localId: String(entry.localId ?? ""), enabled: entry.enabled !== false,
      ...featureBinding({ [`${entry.kind}Id`]: entry.assetId, range: entry.range, trigger: entry.trigger }, entry.kind) };
  });
  if (raw.routines !== undefined && !Array.isArray(raw.routines)) fail("Распорядки должны быть списком.");
  return { type: raw.type, id: raw.id, schemeId: raw.schemeId ?? null, playerCharacter: raw.playerCharacter ?? false, tags: normalizeTags(raw.tags), notes: raw.notes ?? "",
    entry: transition(raw.entry), episodes: Object.fromEntries(Object.entries(episodes).map(([key, value]) => [key, transition(value)])),
    shop: featureBinding(raw.shop, "shop"), dialogue: featureBinding(raw.dialogue, "dialogue"), features,
    legacyVariants, routines: normalizeRoutines((raw.routines ?? []).filter((entry) => !entry?.legacy)), routineOverrides: ids(raw.routineOverrides ?? []) };
}
export function normalizeObjectBindings(raw = {}) {
  if (!raw || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) || !raw.bindings && raw.bindings !== undefined) fail("Неверные привязки объектов сцены.");
  const entries = Object.entries(raw.bindings ?? {}).filter(([key, value]) => !(key.startsWith("-=") && value === null));
  if (entries.length > 5000) fail("Допустимо до 5000 привязок объектов.");
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, bindings: Object.fromEntries(entries.map(([key, value]) => {
    if (key !== objectKey(value)) fail("Ключ привязки не соответствует объекту."); return [key, normalizeObjectBinding(value)];
  })) };
}
function definitionObjects(definition) {
  return definition.episodes.flatMap((episode) => [...Object.keys(episode.tokens).map((id) => ({ type: "Token", id })),
    ...episode.dialogues.map((entry) => entry.target), ...episode.interactions.map((entry) => entry.target)]).filter((value) => validId(value.id));
}
/** A sparse explicit record overrides legacy inference, including an explicit release.
 * Historical variants remain readable in their original episodes until the GM chooses
 * one catalog binding; they are never silently flattened into the first variant. */
export function getObjectBindings(scene) {
  const stored = normalizeObjectBindings(scene?.getFlag(MODULE_ID, "objectBindings") ?? {}), definitions = getDefinitions(scene);
  const candidates = new Map(), old = legacyInteractions(scene, definitions);
  for (const definition of definitions) for (const descriptor of definitionObjects(definition)) {
    const key = objectKey(descriptor); if (!candidates.has(key)) candidates.set(key, new Set()); candidates.get(key).add(definition.schemeId);
  }
  const bindings = {};
  for (const [key, owners] of candidates) {
    const [type, id] = key.split(":"), schemeId = owners.size === 1 ? [...owners][0] : null;
    const variants = old.links.filter((link) => link.type === type && link.id === id && link.schemeId === schemeId);
    const binding = normalizeObjectBinding({ type, id, schemeId, tags: scene?.getFlag(MODULE_ID, "objectTags")?.[type]?.[id] });
    for (const kind of ["shop", "dialogue"]) {
      const links = variants.filter((link) => link.kind === kind && link.enabled);
      if (links.length === 1) binding[kind] = featureBinding({ [`${kind}Id`]: links[0].assetId, episodeIds: [links[0].episodeId], range: links[0].range, trigger: links[0].trigger }, kind);
    }
    bindings[key] = { ...binding, legacy: true, legacyVariants: variants, conflictingSchemeIds: owners.size > 1 ? [...owners] : [] };
  }
  const merged = { ...bindings, ...stored.bindings };
  // Read-only projections make existing patrols discoverable without converting their
  // conditional macros, changing run state, or starting a second executor.
  for (const binding of Object.values(merged)) {
    if (binding.type !== "Token" || !binding.schemeId) continue;
    const definition = definitions.find((entry) => entry.schemeId === binding.schemeId);
    for (const episode of definition?.episodes ?? []) {
      if (binding.routineOverrides.includes(episode.id) || binding.routines.some((entry) => entry.episodeId === episode.id)) continue;
      const feature = binding.features.find((entry) => entry.kind === "patrol" && entry.enabled && (!entry.episodeIds.length || entry.episodeIds.includes(episode.id)));
      const patrol = feature?.patrol ?? episode.tokens[binding.id]?.patrol;
      if (!patrol?.enabled || !patrol.points.length) continue;
      binding.routines.push({ episodeId: episode.id, repeat: patrol.points.length > 1, legacy: true, legacyPatrol: clone(patrol),
        steps: patrol.points.map((point, index) => ({ id: index + 1, kind: "move", parameters: { x: point.x, y: point.y, speed: patrol.speed }, next: index + 1 < patrol.points.length ? [index + 2] : [] })) });
    }
  }
  return { ...stored, bindings: merged };
}
export function getSchemeObjects(scene, schemeId) {
  const entries = getObjectBindings(scene).bindings, native = listNativeSceneObjects(scene);
  return Object.entries(entries).filter(([, value]) => value.schemeId === schemeId).map(([key, binding]) => ({ ...(native.find((entry) => entry.key === key) ?? { type: binding.type, id: binding.id, key, name: binding.id, missing: true }), binding }));
}
export function assetReferences(scene, kind, assetId) {
  return Object.values(getObjectBindings(scene).bindings).filter((binding) => binding[kind]?.[`${kind}Id`] === assetId
    || binding.legacyVariants?.some((link) => link.kind === kind && link.assetId === assetId));
}
export function validateObjectBinding(scene, binding, definitions = getDefinitions(scene)) {
  const definition = definitions.find((entry) => entry.schemeId === binding.schemeId);
  if (binding.schemeId && !definition) fail("Назначенная схема больше не существует.");
  if (!binding.schemeId && (binding.shop || binding.dialogue || binding.features.length || binding.routines.length || binding.routineOverrides.length || Object.keys(binding.episodes).length)) fail("Сначала назначьте объект схеме.");
  if (binding.playerCharacter && binding.type !== "Token") fail("Персонажем игрока может быть только токен.");
  const episodeIds = new Set(definition?.episodes.map((entry) => entry.id) ?? []), catalog = getInteractionCatalog(scene), events = getEventCatalog(scene);
  const checkEpisodes = (values) => { if (values.some((id) => !episodeIds.has(id))) fail("Настройка объекта ссылается на отсутствующий эпизод его схемы."); };
  checkEpisodes(Object.keys(binding.episodes));
  checkEpisodes(binding.routineOverrides);
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
  for (const link of binding.legacyVariants) {
    checkEpisodes([link.episodeId]);
    if (!catalog[link.kind === "shop" ? "shops" : "dialogues"].some((asset) => asset.id === link.assetId)) fail("Не найдена старая настройка взаимодействия в каталоге.");
  }
  for (const feature of binding.features) {
    checkEpisodes(feature.episodeIds);
    if (feature.kind === "patrol") {
      if (binding.type !== "Token") fail("Патрулирование доступно только токенам.");
      for (const point of feature.patrol.points) {
        if (point.eventName && !events.events.some((event) => event.name === point.eventName)) fail("Точка патруля ссылается на отсутствующее событие.");
        if (point.onTrue) fail("Для перехода из точки патруля выберите событие и настройте разрешённый эпизод этого события.");
      }
      continue;
    }
    if (!events.events.some((event) => event.name === feature.eventName)) fail("Выберите существующее событие для особенности.");
    if (feature.kind === "macro" && !events.macros.some((macro) => macro.uuid === feature.macroUuid)) fail("Макрос должен быть добавлен в каталог Ширмы.");
    if (feature.kind === "trigger") {
      const trigger = events.triggers.find((entry) => entry.id === feature.triggerId), event = events.events.find((entry) => entry.id === trigger?.eventId);
      if (!event) fail("Выберите существующий тип триггера.");
      validateTypedTrigger(events, event, { ...feature.parameters, type: trigger.name });
    }
  }
  for (const episodeId of episodeIds) if (binding.features.filter((feature) => feature.enabled && feature.kind === "patrol" && (!feature.episodeIds.length || feature.episodeIds.includes(episodeId))).length > 1) fail("В одном эпизоде объект не может иметь два активных патруля.");
  const document = getSceneObject(scene, binding);
  if (document && [...Object.values(binding.episodes), binding.entry].some((value) => value.position) && (!Number.isFinite(document.x) || !Number.isFinite(document.y))) fail("Этот тип объекта не поддерживает положение x/y.");
}
export function validateDefinitionObjectOwnership(scene, definitions) {
  const bindings = getObjectBindings(scene).bindings, previous = getDefinitions(scene);
  const configured = (definition, descriptor) => definition?.episodes.map((episode) => ({ id: episode.id, token: descriptor.type === "Token" ? episode.tokens[descriptor.id] : undefined,
    dialogues: episode.dialogues.filter((entry) => entry.target.type === descriptor.type && entry.target.id === descriptor.id),
    interactions: episode.interactions.filter((entry) => entry.target.type === descriptor.type && entry.target.id === descriptor.id) }));
  for (const definition of definitions) for (const descriptor of definitionObjects(definition)) {
    const binding = bindings[objectKey(descriptor)];
    if (binding && binding.schemeId && binding.schemeId !== definition.schemeId
      && JSON.stringify(configured(definition, descriptor)) !== JSON.stringify(configured(previous.find((entry) => entry.schemeId === definition.schemeId), descriptor))) fail(`Объект ${descriptor.type}:${descriptor.id} принадлежит другой схеме.`);
  }
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
    if (!definition) { binding.schemeId = null; binding.shop = null; binding.dialogue = null; binding.features = []; binding.routines = []; binding.routineOverrides = []; binding.legacyVariants = []; binding.episodes = {}; binding.entry = transition(); changed = true; continue; }
    const removed = previous.find((entry) => entry.schemeId === binding.schemeId)?.episodes.filter((entry) => !definition.episodes.some((value) => value.id === entry.id)).map((entry) => entry.id) ?? [];
    if (!removed.length) continue;
    changed = true;
    for (const id of removed) delete binding.episodes[id];
    binding.legacyVariants = binding.legacyVariants.filter((entry) => !removed.includes(entry.episodeId));
    binding.routines = binding.routines.filter((entry) => !removed.includes(entry.episodeId));
    binding.routineOverrides = binding.routineOverrides.filter((id) => !removed.includes(id));
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
    binding.routineOverrides = binding.routineOverrides.filter((id) => id === episodeId);
    binding.legacyVariants = binding.legacyVariants.filter((entry) => entry.episodeId === episodeId);
    for (const entry of binding.legacyVariants) if (entry.trigger.episodeIds.length) entry.trigger.episodeIds = entry.trigger.episodeIds.includes(episodeId) ? [episodeId] : [];
  }
  const assets = getInteractionCatalog(scene), eventCatalog = getEventCatalog(scene), names = [], subscriptions = [];
  const related = (kind, assetId) => bindings.some((binding) => binding[kind]?.[`${kind}Id`] === assetId || binding.legacyVariants.some((entry) => entry.kind === kind && entry.assetId === assetId));
  const interactionCatalog = { schemaVersion: 1, revision: 0, shops: assets.shops.filter((entry) => related("shop", entry.id)), dialogues: assets.dialogues.filter((entry) => related("dialogue", entry.id)) };
  for (const dialogue of interactionCatalog.dialogues) for (const page of dialogue.pages) for (const response of page.responses) if (response.eventName) names.push(response.eventName);
  const macroIds = new Set();
  for (const binding of bindings) for (const routine of binding.routines) for (const step of routine.steps) {
    if (step.kind === "event") names.push(step.parameters.eventName);
    if (step.kind === "macro") macroIds.add(step.parameters.macroUuid);
  }
  for (const binding of bindings) for (const feature of binding.features) {
    if (feature.eventName) names.push(feature.eventName);
    if (feature.kind === "patrol") for (const point of feature.patrol.points) {
      if (point.eventName) names.push(point.eventName);
      if (point.macroUuid) macroIds.add(point.macroUuid);
    }
    if (feature.kind === "macro") {
      subscriptions.push({ event: feature.eventName, kind: "macro", macroUuid: feature.macroUuid }); macroIds.add(feature.macroUuid);
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
  const catalog = exportCatalogDependencies(scene, [{ events: names, subscriptions, interactions: [], dialogues: [] }]);
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
    binding.routineOverrides = remap(binding.routineOverrides);
    for (const kind of ["shop", "dialogue"]) if (binding[kind]) {
      const entry = binding[kind]; entry[`${kind}Id`] = mapping.get(entry[`${kind}Id`]) ?? entry[`${kind}Id`]; entry.episodeIds = remap(entry.episodeIds);
      entry.trigger.episodeIds = remap(entry.trigger.episodeIds); entry.trigger.schemeIds = entry.trigger.schemeIds.map((id) => id === previousScheme ? schemeId : id);
    }
    for (const entry of binding.legacyVariants) {
      entry.assetId = mapping.get(entry.assetId) ?? entry.assetId; entry[`${entry.kind}Id`] = entry.assetId; entry.episodeId = episodeMapping.get(entry.episodeId) ?? entry.episodeId;
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
      binding.routineOverrides = [...new Set([...existing.routineOverrides, ...binding.routineOverrides])];
      binding.legacyVariants = [...existing.legacyVariants, ...binding.legacyVariants];
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
      // The editor explicitly removes legacy metadata when converting a patrol.
      // Capturing a read-only projection must not create a second executor.
      const next = normalizeObjectBinding({ ...previous, ...authored, ...descriptor });
      if (Object.hasOwn(patch, "routines")) next.routineOverrides = [...new Set([...next.routineOverrides,
        ...(previous?.routines ?? []).filter((entry) => !entry.legacy || !authored.routines.some((candidate) => candidate.legacy && candidate.episodeId === entry.episodeId)).map((entry) => entry.episodeId),
        ...next.routines.map((entry) => entry.episodeId)])];
      const changingOwner = previous?.schemeId !== next.schemeId || previous?.conflictingSchemeIds?.length;
      if (changingOwner && (previous?.schemeId || previous?.conflictingSchemeIds?.length) && !allowReassign) fail("Подтвердите изменение владельца объекта.");
      if (changingOwner && getRuntimes(this.scene).some((runtime) => [previous?.schemeId, ...(previous?.conflictingSchemeIds ?? []), next.schemeId].includes(runtime.schemeId) && runtime.runId && !runtime.halted && !runtime.episode?.stop)) fail("Перед сменой владельца остановите автоматизацию затронутых схем.");
      // A scope change cannot interpret old episode IDs in a different scheme.
      // Preserve descriptive data; only explicitly supplied new preparation survives.
      if (changingOwner && (previous?.schemeId || previous?.conflictingSchemeIds?.length)) {
        for (const [field, fallback] of Object.entries({ shop: null, dialogue: null, features: [], routines: [], routineOverrides: [], episodes: {}, entry: transition() })) if (!Object.hasOwn(patch, field)) next[field] = fallback;
      }
      if (next.legacyVariants) {
        next.legacyVariants = next.legacyVariants.filter((entry) => !changingOwner && !Object.hasOwn(patch, entry.kind));
      }
      if (!next.schemeId) { next.shop = null; next.dialogue = null; next.features = []; next.routines = []; next.routineOverrides = []; next.episodes = {}; next.entry = transition(); }
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
      const definitions = getDefinitions(this.scene), assets = getInteractionCatalog(this.scene), next = clone(raw);
      delete next.bindings[key]; next.revision++;
      for (const definition of definitions) {
        for (const episode of definition.episodes) {
          if (descriptor.type === "Token") delete episode.tokens[descriptor.id];
          for (const field of ["dialogues", "interactions"]) episode[field] = episode[field].filter((entry) => entry.target.type !== descriptor.type || entry.target.id !== descriptor.id);
        }
        definition.revision++;
      }
      // Remove historical preparation too: deleting just the sparse explicit record
      // would allow the legacy reader to resurrect the orphan on the next refresh.
      const tags = clone(this.scene.getFlag(MODULE_ID, "objectTags") ?? {});
      if (tags[descriptor.type]?.[descriptor.id] !== undefined) { delete tags[descriptor.type][descriptor.id]; tags[descriptor.type][`-=${descriptor.id}`] = null; }
      const fields = { objectBindings: objectBindingsWriteData(raw, next), definitions: Object.fromEntries(definitions.map((entry) => [entry.schemeId, entry])), interactionCatalog: assets, objectTags: tags };
      if (this.scene.update) await this.scene.update(Object.fromEntries(Object.entries(fields).map(([field, value]) => [`flags.${MODULE_ID}.${field}`, value])));
      else for (const [field, value] of Object.entries(fields)) await this.scene.setFlag(MODULE_ID, field, value);
      return null;
    });
  }
}

function resolved(scene, descriptor, context, kind) {
  const binding = getObjectBindings(scene).bindings[objectKey(descriptor)];
  if (!binding || binding.playerCharacter || !binding.schemeId || binding.schemeId !== context.schemeId) return null;
  let reference = binding[kind], legacy;
  if (binding.legacyVariants?.some((entry) => entry.kind === kind)) {
    legacy = binding.legacyVariants.find((entry) => entry.kind === kind && entry.episodeId === context.episodeId && entry.enabled);
    reference = legacy ? featureBinding({ [`${kind}Id`]: legacy.assetId, range: legacy.range, trigger: legacy.trigger, episodeIds: [legacy.episodeId] }, kind) : null;
  }
  if (!reference || reference.episodeIds.length && !reference.episodeIds.includes(context.episodeId)) return null;
  const asset = getInteractionCatalog(scene)[kind === "shop" ? "shops" : "dialogues"].find((entry) => entry.id === reference[`${kind}Id`]);
  if (!asset) return null;
  const config = { ...clone(asset), enabled: true, [`${kind}Id`]: asset.id, target: { type: descriptor.type, id: descriptor.id }, range: reference.range, trigger: clone(reference.trigger) };
  const original = legacy ?? legacyInteractions(scene).links.find((entry) => entry.kind === kind && entry.assetId === asset.id && entry.type === descriptor.type && entry.id === descriptor.id);
  if (original) Object.assign(config, kind === "shop" ? { legacyInventoryKey: descriptor.id, triggerId: descriptor.id }
    : { legacyDialogueId: original.localId, triggerId: original.localId });
  if (kind === "dialogue") { config.startNodeId = asset.startPageId; config.nodes = asset.pages.map((page) => ({ ...page, responses: page.responses.map((response) => ({ ...response, nextNodeId: response.nextPageId })) })); }
  return { asset, binding, config };
}
export const resolveObjectShop = (scene, descriptor, context) => resolved(scene, descriptor, context, "shop");
export const resolveObjectDialogue = (scene, descriptor, context) => resolved(scene, descriptor, context, "dialogue");
/** A new execution snapshot combines preparation with the current catalog once. */
export function materializeEpisode(scene, definition, source) {
  const episode = clone(source), bindings = getObjectBindings(scene).bindings, context = { schemeId: definition.schemeId, episodeId: source.id };
  episode.shops = []; episode.objects = []; episode.routines = [];
  for (const [tokenId, behavior] of Object.entries(episode.tokens)) {
    const binding = bindings[`Token:${tokenId}`];
    if (binding?.playerCharacter) { delete episode.tokens[tokenId]; continue; }
    if (binding?.conflictingSchemeIds?.length) fail(`Объект Token:${tokenId} настроен в нескольких схемах. Назначьте ему одного владельца.`);
    if (binding && binding.schemeId !== definition.schemeId) { delete episode.tokens[tokenId]; continue; }
    if (binding && !binding.legacy) behavior.shop = { ...behavior.shop, enabled: false };
  }
  // Legacy dialogs are projected through the same catalog resolver below. Their old
  // source flags are retained, so no read-time conversion destroys authored data.
  for (const binding of Object.values(bindings)) if (!binding.playerCharacter && binding.conflictingSchemeIds?.includes(definition.schemeId)) fail(`Объект ${objectKey(binding)} настроен в нескольких схемах. Назначьте ему одного владельца.`);
  episode.dialogues = episode.dialogues.filter((dialogue) => !validId(dialogue.target?.id) || !bindings[objectKey(dialogue.target)]);
  episode.interactions = episode.interactions.filter((entry) => !validId(entry.target?.id) || !bindings[objectKey(entry.target)]?.playerCharacter);
  episode.subscriptions = episode.subscriptions.filter((entry) => !entry.target || !bindings[objectKey(entry.target)]?.playerCharacter);
  for (const binding of Object.values(bindings)) {
    if (binding.playerCharacter || binding.schemeId !== definition.schemeId || binding.conflictingSchemeIds?.length) continue;
    const target = { type: binding.type, id: binding.id };
    const routine = binding.routines.find((entry) => !entry.legacy && entry.episodeId === source.id);
    const overrides = Boolean(routine || binding.routineOverrides.includes(source.id));
    if (routine) { episode.routines.push({ ...clone(routine), target }); episode.tokens[target.id] ??= defaultTokenBehavior(); }
    if (overrides && episode.tokens[target.id]) {
      const token = episode.tokens[target.id];
      token.patrol = { ...token.patrol, enabled: false }; token.speech = { ...token.speech, phrases: [] }; token.entrySpeech = "";
    }
    episode.objects.push({ target, entry: clone(binding.entry), transition: clone(binding.episodes[source.id] ?? transition()) });
    const shop = resolveObjectShop(scene, target, context), dialogue = resolveObjectDialogue(scene, target, context);
    if (shop) { episode.shops.push(shop.config); if (target.type === "Token") { episode.tokens[target.id] ??= defaultTokenBehavior(); episode.tokens[target.id].shop = shop.config; } }
    if (dialogue) episode.dialogues.push(dialogue.config);
    for (const feature of binding.features) {
      if (!feature.enabled || feature.episodeIds.length && !feature.episodeIds.includes(source.id)) continue;
      if (feature.kind === "patrol") { if (overrides) continue; episode.tokens[target.id] ??= defaultTokenBehavior(); episode.tokens[target.id].patrol = clone(feature.patrol); }
      else episode.subscriptions.push({ id: `object-${binding.type}-${binding.id}-${feature.id}`, featureId: feature.id, target,
        enabled: true, event: feature.eventName, kind: feature.kind, macroUuid: feature.macroUuid, triggerId: feature.triggerId, parameters: clone(feature.parameters) });
    }
  }
  return episode;
}
