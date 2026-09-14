import { text } from "./localization.js";
import { commandDocument, rejectCommand } from "./object-command-access.js";
import { advanceCommandMovement, approachCommandPoint, commandCenter, commandScale, commandTouches, clipCommandMovement } from "./object-command-movement.js";
import { planScriptFollow, advanceScriptFollow, boundsGap } from "./script-target-movement.js";
import { scriptObjectBounds } from "./script-movement.js";

const active = options => !options.signal?.aborted && (options.isCurrent?.() ?? true);
const finished = done => ({ done });
function target(scene, uuid) {
  const document = commandDocument(scene, uuid);
  if (!document) rejectCommand("target-missing", text("Объект команды больше не находится на сцене.", "The command target is no longer in the scene."));
  return document;
}
function nearestDoorPoint(door, origin) {
  const [x, y, endX, endY] = door.c, dx = endX - x, dy = endY - y, squared = dx * dx + dy * dy;
  const ratio = squared ? Math.max(0, Math.min(1, ((origin.x - x) * dx + (origin.y - y) * dy) / squared)) : 0;
  return { x: x + dx * ratio, y: y + dy * ratio };
}
function pointGap(scene, object, point) {
  return boundsGap(scriptObjectBounds(object, scene), { ...point, width: 0, height: 0 });
}

/** One coarse engine tick, using only this command's prepared state. The caller
 * owns persistence, phase scripts, interruptions, and the single-command lock. */
export class ObjectCommandCore {
  constructor({ lights } = {}) { this.lights = lights; }

  async tick(scene, run, object, elapsed, options = {}) {
    if (!active(options)) return finished(false);
    const core = run.core ??= {}, { id, parameters: p } = run.config;
    const seconds = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    const movementOptions = { ...options, progress: core.movement ??= {} };
    const move = (point, budget = seconds) => advanceCommandMovement(scene, object, point, p.speed, budget, movementOptions);
    const wait = (duration, budget = seconds) => {
      core.waitRemaining ??= duration;
      core.waitRemaining = Math.max(0, core.waitRemaining - budget);
      return finished(core.waitRemaining === 0);
    };
    switch (id) {
      case "wait": return wait(p.seconds);
      case "cancel": return wait(p.waitSeconds);
      case "stop": return finished(true);
      case "light-on":
        await this.lights.on(scene, object, p, options);
        return finished(active(options));
      case "light-off":
        await this.lights.off(scene, object, options);
        return finished(active(options));
      case "come": case "away": {
        const actor = target(scene, run.request.actorTokenUuid);
        core.remaining ??= p.duration;
        if (id === "come" && commandTouches(scene, object, actor)) return finished(true);
        if (id === "away" && !core.destination) {
          const from = commandCenter(object, scene), to = commandCenter(actor, scene), distance = Math.hypot(from.x - to.x, from.y - to.y);
          const length = p.speed * p.duration * commandScale(scene);
          core.destination = { x: from.x + (distance ? (from.x - to.x) / distance : 1) * length,
            y: from.y + (distance ? (from.y - to.y) / distance : 0) * length };
        }
        const result = await move(id === "come" ? approachCommandPoint(scene, object, actor) : core.destination, Math.min(seconds, core.remaining));
        if (!active(options)) return finished(false);
        core.remaining = Math.max(0, core.remaining - seconds);
        return finished(result.done || core.remaining === 0);
      }
      case "go": {
        if (core.stage === "wait") return wait(p.waitSeconds);
        core.remaining ??= p.duration;
        const budget = Math.min(seconds, core.remaining), result = await move(run.request.parameters.point, budget);
        if (!active(options)) return finished(false);
        core.remaining = Math.max(0, core.remaining - budget);
        if (!result.done && core.remaining > 0) return finished(false);
        core.stage = "wait";
        // Unspent time of this tick may enter the final wait; no second timer.
        return wait(p.waitSeconds, Math.max(0, seconds - (result.done ? result.consumed : budget)));
      }
      case "follow": {
        const parameters = { ...p, targetUuid: run.request.actorTokenUuid, mode: p.mode === "direct" ? "direct" : "trajectory", finishOn: "state-change" };
        core.follow ??= planScriptFollow(scene, object, parameters);
        await advanceScriptFollow(scene, object, core.follow, parameters, seconds, { ...options, collisionClip: clipCommandMovement });
        return finished(false);
      }
      case "patrol": {
        core.pointIndex ??= 0;
        const result = await move(run.request.parameters.points[core.pointIndex]);
        if (!active(options)) return finished(false);
        if (result.blocked) return finished(true);
        if (result.done) { core.pointIndex = 1 - core.pointIndex; core.movement.distanceBudget = 0; }
        return finished(false);
      }
      case "open-door": case "close-door": {
        const door = target(scene, run.request.parameters.doorUuid);
        if (door.documentName !== "Wall" || !door.door || !Array.isArray(door.c) || door.c.length !== 4) {
          rejectCommand("door", text("Выберите дверь на карте.", "Select a door on the map."));
        }
        const states = globalThis.CONST?.WALL_DOOR_STATES ?? { CLOSED: 0, OPEN: 1, LOCKED: 2 };
        if (door.ds === states.LOCKED) rejectCommand("door-locked", text("Дверь заперта. Объект не может выполнить команду.", "The door is locked. The object cannot carry out this command."));
        const desired = id === "open-door" ? states.OPEN : states.CLOSED;
        if (door.ds === desired) return finished(true);
        const point = nearestDoorPoint(door, commandCenter(object, scene));
        if (pointGap(scene, object, point) > 2) {
          const destination = approachCommandPoint(scene, object, { documentName: "Wall", c: [point.x, point.y, point.x, point.y] });
          const result = await move(destination);
          if (!active(options)) return finished(false);
          if (pointGap(scene, object, point) > 2) {
            if (result.blocked) rejectCommand("door-obstacle", text("Объект не может добраться до двери: путь перекрыт.", "The object cannot reach the door because the path is blocked."));
            return finished(false);
          }
        }
        if (!active(options)) return finished(false);
        if (door.ds === states.LOCKED) rejectCommand("door-locked", text("Дверь заперта. Объект не может выполнить команду.", "The door is locked. The object cannot carry out this command."));
        await door.update({ ds: desired });
        return finished(active(options));
      }
      default: rejectCommand("unknown", text("Эта команда недоступна.", "This command is unavailable."));
    }
  }
}
