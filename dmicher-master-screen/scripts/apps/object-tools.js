import { ScreenFormApplication } from "./editor.js";
import { themedClasses, notifyError } from "../ui.js";
import { generics } from "../generics.js";
import { currentScene, getDefinitions, getObjectTags } from "../store.js";
import { SceneObjects, getObjectBindings, getSceneObject } from "../scene-objects.js";
import { getInteractionCatalog } from "../scene-assets.js";
import { SignalCatalog, getSignalCatalog } from "../signal-catalog.js";
import { normalizeConditions } from "../model.js";
import { buildConditionFields, readConditionFields, splitTags } from "./condition-fields.js";
import { scriptStepTemplate } from "../script-model.js";
import { buildScriptFields, readScriptFields, appendScriptStep, removeScriptStep, bindScriptSorting } from "./script-fields.js";
import { renderSignalFields, readSignalFields, renderSubscriptions, renderSubscriptionFields, readSubscriptionFields, renderMacroValidation, macroName, macroValidationSummary } from "./signal-fields.js";

const t = (ru, en) => game.i18n?.lang?.startsWith("ru") ? ru : en;
const e = (value) => generics.utilities.escapeHTML(String(value ?? ""));
const clone = (value) => structuredClone(value);
const value = (root, name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
const input = (name, label, text = "", attrs = "") => `<label>${e(label)}<input name="${name}" value="${e(text)}" ${attrs}></label>`;
const options = (items, current, empty = t("Не выбрано", "Not selected")) => `<option value="">${e(empty)}</option>${items.map((item) => `<option value="${e(item.id)}"${current === item.id ? " selected" : ""}>${e(item.name)}</option>`).join("")}`;
const button = (action, label, attrs = "") => `<button type="button" data-screen-action="${action}" ${attrs}>${e(label)}</button>`;
const section = (title, body) => `<section class="ms-object-feature"><h3>${e(title)}</h3>${body}</section>`;
const layout = (body, nav = "") => nav + `<div class="ms-object-scroll">${body}</div><footer>${button("cancel", t("Закрыть", "Close"))}${button("save", t("Сохранить", "Save"))}</footer>`;
const newScript = (name, stateId) => ({ ...(stateId ? { stateId } : {}), name, enabled: true, repeat: false, steps: [] });

class ObjectForm extends ScreenFormApplication {
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/object-tools.hbs", scrollable: [".ms-object-scroll"] } };
  constructor(controller, descriptor, options = {}) { super(options); this.controller = controller; this.descriptor = { type: descriptor.type, id: descriptor.id }; this.sceneId = currentScene()?.id; this.draft = null; }
  get ownerKey() { return `${this.descriptor.type}:${this.descriptor.id}`; }
  context() {
    const scene = game.scenes?.get(this.sceneId) ?? (currentScene()?.id === this.sceneId ? currentScene() : null), document = scene && getSceneObject(scene, this.descriptor);
    if (!document) throw new Error(t("Объект больше не существует.", "The object no longer exists."));
    if (!this.draft) {
      this.revision = getObjectBindings(scene).revision;
      this.draft = clone(new SceneObjects(scene).get(this.descriptor) ?? { ...this.descriptor, groupId: null, tags: getObjectTags(scene, this.descriptor), notes: "", playerCharacter: false, initialScript: null, transitionScripts: {}, scripts: [], shops: [], dialogues: [] });
      this.original = clone(this.draft);
    }
    const definitions = getDefinitions(scene), definition = definitions.find((item) => item.groupId === this.draft.groupId);
    return { scene, document, definitions, definition, catalog: getInteractionCatalog(scene) };
  }
  async _onRender(context, options) { await super._onRender(context, options); this.bindEvents(); }
  refresh() { if (this.rendered && !this.dirty) { this.draft = null; return this.render({ force: true }); } }
  assertCurrentScene() { if (currentScene()?.id !== this.sceneId) throw new Error(t("Вернитесь к сцене редактируемого объекта.", "Return to this object's scene.")); }
  async persist({ close = false } = {}) {
    this.assertCurrentScene(); const scene = this.context().scene;
    const patch = Object.fromEntries(["groupId", "tags", "notes", "playerCharacter", "initialScript", "transitionScripts", "scripts", "shops", "dialogues"].filter((key) => JSON.stringify(this.draft[key]) !== JSON.stringify(this.original[key])).map((key) => [key, clone(this.draft[key])]));
    if (Object.keys(patch).length) await new SceneObjects(scene).save(this.descriptor, patch, { expectedRevision: this.revision, allowReassign: true });
    this.draft = null; this.dirty = false; if (close) await this.close(); this.controller.changed(scene); if (!close) await this.render({ force: true });
  }
  async handleAction(action) { if (action === "cancel" && await this.mayDiscard()) return this.close(); if (action === "save") { this.capture(); return this.persist(); } }
}

export class ObjectInfoApplication extends ObjectForm {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-object-info"), position: { width: 570, height: "auto" }, window: { resizable: true } };
  get title() { return t("Информация об объекте", "Object information"); }
  async _prepareContext() {
    const { document, definitions } = this.context();
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
  tab = "transitions"; selectedScript = null; selectedFeature = null; signalDraft = null; subscriptionDraft = null; validation = null;
  get title() { return t("Поведение объекта", "Object behavior"); }
  activeScript() { const ref = this.selectedScript; return !ref ? null : ref.kind === "initial" ? this.draft.initialScript : ref.kind === "transition" ? this.draft.transitionScripts?.[ref.stateId] : this.draft.scripts?.find((script) => script.stateId === ref.stateId); }
  setActiveScript(script) {
    const ref = this.selectedScript;
    if (ref.kind === "initial") this.draft.initialScript = script;
    else if (ref.kind === "transition") { this.draft.transitionScripts ??= {}; if (script) this.draft.transitionScripts[ref.stateId] = script; else delete this.draft.transitionScripts[ref.stateId]; }
    else { this.draft.scripts ??= []; const i = this.draft.scripts.findIndex((item) => item.stateId === ref.stateId); if (i >= 0) this.draft.scripts.splice(i, 1); if (script) this.draft.scripts.push(script); }
  }
  async _prepareContext() {
    const context = this.context(), { definition } = context;
    const nav = `<nav class="ms-object-tabs">${[["transitions", t("Переходы", "Transitions")], ["features", t("Особенности", "Features")], ["routine", t("Рутина", "Routine")], ["automation", t("Автоматизация", "Automation")]].map(([tab, name]) => button("tab", name, `data-tab="${tab}" aria-pressed="${this.tab === tab}"`)).join("")}</nav>`;
    let body;
    if (this.tab === "automation") {
      const catalog = getSignalCatalog(context.scene);
      this.macroValidation = new Map(await Promise.all(catalog.macros.filter((macro) => macro.ownerKey === this.ownerKey).map(async (macro) => [macro.uuid, await macroValidationSummary(catalog, macro)])));
      body = this.automationFields(context);
    }
    else if (this.tab === "features") body = this.featureFields(context);
    else {
      body = this.tab === "transitions" ? section(t("Исходное состояние", "Initial state"), `<p class="ms-note">${t("Возвращение объекта к началу приключения выполняется только по явной команде.", "Resetting the object to the beginning runs only on an explicit command.")}</p>${this.scriptEntry(this.draft.initialScript, "initial")}${this.draft.initialScript ? button("restore-initial", t("Восстановить исходное состояние", "Restore initial state")) : ""}`) : "";
      body += definition ? this.stateScriptTable(definition, this.tab === "transitions" ? "transition" : "routine") : `<p>${t("Назначьте группу в информации об объекте, чтобы настроить состояния.", "Assign a group in object information to configure states.")}</p>`;
      const script = this.activeScript();
      if (script) body += buildScriptFields([script], definition ?? { states: [] }, this.descriptor.type, getSignalCatalog(context.scene), { ownerKey: this.ownerKey, open: true, combatSupported: Boolean(game.system?.id && globalThis.CONFIG?.Combat?.documentClass) });
    }
    return { body: layout(`${this.draft.playerCharacter ? `<p class="ms-note">${t("Автоматизация персонажа игрока отключена.", "Player-character automation is disabled.")}</p>` : ""}${body}`, nav) };
  }
  scriptEntry(script, kind, stateId = "") { const attrs = `data-kind="${kind}" data-state-id="${e(stateId)}"`; return `<span>${e(script?.name || "—")}</span>${button("edit-script", script ? t("Править", "Edit") : t("Создать", "Create"), attrs)}${script ? button("delete-script", "×", attrs) : ""}`; }
  stateScriptTable(group, kind) { return section(t("Состояния", "States"), `<table class="ms-state-script-table"><thead><tr><th>${t("Состояние", "State")}</th><th>${t("Скрипт", "Script")}</th></tr></thead><tbody>${group.states.map((state) => `<tr><td>${e(state.name)}</td><td>${this.scriptEntry(kind === "transition" ? this.draft.transitionScripts?.[state.id] : this.draft.scripts?.find((script) => script.stateId === state.id), kind, state.id)}</td></tr>`).join("")}</tbody></table>`); }
  featureFields({ definition, catalog }) {
    if (!definition) return `<p>${t("Назначьте объекту группу.", "Assign the object to a group.")}</p>`;
    let html = ["shop", "dialogue"].map((kind) => section(kind === "shop" ? t("Магазины", "Shops") : t("Диалоги", "Dialogues"), `<table class="ms-state-script-table"><thead><tr><th>${t("Состояние", "State")}</th><th>${t("Инструменты", "Tools")}</th></tr></thead><tbody>${definition.states.map((state) => `<tr><td>${e(state.name)}</td><td>${(this.draft[`${kind}s`] ?? []).map((entry, index) => ({ entry, index })).filter(({ entry }) => !entry.stateIds?.length || entry.stateIds.includes(state.id)).map(({ entry, index }) => `<div>${e(catalog[`${kind}s`].find((asset) => asset.id === entry[`${kind}Id`])?.name ?? entry[`${kind}Id`])}${button("edit-feature", t("Править", "Edit"), `data-kind="${kind}" data-index="${index}"`)}${button("remove-feature", "×", `data-kind="${kind}" data-index="${index}"`)}</div>`).join("")}${button("add-feature", "+", `data-kind="${kind}" data-state-id="${e(state.id)}"`)}</td></tr>`).join("")}</tbody></table>`)).join("");
    const ref = this.selectedFeature, binding = ref && this.draft[`${ref.kind}s`]?.[ref.index];
    if (binding) html += section(t("Настройка взаимодействия", "Interaction settings"), `<label>${t("Инструмент", "Tool")}<select name="feature-asset">${options(catalog[`${ref.kind}s`], binding[`${ref.kind}Id`])}</select></label>${input("feature-range", t("Дальность", "Range"), binding.range ?? 5, 'type="number" min="0" step="any"')}${buildConditionFields({ ...binding.conditions, stateIds: binding.stateIds }, definition.states, { prefix: "feature-conditions", groupId: definition.groupId, groupName: definition.groupName })}${button("open-asset", t("Открыть каталог", "Open catalog"))}`);
    return html;
  }
  automationFields({ scene }) {
    const catalog = getSignalCatalog(scene), signals = catalog.signals.filter((signal) => signal.emitterKey === this.ownerKey), macros = catalog.macros.filter((macro) => macro.ownerKey === this.ownerKey);
    const scripts = [this.draft.initialScript, ...Object.values(this.draft.transitionScripts ?? {}), ...(this.draft.scripts ?? [])].filter(Boolean);
    let html = section(t("Сигналы объекта", "Object signals"), `<table><tbody>${signals.map((signal) => `<tr><td>${e(signal.name)}${signal.builtin ? ` · ${t("системный", "system")}` : ""}</td><td>${button("edit-object-signal", t("Править", "Edit"), `data-id="${e(signal.id)}"`)}${signal.builtin ? "" : button("remove-object-signal", "×", `data-id="${e(signal.id)}"`)}</td></tr>`).join("")}</tbody></table>${button("new-object-signal", `+ ${t("Сигнал", "Signal")}`)}`);
    if (this.signalDraft) html += section(t("Сигнал", "Signal"), renderSignalFields(this.signalDraft, catalog) + button("save-object-signal", t("Сохранить сигнал", "Save signal")));
    html += section(t("Макросы объекта", "Object macros"), `<div data-object-macro-drop><table><tbody>${macros.map((macro) => `<tr><td>${e(macroName(macro.uuid))}<small>${e(scripts.filter((script) => script.steps.some((step) => step.kind === "macro" && step.parameters.macroUuid === macro.uuid)).map((script) => script.name).join(", "))}</small></td><td>${e(this.macroValidation?.get(macro.uuid)?.text ?? "")}</td><td>${button("edit-object-macro", t("Править", "Edit"), `data-uuid="${e(macro.uuid)}"`)}${button("remove-object-macro", "×", `data-uuid="${e(macro.uuid)}"`)}</td></tr>`).join("")}</tbody></table><p class="ms-note">${t("Перетащите макрос Foundry сюда. Подписки проверяются при сохранении.", "Drop a Foundry macro here. Subscriptions are validated when saved.")}</p>${button("create-object-macro", `+ ${t("Макрос", "Macro")}`)}</div>`);
    html += section(t("Подписки", "Subscriptions"), renderSubscriptions(catalog.subscriptions.filter((row) => row.ownerKey === this.ownerKey), catalog));
    if (this.subscriptionDraft) html += renderSubscriptionFields(this.subscriptionDraft, catalog, { fixedOwner: this.ownerKey });
    return html + renderMacroValidation(this.validation);
  }
  capture() {
    if (!this.draft || !this.element) return;
    if (["routine", "transitions"].includes(this.tab) && this.activeScript() && this.element.querySelector("[data-script-index]")) this.setActiveScript(readScriptFields(this.element, [this.activeScript()])[0]);
    if (this.tab === "features" && this.selectedFeature && this.element.querySelector('[name="feature-asset"]')) { const ref = this.selectedFeature, conditions = readConditionFields(this.element, "feature-conditions"); this.draft[`${ref.kind}s`][ref.index] = { ...this.draft[`${ref.kind}s`][ref.index], [`${ref.kind}Id`]: value(this.element, "feature-asset"), stateIds: conditions.stateIds, range: Number(value(this.element, "feature-range")), conditions }; }
    if (this.tab === "automation") { if (this.signalDraft && this.element.querySelector("[data-signal-fields]")) this.signalDraft = readSignalFields(this.element, this.signalDraft); if (this.subscriptionDraft && this.element.querySelector("[data-subscription-fields]")) this.subscriptionDraft = readSubscriptionFields(this.element, this.subscriptionDraft, getSignalCatalog(this.context().scene), { fixedOwner: this.ownerKey }); }
  }
  async _onRender(context, options) {
    await super._onRender(context, options); const listeners = { signal: this.events.signal };
    if (this.activeScript() && this.element.querySelector("[data-script-index]")) bindScriptSorting(this.element, [this.activeScript()], () => { this.dirty = true; }, listeners);
    this.element.addEventListener("change", (event) => { const target = event.target; try {
      if (target.matches("[data-script-kind],[data-script-definition],[data-script-emoji]")) { this.capture(); const step = this.activeScript().steps[Number(target.dataset.step)]; if (target.matches("[data-script-kind]")) step.parameters = scriptStepTemplate(step.kind).parameters; else if (target.matches("[data-script-emoji]")) step.parameters.emoji = target.value; else if (step.kind === "macro") step.parameters.macroUuid = target.value; else { step.parameters.signalId = target.value; const signal = getSignalCatalog(this.context().scene).signals.find((row) => row.id === target.value); step.parameters.parameters = Object.fromEntries((signal?.parameters ?? []).map((field) => [field.name, Object.hasOwn(field, "default") ? field.default : field.nullable ? null : field.type === "string" ? "" : field.type === "boolean" ? false : 0])); } this.dirty = true; void this.render({ force: true }); }
      else if (target.matches('[name="field-type"],[name="subscription-signal"]')) { this.capture(); void this.render({ force: true }); }
    } catch (error) { notifyError(error); } }, listeners);
    this.element.addEventListener("dragover", (event) => { if (event.target.closest("[data-object-macro-drop]")) event.preventDefault(); }, listeners);
    this.element.addEventListener("drop", (event) => { if (!event.target.closest("[data-object-macro-drop]")) return; event.preventDefault(); void this.attachMacro(event).catch(notifyError); }, listeners);
  }
  async attachMacro(event) { const data = JSON.parse(event.dataTransfer.getData("text/plain")), macro = data.uuid && await fromUuid(data.uuid); if (macro?.documentName !== "Macro") throw new Error(t("Перетащите макрос Foundry.", "Drop a Foundry macro.")); this.capture(); await new SignalCatalog(this.context().scene).attachMacro(this.ownerKey, macro.uuid); return this.render({ force: true }); }
  async handleAction(action, target) {
    if (action === "information") return this.controller.openObjectInfo(this.descriptor);
    if (["cancel", "save"].includes(action)) return super.handleAction(action, target);
    this.capture(); const context = this.context(), catalog = new SignalCatalog(context.scene);
    if (action === "tab") { this.tab = target.dataset.tab; this.selectedScript = null; }
    else if (["edit-script", "delete-script"].includes(action)) { this.selectedScript = { kind: target.dataset.kind, stateId: target.dataset.stateId }; if (action === "delete-script") { this.setActiveScript(null); this.selectedScript = null; this.dirty = true; } else if (!this.activeScript()) { this.setActiveScript(newScript(this.selectedScript.kind === "initial" ? t("Исходное состояние", "Initial state") : context.definition.states.find((state) => state.id === this.selectedScript.stateId)?.name ?? t("Скрипт", "Script"), this.selectedScript.kind === "routine" ? this.selectedScript.stateId : null)); this.dirty = true; } }
    else if (action === "restore-initial") { await this.persist(); return this.controller.restoreObjectInitial(this.descriptor); }
    else if (["add-script-step", "remove-script-step", "script-point", "script-sound"].includes(action)) { const script = this.activeScript(), step = script.steps[Number(target.dataset.step)]; if (action === "add-script-step") appendScriptStep(script); else if (action === "remove-script-step") removeScriptStep(script, Number(target.dataset.step)); else if (action === "script-point") { const point = await this.controller.pickPoint(); if (point) step.parameters.position = { ...(step.parameters.position ?? { speed: 5 }), x: point.x, y: point.y }; } else { const Picker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker; new Picker({ type: "audio", current: step.parameters.src ?? "", callback: (src) => { step.parameters.src = src; this.dirty = true; void this.render({ force: true }); } }).browse(); return; } this.dirty = true; }
    else if (["add-feature", "edit-feature", "remove-feature"].includes(action)) { const kind = target.dataset.kind, entries = this.draft[`${kind}s`] ??= []; if (action === "add-feature") { entries.push({ [`${kind}Id`]: context.catalog[`${kind}s`][0]?.id ?? "", stateIds: [target.dataset.stateId], range: 5, conditions: normalizeConditions({ repeat: "always", stateIds: [target.dataset.stateId] }) }); this.selectedFeature = { kind, index: entries.length - 1 }; this.dirty = true; } else if (action === "edit-feature") this.selectedFeature = { kind, index: Number(target.dataset.index) }; else { entries.splice(Number(target.dataset.index), 1); this.selectedFeature = null; this.dirty = true; } }
    else if (action === "open-asset") { const ref = this.selectedFeature; return this.controller.openAsset(ref.kind, this.draft[`${ref.kind}s`][ref.index][`${ref.kind}Id`]); }
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
