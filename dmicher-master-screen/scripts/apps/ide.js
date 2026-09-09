import { EditorApplication } from "./editor.js";
import { ScreenLayout, MAIN_TABS, DETAIL_TABS } from "./screen-layout.js";
import { TAB_LABELS, OTHER_BLOCKS, renderSceneTree, renderEventTree, renderMacroList, renderParameters, renderOtherList, extractLegacyBlock, renderMenu, renderMenuSettings, eventSources, renderObjectList } from "./ide-view.js";
import { menuParent } from "./navigation-tree.js";
import { renderSchemeBadges, updateSceneNavigationBadges } from "./scheme-badges.js";
import { SchemeEditor } from "../scheme-editor.js";
import { EventCatalog } from "../event-catalog.js";
import { getDefinitions, getRuntimes } from "../store.js";
import { randomId, localizedDescription } from "../model.js";
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
    this.selection = { kind: null, id: null, schemeId: null };
    this.parameterDraft = null;
    this.parameterRevision = null;
    this.selectionSceneId = null;
    this.tabStates = new Map();
    this.menuBranch = menuParent(this.layout.preferences.mainTab);
    this.foldedSchemes = new Set();
    this.otherBlock = "tokens";
    this.componentsDisposers = [];
  }

  _insertElement(element) { super._insertElement(element); this.layout.attach(element); }

  async _onClose(options) {
    this.menuDialog?.close(); this.menuDialog?.remove(); this.menuObserver?.disconnect();
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
    this.storeTabState();
    this.mode = mode;
    this.otherBlock = mode === "director" ? "playback" : "tokens";
    this.layout.preferences.mainTab = "scene";
    this.layout.preferences.hiddenMain = this.layout.preferences.hiddenMain.filter((id) => id !== "scene");
    this.layout.save();
    this.restoreTabState("scene"); this.menuBranch = null;
    await this.render({ force: true });
    return true;
  }

  refresh() {
    const scene = this.controller.getContext().scene;
    if (this.rendered && this.selectionSceneId !== scene?.id) return this.render({ force: true });
    const badges = this.element?.querySelector(".ms-scheme-badges");
    if (badges) badges.innerHTML = renderSchemeBadges(getDefinitions(scene), getRuntimes(scene));
    return super.refresh();
  }

  onDraftInput(event) {
    if (event.target.matches("[data-tab-visibility]")) return false;
    if (event.target.closest("[data-ide-parameters]")) return true;
    if (event.target.hasAttribute("data-trigger-value")) return false;
    return super.onDraftInput(event);
  }

  captureParameterDraft() {
    const inputs = this.snapshotInputs();
    if (inputs.length) this.pendingTabInputs = inputs;
    try {
      if (this.element?.querySelector("[data-ide-parameters]")) this.parameterDraft = this.readParameterDraft();
      else if (this.element?.querySelector("[data-episode-fields]")) this.draft = this.readEpisode();
    } catch (error) { if (!this.dirty) throw error; }
  }

  snapshotInputs() { return [...(this.element?.querySelectorAll("[data-detail-content] input[name],[data-detail-content] select[name],[data-detail-content] textarea[name]") ?? [])].map((input) => ({ name: input.name, type: input.type, value: input.value, checked: input.checked })); }
  stateKey(tab = this.layout.preferences.mainTab, sceneId = this.selectionSceneId) { return `${sceneId}:${this.mode}:${tab}`; }
  storeTabState() {
    if (!this.selectionSceneId) return;
    const context = this.controller.getContext();
    this.tabStates.set(this.stateKey(), { selection: clone(this.selection), parameterDraft: clone(this.parameterDraft), parameterRevision: this.parameterRevision, dirty: this.dirty,
      draft: clone(this.draft), draftRevision: this.draftRevision, episodeDirty: this.episodeDirty, otherBlock: this.otherBlock, contextKey: this.contextKey,
      inputs: this.dirty ? (this.snapshotInputs().length ? this.snapshotInputs() : this.pendingTabInputs) : null, schemeId: context.scene?.id === this.selectionSceneId ? context.schemeId : this.selection.schemeId,
      episodeId: context.scene?.id === this.selectionSceneId ? context.selectedEpisodeId : this.selection.episodeId });
  }
  restoreTabState(tab, sceneId = this.selectionSceneId) {
    const saved = this.tabStates.get(this.stateKey(tab, sceneId));
    if (saved?.schemeId) {
      const context = this.controller.getContext();
      if (context.definitions?.some((definition) => definition.schemeId === saved.schemeId)) {
        this.controller.selectScheme(saved.schemeId, { render: false });
        if (this.controller.getContext().definition.episodes.some((episode) => episode.id === saved.episodeId)) this.controller.selectEpisode(saved.episodeId, { render: false, resetDraft: false });
      }
    }
    this.selection = clone(saved?.selection ?? { kind: null, id: null, schemeId: this.controller.getContext().schemeId });
    this.parameterDraft = clone(saved?.parameterDraft ?? null); this.parameterRevision = saved?.parameterRevision ?? null;
    this.draft = clone(saved?.draft ?? null); this.draftRevision = saved?.draftRevision ?? null; this.episodeDirty = saved?.episodeDirty ?? false;
    this.dirty = saved?.dirty ?? false; this.otherBlock = saved?.otherBlock ?? null; this.contextKey = saved?.contextKey ?? "";
    this.pendingInputs = null; this.pendingTabInputs = saved?.inputs ?? null;
  }
  selectDraftContext(key) { this.contextKey = key; }
  resetDraft() {
    super.resetDraft(); this.pendingTabInputs = null;
    this.tabStates?.delete(this.stateKey());
  }
  async switchMainTab(tab) {
    if (!MAIN_TABS.includes(tab) || this.layout.preferences.mainTab === tab) return;
    this.storeTabState();
    this.layout.preferences.mainTab = tab; this.menuBranch = menuParent(tab); this.layout.save();
    this.restoreTabState(tab);
    return this.render({ force: true });
  }
  hasUnsavedChanges() { return this.dirty || [...this.tabStates.values()].some((state) => state.dirty); }
  async mayClose() {
    if (!this.hasUnsavedChanges()) return true;
    return foundry.applications.api.DialogV2.confirm({ window: { title: "Несохранённые изменения вкладок" }, content: "<p>Закрыть ширму и отменить несохранённые изменения, включая скрытые вкладки?</p>", rejectClose: false });
  }

  async _prepareContext(options) {
    let current = this.controller.getContext();
    if (this.selectionSceneId && this.selectionSceneId !== current.scene?.id) {
      this.storeTabState();
      this.restoreTabState(this.layout.preferences.mainTab, current.scene?.id);
      current = this.controller.getContext();
    }
    this.selectionSceneId = current.scene?.id;
    const parameterDirty = this.dirty && this.parameterDraft;
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
    this.toolRows = [];
    let mainHTML = "", detailHTML = "", nodeActions = "";
    if (activeMain === "scene") {
      mainHTML = renderSceneTree(definitions, runtimes, this.selection, this.mode);
      if (!definitions.length) mainHTML = '<p class="ms-note">В этой сцене пока нет схем. Создайте схему — в ней появится первый эпизод.</p>';
      if (this.mode === "constructor") nodeActions = actionButton("addScheme", "Создать схему") + (definitions.length ? actionButton("addSceneEpisode", "+ Эпизод") + actionButton("editSelected", "Править") + actionButton("deleteSelected", "Удалить") : "") + generics.components.renderJSONControls({ id: "scheme-list", importLabel: "Импорт схемы", exportLabel: "Экспорт схемы" });
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
    if (["shops", "dialogues"].includes(activeMain)) {
      this.toolRows = definitions.flatMap((definition) => definition.episodes.flatMap((episode) => activeMain === "dialogues"
        ? [{ id: `${definition.schemeId}:${episode.id}`, name: `${definition.schemeName} · ${episode.name}`, schemeId: definition.schemeId, episodeId: episode.id, detail: `${episode.dialogues?.length ?? 0} диал.`, schemeName: definition.schemeName }]
        : current.tokens.map((token) => ({ id: `${definition.schemeId}:${episode.id}:${token.id}`, name: `${token.name}${episode.tokens[token.id]?.shop?.enabled ? " · магазин" : ""}`, tokenId: token.id, schemeId: definition.schemeId, episodeId: episode.id, episodeName: episode.name, schemeName: definition.schemeName }))));
      mainHTML = renderObjectList(this.toolRows, this.selection, activeMain);
      nodeActions = actionButton(activeMain === "shops" ? "shops" : "dialogues", activeMain === "shops" ? "Состояния магазинов" : "Просмотр и ручной показ");
    }
    if (activeMain === "sources") { this.toolRows = eventSources(definitions, current.scene); mainHTML = renderObjectList(this.toolRows, this.selection, "sources"); }
    if (activeDetail === "reference") {
      const page = { scene: "constructor", events: "events", macros: "macros", shops: "shops", dialogues: "dialogues", sources: "events", other: "start" }[activeMain];
      detailHTML = `<p class="ms-note">Выберите элемент в основной зоне. Параметры сохраняются отдельно от запуска; ручной переход доступен в Режиссёре.</p>${actionButton("contextHelp", "Открыть справку", `data-page="${page}"`)}`;
    } else if (["shops", "dialogues", "sources"].includes(activeMain)) {
      const row = this.toolRows.find((entry) => this.selection.kind === activeMain && entry.id === this.selection.id);
      detailHTML = '<p class="ms-note">Выберите элемент в основной зоне.</p>';
      if (row) {
        detailHTML = `<h3>${esc(row.name)}</h3><p class="ms-note">${esc(row.schemeName)} · ${esc(row.episodeName ?? current.episode?.name ?? "")}</p>`;
        if (activeMain === "shops") detailHTML += '<p class="ms-note">Каталог, правила подтверждения и доступность магазина настраиваются в поведении НИП для этого эпизода.</p>' + (this.mode === "constructor" ? actionButton("configureTool", "Настроить магазин") : "") + actionButton("shops", "Состояния и участие в торговле");
        if (activeMain === "dialogues") detailHTML += this.mode === "constructor" ? await this.legacyBlock("dialogues", base) : actionButton("dialogues", "Читать и показывать диалоги игрокам");
        if (activeMain === "sources") detailHTML += `<p>Порождаемые события: ${esc(row.detail)}</p><p class="ms-note">Список отражает подготовленные источники; открытие списка ничего не запускает.</p>` + (this.mode === "constructor" ? actionButton("configureTool", "Открыть настройку источника") : "");
      }
      if (!definitions.length) detailHTML = '<p class="ms-note">Сначала создайте схему во вкладке «Сцена». Настройки инструментов принадлежат её эпизоду.</p>';
    } else if (activeMain === "other") {
      if (this.otherBlock === "manual") detailHTML = `<p class="ms-note">Просматривайте магазины, читайте реплики и показывайте диалоги игрокам. Ручные диалоги доступны и после остановки автоматизации.</p>${actionButton("shops", "Магазины")}${actionButton("dialogues", "Диалоги и действия")}`;
      else {
        detailHTML = await this.legacyBlock(this.otherBlock, base);
      }
    } else detailHTML = renderParameters({ selection: this.selection, draft: this.parameterDraft, catalog, definitions, mode: this.mode });
    return { ...base, mainHTML, detailHTML, nodeActions,
      badgesHTML: renderSchemeBadges(definitions, runtimes),
      mainMenuHTML: renderMenu("main", preferences.hiddenMain, activeMain, this.menuBranch), detailMenuHTML: renderMenu("detail", preferences.hiddenDetail, activeDetail),
      isRight: this.dock.preferences.side === "right", isBottom: this.dock.preferences.side === "bottom",
      presentationIcon: this.layout.presentation === "panel" ? "fa-up-right-from-square" : "fa-table-columns",
      presentationTitle: this.layout.presentation === "panel" ? "Открыть ширму в отдельном окне" : "Вернуть ширму в панель" };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.layout.bind();
    updateSceneNavigationBadges(this.controller);
    const queues = new Map();
    for (const item of this.pendingTabInputs ?? []) { if (!queues.has(item.name)) queues.set(item.name, []); queues.get(item.name).push(item); }
    const detailInputs = this.element.querySelectorAll("[data-detail-content] input[name],[data-detail-content] select[name],[data-detail-content] textarea[name]");
    for (const input of detailInputs) {
      const item = queues.get(input.name)?.shift(); if (!item) continue;
      input.value = item.value; if (["checkbox", "radio"].includes(item.type)) input.checked = item.checked;
    }
    if (detailInputs.length) this.pendingTabInputs = null;
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
    this.element.addEventListener("click", (event) => {
      const row = event.target.closest("[data-select-kind]");
      if (!row || event.target.closest("button,a,input,select,textarea,label,[role=button],[contenteditable]")) return;
      event.preventDefault(); void this.selectNode(row.dataset.selectKind, row.dataset.selectId, row.dataset.schemeId).catch(notify);
    }, listeners);
    this.menuObserver?.disconnect();
    const updateOverflow = () => { for (const strip of this.element.querySelectorAll("[data-menu-strip]")) {
      const overflow = strip.scrollWidth > strip.clientWidth + 1;
      for (const arrow of strip.parentElement.querySelectorAll(".ms-menu-arrow")) { arrow.hidden = !overflow; arrow.disabled = Number(arrow.dataset.direction) < 0 ? strip.scrollLeft <= 1 : strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1; }
    } };
    const Observer = this.element.ownerDocument.defaultView.ResizeObserver;
    if (Observer) { this.menuObserver = new Observer(updateOverflow); for (const strip of this.element.querySelectorAll("[data-menu-strip]")) this.menuObserver.observe(strip); }
    this.element.addEventListener("scroll", updateOverflow, { ...listeners, capture: true }); updateOverflow();
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
    const description = (input, name, original) => { const text = fieldValue(input, name); return text === localizedDescription(original) ? clone(original ?? "") : text; };
    if (["scheme", "episode", "event", "trigger"].includes(this.selection.kind)) draft.description = description(root, "description", draft.description);
    if (["scheme", "episode"].includes(this.selection.kind)) {
      const key = this.selection.kind === "scheme" ? "schemeName" : "name";
      draft[key] = fieldValue(root, key).trim();
      draft.background = fieldValue(root, "background"); draft.textColor = fieldValue(root, "textColor");
      if (this.selection.kind === "scheme") draft.symbol = fieldValue(root, "schemeSymbol");
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
        const previous = draft.parameters[Number(row.dataset.parameterIndex)] ?? {};
        const result = { name: fieldValue(row, "parameterName").trim(), type: fieldValue(row, "parameterType"), required: previous.required, description: description(row, "parameterDescription", previous.description) };
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
    const tool = this.toolRows?.find((entry) => entry.id === id);
    if (tool) { this.controller.selectScheme(tool.schemeId, { render: false }); this.controller.selectEpisode(tool.episodeId, { render: false }); }
    this.selection = { kind, id, schemeId: schemeId || this.controller.getContext().schemeId, episodeId: tool?.episodeId };
    this.layout.preferences.detailTab = "parameters";
    this.layout.preferences.hiddenDetail = this.layout.preferences.hiddenDetail.filter((tab) => tab !== "parameters");
    this.layout.save();
    return this.render({ force: true });
  }

  async setTabVisible(zone, id, visible) {
    if (zone === "main") this.storeTabState(); else this.captureParameterDraft();
    const active = this.layout.preferences.mainTab;
    if (!this.layout.toggleTab(zone, id, visible)) ui.notifications.warn("Оставьте хотя бы одну вкладку в зоне.");
    if (zone === "main" && active !== this.layout.preferences.mainTab) this.restoreTabState(this.layout.preferences.mainTab);
    this.menuBranch = menuParent(this.layout.preferences.mainTab);
    return this.render({ force: true });
  }

  async legacyBlock(id, base) {
    if (!this.controller.getContext().definition && id !== "sceneIO") return '<p class="ms-note">Сначала создайте схему во вкладке «Сцена».</p>';
    if (id === "sceneIO") return `<div>${actionButton("export", "Экспорт сцены")}${actionButton("import", "Импорт сцены")}<input type="file" data-import-file accept=".json,application/json" hidden></div>`;
    const renderTemplate = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    return extractLegacyBlock(await renderTemplate("modules/dmicher-master-screen/templates/editor.hbs", base), id, this.element?.ownerDocument ?? globalThis.document);
  }

  openMenuSettings(zone) {
    this.menuDialog?.close(); this.menuDialog?.remove();
    const doc = this.element.ownerDocument, dialog = doc.createElement("dialog");
    dialog.className = "dmicher-window dmicher-master-screen ms-menu-settings-dialog";
    if (this.element.dataset.dmicherTheme) dialog.dataset.dmicherTheme = this.element.dataset.dmicherTheme;
    dialog.setAttribute("aria-label", zone === "main" ? "Основные вкладки" : "Дополнительные вкладки");
    const draw = () => {
      dialog.innerHTML = `<h3>${zone === "main" ? "Основные вкладки" : "Дополнительные вкладки"}</h3>${renderMenuSettings(zone, this.layout.preferences[zone === "main" ? "hiddenMain" : "hiddenDetail"])}<footer><button type="button" data-close-menu>Готово</button></footer>`;
      for (const input of dialog.querySelectorAll("[data-indeterminate]")) input.indeterminate = true;
    };
    draw(); this.menuDialog = dialog; doc.body.append(dialog);
    dialog.addEventListener("change", (event) => { if (event.target.matches("[data-menu-visible]")) void this.setTabVisible(zone, event.target.dataset.menuVisible, event.target.checked).then(draw).catch(notify); });
    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-close-menu]")) dialog.close(); });
    dialog.addEventListener("close", () => { dialog.remove(); if (this.menuDialog === dialog) this.menuDialog = null; }, { once: true });
    dialog.showModal();
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
    if (this.selection.kind === "scheme") await schemes.updateScheme(this.selection.id, { schemeName: draft.schemeName, symbol: draft.symbol, description: draft.description, background: draft.background, textColor: draft.textColor }, options);
    if (this.selection.kind === "episode") await schemes.updateEpisode(this.selection.schemeId, this.selection.id, { name: draft.name, description: draft.description, background: draft.background, textColor: draft.textColor, events: draft.events, stop: draft.stop }, options);
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
    if (action === "tabSettings") return this.openMenuSettings(button.dataset.zone);
    if (action === "menuCategory") { this.captureParameterDraft(); this.menuBranch = this.menuBranch === button.dataset.id ? null : button.dataset.id; return this.render({ force: true }); }
    if (action === "scrollMenu") { const strip = this.element.querySelector(`[data-menu-strip="${button.dataset.menuId}"]`); strip?.scrollBy({ left: Number(button.dataset.direction) * strip.clientWidth * .75, behavior: "smooth" }); return; }
    if (action === "ideTab") {
      if (button.dataset.zone === "main") return this.switchMainTab(button.dataset.id);
      this.captureParameterDraft();
      this.layout.preferences[`${button.dataset.zone}Tab`] = button.dataset.id; this.layout.save();
      return this.render({ force: true });
    }
    if (action === "configureTool") {
      const row = this.toolRows.find((entry) => entry.id === this.selection.id); if (!row) return;
      if (row.tokenId) return this.controller.openToken(row.tokenId, { schemeId: row.schemeId, episodeId: row.episodeId });
      if (["dialogue", "interaction"].includes(row.type)) { await this.switchMainTab("dialogues"); return this.selectNode("dialogues", `${row.schemeId}:${row.episodeId}`, row.schemeId); }
      if (row.type === "episode") { await this.switchMainTab("scene"); return this.selectNode("episode", row.episodeId, row.schemeId); }
      await this.switchMainTab("other"); this.controller.selectScheme(row.schemeId, { render: false }); this.controller.selectEpisode(row.episodeId, { render: false }); this.otherBlock = "zones"; return this.render({ force: true });
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
    if (action === "addSceneEpisode") { const definition = definitions.find((item) => item.schemeId === this.selection.schemeId) ?? definitions[0]; if (!definition) throw new Error("Сначала создайте схему."); const entry = await schemes.createEpisode(definition.schemeId, { name: nextName(definition.episodes, "Новый эпизод") }); selection = ["episode", entry.id, definition.schemeId]; }
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
    root.innerHTML = `<div><p>${esc(title)}</p><div class="ms-ide-choice-actions">${choices.map((choice) => `<button type="button" data-choice="${esc(choice.value)}">${esc(choice.label)}</button>`).join("")}</div></div>`;
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
    for (const id of ["selection", "event-list", "scheme-list"]) {
      if (!this.element.querySelector(`[data-dmicher-json-id="${id}"]`)) continue;
      const originalScene = this.selectionSceneId, originalSelection = clone(this.selection);
      const assert = () => { const scene = this.assertScene(); if (scene.id !== originalScene || JSON.stringify(this.selection) !== JSON.stringify(originalSelection)) throw new Error("Выбор изменился. Повторите импорт или экспорт."); return scene; };
      const transfer = generics.components.createJSONTransfer({
        filename: () => `master-screen-${originalSelection.kind}-${originalSelection.id}.json`,
        validate: (value) => { const expected = id === "scheme-list" ? "scheme" : id === "event-list" ? "event" : originalSelection.kind; if (!value || value.format !== "dmicher-master-screen" || value.version !== 1 || value.kind !== expected) throw new Error("JSON не соответствует выбранному виду объекта Ширмы."); return value; },
        exportValue: () => {
          const scene = assert();
          if (this.dirty) throw new Error("Сначала сохраните изменения, затем экспортируйте.");
          if (id === "scheme-list") { if (!originalSelection.schemeId) throw new Error("Выберите схему для экспорта."); return new SchemeEditor(scene).exportScheme(originalSelection.schemeId); }
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
