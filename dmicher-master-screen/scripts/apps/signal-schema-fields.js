import { text as t } from "../localization.js";
import { escapeHTML as e, formValue as value, parameterRow as cell } from "./form-fields.js";
import { localizedDescription } from "../model.js";
import { normalizeSignalFields } from "../signal-types.js";

const types = () => [["string", t("Текст", "Text")], ["integer", t("Целое число", "Integer")], ["number", t("Дробное число", "Number")], ["boolean", t("Логическое", "Boolean")]];
const options = (items, selected) => items.map(([id, label]) => `<option value="${e(id)}"${id === selected ? " selected" : ""}>${e(label)}</option>`).join("");
const control = (field, name, current, extra = "") => `<input name="field-${name}" value="${e(current)}" ${extra}${field.builtin ? " disabled" : ""}>`;
const description = (text, original) => text === localizedDescription(original) ? original : text;
const fieldDrafts = new WeakMap();

function renderDefault(field) {
  const mode = !Object.hasOwn(field, "default") ? "none" : field.default === null ? "null" : "value";
  const modes = [["none", t("Не задано", "Not set")], ["value", t("Значение", "Value")], ...(field.nullable ? [["null", "null"]] : [])];
  const disabled = field.builtin ? " disabled" : "";
  let editor = "";
  if (mode === "value") {
    if (field.type === "boolean") editor = `<select name="field-default-value"${disabled}>${options([["true", t("Да", "True")], ["false", t("Нет", "False")]], String(field.default))}</select>`;
    else editor = control(field, "default-value", field.default, field.type === "string" ? 'type="text"' : `type="number" step="${field.type === "integer" ? "1" : "any"}"`);
  }
  return `<div class="ms-signal-default"><select name="field-default-mode"${disabled}>${options(modes, mode)}</select>${editor}</div><input type="hidden" name="field-default" value="${e(mode === "none" ? "" : JSON.stringify(field.default))}">`;
}

export function renderSignalSchemaField(field, direction, index, { open = false, jsonOpen = false } = {}) {
  const disabled = field.builtin ? " disabled" : "";
  const number = (key, label, extra) => cell(label, control(field, key, field[key], extra));
  const constraints = field.type === "string" ? number("minLength", t("Минимальная длина", "Minimum length"), 'type="number" min="0" step="1"') + number("maxLength", t("Максимальная длина", "Maximum length"), 'type="number" min="0" step="1"')
    : ["integer", "number"].includes(field.type) ? number("min", t("Минимум", "Minimum"), `type="number" step="${field.type === "integer" ? "1" : "any"}"`) + number("max", t("Максимум", "Maximum"), `type="number" step="${field.type === "integer" ? "1" : "any"}"`) + (field.type === "number" ? number("decimals", t("Точность", "Decimals"), 'type="number" min="0" max="12" step="1"') : "") : "";
  return `<details class="ms-signal-field" data-signal-field="${direction}" data-index="${index}"${open ? " open" : ""}>
    <summary><span>${t("Имя", "Name")}</span>${control(field, "name", field.name, `required aria-label="${t("Имя", "Name")}"`)}</summary>
    <table class="ms-parameter-table ms-signal-field-table"><tbody>
      ${cell(t("Статус", "Status"), field.builtin ? t("Системное", "System") : t("Кастомное", "Custom"))}
      ${cell(t("Тип", "Type"), `<select name="field-type"${disabled}>${options(types(), field.type)}</select>`)}
      ${cell(t("Может быть null", "May be null"), `<input type="checkbox" name="field-nullable"${field.nullable ? " checked" : ""}${disabled}>`)}
      ${constraints}${cell(t("Значение по умолчанию", "Default value"), renderDefault(field))}
      ${cell(t("Описание", "Description"), `<textarea name="field-description" rows="2"${disabled}>${e(localizedDescription(field.description))}</textarea>`)}
      ${cell("JSON", `<button type="button" data-signal-json-toggle aria-expanded="${jsonOpen}">JSON</button>${field.builtin ? "" : `<button type="button" data-screen-action="removeSignalField" data-direction="${direction}" data-index="${index}" aria-label="${t("Удалить поле", "Remove field")}">×</button>`}`)}
    </tbody></table><div class="ms-signal-field-json"${jsonOpen ? "" : " hidden"}><textarea data-signal-field-json rows="8" spellcheck="false" aria-label="${t("JSON поля", "Field JSON")}"${field.builtin ? " readonly" : ""}>${e(JSON.stringify(field, null, 2))}</textarea>${field.builtin ? "" : `<button type="button" data-signal-json-apply>${t("Применить JSON", "Apply JSON")}</button>`}</div>
  </details>`;
}

export function renderSchema(fields, direction) {
  return `<div class="ms-signal-schema" data-signal-schema="${direction}">${fields.map((field, index) => renderSignalSchemaField(field, direction, index)).join("")}</div><button type="button" data-screen-action="addSignalField" data-direction="${direction}">+ ${t("Поле", "Field")}</button>`;
}

