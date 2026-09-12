import { message as localizedMessage } from "./localization.js";
import { writeSceneFlags, replacementFlagData } from "./scene-flags.js";
import { MODULE_ID, DEFAULT_GROUP_ID, normalizeDefinition, normalizeRuntime, normalizeTags, emptyRuntime } from "./model.js";
import { generics } from "./generics.js";

const queues = new WeakMap();
export const asArray = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
export const currentScene = () => globalThis.canvas?.scene ?? null;
export function requireGM() {
  if (!game.user?.isGM) throw new Error(localizedMessage("Требуются права мастера"));
}
export function isAuthority() {
  const authority = asArray(game.users).filter((user) => user.active && Number(user.role) === 4)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  return Boolean(authority && authority.id === game.user?.id);
}
export function requireGroupId(id = DEFAULT_GROUP_ID) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error(localizedMessage("Некорректный идентификатор группы"));
  return id;
}
export const getDefinitions = (scene) => {
  const stored = scene?.getFlag(MODULE_ID, "groupDefinitions");
  return Object.entries(stored ?? {}).filter(([, value]) => value?.schemaVersion === 1)
    .map(([id, value]) => normalizeDefinition({ ...value, groupId: requireGroupId(id) })).sort((a, b) => a.order - b.order);
};
export const getDefinition = (scene, { groupId = DEFAULT_GROUP_ID } = {}) => {
  const id = requireGroupId(groupId), found = getDefinitions(scene).find((entry) => entry.groupId === id);
  if (!found) throw new Error(localizedMessage("Группа больше не существует"));
  return found;
};
export const getRuntime = (scene, { groupId = DEFAULT_GROUP_ID } = {}) => normalizeRuntime(scene?.getFlag(MODULE_ID, "groupRuntimes")?.[requireGroupId(groupId)]
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
  if (!scene) return Promise.reject(new Error(localizedMessage("Сначала откройте сцену")));
  let queue = queues.get(scene);
  if (!queue) queues.set(scene, queue = generics.utilities.createSerialTaskQueue());
  return queue(task);
}
export function saveDefinition(scene, definition, { expectedRevision } = {}) {
  return withSceneLock(scene, async () => {
    requireGM();
    const current = getDefinitions(scene).find((entry) => entry.groupId === (definition.groupId ?? DEFAULT_GROUP_ID));
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new Error(localizedMessage("Настройки изменены другим окном. Обновите их перед сохранением."));
    const next = normalizeDefinition(definition);
    next.revision = (current?.revision ?? 0) + 1;
    const { reconcileDefinitionBindings } = await import("./scene-objects.js");
    const definitions = getDefinitions(scene), changed = [...definitions.filter((entry) => entry.groupId !== next.groupId), next];
    const bindings = reconcileDefinitionBindings(scene, definitions, changed);
    const fields = { [`groupDefinitions.${requireGroupId(next.groupId)}`]: next, ...(bindings ? { objectBindings: bindings } : {}) };
    await writeSceneFlags(scene, fields);
    return next;
  });
}
/** Caller owns withSceneLock; this raw write cannot recursively acquire the queue. */
export async function saveRuntime(scene, state) {
  requireGM();
  if (!isAuthority()) throw new Error(localizedMessage("Исполнение доступно первому подключённому полному мастеру"));
  const next = normalizeRuntime(state);
  getDefinition(scene, { groupId: next.groupId });
  const previous = scene.getFlag(MODULE_ID, "groupRuntimes")?.[requireGroupId(next.groupId)] ?? {};
  await scene.setFlag(MODULE_ID, `groupRuntimes.${requireGroupId(next.groupId)}`, replacementFlagData(previous, next));
  return next;
}
