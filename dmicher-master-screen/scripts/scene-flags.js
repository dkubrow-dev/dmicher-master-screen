import { MODULE_ID } from "./model.js";

/** One document update keeps related preparation catalogs visible together.
 * Minimal document adapters may expose setFlag only; native Scenes use update. */
export async function writeSceneFlags(scene, fields) {
  if (scene.update) {
    await scene.update(Object.fromEntries(Object.entries(fields).map(([key, value]) => [`flags.${MODULE_ID}.${key}`, value])));
    return;
  }
  for (const [key, value] of Object.entries(fields)) await scene.setFlag(MODULE_ID, key, value);
}

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);

/** Foundry merges maps recursively. Express deletions at the storage boundary;
 * domain snapshots contain values only and are never changed by this adapter. */
export function replacementFlagData(previous, next) {
  const data = structuredClone(next);
  if (!isRecord(previous) || !isRecord(next)) return data;
  for (const key of Object.keys(previous)) {
    if (!Object.hasOwn(next, key)) data[`-=${key}`] = null;
    else if (isRecord(previous[key]) && isRecord(next[key])) data[key] = replacementFlagData(previous[key], next[key]);
  }
  return data;
}
