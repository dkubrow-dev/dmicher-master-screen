import { text as t } from "../localization.js";
import { ScreenFormApplication } from "./screen-form.js";
import { scenePreparationKey } from "./scene-refresh.js";
import { themedClasses, notifyError } from "../ui.js";
import { currentScene, getDefinitions, getObjectTags } from "../store.js";
import { SceneObjects, getObjectBindings, getSceneObject } from "../scene-objects.js";
import { registeredToolIds, toolRegistration } from "../object-binding-model.js";
import { getInteractionCatalog } from "../scene-assets.js";
import { SignalCatalog, getSignalCatalog } from "../signal-catalog.js";
import { normalizeConditions } from "../model.js";
import { buildConditionFields, readConditionFields, splitTags } from "./condition-fields.js";
import { buildScriptFields, readScriptFields, bindScriptSorting, bindScriptInterruptions } from "./script-fields.js";
import { appendScriptStep, removeScriptStep } from "../script-editing.js";
import { changedScriptWarnings } from "../script-warnings.js";
import { escapeHTML as e, formValue as value, actionButton as button, textInput as input, selectOptions } from "./form-fields.js";
import { completeScriptParameters, bindScriptParameters } from "./script-parameters.js";
import { exportScriptBlock, importScriptBlock } from "../script-transfer.js";
import { generics } from "../generics.js";
import { readObjectGeometry } from "../script-movement.js";
import { renderSignalFields, readSignalFields, renderSubscriptions, renderSubscriptionFields, readSubscriptionFields, renderMacroValidation, macroName, macroValidationSummary, bindSignalFields } from "./signal-fields.js";
import { defaultObjectCommand, objectCommandName } from "../object-command-model.js";
import { renderObjectCommandList, renderObjectCommandFields, readObjectCommandFields, bindObjectCommandFields } from "./object-command-fields.js";

const clone = (value) => structuredClone(value);
const options = (items, current, empty = t("Не выбрано", "Not selected")) => selectOptions(items, current, empty);
const section = (title, body) => `<section class="ms-object-feature"><h3>${e(title)}</h3>${body}</section>`;
const layout = (body, nav = "") => nav + `<div class="ms-object-scroll">${body}</div><footer>${button("cancel", t("Закрыть", "Close"))}${button("save", t("Сохранить", "Save"))}</footer>`;
const newScript = (name, stateId) => ({ ...(stateId ? { stateId } : {}), name, enabled: true, repeat: false, steps: [] });
const toolKinds = ["shop", "dialogue"];
const toolTitle = (kind) => kind === "shop" ? t("Магазины", "Shops") : t("Диалоги", "Dialogues");
const fieldKey = (input) => {
  if (input?.name) return JSON.stringify([input.name, input.type]);
  const step = input?.closest?.("[data-script-step]"), data = input?.dataset ?? {};
  const key = ["scriptParam", "scriptParamGroup", "scriptParamNull", "scriptStateGroup", "scriptStateValue"].find((name) => Object.hasOwn(data, name));
  return step && key ? JSON.stringify([step.closest("[data-script-index]")?.dataset.scriptIndex, step.dataset.stepId, key, data[key], data.pairIndex]) : null;
};
const formFields = (element) => [...element.querySelectorAll("input,select,textarea")].filter((input) => fieldKey(input) !== null);

