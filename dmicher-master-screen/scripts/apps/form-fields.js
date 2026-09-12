import { generics } from "../generics.js";

export const escapeHTML = (value) => generics.utilities.escapeHTML(String(value ?? ""));

// Attribute fragments come from these renderers' callers, never from scene data.
// Labels, values, names and action IDs always remain text.
export function actionButton(action, label, attributes = "") {
  return `<button type="button" data-screen-action="${escapeHTML(action)}" ${attributes}>${escapeHTML(label)}</button>`;
}

export function textInput(name, label, value = "", attributes = "", labelClass = "") {
  return `<label${labelClass ? ` class="${escapeHTML(labelClass)}"` : ""}>${escapeHTML(label)}<input name="${escapeHTML(name)}" value="${escapeHTML(value)}" ${attributes}></label>`;
}

export function selectOptions(items, selected, blank) {
  const empty = blank === undefined ? "" : `<option value="">${escapeHTML(blank)}</option>`;
  return empty + items.map(({ id, name }) => `<option value="${escapeHTML(id)}"${String(id) === String(selected) ? " selected" : ""}>${escapeHTML(name)}</option>`).join("");
}

/** A parameter row shares its compact layout; each editor owns its field semantics. */
export function parameterRow(label, control) {
  return `<tr><th scope="row">${escapeHTML(label)}</th><td>${control}</td></tr>`;
}

// Escape the CSS string rather than interpolating a user-controlled field name.
export function formField(root, name) {
  const escaped = String(name).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\a ").replaceAll("\r", "\\d ").replaceAll("\f", "\\c ");
  return root?.querySelector(`[name="${escaped}"]`);
}
export const formValue = (root, name, fallback = "") => formField(root, name)?.value ?? fallback;
export const formChecked = (root, name) => formField(root, name)?.checked === true;
