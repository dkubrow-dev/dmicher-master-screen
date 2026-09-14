import { text } from "./localization.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { readObjectGeometry, scriptObjectBounds, planScriptMovement, advanceScriptMovement } from "./script-movement.js";

export const MAX_FOLLOW_WAYPOINTS = 512;
const pixelScale = scene => Number(scene?.grid?.size || 100) / Number(scene?.grid?.distance || 1);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const center = bounds => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
const nativeCenter = (document, scene) => center(scriptObjectBounds(document, scene));
const shifted = (bounds, dx, dy) => ({ ...bounds, x: bounds.x + dx, y: bounds.y + dy });

/** Resolve only a native document in this scene; arbitrary UUID namespaces are not targets. */
export function resolveMovementTarget(scene, object, targetUuid) {
  const prefix = `${scene.uuid ?? `Scene.${scene.id}`}.`;
  if (typeof targetUuid !== "string" || !targetUuid.startsWith(prefix)) throw new Error(text("Цель перемещения должна находиться на текущей сцене.", "The movement target must belong to the current scene."));
  const [type, id, extra] = targetUuid.slice(prefix.length).split(".");
  const target = !extra && Object.hasOwn(SCENE_OBJECT_COLLECTIONS, type) ? scene[SCENE_OBJECT_COLLECTIONS[type]]?.get?.(id) : null;
  if (!target || target === object || target.documentName === object.documentName && target.id === object.id) throw new Error(text("Выберите существующий объект цели, отличный от исполнителя.", "Select an existing target object other than the performer."));
  if (!scriptObjectBounds(target, scene)) throw new Error(text("У цели нет доступного положения на карте.", "The target has no available map position."));
  return target;
}

/** Distances use the same native bounding geometry as scene navigation and selection. */
export function boundsGap(first, second) {
  return Math.hypot(Math.max(first.x - second.x - second.width, second.x - first.x - first.width, 0),
    Math.max(first.y - second.y - second.height, second.y - first.y - first.height, 0));
}
export function approachPosition(scene, object, target, spacing = 0) {
  const from = scriptObjectBounds(object, scene), to = scriptObjectBounds(target, scene);
  const geometry = readObjectGeometry(object, scene);
  if (!from || !to || !geometry.position) throw new Error(text("Этот объект не поддерживает перемещение к цели.", "This object does not support movement toward a target."));
  const gap = spacing * pixelScale(scene);
  if (boundsGap(from, to) <= gap) return { ...geometry.position };
  const a = center(from), b = center(to), dx = b.x - a.x, dy = b.y - a.y;
  // The gap decreases monotonically along the line between bounding centres.
  let low = 0, high = 1;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (boundsGap(shifted(from, dx * middle, dy * middle), to) > gap) low = middle; else high = middle;
  }
  return { x: geometry.position.x + dx * high, y: geometry.position.y + dy * high };
}
export function planScriptApproach(scene, object, parameters) {
  const target = resolveMovementTarget(scene, object, parameters.targetUuid);
  return planScriptMovement(scene, object, { timeMode: parameters.timeMode, duration: parameters.duration,
    position: { ...approachPosition(scene, object, target, parameters.distance), speed: parameters.speed } });
}

/** Never discard a corner to fit a limit: a shortened path could cross a wall. */
export function appendFollowWaypoint(follow, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (follow.lastTarget && distance(follow.lastTarget, point) < 0.000001) return false;
  follow.lastTarget = { ...point };
  if (follow.mode !== "trajectory") return true;
  const points = follow.points, previous = points.at(-1), before = points.at(-2);
  if (before && previous) {
    const ax = previous.x - before.x, ay = previous.y - before.y, bx = point.x - previous.x, by = point.y - previous.y;
    if (Math.abs(ax * by - ay * bx) < 0.000001 && ax * bx + ay * by >= 0) points.pop();
  }
  if (points.length >= MAX_FOLLOW_WAYPOINTS) throw new Error(text("Траектория следования переполнена. Остановите и заново запустите скрипт.", "The follow trajectory is full. Stop and restart the script."));
  points.push({ ...point }); return true;
}
export function planScriptFollow(scene, object, parameters) {
  const target = resolveMovementTarget(scene, object, parameters.targetUuid);
  if (!readObjectGeometry(object, scene).position) throw new Error(text("Этот объект не поддерживает следование.", "This object does not support following."));
  const follow = { targetUuid: parameters.targetUuid, mode: parameters.mode, points: [], lastTarget: null, catchingUp: false, distanceBudget: 0 };
  appendFollowWaypoint(follow, nativeCenter(target, scene)); return follow;
}

