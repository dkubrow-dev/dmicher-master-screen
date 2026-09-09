import { MODULE_ID, normalizeDefinition, normalizeObjectTags } from "./model.js";
import { asArray, getDefinitions, requireGM } from "./store.js";
import { getEventCatalog, normalizeCatalog } from "./event-catalog.js";
import { getInteractionCatalog, normalizeInteractionCatalog } from "./scene-assets.js";
import { normalizeObjectBindings, validateObjectBinding } from "./scene-objects.js";

const copy = (data) => structuredClone(data);
function portable(document) {
  const data = copy(typeof document.toObject === "function" ? document.toObject() : document);
  for (const key of ["_id", "_stats", "folder", "sort", "ownership"]) delete data[key];
  return data;
}
export function remapReferences(value, mapping) {
  if (typeof value === "string") {
    if (mapping.has(value)) return mapping.get(value);
    for (const [from, to] of mapping) if (value.startsWith(`${from}.`)) return to + value.slice(from.length);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => remapReferences(entry, mapping));
  // Author descriptions and display symbols are prose, even when their text happens
  // to equal a document UUID. Only reference-bearing data participates in remapping.
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    ["description", "symbol"].includes(key) ? copy(entry) : remapReferences(entry, mapping)]));
  return value;
}
export async function exportBundle(scene) {
  requireGM();
  if (!scene) throw new Error("Сначала откройте сцену");
  const definitions = getDefinitions(scene), definition = definitions[0] ?? null, actors = [], macros = [], journals = [];
  const allEvents = getEventCatalog(scene);
  const interactionCatalog = getInteractionCatalog(scene), objectBindings = normalizeObjectBindings(scene.getFlag(MODULE_ID, "objectBindings") ?? {});
  const eventCatalog = normalizeCatalog({ ...allEvents, events: allEvents.events.filter((entry) => !entry.builtin), triggers: allEvents.triggers.filter((entry) => !entry.builtin) });
  const seen = new Set();
  async function include(uuid) {
    if (!uuid || seen.has(uuid)) return;
    seen.add(uuid);
    const doc = await fromUuid(uuid);
    if (!doc) return;
    if (doc.documentName === "Actor") actors.push({ uuid: doc.uuid, data: portable(doc) });
    if (doc.documentName === "Macro") macros.push({ uuid: doc.uuid, data: portable(doc) });
    if (doc.documentName === "JournalEntry") journals.push({ uuid: doc.uuid, data: portable(doc) });
    if (doc.documentName === "JournalEntryPage") await include(doc.parent.uuid);
  }
  for (const token of asArray(scene.tokens)) if (token.actorId) await include(`Actor.${token.actorId}`);
  for (const note of asArray(scene.notes)) if (note.entryId) await include(`JournalEntry.${note.entryId}`);
  for (const episode of definitions.flatMap((entry) => entry.episodes)) {
    for (const spawn of episode.spawns) await include(spawn.actorUuid);
    for (const subscription of episode.subscriptions ?? []) if (subscription.kind === "macro") await include(subscription.macroUuid);
    for (const behavior of Object.values(episode.tokens)) for (const point of behavior.patrol.points) await include(point.macroUuid);
    for (const entry of [...episode.workspace.gm, ...episode.workspace.players]) await include(entry.uuid);
  }
  for (const event of eventCatalog.events) for (const subscriber of event.subscribers) if (subscriber.kind === "macro") await include(subscriber.macroUuid);
  for (const macro of eventCatalog.macros) await include(macro.uuid);
  for (const binding of Object.values(objectBindings.bindings)) for (const feature of binding.features) {
    if (feature.kind === "macro") await include(feature.macroUuid);
    if (feature.kind === "patrol") for (const point of feature.patrol.points) await include(point.macroUuid);
  }
  for (const binding of Object.values(objectBindings.bindings)) for (const routine of binding.routines) for (const step of routine.steps) if (step.kind === "macro") await include(step.parameters.macroUuid);
  const data = portable(scene);
  const objectTags = normalizeObjectTags(data.flags?.[MODULE_ID]?.objectTags);
  if (data.flags) delete data.flags[MODULE_ID];
  if (Object.values(objectTags).some((entries) => Object.keys(entries).length)) {
    data.flags ??= {};
    data.flags[MODULE_ID] = { objectTags };
  }
  data.active = false;
  return { format: MODULE_ID, schemaVersion: 1, systemId: game.system.id, scene: data,
    definition, definitions, eventCatalog, interactionCatalog, objectBindings, actors, macros, journals, exportedAt: new Date().toISOString() };
}
export function validateBundle(value) {
  const object = (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry);
  const name = (entry) => typeof entry === "string" && entry.trim().length > 0;
  if (value?.format !== MODULE_ID || value.schemaVersion !== 1 || !object(value.scene) || !name(value.scene.name)
    || (!Array.isArray(value.definitions) && !object(value.definition))) throw new Error("Это не JSON сцены Ширмы версии 1");
  if (value.systemId !== game.system.id) throw new Error("Предметы и персонажи требуют той же игровой системы");
  if (value.definition) normalizeDefinition(value.definition);
  if (value.definitions) {
    if (!Array.isArray(value.definitions) || value.definitions.length > 100) throw new Error("Некорректный список схем.");
    const schemes = value.definitions.map(normalizeDefinition);
    if (new Set(schemes.map((entry) => entry.schemeId)).size !== schemes.length || new Set(schemes.map((entry) => entry.schemeName.toLocaleLowerCase())).size !== schemes.length) throw new Error("Схемы должны иметь уникальные названия и идентификаторы.");
  }
  if (value.eventCatalog) normalizeCatalog(value.eventCatalog);
  const uuids = new Set();
  for (const [field, type] of [["actors", "Actor"], ["macros", "Macro"], ["journals", "JournalEntry"]]) {
    if (!Array.isArray(value[field]) || value[field].length > 500) throw new Error(`Некорректный список ${field}`);
    for (const entry of value[field]) {
      if (!object(entry) || !name(entry.uuid) || !object(entry.data) || !name(entry.data.name)
        || !(entry.uuid.startsWith(`${type}.`) || entry.uuid.startsWith("Compendium.")) || uuids.has(entry.uuid)) {
        throw new Error(`Повреждён или повторён документ ${field}`);
      }
      uuids.add(entry.uuid);
    }
  }
  if (value.scene.tokens !== undefined && !Array.isArray(value.scene.tokens)) throw new Error("Токены сцены должны быть списком");
  if (value.scene.notes !== undefined && !Array.isArray(value.scene.notes)) throw new Error("Заметки сцены должны быть списком");
  const tokens = value.scene.tokens ?? [];
  if (tokens.length > 1000) throw new Error("Допустимо до 1000 токенов в импортируемой сцене");
  const tokenIds = new Set();
  for (const token of tokens) {
    if (!object(token) || !name(token._id) || tokenIds.has(token._id)) throw new Error("Повреждён или повторён ID токена сцены");
    tokenIds.add(token._id);
  }
  const definitions = (value.definitions ?? [value.definition]).map((entry) => normalizeDefinition(entry));
  const objectBindings = normalizeObjectBindings(value.objectBindings ?? {});
  const flags = { definitions: Object.fromEntries(definitions.map((entry) => [entry.schemeId, entry])), eventCatalog: value.eventCatalog,
    ...(value.interactionCatalog ? { interactionCatalog: normalizeInteractionCatalog(value.interactionCatalog) } : {}), objectBindings };
  const scene = { id: "import-validation", getFlag: (_scope, key) => flags[key] };
  for (const key of ["tokens", "tiles", "drawings", "lights", "sounds", "notes", "templates", "walls", "regions"]) {
    if (value.scene[key] !== undefined && !Array.isArray(value.scene[key])) throw new Error("Объекты сцены должны быть списками.");
    scene[key] = new Map((value.scene[key] ?? []).map((entry) => [entry._id, entry]));
  }
  const events = getEventCatalog(scene).events;
  for (const dialogue of getInteractionCatalog(scene).dialogues) for (const page of dialogue.pages) for (const response of page.responses) {
    if (response.eventName && !events.some((event) => event.name === response.eventName)) throw new Error("Диалог ссылается на отсутствующее событие.");
  }
  for (const binding of Object.values(objectBindings.bindings)) validateObjectBinding(scene, binding, definitions);
  return value;
}
export async function importBundle(value) {
  requireGM(); validateBundle(value);
  const mapping = new Map(), created = [];
  try {
    for (const [field, type] of [["actors", "Actor"], ["macros", "Macro"], ["journals", "JournalEntry"]]) {
      for (const entry of value[field]) {
        const Class = CONFIG[type]?.documentClass ?? getDocumentClass(type);
        const doc = await Class.create({ ...portable(entry.data), ownership: { default: 0 } }, { keepEmbeddedIds: true });
        if (!doc) throw new Error(`Не удалось создать ${type}`);
        created.push(doc); mapping.set(entry.uuid, doc.uuid);
      }
    }
    const data = remapReferences(portable(value.scene), mapping);
    for (const token of data.tokens ?? []) {
      const mapped = mapping.get(`Actor.${token.actorId}`);
      if (mapped) token.actorId = mapped.slice("Actor.".length);
    }
    for (const note of data.notes ?? []) {
      const mapped = mapping.get(`JournalEntry.${note.entryId}`);
      if (mapped) note.entryId = mapped.slice("JournalEntry.".length);
    }
    const definitions = (value.definitions ?? [value.definition]).map((entry) => normalizeDefinition(remapReferences(entry, mapping)));
    data.active = false; data.navigation = false;
    data.flags ??= {};
    const objectTags = normalizeObjectTags(data.flags[MODULE_ID]?.objectTags);
    data.flags[MODULE_ID] = { definitions: Object.fromEntries(definitions.map((entry) => [entry.schemeId, { ...entry, revision: 1 }])),
      eventCatalog: normalizeCatalog(remapReferences(value.eventCatalog ?? {}, mapping)), objectTags,
      ...(value.interactionCatalog ? { interactionCatalog: normalizeInteractionCatalog(remapReferences(value.interactionCatalog, mapping)) } : {}),
      ...(value.objectBindings ? { objectBindings: normalizeObjectBindings(remapReferences(value.objectBindings, mapping)) } : {}) };
    const Scene = CONFIG.Scene?.documentClass ?? getDocumentClass("Scene");
    const scene = await Scene.create(data, { keepEmbeddedIds: true });
    if (!scene) throw new Error("Не удалось создать сцену");
    return { scene, created, warnings: ["Медиафайлы должны находиться по сохранённым путям.",
      "Проверьте права новых персонажей, ссылки и скриптовые макросы перед запуском."] };
  } catch (error) {
    const remaining = [];
    for (const doc of created.reverse()) { try { await doc.delete(); } catch { remaining.push(doc.uuid); } }
    if (remaining.length) error.message += ` Остались созданные документы: ${remaining.join(", ")}`;
    throw error;
  }
}
