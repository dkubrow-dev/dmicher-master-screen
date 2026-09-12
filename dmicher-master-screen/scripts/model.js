import { message as localizedMessage } from "./localization.js";
import { DEFAULT_DESCRIPTIONS } from "./object-descriptions.js";
import { isSceneObjectType } from "./scene-object-types.js";

export const MODULE_ID = "dmicher-master-screen";
export const VERSION = "0.0.1";
export const DEFAULT_GROUP_ID = "main";
export const DEFAULT_GROUP_SYMBOL = "🎬";
export const normalizeColor = (value, fallback = "#36404A") => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toUpperCase() : fallback;
export const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const clone = (value) => structuredClone(value);
const list = (value) => Array.isArray(value) ? value : [];
const limitText = (value, max = 2000) => String(value ?? "").slice(0, max);
const number = (value, fallback = 0, min = -1000000, max = 1000000) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;

/** Author text is preserved independently of the viewer's language and never evaluated. */
export function normalizeDescription(value) {
  if (value === undefined || value === null) return "";
  const prose = (entry) => {
    if (typeof entry !== "string" || [...entry].length > 4000) throw new Error(localizedMessage("Описание должно быть текстом длиной до 4000 символов."));
    return entry;
  };
  if (typeof value === "string") return prose(value);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["ru", "en"].includes(key))
    || typeof value.ru !== "string" || typeof value.en !== "string") throw new Error(localizedMessage("Локализованное описание должно содержать текстовые поля ru и en."));
  return { ru: prose(value.ru), en: prose(value.en) };
}
export function localizedDescription(value, language = globalThis.game?.i18n?.lang ?? "ru") {
  if (typeof value === "string") return value;
  const locale = String(language).toLowerCase().startsWith("ru") ? "ru" : "en";
  return value?.[locale] || value?.en || value?.ru || "";
}
/** Unicode display characters are grapheme clusters, not UTF-16 units or code points. */
export function normalizeGroupSymbol(value = DEFAULT_GROUP_SYMBOL) {
  if (typeof value !== "string" || !value || value.length > 64 || /[\p{White_Space}\p{Cc}\p{Cs}]/u.test(value)
    || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(value) || /\p{Cf}/u.test(value.replace(/[\u200D\u{E0020}-\u{E007F}]/gu, ""))) throw new Error(localizedMessage("Значок группы должен содержать один видимый символ Unicode."));
  if (typeof Intl.Segmenter !== "function") throw new Error(localizedMessage("Браузер не поддерживает проверку символов Unicode."));
  const segments = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)];
  if (segments.length !== 1) throw new Error(localizedMessage("Для значка группы требуется ровно один символ, включая составной эмодзи."));
  return value;
}

export function normalizeTags(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(entries.map((entry) => limitText(entry, 64).trim().toLowerCase()).filter(Boolean))].slice(0, 100);
}

export function normalizeConditions(value = {}) {
  return { enabled: value.enabled !== false,
    groupIds: [...new Set(list(value.groupIds).map((id) => limitText(id, 64)).filter(Boolean))].slice(0, 100),
    stateIds: [...new Set(list(value.stateIds).map((id) => limitText(id, 64)).filter(Boolean))].slice(0, 100),
    allowTags: normalizeTags(value.allowTags), denyTags: normalizeTags(value.denyTags),
    repeat: value.repeat === "always" ? "always" : "limited",
    limit: Math.floor(number(value.limit, 1, 1, 1000000)), resetOnEntry: value.resetOnEntry !== false };
}

export function defaultState(name = localizedMessage("Новое состояние"), id = randomId()) {
  return { id, name, description: clone(DEFAULT_DESCRIPTIONS.state), background: "#36404A", textColor: "#FFFFFF", pause: false, sound: "",
    spawns: [], zones: [], interactions: [], workspace: { gm: [], players: [] } };
}

