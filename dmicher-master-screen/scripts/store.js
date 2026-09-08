import { MODULE_ID, DEFAULT_SCHEME_ID, normalizeDefinition, normalizeRuntime, normalizeObjectTags, normalizeTags, emptyRuntime } from "./model.js";
import { generics } from "./generics.js";

const queues = new WeakMap();
export const asArray = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
export const currentScene = () => globalThis.canvas?.scene ?? null;
export function requireGM() {
  if (!game.user?.isGM) throw new Error("Требуются права мастера");
}
export function isAuthority() {
  const authority = asArray(game.users).filter((user) => user.active && Number(user.role) === 4)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  return Boolean(authority && authority.id === game.user?.id);
}
export function scheme(id = DEFAULT_SCHEME_ID) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Некорректный идентификатор схемы");
  return id;
}
export const getDefinitions = (scene) => {
  const stored = scene?.getFlag(MODULE_ID, "definitions");
  if (stored && Object.values(stored).some((value) => value?.schemaVersion === 1)) return Object.entries(stored).filter(([, value]) => value?.schemaVersion === 1).map(([id, value]) => normalizeDefinition({ ...value, schemeId: scheme(id) })).sort((a, b) => a.order - b.order);
  return [normalizeDefinition(scene?.getFlag(MODULE_ID, "definition"))];
};
export const getDefinition = (scene, { schemeId = DEFAULT_SCHEME_ID } = {}) => {
  const id = scheme(schemeId), found = getDefinitions(scene).find((entry) => entry.schemeId === id);
  if (!found) throw new Error("Схема больше не существует");
  return found;
};
export const getRuntime = (scene, { schemeId = DEFAULT_SCHEME_ID } = {}) => normalizeRuntime(scene?.getFlag(MODULE_ID, "runtimes")?.[scheme(schemeId)]
  ?? (schemeId === DEFAULT_SCHEME_ID ? scene?.getFlag(MODULE_ID, "runtime") : null) ?? emptyRuntime(schemeId));
export const getRuntimes = (scene) => getDefinitions(scene).map(({ schemeId }) => getRuntime(scene, { schemeId }));
export const getRuntimeForRun = (scene, runId) => getRuntimes(scene).find((state) => state.runId === runId) ?? null;

export function getObjectTags(scene, descriptor) {
  const tags = normalizeObjectTags(scene?.getFlag(MODULE_ID, "objectTags"));
  return descriptor ? [...(tags[descriptor.type]?.[descriptor.id] ?? [])] : tags;
}

export function saveObjectTags(scene, { type, id }, tags) {
  return withSceneLock(scene, async () => {
    requireGM();
    const collection = type === "Token" ? scene.tokens : type === "Tile" ? scene.tiles : null;
    if (!collection?.has(id)) throw new Error("Объект сцены больше не существует");
    const normalized = normalizeTags(tags);
    // Write only this object's path, preserving edits to other objects from another GM.
    await scene.setFlag(MODULE_ID, `objectTags.${type}.${id}`, normalized);
    return normalized;
  });
}

export function withSceneLock(scene, task) {
  if (!scene) return Promise.reject(new Error("Сначала откройте сцену"));
  let queue = queues.get(scene);
  if (!queue) queues.set(scene, queue = generics.utilities.createSerialTaskQueue());
  return queue(task);
}
export function saveDefinition(scene, definition, { expectedRevision } = {}) {
  return withSceneLock(scene, async () => {
    requireGM();
    const current = getDefinition(scene, { schemeId: definition.schemeId });
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error("Настройки изменены другим окном. Обновите их перед сохранением.");
    const next = normalizeDefinition(definition);
    next.revision = current.revision + 1;
    await scene.setFlag(MODULE_ID, `definitions.${scheme(next.schemeId)}`, next);
    return next;
  });
}
/** Caller owns withSceneLock; this raw write cannot recursively acquire the queue. */
export async function saveRuntime(scene, state) {
  requireGM();
  if (!isAuthority()) throw new Error("Исполнение доступно первому подключённому полному мастеру");
  const next = normalizeRuntime(state);
  await scene.setFlag(MODULE_ID, `runtimes.${scheme(next.schemeId)}`, next);
  return next;
}
