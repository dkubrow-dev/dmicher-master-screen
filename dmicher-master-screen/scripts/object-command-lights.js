import { MODULE_ID } from "./model.js";
import { isAuthority } from "./store.js";
import { commandDocument, commandObjectUuid } from "./object-command-access.js";
import { commandCenter } from "./object-command-movement.js";
import { COMMAND_LIGHT_FLAG } from "./object-command-model.js";
export { COMMAND_LIGHT_FLAG } from "./object-command-model.js";

const current = options => !options?.signal?.aborted && (options?.isCurrent?.() ?? true);
const sourceValue = (document, key) => document?._source?.[key] ?? document?.[key];
const owner = light => light?.getFlag?.(MODULE_ID, COMMAND_LIGHT_FLAG) ?? light?.flags?.[MODULE_ID]?.[COMMAND_LIGHT_FLAG];
const validOwner = (light, uuid) => owner(light)?.version === 1 && owner(light)?.targetUuid === uuid;
function sameCoordinate(current, next) {
  if (!Array.isArray(next)) return current === next;
  const values = current instanceof Set ? [...current] : current;
  return Array.isArray(values) && values.length === next.length && next.every(value => values.includes(value));
}

/** Only command-created ambient lights are managed. Native movement hooks update
 * cached owners, never all scene objects, token frames, or foreign light sources. */
export class ObjectCommandLights {
  constructor({ authority = isAuthority } = {}) { this.authority = authority; this.targets = new Map(); this.pending = new Map(); }

  reindex(scene) {
    const prefix = `${scene.uuid ?? `Scene.${scene.id}`}.`;
    for (const uuid of this.targets.keys()) if (uuid.startsWith(prefix)) this.targets.delete(uuid);
    for (const light of scene.lights?.values?.() ?? []) {
      const metadata = owner(light);
      if (metadata?.version !== 1 || !commandDocument(scene, metadata.targetUuid)) continue;
      const ids = this.targets.get(metadata.targetUuid) ?? new Set();
      ids.add(light.id); this.targets.set(metadata.targetUuid, ids);
    }
  }
  list(scene, object) {
    const uuid = commandObjectUuid(object), ids = this.targets.get(uuid);
    return [...(ids ?? [])].map(id => scene.lights?.get(id)).filter(light => validOwner(light, uuid));
  }
  coordinates(scene, object) {
    const point = commandCenter(object, scene);
    const level = sourceValue(object, "level"), levels = sourceValue(object, "levels");
    // AmbientLight x/y are native integer fields in Foundry 13 and 14.
    return { x: Math.round(point.x), y: Math.round(point.y), elevation: Number(sourceValue(object, "elevation") ?? 0),
      // Foundry 14 tokens have one level, while AmbientLight uses a levels set.
      ...(typeof level === "string" ? { levels: [level] } : Array.isArray(levels) || levels instanceof Set ? { levels: [...levels] } : {}) };
  }
  async on(scene, object, parameters, options = {}) {
    if (!this.authority() || !current(options)) return;
    const uuid = commandObjectUuid(object), existing = this.list(scene, object), coordinates = this.coordinates(scene, object);
    if (existing.length) {
      for (const light of existing) {
        if (!current(options)) return;
        await light.update({ ...coordinates, "config.bright": parameters.bright, "config.dim": parameters.dim });
      }
      return;
    }
    const created = await scene.createEmbeddedDocuments("AmbientLight", [{ ...coordinates,
      config: { bright: parameters.bright, dim: parameters.dim },
      flags: { [MODULE_ID]: { [COMMAND_LIGHT_FLAG]: { version: 1, targetUuid: uuid } } } }]);
    const own = created.filter(light => validOwner(light, uuid));
    if (!current(options)) {
      // A submitted Foundry creation cannot be cancelled. Remove only its newly
      // created owned light if cancellation arrived while the write awaited I/O.
      const ids = own.filter(light => scene.lights?.get(light.id)).map(light => light.id);
      if (ids.length && this.authority()) await scene.deleteEmbeddedDocuments("AmbientLight", ids);
      return;
    }
    const ids = this.targets.get(uuid) ?? new Set();
    for (const light of own) ids.add(light.id);
    if (ids.size) this.targets.set(uuid, ids);
  }
  async off(scene, object, options = {}) {
    if (!this.authority() || !current(options)) return;
    const uuid = commandObjectUuid(object), ids = this.list(scene, object).map(light => light.id);
    if (ids.length) await scene.deleteEmbeddedDocuments("AmbientLight", ids);
    if (current(options)) this.targets.delete(uuid);
  }
  async updateObject(document) {
    if (document.documentName === "AmbientLight") {
      // A manually deleted/edited command light is rechecked before every use.
      const metadata = owner(document);
      if (metadata?.version === 1 && commandDocument(document.parent, metadata.targetUuid)) {
        const ids = this.targets.get(metadata.targetUuid) ?? new Set();
        ids.add(document.id); this.targets.set(metadata.targetUuid, ids);
      }
    }
    if (!this.authority()) return;
    const uuid = commandObjectUuid(document);
    if (!this.targets.has(uuid)) return;
    const previous = this.pending.get(uuid);
    if (previous) { previous.again = true; return previous.promise; }
    const task = { again: false };
    task.promise = (async () => {
      do {
        task.again = false;
        const scene = document.parent, object = commandDocument(scene, uuid);
        if (!object || !this.authority()) return;
        const coordinates = this.coordinates(scene, object);
        const changes = this.list(scene, object).filter(light => Object.entries(coordinates).some(([key, value]) => !sameCoordinate(sourceValue(light, key), value)))
          .map(light => ({ _id: light.id, ...coordinates }));
        if (changes.length) await scene.updateEmbeddedDocuments("AmbientLight", changes);
      } while (task.again);
    })().finally(() => { if (this.pending.get(uuid) === task) this.pending.delete(uuid); });
    this.pending.set(uuid, task);
    return task.promise;
  }
  async deleteObject(document) {
    if (document.documentName === "AmbientLight") {
      const metadata = owner(document), ids = this.targets.get(metadata?.targetUuid);
      ids?.delete(document.id);
      if (ids?.size === 0) this.targets.delete(metadata.targetUuid);
    }
    const uuid = commandObjectUuid(document);
    if (!this.targets.has(uuid)) return;
    await this.off(document.parent, document);
  }
  dispose() { this.targets.clear(); this.pending.clear(); }
}
