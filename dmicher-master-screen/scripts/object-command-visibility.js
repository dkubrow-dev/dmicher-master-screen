let sourceSequence = 0;

function visibilityTests(points, object, level) {
  const visibility = globalThis.canvas?.visibility;
  if (typeof visibility?._createVisibilityTestConfig !== "function") return null;
  // Foundry 14 accepts several points and supplies the native level/elevation
  // needed by its LOS checks. Foundry 13 prepares one point at a time.
  if (Number(globalThis.game?.release?.generation) >= 14) {
    const config = visibility._createVisibilityTestConfig(points.map(point => ({ ...point,
      elevation: point.elevation ?? level?.elevation?.base })), { object, tolerance: 0 });
    // Admission is for the character's level, which need not be the authority
    // GM's viewed level. Native door/point tests otherwise use canvas.level.
    if (level) {
      config.level = level;
      for (const test of config.tests) test.level = level;
    }
    return config;
  }
  return { object, tests: points.flatMap(point => visibility._createVisibilityTestConfig(point, { object, tolerance: 0 }).tests) };
}

/** Admission-time perception of the commanding character, independent of which
 * token the authority GM currently controls. Never adds a source to the canvas,
 * changes selection, explores fog or persists documents. */
export function commandPointsVisible(scene, actor, points, { object = null } = {}) {
  if (!points?.length) return false;
  if (scene.tokenVision === false) return true;
  const token = actor?.object;
  if (!token || token.hasSight === false || actor.sight?.enabled === false) return false;
  const modes = globalThis.CONFIG?.Canvas?.detectionModes;
  if (!modes) return false;
  let source = token.vision, temporary = null;
  try {
    if (!source) {
      const Source = globalThis.CONFIG?.Canvas?.visionSourceClass;
      if (typeof Source !== "function" || typeof token._getVisionSourceData !== "function") return false;
      // destroy() removes by sourceId even for detached sources. A separate ID
      // is essential: a temporary check must not remove the token's real source.
      temporary = source = new Source({ object: token,
        sourceId: `dmicher-master-screen.command-visibility.${++sourceSequence}` });
      Object.assign(source.blinded, token._getVisionBlindedStates?.() ?? {});
      source.initialize(token._getVisionSourceData());
    }
    if (source.isBlinded || source.data?.disabled || !source.los) return false;
    const config = visibilityTests(points, object, scene.levels?.get?.(actor.level) ?? source.level);
    if (!config) return false;
    return ["basicSight", "lightPerception"].some(id => {
      const mode = Array.isArray(actor.detectionModes)
        ? actor.detectionModes.find(entry => entry.id === id) : actor.detectionModes?.[id];
      return Boolean(mode && modes[id]?.testVisibility?.(source, mode, config) === true);
    });
  } finally {
    temporary?.destroy();
  }
}

export const commandPointVisible = (scene, actor, point) => commandPointsVisible(scene, actor, [point]);

/** Match native DoorControl surface sampling. Testing the wall's center itself
 * can put the target inside its own closed sight barrier. */
export function commandDoorVisible(scene, actor, door) {
  const coordinates = door?.c;
  if (!Array.isArray(coordinates) || coordinates.length !== 4 || !coordinates.every(Number.isFinite)) return false;
  const [x1, y1, x2, y2] = coordinates, x = (x1 + x2) / 2, y = (y1 + y2) / 2;
  const dx = y1 - y2, dy = x2 - x1, length = Math.abs(dx) + Math.abs(dy);
  if (!length) return false;
  const offset = 3 / length;
  return commandPointsVisible(scene, actor, [
    { x: x + dx * offset, y: y + dy * offset },
    { x: x - dx * offset, y: y - dy * offset }
  ], { object: door.object?.doorControl ?? null });
}
