import { text as t } from "../localization.js";
import { escapeHTML as e, textInput as input, formValue as value, selectOptions } from "./form-fields.js";
import { renderSchema, readSignalSchemaField } from "./signal-schema-fields.js";
export { renderSchema, bindSignalFields } from "./signal-schema-fields.js";
import { localizedDescription } from "../model.js";
import { validateSignalMacro, validateStandaloneMacro } from "../signal-macros.js";
import { isNativeObjectEmitter } from "../object-signal-settings.js";
import { limitReached, renderAutomationCount, renderAutomationUnavailable, automationAddAttributes } from "./automation-limit-fields.js";
import { generics } from "../generics.js";

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

export function renderSubscriptions(rows, catalog, { ownerKey } = {}) {
  const ownerRows = key => (catalog.subscriptions ?? rows).filter(row => row.ownerKey === key);
  const rowIndex = row => ownerRows(row.ownerKey).findIndex(entry => entry.id === row.id);
  const owners = ownerKey ? [ownerKey] : [...new Set(rows.map(row => row.ownerKey))];
  const counts = owners.map(key => `<div>${ownerKey ? "" : `${e(emitterName(catalog, key))} · `}${renderAutomationCount("subscriptions", ownerRows(key).length)}</div>`).join("");
  return `${counts}<table class="ms-automation-table"><thead><tr><th>${t("Подписчик", "Subscriber")}</th><th>${t("Обработчик", "Handler")}</th><th>${t("Сигнал", "Signal")}</th><th></th></tr></thead><tbody>${rows.map((row) => `<tr${limitReached("subscriptions", rowIndex(row)) ? ' data-automation-limit-locked="subscriptions"' : ""}><td>${e(emitterName(catalog, row.ownerKey))}${renderAutomationUnavailable("subscriptions", rowIndex(row))}</td><td>${row.handler === "script" ? t("Скрипт события","Event script") : e(macroName(row.macroUuid))}${row.enabled === false ? ` · ${t("выключен", "disabled")}` : ""}</td><td>${e(catalog.signals.find((signal) => signal.id === row.signalId)?.name ?? row.signalId)}</td><td><button type="button" data-screen-action="editSignalSubscription" data-id="${e(row.id)}">${t("Править", "Edit")}</button><button type="button" data-screen-action="deleteSignalSubscription" data-id="${e(row.id)}">×</button></td></tr>`).join("")}</tbody></table><button type="button" data-screen-action="newSignalSubscription"${ownerKey ? automationAddAttributes("subscriptions", ownerRows(ownerKey).length) : ""}>+ ${t("Подписка", "Subscription")}</button>`;
}

export function renderSubscriptionFields(row, catalog, { fixedOwner, fixedSignal } = {}) {
  const ownerRows = (catalog.subscriptions ?? []).filter(entry => entry.ownerKey === (fixedOwner ?? row.ownerKey));
  const ownerIndex = ownerRows.findIndex(entry => entry.id === row.id);
  const fixedNative = !fixedOwner || isNativeObjectEmitter(fixedOwner);
  const handler = fixedNative ? row.handler ?? (row.ownerKey && !isNativeObjectEmitter(row.ownerKey) ? "macro" : "script") : "macro";
  const owners = catalog.emitters.filter(item => handler !== "script" || isNativeObjectEmitter(item.key));
  const handlers = [...(fixedNative ? [{ id: "script", name: t("Скрипт события", "Event script") }] : []), { id: "macro", name: t("Зарегистрированный макрос", "Registered macro") }];
  const currentSignal = catalog.signals.find(signal => signal.id === row.signalId);
  const signalLabel = currentSignal ? `${emitterName(catalog, currentSignal.emitterKey)} · ${localizedDescription(currentSignal.label) || currentSignal.name}` : row.signalId ?? "";
  return `<fieldset data-subscription-fields><legend>${t("Подписка", "Subscription")}</legend>${renderAutomationCount("subscriptions", ownerRows.length)}${renderAutomationUnavailable("subscriptions", ownerIndex)}${fixedOwner ? "" : choose("subscription-owner", t("Подписчик", "Subscriber"), owners.map((item) => ({ id: item.key, name: item.name })), row.ownerKey)}
    ${choose("subscription-handler",t("Обработчик","Handler"),handlers,handler)}
    ${handler === "macro" ? choose("subscription-macro", t("Макрос объекта", "Object macro"), catalog.macros.filter((item) => item.ownerKey === (fixedOwner ?? row.ownerKey)).map((item) => ({ id: item.uuid, name: macroName(item.uuid) })), row.macroUuid) : `<p class="ms-note">${t("После сохранения настройте скрипт в «Поведение → События» объекта-подписчика.","After saving, configure the script in Behavior → Events on the subscribing object.")}</p>`}
    ${fixedSignal ? "" : `<label>${t("Сигнал эмитента", "Emitter signal")}<input type="hidden" name="subscription-signal" value="${e(row.signalId ?? "")}"><span class="ms-subscription-signal-control"><input type="text" data-subscription-signal-input value="${e(signalLabel)}" autocomplete="off" aria-label="${t("Сигнал эмитента", "Emitter signal")}"><button type="button" data-subscription-signal-button aria-haspopup="dialog" aria-expanded="false" aria-label="${t("Открыть справочник сигналов", "Open signal catalog")}">⌄</button></span></label>`}<label class="ms-check"><input type="checkbox" name="subscription-enabled"${row.enabled !== false ? " checked" : ""}>${t("Включена", "Enabled")}</label><button type="button" data-screen-action="saveSignalSubscription"${ownerIndex < 0 ? automationAddAttributes("subscriptions", ownerRows.length) : ""}>${t("Проверить и сохранить", "Validate and save")}</button></fieldset>`;
}

