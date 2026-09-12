import { MODULE_ID } from "./model.js";

/** Validate a complete draft without writing partially imported flags to the world. */
export function stageScene(scene, flags) {
  const staged = Object.create(scene);
  staged.getFlag = (scope, key) => scope === MODULE_ID && Object.hasOwn(flags, key) ? flags[key] : scene.getFlag(scope, key);
  return staged;
}

/** Only declared reference fields are remapped; author prose and JSON text stay intact. */
export function remapSignalIds(value, mapping) {
  if (Array.isArray(value)) return value.map((entry) => remapSignalIds(entry, mapping));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    key === "signalId" ? mapping.get(entry) ?? entry : remapSignalIds(entry, mapping)]));
}
