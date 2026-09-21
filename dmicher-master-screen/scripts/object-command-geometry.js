import { objectCenter, sceneDistance } from "./scene-object-geometry.js";

/** A wall is a segment, not an interaction point at its midpoint. All command
 * admission and delegated approach use this same native geometry. */
export function commandInteractionPoint(scene, target, origin) {
  if (target.documentName !== "Wall") return objectCenter(target, scene);
  const c = target.c;
  if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isFinite)) return { x: NaN, y: NaN };
  const [x, y, endX, endY] = c, dx = endX - x, dy = endY - y, squared = dx * dx + dy * dy;
  const ratio = squared ? Math.max(0, Math.min(1, ((origin.x - x) * dx + (origin.y - y) * dy) / squared)) : 0;
  return { x: x + dx * ratio, y: y + dy * ratio };
}

export function commandInteractionDistance(scene, actor, target) {
  const origin = objectCenter(actor, scene);
  return sceneDistance(scene, origin, commandInteractionPoint(scene, target, origin));
}
