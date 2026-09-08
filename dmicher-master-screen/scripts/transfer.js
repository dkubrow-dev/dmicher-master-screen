import { MODULE_ID, normalizeDefinition, normalizeObjectTags } from "./model.js";
import { asArray, getDefinition, requireGM } from "./store.js";

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
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remapReferences(entry, mapping)]));
  return value;
}
export async function exportBundle(scene) {
  requireGM();
  if (!scene) throw new Error("Сначала откройте сцену");
  const definition = getDefinition(scene), actors = [], macros = [], journals = [];
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
  for (const episode of definition.episodes) {
    for (const spawn of episode.spawns) await include(spawn.actorUuid);
    for (const subscription of episode.subscriptions ?? []) if (subscription.kind === "macro") await include(subscription.macroUuid);
    for (const behavior of Object.values(episode.tokens)) for (const point of behavior.patrol.points) await include(point.macroUuid);
    for (const entry of [...episode.workspace.gm, ...episode.workspace.players]) await include(entry.uuid);
  }
  const data = portable(scene);
  const objectTags = normalizeObjectTags(data.flags?.[MODULE_ID]?.objectTags);
  if (data.flags) delete data.flags[MODULE_ID];
  if (Object.values(objectTags).some((entries) => Object.keys(entries).length)) {
    data.flags ??= {};
    data.flags[MODULE_ID] = { objectTags };
  }
  data.active = false;
  return { format: MODULE_ID, schemaVersion: 1, systemId: game.system.id, scene: data,
    definition, actors, macros, journals, exportedAt: new Date().toISOString() };
}
export function validateBundle(value) {
  const object = (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry);
  const name = (entry) => typeof entry === "string" && entry.trim().length > 0;
  if (value?.format !== MODULE_ID || value.schemaVersion !== 1 || !object(value.scene) || !name(value.scene.name)
    || !object(value.definition)) throw new Error("Это не JSON сцены Ширмы версии 1");
  if (value.systemId !== game.system.id) throw new Error("Предметы и персонажи требуют той же игровой системы");
  normalizeDefinition(value.definition);
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
    const definition = normalizeDefinition(remapReferences(value.definition, mapping));
    data.active = false; data.navigation = false;
    data.flags ??= {};
    const objectTags = normalizeObjectTags(data.flags[MODULE_ID]?.objectTags);
    data.flags[MODULE_ID] = { definitions: { main: { ...definition, revision: 1 } }, objectTags };
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
