import { text } from "./localization.js";
import { commandDocument, rejectCommand } from "./object-command-access.js";
import { advanceCommandMovement, approachCommandPoint, commandCenter, commandScale, commandTouches, clipCommandMovement } from "./object-command-movement.js";
import { planScriptFollow, advanceScriptFollow, boundsGap } from "./script-target-movement.js";
import { scriptObjectBounds } from "./script-movement.js";
import { setCommandSignals, setCommandBehavior } from "./object-command-state.js";

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
      case "behavior-off": return finished(true);
      case "behavior-on":
        await setCommandBehavior(scene, run.target, true, run.groupId); return finished(active(options));
      case "signals-on": case "signals-off":
        await setCommandSignals(scene, run.target, id === "signals-on"); return finished(active(options));
      case "visible": case "invisible":
        if (object.documentName === "Note") {
          await object.update({ [`flags.dmicher-master-screen.commandHidden`]: id === "invisible" });
          if (object.object) object.object.visible = id === "visible";
        } else await object.update({ hidden: id === "invisible" });
        return finished(active(options));
      case "source-on": case "source-off":
        await object.update({ hidden: id === "source-off" }); return finished(active(options));
      case "note-open": {
        const journal = object.page ?? object.entry;
        if (!journal) rejectCommand("note", text("В заметке не выбран доступный журнал.", "This note has no available journal."));
        // Presentation for the issuing player is delivered by the service;
        // document permissions are checked again on that receiving client.
        await options.openNote?.(object, run); return finished(active(options));
      }
      case "open": case "close": {
        const states = globalThis.CONST?.WALL_DOOR_STATES ?? { CLOSED: 0, OPEN: 1, LOCKED: 2 };
        if (!object.door || object.ds === states.LOCKED) rejectCommand("locked", text("Дверь заперта или больше недоступна.", "The door is locked or no longer available."));
        await object.update({ ds: id === "open" ? states.OPEN : states.CLOSED }, { dmicherCommand: { userId: run.request.userId, actorTokenUuid: run.request.actorTokenUuid, delegateTokenUuid: run.request.delegateTokenUuid } });
        return finished(active(options));
      }
      // A deleted document cannot run a trailing script. This one command delays
      // its irreversible native delete until the phase executor completes after.
      case "delete": return finished(true);
      case "delegate": {
        const recipient = target(scene, run.request.parameters.targetUuid), config = run.request.parameters;
        if (!core.arrived) {
          // Door travel is an internal part of delegation. Approach the nearest
          // point of its segment, preserving footprint contact and collisions.
          const doorPoint = recipient.documentName === "Wall" && recipient.door ? nearestDoorPoint(recipient, commandCenter(object, scene)) : null;
          const destination = doorPoint ? { documentName: "Wall", c: [doorPoint.x, doorPoint.y, doorPoint.x, doorPoint.y] } : recipient;
          const result = await move(approachCommandPoint(scene, object, destination));
          if (!active(options)) return finished(false);
          const touches = doorPoint ? pointGap(scene, object, doorPoint) <= 2 : commandTouches(scene, object, recipient);
          if (result.blocked && !touches) rejectCommand("delegation-path", text("Не удалось подойти к объекту поручения: путь перекрыт.", "The delegated character cannot reach the target because the path is blocked."));
          if (!result.done && !touches) return finished(false);
          core.arrived = true;
        }
        return options.delegate ? options.delegate(run, config) : finished(false);
      }
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
      default: rejectCommand("unknown", text("Эта команда недоступна.", "This command is unavailable."));
    }
  }
}
