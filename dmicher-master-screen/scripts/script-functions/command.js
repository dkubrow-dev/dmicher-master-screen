import { text as t } from "../localization.js";
import { requireText, json } from "./parameters.js";
import { isSceneObjectType } from "../scene-object-types.js";
const fail = message => { throw new Error(message); };
async function commandTarget(scene, uuid) {
  const { getSceneObject } = await import("../scene-objects.js");
  const parts = String(uuid ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "Scene" || parts[1] !== scene.id || !isSceneObjectType(parts[2])) fail(t("Команда требует UUID объекта текущей сцены.", "The command requires an object UUID in the current scene."));
  const document = getSceneObject(scene, { type: parts[2], id: parts[3] });
  if (!document) fail(t("Объект команды больше не существует.", "The command target no longer exists."));
  return document;
}

export async function execute({ engine, scene, object, p, admitted }) {
  if (!admitted()) return {};
  if (!engine.runtime.commandService?.invokeFromScript) throw new Error(t("Исполнение команды скрипта не подключено.", "Script command execution is not connected."));
  const target = await commandTarget(scene, p.objectUuid);
  if (!admitted()) return {};
  await engine.runtime.commandService.invokeFromScript({ scene, target, commander: object, commandId: p.commandId,
    parameters: structuredClone(p.parameters), context: { isCurrent: admitted } });
  return {};
}

export default Object.freeze({
  id: "command", label: {"ru":"Команда","en":"Command"},
  category: {"ru":"объекты.взаимодействие","en":"objects.interaction"},
  description: { ru: "Передаёт выбранному объекту встроенную команду от имени исполнителя и ждёт её завершения.", en: "Sends a built-in command to the selected object on behalf of the executor and waits for completion." },
  scopes: ["object"], premium: false,
  template: {"objectUuid":"","commandId":"","parameters":{}},
  normalize: p => ({ objectUuid: requireText(p.objectUuid ?? "", 2048, t("UUID объекта", "Object UUID")),
    commandId: requireText(p.commandId ?? "", 100, t("Команда", "Command")), parameters: json(p.parameters) }),
  execute
});
