import { text } from "./localization.js";
import { getObjectBindings, getSceneObject, objectKey } from "./scene-objects.js";
import { getRuntime, getRuntimes, getObjectTags } from "./store.js";
import { objectCenter, sceneDistance, isSceneObjectHidden } from "./scene-object-geometry.js";
import { isExecutionHalted } from "./execution.js";
import { generics } from "./generics.js";
import { normalizeObjectCommand, objectCommandConditionsMatch, objectSupportsCommand, commandPermitsDisabledBehavior, commandStopsBehavior } from "./object-command-model.js";
import { commandParent, commandBehaviorEnabled, isCommandParentHalted } from "./object-command-state.js";
import { isStateEntryPreparing } from "./state-entry-preparation.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { scriptObjectCapabilities } from "./script-movement.js";

export class CommandRejection extends Error {
  constructor(code, message) { super(message); this.name = "CommandRejection"; this.code = code; }
}
export function rejectCommand(code, message) { throw new CommandRejection(code, message); }
export const commandObjectUuid = document => document.uuid ?? `Scene.${document.parent.id}.${document.documentName}.${document.id}`;

/** Only native documents of the named scene are command endpoints. */
export function commandDocument(scene, uuid) {
  const prefix = `${scene?.uuid ?? `Scene.${scene?.id}`}.`;
  if (typeof uuid !== "string" || !uuid.startsWith(prefix)) return null;
  const [type, id, extra] = uuid.slice(prefix.length).split(".");
  return !extra && Object.hasOwn(SCENE_OBJECT_COLLECTIONS, type) ? scene[SCENE_OBJECT_COLLECTIONS[type]]?.get(id) ?? null : null;
}
export function commandLevelsOverlap(first, second) {
  const levels = object => object?.level != null ? [object.level] : Array.from(object?.levels ?? []);
  const a = levels(first), b = levels(second);
  return !a.length || !b.length || a.some(level => b.includes(level));
}
export function validateCommandAccess(scene, packet, user, { active, selecting = false, trusted = false, ignoreRange = false } = {}) {
  if (!scene || globalThis.canvas?.scene?.id !== scene.id || !user || generics.chat.isManagedIdentityUser(user)) {
    rejectCommand("scene", text("Команда недоступна на этой сцене.", "Commands are unavailable in this scene."));
  }
  const method = packet.method ?? (user.isGM ? "gm" : "player");
  if (!["gm", "player", "delegated"].includes(method) || method === "gm" && !user.isGM)
    rejectCommand("issuer", text("У вас нет разрешения на эту команду.", "You do not have permission to give this command."));
  const object = commandDocument(scene, packet.targetUuid), commander = commandDocument(scene, packet.actorTokenUuid),
    delegate = method === "delegated" ? commandDocument(scene, packet.delegateTokenUuid) : null,
    actor = delegate ?? commander ?? (method === "gm" ? object : null);
  if (!object || !actor || !user.isGM && (isSceneObjectHidden(commander) || isSceneObjectHidden(object) || isSceneObjectHidden(delegate))
    || method !== "gm" && (!commander?.actor || commander.documentName !== "Token" || commander === object || !commander.actor.testUserPermission?.(user, "OWNER"))
    || method === "delegated" && (!delegate || delegate.documentName !== "Token" || delegate === object)) {
    rejectCommand("identity", text("Выберите своего персонажа и доступный объект команды.", "Select your own character and an available command target."));
  }
  const target = { type: object.documentName, id: object.id }, binding = getObjectBindings(scene).bindings[objectKey(target)];
  const raw = binding?.commands?.find(entry => entry.id === packet.commandId);
  if (!raw || binding.playerCharacter || !objectSupportsCommand(object.documentName, packet.commandId)) rejectCommand("disabled", text("Этот объект не принимает такую команду.", "This object does not accept that command."));
  const config = normalizeObjectCommand(raw), runtime = binding.groupId ? getRuntime(scene, { groupId: binding.groupId }) : commandParent(scene, binding);
  if (!config.permissions[method] || !config.enabled) rejectCommand("issuer", text("У вас нет разрешения на эту команду.", "You do not have permission to give this command."));
  if (!runtime?.runId || isStateEntryPreparing(scene,runtime) || isCommandParentHalted(scene, runtime) || !commandBehaviorEnabled(scene, target, runtime) && !commandPermitsDisabledBehavior(config.id)) {
    rejectCommand("stopped", text("Сначала мастер должен запустить автоматизацию объекта.", "The GM must start this object's automation first."));
  }
  if (method !== "gm" && !commandLevelsOverlap(actor, object)) rejectCommand("level", text("Персонаж и объект находятся на разных уровнях.", "The character and object are on different levels."));
  const distance = method === "gm" || ignoreRange ? 0 : sceneDistance(scene, objectCenter(actor, scene), objectCenter(object, scene));
  if (!trusted && !objectCommandConditionsMatch(config, { distance, tags: method === "gm" ? config.conditions.allowTags : getObjectTags(scene, { type: actor.documentName, id: actor.id }),
    groupStates: getRuntimes(scene).filter(run => run.runId && !isExecutionHalted(scene, run)).map(run => ({ groupId: run.groupId, stateId: run.stateId })) })) {
    if (distance > config.conditions.range) rejectCommand("range", text("Персонаж слишком далеко, чтобы отдать команду.", "Your character is too far away to give this command."));
    rejectCommand("conditions", text("Условия этой команды сейчас не выполнены.", "This command's conditions are not currently met."));
  }
  if (["come", "away", "go", "follow", "patrol", "open-door", "close-door", "delegate"].includes(config.id) && !scriptObjectCapabilities(object).position) {
    rejectCommand("movement", text("Этот объект нельзя перемещать по карте.", "This object cannot move on the map."));
  }
  if (["open", "close"].includes(config.id) && (object.documentName !== "Wall" || !object.door)) rejectCommand("door", text("Команда доступна только для двери.", "This command is available only for doors."));
  if (["open", "close"].includes(config.id) && object.ds === (globalThis.CONST?.WALL_DOOR_STATES?.LOCKED ?? 2)) rejectCommand("locked", text("Дверь заперта.", "The door is locked."));
  if (method === "delegated") {
    const delegation = getObjectBindings(scene).bindings[`Token:${delegate.id}`]?.commands?.find(entry => entry.id === "delegate");
    if (!delegation?.enabled) rejectCommand("delegation", text("Выбранный персонаж не принимает поручения.", "The selected character does not accept delegated tasks."));
  }
  const issuer = config.parameters.issuer;
  if ((config.id === "stop" || config.id === "cancel") && !user.isGM && (issuer === "gm" || issuer === "commander" && active?.request.userId !== user.id)) {
    rejectCommand("issuer", text("У вас нет разрешения на эту команду.", "You do not have permission to give this command."));
  }
  if (active?.pendingReplacement && !commandStopsBehavior(config.id)) rejectCommand("busy", text("Объект уже ожидает принятую команду. Дождитесь её выполнения.", "This object is already waiting for an accepted command. Wait for it to run."));
  if (active && !commandStopsBehavior(config.id) && config.id !== "cancel" && !(config.id === "wait" && ["come", "away", "go", "follow", "patrol", "open-door", "close-door", "delegate"].includes(active.config.id))) {
    rejectCommand("busy", text("Объект уже выполняет другую команду. Дождитесь её завершения.", "This object is already carrying out a command. Wait for it to finish."));
  }
  if (!selecting && config.id === "cancel" && !active) rejectCommand("idle", text("У объекта нет команды, которую можно отменить.", "This object has no command to cancel."));
  return { scene, user, actor, commander, delegate, method, object, target, binding, runtime, config };
}

