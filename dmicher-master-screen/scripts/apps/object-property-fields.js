import { text as t } from "../localization.js";
import { escapeHTML as e, actionButton as button, textInput as input, selectOptions, formValue } from "./form-fields.js";
import { buildConditionFields, readConditionFields } from "./condition-fields.js";
import { normalizeObjectVariables } from "../object-variables.js";
const check = (name, label, value) => `<label class="ms-check"><input type="checkbox" name="${e(name)}"${value ? " checked" : ""}>${e(label)}</label>`;

export function renderObjectVariables(variables = []) {
  return `<table class="ms-object-variables"><thead><tr><th>${t("Имя", "Name")}</th><th>${t("Тип", "Type")}</th><th>${t("Исходное значение", "Default value")}</th><th>${t("Доступ", "Access")}</th><th></th></tr></thead><tbody>${variables.map((variable, i) => `<tr data-object-variable="${i}"><td><input name="variable-${i}-name" value="${e(variable.name)}" maxlength="128" required></td><td><select name="variable-${i}-type">${selectOptions([{id:"text",name:t("Текст","Text")},{id:"integer",name:t("Целое","Integer")},{id:"number",name:t("Число","Number")}],variable.type)}</select></td><td><input name="variable-${i}-value" value="${e(variable.value)}"${variable.type === "text" ? "" : ` type="number" step="${variable.type === "integer" ? "1" : "any"}"`}></td><td>${check(`variable-${i}-internal`,t("Внутреннее изменение","Internal write"),variable.access?.internal !== false)}${check(`variable-${i}-externalRead`,t("Внешний просмотр","External read"),variable.access?.externalRead)}${check(`variable-${i}-externalWrite`,t("Внешнее изменение","External write"),variable.access?.externalWrite)}</td><td>${button("remove-variable","×",`data-index="${i}"`)}</td></tr>`).join("")}</tbody></table>${button("add-variable",`+ ${t("Переменная","Variable")}`)}`;
}
export function readObjectVariables(element, original) {
  if (!element.querySelector(".ms-object-variables")) return original;
  return normalizeObjectVariables([...element.querySelectorAll("[data-object-variable]")].map(row => {
    const i = row.dataset.objectVariable, type = formValue(element,`variable-${i}-type`), value = formValue(element,`variable-${i}-value`);
    return { name: formValue(element,`variable-${i}-name`), type, value: type === "text" ? value : Number(value),
      access: Object.fromEntries(["internal","externalRead","externalWrite"].map(key => [key,element.querySelector(`[name="variable-${i}-${key}"]`).checked])) };
  }));
}
export function renderObjectActionList(actions = [], selected) {
  return `<table><tbody>${actions.map(action => `<tr><td>${e(action.name)}</td><td>${e(action.enabled ? t("Включено","Enabled") : t("Выключено","Disabled"))}</td><td>${button("edit-action",t("Править","Edit"),`data-id="${e(action.id)}" aria-pressed="${action.id === selected}"`)}${button("remove-action","×",`data-id="${e(action.id)}"`)}</td></tr>`).join("")}</tbody></table>${button("add-action",`+ ${t("Действие","Action")}`)}`;
}
export function renderObjectAction(action, definition) {
  return `<div data-object-action>${input("action-name",t("Название","Name"),action.name)}${check("action-enabled",t("Включено","Enabled"),action.enabled)}
    <label>${t("Кому доступно","Available to")}<select name="action-audience">${selectOptions([{id:"players",name:t("Игрокам","Players")},{id:"gm",name:t("Мастеру","GM")},{id:"all",name:t("Всем","Everyone")}],action.audience)}</select></label>
    ${input("action-range",t("Дальность","Range"),action.range,'type="number" min="0" step="any"')}${input("action-order",t("Порядок","Order"),action.order ?? 0,'type="number" min="0" step="1"')}
    ${check("action-unavailable",t("Показывать в меню, если недоступно","Show in menu when unavailable"),action.showWhenUnavailable)}
    ${buildConditionFields(action.conditions,definition?.states ?? [],{prefix:"action-conditions",groupId:definition?.groupId,groupName:definition?.groupName})}
    <label>${t("Параметры действия (JSON)","Action parameters (JSON)")}<textarea name="action-parameters" rows="3">${e(JSON.stringify(action.parameters ?? {},null,2))}</textarea></label>
    ${renderConditionMacro("action-macro",action.conditionMacro)}
    </div>`;
}
export function renderConditionMacro(name, code = "") {
  return `<details class="ms-condition-macro"><summary>${t("Макрос условия","Condition macro")}</summary><p class="ms-note">${t("Возвращает true или false. Для чтения доступны GetValue, objectUuid, variables, stateId. Пустое условие разрешает действие.","Returns true or false. GetValue, objectUuid, variables and stateId are available for reading. An empty condition allows the action.")}</p><textarea name="${e(name)}" rows="6" spellcheck="false">${e(code ?? "")}</textarea>${button("condition-template",t("Шаблон","Template"),`data-field="${e(name)}"`)}</details>`;
}
export function readObjectAction(element, original) {
  if (!element.querySelector("[data-object-action]")) return original;
  return {...original,name:formValue(element,"action-name"),enabled:element.querySelector('[name="action-enabled"]').checked,
    audience:formValue(element,"action-audience"),range:Number(formValue(element,"action-range")),order:Number(formValue(element,"action-order")),
    showWhenUnavailable:element.querySelector('[name="action-unavailable"]').checked,conditions:readConditionFields(element,"action-conditions"),
    conditionMacro:formValue(element,"action-macro"),parameters:JSON.parse(formValue(element,"action-parameters"))};
}
