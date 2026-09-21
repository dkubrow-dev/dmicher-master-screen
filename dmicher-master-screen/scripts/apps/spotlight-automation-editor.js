import { ScreenFormApplication } from "./screen-form.js";
import { ScriptBlockEditor } from "./script-block-editor.js";
import { promptAndCreateAttachedScriptMacro } from "./script-catalog-input.js";
import { escapeHTML as e } from "./form-fields.js";
import { themedClasses, notifyError } from "../ui.js";
import { text as t } from "../localization.js";
import { validateWorldScript } from "../spotlight-automation.js";
import { automationLimits, assertAutomationAddition, limitReached, renderAutomationCount, renderAutomationUnavailable, renderScriptLimitIssue, automationAddAttributes } from "./automation-limit-fields.js";

const ownerKey = owner => `${owner.type}:${owner.id}`;
const asArray = collection => Array.from(collection?.values?.() ?? collection ?? []);
const sourceValue = (owner, event) => JSON.stringify([owner.type, owner.id, event]);
const title = () => t("Автоматизация Спотлайта", "Spotlight automation");
const modelLimits = model => automationLimits(model.host.getAutomationLimits?.());

export function createSpotlightEditorModel({ owner, host, bridge }) {
  if (!host?.readBindings || !owner) throw new Error(t("Источник автоматизации недоступен.", "Automation source is unavailable."));
  return { owner: structuredClone(owner), host, bridge, draft: structuredClone(host.readBindings(owner)), dirty: false, children: new Set(), disposed: false,
    async save() {
      if (this.disposed) return;
      const data = structuredClone(this.draft);
      for (const row of data.subscriptions) row.script = validateWorldScript(row.script, this.owner);
      const saved = await this.host.saveBindings(this.owner, data, { expectedRevision: this.draft.revision });
      if (this.disposed) return;
      this.draft = saved; this.dirty = false; this.bridge?.refresh();
    } };
}

const localizedLabel = (value, fallback) => typeof value === "string" && value ? value
  : value && typeof value === "object" ? value[game.i18n?.lang === "ru" ? "ru" : "en"] || value.en || value.ru || fallback : fallback;
export function spotlightEventLabels(source, owner, event) {
  return { source: localizedLabel(source?.label, ownerKey(owner)), event: localizedLabel(source?.eventLabels?.[event], event) };
}
function sourceChoices(model) {
  return model.host.sources().flatMap(source => {
    const owner = source.owner ?? source;
    return source.events.map(event => {
      const labels = spotlightEventLabels(source, owner, event);
      return { source: owner, event, value: sourceValue(owner, event), label: `${labels.source} — ${labels.event}` };
    });
  });
}
function signalDefinition(row, model) {
  const source = model.host.sources().find(source => ownerKey(source.owner ?? source) === ownerKey(row.source));
  return { id: `${ownerKey(row.source)}:${row.event}`, name: spotlightEventLabels(source, row.source, row.event).event, parameters: [{ name: "event", type: "string" }], returns: [] };
}

async function createMacro(model) {
  return promptAndCreateAttachedScriptMacro({
    validate: () => { if (model.disposed || !globalThis.game?.user?.isGM) throw new Error(t("Редактор недоступен.", "The editor is unavailable.")); },
    attachMacro: uuid => {
      model.draft.registeredMacroUuids = [...new Set([...(model.draft.registeredMacroUuids ?? []), uuid])];
      model.dirty = true;
    }
  });
}

