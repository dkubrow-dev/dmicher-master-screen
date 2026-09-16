import { text as t } from "../localization.js";
import { normalizeWorkspacePreset, windowTargetKey } from "../workspace-presets-model.js";
import { escapeHTML as esc, actionButton, formValue, formField, selectOptions } from "./form-fields.js";
import { selectableTreeAttributes } from "./navigation-tree.js";

export const presetSelectionKind = kind => kind === "notes" ? "notePreset" : "windowPreset";
const name = kind => kind === "notes" ? t("Заметки", "Notes") : t("Окна", "Windows");
const action = (id, label, kind, attributes = "") => actionButton(id, label, `data-preset-kind="${kind}" ${attributes}`);
const fieldName = (id, key) => `workspaceEntry:${id}:${key}`;
const valueInput = (field, value, attributes = "") => `<input name="${esc(field)}" value="${esc(value)}" ${attributes}>`;
const checkbox = (field, checked, label, readOnly) => `<label class="ms-check"><input type="checkbox" name="${esc(field)}"${checked ? " checked" : ""}${readOnly ? " disabled" : ""}>${esc(label)}</label>`;
const numberInput = (entry, field, readOnly, attributes = "") => valueInput(fieldName(entry.id, field), entry[field], `type="number" step="1" ${readOnly ? "disabled" : ""} ${attributes}`);

export function renderWorkspacePresetList(kind, presets, { selectedId = "", activeId = "", mode = "constructor" } = {}) {
  const buttons = `${mode === "constructor" ? action("captureWorkspacePreset", t("Сохранить текущий набор", "Capture current layout"), kind) : ""}${action("deactivateWorkspacePreset", t("Отменить конфигурацию", "Deactivate configuration"), kind, activeId ? "" : "disabled")}`;
  return `<div class="ms-ide-actions">${buttons}</div><table class="ms-ide-tree ms-workspace-presets" role="treegrid" aria-label="${esc(name(kind))}"><tbody>${presets.map(preset => {
    const selected = preset.id === selectedId;
    return `<tr role="row" aria-level="1" class="${selected ? "is-selected" : ""}" ${selectableTreeAttributes(presetSelectionKind(kind), preset.id, selected, esc)} data-ide-kind="${presetSelectionKind(kind)}" data-ide-id="${esc(preset.id)}"><td>${activeId === preset.id ? "● " : ""}${esc(preset.name)}</td><td>${preset.entries.length}</td><td>${action("applyWorkspacePreset", "▶", kind, `data-id="${esc(preset.id)}" title="${t("Применить конфигурацию", "Apply configuration")}"`)}</td></tr>`;
  }).join("") || `<tr><td>${t("Конфигураций пока нет.", "No configurations yet.")}</td></tr>`}</tbody></table>`;
}