/** Foundry owns doors, one-way walls, movement restrictions and collision precision. */
export function clipMovementByWalls(scene, object, from, to) {
  const level = scene.levels?.get?.(object._source?.level ?? object.level) ?? globalThis.canvas?.level;
  const origin = { ...from, ...(Number.isFinite(object.elevation) ? { elevation: object.elevation } : {}) };
  const check = object.documentName === "Token" && object.object?.checkCollision
    ? point => object.object.checkCollision(point, { origin, type: "move", mode: "any" })
    : globalThis.CONFIG?.Canvas?.polygonBackends?.move?.testCollision
      ? point => CONFIG.Canvas.polygonBackends.move.testCollision(origin, point, { type: "move", mode: "any", ...(level ? { level } : {}) }) : null;
  if (!check) {
    if (scene.walls && Array.from(scene.walls.values?.() ?? scene.walls).length === 0) return { point: to, blocked: false };
    throw new Error(text("Проверка препятствий Foundry недоступна для следования.", "Foundry obstacle testing is unavailable for following."));
  }
  if (!check(to)) return { point: to, blocked: false };
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) {
    const middle = (low + high) / 2, point = { x: from.x + (to.x - from.x) * middle, y: from.y + (to.y - from.y) * middle };
    if (check(point)) high = middle; else low = middle;
  }
  // Leave one native pixel before the boundary so Foundry's rounding cannot cross it.
  const ratio = Math.max(0, low - 1 / Math.max(1, distance(from, to)));
  return { point: { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }, blocked: true };
}

export async function advanceScriptFollow(scene, object, follow, parameters, seconds, { isCurrent = () => true, signal, collisionClip = clipMovementByWalls } = {}) {
  if (!isCurrent()) return { consumed: 0, done: false };
  const target = resolveMovementTarget(scene, object, follow.targetUuid), scale = pixelScale(scene);
  appendFollowWaypoint(follow, nativeCenter(target, scene));
  const gap = () => boundsGap(scriptObjectBounds(object, scene), scriptObjectBounds(target, scene));
  if (!follow.catchingUp && gap() > parameters.maxDistance * scale + 0.000001) follow.catchingUp = true;
  const arrived = () => {
    follow.catchingUp = false; follow.distanceBudget = 0; follow.points = follow.mode === "trajectory" ? [{ ...follow.lastTarget }] : [];
    return { consumed: parameters.finishOn === "arrival" ? 0 : seconds, done: parameters.finishOn === "arrival" };
  };
  if (!follow.catchingUp) {
    follow.distanceBudget = 0;
    // Keep turns observed while waiting inside the maximum distance. They are
    // needed if the target later leaves that range around an obstacle.
    return { consumed: parameters.finishOn === "arrival" ? 0 : seconds, done: parameters.finishOn === "arrival" };
  }
  if (gap() <= parameters.minDistance * scale + 0.5) return arrived();
  let budget = follow.distanceBudget + Math.max(0, seconds) * parameters.speed * scale;
  for (let i = 0; budget >= 1 && i < MAX_FOLLOW_WAYPOINTS && isCurrent(); i++) {
    const origin = nativeCenter(object, scene), geometry = readObjectGeometry(object, scene);
    while (follow.points.length > 1 && distance(origin, follow.points[0]) < 1) follow.points.shift();
    const destination = follow.mode === "trajectory" && follow.points.length > 1 ? follow.points[0] : (() => {
      const position = approachPosition(scene, object, target, parameters.minDistance);
      return { x: origin.x + position.x - geometry.position.x, y: origin.y + position.y - geometry.position.y };
    })();
    const length = distance(origin, destination);
    if (length < 0.5) return arrived();
    const ratio = Math.min(1, budget / length), proposed = { x: origin.x + (destination.x - origin.x) * ratio, y: origin.y + (destination.y - origin.y) * ratio };
    const { point, blocked } = collisionClip(scene, object, origin, proposed), travel = distance(origin, point);
    follow.blocked = blocked;
    if (travel >= 1) {
      const used = travel / parameters.speed / scale;
      const movement = planScriptMovement(scene, object, { timeMode: "duration", duration: used,
        position: { x: geometry.position.x + point.x - origin.x, y: geometry.position.y + point.y - origin.y, speed: parameters.speed } });
      await advanceScriptMovement(scene, object, movement, used, { isCurrent, ignoreObstacles: true, signal });
      if (!isCurrent()) return { consumed: 0, done: false };
      budget = Math.max(0, budget - travel);
    }
    if (blocked) { budget = 0; break; }
    if (gap() <= parameters.minDistance * scale + 0.5) {
      const result = arrived(); return { ...result, consumed: Math.min(seconds, Math.max(0, seconds - budget / parameters.speed / scale)) };
    }
    if (travel < 1) break;
  }
  follow.distanceBudget = Math.min(budget, 1); // Only fractional native-pixel progress survives; no catch-up after pauses.
  return { consumed: seconds, done: false };
}