/** Preview only; the elected GM repeats every check against current documents. */
export function availableObjectCommands(scene, target, actor, user, active, { method = user?.isGM ? "gm" : "player", delegate } = {}) {
  if (!actor && method !== "gm") return [];
  const object = getSceneObject(scene, target), binding = getObjectBindings(scene).bindings[objectKey(target)];
  if (!object) return [];
  return (binding?.commands ?? []).filter(config => {
    if (config.id === "delegate" && !actor) return false;
    if (method === "delegated" && !delegate) return availableCommandDelegates(scene, target, actor, user, config.id, { active }).length > 0;
    try { validateCommandAccess(scene, { actorTokenUuid: actor ? commandObjectUuid(actor) : "", targetUuid: commandObjectUuid(object), commandId: config.id, method,
      ...(delegate ? { delegateTokenUuid: commandObjectUuid(delegate) } : {}) }, user, { active, selecting: true, ignoreRange: method === "delegated" }); return true; }
    catch { return false; }
  }).map(config => ({ ...config, method, gmOnly: method === "gm" }));
}

/** A delegated menu entry needs both an eligible intermediary and a separately
 * authorized endpoint. Preview never reserves either object or persists data. */
export function availableCommandDelegates(scene, target, actor, user, commandId, { active } = {}) {
  if (!actor) return [];
  const object = getSceneObject(scene, target); if (!object) return [];
  return [...(scene.tokens?.values?.() ?? [])].filter(delegate => {
    if (delegate === actor || delegate === object) return false;
    const command = scene.getFlag?.("dmicher-master-screen", "objectCommandRuns")?.[`Token:${delegate.id}`];
    try {
      validateCommandAccess(scene, { actorTokenUuid: commandObjectUuid(actor), targetUuid: commandObjectUuid(delegate), commandId: "delegate", method: "player" }, user, { active: command, selecting: true });
      validateCommandAccess(scene, { actorTokenUuid: commandObjectUuid(actor), targetUuid: commandObjectUuid(object), commandId, method: "delegated", delegateTokenUuid: commandObjectUuid(delegate) }, user, { active, selecting: true, ignoreRange: true });
      return true;
    } catch { return false; }
  });
}