function uniqueId(value, ids, label) {
  const id = limitText(value || randomId(), 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error(localizedMessage("{0}: требуется уникальный идентификатор", [label]));
  ids.add(id);
  return id;
}

function normalizeInteractions(entries) {
  const ids = new Set();
  return list(entries).slice(0, 100).map((entry) => {
    if (entry.target?.type && !isSceneObjectType(entry.target.type)) throw new Error(localizedMessage("Неизвестный тип объекта взаимодействия"));
    return { id: uniqueId(entry.id, ids, localizedMessage("Взаимодействие")), name: limitText(entry.name, 100).trim() || localizedMessage("Взаимодействовать"),
      enabled: entry.enabled !== false, target: { type: entry.target?.type ?? "Token", id: limitText(entry.target?.id, 64) },
      range: number(entry.range, 5, 0, 100000), signalId: limitText(entry.signalId, 160), parameters: clone(entry.parameters ?? {}), conditions: normalizeConditions(entry.conditions) };
  });
}

/** A new group has one explicit state; opening a scene never calls this factory. */
export function createGroupDefinition({ groupId = randomId(), groupName, state = defaultState(), ...metadata } = {}) {
  return normalizeDefinition({ schemaVersion: 1, groupId, groupName, ...metadata, states: [state], entryStateId: state.id });
}

export function normalizeDefinition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(localizedMessage("Ожидается сохранённое определение группы."));
  if (value.schemaVersion !== 1) throw new Error(localizedMessage("Неподдерживаемая версия определения Ширмы"));
  if (value.groupId && !/^[a-zA-Z0-9_-]+$/.test(value.groupId)) throw new Error(localizedMessage("Некорректный идентификатор группы"));
  if (!Array.isArray(value.states) || value.states.length > 100 || !value.states.length) throw new Error(localizedMessage("Группа должна содержать от 1 до 100 состояний"));
  const ids = new Set();
  const states = value.states.map((raw) => {
    const id = limitText(raw.id || randomId(), 64);
    if (ids.has(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(localizedMessage("Идентификаторы состояний должны быть уникальными"));
    ids.add(id);
    const windows = (entries) => list(entries).slice(0, 30).map((entry) => ({
      uuid: limitText(entry.uuid, 256), x: number(entry.x), y: number(entry.y),
      width: number(entry.width, 500, 150, 4000), height: number(entry.height, 450, 100, 4000)
    })).filter((entry) => entry.uuid);
    return { id, name: limitText(raw.name, 100).trim() || localizedMessage("Состояние"), description: normalizeDescription(raw.description === undefined ? DEFAULT_DESCRIPTIONS.state : raw.description), background: normalizeColor(raw.background), textColor: normalizeColor(raw.textColor, "#FFFFFF"),
      pause: raw.pause === true, sound: limitText(raw.sound, 1024),
      spawns: list(raw.spawns).slice(0, 50).map((spawn) => ({ id: limitText(spawn.id || randomId(), 64),
        actorUuid: limitText(spawn.actorUuid, 256), x: number(spawn.x), y: number(spawn.y),
        count: Math.floor(number(spawn.count, 1, 1, 50)), spacing: number(spawn.spacing, 1, 0, 1000) })),
      zones: list(raw.zones).slice(0, 100).map((zone) => ({ id: limitText(zone.id || randomId(), 64), label: limitText(zone.label, 80),
        x: number(zone.x), y: number(zone.y), width: number(zone.width, 100, 1), height: number(zone.height, 100, 1),
        signalId: limitText(zone.signalId, 160), parameters: clone(zone.parameters ?? {}), conditions: normalizeConditions(zone.conditions) })),
      interactions: normalizeInteractions(raw.interactions),
      workspace: { gm: windows(raw.workspace?.gm), players: windows(raw.workspace?.players) } };
  });
  const names = new Set();
  for (const state of states) {
    const name = state.name.toLocaleLowerCase();
    if (names.has(name)) throw new Error(localizedMessage("Названия состояний внутри группы должны быть уникальными"));
    names.add(name);
  }
  // A one-state group has exactly one possible entry. This default is also
  // used when constructing a definition; it never writes flags or starts a scene.
  const entryStateId = value.entryStateId ?? (states.length === 1 ? states[0].id : undefined);
  if (typeof entryStateId !== "string" || !ids.has(entryStateId)) throw new Error(localizedMessage("Состояние входа должно существовать в этой группе."));
  return { schemaVersion: 1, entryStateId, groupId: value.groupId || DEFAULT_GROUP_ID, groupName: limitText(value.groupName, 100).trim() || localizedMessage("Основная группа"),
    symbol: normalizeGroupSymbol(value.symbol), description: normalizeDescription(value.description === undefined ? DEFAULT_DESCRIPTIONS.group : value.description),
    background: normalizeColor(value.background), textColor: normalizeColor(value.textColor, "#FFFFFF"), order: number(value.order, 0, 0, 10000),
    revision: Math.floor(number(value.revision, 0, 0, Number.MAX_SAFE_INTEGER)), states };
}

export const getState = (definition, id) => definition?.states?.find((state) => state.id === id) ?? null;
export function emptyRuntime(groupId = DEFAULT_GROUP_ID) {
  return { schemaVersion: 1, groupId, stateId: null, runId: "", enteredAt: 0, definitionRevision: 0,
    halted: false, haltedAt: 0,
    disabledObjects: [], state: null, effects: {}, shops: {}, shopSessions: {}, tradeRequests: {}, scriptStates: {}, interactionClocks: {},
    dialogueSessions: {}, dialogueCommands: {}, conditionCounts: {}, conditionEnabledOverrides: {}, error: "" };
}
export function normalizeRuntime(value) {
  if (!value) return emptyRuntime();
  if (value.schemaVersion !== 1) throw new Error(localizedMessage("Неподдерживаемое состояние Ширмы"));
  if (value.groupId && !/^[a-zA-Z0-9_-]+$/.test(value.groupId)) throw new Error(localizedMessage("Некорректный идентификатор группы"));
  return { ...emptyRuntime(), ...clone(value), disabledObjects: [...new Set(list(value.disabledObjects))] };
}