function editSubscription(model, id, refresh) {
  const choices = sourceChoices(model);
  const existing = model.draft.subscriptions.find(row => row.id === id);
  if (!existing) assertAutomationAddition("subscriptions", model.draft.subscriptions.length, modelLimits(model));
  const choice = choices.find(row => ownerKey(row.source) === ownerKey(model.owner)) ?? choices[0];
  if (!existing && !choice) throw new Error(t("Нет доступных событий.", "No events are available."));
  const row = structuredClone(existing ?? { id: crypto.randomUUID(), enabled: true, source: choice.source, event: choice.event,
    script: { id: crypto.randomUUID(), name: "", enabled: true, repeat: false, steps: [] } });
  let editor;
  const context = () => ({ scriptScope: "world", owner: model.owner, ownerKey: ownerKey(model.owner), definitions: [], automationLimits: () => modelLimits(model),
    catalog: { macros: (model.draft.registeredMacroUuids ?? []).map(uuid => ({ ownerKey: ownerKey(model.owner), uuid })), signals: [] },
    signalOptions: [signalDefinition(row, model)] });
  editor = new ScriptBlockEditor({ title: title(), script: row.script, context,
    renderHeader: () => `<section class="ms-spotlight-subscription"><label>${t("Событие", "Event")}<select data-world-event data-script-context-refresh>${choices.map(choice => `<option value="${e(choice.value)}"${choice.value === sourceValue(row.source, row.event) ? " selected" : ""}>${e(choice.label)}</option>`).join("")}</select></label><label><input type="checkbox" data-world-enabled${row.enabled ? " checked" : ""}>${t("Подписка включена", "Subscription enabled")}</label><p>${t("Входные данные события доступны в parameters.event как JSON-строка.", "Event input is available in parameters.event as a JSON string.")}</p></section>`,
    captureHeader: root => {
      const encoded = root.querySelector("[data-world-event]")?.value;
      if (encoded) { const [type, id, event] = JSON.parse(encoded); row.source = { type, id }; row.event = event; }
      row.enabled = root.querySelector("[data-world-enabled]")?.checked !== false;
    },
    validate: script => validateWorldScript(script, model.owner),
    onCreateMacro: () => createMacro(model),
    save: async script => {
      if (model.disposed) return;
      row.script = script;
      const index = model.draft.subscriptions.findIndex(candidate => candidate.id === row.id);
      if (index < 0) { assertAutomationAddition("subscriptions", model.draft.subscriptions.length, modelLimits(model)); model.draft.subscriptions.push(row); } else model.draft.subscriptions[index] = row;
      model.dirty = true; refresh();
    }
  });
  model.children.add(editor);
  void editor.render({ force: true });
  return editor;
}

