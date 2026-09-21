import { text as t } from "../localization.js";
import { generics } from "../generics.js";
import { listScriptFunctions } from "../script-functions/index.js";
import { canExecuteScriptKind } from "../premium-provider.js";

export const SCRIPT_MACRO_NONE = "__dmicher_macro_none__";
export const SCRIPT_MACRO_NEW = "__dmicher_macro_new__";

const language = context => context.language ?? globalThis.game?.i18n?.lang;
const labels = context => ({
  dialog: t("Справочник", "Catalog", language(context)),
  search: t("Поиск", "Search", language(context)),
  close: t("Закрыть", "Close", language(context)),
  empty: t("Ничего не найдено", "Nothing found", language(context)),
  premium: "Premium"
});

export function getScriptCatalogEntries(context = {}) {
  const lang = language(context);
  return listScriptFunctions({ scope: context.scriptScope ?? "object", language: lang, premium: true, owner: context.owner ?? context.functionsOwner }).map(entry => {
    if (entry.disabled || !entry.premium || canExecuteScriptKind(entry.id)) return entry;
    return { ...entry, disabled: true, reason: t("Требуется Premium", "Requires Premium", lang) };
  });
}

function macroDocument(uuid) {
  return globalThis.game?.macros?.get?.(uuid.split(".").at(-1));
}

export function getScriptMacroEntries(context = {}) {
  const lang = language(context), category = t("Макросы", "Macros", lang);
  const simple = (id, label) => ({ id, label, path: label, description: label, premium: false, disabled: false, reason: "" });
  return [
    simple(SCRIPT_MACRO_NONE, "—"),
    simple(SCRIPT_MACRO_NEW, t("<Новый макрос>", "<New macro>", lang)),
    ...(context.catalog?.macros ?? []).filter(entry => entry.ownerKey === context.ownerKey).map(entry => {
      const name = macroDocument(entry.uuid)?.name ?? entry.uuid;
      return { id: entry.uuid, label: name, path: `${category}.${name}`, description: entry.uuid, premium: false, disabled: false, reason: "" };
    })
  ];
}

export async function createAttachedScriptMacro({ promptName, createMacro, attachMacro } = {}) {
  if (typeof promptName !== "function" || typeof createMacro !== "function" || typeof attachMacro !== "function") {
    throw new TypeError("Script macro creation requires promptName, createMacro and attachMacro");
  }
  const name = String(await promptName() ?? "").trim();
  if (!name) return null;
  const macro = await createMacro({ name, type: "script", scope: "global", command: "" });
  if (!macro?.uuid) throw new Error(t("Макрос не создан.", "Macro was not created."));
  await attachMacro(macro.uuid);
  return macro;
}

/** Shared Foundry prompt/create/attach flow for every script owner. */
export function promptAndCreateAttachedScriptMacro({
  attachMacro,
  validate = () => {},
  title = t("Новый макрос", "New macro"),
  dialog = globalThis.foundry?.applications?.api?.DialogV2,
  macroClass = globalThis.foundry?.documents?.Macro?.implementation ?? globalThis.Macro
} = {}) {
  if (typeof dialog?.wait !== "function" || typeof macroClass?.create !== "function") throw new Error(t("Создание макросов недоступно.", "Macro creation is unavailable."));
  const promptName = () => dialog.wait({
    window: { title },
    content: `<label>${t("Название макроса", "Macro name")}<input name="macroName" required maxlength="120" autofocus></label>`,
    buttons: [
      { action: "create", label: t("Создать", "Create"), default: true, callback: (_event, _button, prompt) => prompt.element.querySelector('[name="macroName"]')?.value ?? "" },
      { action: "cancel", label: t("Отмена", "Cancel"), callback: () => null }
    ],
    rejectClose: false
  });
  return createAttachedScriptMacro({
    promptName,
    createMacro: async data => { validate(); return macroClass.create(data, { renderSheet: true }); },
    attachMacro: async uuid => { validate(); await attachMacro(uuid); }
  });
}

function setControlValue(hidden, input, value, display, eventType) {
  hidden.value = value;
  input.value = display;
  hidden.dispatchEvent(new hidden.ownerDocument.defaultView.Event(eventType, { bubbles: true }));
}

function report(onError, error) {
  try { onError?.(error); }
  catch (reportError) { console.error("dmicher-master-screen | catalog error handler failed", reportError); }
}

/** Bind function and macro catalog inputs after their script table is in the DOM. */
export function bindScriptCatalogs(root, getContext, { signal, onCreateMacro, onError } = {}) {
  if (!root?.querySelectorAll || typeof getContext !== "function") throw new TypeError("Script catalogs require a root and getContext");
  const disposers = [];
  for (const hidden of root.querySelectorAll("[data-script-kind]")) {
    const row = hidden.closest("[data-script-step]"), input = row?.querySelector("[data-script-kind-input]"), button = row?.querySelector("[data-script-kind-button]");
    if (!input || !button) continue;
    const entries = () => getScriptCatalogEntries(getContext());
    const current = entries().find(entry => entry.id === hidden.value);
    input.value = current?.path ?? hidden.value;
    const control = generics.components.createCatalogInput({ input, button, getEntries: entries, labels: labels(getContext()), onSelect(entry) {
      setControlValue(hidden, input, entry.id, entry.path, "change");
    } });
    disposers.push(() => control.dispose());
  }
  for (const hidden of root.querySelectorAll("[data-script-macro-uuid]")) {
    const row = hidden.closest("[data-script-step]"), input = row?.querySelector("[data-script-macro-input]"), button = row?.querySelector("[data-script-macro-button]");
    if (!input || !button) continue;
    const entries = () => getScriptMacroEntries(getContext());
    const display = uuid => entries().find(entry => entry.id === (uuid || SCRIPT_MACRO_NONE))?.label ?? uuid;
    input.value = display(hidden.value);
    const control = generics.components.createCatalogInput({ input, button, getEntries: entries, labels: labels(getContext()), onSelect(entry) {
      if (entry.id === SCRIPT_MACRO_NEW) {
        const previous = hidden.value;
        Promise.resolve(onCreateMacro?.({ row, index: Number(row.closest("[data-script-index]")?.dataset.scriptIndex), stepIndex: Number(row.dataset.scriptStep) }))
          .then(macro => {
            if (!hidden.isConnected) return;
            if (!macro?.uuid) { input.value = display(previous); return; }
            setControlValue(hidden, input, macro.uuid, macro.name ?? macro.uuid, "input");
          }).catch(error => { if (hidden.isConnected) input.value = display(previous); report(onError, error); });
        return;
      }
      const value = entry.id === SCRIPT_MACRO_NONE ? "" : entry.id;
      setControlValue(hidden, input, value, entry.label, "input");
    } });
    disposers.push(() => control.dispose());
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return false;
    disposed = true;
    for (const release of disposers.splice(0)) release();
    signal?.removeEventListener("abort", dispose);
    return true;
  };
  if (signal?.aborted) dispose(); else signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}
