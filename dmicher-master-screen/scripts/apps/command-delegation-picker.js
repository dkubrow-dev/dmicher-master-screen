import { text as t } from "../localization.js";
import { getObjectBindings, getSceneObject } from "../scene-objects.js";
import { availableCommandDelegates, availableObjectCommands } from "../object-command-access.js";
import { objectCommandName } from "../object-command-model.js";
import { escapeHTML as e } from "./form-fields.js";

async function select(entries, title, label) {
  if (!entries.length) { globalThis.ui?.notifications?.warn?.(t("Сейчас нет доступного поручения. Проверьте права команды, дальность и состояние объектов.", "No delegated task is available. Check command permissions, range and object states.")); return null; }
  const index = await foundry.applications.api.DialogV2.prompt({ window: { title }, rejectClose: false,
    content: `<label>${e(label)}<select name="command-delegation-choice">${entries.map((entry, i) => `<option value="${i}">${e(entry.name)}</option>`).join("")}</select></label>`,
    ok: { label: t("Выбрать", "Select"), callback: (_event, _button, dialog) => dialog.element.querySelector('[name="command-delegation-choice"]').value } });
  return index !== null && index !== undefined && index !== false ? entries[Number(index)]?.value ?? null : null;
}

/** Called from an endpoint's delegated command menu before picking map input. */
export async function chooseCommandDelegate(scene, target, actorTokenId, commandId, user = game.user) {
  const actor = scene.tokens?.get(actorTokenId), choices = availableCommandDelegates(scene, target, actor, user, commandId);
  return select(choices.map(document => ({ name: document.name, value: document.id })), t("Поручить команду", "Delegate command"), t("Кто выполнит поручение", "Character to carry out the task"));
}

/** Called from a token's own Delegate entry; choosing only saved, enabled
 * endpoint commands cannot invent an unrestricted action on another object. */
export async function chooseDelegatedTask(scene, delegateTarget, actorTokenId, user = game.user) {
  const actor = scene.tokens?.get(actorTokenId), delegate = getSceneObject(scene, delegateTarget), entries = [];
  if (!actor || delegate?.documentName !== "Token") return null;
  for (const binding of Object.values(getObjectBindings(scene).bindings)) {
    const object = getSceneObject(scene, binding); if (!object || object === delegate) continue;
    const active = scene.getFlag?.("dmicher-master-screen", "objectCommandRuns")?.[`${binding.type}:${binding.id}`];
    for (const command of availableObjectCommands(scene, binding, actor, user, active, { method: "delegated", delegate })) {
      if (command.id === "delegate") continue;
      entries.push({ name: `${object.name ?? object.documentName} · ${objectCommandName(command.id, object.documentName)}`,
        value: { target: { type: binding.type, id: binding.id }, commandId: command.id, delegateTokenId: delegate.id } });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return select(entries, t("Поручение", "Delegate"), t("Объект и команда", "Object and command"));
}