export function mountSpotlightAutomationEditor(element, { model = null, ...options }) {
  model ??= createSpotlightEditorModel(options);
  const Controller = element.ownerDocument.defaultView.AbortController;
  const controller = new Controller(), events = { signal: controller.signal };
  const status = () => {
    const state = model.bridge?.status();
    const field = element.querySelector("[data-world-status]");
    if (field) field.textContent = state?.paused ? t("Мировая автоматизация остановлена.", "World automation is stopped.") : t(`Выполняется обработчиков: ${state?.active ?? 0}`, `Active handlers: ${state?.active ?? 0}`);
  };
  const refresh = () => {
    const rows = model.draft.subscriptions ?? [];
    const limits = modelLimits(model);
    const availableMacros = asArray(globalThis.game?.macros).filter(macro => macro.type === "script");
    const attached = model.draft.registeredMacroUuids ?? [];
    const sources = new Map(model.host.sources().map(source => [ownerKey(source.owner ?? source), source]));
    const sourceCell = row => {
      const labels = spotlightEventLabels(sources.get(ownerKey(row.source)), row.source, row.event);
      return `<td title="${e(`${ownerKey(row.source)} / ${row.event}`)}">${e(labels.source)}<br>${e(labels.event)}</td>`;
    };
    element.innerHTML = `<section class="ms-spotlight-automation"><p>${t("Подписки действуют во всём мире, в том числе без открытой сцены.", "Subscriptions operate throughout the world, including without an open scene.")}</p>
      <p data-world-status></p>${renderAutomationCount("subscriptions", rows.length, limits)}<table><thead><tr><th>${t("Вкл.", "On")}</th><th>${t("Источник и событие", "Source and event")}</th><th>${t("Скрипт", "Script")}</th><th>${t("Действия", "Actions")}</th></tr></thead><tbody>
      ${rows.map((row, index) => `<tr${limitReached("subscriptions", index, limits) ? ' data-automation-limit-locked="subscriptions"' : ""}><td><input type="checkbox" data-world-enabled-row="${e(row.id)}"${row.enabled ? " checked" : ""}></td>${sourceCell(row)}<td>${e(row.script?.name || t("Без названия", "Untitled"))}${renderAutomationUnavailable("subscriptions", index, limits)}${renderScriptLimitIssue(row.script, limits)}</td><td><button type="button" data-world-action="edit" data-id="${e(row.id)}">${t("Изменить", "Edit")}</button><button type="button" data-world-action="remove" data-id="${e(row.id)}">${t("Удалить", "Delete")}</button></td></tr>`).join("")}
      </tbody></table><div class="dmicher-actions"><button type="button" data-world-action="add"${automationAddAttributes("subscriptions", rows.length, limits)}>${t("Добавить подписку", "Add subscription")}</button><button type="button" data-world-action="save">${t("Сохранить", "Save")}</button></div>
      <details><summary>${t("Зарегистрированные макросы", "Registered macros")}</summary><p>${t("Исполнение разрешено только явно зарегистрированным макросам этого инструмента.", "Only explicitly registered macros may execute for this tool.")}</p><select data-world-macro><option value="">—</option>${availableMacros.filter(macro => !attached.includes(macro.uuid)).map(macro => `<option value="${e(macro.uuid)}">${e(macro.name)}</option>`).join("")}</select><button type="button" data-world-action="attach-macro">${t("Зарегистрировать", "Register")}</button><ul>${attached.map(uuid => `<li>${e(availableMacros.find(macro => macro.uuid === uuid)?.name || uuid)} <button type="button" data-world-action="detach-macro" data-id="${e(uuid)}">${t("Убрать", "Remove")}</button></li>`).join("")}</ul></details>
      <div class="dmicher-actions"><button type="button" data-world-action="stop">${t("Остановить мировую автоматизацию", "Stop world automation")}</button><button type="button" data-world-action="resume">${t("Продолжить", "Resume")}</button></div>
      <p data-world-save-status>${model.dirty ? t("Есть несохранённые изменения", "Unsaved changes") : t("Изменений нет", "No changes")}</p>
      ${model.host !== model.bridge?.host ? `<p>${t("Изменения подписок входят в черновик шаблона. Для записи используйте сохранение шаблона.", "Subscription changes belong to the template draft. Use the template's Save action to persist them.")}</p>` : ""}</section>`;
    status();
  };
  element.addEventListener("change", event => {
    const input = event.target.closest("[data-world-enabled-row]");
    const row = input && model.draft.subscriptions.find(row => row.id === input.dataset.worldEnabledRow);
    if (row) { row.enabled = input.checked; model.dirty = true; const field = element.querySelector("[data-world-save-status]"); if (field) field.textContent = t("Есть несохранённые изменения", "Unsaved changes"); }
  }, events);
  element.addEventListener("click", event => {
    const button = event.target.closest("[data-world-action]");
    if (!button || button.disabled) return;
    event.preventDefault(); button.disabled = true;
    void (async () => {
      switch (button.dataset.worldAction) {
        case "add": case "edit": editSubscription(model, button.dataset.id, refresh); break;
        case "remove": model.draft.subscriptions = model.draft.subscriptions.filter(row => row.id !== button.dataset.id); model.dirty = true; refresh(); break;
        case "save": await model.save(); refresh(); break;
        case "stop": await model.bridge.stop(); break;
        case "resume": await model.bridge.resume(); break;
        case "attach-macro": {
          const uuid = element.querySelector("[data-world-macro]")?.value;
          if (uuid) { model.draft.registeredMacroUuids = [...new Set([...(model.draft.registeredMacroUuids ?? []), uuid])]; model.dirty = true; refresh(); }
          break;
        }
        case "detach-macro": model.draft.registeredMacroUuids = (model.draft.registeredMacroUuids ?? []).filter(uuid => uuid !== button.dataset.id); model.dirty = true; refresh(); break;
      }
    })().catch(notifyError).finally(() => { if (button.isConnected) button.disabled = false; });
  }, events);
  const unsubscribe = model.bridge?.subscribe(status);
  refresh();
  const dispose = () => { model.disposed = true; controller.abort(); unsubscribe?.(); for (const child of model.children) void child.close(); model.children.clear(); };
  dispose.model = model;
  return dispose;
}

export class SpotlightAutomationEditor extends ScreenFormApplication {
  static DEFAULT_OPTIONS = { classes: themedClasses("dmicher-object-tools"), position: { width: 880, height: 650 }, window: { title: "Spotlight automation", resizable: true } };
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/object-tools.hbs", scrollable: [".ms-object-form"] } };
  constructor(options) { super({}); this.model = createSpotlightEditorModel(options); }
  get title() { return title(); }
  async _prepareContext() { return { body: '<div data-world-editor></div>' }; }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.disposeEditor?.(); this.model.disposed = false;
    this.disposeEditor = mountSpotlightAutomationEditor(this.element.querySelector("[data-world-editor]"), { model: this.model });
  }
  async _onClose(options) { this.disposeEditor?.(); return super._onClose(options); }
}
