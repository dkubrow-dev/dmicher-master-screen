import { DEFAULT_DESCRIPTIONS } from "./object-descriptions.js";

export const MODULE_ID = "dmicher-master-screen";
export const VERSION = "0.0.1";
export const DEFAULT_SCHEME_ID = "main";
export const DEFAULT_SCHEME_SYMBOL = "🎬";
export const normalizeColor = (value, fallback = "#36404A") => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toUpperCase() : fallback;
export const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const clone = (value) => structuredClone(value);
const list = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 2000) => String(value ?? "").slice(0, max);
const number = (value, fallback = 0, min = -1000000, max = 1000000) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

/** Author text is preserved independently of the viewer's language and never evaluated. */
export function normalizeDescription(value) {
  if (value === undefined || value === null) return "";
  const prose = (entry) => {
    if (typeof entry !== "string" || [...entry].length > 4000) throw new Error("Описание должно быть текстом длиной до 4000 символов.");
    return entry;
  };
  if (typeof value === "string") return prose(value);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["ru", "en"].includes(key))
    || typeof value.ru !== "string" || typeof value.en !== "string") throw new Error("Локализованное описание должно содержать текстовые поля ru и en.");
  return { ru: prose(value.ru), en: prose(value.en) };
}
export function localizedDescription(value, language = globalThis.game?.i18n?.lang ?? "ru") {
  if (typeof value === "string") return value;
  const locale = String(language).toLowerCase().startsWith("ru") ? "ru" : "en";
  return value?.[locale] || value?.en || value?.ru || "";
}
/** Unicode display characters are grapheme clusters, not UTF-16 units or code points. */
export function normalizeSchemeSymbol(value = DEFAULT_SCHEME_SYMBOL) {
  if (typeof value !== "string" || !value || value.length > 64 || /[\p{White_Space}\p{Cc}\p{Cs}]/u.test(value)
    || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(value) || /\p{Cf}/u.test(value.replace(/[\u200D\u{E0020}-\u{E007F}]/gu, ""))) throw new Error("Значок схемы должен содержать один видимый символ Unicode.");
  if (typeof Intl.Segmenter !== "function") throw new Error("Браузер не поддерживает проверку символов Unicode.");
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)];
  if (segments.length !== 1) throw new Error("Для значка схемы требуется ровно один символ, включая составной эмодзи.");
  return value;
}

export function normalizeTags(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(entries.map((entry) => text(entry, 64).trim().toLowerCase()).filter(Boolean))].slice(0, 100);
}

export function normalizeTrigger(value = {}) {
  return { enabled: value.enabled !== false,
    schemeIds: [...new Set(list(value.schemeIds).map((id) => text(id, 64)).filter(Boolean))].slice(0, 100),
    episodeIds: [...new Set(list(value.episodeIds).map((id) => text(id, 64)).filter(Boolean))].slice(0, 100),
    allowTags: normalizeTags(value.allowTags), denyTags: normalizeTags(value.denyTags),
    repeat: value.repeat === "always" ? "always" : "limited",
    limit: Math.floor(number(value.limit, 1, 1, 1000000)), resetOnEntry: value.resetOnEntry !== false };
}

export function defaultEpisode(name = "Новый эпизод", id = randomId()) {
  return { id, name, description: clone(DEFAULT_DESCRIPTIONS.episode), background: "#36404A", textColor: "#FFFFFF", events: [], stop: false, pause: false, sound: "",
    spawns: [], zones: [], interactions: [], workspace: { gm: [], players: [] } };
}

