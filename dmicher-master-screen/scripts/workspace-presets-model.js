import { text as t } from "./localization.js";

export const WORKSPACE_PRESET_KINDS = Object.freeze(["windows", "notes"]);
const record = value => value && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const cleanText = value => String(value ?? "").trim();
const key = value => {
  const result = cleanText(value);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(result)) fail(t("Некорректный идентификатор конфигурации.", "Invalid configuration identifier."));
  return result;
};
const finite = (value, fallback, minimum = -Infinity) => {
  const result = Number(value ?? fallback);
  if (!Number.isFinite(result) || result < minimum) fail(t("Некорректный числовой параметр конфигурации.", "Invalid numeric configuration parameter."));
  return result;
};
export function requirePresetKind(kind) {
  if (!WORKSPACE_PRESET_KINDS.includes(kind)) fail(t("Неизвестный вид конфигурации.", "Unknown configuration kind."));
  return kind;
}
export function windowTargetKey(target) { return target?.kind === "document" ? `document:${target.uuid}` : `application:${target?.id}${target?.uuid ? `:${target.uuid}` : ""}`; }
export function normalizeWindowTarget(value) {
  if (value?.kind === "document" && cleanText(value.uuid)) return { kind: "document", uuid: cleanText(value.uuid) };
  if (value?.kind === "application" && cleanText(value.id)) return { kind: "application", id: cleanText(value.id), ...(cleanText(value.uuid) ? { uuid: cleanText(value.uuid) } : {}) };
  fail(t("Укажите документ или зарегистрированное окно.", "Choose a document or a registered window."));
}
export function normalizeWindowEntry(value) {
  if (!record(value)) fail(t("Некорректные параметры окна.", "Invalid window parameters."));
  return { id: key(value.id), name: cleanText(value.name), target: normalizeWindowTarget(value.target),
    x: finite(value.x, 0), y: finite(value.y, 0), width: finite(value.width, 500, 50), height: finite(value.height, 450, 30),
    minimized: value.minimized === true, hidden: value.hidden === true, closeOnLeave: value.closeOnLeave !== false };
}
export function normalizeNoteEntry(value) {
  if (!record(value) || !record(value.data)) fail(t("Некорректные параметры заметки.", "Invalid note parameters."));
  const data = structuredClone(value.data);
  // Native IDs and our lifetime marker never belong to the reusable definition.
  delete data._id; delete data.id; delete data._stats;
  if (record(data.flags?.["dmicher-master-screen"])) delete data.flags["dmicher-master-screen"].workspacePreset;
  data.x = finite(data.x, 0); data.y = finite(data.y, 0);
  if (data.iconSize !== undefined) data.iconSize = finite(data.iconSize, 40, 1);
  return { id: key(value.id), name: cleanText(value.name ?? data.text), sourceId: cleanText(value.sourceId),
    sourceSceneId: cleanText(value.sourceSceneId), removeOnLeave: value.removeOnLeave !== false, data };
}
export function normalizeWorkspacePreset(kind, value) {
  requirePresetKind(kind);
  if (!record(value)) fail(t("Некорректная конфигурация.", "Invalid configuration."));
  const name = cleanText(value.name);
  if (!name) fail(t("Укажите название конфигурации.", "Enter a configuration name."));
  const entries = (Array.isArray(value.entries) ? value.entries : []).map(kind === "windows" ? normalizeWindowEntry : normalizeNoteEntry);
  const ids = new Set(), targets = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) fail(t("Идентификаторы элементов конфигурации повторяются.", "Configuration entry identifiers must be unique."));
    ids.add(entry.id);
    if (kind === "windows") {
      const target = windowTargetKey(entry.target);
      if (targets.has(target)) fail(t("Окно добавлено в конфигурацию дважды.", "The same window occurs twice in the configuration."));
      targets.add(target);
    }
  }
  return { id: key(value.id), name, entries, ...(kind === "windows" ? {
    closeUnmanaged: value.closeUnmanaged === true,
    activeWindowId: ids.has(value.activeWindowId) ? value.activeWindowId : "",
    sidebarTab: cleanText(value.sidebarTab)
  } : {}) };
}
export function normalizeWorkspacePresets(value = {}) {
  if (!record(value) || value.schemaVersion !== undefined && value.schemaVersion !== 1) fail(t("Неподдерживаемый формат конфигураций.", "Unsupported configuration format."));
  const result = { schemaVersion: 1, revision: Math.max(0, Math.trunc(finite(value.revision, 0, 0))), windows: [], notes: [] };
  for (const kind of WORKSPACE_PRESET_KINDS) {
    const ids = new Set(), names = new Set();
    result[kind] = (Array.isArray(value[kind]) ? value[kind] : []).map(entry => {
      const normalized = normalizeWorkspacePreset(kind, entry), name = normalized.name.toLocaleLowerCase();
      if (ids.has(normalized.id) || names.has(name)) fail(t("Названия и идентификаторы конфигураций должны быть уникальными.", "Configuration names and identifiers must be unique."));
      ids.add(normalized.id); names.add(name); return normalized;
    });
  }
  return result;
}

/** Transfer only typed document links; arbitrary note flags are not catalog references. */
export function remapWorkspacePresetReferences(catalog, { uuid = value => value, journal = value => value, page = value => value, sceneId = "" } = {}) {
  const next = normalizeWorkspacePresets(catalog);
  for (const preset of next.windows) for (const entry of preset.entries) if (entry.target.uuid) entry.target.uuid = uuid(entry.target.uuid);
  for (const preset of next.notes) for (const entry of preset.entries) {
    if (entry.data.entryId) entry.data.entryId = journal(entry.data.entryId);
    if (entry.data.pageId) entry.data.pageId = page(entry.data.pageId);
    // Source notes are an optional capture hint, never a dependency in another scene.
    if (entry.sourceSceneId !== sceneId) { entry.sourceId = ""; entry.sourceSceneId = ""; }
  }
  return next;
}
