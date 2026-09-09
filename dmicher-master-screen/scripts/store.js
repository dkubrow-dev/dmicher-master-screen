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
  // An explicit empty collection is intentional, including after deleting the final
  // scheme. Do not resurrect an old single-definition flag behind that collection.
  if (stored !== undefined && stored !== null) return Object.entries(stored).filter(([, value]) => value?.schemaVersion === 1)
    .map(([id, value]) => normalizeDefinition({ ...value, schemeId: scheme(id) }, { allowEmptyLegacy: true })).sort((a, b) => a.order - b.order);
  const legacy = scene?.getFlag(MODULE_ID, "definition");
  return legacy ? [normalizeDefinition(legacy, { allowEmptyLegacy: true })] : [];
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
    const current = getDefinitions(scene).find((entry) => entry.schemeId === (definition.schemeId ?? DEFAULT_SCHEME_ID));
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new Error("Настройки изменены другим окном. Обновите их перед сохранением.");
    const next = normalizeDefinition(definition);
    next.revision = (current?.revision ?? 0) + 1;
    const { validateDefinitionObjectOwnership, reconcileDefinitionBindings } = await import("./scene-objects.js");
    const definitions = getDefinitions(scene), changed = [...definitions.filter((entry) => entry.schemeId !== next.schemeId), next];
    validateDefinitionObjectOwnership(scene, changed);
    const bindings = reconcileDefinitionBindings(scene, definitions, changed);
    const fields = { [`definitions.${scheme(next.schemeId)}`]: next, ...(bindings ? { objectBindings: bindings } : {}) };
    if (current?.episodes.some((episode) => !next.episodes.some((entry) => entry.id === episode.id))) {
      const { getInteractionCatalog } = await import("./scene-assets.js"); fields.interactionCatalog = getInteractionCatalog(scene);
    }
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
  getDefinition(scene, { schemeId: next.schemeId });
  await scene.setFlag(MODULE_ID, `runtimes.${scheme(next.schemeId)}`, next);
  return next;
}
