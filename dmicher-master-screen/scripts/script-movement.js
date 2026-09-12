import { message as localizedMessage } from "./localization.js";
import { sceneObjectBounds, sceneObjectCenter, translateRegionShapes } from "./scene-object-geometry.js";

const objectType = (object) => object?.documentName ?? object?.constructor?.documentName;
const regionShapeCanMove = (shape) => shape.base ? regionShapeCanMove(shape.base) : Array.isArray(shape.points) || Number.isFinite(shape.x) && Number.isFinite(shape.y);
/** Native document dimensions: Token uses grid spaces; Tile and Drawing use pixels.
 * Foundry 14 adds Token.depth. Elevation is a position, never a size substitute. */
export function scriptObjectCapabilities(object) {
  const type = objectType(object);
  const has = (key) => key in (object ?? {}) || Boolean(object?.schema?.fields?.[key]);
  const wall = type === "Wall" && object.c?.length === 4, region = type === "Region" && object.shapes?.length > 0 && Array.from(object.shapes).every(regionShapeCanMove);
  return { position: wall || region || has("x") && has("y"), rotation: wall || has("rotation") || type === "MeasuredTemplate" && has("direction"), size: ["Token", "Tile"].includes(type) || type === "Drawing" && Boolean(object.shape),
    sizeZ: type === "Token" && has("depth"), visibility: has("hidden") };
}
const field = (object, key) => Number(key.split(".").reduce((value, name) => value?.[name], object) ?? 0);
const gridSize = (scene) => Number(scene?.grid?.size || 100);

/** UI defaults and runtime use the same units: positions in pixels, dimensions
 * in grid spaces. A wall is anchored at its midpoint and has no width/height. */
export function readObjectGeometry(object, scene = object?.parent) {
  const capabilities = scriptObjectCapabilities(object), type = objectType(object);
  const sizeSource = type === "Drawing" ? object.shape : object, scale = type === "Token" ? 1 : gridSize(scene);
  const bounds = type === "Region" ? sceneObjectBounds(object, scene, { useRendered: false }) : null;
  const position = !capabilities.position ? null : type === "Wall" ? sceneObjectCenter(object, scene)
    : bounds ? { x: bounds.x, y: bounds.y } : { x: field(object, "x"), y: field(object, "y") };
  const rotation = !capabilities.rotation ? null : type === "Wall" ? Math.atan2(object.c[3] - object.c[1], object.c[2] - object.c[0]) * 180 / Math.PI
    : field(object, type === "MeasuredTemplate" ? "direction" : "rotation");
  return { position, rotation, size: capabilities.size ? { x: field(sizeSource, "width") / scale, y: field(sizeSource, "height") / scale, z: capabilities.sizeZ ? field(object, "depth") : null } : null };
}

export function planScriptMovement(scene, object, parameters) {
  const capabilities = scriptObjectCapabilities(object), geometry = readObjectGeometry(object, scene), target = {}, durations = [], type = objectType(object);
  const { position, rotation, size } = parameters;
  if (position) {
    if (!capabilities.position) throw new Error(localizedMessage("Этот объект не поддерживает перемещение."));
    target.x = position.x; target.y = position.y;
    durations.push(Math.hypot(target.x - geometry.position.x, target.y - geometry.position.y) / gridSize(scene) * Number(scene.grid?.distance || 1) / position.speed);
  }
  if (rotation) {
    if (!capabilities.rotation) throw new Error(localizedMessage("Этот объект не поддерживает поворот."));
    const key = type === "MeasuredTemplate" ? "direction" : "rotation";
    target[key] = rotation.mode === "relative" ? geometry.rotation + rotation.angle : rotation.angle;
    durations.push(Math.abs(target[key] - geometry.rotation) / rotation.speed);
  }
  if (size) {
    if (!capabilities.size) throw new Error(localizedMessage("Изменение размеров этого объекта не поддерживается."));
    if (size.z !== null && size.z !== undefined && !capabilities.sizeZ) throw new Error(localizedMessage("Размер Z доступен только токенам Foundry 14 с полем depth."));
    const scale = ["Tile", "Drawing"].includes(type) ? gridSize(scene) : 1;
    for (const [axis, key] of [["x", "width"], ["y", "height"], ["z", "depth"]]) {
      if (size[axis] === null || size[axis] === undefined) continue;
      const nativeKey = type === "Drawing" ? `shape.${key}` : key;
      target[nativeKey] = size[axis] * scale;
      durations.push(Math.abs(target[nativeKey] - field(object, nativeKey)) / scale / size.speed);
    }
  }
  const duration = parameters.timeMode === "speed" ? Math.max(0, ...durations) : parameters.duration;
  return { target, remainingMs: duration * 1000, durationMs: duration * 1000, rotationValue: geometry.rotation ?? 0 };
}