function windowFields(draft, readOnly) {
  return `<label class="ms-field">${t("Активное окно", "Active window")}<select name="workspaceActiveWindow" ${readOnly ? "disabled" : ""}>${selectOptions(draft.entries.map(entry => ({ id: entry.id, name: entry.name || windowTargetKey(entry.target) })), draft.activeWindowId, t("Не менять", "Keep current"))}</select></label>
    <label class="ms-field">${t("Вкладка боковой панели", "Sidebar tab")}${valueInput("workspaceSidebarTab", draft.sidebarTab, readOnly ? "disabled" : "")}</label>
    ${checkbox("workspaceCloseUnmanaged", draft.closeUnmanaged, t("При переходе закрыть окна вне предыдущей конфигурации", "When switching, close windows outside the previous configuration"), readOnly)}
    ${draft.entries.map(entry => `<details class="ms-workspace-entry"><summary>${esc(entry.name || windowTargetKey(entry.target))}</summary><table class="ms-asset-table"><tbody>
      <tr><th>${t("Название", "Name")}</th><td colspan="3">${valueInput(fieldName(entry.id, "name"), entry.name, readOnly ? "disabled" : "")}</td></tr>
      <tr><th>x</th><td>${numberInput(entry, "x", readOnly)}</td><th>y</th><td>${numberInput(entry, "y", readOnly)}</td></tr>
      <tr><th>${t("Ширина", "Width")}</th><td>${numberInput(entry, "width", readOnly, 'min="50"')}</td><th>${t("Высота", "Height")}</th><td>${numberInput(entry, "height", readOnly, 'min="30"')}</td></tr>
      <tr><td colspan="4">${checkbox(fieldName(entry.id, "minimized"), entry.minimized, t("Свёрнуто", "Minimized"), readOnly)}${checkbox(fieldName(entry.id, "hidden"), entry.hidden, t("Скрыто", "Hidden"), readOnly)}${checkbox(fieldName(entry.id, "closeOnLeave"), entry.closeOnLeave, t("Закрывать при смене конфигурации", "Close when switching configurations"), readOnly)}</td></tr>
    </tbody></table>${!readOnly ? action("removeWorkspacePresetEntry", t("Убрать из конфигурации", "Remove from configuration"), "windows", `data-id="${esc(entry.id)}"`) : ""}</details>`).join("")}`;
}
function noteFields(draft, readOnly) {
  return draft.entries.map(entry => `<details class="ms-workspace-entry"><summary>${esc(entry.name || entry.data.text || entry.id)}</summary><table class="ms-asset-table"><tbody>
    <tr><th>${t("Название", "Name")}</th><td>${valueInput(fieldName(entry.id, "name"), entry.name, readOnly ? "disabled" : "")}</td></tr>
    <tr><th>${t("Текст на карте", "Map label")}</th><td>${valueInput(fieldName(entry.id, "text"), entry.data.text ?? "", readOnly ? "disabled" : "")}</td></tr>
    <tr><th>x</th><td>${valueInput(fieldName(entry.id, "x"), entry.data.x, `type="number" step="1" ${readOnly ? "disabled" : ""}`)}</td></tr>
    <tr><th>y</th><td>${valueInput(fieldName(entry.id, "y"), entry.data.y, `type="number" step="1" ${readOnly ? "disabled" : ""}`)}</td></tr>
    <tr><th>${t("Размер значка", "Icon size")}</th><td>${valueInput(fieldName(entry.id, "iconSize"), entry.data.iconSize ?? 40, `type="number" min="1" step="1" ${readOnly ? "disabled" : ""}`)}</td></tr>
    <tr><td colspan="2">${checkbox(fieldName(entry.id, "removeOnLeave"), entry.removeOnLeave, t("Удалять при смене конфигурации", "Remove when switching configurations"), readOnly)}</td></tr>
    </tbody></table>${!readOnly ? action("workspacePresetEntryJSON", "JSON", "notes", `data-id="${esc(entry.id)}"`) + action("removeWorkspacePresetEntry", t("Убрать из конфигурации", "Remove from configuration"), "notes", `data-id="${esc(entry.id)}"`) : ""}</details>`).join("");
}
export function renderWorkspacePresetForm(kind, draft, { mode = "constructor", active = false } = {}) {
  if (!draft) return `<p class="ms-note">${t("Выберите конфигурацию или сохраните текущий набор.", "Select a configuration or capture the current layout.")}</p>`;
  const readOnly = mode !== "constructor";
  return `<section class="ms-workspace-preset-form" data-ide-parameters data-workspace-preset-kind="${kind}"><h3>${esc(name(kind))}${active ? ` · ${t("Активна", "Active")}` : ""}</h3>
    <label class="ms-field">${t("Название конфигурации", "Configuration name")}${valueInput("workspacePresetName", draft.name, readOnly ? "disabled" : "")}</label>
    ${kind === "windows" ? windowFields(draft, readOnly) : noteFields(draft, readOnly)}
    <div class="ms-ide-actions">${!readOnly ? action("saveWorkspacePreset", t("Сохранить", "Save"), kind) + action("recaptureWorkspacePreset", t("Заменить текущим набором", "Replace with current layout"), kind) + action("deleteWorkspacePreset", t("Удалить конфигурацию", "Delete configuration"), kind) : ""}${action("applyWorkspacePreset", t("Применить", "Apply"), kind, `data-id="${esc(draft.id)}"`)}</div></section>`;
}
const checked = (root, field, fallback) => formField(root, field)?.checked ?? fallback;
export function readWorkspacePresetForm(root, kind, source) {
  if (!source || !root?.querySelector?.('[name="workspacePresetName"]')) return source;
  const draft = structuredClone(source); draft.name = formValue(root, "workspacePresetName", draft.name);
  if (kind === "windows") {
    draft.activeWindowId = formValue(root, "workspaceActiveWindow", draft.activeWindowId);
    draft.sidebarTab = formValue(root, "workspaceSidebarTab", draft.sidebarTab);
    draft.closeUnmanaged = checked(root, "workspaceCloseUnmanaged", draft.closeUnmanaged);
  }
  for (const entry of draft.entries) {
    entry.name = formValue(root, fieldName(entry.id, "name"), entry.name);
    if (kind === "windows") {
      for (const field of ["x", "y", "width", "height"]) entry[field] = Number(formValue(root, fieldName(entry.id, field), entry[field]));
      for (const field of ["minimized", "hidden", "closeOnLeave"]) entry[field] = checked(root, fieldName(entry.id, field), entry[field]);
    } else {
      entry.data.text = formValue(root, fieldName(entry.id, "text"), entry.data.text ?? "");
      for (const field of ["x", "y", "iconSize"]) entry.data[field] = Number(formValue(root, fieldName(entry.id, field), entry.data[field] ?? (field === "iconSize" ? 40 : 0)));
      entry.removeOnLeave = checked(root, fieldName(entry.id, "removeOnLeave"), entry.removeOnLeave);
    }
  }
  return normalizeWorkspacePreset(kind, draft);
}
