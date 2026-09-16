import { SCENE_OBJECT_TYPES } from "./scene-object-types.js";

/** Native document capabilities are shared by editors and authority validation. */
const tools = new Set(["Token", "Tile", "Drawing", "Region"]);
const movement = new Set(["Token", "Drawing", "Tile", "AmbientLight", "AmbientSound", "Note", "MeasuredTemplate", "Wall", "Region"]);
export function objectCapabilities(type) {
  return Object.freeze({ supported: SCENE_OBJECT_TYPES.includes(type), tools: tools.has(type),
    movement: movement.has(type), character: type === "Token", door: type === "Wall" });
}
