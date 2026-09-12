/** Native document dimensions: Token uses grid spaces; Tile uses pixels.
 * Foundry 14 adds Token.depth. Elevation is a position, never a size substitute. */
export function scriptObjectCapabilities(object) {
  const type = object?.documentName;
  const has = (key) => key in (object ?? {}) || Boolean(object?.schema?.fields?.[key]);
  return { position: has("x") && has("y"), rotation: has("rotation"), size: ["Token", "Tile"].includes(type),
    sizeZ: type === "Token" && has("depth"), visibility: has("hidden") };
}
const field = (object, key) => Number(object[key] ?? 0);
const gridSize = (scene) => Number(scene.grid?.size || 100);

export function planScriptMovement(scene, object, parameters) {
  const capabilities = scriptObjectCapabilities(object), target = {}, durations = [];
  const { position, rotation, size } = parameters;
  if (position) {
    if (!capabilities.position) throw new Error("Этот объект не поддерживает перемещение.");
    target.x = position.x; target.y = position.y;
    durations.push(Math.hypot(target.x - field(object, "x"), target.y - field(object, "y")) / gridSize(scene) * Number(scene.grid?.distance || 1) / position.speed);
  }
  if (rotation) {
    if (!capabilities.rotation) throw new Error("Этот объект не поддерживает поворот.");
    target.rotation = rotation.mode === "relative" ? field(object, "rotation") + rotation.angle : rotation.angle;
    durations.push(Math.abs(target.rotation - field(object, "rotation")) / rotation.speed);
  }
  if (size) {
    if (!capabilities.size) throw new Error("Изменение размеров этого объекта не поддерживается.");
    if (size.z !== null && size.z !== undefined && !capabilities.sizeZ) throw new Error("Размер Z доступен только токенам Foundry 14 с полем depth.");
    const scale = object.documentName === "Tile" ? gridSize(scene) : 1;
    for (const [axis, key] of [["x", "width"], ["y", "height"], ["z", "depth"]]) {
      if (size[axis] === null || size[axis] === undefined) continue;
      target[key] = size[axis] * scale;
      durations.push(Math.abs(target[key] - field(object, key)) / scale / size.speed);
    }
  }
  const duration = parameters.timeMode === "speed" ? Math.max(0, ...durations) : parameters.duration;
  return { target, remainingMs: duration * 1000, durationMs: duration * 1000, rotationValue: field(object, "rotation") };
}

/** Rebase each portion on the current document. A GM may move/rotate between turns;
 * the final destination and the remaining planned time stay unchanged. */
export async function advanceScriptMovement(scene, object, movement, seconds, { isCurrent = () => true } = {}) {
  if (!isCurrent()) return { consumed: 0, done: false };
  const spent = Math.min(Math.max(0, seconds * 1000), movement.remainingMs);
  const ratio = movement.remainingMs > 0 ? spent / movement.remainingMs : 1;
  if (ratio <= 0) return { consumed: 0, done: false };
  const changes = {};
  for (const [key, target] of Object.entries(movement.target)) {
    let current = field(object, key);
    if (key === "rotation") {
      const expected = ((movement.rotationValue % 360) + 360) % 360;
      // Keep multi-revolution rotations unwrapped, but accept the GM's intervening
      // orientation change as the shortest adjustment to the current orientation.
      current = movement.rotationValue + ((current - expected + 540) % 360) - 180;
    }
    let value = current + (target - current) * ratio;
    if (["x", "y"].includes(key) || object.documentName === "Tile" && ["width", "height"].includes(key)) value = Math.round(value);
    if (key === "rotation") { movement.rotationValue = value; value = ((value % 360) + 360) % 360; }
    changes[key] = value;
  }
  if (object.documentName === "Token" && ("x" in changes || "y" in changes)) {
    const origin = object.getCenterPoint?.() ?? { x: field(object, "x") + field(object, "width") * gridSize(scene) / 2, y: field(object, "y") + field(object, "height") * gridSize(scene) / 2 };
    const destination = { x: origin.x + (changes.x ?? object.x) - object.x, y: origin.y + (changes.y ?? object.y) - object.y };
    if (object.object?.checkCollision?.(destination, { origin, type: "move", mode: "any" })) throw new Error("Путь скрипта пересекает стену.");
  }
  if (Object.keys(changes).length) await object.update(changes, { animate: true, animation: { duration: Math.min(500, spent) } });
  movement.remainingMs = Math.max(0, movement.remainingMs - spent);
  return { consumed: spent / 1000, done: movement.remainingMs === 0 };
}
