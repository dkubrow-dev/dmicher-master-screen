import { MODULE_ID } from "./model.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { text } from "./localization.js";

export const isNativeObjectEmitter = key => typeof key === "string" && Object.hasOwn(SCENE_OBJECT_COLLECTIONS, key.split(":")[0]);
export function normalizeObjectSignalSettings(source = {}) {
  const ids = source.enabledIds ?? [];
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== "string" || !id || id.length > 256))
    throw new Error(text("Настройка сигналов требует список идентификаторов.", "Signal settings require a list of identifiers."));
  return { enabled: source.enabled !== false, enabledIds: [...new Set(ids)] };
}

/** Core validation remains a business guard. Opt-in controls object publication,
 * never the engine's mandatory validation before commands or transactions. */
export function isObjectSignalEnabled(scene, emitterKey, signal) {
  if (signal?.available === false) return false;
  if (!isNativeObjectEmitter(emitterKey) || signal?.builtin && signal.name === "commandRequested") return true;
  const settings = scene?.getFlag?.(MODULE_ID, "objectBindings")?.bindings?.[emitterKey]?.signals;
  return settings?.enabled !== false && settings?.enabledIds?.includes(signal?.id) === true
    && scene?.getFlag?.(MODULE_ID, "objectSignalState")?.[emitterKey] !== false;
}