class ObjectForm extends ScreenFormApplication {
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/object-tools.hbs", scrollable: [".ms-object-scroll"] } };
  constructor(controller, descriptor, options = {}) { super(options); this.controller = controller; this.descriptor = { type: descriptor.type, id: descriptor.id }; this.sceneId = currentScene()?.id; this.draft = null; }
  get ownerKey() { return `${this.descriptor.type}:${this.descriptor.id}`; }
  context({ reload = false } = {}) {
    const scene = game.scenes?.get(this.sceneId) ?? (currentScene()?.id === this.sceneId ? currentScene() : null), document = scene && getSceneObject(scene, this.descriptor);
    if (!document) throw new Error(t("Объект больше не существует.", "The object no longer exists."));
    if (!this.draft || reload && this.reloadRequested && !this.dirty) {
      const revision = getObjectBindings(scene).revision;
      const draft = clone(new SceneObjects(scene).get(this.descriptor) ?? { ...this.descriptor, groupId: null, tags: getObjectTags(scene, this.descriptor), notes: "", playerCharacter: false, initialScript: null, transitionScripts: {}, scripts: [], shops: [], dialogues: [] });
      const original = clone(draft), previous = this.draft;
      Object.assign(this, { draft, original, revision, reloadRequested: false });
      this.reconcileSelection?.(previous);
    }
    const definitions = getDefinitions(scene), definition = definitions.find((item) => item.groupId === this.draft.groupId);
    if (reload) this.preparedRefreshKey = this.sceneRefreshKey(scene);
    return { scene, document, definitions, definition, catalog: getInteractionCatalog(scene) };
  }
  sceneRefreshKey(scene) {
    return scenePreparationKey(scene);
  }
  refreshFromScene(scene) {
    if (scene?.id !== this.sceneId || this.persistTask) return;
    const key = this.sceneRefreshKey(scene);
    if (key === this.preparedRefreshKey || key === this.requestedRefreshKey) return;
    this.requestedRefreshKey = key;
    const task = this.refresh();
    if (!task) { this.requestedRefreshKey = null; return; }
    return Promise.resolve(task).finally(() => {
      if (this.requestedRefreshKey === key) this.requestedRefreshKey = null;
    });
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const fields = formFields(this.element), saved = this.refreshInputs, presentation = this.refreshPresentation;
    if (saved) for (const input of fields) {
      const index = saved.findIndex((entry) => entry.key === fieldKey(input));
      if (index < 0) continue;
      const [entry] = saved.splice(index, 1); input.value = entry.value; input.checked = entry.checked; input.setCustomValidity?.(entry.error);
    }
    if (presentation) {
      for (const [index, detail] of [...this.element.querySelectorAll("details")].entries()) if (index < presentation.details.length) detail.open = presentation.details[index];
      for (const editor of presentation.editors) {
        const area = fields.find((input) => input.name === editor.name);
        if (!area) continue;
        area.hidden = editor.hidden;
        area.closest?.("[data-script-step]")?.querySelector("[data-script-json]")?.setAttribute("aria-expanded", String(!area.hidden));
      }
      const focused = presentation.focus && fields.find((input) => fieldKey(input) === presentation.focus.key);
      focused?.focus?.({ preventScroll: true });
      if (focused?.setSelectionRange && Number.isInteger(presentation.focus.start)) focused.setSelectionRange(presentation.focus.start, presentation.focus.end);
    }
    this.refreshInputs = null; this.refreshBaseline = null; this.refreshPresentation = null; this.renderedDraft = this.draft;
    if (this.persistTask) this.lockSaveControls();
    this.bindEvents();
  }
  refresh() {
    if (this.persistTask) return;
    if ((this.rendered || this.refreshTask) && !this.dirty) this.reloadRequested = true;
    return super.refresh();
  }
  captureRefreshDraft() {
    const focused = this.element.ownerDocument.activeElement;
    this.refreshPresentation = {
      details: [...this.element.querySelectorAll("details")].map((detail) => detail.open),
      editors: [...this.element.querySelectorAll("[data-script-json-value]")].map(({ name, hidden }) => ({ name, hidden })),
      focus: fieldKey(focused) && this.element.contains?.(focused) ? { key: fieldKey(focused), start: focused.selectionStart, end: focused.selectionEnd } : null
    };
    if (!this.dirty) {
      this.refreshBaseline = { draft: this.draft, original: this.original, revision: this.revision,
        selectedScript: this.selectedScript, selectedFeature: this.selectedFeature, selectedCommand: this.selectedCommand };
      return;
    }
    // Input can arrive while an asynchronous render still owns the old DOM.
    // Keep that form's revision and raw text, including unfinished JSON values.
    if (this.refreshBaseline) Object.assign(this, this.refreshBaseline);
    this.reloadRequested = false;
    this.refreshInputs = formFields(this.element).map((input) => ({ key: fieldKey(input), value: input.value, checked: input.checked,
      error: input.validity?.customError ? input.validationMessage : "" }));
    try { this.capture(); } catch { /* Raw fields remain available for correction. */ }
  }
  assertCurrentScene() { if (currentScene()?.id !== this.sceneId) throw new Error(t("Вернитесь к сцене редактируемого объекта.", "Return to this object's scene.")); }
  lockSaveControls() {
    this.saveControls ??= new Map();
    for (const control of this.element.querySelectorAll("input,select,textarea,button")) {
      if (!this.saveControls.has(control)) this.saveControls.set(control, control.disabled);
      control.disabled = true;
    }
  }
  persist({ close = false } = {}) {
    if (this.persistTask) return this.persistTask;
    this.lockSaveControls();
    this.persistTask = Promise.resolve().then(async () => {
      this.assertCurrentScene(); const scene = this.context().scene;
      const patch = Object.fromEntries(["groupId", "tags", "notes", "playerCharacter", "initialScript", "transitionScripts", "scripts", "shops", "dialogues", "commands"].filter((key) => JSON.stringify(this.draft[key]) !== JSON.stringify(this.original[key])).map((key) => [key, clone(this.draft[key])]));
      const warnings = changedScriptWarnings(this.original, this.draft);
      if (warnings.length) {
        const kindNames = { initial: t("Исходное состояние", "Initial state"), transition: t("Переход", "Transition"), routine: t("Рутина", "Routine"), "command-before": t("До команды", "Before command"), "command-after": t("После команды", "After command") };
        const items = warnings.map(warning => {
          const details = [];
          if (warning.zeroDelayCycle) details.push(t(`Цикл без задержек (0 с): ${warning.zeroDelayCycle.join(" → ")}. Наибольший риск перегрузки: добавьте ожидание или проверьте выход из цикла. Длительность параллельного эффекта не задерживает следующий шаг.`, `Zero-delay cycle (0 sec.): ${warning.zeroDelayCycle.join(" → ")}. Highest overload risk: add a wait or check the cycle's exit. A parallel effect's duration does not delay the next step.`));
          if (warning.durationUnset) details.push(t("Длительность не установлена: достижимые действия не задают времени выполнения.", "Duration is not set: reachable actions declare no execution time."));
          if (warning.cycle) details.push(t(`Возможен бесконечный цикл шагов: ${warning.cycle.join(" → ")}. Проверьте переходы и «Повторять».`, `A possible infinite step cycle: ${warning.cycle.join(" → ")}. Check Next and Repeat.`));
          return `<li><strong>${e(kindNames[warning.kind])}${warning.name ? `: ${e(warning.name)}` : ""}</strong><p>${details.map(e).join("<br>")}</p></li>`;
        }).join("");
        const accepted = await foundry.applications.api.DialogV2.confirm({
          window: { title: t("Проверка скриптов перед сохранением", "Check scripts before saving") },
          content: `<ul>${items}</ul><p>${t("Такая настройка допустима. Сохранить скрипты?", "This configuration is allowed. Save the scripts?")}</p>`, rejectClose: false
        });
        if (!accepted) return false;
        this.assertCurrentScene();
      }
      if (Object.keys(patch).length) await new SceneObjects(scene).save(this.descriptor, patch, { expectedRevision: this.revision, allowReassign: true });
      this.reloadRequested = true; this.dirty = false; if (close) await this.close(); this.controller.changed(scene);
      if (!close) await super.refresh();
      return true;
    }).finally(() => {
      for (const [control, disabled] of this.saveControls) control.disabled = disabled;
      this.saveControls = null; this.persistTask = null;
    });
    return this.persistTask;
  }
  async handleAction(action) { if (action === "cancel" && await this.mayDiscard()) return this.close(); if (action === "save") { this.capture(); return this.persist(); } }
}