/** Reading preserves translated descriptions and does not validate an unfinished draft. */
export function readSignalSchemaField(row, original, { changingType = false } = {}) {
  original = fieldDrafts.get(row) ?? original;
  if (original.builtin) return original;
  const jsonEditor = row.querySelector('[data-signal-field-json]');
  // The owner may save directly from a button without a blur or native form validation.
  // Read the pending JSON then too; never silently persist the earlier table values.
  if (jsonEditor?.dataset?.dirty === "true") return normalizeSignalFields([{ ...JSON.parse(jsonEditor.value), builtin: false }])[0];
  const field = { name: value(row, "field-name"), type: value(row, "field-type"), nullable: row.querySelector('[name="field-nullable"]')?.checked === true, description: description(value(row, "field-description"), original.description) };
  const keys = field.type === "string" ? ["minLength", "maxLength"] : field.type === "number" ? ["min", "max", "decimals"] : field.type === "integer" ? ["min", "max"] : [];
  for (const key of keys) if (value(row, `field-${key}`) !== "") field[key] = Number(value(row, `field-${key}`));
  const defaultMode = row.querySelector('[name="field-default-mode"]');
  if (defaultMode) {
    if (defaultMode.value === "null") field.default = null;
    else if (defaultMode.value === "value") {
      if (changingType) field.default = original.default;
      else {
        const editor = row.querySelector('[name="field-default-value"]'), raw = editor?.value ?? "";
        if (editor && ["integer", "number"].includes(field.type) && (!raw.trim() || !Number.isFinite(Number(raw)))) throw new Error(t(`Поле «${field.name}»: укажите числовое значение по умолчанию.`, `Field “${field.name}”: enter a numeric default value.`));
        field.default = field.type === "boolean" ? raw === "true" : field.type === "string" ? raw : Number(raw);
      }
    }
  } else {
    const raw = value(row, "field-default");
    if (raw !== "") { try { field.default = JSON.parse(raw); } catch { throw new Error(t(`Поле «${field.name}»: исправьте JSON значения по умолчанию.`, `Field “${field.name}”: correct the default JSON.`)); } }
  }
  return field;
}

/** Local edits update only the field subtree, leaving the IDE selection and scroll intact. */
export function bindSignalFields(root, { getSignal, onChange = () => {}, onError = () => {} } = {}) {
  const replacing = new WeakSet();
  const originalFor = (row) => fieldDrafts.get(row) ?? getSignal?.()?.[row.dataset.signalField]?.[Number(row.dataset.index)];
  const updateRow = (row, field, jsonOpen = !row.querySelector('.ms-signal-field-json')?.hidden) => {
    const template = root.ownerDocument.createElement("template");
    template.innerHTML = renderSignalSchemaField(field, row.dataset.signalField, Number(row.dataset.index), { open: row.open, jsonOpen });
    const replacement = template.content.firstElementChild;
    fieldDrafts.set(replacement, field);
    // Replacing a focused textarea dispatches blur/change synchronously in Chromium.
    // Its stale editor must not start a second replacement of the same field subtree.
    replacing.add(row);
    try { row.replaceWith(replacement); } finally { replacing.delete(row); }
    return replacement;
  };
  const applyJSON = (row) => {
    if (replacing.has(row)) return;
    const original = originalFor(row), editor = row.querySelector('[data-signal-field-json]');
    if (!original || original.builtin) return;
    try {
      const field = normalizeSignalFields([{ ...JSON.parse(editor.value), builtin: false }])[0];
      updateRow(row, field, true); onChange();
    } catch (error) { editor.setCustomValidity(error.message); editor.reportValidity?.(); onError(error); }
  };
  const changed = (event) => {
    const row = event.target.closest?.("[data-signal-field]"); if (!row || !root.contains(row)) return;
    if (replacing.has(row)) return;
    const original = originalFor(row); if (!original || original.builtin) return;
    if (event.target.matches('[data-signal-field-json]')) { applyJSON(row); return; }
    try {
      let field = readSignalSchemaField(row, original, { changingType: event.target.name === "field-type" });
      if (event.target.name === "field-type") {
        // A type change invalidates the previous typed default; choose a value of the new type.
        if (Object.hasOwn(original, "default") && original.default !== null) field.default = field.type === "string" ? "" : field.type === "boolean" ? false : 0;
      }
      if (event.target.name === "field-nullable" && !field.nullable && field.default === null) delete field.default;
      if (["field-type", "field-nullable", "field-default-mode"].includes(event.target.name)) updateRow(row, field);
      else {
        const editor = row.querySelector('[data-signal-field-json]'); if (editor) editor.value = JSON.stringify(field, null, 2);
        const hidden = row.querySelector('[name="field-default"]'); if (hidden) hidden.value = Object.hasOwn(field, "default") ? JSON.stringify(field.default) : "";
        fieldDrafts.set(row, field);
      }
      onChange();
    } catch (error) { onError(error); }
  };
  const clicked = (event) => {
    if (event.target.matches('[name="field-name"]')) { event.stopPropagation(); return; }
    const button = event.target.closest?.('[data-signal-json-toggle],[data-signal-json-apply]'); if (!button || !root.contains(button)) return;
    event.preventDefault(); event.stopPropagation();
    const row = button.closest('[data-signal-field]'), original = originalFor(row); if (!original) return;
    const editor = row.querySelector('[data-signal-field-json]');
    if (button.hasAttribute('data-signal-json-toggle')) {
      const block = editor.parentElement; block.hidden = !block.hidden; button.setAttribute("aria-expanded", String(!block.hidden));
      if (!block.hidden) {
        try { editor.value = JSON.stringify(readSignalSchemaField(row, original), null, 2); } catch (error) { onError(error); }
        editor.focus();
      }
      return;
    }
    applyJSON(row);
  };
  const input = (event) => {
    if (event.target.matches('[data-signal-field-json]')) { event.target.dataset.dirty = "true"; event.target.setCustomValidity(""); return; }
    // Clearing a number is a normal intermediate keystroke; change/save still rejects it.
    if (event.target.matches('[name="field-default-value"][type="number"]') && !event.target.value.trim()) return;
    if (!["field-type", "field-nullable", "field-default-mode"].includes(event.target.name)) changed(event);
  };
  root.addEventListener("input", input); root.addEventListener("change", changed); root.addEventListener("click", clicked);
  return () => { root.removeEventListener("input", input); root.removeEventListener("change", changed); root.removeEventListener("click", clicked); };
}