export function bindSubscriptionSignalCatalog(root, getCatalog, { signal } = {}) {
  const input = root.querySelector("[data-subscription-signal-input]"), button = root.querySelector("[data-subscription-signal-button]");
  const hidden = root.querySelector('[name="subscription-signal"]');
  if (!input || !button || !hidden) return () => {};
  const entries = () => {
    const catalog = getCatalog();
    return catalog.signals.filter(entry => entry.enabled !== false || entry.id === hidden.value).map(entry => {
      const label = localizedDescription(entry.label) || entry.name, description = localizedDescription(entry.description);
      return { id: entry.id, label, path: `${emitterName(catalog, entry.emitterKey)} · ${label}`,
        description: [label !== entry.name ? entry.name : "", description].filter(Boolean).join(" · ") || entry.id,
        disabled: entry.enabled === false, reason: entry.enabled === false ? t("Публикация сигнала выключена.", "Signal publication is disabled.") : "" };
    });
  };
  const control = generics.components.createCatalogInput({ input, button, getEntries: entries,
    labels: { dialog: t("Справочник сигналов", "Signal catalog"), search: t("Поиск по сигналу или эмитенту", "Search signals or emitters"),
      close: t("Закрыть", "Close"), empty: t("Сигналы не найдены", "No signals found"), premium: "Premium" },
    onSelect(entry) {
      hidden.value = entry.id; input.value = entry.path;
      hidden.dispatchEvent(new hidden.ownerDocument.defaultView.Event("change", { bubbles: true }));
    } });
  const dispose = () => { signal?.removeEventListener("abort", dispose); return control.dispose(); };
  if (signal?.aborted) dispose(); else signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}

export function readSubscriptionFields(root, previous, catalog, { fixedOwner, fixedSignal } = {}) {
  const signalId = fixedSignal ?? value(root, "subscription-signal");
  const handler=value(root,"subscription-handler") || previous.handler || "script";
  return { ...previous,handler, ownerKey: fixedOwner ?? value(root, "subscription-owner"), signalId, emitterKey: catalog.signals.find((signal) => signal.id === signalId)?.emitterKey, macroUuid: handler === "macro" ? value(root, "subscription-macro") : "", enabled: root.querySelector('[name="subscription-enabled"]')?.checked === true };
}

export function renderMacroValidation(result) {
  if (!result) return "";
  return `<section class="ms-macro-validation"><p role="status">${e(result.error ?? (result.valid ? t("Интерфейс соответствует сигналу.", "The interface matches the signal.") : t("Интерфейс требует изменений.", "The interface needs changes.")))}</p>${result.snippet ? `<label>${t("Объект для включения в код макроса", "Object to include in the macro code")}<textarea readonly spellcheck="false" rows="9">${e(result.snippet)}</textarea></label>` : ""}</section>`;
}