export class ObjectInfoApplication extends ObjectForm {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-object-info"), position: { width: 570, height: "auto" }, window: { resizable: true } };
  get title() { return t("Информация об объекте", "Object information"); }
  async _prepareContext() {
    const { document, definitions } = this.context({ reload: true });
    const facts = [[t("Название", "Name"), document.name ?? document.label ?? ""], [t("Тип", "Type"), this.descriptor.type], ["ID", document.id], ["UUID", document.uuid], ["Actor UUID", document.actor?.uuid ?? ""]];
    return { body: layout(`<dl class="ms-object-metadata">${facts.map(([label, text]) => `<dt>${e(label)}</dt><dd><span>${e(text)}</span>${button("copy-value", "⧉", `class="ms-copy-value" data-copy-value="${e(text)}" aria-label="${e(t(`Скопировать ${label}`, `Copy ${label}`))}"`)}</dd>`).join("")}</dl>${button("native-settings", t("Настройки", "Settings"))}${this.descriptor.type === "Token" ? `<label class="ms-check"><input type="checkbox" name="object-player-character"${this.draft.playerCharacter ? " checked" : ""}>${t("Персонаж игрока", "Player character")}</label>` : ""}<label>${t("Группа", "Group")}<select name="object-group">${options(definitions.map((item) => ({ id: item.groupId, name: item.groupName })), this.draft.groupId, t("Без группы", "Unassigned"))}</select></label>${input("object-tags", t("Теги, через запятую", "Tags, comma separated"), this.draft.tags?.join(", ") ?? "")}<label>${t("Заметки мастера", "GM notes")}<textarea name="object-notes" rows="4" maxlength="8000">${e(this.draft.notes)}</textarea></label>`) };
  }
  capture() { this.draft = { ...this.draft, groupId: value(this.element, "object-group") || null, tags: splitTags(value(this.element, "object-tags")), notes: value(this.element, "object-notes"), playerCharacter: this.descriptor.type === "Token" && this.element.querySelector('[name="object-player-character"]')?.checked === true }; }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("keydown", (event) => { if (event.key !== "Enter" || event.isComposing || event.repeat || event.shiftKey || !event.target.matches("input, select, textarea")) return; event.preventDefault(); event.stopPropagation(); if (this.saving) return; this.saving = true; void Promise.resolve().then(() => { this.capture(); return this.persist({ close: true }); }).catch(notifyError).finally(() => { this.saving = false; }); }, { signal: this.events.signal });
  }
  async handleAction(action, target) {
    if (action === "copy-value") { const text = target.dataset.copyValue, clipboard = this.element.ownerDocument.defaultView.navigator?.clipboard; if (clipboard?.writeText) await clipboard.writeText(text); else if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(text); else throw new Error(t("Буфер обмена недоступен.", "Clipboard is unavailable.")); return; }
    if (action === "native-settings") { const doc = this.context().document, sheet = doc.sheet ?? doc.object?.sheet; if (!sheet?.render) throw new Error(t("У этого объекта нет окна настроек.", "This object has no configuration sheet.")); return sheet.render(true); }
    return super.handleAction(action, target);
  }
}

