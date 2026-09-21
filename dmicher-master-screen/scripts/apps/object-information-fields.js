import { text as t } from "../localization.js";
import { escapeHTML as e, actionButton as button, textInput as input, selectOptions, formValue } from "./form-fields.js";
import { splitTags } from "./condition-fields.js";

export function renderObjectInformation(document, definitions, draft, { automationEnabled = true } = {}) {
  const facts = [[t("Название", "Name"), document.name ?? document.label ?? ""], [t("Тип", "Type"), draft.type], ["ID", document.id], ["UUID", document.uuid], ["Actor UUID", document.actor?.uuid ?? ""]];
  return `<dl class="ms-object-metadata">${facts.map(([label, value]) => `<dt>${e(label)}</dt><dd><span>${e(value)}</span>${button("copy-value", "⧉", `class="ms-copy-value" data-copy-value="${e(value)}" aria-label="${e(t(`Скопировать ${label}`, `Copy ${label}`))}"`)}</dd>`).join("")}</dl>
    <div class="ms-object-native-actions">${button("native-settings", t("Настройки", "Settings"))}${button("focus-object", t("К объекту", "Go to object"))}</div>
    ${input("object-display-name", t("Отображаемое имя", "Display name"), draft.displayName ?? "", 'maxlength="200"')}
    ${draft.type === "Token" ? `<label class="ms-check"><input type="checkbox" name="object-player-character"${draft.playerCharacter ? " checked" : ""}>${t("Персонаж игрока", "Player character")}</label>` : ""}
    <label class="ms-check"><input type="checkbox" name="object-automation-enabled"${automationEnabled ? " checked" : ""}>${t("Автоматизация включена", "Automation enabled")}</label>
    <label>${t("Группа", "Group")}<select name="object-group">${selectOptions(definitions.map(item => ({id: item.groupId, name: item.groupName})), draft.groupId, t("Без группы", "Unassigned"))}</select></label>
    ${input("object-tags", t("Теги, через запятую", "Tags, comma separated"), draft.tags?.join(", ") ?? "")}
    <label>${t("Заметки мастера", "GM notes")}<textarea name="object-notes" rows="4" maxlength="12000">${e(draft.notes)}</textarea></label>`;
}
export function readObjectInformation(element, draft) {
  return { ...draft, groupId: formValue(element, "object-group") || null, tags: splitTags(formValue(element, "object-tags")),
    displayName: formValue(element, "object-display-name").trim(), notes: formValue(element, "object-notes"),
    playerCharacter: draft.type === "Token" && element.querySelector('[name="object-player-character"]')?.checked === true };
}
