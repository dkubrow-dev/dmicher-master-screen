import { EditorApplication } from "./editor.js";
import { ScreenLayout, MAIN_TABS, DETAIL_TABS } from "./screen-layout.js";
import { TAB_LABELS, OTHER_BLOCKS, renderSceneTree, renderEventTree, renderMacroList, renderParameters, renderOtherList, extractLegacyBlock } from "./ide-view.js";
import { SchemeEditor } from "../scheme-editor.js";
import { EventCatalog } from "../event-catalog.js";
import { getDefinitions, getRuntimes } from "../store.js";
import { randomId } from "../model.js";
import { generics } from "../generics.js";

const esc = generics.utilities.escapeHTML;
const clone = (value) => structuredClone(value);
const fieldValue = (root, name, fallback = "") => root?.querySelector(`[name="${name}"]`)?.value ?? fallback;
const checkbox = (root, name) => root?.querySelector(`[name="${name}"]`)?.checked === true;
const plainJSON = (source) => { const value = JSON.parse(source || "{}"); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Статические параметры должны быть JSON объектом."); return value; };
const nextName = (entries, base, key = "name") => { const names = new Set(entries.map((entry) => String(entry[key]).toLocaleLowerCase())); let name = base, index = 2; while (names.has(name.toLocaleLowerCase())) name = `${base} ${index++}`; return name; };
const notify = (error) => { console.error("dmicher-master-screen |", error); globalThis.ui?.notifications?.error(error.message); };
const actionButton = (action, label, extra = "") => `<button type="button" data-screen-action="${action}" ${extra}>${label}</button>`;

/** The IDE owns navigation and draft forms. The existing episode editors remain isolated under Other. */
export class MasterScreenApplication extends EditorApplication {
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/ide.hbs", scrollable: ["[data-main-content]", "[data-detail-content]"] } };

  constructor(controller, { mode = "constructor", presentation = "panel", ...options } = {}) {
    super(controller, { mode: "constructor", ...options });
    this.mode = mode;
    this.layout = new ScreenLayout({ dock: this.dock, onPopupClose: () => {
      this.layout.setPresentation("panel");
      this.captureParameterDraft();
      void this.render({ force: true }).catch(notify);
    } });
    this.layout.presentation = presentation;
    this.selection = { kind: "scheme", id: "main", schemeId: "main" };
    this.parameterDraft = null;
    this.parameterRevision = null;
    this.selectionSceneId = null;
    this.sceneDrafts = new Map();
    this.foldedSchemes = new Set();
    this.otherBlock = "tokens";
    this.tabSettings = new Set();
    this.componentsDisposers = [];
  }

  _insertElement(element) { super._insertElement(element); this.layout.attach(element); }

  async _onClose(options) {
    this.componentsDisposers.forEach((dispose) => dispose()); this.componentsDisposers = [];
    this.layout.dispose();
    return super._onClose(options);
  }

  reservePopup() { return this.layout.reservePopup(); }

  async setPresentation(presentation) {
    this.layout.setPresentation(presentation);
    this.captureParameterDraft();
    return this.render({ force: true });
  }

  async changeMode(mode) {
    if (this.mode === mode) return;
    if (!(await this.mayDiscard())) return false;
    this.resetDraft(); this.parameterDraft = null;
    this.mode = mode;
    this.otherBlock = mode === "director" ? "playback" : "tokens";
    this.layout.preferences.mainTab = "scene";
    this.layout.preferences.hiddenMain = this.layout.preferences.hiddenMain.filter((id) => id !== "scene");
    this.layout.save();
    await this.render({ force: true });
    return true;
  }

  refresh() {
    if (this.rendered && this.selectionSceneId !== this.controller.getContext().scene?.id) return this.render({ force: true });
    return super.refresh();
  }

  onDraftInput(event) {
    if (event.target.matches("[data-tab-visibility]")) return false;
    if (event.target.closest("[data-ide-parameters]")) return true;
    if (event.target.hasAttribute("data-trigger-value")) return false;
    return super.onDraftInput(event);
  }

  captureParameterDraft() {
    if (this.element?.querySelector("[data-ide-parameters]")) this.parameterDraft = this.readParameterDraft();
    else if (this.element?.querySelector("[data-episode-fields]")) this.draft = this.readEpisode();
  }

  async _prepareContext(options) {
    const current = this.controller.getContext();
    if (this.selectionSceneId && this.selectionSceneId !== current.scene?.id) {
      if (this.dirty) this.captureParameterDraft();
      if (this.dirty && this.layout.preferences.mainTab === "other") {
        const inputs = [...(this.element?.querySelectorAll("input[name],select[name],textarea[name]") ?? [])].map((input) => ({ name: input.name, type: input.type, value: input.value, checked: input.checked }));
        this.drafts.set(this.contextKey, { draft: clone(this.draft), revision: this.draftRevision, dirty: true, episodeDirty: this.episodeDirty, inputs });
      }
      this.sceneDrafts.set(this.selectionSceneId, { selection: clone(this.selection), parameterDraft: clone(this.parameterDraft), parameterRevision: this.parameterRevision, dirty: this.dirty, otherBlock: this.otherBlock });
      const saved = this.sceneDrafts.get(current.scene?.id);
      this.selection = saved?.selection ?? { kind: "scheme", id: current.definition.schemeId, schemeId: current.definition.schemeId };
      this.parameterDraft = saved?.parameterDraft ?? null; this.dirty = saved?.dirty ?? false; this.otherBlock = saved?.otherBlock ?? this.otherBlock;
      this.parameterRevision = saved?.parameterRevision ?? null;
    }
    this.selectionSceneId = current.scene?.id;
    const parameterDirty = this.dirty && this.parameterDraft && this.layout.preferences.mainTab !== "other";
    const base = await super._prepareContext(options);
    if (parameterDirty) this.dirty = true;
    const { preferences } = this.layout;
    const catalog = current.scene ? new EventCatalog(current.scene).list() : { events: [], triggers: [], macros: [] };
    const definitions = current.scene ? getDefinitions(current.scene) : [];
    const runtimes = current.scene ? getRuntimes(current.scene) : [];
    const selectedDefinition = definitions.find((definition) => definition.schemeId === this.selection.schemeId);
    let selected;
    if (this.selection.kind === "scheme") selected = definitions.find((definition) => definition.schemeId === this.selection.id);
    if (this.selection.kind === "episode") selected = selectedDefinition?.episodes.find((episode) => episode.id === this.selection.id);
    if (this.selection.kind === "event") selected = catalog.events.find((event) => event.id === this.selection.id);
    if (this.selection.kind === "trigger") selected = catalog.triggers.find((trigger) => trigger.id === this.selection.id);
    if (this.selection.kind === "macro") selected = catalog.macros.find((macro) => macro.uuid === this.selection.id);
    if (!this.dirty || !this.parameterDraft) {
      this.parameterDraft = selected ? clone(selected) : null;
      this.parameterRevision = ["scheme", "episode"].includes(this.selection.kind) ? selectedDefinition?.revision : catalog.revision;
    }
    const activeMain = preferences.mainTab, activeDetail = preferences.detailTab;
    let mainHTML = "", detailHTML = "", nodeActions = "";
    if (activeMain === "scene") {
      mainHTML = renderSceneTree(definitions, runtimes, this.selection, this.mode);
      if (this.mode === "constructor") nodeActions = actionButton("addScheme", "+ Схема") + actionButton("addSceneEpisode", "+ Эпизод") + actionButton("editSelected", "Править") + actionButton("deleteSelected", "Удалить");
    }
    if (activeMain === "events") {
      mainHTML = renderEventTree(catalog, this.selection, this.mode);
      if (this.mode === "constructor") nodeActions = actionButton("addEvent", "+ Событие") + actionButton("addTypedTrigger", "+ Триггер") + actionButton("editSelected", "Править") + actionButton("deleteSelected", "Удалить") + generics.components.renderJSONControls({ id: "event-list", importLabel: "Импорт", exportLabel: "Экспорт" });
    }
    if (activeMain === "macros") {
      mainHTML = renderMacroList(catalog, this.selection, (uuid) => globalThis.game?.macros?.get(uuid.split(".").pop()));
      if (this.mode === "constructor") nodeActions = actionButton("createMacro", "+ Макрос") + actionButton("deleteSelected", "Убрать из ширмы");
    }
    if (activeMain === "other") mainHTML = renderOtherList(this.mode, this.otherBlock);
    if (activeDetail === "reference") {
      const page = { scene: "constructor", events: "events", macros: "macros", other: "start" }[activeMain];
      detailHTML = `<p class="ms-note">Выберите элемент в основной зоне. Параметры сохраняются отдельно от запуска; ручной переход доступен в Режиссёре.</p>${actionButton("contextHelp", "Открыть справку", `data-page="${page}"`)}`;
    } else if (activeMain === "other") {
      if (this.otherBlock === "manual") detailHTML = `<p class="ms-note">Просматривайте магазины, читайте реплики и показывайте диалоги игрокам. Ручные диалоги доступны и после остановки автоматизации.</p>${actionButton("shops", "Магазины")}${actionButton("dialogues", "Диалоги и действия")}`;
      else {
        const renderTemplate = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
        const html = await renderTemplate("modules/dmicher-master-screen/templates/editor.hbs", base);
        detailHTML = extractLegacyBlock(html, this.otherBlock, this.element?.ownerDocument ?? globalThis.document);
      }
    } else detailHTML = renderParameters({ selection: this.selection, draft: this.parameterDraft, catalog, definitions, mode: this.mode });
    const tabs = (ids, zone) => ids.map((id) => ({ id, label: TAB_LABELS[id], visible: !preferences[zone === "main" ? "hiddenMain" : "hiddenDetail"].includes(id), active: preferences[`${zone}Tab`] === id }));
    return { ...base, mainHTML, detailHTML, nodeActions,
      mainTabs: tabs(MAIN_TABS, "main"), detailTabs: tabs(DETAIL_TABS, "detail"), mainSettings: this.tabSettings.has("main"), detailSettings: this.tabSettings.has("detail"),
      isRight: this.dock.preferences.side === "right", isBottom: this.dock.preferences.side === "bottom",
      presentationIcon: this.layout.presentation === "panel" ? "fa-up-right-from-square" : "fa-table-columns",
      presentationTitle: this.layout.presentation === "panel" ? "Открыть ширму в отдельном окне" : "Вернуть ширму в панель" };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.layout.bind();
    for (const id of this.foldedSchemes) this.applyFold(id);
    const selectionKey = `${this.selectionSceneId}:${this.layout.preferences.mainTab}:${JSON.stringify(this.selection)}`;
    if (selectionKey !== this.revealedSelection) {
      const content = this.element.querySelector("[data-main-content]"), row = content?.querySelector('[aria-selected="true"], .is-selected');
      if (row) {
        const area = content.getBoundingClientRect(), selected = row.getBoundingClientRect();
        if (selected.top < area.top) content.scrollTop += selected.top - area.top;
        else if (selected.bottom > area.bottom) content.scrollTop += selected.bottom - area.bottom;
      }
      this.revealedSelection = selectionKey;
    }
    this.componentsDisposers.forEach((dispose) => dispose()); this.componentsDisposers = [];
    this.componentsDisposers.push(generics.components.bindColorFields(this.element));
    for (const key of ["background", "textColor"]) {
      const value = this.parameterDraft?.[key], input = this.element.querySelector(`[data-ide-parameters] [name="${key}"]`);
      if (input && value !== undefined && !/^#[0-9a-f]{6}$/i.test(value)) {
        input.value = value;
        input.dispatchEvent(new this.element.ownerDocument.defaultView.Event("input", { bubbles: true }));
      }
    }
    this.bindJSON();
    const listeners = { signal: this.events.signal };
    this.element.addEventListener("change", (event) => {
      if (event.target.matches("[data-tab-visibility]")) {
        void this.setTabVisible(event.target.dataset.tabVisibility, event.target.value, event.target.checked).catch(notify);
      } else if (event.target.matches('[name="parameterType"], [name="subscriberKind"], [name="subscriberAction"], [name="subscriberScheme"]')) {
        try { this.captureParameterDraft(); this.dirty = true; void this.render({ force: true }); } catch (error) { notify(error); }
      }
    }, listeners);
    this.element.addEventListener("dragstart", (event) => {
      const node = event.target.closest("[data-ide-kind][draggable=true], [data-macro-uuid]");
      if (!node) return;
      const payload = node.dataset.macroUuid ? { type: "Macro", uuid: node.dataset.macroUuid } : { type: "DmicherScreenNode", sceneId: this.selectionSceneId, kind: node.dataset.ideKind, id: node.dataset.ideId, schemeId: node.dataset.schemeId };
      event.dataTransfer.setData("text/plain", JSON.stringify(payload)); event.dataTransfer.effectAllowed = "copyMove";
    }, listeners);
    this.element.addEventListener("dragover", (event) => { if (event.target.closest("[data-ide-kind], [data-macro-drop], [data-macro-subscriber-drop]")) event.preventDefault(); }, listeners);
    this.element.addEventListener("drop", (event) => {
      const target = event.target.closest("[data-ide-kind], [data-macro-drop], [data-macro-subscriber-drop]");
      if (!target) return;
      event.preventDefault(); void this.dropIDE(event, target).catch(notify);
    }, listeners);
  }

  readParameterDraft() {
    const root = this.element?.querySelector("[data-ide-parameters]");
    const draft = clone(this.parameterDraft);
    if (!root || !draft || draft.builtin) return draft;
    if (["scheme", "episode"].includes(this.selection.kind)) {
      const key = this.selection.kind === "scheme" ? "schemeName" : "name";
      draft[key] = fieldValue(root, key).trim();
      draft.background = fieldValue(root, "background"); draft.textColor = fieldValue(root, "textColor");
      if (this.selection.kind === "episode") draft.stop = checkbox(root, "stop");
    }
    if (this.selection.kind === "event") {
      draft.name = fieldValue(root, "eventName").trim();
      draft.subscribers = [...root.querySelectorAll("[data-subscriber-index]")].map((row) => {
        const previous = draft.subscribers[Number(row.dataset.subscriberIndex)] ?? {};
        return { ...previous, id: previous.id ?? randomId(), kind: fieldValue(row, "subscriberKind"), macroUuid: fieldValue(row, "subscriberMacro"), triggerId: fieldValue(row, "subscriberTrigger"),
          action: fieldValue(row, "subscriberAction"), schemeId: fieldValue(row, "subscriberScheme", "main"), parameters: plainJSON(fieldValue(row, "subscriberParameters", "{}")),
          text: fieldValue(row, "subscriberText", previous.text ?? ""), audience: { gms: checkbox(row, "subscriberGMs"), interactor: checkbox(row, "subscriberInteractor"), nearby: checkbox(row, "subscriberNearby"), range: Number(fieldValue(row, "subscriberRange", "30")), visibleOnly: checkbox(row, "subscriberVisible") } };
      });
    }
    if (this.selection.kind === "trigger") {
      draft.name = fieldValue(root, "triggerName").trim(); draft.eventId = fieldValue(root, "triggerEventId");
      draft.parameters = [...root.querySelectorAll("[data-parameter-index]")].map((row) => {
        const result = { name: fieldValue(row, "parameterName").trim(), type: fieldValue(row, "parameterType") };
        for (const key of ["min", "max", "minLength", "maxLength", "decimals"]) {
          const value = fieldValue(row, key); if (value !== "") result[key] = Number(value);
        }
        return result;
      });
    }
    if (this.selection.kind === "macro") draft.triggerIds = [...root.querySelectorAll('[name="macroTrigger"]:checked')].map((input) => input.value);
    return draft;
  }

  assertScene() {
    const scene = this.controller.getContext().scene;
    if (!scene || scene.id !== this.selectionSceneId) throw new Error("Сцена изменилась. Дождитесь обновления ширмы или вернитесь к сцене черновика.");
    return scene;
  }

  async selectNode(kind, id, schemeId) {
    if (!(await this.mayDiscard())) return;
    this.resetDraft(); this.parameterDraft = null;
    if (["scheme", "episode"].includes(kind)) {
      this.controller.selectScheme(schemeId ?? id, { render: false });
      if (kind === "episode") this.controller.selectEpisode(id, { render: false });
    }
    this.selection = { kind, id, schemeId: schemeId ?? this.controller.getContext().definition.schemeId };
    this.layout.preferences.detailTab = "parameters";
    this.layout.preferences.hiddenDetail = this.layout.preferences.hiddenDetail.filter((tab) => tab !== "parameters");
    this.layout.save();
    return this.render({ force: true });
  }

  async setTabVisible(zone, id, visible) {
    if (this.dirty && !visible && this.layout.preferences[`${zone}Tab`] === id && !(await this.mayDiscard())) { return this.render({ force: true }); }
    this.captureParameterDraft();
    if (!this.layout.toggleTab(zone, id, visible)) ui.notifications.warn("Оставьте хотя бы одну вкладку в зоне.");
    return this.render({ force: true });
  }

  applyFold(id) {
    const folded = this.foldedSchemes.has(id);
    for (const row of this.element.querySelectorAll('[data-ide-kind="episode"]')) if (row.dataset.schemeId === id) row.hidden = folded;
    for (const button of this.element.querySelectorAll('[data-screen-action="foldScheme"]')) if (button.dataset.schemeId === id) { button.textContent = folded ? "▸" : "▾"; button.setAttribute("aria-expanded", String(!folded)); }
  }

  async mutateParameters(change) {
    this.parameterDraft = this.readParameterDraft();
    if (this.parameterDraft?.builtin) throw new Error("Встроенное определение нельзя изменять.");
    await change(this.parameterDraft); this.dirty = true; return this.render({ force: true });
  }

  async saveParameters() {
    const scene = this.assertScene(), draft = this.readParameterDraft();
    if (!draft || draft.builtin) throw new Error("Выберите изменяемый элемент.");
    const schemes = new SchemeEditor(scene), catalog = new EventCatalog(scene);
    const options = { expectedRevision: this.parameterRevision };
    if (["scheme", "episode"].includes(this.selection.kind)) {
      try { draft.background = generics.components.normalizeHexColor(draft.background); draft.textColor = generics.components.normalizeHexColor(draft.textColor); }
      catch { throw new Error("Цвет фона и текста указывается в формате #RRGGBB."); }
    }
    if (this.selection.kind === "scheme") await schemes.updateScheme(this.selection.id, { schemeName: draft.schemeName, background: draft.background, textColor: draft.textColor }, options);
    if (this.selection.kind === "episode") await schemes.updateEpisode(this.selection.schemeId, this.selection.id, { name: draft.name, background: draft.background, textColor: draft.textColor, events: draft.events, stop: draft.stop }, options);
    if (this.selection.kind === "event") await catalog.saveEvent(draft, options);
    if (this.selection.kind === "trigger") await catalog.saveTrigger(draft, options);
    if (this.selection.kind === "macro") await catalog.saveMacro(draft, options);
    this.resetDraft(); this.parameterDraft = null; this.controller.changed(scene);
    return this.render({ force: true });
  }

  async handleAction(action, button, event) {
    if (action === "togglePresentation") {
      const next = this.layout.presentation === "panel" ? "window" : "panel";
      if (next === "window") this.reservePopup();
      return this.setPresentation(next);
    }
    if (action === "ideSide") { this.captureParameterDraft(); this.layout.setSide(button.dataset.side); return this.render({ force: true }); }
    if (action === "tabSettings") { this.captureParameterDraft(); const zone = button.dataset.zone; if (this.tabSettings.has(zone)) this.tabSettings.delete(zone); else this.tabSettings.add(zone); return this.render({ force: true }); }
    if (action === "ideTab") {
      if (!(await this.mayDiscard())) return;
      this.resetDraft(); this.parameterDraft = null;
      this.layout.preferences[`${button.dataset.zone}Tab`] = button.dataset.id; this.layout.save();
      return this.render({ force: true });
    }
    if (action === "selectNode") return this.selectNode(button.dataset.kind, button.dataset.id, button.dataset.schemeId);
    if (action === "selectOther") {
      if (!(await this.mayDiscard())) return;
      this.resetDraft(); this.parameterDraft = null; this.otherBlock = button.dataset.id;
      return this.render({ force: true });
    }
    if (action === "foldScheme") { const id = button.dataset.schemeId; if (this.foldedSchemes.has(id)) this.foldedSchemes.delete(id); else this.foldedSchemes.add(id); this.applyFold(id); return; }
    if (action === "contextHelp") return this.controller.openHelp().navigate(button.dataset.page);
    if (action === "editSelected") {
      this.captureParameterDraft();
      this.layout.preferences.detailTab = "parameters";
      this.layout.preferences.hiddenDetail = this.layout.preferences.hiddenDetail.filter((tab) => tab !== "parameters");
      this.layout.save(); await this.render({ force: true });
      this.element.querySelector("[data-detail-content] input")?.focus(); return;
    }
    if (action === "discardParameters") { this.resetDraft(); this.parameterDraft = null; return this.render({ force: true }); }
    if (action === "saveParameters") return this.saveParameters();
    if (action === "addSubscriber") return this.mutateParameters((draft) => draft.subscribers.push({ id: randomId(), kind: "builtin", action: "pause", schemeId: this.selection.schemeId, parameters: {} }));
    if (action === "removeSubscriber") return this.mutateParameters((draft) => { draft.subscribers.splice(Number(button.dataset.index), 1); });
    if (action === "moveSubscriber") return this.mutateParameters((draft) => { const from = Number(button.dataset.index), to = from + Number(button.dataset.delta); if (to < 0 || to >= draft.subscribers.length) return; draft.subscribers.splice(to, 0, draft.subscribers.splice(from, 1)[0]); });
    if (action === "addParameter") return this.mutateParameters((draft) => draft.parameters.push({ name: nextName(draft.parameters, "field").replaceAll(" ", "_"), type: "string" }));
    if (action === "removeParameter") return this.mutateParameters((draft) => { draft.parameters.splice(Number(button.dataset.index), 1); });
    if (action === "addEpisodeEvent") {
      const eventId = fieldValue(this.element, "newEpisodeEvent");
      const chosen = new EventCatalog(this.assertScene()).list().events.find((entry) => entry.id === eventId);
      if (!chosen) throw new Error("Выберите событие.");
      return this.mutateParameters((draft) => { draft.events ??= []; if (!draft.events.includes(chosen.name)) draft.events.push(chosen.name); });
    }
    if (action === "removeEpisodeEvent") return this.mutateParameters((draft) => { draft.events.splice(Number(button.dataset.index), 1); });
    if (action === "enterNode") return this.controller.transition(button.dataset.id, { schemeId: button.dataset.schemeId });
    if (action === "enterSelectedEpisode") return this.controller.transition(this.selection.id, { schemeId: this.selection.schemeId });
    if (action === "haltSelectedScheme") return this.controller.haltScheme(this.selection.schemeId);
    if (action === "resumeSelectedScheme") return this.controller.resumeScheme(fieldValue(this.element, "resumeEpisode"), this.selection.schemeId);
    if (action === "invokeTrigger") return this.invokeTrigger();
    if (action === "editMacro") {
      const macro = await fromUuid(button.dataset.uuid ?? this.selection.id);
      if (!macro || macro.documentName !== "Macro") throw new Error("Макрос недоступен. Проверьте каталог Foundry.");
      return macro.sheet.render(true);
    }
    if (["addScheme", "addSceneEpisode", "addEvent", "addTypedTrigger", "createMacro", "deleteSelected"].includes(action)) return this.changeStructure(action);
    return super.handleAction(action, button, event);
  }

  async changeStructure(action) {
    if (this.mode !== "constructor") throw new Error("Изменение структуры доступно в Конструкторе.");
    if (!(await this.mayDiscard())) return;
    const scene = this.assertScene(), schemes = new SchemeEditor(scene), catalog = new EventCatalog(scene), definitions = schemes.list(), data = catalog.list();
    let selection;
    if (action === "addScheme") { const entry = await schemes.createScheme({ name: nextName(definitions, "Новая схема", "schemeName") }); selection = ["scheme", entry.schemeId, entry.schemeId]; }
    if (action === "addSceneEpisode") { const definition = definitions.find((item) => item.schemeId === this.selection.schemeId) ?? definitions[0]; const entry = await schemes.createEpisode(definition.schemeId, { name: nextName(definition.episodes, "Новый эпизод") }); selection = ["episode", entry.id, definition.schemeId]; }
    if (action === "addEvent") { const entry = await catalog.saveEvent({ name: nextName(data.events, "Новое событие"), subscribers: [] }); selection = ["event", entry.id]; }
    if (action === "addTypedTrigger") {
      const eventId = this.selection.kind === "event" ? this.selection.id : data.triggers.find((entry) => entry.id === this.selection.id)?.eventId;
      if (!eventId) throw new Error("Выберите событие для нового триггера.");
      const entry = await catalog.saveTrigger({ name: nextName(data.triggers, "Новый триггер"), eventId, parameters: [] }); selection = ["trigger", entry.id];
    }
    if (action === "createMacro") {
      const Macro = foundry.documents.Macro?.implementation ?? globalThis.Macro;
      const macro = await Macro.create({ name: "Новый макрос ширмы", type: "script", scope: "global", command: "" }, { renderSheet: true });
      if (!macro) return;
      await catalog.saveMacro({ uuid: macro.uuid, triggerIds: [] }); selection = ["macro", macro.uuid];
    }
    if (action === "deleteSelected") {
      if (this.parameterDraft?.builtin) throw new Error("Встроенные определения нельзя удалять.");
      const confirmed = await this.inlineChoice("Удалить выбранный элемент?", [{ value: "delete", label: "Удалить" }, { value: "cancel", label: "Отмена" }]);
      if (confirmed !== "delete") return;
      if (this.selection.kind === "scheme") await schemes.deleteScheme(this.selection.id);
      else if (this.selection.kind === "episode") await schemes.deleteEpisode(this.selection.schemeId, this.selection.id);
      else if (this.selection.kind === "event") await catalog.deleteEvent(this.selection.id);
      else if (this.selection.kind === "trigger") await catalog.deleteTrigger(this.selection.id);
      else if (this.selection.kind === "macro") await catalog.removeMacro(this.selection.id);
      else throw new Error("Выберите удаляемый элемент.");
    }
    this.resetDraft(); this.parameterDraft = null;
    if (selection) await this.selectNode(...selection); else await this.render({ force: true });
    this.controller.changed(scene);
  }

  async invokeTrigger() {
    const scene = this.assertScene(), catalog = new EventCatalog(scene).list();
    const trigger = catalog.triggers.find((entry) => entry.id === this.selection.id), parent = catalog.events.find((entry) => entry.id === trigger?.eventId);
    if (!trigger || !parent) throw new Error("Выберите триггер события.");
    const payload = { type: trigger.name };
    for (const parameter of trigger.parameters) {
      const input = [...this.element.querySelectorAll("[data-trigger-value]")].find((item) => item.dataset.triggerValue === parameter.name);
      if (parameter.required === false && input?.value === "" && parameter.type !== "boolean") continue;
      if (!input?.checkValidity()) throw new Error(`Проверьте параметр «${parameter.name}».`);
      payload[parameter.name] = parameter.type === "boolean" ? input.checked : parameter.type === "string" ? input.value : Number(input.value);
    }
    await this.controller.events.invoke(scene, parent.name, payload);
    ui.notifications.info("Событие принято.");
  }

  inlineChoice(title, choices) {
    const doc = this.element.ownerDocument, root = doc.createElement("div");
    root.className = "ms-ide-choice"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", title);
    root.innerHTML = `<div><p>${esc(title)}</p>${choices.map((choice) => `<button type="button" data-choice="${esc(choice.value)}">${esc(choice.label)}</button>`).join("")}</div>`;
    this.element.append(root); root.querySelector("button")?.focus();
    return new Promise((resolve) => {
      const finish = (result) => { root.remove(); resolve(result); };
      root.addEventListener("click", (event) => { const selected = event.target.closest("[data-choice]"); if (selected) finish(selected.dataset.choice); });
      root.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); finish("cancel"); } });
    });
  }

  async dropIDE(event, target) {
    if (this.mode !== "constructor") return;
    let data; try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    const scene = this.assertScene(), catalog = new EventCatalog(scene), schemes = new SchemeEditor(scene);
    if (data.type === "Macro" || data.uuid?.startsWith("Macro.")) {
      const macro = await fromUuid(data.uuid);
      if (macro?.documentName !== "Macro") throw new Error("Перетащите макрос Foundry.");
      if (target.hasAttribute("data-macro-subscriber-drop")) {
        if (!catalog.list().macros.some((entry) => entry.uuid === macro.uuid)) {
          await catalog.saveMacro({ uuid: macro.uuid, triggerIds: [] }, { expectedRevision: this.parameterRevision });
          this.parameterRevision++;
        }
        return this.mutateParameters((draft) => { const row = draft.subscribers[Number(target.dataset.subscriberIndex)]; Object.assign(row, { kind: "macro", macroUuid: macro.uuid }); });
      }
      if (!(await this.mayDiscard())) return;
      await catalog.saveMacro(catalog.list().macros.find((entry) => entry.uuid === macro.uuid) ?? { uuid: macro.uuid, triggerIds: [] });
      this.resetDraft(); return this.selectNode("macro", macro.uuid);
    }
    if (data.type !== "DmicherScreenNode" || data.sceneId !== scene.id || !(await this.mayDiscard())) return;
    if (data.kind === "scheme" && target.dataset.ideKind === "scheme") {
      const ids = schemes.list().map((entry) => entry.schemeId), from = ids.indexOf(data.id), to = ids.indexOf(target.dataset.ideId);
      if (from >= 0 && to >= 0) { ids.splice(to, 0, ids.splice(from, 1)[0]); await schemes.reorderSchemes(ids); }
    } else if (data.kind === "episode") {
      const destination = target.dataset.schemeId;
      if (data.schemeId === destination) {
        const ids = schemes.get(destination).episodes.map((entry) => entry.id), from = ids.indexOf(data.id), to = target.dataset.ideKind === "episode" ? ids.indexOf(target.dataset.ideId) : ids.length - 1;
        if (from >= 0 && to >= 0) { ids.splice(to, 0, ids.splice(from, 1)[0]); await schemes.reorderEpisodes(destination, ids); }
      } else {
        const result = await this.inlineChoice("Эпизод в другой схеме: скопировать или переместить?", [{ value: "copy", label: "Скопировать" }, { value: "move", label: "Переместить" }, { value: "cancel", label: "Отмена" }]);
        if (result === "cancel") return;
        const entry = await schemes.transferEpisode(data.schemeId, destination, data.id, { copy: result === "copy" });
        this.resetDraft(); await this.selectNode("episode", entry.id, destination);
      }
    }
    this.resetDraft(); this.parameterDraft = null; this.controller.changed(scene); return this.render({ force: true });
  }

  bindJSON() {
    for (const id of ["selection", "event-list"]) {
      if (!this.element.querySelector(`[data-dmicher-json-id="${id}"]`)) continue;
      const originalScene = this.selectionSceneId, originalSelection = clone(this.selection);
      const assert = () => { const scene = this.assertScene(); if (scene.id !== originalScene || JSON.stringify(this.selection) !== JSON.stringify(originalSelection)) throw new Error("Выбор изменился. Повторите импорт или экспорт."); return scene; };
      const transfer = generics.components.createJSONTransfer({
        filename: () => `master-screen-${originalSelection.kind}-${originalSelection.id}.json`,
        validate: (value) => { const expected = id === "event-list" ? "event" : originalSelection.kind; if (!value || value.format !== "dmicher-master-screen" || value.version !== 1 || value.kind !== expected) throw new Error("JSON не соответствует выбранному виду объекта Ширмы."); return value; },
        exportValue: () => {
          const scene = assert();
          if (this.dirty) throw new Error("Сначала сохраните изменения, затем экспортируйте.");
          if (originalSelection.kind === "scheme") return new SchemeEditor(scene).exportScheme(originalSelection.id);
          if (originalSelection.kind === "episode") return new SchemeEditor(scene).exportEpisode(originalSelection.schemeId, originalSelection.id);
          if (originalSelection.kind === "event") return new EventCatalog(scene).exportEvent(originalSelection.id);
          if (originalSelection.kind === "trigger") return new EventCatalog(scene).exportTrigger(originalSelection.id);
          throw new Error("Выберите схему, эпизод, пользовательское событие или триггер.");
        },
        importValue: async (value) => {
          const scene = assert();
          if (!(await this.mayDiscard())) return;
          let selection;
          if (value.kind === "scheme") { const entry = await new SchemeEditor(scene).importScheme(value); selection = ["scheme", entry.schemeId, entry.schemeId]; }
          if (value.kind === "episode") { const entry = await new SchemeEditor(scene).importEpisode(originalSelection.schemeId, value); selection = ["episode", entry.id, originalSelection.schemeId]; }
          if (value.kind === "event") { const entry = await new EventCatalog(scene).importEvent(value); selection = ["event", entry.id]; }
          if (value.kind === "trigger") { const entry = await new EventCatalog(scene).importTrigger(value); selection = ["trigger", entry.id]; }
          this.resetDraft(); this.parameterDraft = null; this.controller.changed(scene);
          if (selection) await this.selectNode(...selection);
        }, onError: notify
      });
      this.componentsDisposers.push(transfer.bind(this.element, id));
    }
  }
}
