import { text } from "./localization.js";
import { scriptObjectBounds, readObjectGeometry, planScriptMovement, advanceScriptMovement } from "./script-movement.js";
import { clipMovementByWalls, approachPosition, boundsGap } from "./script-target-movement.js";
import { rejectCommand } from "./object-command-access.js";
import { commandPointVisible } from "./object-command-visibility.js";

export const commandScale = scene => Number(scene.grid?.size || 100) / Number(scene.grid?.distance || 1);
export const commandCenter = (object, scene) => { const b = scriptObjectBounds(object, scene); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Five native rays include the object's footprint; only blocked rays need the
 * existing Foundry clipping search. No pixel scan or per-frame path finding. */
export function clipCommandMovement(scene, object, from, to) {
  const b = scriptObjectBounds(object, scene), halfX = Math.max(0, b.width / 2 - 1), halfY = Math.max(0, b.height / 2 - 1);
  const offsets = [[0, 0], ...halfX || halfY ? [[-halfX, -halfY], [halfX, -halfY], [-halfX, halfY], [halfX, halfY]] : []];
  let ratio = 1, blocked = false; const total = length(from, to);
  for (const [x, y] of offsets) {
    const origin = { x: from.x + x, y: from.y + y }, destination = { x: to.x + x, y: to.y + y };
    const result = clipMovementByWalls(scene, object, origin, destination);
    if (result.blocked) { blocked = true; ratio = Math.min(ratio, total ? length(origin, result.point) / total : 0); }
  }
  return { blocked, point: { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio } };
}
export function commandPoint(scene, value) {
  if (!value || typeof value.x !== "number" || typeof value.y !== "number" || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    rejectCommand("point", text("Укажите точку на карте.", "Choose a point on the map."));
  }
  const rect = globalThis.canvas?.dimensions?.sceneRect;
  if (rect?.contains && !rect.contains(value.x, value.y)) rejectCommand("point-outside", text("Точка должна находиться внутри карты сцены.", "Choose a point inside the scene map."));
  return { x: value.x, y: value.y };
}
export function validateCommandPoint(scene, actor, object, value) {
  const point = commandPoint(scene, value);
  if (!commandPointVisible(scene, actor, point)) rejectCommand("visibility", text("Персонаж должен видеть выбранную точку.", "Your character must be able to see the chosen point."));
  if (clipCommandMovement(scene, object, commandCenter(object, scene), point).blocked) {
    rejectCommand("obstacle", text("Прямой путь объекта к этой точке перекрыт.", "The object's straight path to that point is blocked."));
  }
  return point;
}
export async function advanceCommandMovement(scene, object, destination, speed, seconds, options = {}) {
  const current = () => !options.signal?.aborted && (options.isCurrent?.() ?? true);
  if (!current()) return { done: false, blocked: false, consumed: 0 };
  const progress = options.progress ?? {}, scale = commandScale(scene);
  const from = commandCenter(object, scene), distance = length(from, destination), budget = (progress.distanceBudget ?? 0) + Math.max(0, seconds) * speed * scale;
  if (distance < 0.5) return { done: true, blocked: false, consumed: 0 };
  // Native positions are rounded to pixels. Retain a small remainder between
  // coarse ticks so slow commands cannot repeatedly round to the same position.
  if (budget < 1 && budget < distance) { progress.distanceBudget = budget; return { done: false, blocked: false, consumed: seconds }; }
  const ratio = Math.min(1, budget / distance), proposed = { x: from.x + (destination.x - from.x) * ratio, y: from.y + (destination.y - from.y) * ratio };
  const { point, blocked } = clipCommandMovement(scene, object, from, proposed), travel = length(from, point), geometry = readObjectGeometry(object, scene);
  const used = travel / speed / scale;
  if (travel > 0.01) {
    const plan = planScriptMovement(scene, object, { timeMode: "duration", duration: used,
      position: { x: geometry.position.x + point.x - from.x, y: geometry.position.y + point.y - from.y, speed } });
    await advanceScriptMovement(scene, object, plan, used, { ...options, ignoreObstacles: true });
  }
  if (!current()) return { done: false, blocked: false, consumed: 0 };
  const actual = length(from, commandCenter(object, scene));
  progress.distanceBudget = blocked ? 0 : Math.max(-1, Math.min(1, budget - actual));
  return { done: blocked || length(commandCenter(object, scene), destination) < 0.5, blocked, consumed: Math.min(seconds, used) };
}
export function approachCommandPoint(scene, object, target, distance = 0) {
  const origin = commandCenter(object, scene), geometry = readObjectGeometry(object, scene), position = approachPosition(scene, object, target, distance);
  return { x: origin.x + position.x - geometry.position.x, y: origin.y + position.y - geometry.position.y };
}
export const commandTouches = (scene, object, other) => boundsGap(scriptObjectBounds(object, scene), scriptObjectBounds(other, scene)) < 1;
