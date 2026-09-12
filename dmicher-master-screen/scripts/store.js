import { MODULE_ID, DEFAULT_GROUP_ID, normalizeDefinition, normalizeRuntime, normalizeTags, emptyRuntime } from "./model.js";
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
export function group(id = DEFAULT_GROUP_ID) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error("Некорректный идентификатор группы");
  return id;
}
export const getDefinitions = (scene) => {
  const stored = scene?.getFlag(MODULE_ID, "groupDefinitions");
  return Object.entries(stored ?? {}).filter(([, value]) => value?.schemaVersion === 1)
    .map(([id, value]) => normalizeDefinition({ ...value, groupId: group(id) })).sort((a, b) => a.order - b.order);
};
export const getDefinition = (scene, { groupId = DEFAULT_GROUP_ID } = {}) => {
  const id = group(groupId), found = getDefinitions(scene).find((entry) => entry.groupId === id);
  if (!found) throw new Error("Группа больше не существует");
  return found;
};
export const getRuntime = (scene, { groupId = DEFAULT_GROUP_ID } = {}) => normalizeRuntime(scene?.getFlag(MODULE_ID, "groupRuntimes")?.[group(groupId)]
  ?? emptyRuntime(groupId));
export const getRuntimes = (scene) => getDefinitions(scene).map(({ groupId }) => getRuntime(scene, { groupId }));
export const getRuntimeForRun = (scene, runId) => getRuntimes(scene).find((state) => state.runId === runId) ?? null;

export function getObjectTags(scene, descriptor) {
  const tags = {};
  for (const binding of Object.values(scene?.getFlag(MODULE_ID, "objectBindings")?.bindings ?? {})) {
    if (!binding?.type || !binding?.id) continue;
    tags[binding.type] ??= {}; tags[binding.type][binding.id] = normalizeTags(binding.tags);
  }
  return descriptor ? [...(tags[descriptor.type]?.[descriptor.id] ?? [])] : tags;
}

export function saveObjectTags(scene, { type, id }, tags) {
  return import("./scene-objects.js").then(async ({ SceneObjects }) => {
    const result = await new SceneObjects(scene).save({ type, id }, { tags });
    return result.tags;
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
    const current = getDefinitions(scene).find((entry) => entry.groupId === (definition.groupId ?? DEFAULT_GROUP_ID));
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new Error("Настройки изменены другим окном. Обновите их перед сохранением.");
    const next = normalizeDefinition(definition);
    next.revision = (current?.revision ?? 0) + 1;
    const { reconcileDefinitionBindings } = await import("./scene-objects.js");
    const definitions = getDefinitions(scene), changed = [...definitions.filter((entry) => entry.groupId !== next.groupId), next];
    const bindings = reconcileDefinitionBindings(scene, definitions, changed);
    const fields = { [`groupDefinitions.${group(next.groupId)}`]: next, ...(bindings ? { objectBindings: bindings } : {}) };
    if (scene.update) await scene.update(Object.fromEntries(Object.entries(fields).map(([key, value]) => [`flags.${MODULE_ID}.${key}`, value])));
    else for (const [key, value] of Object.entries(fields)) await scene.setFlag(MODULE_ID, key, value);
    return next;
  });
}
/** Caller owns withSceneLock; this raw write cannot recursively acquire the queue. */
export async function saveRuntime(scene, state) {
  requireGM();
  if (!isAuthority()) throw new Error("Исполнение доступно первому подключённому полному мастеру");
  const next = normalizeRuntime(state);
  getDefinition(scene, { groupId: next.groupId });
  const previous = scene.getFlag(MODULE_ID, "groupRuntimes")?.[group(next.groupId)] ?? {};
  await scene.setFlag(MODULE_ID, `groupRuntimes.${group(next.groupId)}`, runtimeWriteData(previous, next));
  return next;
}

/** Foundry merges flag maps recursively. A new runtime snapshot must remove absent
 * keys in its own scope, so finished timers, claims and sessions cannot reappear. */
function runtimeWriteData(previous, next) {
  const data = structuredClone(next);
  const record = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!record(previous) || !record(next)) return data;
  for (const key of Object.keys(previous)) {
    if (!Object.hasOwn(next, key)) data[`-=${key}`] = null;
    else if (record(previous[key]) && record(next[key])) data[key] = runtimeWriteData(previous[key], next[key]);
  }
  return data;
}