function uniqueId(value, ids, label) {
  const id = text(value || randomId(), 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error(`${label}: требуется уникальный идентификатор`);
  ids.add(id);
  return id;
}

function normalizeInteractions(entries) {
  const ids = new Set();
  return list(entries).slice(0, 100).map((entry) => {
    if (entry.target?.type && !["Token", "Tile"].includes(entry.target.type)) throw new Error("Взаимодействие привязывается к токену или тайлу");
    return { id: uniqueId(entry.id, ids, "Взаимодействие"), name: text(entry.name, 100).trim() || "Взаимодействовать",
      enabled: entry.enabled !== false, target: { type: entry.target?.type === "Tile" ? "Tile" : "Token", id: text(entry.target?.id, 64) },
      range: number(entry.range, 5, 0, 100000), eventName: text(entry.eventName, 100).trim(), trigger: normalizeTrigger(entry.trigger) };
  });
}

export function defaultDefinition() {
  const episodes = [defaultEpisode("Спокойствие", "calm"), defaultEpisode("Напряжение", "tension"),
    defaultEpisode("Тревога", "alarm"), { ...defaultEpisode("Остановка", "stop"), stop: true }];
  for (const episode of episodes) episode.description = clone(DEFAULT_DESCRIPTIONS[episode.id]);
  return { schemaVersion: 1, schemeId: DEFAULT_SCHEME_ID, schemeName: "Основная схема", symbol: DEFAULT_SCHEME_SYMBOL,
    description: clone(DEFAULT_DESCRIPTIONS.scheme), background: "#36404A", textColor: "#FFFFFF", order: 0, revision: 0, entryEpisodeId: episodes[0].id, episodes };
}

export function normalizeDefinition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ожидается сохранённое определение схемы.");
  if (value.schemaVersion !== 1) throw new Error("Неподдерживаемая версия определения Ширмы");
  if (value.schemeId && !/^[a-zA-Z0-9_-]+$/.test(value.schemeId)) throw new Error("Некорректный идентификатор схемы");
  if (!Array.isArray(value.episodes) || value.episodes.length > 100 || !value.episodes.length) throw new Error("Схема должна содержать от 1 до 100 эпизодов");
  const ids = new Set();
  const episodes = value.episodes.map((raw) => {
    const id = text(raw.id || randomId(), 64);
    if (ids.has(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Идентификаторы эпизодов должны быть уникальными");
    ids.add(id);
    const windows = (entries) => list(entries).slice(0, 30).map((entry) => ({
      uuid: text(entry.uuid, 256), x: number(entry.x), y: number(entry.y),
      width: number(entry.width, 500, 150, 4000), height: number(entry.height, 450, 100, 4000)
    })).filter((entry) => entry.uuid);
    return { id, name: text(raw.name, 100).trim() || "Эпизод", description: normalizeDescription(raw.description === undefined ? DEFAULT_DESCRIPTIONS.episode : raw.description), background: normalizeColor(raw.background), textColor: normalizeColor(raw.textColor, "#FFFFFF"),
      events: [...new Set(list(raw.events).map((entry) => text(entry, 100).trim()).filter(Boolean))], stop: raw.stop === true,
      pause: raw.pause === true, sound: text(raw.sound, 1024),
      spawns: list(raw.spawns).slice(0, 50).map((spawn) => ({ id: text(spawn.id || randomId(), 64),
        actorUuid: text(spawn.actorUuid, 256), x: number(spawn.x), y: number(spawn.y),
        count: Math.floor(number(spawn.count, 1, 1, 50)), spacing: number(spawn.spacing, 1, 0, 1000) })),
      zones: list(raw.zones).slice(0, 100).map((zone) => ({ id: text(zone.id || randomId(), 64), label: text(zone.label, 80),
        x: number(zone.x), y: number(zone.y), width: number(zone.width, 100, 1), height: number(zone.height, 100, 1),
        eventName: text(zone.eventName, 100), trigger: normalizeTrigger(zone.trigger) })),
      interactions: normalizeInteractions(raw.interactions),
      workspace: { gm: windows(raw.workspace?.gm), players: windows(raw.workspace?.players) } };
  });
  const names = new Set(), routes = new Map();
  for (const episode of episodes) {
    const name = episode.name.toLocaleLowerCase();
    if (names.has(name)) throw new Error("Названия эпизодов внутри схемы должны быть уникальными");
    names.add(name);
    for (const event of episode.events) {
      if (routes.has(event)) throw new Error(`Событие «${event}» ведёт в несколько эпизодов одной схемы`);
      routes.set(event, episode.id);
    }
  }
  // A one-episode scheme has exactly one possible entry. This default is also
  // used when constructing a definition; it never writes flags or starts a scene.
  const entryEpisodeId = value.entryEpisodeId ?? (episodes.length === 1 ? episodes[0].id : undefined);
  if (typeof entryEpisodeId !== "string" || !ids.has(entryEpisodeId)) throw new Error("Эпизод входа должен существовать в этой схеме.");
  return { schemaVersion: 1, entryEpisodeId, schemeId: value.schemeId || DEFAULT_SCHEME_ID, schemeName: text(value.schemeName, 100).trim() || "Основная схема",
    symbol: normalizeSchemeSymbol(value.symbol), description: normalizeDescription(value.description === undefined ? DEFAULT_DESCRIPTIONS.scheme : value.description),
    background: normalizeColor(value.background), textColor: normalizeColor(value.textColor, "#FFFFFF"), order: number(value.order, 0, 0, 10000),
    revision: Math.floor(number(value.revision, 0, 0, Number.MAX_SAFE_INTEGER)), episodes };
}

export const getEpisode = (definition, id) => definition?.episodes?.find((episode) => episode.id === id) ?? null;
export function emptyRuntime(schemeId = DEFAULT_SCHEME_ID) {
  return { schemaVersion: 1, schemeId, episodeId: null, runId: "", enteredAt: 0, definitionRevision: 0,
    halted: false, haltedAt: 0,
    disabledTokens: [], episode: null, effects: {}, shops: {}, shopSessions: {}, tradeRequests: {},
    dialogueSessions: {}, dialogueCommands: {}, eventLog: [], eventClaims: {}, triggerCounts: {}, triggerEnabledOverrides: {}, error: "" };
}
export function normalizeRuntime(value) {
  if (!value) return emptyRuntime();
  if (value.schemaVersion !== 1) throw new Error("Неподдерживаемое состояние Ширмы");
  if (value.schemeId && !/^[a-zA-Z0-9_-]+$/.test(value.schemeId)) throw new Error("Некорректный идентификатор схемы");
  return { ...emptyRuntime(), ...clone(value), disabledTokens: [...new Set(list(value.disabledTokens))] };
}