export class ObjectBehaviorApplication extends ObjectForm {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-object-behavior"), position: { width: 790, height: 740 }, window: { resizable: true } };
  tab = "properties"; selectedScript = null; selectedFeature = null; selectedCommand = null; signalDraft = null; subscriptionDraft = null; validation = null;
  get title() { return t("Поведение объекта", "Object behavior"); }
  scriptParameterContext(context = this.context()) {
    const ownDialogues = new Set(registeredToolIds(this.draft, "dialogue"));
    return { ownerKey: this.ownerKey, document: context.document, definitions: context.definitions,
      dialogueOptions: context.catalog.dialogues.filter((entry) => ownDialogues.has(entry.id)),
      catalog: getSignalCatalog(context.scene) };
  }
  activeCommand() { return this.draft?.commands?.find(command => command.id === this.selectedCommand); }
  activeScript() {
    const ref = this.selectedScript;
    if (!ref || !this.draft) return null;
    if (ref.kind === "command") return this.draft.commands?.find(command => command.id === ref.commandId)?.[ref.phase];
    if (ref.kind === "initial") return this.draft.initialScript;
    if (ref.kind === "transition") return this.draft.transitionScripts?.[ref.stateId];
    return this.draft.scripts?.find(script => script.stateId === ref.stateId);
  }
  activeFeature() { const ref = this.selectedFeature; return ref && this.draft?.[`${ref.kind}s`]?.[ref.index]; }
  reconcileSelection(previous) {
    if (this.selectedFeature) {
      const { kind, index } = this.selectedFeature, reference = previous?.[`${kind}s`]?.[index];
      const key = (entry) => JSON.stringify([entry[`${kind}Id`], entry.playerAction !== false, [...(entry.stateIds ?? [])].sort()]);
      const next = reference ? this.draft[`${kind}s`].findIndex((entry) => key(entry) === key(reference)) : -1;
      this.selectedFeature = next < 0 ? null : { kind, index: next };
    }
    if (!this.activeCommand()) this.selectedCommand = null;
    if (previous?.groupId !== this.draft.groupId && this.selectedScript?.kind !== "command" || !this.activeScript()) this.selectedScript = null;
  }
  setActiveScript(script) {
    const ref = this.selectedScript;
    if (!ref) return;
    if (ref.kind === "command") { const command = this.draft.commands?.find(entry => entry.id === ref.commandId); if (command) command[ref.phase] = script; }
    else if (ref.kind === "initial") this.draft.initialScript = script;
    else if (ref.kind === "transition") { this.draft.transitionScripts ??= {}; if (script) this.draft.transitionScripts[ref.stateId] = script; else delete this.draft.transitionScripts[ref.stateId]; }
    else { this.draft.scripts ??= []; const i = this.draft.scripts.findIndex((item) => item.stateId === ref.stateId); if (i >= 0) this.draft.scripts.splice(i, 1); if (script) this.draft.scripts.push(script); }
  }
  async _prepareContext() {
    const context = this.context({ reload: true }), { definition } = context;
    const nav = `<nav class="ms-object-tabs">${[["properties", t("Свойства", "Properties")], ["transitions", t("Переходы", "Transitions")], ["player-actions", t("Действия игроков", "Player actions")], ["commands", t("Команды", "Commands")], ["routine", t("Рутина", "Routine")]].map(([tab, name]) => button("tab", name, `data-tab="${tab}" aria-pressed="${this.tab === tab}"`)).join("")}</nav>`;
    let body;
    if (this.tab === "properties") {
      const catalog = getSignalCatalog(context.scene);
      this.macroValidation = new Map(await Promise.all(catalog.macros.filter((macro) => macro.ownerKey === this.ownerKey).map(async (macro) => [macro.uuid, await macroValidationSummary(catalog, macro)])));
      body = this.propertyFields(context);
    }
    else if (this.tab === "player-actions") body = this.playerActionFields(context);
    else if (this.tab === "commands") body = this.commandFields(context);
    else {
      body = this.tab === "transitions" ? section(t("Исходное состояние", "Initial state"), `<p class="ms-note">${t("Возвращение объекта к началу приключения выполняется только по явной команде.", "Resetting the object to the beginning runs only on an explicit command.")}</p><div class="ms-initial-script-actions">${this.scriptEntry(this.draft.initialScript, "initial")}${this.draft.initialScript ? button("restore-initial", t("Восстановить исходное состояние", "Restore initial state")) : ""}</div>`) : "";
      body += definition ? this.stateScriptTable(definition, this.tab === "transitions" ? "transition" : "routine") : `<p>${t("Назначьте группу в информации об объекте, чтобы настроить состояния.", "Assign a group in object information to configure states.")}</p>`;
      const script = this.activeScript();
      if (script) { const scriptContext = this.scriptParameterContext(context); body += buildScriptFields([script], definition ?? { states: [] }, this.descriptor.type, scriptContext.catalog, { ...scriptContext, open: true, combatSupported: Boolean(game.system?.id && globalThis.CONFIG?.Combat?.documentClass) }); }
    }
    return { body: layout(`${this.draft.playerCharacter ? `<p class="ms-note">${t("Автоматизация персонажа игрока отключена.", "Player-character automation is disabled.")}</p>` : ""}${body}`, nav) };
  }
  scriptEntry(script, kind, stateId = "") { const attrs = `data-kind="${kind}" data-state-id="${e(stateId)}"`; return `<span>${e(script?.name || "—")}</span>${button("edit-script", script ? t("Править", "Edit") : t("Создать", "Create"), attrs)}${script ? button("delete-script", "×", attrs) : ""}`; }
  commandFields(context) {
    let html = renderObjectCommandList(this.draft.commands, this.selectedCommand);
    const command = this.activeCommand();
    if (!command) return html;
    html += renderObjectCommandFields(command, context.definitions);
    html += section(t("Скрипты команды", "Command scripts"), `<table class="ms-state-script-table"><tbody>${[["beforeScript", t("До команды", "Before command")], ["afterScript", t("После команды", "After command")]].map(([phase, label]) => {
      const script = command[phase], attrs = `data-command-id="${e(command.id)}" data-phase="${phase}"`;
      return `<tr><td>${e(label)}</td><td><span>${e(script?.name || "—")}</span>${button("edit-command-script", script ? t("Править", "Edit") : t("Создать", "Create"), attrs)}${script ? button("remove-command-script", "×", attrs) : ""}</td></tr>`;
    }).join("")}</tbody></table>`);
    const script = this.activeScript();
    if (script) { const scriptContext = this.scriptParameterContext(context); html += buildScriptFields([script], context.definition ?? { states: [] }, this.descriptor.type, scriptContext.catalog, { ...scriptContext, open: true, combatSupported: Boolean(game.system?.id && globalThis.CONFIG?.Combat?.documentClass) }); }
    return html;
  }
  stateScriptTable(group, kind) { return section(t("Состояния", "States"), `<table class="ms-state-script-table"><thead><tr><th>${t("Состояние", "State")}</th><th>${t("Скрипт", "Script")}</th></tr></thead><tbody>${group.states.map((state) => `<tr><td>${e(state.name)}</td><td>${this.scriptEntry(kind === "transition" ? this.draft.transitionScripts?.[state.id] : this.draft.scripts?.find((script) => script.stateId === state.id), kind, state.id)}</td></tr>`).join("")}</tbody></table>`); }
  registeredTools(kind, catalog) {
    const ids = new Set(registeredToolIds(this.draft, kind));
    return catalog[`${kind}s`].filter((asset) => ids.has(asset.id));
  }
  registrationFields(catalog) {
    return toolKinds.map((kind) => {
      const ids = registeredToolIds(this.draft, kind), available = catalog[`${kind}s`].filter((asset) => !ids.includes(asset.id));
      const rows = ids.map((id) => {
        const asset = catalog[`${kind}s`].find((entry) => entry.id === id), attrs = `data-kind="${kind}" data-id="${e(id)}"`;
        return `<tr><td>${e(asset?.name ?? id)}${asset ? "" : ` · ${t("Недоступно", "Unavailable")}`}</td><td>${asset ? button("open-registered-tool", t("Открыть", "Open"), attrs) : ""}${button("unregister-tool", "×", `${attrs} aria-label="${e(t("Убрать из свойств", "Remove from properties"))}"`)}</td></tr>`;
      }).join("");
      return section(toolTitle(kind), `<table class="ms-object-registration"><tbody>${rows}</tbody></table><div class="ms-object-registration-add"><select name="register-${kind}" aria-label="${e(toolTitle(kind))}"${available.length ? "" : " disabled"}>${options(available, available[0]?.id)}</select>${button("register-tool", t("Добавить", "Add"), `data-kind="${kind}"${available.length ? "" : " disabled"}`)}</div>`);
    }).join("");
  }
  playerActionFields({ definition, catalog }) {
    if (!definition) return `<p>${t("Назначьте объекту группу.", "Assign the object to a group.")}</p>`;
    let html = toolKinds.map((kind) => {
      const registered = this.registeredTools(kind, catalog);
      const rows = definition.states.map((state) => {
        const assignments = (this.draft[`${kind}s`] ?? []).map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.playerAction !== false && (!entry.stateIds?.length || entry.stateIds.includes(state.id)))
          .map(({ entry, index }) => `<div>${e(catalog[`${kind}s`].find((asset) => asset.id === entry[`${kind}Id`])?.name ?? entry[`${kind}Id`])}${button("edit-feature", t("Править", "Edit"), `data-kind="${kind}" data-index="${index}"`)}${button("remove-feature", "×", `data-kind="${kind}" data-index="${index}"`)}</div>`).join("");
        return `<tr><td>${e(state.name)}</td><td>${assignments}${button("add-feature", "+", `data-kind="${kind}" data-state-id="${e(state.id)}"${registered.length ? "" : " disabled"}`)}</td></tr>`;
      }).join("");
      const hint = registered.length ? "" : `<p class="ms-note">${t("Сначала добавьте инструмент в «Свойствах» объекта.", "First add a tool in the object's Properties.")}</p>`;
      return section(toolTitle(kind), `${hint}<table class="ms-state-script-table"><thead><tr><th>${t("Состояние", "State")}</th><th>${t("Инструменты", "Tools")}</th></tr></thead><tbody>${rows}</tbody></table>`);
    }).join("");
    const ref = this.selectedFeature, binding = this.activeFeature();
    if (binding && binding.playerAction !== false) html += section(t("Настройка действия игрока", "Player action settings"), `<label>${t("Инструмент", "Tool")}<select name="feature-asset">${options(this.registeredTools(ref.kind, catalog), binding[`${ref.kind}Id`])}</select></label>${input("feature-range", t("Дальность", "Range"), binding.range ?? 5, 'type="number" min="0" step="any"')}${buildConditionFields({ ...binding.conditions, stateIds: binding.stateIds }, definition.states, { prefix: "feature-conditions", groupId: definition.groupId, groupName: definition.groupName })}${button("open-asset", t("Открыть каталог", "Open catalog"))}`);
    return html;
  }
  propertyFields({ scene, catalog: assets }) {
    const catalog = getSignalCatalog(scene), signals = catalog.signals.filter((signal) => signal.emitterKey === this.ownerKey), macros = catalog.macros.filter((macro) => macro.ownerKey === this.ownerKey);
    const scripts = [this.draft.initialScript, ...Object.values(this.draft.transitionScripts ?? {}), ...(this.draft.scripts ?? []), ...(this.draft.commands ?? []).flatMap(command => [command.beforeScript, command.afterScript])].filter(Boolean);
    let html = this.registrationFields(assets);
    html += section(t("Макросы объекта", "Object macros"), `<div data-object-macro-drop><table><tbody>${macros.map((macro) => `<tr><td>${e(macroName(macro.uuid))}<small>${e(scripts.filter((script) => script.steps.some((step) => step.kind === "macro" && step.parameters.macroUuid === macro.uuid)).map((script) => script.name).join(", "))}</small></td><td>${e(this.macroValidation?.get(macro.uuid)?.text ?? "")}</td><td>${button("edit-object-macro", t("Править", "Edit"), `data-uuid="${e(macro.uuid)}"`)}${button("remove-object-macro", "×", `data-uuid="${e(macro.uuid)}"`)}</td></tr>`).join("")}</tbody></table><p class="ms-note">${t("Перетащите макрос Foundry сюда. Подписки проверяются при сохранении.", "Drop a Foundry macro here. Subscriptions are validated when saved.")}</p>${button("create-object-macro", `+ ${t("Макрос", "Macro")}`)}</div>`);
    html += section(t("Подписки", "Subscriptions"), renderSubscriptions(catalog.subscriptions.filter((row) => row.ownerKey === this.ownerKey), catalog));
    if (this.subscriptionDraft) html += renderSubscriptionFields(this.subscriptionDraft, catalog, { fixedOwner: this.ownerKey });
    html += section(t("Сигналы объекта", "Object signals"), `<table><tbody>${signals.map((signal) => `<tr><td>${e(signal.name)}${signal.builtin ? ` · ${t("системный", "system")}` : ""}</td><td>${button("edit-object-signal", t("Править", "Edit"), `data-id="${e(signal.id)}"`)}${signal.builtin ? "" : button("remove-object-signal", "×", `data-id="${e(signal.id)}"`)}</td></tr>`).join("")}</tbody></table>${button("new-object-signal", `+ ${t("Сигнал", "Signal")}`)}`);
    if (this.signalDraft) html += section(t("Сигнал", "Signal"), renderSignalFields(this.signalDraft, catalog) + button("save-object-signal", t("Сохранить сигнал", "Save signal")));
    return html + renderMacroValidation(this.validation);
  }
  capture() {
    if (!this.draft || !this.element) return;
    if (this.tab === "commands") this.draft.commands = readObjectCommandFields(this.element, this.draft.commands, this.selectedCommand, this.context().definitions);
    if (["routine", "transitions", "commands"].includes(this.tab) && this.activeScript() && this.element.querySelector("[data-script-index]")) this.setActiveScript(readScriptFields(this.element, [this.activeScript()])[0]);
    if (this.tab === "player-actions" && this.activeFeature() && this.element.querySelector('[name="feature-asset"]')) {
      const ref = this.selectedFeature, previous = this.activeFeature(), key = `${ref.kind}Id`, id = value(this.element, "feature-asset") || previous[key];
      if (!registeredToolIds(this.draft, ref.kind).includes(id)) throw new Error(t("Сначала добавьте инструмент в «Свойствах» объекта.", "First add a tool in the object's Properties."));
      const conditions = readConditionFields(this.element, "feature-conditions"), next = { ...previous, [key]: id, playerAction: true, stateIds: conditions.stateIds, range: Number(value(this.element, "feature-range")), conditions };
      this.draft[`${ref.kind}s`][ref.index] = next;
      // Keep row indexes stable until this DOM is replaced: another action may
      // already refer to a row in the same form. Registrations are deduplicated by ID.
      this.keepRegistration(ref.kind, previous[key]);
    }
    if (this.tab === "properties") { if (this.signalDraft && this.element.querySelector("[data-signal-fields]")) this.signalDraft = readSignalFields(this.element, this.signalDraft); if (this.subscriptionDraft && this.element.querySelector("[data-subscription-fields]")) this.subscriptionDraft = readSubscriptionFields(this.element, this.subscriptionDraft, getSignalCatalog(this.context().scene), { fixedOwner: this.ownerKey }); }
  }
  keepRegistration(kind, id) {
    if (!registeredToolIds(this.draft, kind).includes(id)) (this.draft[`${kind}s`] ??= []).push(toolRegistration(kind, id));
  }
  onDraftInput(event) { return event.target?.type !== "file"; }
  createScriptTransfer() {
    const selected = clone(this.selectedScript), script = this.activeScript(), eventSignal = this.events?.signal;
    const target = { stateId: selected?.kind === "routine" ? selected.stateId : undefined };
    const references = () => {
      this.assertCurrentScene();
      if (!game.user?.isGM) throw new Error(t("Изменять скрипты может только мастер.", "Only a GM can edit scripts."));
      if (!script || this.activeScript() !== script || JSON.stringify(this.selectedScript) !== JSON.stringify(selected)
        || this.events?.signal !== eventSignal || eventSignal?.aborted || this.persistTask) {
        throw new Error(t("Блок скрипта изменился. Повторите импорт или экспорт.", "The script block changed. Repeat the import or export."));
      }
      const current = this.context(), catalog = getSignalCatalog(current.scene);
      return { binding: this.draft, definitions: current.definitions, signals: catalog.signals, macros: catalog.macros, assets: current.catalog };
    };
    return generics.components.createJSONTransfer({
      filename: () => `master-screen-script-${script?.name || selected?.kind || "block"}.json`,
      validate: (envelope) => { const refs = references(); return exportScriptBlock(importScriptBlock(envelope, target, refs), refs); },
      exportValue: () => exportScriptBlock(readScriptFields(this.element, [script])[0], references()),
      importValue: async (envelope) => {
        const replacement = importScriptBlock(envelope, target, references());
        const accepted = await foundry.applications.api.DialogV2.confirm({
          window: { title: t("Импорт блока скрипта", "Import script block") },
          content: `<p>${t("Заменить выбранный блок содержимым JSON? Другие блоки останутся без изменений. Импорт потребуется сохранить.", "Replace the selected block with this JSON? Other blocks stay unchanged. Save to apply the import.")}</p>`, rejectClose: false
        });
        if (!accepted) return;
        // Refreshes and reference changes while the confirmation was open must
        // be checked again; importing never promotes the form's saved revision.
        importScriptBlock(envelope, target, references());
        this.setActiveScript(replacement); this.dirty = true;
        await this.render({ force: true });
      }, onError: notifyError
    });
  }
  async _onRender(context, options) {
    await super._onRender(context, options); const listeners = { signal: this.events.signal };
    if (this.activeScript() && this.element.querySelector("[data-script-index]")) bindScriptSorting(this.element, [this.activeScript()], () => { this.dirty = true; }, listeners);
    bindScriptParameters(this.element, () => this.scriptParameterContext(), () => { this.dirty = true; }, listeners);
    bindScriptInterruptions(this.element, listeners);
    bindObjectCommandFields(this.element, listeners);
    if (this.activeScript() && this.element.querySelector('[data-dmicher-json-id="script-block-0"]')) {
      const dispose = this.createScriptTransfer().bind(this.element, "script-block-0");
      this.events.signal.addEventListener("abort", dispose, { once: true });
    }
    const disposeSignalFields = bindSignalFields(this.element, { getSignal: () => this.signalDraft, onChange: () => { this.capture(); this.dirty = true; }, onError: notifyError });
    this.events.signal.addEventListener("abort", disposeSignalFields, { once: true });
    this.element.addEventListener("change", (event) => { const target = event.target; try {
      if (target.matches("[data-script-kind]")) { this.capture(); const step = this.activeScript()?.steps[Number(target.dataset.step)]; if (!step) { void this.render({ force: true }); return; } step.parameters = completeScriptParameters(step.kind, undefined, this.context().document); this.dirty = true; void this.render({ force: true }); }
      else if (target.matches('[name="subscription-signal"]')) { this.capture(); void this.render({ force: true }); }
    } catch (error) { notifyError(error); } }, listeners);
    this.element.addEventListener("dragover", (event) => { if (event.target.closest("[data-object-macro-drop]")) event.preventDefault(); }, listeners);
    this.element.addEventListener("drop", (event) => { if (!event.target.closest("[data-object-macro-drop]")) return; event.preventDefault(); void this.attachMacro(event).catch(notifyError); }, listeners);
  }
  async attachMacro(event) { const data = JSON.parse(event.dataTransfer.getData("text/plain")), macro = data.uuid && await fromUuid(data.uuid); if (macro?.documentName !== "Macro") throw new Error(t("Перетащите макрос Foundry.", "Drop a Foundry macro.")); this.capture(); await new SignalCatalog(this.context().scene).attachMacro(this.ownerKey, macro.uuid); return this.render({ force: true }); }
  async handleAction(action, target) {
    if (action === "information") return this.controller.openObjectInfo(this.descriptor);
    // A button from the previous DOM cannot edit the newly loaded selection.
    if (action !== "cancel" && this.renderedDraft && this.renderedDraft !== this.draft) return this.render({ force: true });
    if (["cancel", "save"].includes(action)) return super.handleAction(action, target);
    this.capture(); const context = this.context(), catalog = new SignalCatalog(context.scene);
    if (action === "tab") { this.tab = target.dataset.tab; this.selectedScript = null; }
    else if (action === "edit-command") {
      this.selectedCommand = target.dataset.commandId; this.selectedScript = null;
      if (!this.activeCommand()) { (this.draft.commands ??= []).push(defaultObjectCommand(this.selectedCommand)); this.dirty = true; }
    }
    else if (["edit-command-script", "remove-command-script"].includes(action)) {
      const commandId = target.dataset.commandId, phase = target.dataset.phase;
      if (commandId !== this.selectedCommand || !this.activeCommand() || !["beforeScript", "afterScript"].includes(phase)) return this.render({ force: true });
      this.selectedScript = { kind: "command", commandId, phase };
      if (action === "remove-command-script") { this.setActiveScript(null); this.selectedScript = null; this.dirty = true; }
      else if (!this.activeScript()) {
        this.setActiveScript({ ...newScript(`${objectCommandName(commandId)}: ${phase === "beforeScript" ? t("до команды", "before command") : t("после команды", "after command")}`), interruptions: { command: "ignore" } }); this.dirty = true;
      }
    }
    else if (["edit-script", "delete-script"].includes(action)) {
      const { kind, stateId } = target.dataset, state = context.definition?.states.find((entry) => entry.id === stateId);
      if (kind !== "initial" && !state) { this.selectedScript = null; return this.render({ force: true }); }
      this.selectedScript = { kind, stateId };
      if (action === "delete-script") { this.setActiveScript(null); this.selectedScript = null; this.dirty = true; }
      else if (!this.activeScript()) { this.setActiveScript(newScript(kind === "initial" ? t("Исходное состояние", "Initial state") : state.name, kind === "routine" ? stateId : null)); this.dirty = true; }
    }
    else if (action === "restore-initial") { if (await this.persist()) return this.controller.restoreObjectInitial(this.descriptor); return; }
    else if (["add-script-step", "remove-script-step", "script-point", "script-sound", "script-current-position", "script-current-size"].includes(action)) {
      const script = this.activeScript(), step = script?.steps[Number(target.dataset.step)];
      if (!script || action !== "add-script-step" && !step) return this.render({ force: true });
      if (action === "add-script-step") appendScriptStep(script);
      else if (action === "remove-script-step") removeScriptStep(script, Number(target.dataset.step));
      else if (action === "script-point") { const point = await this.controller.pickPoint(); if (point) step.parameters.position = { ...(step.parameters.position ?? { speed: 5 }), x: point.x, y: point.y }; }
      else if (action === "script-current-position" || action === "script-current-size") {
        const key = action === "script-current-position" ? "position" : "size", geometry = readObjectGeometry(context.document, context.scene)[key];
        if (geometry) step.parameters[key] = { ...completeScriptParameters("move", undefined, context.document)[key], ...step.parameters[key], ...geometry };
      } else { const Picker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker; new Picker({ type: "audio", current: step.parameters.src ?? "", callback: (src) => { step.parameters.src = src; this.dirty = true; void this.render({ force: true }); } }).browse(); return; }
      this.dirty = true;
    }
    else if (["register-tool", "unregister-tool", "open-registered-tool"].includes(action)) {
      const kind = target.dataset.kind;
      if (!toolKinds.includes(kind)) return;
      const id = action === "register-tool" ? value(this.element, `register-${kind}`) : target.dataset.id;
      if (action === "unregister-tool") {
        this.draft[`${kind}s`] = (this.draft[`${kind}s`] ?? []).filter((entry) => entry[`${kind}Id`] !== id);
        this.selectedFeature = null; this.dirty = true;
      } else if (!context.catalog[`${kind}s`].some((asset) => asset.id === id)) return this.render({ force: true });
      else if (action === "open-registered-tool") {
        if (registeredToolIds(this.draft, kind).includes(id)) return this.controller.openAsset(kind, id);
      } else { this.keepRegistration(kind, id); this.dirty = true; }
    }
    else if (["add-feature", "edit-feature", "remove-feature"].includes(action)) {
      const kind = target.dataset.kind;
      if (!toolKinds.includes(kind)) return;
      const entries = this.draft[`${kind}s`] ??= [], index = Number(target.dataset.index);
      if (action === "add-feature") {
        if (!context.definition?.states.some((state) => state.id === target.dataset.stateId)) return this.render({ force: true });
        const id = this.registeredTools(kind, context.catalog)[0]?.id;
        if (!id) return this.render({ force: true });
        const next = { [`${kind}Id`]: id, playerAction: true, stateIds: [target.dataset.stateId], range: 5, conditions: normalizeConditions({ repeat: "always", stateIds: [target.dataset.stateId] }) };
        const registration = entries.findIndex((entry) => entry[`${kind}Id`] === id && entry.playerAction === false);
        if (registration < 0) entries.push(next); else entries[registration] = next;
        this.selectedFeature = { kind, index: entries.indexOf(next) }; this.dirty = true;
      } else if (!entries[index] || entries[index].playerAction === false) { this.selectedFeature = null; return this.render({ force: true }); }
      else if (action === "edit-feature") this.selectedFeature = { kind, index };
      else { const [removed] = entries.splice(index, 1); this.keepRegistration(kind, removed[`${kind}Id`]); this.selectedFeature = null; this.dirty = true; }
    }
    else if (action === "open-asset") {
      const ref = this.selectedFeature, binding = this.activeFeature(), id = ref && binding?.[`${ref.kind}Id`];
      if (!id || !context.catalog[`${ref.kind}s`].some((asset) => asset.id === id)) { this.selectedFeature = null; return this.render({ force: true }); }
      return this.controller.openAsset(ref.kind, id);
    }
    else if (action === "new-object-signal") this.signalDraft = { emitterKey: this.ownerKey, name: t("Новый сигнал", "New signal"), description: "", parameters: [], returns: [] };
    else if (action === "edit-object-signal") this.signalDraft = clone(catalog.list().signals.find((signal) => signal.id === target.dataset.id));
    else if (action === "remove-object-signal") { await catalog.removeSignal(target.dataset.id); this.signalDraft = null; }
    else if (action === "save-object-signal") { this.signalDraft = await catalog.saveSignal(this.signalDraft); this.controller.changed(context.scene); }
    else if (action === "addSignalField") this.signalDraft[target.dataset.direction].push({ name: `field${this.signalDraft[target.dataset.direction].length + 1}`, type: "string", nullable: false });
    else if (action === "removeSignalField") this.signalDraft[target.dataset.direction].splice(Number(target.dataset.index), 1);
    else if (action === "create-object-macro") { const Macro = foundry.documents.Macro?.implementation ?? globalThis.Macro; const macro = await Macro.create({ name: t("Макрос объекта", "Object macro"), type: "script", scope: "global", command: "" }, { renderSheet: true }); if (macro) await catalog.attachMacro(this.ownerKey, macro.uuid); }
    else if (action === "edit-object-macro") return (await fromUuid(target.dataset.uuid))?.sheet?.render(true);
    else if (action === "remove-object-macro") await catalog.removeMacro(this.ownerKey, target.dataset.uuid);
    else if (action === "newSignalSubscription") { this.subscriptionDraft = { ownerKey: this.ownerKey, signalId: "", macroUuid: "", enabled: true }; this.validation = null; }
    else if (action === "editSignalSubscription") { this.subscriptionDraft = clone(catalog.list().subscriptions.find((row) => row.id === target.dataset.id)); this.validation = null; }
    else if (action === "deleteSignalSubscription") { await catalog.removeSubscription(target.dataset.id); this.subscriptionDraft = null; }
    else if (action === "saveSignalSubscription") { try { this.subscriptionDraft = await catalog.saveSubscription(this.subscriptionDraft); this.validation = { valid: true }; } catch (error) { this.validation = { valid: false, error: error.message, snippet: error.snippet }; notifyError(error); } }
    else return super.handleAction(action, target);
    return this.render({ force: true });
  }
}
