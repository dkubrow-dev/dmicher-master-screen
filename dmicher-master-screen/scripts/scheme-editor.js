import { MODULE_ID, defaultDefinition, defaultEpisode, normalizeDefinition, randomId } from "./model.js";
import { getDefinitions, getDefinition, getRuntimes, requireGM, withSceneLock } from "./store.js";
import { exportCatalogDependencies, mergeCatalogDependencies } from "./event-catalog.js";
import { getInteractionCatalog } from "./scene-assets.js";
import { validateDefinitionObjectOwnership, reconcileDefinitionBindings, exportObjectConfiguration, importObjectConfiguration, getObjectBindings } from "./scene-objects.js";

const clone = (value) => structuredClone(value);
const combineCatalogs = (...catalogs) => ({ schemaVersion: 1, ...Object.fromEntries(["events", "triggers", "macros"].map((key) => [key,
  [...new Map(catalogs.flatMap((catalog) => catalog[key] ?? []).map((entry) => [entry.id ?? entry.uuid, entry])).values()]])) });
const unique = (entries, name, except, key = "name") => {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) throw new Error("Введите название длиной от 1 до 100 символов.");
  if (entries.some((entry) => (entry.id ?? entry.schemeId) !== except && entry[key].toLocaleLowerCase() === name.trim().toLocaleLowerCase())) throw new Error("В этой группе уже есть такое название.");
  return name.trim();
};
const reorder = (entries, ids, key) => {
  if (!Array.isArray(ids) || new Set(ids).size !== entries.length || ids.length !== entries.length || ids.some((id) => !entries.some((entry) => entry[key] === id))) throw new Error("Порядок должен содержать каждый элемент ровно один раз.");
  return ids.map((id) => entries.find((entry) => entry[key] === id));
};
function removeEpisodeLinks(definition, id) {
  for (const episode of definition.episodes) {
    episode.from = episode.from.filter((value) => value !== id);
    episode.zones.forEach((zone) => { if (zone.targetEpisodeId === id) zone.targetEpisodeId = ""; });
    episode.subscriptions = episode.subscriptions.filter((entry) => entry.kind !== "transition" || entry.episodeId !== id);
    for (const behavior of Object.values(episode.tokens)) {
      if (behavior.interaction.targetEpisodeId === id) behavior.interaction.targetEpisodeId = "";
      behavior.patrol.points.forEach((point) => { if (point.onTrue === id) point.onTrue = ""; });
    }
  }
}
function standaloneEpisode(source) {
  const episode = clone(source);
  episode.from = []; episode.allowFromAll = true;
  episode.zones.forEach((zone) => { zone.targetEpisodeId = ""; });
  episode.subscriptions = episode.subscriptions.filter((entry) => entry.kind !== "transition");
  for (const behavior of Object.values(episode.tokens)) {
    behavior.interaction.targetEpisodeId = "";
    behavior.patrol.points.forEach((point) => { point.onTrue = ""; });
  }
  return episode;
}
function remapScope(episodes, from, to, episodeIds = new Map()) {
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.schemeIds)) value.schemeIds = value.schemeIds.map((id) => id === from ? to : id);
    if (Array.isArray(value.episodeIds)) value.episodeIds = value.episodeIds.map((id) => episodeIds.get(id) ?? id);
    for (const entry of Object.values(value)) if (entry && typeof entry === "object") visit(entry);
  };
  episodes.forEach(visit);
}
function portableCatalog(source, from, to) {
  const next = clone(source ?? {});
  for (const event of next.events ?? []) for (const subscriber of event.subscribers ?? []) if (subscriber.kind === "builtin" && subscriber.schemeId === from) subscriber.schemeId = to;
  return next;
}

