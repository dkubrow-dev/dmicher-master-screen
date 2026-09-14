import { text } from "./localization.js";
import { getObjectBindings, getSceneObject, objectKey } from "./scene-objects.js";
import { getRuntime, getRuntimes, getObjectTags } from "./store.js";
import { objectCenter, sceneDistance } from "./scene-object-geometry.js";
import { isExecutionHalted } from "./execution.js";
import { generics } from "./generics.js";
import { normalizeObjectCommand, objectCommandConditionsMatch } from "./object-command-model.js";
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
export function validateCommandAccess(scene, packet, user, { active, selecting = false } = {}) {
  if (!scene || globalThis.canvas?.scene?.id !== scene.id || !user || generics.chat.isManagedIdentityUser(user)) {
    rejectCommand("scene", text("Команда недоступна на этой сцене.", "Commands are unavailable in this scene."));
  }
  const actor = commandDocument(scene, packet.actorTokenUuid), object = commandDocument(scene, packet.targetUuid);
  if (!actor?.actor || actor.documentName !== "Token" || !object || !user.isGM && (actor.hidden || object.hidden) || actor === object
    || !user.isGM && !actor.actor.testUserPermission?.(user, "OWNER")) {
    rejectCommand("identity", text("Выберите своего персонажа и доступный объект команды.", "Select your own character and an available command target."));
  }
  const target = { type: object.documentName, id: object.id }, binding = getObjectBindings(scene).bindings[objectKey(target)];
  const raw = binding?.commands?.find(entry => entry.id === packet.commandId);
  if (!raw || binding.playerCharacter) rejectCommand("disabled", text("Этот объект не принимает такую команду.", "This object does not accept that command."));
  const config = normalizeObjectCommand(raw), runtime = binding.groupId && getRuntime(scene, { groupId: binding.groupId });
  if (!runtime?.runId || isExecutionHalted(scene, runtime) || runtime.disabledObjects?.includes(objectKey(target)) && !["stop", "cancel"].includes(config.id)) {
    rejectCommand("stopped", text("Сначала мастер должен запустить автоматизацию объекта.", "The GM must start this object's automation first."));
  }
  if (!commandLevelsOverlap(actor, object)) rejectCommand("level", text("Персонаж и объект находятся на разных уровнях.", "The character and object are on different levels."));
  const distance = sceneDistance(scene, objectCenter(actor, scene), objectCenter(object, scene));
  if (!objectCommandConditionsMatch(config, { distance, tags: getObjectTags(scene, { type: "Token", id: actor.id }),
    groupStates: getRuntimes(scene).filter(run => run.runId && !isExecutionHalted(scene, run)).map(run => ({ groupId: run.groupId, stateId: run.stateId })) })) {
    if (distance > config.conditions.range) rejectCommand("range", text("Персонаж слишком далеко, чтобы отдать команду.", "Your character is too far away to give this command."));
    rejectCommand("conditions", text("Условия этой команды сейчас не выполнены.", "This command's conditions are not currently met."));
  }
  if (["come", "away", "go", "follow", "patrol", "open-door", "close-door"].includes(config.id) && !scriptObjectCapabilities(object).position) {
    rejectCommand("movement", text("Этот объект нельзя перемещать по карте.", "This object cannot move on the map."));
  }
  const issuer = config.parameters.issuer;
  if ((config.id === "stop" || config.id === "cancel") && !user.isGM && (issuer === "gm" || issuer === "commander" && active?.request.userId !== user.id)) {
    rejectCommand("issuer", text("У вас нет разрешения на эту команду.", "You do not have permission to give this command."));
  }
  if (active?.pendingReplacement && config.id !== "stop") rejectCommand("busy", text("Объект уже ожидает принятую команду. Дождитесь её выполнения.", "This object is already waiting for an accepted command. Wait for it to run."));
  if (active && !["stop", "cancel"].includes(config.id) && !(config.id === "wait" && ["come", "away", "go", "follow", "patrol", "open-door", "close-door"].includes(active.config.id))) {
    rejectCommand("busy", text("Объект уже выполняет другую команду. Дождитесь её завершения.", "This object is already carrying out a command. Wait for it to finish."));
  }
  if (!selecting && config.id === "cancel" && !active) rejectCommand("idle", text("У объекта нет команды, которую можно отменить.", "This object has no command to cancel."));
  return { scene, user, actor, object, target, binding, runtime, config };
}

/** Preview only; the elected GM repeats every check against current documents. */
export function availableObjectCommands(scene, target, actor, user, active) {
  if (!actor) return [];
  const object = getSceneObject(scene, target), binding = getObjectBindings(scene).bindings[objectKey(target)];
  if (!object) return [];
  return (binding?.commands ?? []).filter(config => {
    try { validateCommandAccess(scene, { actorTokenUuid: commandObjectUuid(actor), targetUuid: commandObjectUuid(object), commandId: config.id }, user, { active, selecting: true }); return true; }
    catch { return false; }
  });
}
