import { MODULE_ID, DEFAULT_SCHEME_ID, normalizeDefinition, normalizeRuntime, normalizeObjectTags, normalizeTags } from "./model.js";
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
function scheme(id = DEFAULT_SCHEME_ID) {
  if (id !== DEFAULT_SCHEME_ID) throw new Error("В версии 0.0.1 доступна основная схема");
  return id;
}
export const getDefinition = (scene, { schemeId } = {}) => normalizeDefinition(scene?.getFlag(MODULE_ID, "definitions")?.[scheme(schemeId)]
  ?? scene?.getFlag(MODULE_ID, "definition"));
export const getRuntime = (scene, { schemeId } = {}) => normalizeRuntime(scene?.getFlag(MODULE_ID, "runtimes")?.[scheme(schemeId)]
  ?? scene?.getFlag(MODULE_ID, "runtime"));

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
    const current = getDefinition(scene);
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