/** Scene-local editing never enters an episode or rewrites an existing run. */
export class SchemeEditor {
  constructor(scene) { this.scene = scene; }
  list() { return getDefinitions(this.scene); }
  get(id) { return getDefinition(this.scene, { schemeId: id }); }
  async change(operation, { schemeId, expectedRevision } = {}) {
    return withSceneLock(this.scene, async () => {
      requireGM();
      const previous = this.list(), definitions = clone(previous), assets = getInteractionCatalog(this.scene);
      if (expectedRevision !== undefined && previous.find((entry) => entry.schemeId === schemeId)?.revision !== expectedRevision) throw new Error("Параметры схемы изменены другим окном. Обновите их перед сохранением.");
      const result = operation(definitions);
      const names = new Set();
      const next = definitions.map((definition, order) => {
        const normalized = normalizeDefinition({ ...definition, order });
        const name = normalized.schemeName.toLocaleLowerCase();
        if (names.has(name)) throw new Error("Названия схем сцены должны быть уникальными.");
        names.add(name);
        normalized.revision = (previous.find((entry) => entry.schemeId === normalized.schemeId)?.revision ?? 0) + 1;
        return normalized;
      });
      validateDefinitionObjectOwnership(this.scene, next);
      const bindingChanges = reconcileDefinitionBindings(this.scene, previous, next);
      const removed = previous.some((entry) => !next.some((value) => value.schemeId === entry.schemeId) || entry.episodes.some((episode) => !next.find((value) => value.schemeId === entry.schemeId)?.episodes.some((value) => value.id === episode.id)));
      const data = { ...(this.scene.getFlag(MODULE_ID, "definitions") ?? {}), ...Object.fromEntries(next.map((entry) => [entry.schemeId, entry])) };
      for (const entry of previous) if (!next.some((value) => value.schemeId === entry.schemeId)) data[`-=${entry.schemeId}`] = null;
      const fields = { definitions: data, ...(definitions.eventCatalog ? { eventCatalog: definitions.eventCatalog } : {}),
        ...(definitions.objectBindings || bindingChanges ? { objectBindings: definitions.objectBindings ?? bindingChanges } : {}), ...(removed || definitions.interactionCatalog ? { interactionCatalog: definitions.interactionCatalog ?? assets } : {}) };
      if (this.scene.update) await this.scene.update(Object.fromEntries(Object.entries(fields).map(([key, value]) => [`flags.${MODULE_ID}.${key}`, value])));
      else for (const [key, value] of Object.entries(fields)) await this.scene.setFlag(MODULE_ID, key, value);
      return clone(result ?? next);
    });
  }
  createScheme({ name = "Новая схема", background, textColor, description, symbol } = {}) {
    return this.change((definitions) => {
      const episode = defaultEpisode();
      const entry = { ...defaultDefinition(), schemeId: randomId(), schemeName: unique(definitions, name, null, "schemeName"), episodes: [episode], entryEpisodeId: episode.id, background, textColor,
        ...(description !== undefined ? { description } : {}), ...(symbol !== undefined ? { symbol } : {}) };
      definitions.push(entry); return entry;
    });
  }
  updateScheme(id, patch, options = {}) { return this.change((definitions) => {
    const entry = definitions.find((value) => value.schemeId === id);
    if (!entry) throw new Error("Схема не найдена.");
    if (patch.name !== undefined || patch.schemeName !== undefined) entry.schemeName = unique(definitions, patch.name ?? patch.schemeName, id, "schemeName");
    for (const key of ["background", "textColor", "description", "symbol", "entryEpisodeId"]) if (patch[key] !== undefined) entry[key] = patch[key];
    return entry;
  }, { ...options, schemeId: id }); }
  deleteScheme(id) { return this.change((definitions) => {
    if (!definitions.some((entry) => entry.schemeId === id)) throw new Error("Схема не найдена.");
    if (getRuntimes(this.scene).some((state) => state.schemeId === id && state.runId && !state.halted && !state.episode?.stop)) throw new Error("Сначала остановите автоматизацию удаляемой схемы.");
    definitions.splice(definitions.findIndex((entry) => entry.schemeId === id), 1);
  }); }
  reorderSchemes(ids) { return this.change((definitions) => definitions.splice(0, definitions.length, ...reorder(definitions, ids, "schemeId"))); }
  createEpisode(schemeId, { name = "Новый эпизод", ...patch } = {}) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.schemeId === schemeId);
    if (!definition) throw new Error("Схема не найдена.");
    const episode = { ...defaultEpisode(unique(definition.episodes, name)), ...patch, id: randomId(), name: name.trim() };
    definition.episodes.push(episode); return episode;
  }); }
  updateEpisode(schemeId, episodeId, patch, options = {}) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.schemeId === schemeId), episode = definition?.episodes.find((entry) => entry.id === episodeId);
    if (!episode) throw new Error("Эпизод не найден.");
    const name = patch.name === undefined ? episode.name : unique(definition.episodes, patch.name, episodeId);
    Object.assign(episode, clone(patch), { id: episodeId, name }); return episode;
  }, { ...options, schemeId }); }
  deleteEpisode(schemeId, episodeId) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.schemeId === schemeId);
    if (!definition?.episodes.some((entry) => entry.id === episodeId)) throw new Error("Эпизод не найден.");
    if (definition.episodes.length === 1) throw new Error("В схеме должен оставаться хотя бы один эпизод.");
    if (definition.entryEpisodeId === episodeId) throw new Error("Сначала выберите другой эпизод входа схемы.");
    definition.episodes = definition.episodes.filter((entry) => entry.id !== episodeId);
    removeEpisodeLinks(definition, episodeId);
  }); }
  reorderEpisodes(schemeId, ids) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.schemeId === schemeId);
    if (!definition) throw new Error("Схема не найдена.");
    definition.episodes = reorder(definition.episodes, ids, "id");
  }); }
  transferEpisode(from, to, episodeId, { copy = true, name } = {}) { return this.change((definitions) => {
    const source = definitions.find((entry) => entry.schemeId === from), destination = definitions.find((entry) => entry.schemeId === to);
    const episode = source?.episodes.find((entry) => entry.id === episodeId);
    if (!episode || !destination || from === to) throw new Error("Выберите эпизод и другую схему.");
    if (!copy && source.episodes.length === 1) throw new Error("Последний эпизод схемы можно скопировать, но нельзя переместить.");
    if (!copy && source.entryEpisodeId === episodeId) throw new Error("Сначала выберите другой эпизод входа исходной схемы.");
    const scoped = (entry) => !entry.episodeIds.length || entry.episodeIds.includes(episodeId);
    const owned = Object.values(getObjectBindings(this.scene).bindings).some((binding) => binding.schemeId === from && (
      binding.episodes[episodeId] || [binding.shop, binding.dialogue].some((entry) => entry && scoped(entry))
      || binding.features.some(scoped) || binding.routines.some((entry) => entry.episodeId === episodeId) || binding.routineOverrides.includes(episodeId) || binding.legacyVariants.some((entry) => entry.episodeId === episodeId)));
    if (owned) throw new Error("Эпизод содержит настройки объектов исходной схемы. Сначала разделите или явно переназначьте объекты: другая схема не может управлять ими одновременно.");
    const next = standaloneEpisode(episode);
    next.name = unique(destination.episodes, name ?? episode.name);
    next.id = copy || destination.episodes.some((entry) => entry.id === next.id) ? randomId() : next.id;
    remapScope([next], from, to, new Map([[episodeId, next.id]]));
    destination.episodes.push(next);
    if (!copy) { source.episodes = source.episodes.filter((entry) => entry.id !== episodeId); removeEpisodeLinks(source, episodeId); }
    return next;
  }); }
  exportScheme(id) { requireGM(); const data = this.get(id), objects = exportObjectConfiguration(this.scene, id);
    return { format: MODULE_ID, kind: "scheme", version: 1, data, ...objects, catalog: combineCatalogs(exportCatalogDependencies(this.scene, data.episodes), objects.catalog) }; }
  exportEpisode(schemeId, id) {
    requireGM(); const data = this.get(schemeId).episodes.find((entry) => entry.id === id);
    if (!data) throw new Error("Эпизод не найден.");
    const objects = exportObjectConfiguration(this.scene, schemeId, { episodeId: id });
    return { format: MODULE_ID, kind: "episode", version: 1, schemeId, data: standaloneEpisode(data), ...objects, catalog: combineCatalogs(exportCatalogDependencies(this.scene, [data]), objects.catalog) };
  }
  importScheme(envelope, { name } = {}) {
    if (envelope?.format !== MODULE_ID || envelope.kind !== "scheme" || envelope.version !== 1) throw new Error("Ожидается JSON схемы Ширмы.");
    const source = normalizeDefinition(envelope.data);
    return this.change((definitions) => {
      const next = { ...source, schemeId: randomId(), schemeName: unique(definitions, name ?? source.schemeName, null, "schemeName"), revision: 0 };
      remapScope(next.episodes, source.schemeId, next.schemeId);
      definitions.eventCatalog = mergeCatalogDependencies(this.scene, portableCatalog(envelope.catalog, source.schemeId, next.schemeId));
      const names = new Set([...definitions.eventCatalog.events.map((entry) => entry.name), ...exportCatalogDependencies(this.scene, []).events.map((entry) => entry.name)]);
      // Old envelopes may use built-in events without carrying a custom catalog.
      for (const episode of next.episodes) for (const event of episode.events) if (!names.has(event) && !["episode.entered", "automation.changed", "zone.entered", "npc.interacted", "patrol.arrived", "patrol.check", "dialogue.finished"].includes(event)) throw new Error(`В JSON отсутствует зависимое событие «${event}».`);
      definitions.push(next);
      Object.assign(definitions, importObjectConfiguration(this.scene, envelope, { schemeId: next.schemeId, definitions, eventCatalog: definitions.eventCatalog, sourceEventCatalog: envelope.catalog }));
      return next;
    });
  }
  importEpisode(schemeId, envelope, { name } = {}) {
    if (envelope?.format !== MODULE_ID || envelope.kind !== "episode" || envelope.version !== 1) throw new Error("Ожидается JSON эпизода Ширмы.");
    const source = standaloneEpisode(normalizeDefinition({ ...defaultDefinition(), entryEpisodeId: undefined, episodes: [envelope.data] }).episodes[0]);
    return this.change((definitions) => {
      const destination = definitions.find((entry) => entry.schemeId === schemeId);
      if (!destination) throw new Error("Схема не найдена.");
      const next = { ...source, id: randomId(), name: unique(destination.episodes, name ?? source.name) };
      remapScope([next], envelope.schemeId ?? "main", schemeId, new Map([[source.id, next.id]]));
      definitions.eventCatalog = mergeCatalogDependencies(this.scene, portableCatalog(envelope.catalog, envelope.schemeId ?? "main", schemeId));
      destination.episodes.push(next);
      Object.assign(definitions, importObjectConfiguration(this.scene, envelope, { schemeId, episodeMapping: new Map([[source.id, next.id]]), definitions, eventCatalog: definitions.eventCatalog, sourceEventCatalog: envelope.catalog }));
      return next;
    });
  }
}
