import { text as t } from "../localization.js";
import { escapeHTML as e, textInput as input, formValue as value, selectOptions } from "./form-fields.js";
import { renderSchema, readSignalSchemaField } from "./signal-schema-fields.js";
export { renderSchema, bindSignalFields } from "./signal-schema-fields.js";
import { localizedDescription } from "../model.js";
import { validateSignalMacro, validateStandaloneMacro } from "../signal-macros.js";

const choose = (name, label, items, current) => `<label>${e(label)}<select name="${e(name)}">${selectOptions(items, current, t("Выберите…", "Choose…"))}</select></label>`;
export const emitterName = (catalog, key) => catalog.emitters.find((item) => item.key === key)?.name ?? key;
export const macroName = (uuid) => game.macros?.get?.(uuid?.split(".").at(-1))?.name ?? uuid ?? "";
export const macroKey = (entry) => JSON.stringify([entry.ownerKey, entry.uuid]);
export async function macroValidationSummary(catalog, entry) {
  const base = await validateStandaloneMacro(entry.uuid);
  if (!base.valid) return { valid: false, text: base.error };
  const subscriptions = catalog.subscriptions.filter((row) => row.ownerKey === entry.ownerKey && row.macroUuid === entry.uuid);
  const checks = await Promise.all(subscriptions.map((row) => { const signal = catalog.signals.find((item) => item.id === row.signalId); return signal ? validateSignalMacro(entry.uuid, signal) : { valid: false, error: t("Сигнал отсутствует.", "The signal is missing.") }; }));
  const failed = checks.find((result) => !result.valid);
  return failed ? { valid: false, text: failed.error } : { valid: true, text: subscriptions.length ? t("Интерфейсы проверены", "Interfaces validated") : t("Синтаксис проверен; без подписок", "Syntax validated; no subscriptions") };
}

export function renderSignalFields(signal, catalog) {
  if (!signal) return `<p>${t("Выберите сигнал эмитента.", "Select an emitter's signal.")}</p>`;
  return `<section data-signal-fields><p class="ms-note">${t("Эмитент", "Emitter")}: ${e(emitterName(catalog, signal.emitterKey))}</p>${input("signal-name", t("Название", "Name"), signal.name, signal.builtin ? "readonly" : "required")}<label>${t("Описание", "Description")}<textarea name="signal-description"${signal.builtin ? " readonly" : ""}>${e(localizedDescription(signal.description))}</textarea></label><h4>${t("Параметры", "Parameters")}</h4>${renderSchema(signal.parameters, "parameters")}<h4>${t("Возврат", "Returns")}</h4>${renderSchema(signal.returns, "returns")}</section>`;
}

export function readSignalFields(root, previous) {
  const description = (text, original) => text === localizedDescription(original) ? original : text;
  const signal = { ...previous };
  if (!signal.builtin) { signal.name = value(root, "signal-name"); signal.description = description(value(root, "signal-description"), signal.description); }
  for (const direction of ["parameters", "returns"]) signal[direction] = [...root.querySelectorAll(`[data-signal-field="${direction}"]`)].map((row) => {
    const original = previous[direction][Number(row.dataset.index)];
    return readSignalSchemaField(row, original);
  });
  return signal;
}

export function renderSubscriptions(rows, catalog) {
  return `<table class="ms-automation-table"><thead><tr><th>${t("Подписчик", "Subscriber")}</th><th>${t("Макрос", "Macro")}</th><th>${t("Сигнал", "Signal")}</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr><td>${e(emitterName(catalog, row.ownerKey))}</td><td>${e(macroName(row.macroUuid))}${row.enabled === false ? ` · ${t("выключен", "disabled")}` : ""}</td><td>${e(catalog.signals.find((signal) => signal.id === row.signalId)?.name ?? row.signalId)}</td><td><button type="button" data-screen-action="editSignalSubscription" data-id="${e(row.id)}">${t("Править", "Edit")}</button><button type="button" data-screen-action="deleteSignalSubscription" data-id="${e(row.id)}">×</button></td></tr>`).join("")}</tbody></table><button type="button" data-screen-action="newSignalSubscription">+ ${t("Подписка", "Subscription")}</button>`;
}

export function renderSubscriptionFields(row, catalog, { fixedOwner, fixedSignal } = {}) {
  return `<fieldset data-subscription-fields><legend>${t("Подписка макроса", "Macro subscription")}</legend>${fixedOwner ? "" : choose("subscription-owner", t("Подписчик", "Subscriber"), catalog.emitters.map((item) => ({ id: item.key, name: item.name })), row.ownerKey)}${choose("subscription-macro", t("Макрос объекта", "Object macro"), catalog.macros.filter((item) => item.ownerKey === (fixedOwner ?? row.ownerKey)).map((item) => ({ id: item.uuid, name: macroName(item.uuid) })), row.macroUuid)}${fixedSignal ? "" : choose("subscription-signal", t("Сигнал эмитента", "Emitter signal"), catalog.signals.map((signal) => ({ id: signal.id, name: `${emitterName(catalog, signal.emitterKey)} · ${signal.name}` })), row.signalId)}<label class="ms-check"><input type="checkbox" name="subscription-enabled"${row.enabled !== false ? " checked" : ""}>${t("Включена", "Enabled")}</label><button type="button" data-screen-action="saveSignalSubscription">${t("Проверить и сохранить", "Validate and save")}</button></fieldset>`;
}

export function readSubscriptionFields(root, previous, catalog, { fixedOwner, fixedSignal } = {}) {
  const signalId = fixedSignal ?? value(root, "subscription-signal");
  return { ...previous, ownerKey: fixedOwner ?? value(root, "subscription-owner"), signalId, emitterKey: catalog.signals.find((signal) => signal.id === signalId)?.emitterKey, macroUuid: value(root, "subscription-macro"), enabled: root.querySelector('[name="subscription-enabled"]')?.checked === true };
}

export function renderMacroValidation(result) {
  if (!result) return "";
  return `<section class="ms-macro-validation"><p role="status">${e(result.error ?? (result.valid ? t("Интерфейс соответствует сигналу.", "The interface matches the signal.") : t("Интерфейс требует изменений.", "The interface needs changes.")))}</p>${result.snippet ? `<label>${t("Объект для включения в код макроса", "Object to include in the macro code")}<textarea readonly spellcheck="false" rows="9">${e(result.snippet)}</textarea></label>` : ""}</section>`;
}