/** Rebase each portion on the current document. A GM may move/rotate between turns;
 * the final destination and the remaining planned time stay unchanged. */
export async function advanceScriptMovement(scene, object, movement, seconds, { isCurrent = () => true } = {}) {
  if (!isCurrent()) return { consumed: 0, done: false };
  const spent = Math.min(Math.max(0, seconds * 1000), movement.remainingMs);
  const ratio = movement.remainingMs > 0 ? spent / movement.remainingMs : 1;
  if (ratio <= 0) return { consumed: 0, done: false };
  const changes = {};
  const type = objectType(object), geometry = readObjectGeometry(object, scene);
  for (const [key, target] of Object.entries(movement.target)) {
    const angle = ["rotation", "direction"].includes(key);
    let current = ["Wall", "Region"].includes(type) && ["x", "y"].includes(key) ? geometry.position[key] : angle ? geometry.rotation : field(object, key);
    if (angle) {
      const expected = ((movement.rotationValue % 360) + 360) % 360;
      // Keep multi-revolution rotations unwrapped, but accept the GM's intervening
      // orientation change as the shortest adjustment to the current orientation.
      current = movement.rotationValue + ((current - expected + 540) % 360) - 180;
    }
    let value = current + (target - current) * ratio;
    if (["x", "y"].includes(key) || ["Tile", "Drawing"].includes(type) && ["width", "height", "shape.width", "shape.height"].includes(key)) value = Math.round(value);
    if (angle) { movement.rotationValue = value; value = ((value % 360) + 360) % 360; }
    changes[key] = value;
  }
  if (type === "Wall" && Object.keys(changes).length) {
    const center = geometry.position, next = { x: changes.x ?? center.x, y: changes.y ?? center.y }, angle = ((changes.rotation ?? geometry.rotation) - geometry.rotation) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    changes.c = [0, 2].flatMap((i) => { const x = object.c[i] - center.x, y = object.c[i + 1] - center.y; return [Math.round(next.x + x * cos - y * sin), Math.round(next.y + x * sin + y * cos)]; });
    delete changes.x; delete changes.y; delete changes.rotation;
  } else if (type === "Region" && ("x" in changes || "y" in changes)) {
    changes.shapes = translateRegionShapes(object, (changes.x ?? geometry.position.x) - geometry.position.x, (changes.y ?? geometry.position.y) - geometry.position.y);
    delete changes.x; delete changes.y;
  } else if (type === "Drawing" && object.shape?.points?.length && ("shape.width" in changes || "shape.height" in changes)) {
    // Drawing polygons store local points as well as their bounding dimensions.
    const sx = object.shape.width ? (changes["shape.width"] ?? object.shape.width) / object.shape.width : 1;
    const sy = object.shape.height ? (changes["shape.height"] ?? object.shape.height) / object.shape.height : 1;
    changes["shape.points"] = Array.from(object.shape.points).map((n, i) => n * (i % 2 ? sy : sx));
  }
  if (object.documentName === "Token" && ("x" in changes || "y" in changes)) {
    const origin = object.getCenterPoint?.() ?? { x: field(object, "x") + field(object, "width") * gridSize(scene) / 2, y: field(object, "y") + field(object, "height") * gridSize(scene) / 2 };
    const destination = { x: origin.x + (changes.x ?? object.x) - object.x, y: origin.y + (changes.y ?? object.y) - object.y };
    if (object.object?.checkCollision?.(destination, { origin, type: "move", mode: "any" })) throw new Error(localizedMessage("Путь скрипта пересекает стену."));
  }
  if (Object.keys(changes).length) await object.update(changes, { animate: true, animation: { duration: Math.min(500, spent) } });
  movement.remainingMs = Math.max(0, movement.remainingMs - spent);
  return { consumed: spent / 1000, done: movement.remainingMs === 0 };
}
