import { text as t } from "../localization.js";
import { normalizeDialoguePresentation } from "../interaction-model.js";
import { escapeHTML as esc, textInput, selectOptions, formValue } from "./form-fields.js";
import { selectableTreeAttributes } from "./navigation-tree.js";

const select = (name, label, rows, value) => `<label class="ms-field">${esc(label)}<select name="${name}">${selectOptions(rows.map(([id, name]) => ({ id, name })), value)}</select></label>`;

export function renderDialoguePresentation(draft, readOnly = false) {
  const value = normalizeDialoguePresentation(draft.presentation);
  const modes = [["chat", t("Чат", "Chat")], ["window", t("Отдельное окно", "Separate window")]];
  const publications = [["none", t("Не выводить", "Do not publish")], ["replies", t("По репликам", "Per line")],
    ["complete", t("По завершении без запроса", "On completion without confirmation")], ["confirm", t("По завершении с запросом", "On completion with confirmation")]];
  const visibility = [["private", t("Приватный", "Private")], ["public", t("Публичный", "Public")], ["player", t("По настройке игрока", "Use player setting")]];
  const input = (name, label, content, attributes = "") => textInput(name, label, content, attributes, "ms-field");
  return `<fieldset ${readOnly ? "disabled" : ""} data-dialogue-presentation>${select("dialogueDisplayMode", t("Режим отображения", "Display mode"), modes, value.mode)}
    ${value.mode === "window" ? select("dialogueWindowChat", t("Публикация в чат", "Chat publication"), publications, value.windowChat) : ""}
    ${select("dialogueVisibility", t("Видимость диалога", "Dialogue visibility"), visibility, value.visibility)}
    ${value.visibility === "private" ? "" : `<fieldset><legend>${t("Публичная аудитория", "Public audience")}</legend>
      ${input("dialogueAudienceAllowTags", t("Белые теги аудитории", "Allowed audience tags"), value.publicAudience.allowTags.join(", "))}
      ${input("dialogueAudienceDenyTags", t("Чёрные теги аудитории", "Denied audience tags"), value.publicAudience.denyTags.join(", "))}
      ${input("dialogueAudienceRange", t("Дальность аудитории", "Audience range"), value.publicAudience.range ?? "", 'type="number" min="0" step="any"')}
      <p class="ms-note">${t("Пустая дальность — без ограничения. Расстояние задаётся в единицах сцены.", "Empty range means unlimited. Distance uses scene units.")}</p></fieldset>`}</fieldset>`;
}

/** Only visible fields change; switching a display mode retains its other settings. */
export function readDialoguePresentation(root, source) {
  const value = normalizeDialoguePresentation(source), field = name => root.querySelector(`[name="${name}"]`);
  for (const [name, key] of [["dialogueDisplayMode", "mode"], ["dialogueWindowChat", "windowChat"], ["dialogueVisibility", "visibility"]]) {
    if (field(name)?.value) value[key] = formValue(root, name);
  }
  for (const [name, key] of [["dialogueAudienceAllowTags", "allowTags"], ["dialogueAudienceDenyTags", "denyTags"]]) {
    if (field(name)) value.publicAudience[key] = formValue(root, name).split(",").map(tag => tag.trim()).filter(Boolean);
  }
  if (field("dialogueAudienceRange")) {
    const control = field("dialogueAudienceRange"), entered = control.value.trim();
    if (control.checkValidity?.() === false) throw new Error(t("Укажите неотрицательную дальность или оставьте поле пустым.", "Enter a non-negative range or leave the field empty."));
    value.publicAudience.range = entered === "" ? null : Number(entered);
  }
  return normalizeDialoguePresentation(value);
}

export function renderDialogueTree(dialogues, selection, folded = new Set()) {
  const rows = dialogues.flatMap(dialogue => {
    const current = selection.kind === "dialogue" && selection.id === dialogue.id;
    const chosen = current && !selection.pageId, collapsed = folded.has(dialogue.id);
    const parent = `<tr role="row" aria-level="1" ${selectableTreeAttributes("dialogue", dialogue.id, chosen, esc)} class="${chosen ? "is-selected" : ""}">
      <td><button type="button" class="ms-tree-toggle" data-screen-action="foldDialogue" data-id="${esc(dialogue.id)}" aria-expanded="${!collapsed}" aria-label="${t("Свернуть или раскрыть диалог", "Collapse or expand dialogue")}">${collapsed ? "▸" : "▾"}</button><span class="ms-tree-name">${esc(dialogue.name)}</span></td><td>${dialogue.pages.length}</td></tr>`;
    return [parent, ...dialogue.pages.map(page => {
      const selected = current && selection.pageId === page.id;
      return `<tr role="row" aria-level="2" ${selectableTreeAttributes("dialogue", dialogue.id, selected, esc)} data-page-id="${esc(page.id)}" class="${selected ? "is-selected" : ""}" ${collapsed ? "hidden" : ""}>
        <td><span class="ms-tree-name ms-tree-child">${esc(page.name)}</span></td><td>${page.id === dialogue.startPageId ? t("Первый блок", "First page") : ""}</td></tr>`;
    })];
  });
  return `<table class="ms-ide-tree" role="treegrid" aria-label="${t("Диалоги и блоки", "Dialogues and pages")}"><tbody>${rows.join("")}</tbody></table>`;
}
