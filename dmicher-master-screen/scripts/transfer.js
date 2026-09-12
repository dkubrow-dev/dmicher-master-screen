import { MODULE_ID, normalizeDefinition } from "./model.js";
import { asArray, getDefinitions, requireGM } from "./store.js";
import { getSignalCatalog, normalizeCatalog, exportCatalogDependencies } from "./signal-catalog.js";
import { validateParameters } from "./signal-types.js";
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
  const definitions = getDefinitions(scene), actors = [], macros = [], journals = [];
  const interactionCatalog = getInteractionCatalog(scene), objectBindings = normalizeObjectBindings(scene.getFlag(MODULE_ID, "objectBindings") ?? {});
  const signalCatalog = exportCatalogDependencies(scene);
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
  for (const state of definitions.flatMap((entry) => entry.states)) {
    for (const spawn of state.spawns) await include(spawn.actorUuid);
    for (const entry of [...state.workspace.gm, ...state.workspace.players]) await include(entry.uuid);
  }
  for (const macro of signalCatalog.macros) await include(macro.uuid);
  const data = portable(scene);
  if (data.flags) delete data.flags[MODULE_ID];
  data.active = false;
  return { format: MODULE_ID, schemaVersion: 1, systemId: game.system.id, scene: data,
    sourceSceneId: scene.id, sourceSceneUuid: scene.uuid ?? `Scene.${scene.id}`,
    definitions, signalCatalog, interactionCatalog, objectBindings, actors, macros, journals, exportedAt: new Date().toISOString() };
}
export function validateBundle(value) {
  const object = (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry);
  const name = (entry) => typeof entry === "string" && entry.trim().length > 0;
  if (value?.format !== MODULE_ID || value.schemaVersion !== 1 || !object(value.scene) || !name(value.scene.name)
    || !Array.isArray(value.definitions)) throw new Error("Это не JSON сцены Ширмы версии 1");
  if (value.systemId !== game.system.id) throw new Error("Предметы и персонажи требуют той же игровой системы");
  if (value.definitions) {
    if (!Array.isArray(value.definitions) || value.definitions.length > 100) throw new Error("Некорректный список групп.");
    const groups = value.definitions.map(normalizeDefinition);
    if (new Set(groups.map((entry) => entry.groupId)).size !== groups.length || new Set(groups.map((entry) => entry.groupName.toLocaleLowerCase())).size !== groups.length) throw new Error("Группы должны иметь уникальные названия и идентификаторы.");
  }
  if (typeof value.sourceSceneId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.sourceSceneId)) throw new Error("В JSON отсутствует ID исходной сцены.");
  normalizeCatalog(value.signalCatalog ?? {});
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
  const definitions = value.definitions.map((entry) => normalizeDefinition(entry));
  const objectBindings = normalizeObjectBindings(value.objectBindings ?? {});
  const flags = { groupDefinitions: Object.fromEntries(definitions.map((entry) => [entry.groupId, entry])), signalCatalog: value.signalCatalog,
    ...(value.interactionCatalog ? { interactionCatalog: normalizeInteractionCatalog(value.interactionCatalog) } : {}), objectBindings };
  const scene = { id: value.sourceSceneId, uuid: value.sourceSceneUuid, getFlag: (_scope, key) => flags[key] };
  for (const key of ["tokens", "tiles", "drawings", "lights", "sounds", "notes", "templates", "walls", "regions"]) {
    if (value.scene[key] !== undefined && !Array.isArray(value.scene[key])) throw new Error("Объекты сцены должны быть списками.");
    scene[key] = new Map((value.scene[key] ?? []).map((entry) => [entry._id, { ...entry, id: entry._id }]));
  }
  const signals = getSignalCatalog(scene).signals;
  for (const dialogue of getInteractionCatalog(scene).dialogues) for (const page of dialogue.pages) for (const response of page.responses) {
    if (response.signalId) {
      const signal = signals.find((entry) => entry.id === response.signalId && entry.emitterKey === `Dialogue:${dialogue.id}`);
      if (!signal) throw new Error("Диалог ссылается на чужой или отсутствующий сигнал.");
      validateParameters(signal, response.parameters);
    }
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
    data.active = false; data.navigation = false;
    data.flags ??= {};
    delete data.flags[MODULE_ID];
    const Scene = CONFIG.Scene?.documentClass ?? getDocumentClass("Scene");
    const scene = await Scene.create(data, { keepEmbeddedIds: true });
    if (!scene) throw new Error("Не удалось создать сцену");
    created.push(scene);
    mapping.set(value.sourceSceneUuid ?? `Scene.${value.sourceSceneId}`, scene.uuid ?? `Scene.${scene.id}`);
    for (const type of ["Scene", "Combat"]) mapping.set(`${type}:${value.sourceSceneId}`, `${type}:${scene.id}`);
    const catalog = value.signalCatalog ?? {};
    for (const entry of [...(catalog.signals ?? []), ...(catalog.subscriptions ?? [])]) {
      const emitterKey = mapping.get(entry.emitterKey);
      if (emitterKey) {
        const id = entry.signalId ?? entry.id;
        if (id?.startsWith(`builtin:${entry.emitterKey}:`)) mapping.set(id, `builtin:${emitterKey}:${id.slice(`builtin:${entry.emitterKey}:`.length)}`);
      }
    }
    const definitions = value.definitions.map((entry) => normalizeDefinition(remapReferences(entry, mapping)));
    await scene.update({ [`flags.${MODULE_ID}`]: {
      groupDefinitions: Object.fromEntries(definitions.map((entry) => [entry.groupId, { ...entry, revision: 1 }])),
      signalCatalog: normalizeCatalog(remapReferences(catalog, mapping)),
      interactionCatalog: normalizeInteractionCatalog(remapReferences(value.interactionCatalog ?? {}, mapping)),
      objectBindings: normalizeObjectBindings(remapReferences(value.objectBindings ?? {}, mapping))
    } });
    return { scene, created, warnings: ["Медиафайлы должны находиться по сохранённым путям.",
      "Проверьте права новых персонажей, ссылки и скриптовые макросы перед запуском."] };
  } catch (error) {
    const remaining = [];
    for (const doc of created.reverse()) { try { await doc.delete(); } catch { remaining.push(doc.uuid); } }
    if (remaining.length) error.message += ` Остались созданные документы: ${remaining.join(", ")}`;
    throw error;
  }
}
