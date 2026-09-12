import { text as t } from "../localization.js";
import { EditorApplication } from "./editor.js";
import { ScreenLayout, MAIN_TABS } from "./screen-layout.js";
import { renderSceneTree, renderSignalTree, renderMacroList, renderParameters, renderOtherList, renderMenu, renderMenuSettings, renderObjectList } from "./ide-view.js";
import { menuParent } from "./navigation-tree.js";
import { renderGroupBadges, updateSceneNavigationBadges } from "./group-badges.js";
import { GroupEditor } from "../group-editor.js";
import { SignalCatalog } from "../signal-catalog.js";
import { getDefinitions, getRuntimes } from "../store.js";
import { randomId, localizedDescription } from "../model.js";
import { generics } from "../generics.js";
import { SceneAssets } from "../scene-assets.js";
import { SceneObjects, listNativeSceneObjects } from "../scene-objects.js";
import { renderAssetForm, readAssetForm, renderOwnedObjects } from "./asset-forms.js";
import { bindIDEMenus } from "./ide-menu.js";
import { readSignalFields, renderSubscriptions, renderSubscriptionFields, readSubscriptionFields, renderMacroValidation, macroKey, macroValidationSummary, bindSignalFields } from "./signal-fields.js";
import { escapeHTML as esc, formValue as fieldValue, actionButton } from "./form-fields.js";

const clone = (value) => structuredClone(value);
const nextName = (entries, base, key = "name") => { const names = new Set(entries.map((entry) => String(entry[key]).toLocaleLowerCase())); let name = base, index = 2; while (names.has(name.toLocaleLowerCase())) name = `${base} ${index++}`; return name; };
const notify = (error) => { console.error("dmicher-master-screen |", error); globalThis.ui?.notifications?.error(error.message); };

/** The IDE owns navigation and draft forms. The existing state editors remain isolated under Other. */
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
    this.selection = { kind: null, id: null, groupId: null };
    this.parameterDraft = null;
    this.parameterRevision = null;
    this.selectionSceneId = null;
    this.tabStates = new Map();
    this.menuBranch = menuParent(this.layout.preferences.mainTab);
    this.foldedGroups = new Set();
    this.foldedSignalBranches = new Set();
    this.otherBlock = "tokens";
    this.componentsDisposers = [];
    this.assetPageIds = new Map();
  }

  _insertElement(element) { super._insertElement(element); this.layout.attach(element); }

  async _onClose(options) {
    this.menuController?.dispose();
    this.menuDialog?.close(); this.menuDialog?.remove(); this.menuObserver?.disconnect();
    this.componentsDisposers.forEach((dispose) => dispose()); this.componentsDisposers = [];
    this.layout.dispose();
    const result = await super._onClose(options);
    this.controller.refreshConstructorFrame?.(); return result;
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
    this.controller.refreshConstructorFrame?.();
    return true;
  }

  refresh() {
    const scene = this.controller.getContext().scene;
    if (this.rendered && this.selectionSceneId !== scene?.id) return this.render({ force: true });
    const badges = this.element?.querySelector(".ms-group-badges");
    if (badges) badges.innerHTML = renderGroupBadges(getDefinitions(scene), getRuntimes(scene));
    return super.refresh();
  }

  onDraftInput(event) {
    if (event.target.matches("[data-tab-visibility]")) return false;
    if (event.target.closest("[data-ide-parameters]")) return true;
    return super.onDraftInput(event);
  }

  captureParameterDraft() {
    const inputs = this.snapshotInputs();
    if (inputs.length) this.pendingTabInputs = inputs;
    try {
      if (this.element?.querySelector("[data-ide-parameters]")) this.parameterDraft = this.readParameterDraft();
      else if (this.element?.querySelector("[data-state-fields]")) this.draft = this.readState();
    } catch (error) { if (!this.dirty) throw error; }
  }

  snapshotInputs() { return [...(this.element?.querySelectorAll("[data-detail-content] input[name],[data-detail-content] select[name],[data-detail-content] textarea[name]") ?? [])].map((input) => ({ name: input.name, type: input.type, value: input.value, checked: input.checked })); }
  stateKey(tab = this.layout.preferences.mainTab, sceneId = this.selectionSceneId) { return `${sceneId}:${this.mode}:${tab}`; }
  storeTabState() {
    if (!this.selectionSceneId) return;
    const context = this.controller.getContext();
    this.tabStates.set(this.stateKey(), { selection: clone(this.selection), parameterDraft: clone(this.parameterDraft), parameterRevision: this.parameterRevision, dirty: this.dirty,
      draft: clone(this.draft), draftRevision: this.draftRevision, stateDirty: this.stateDirty, otherBlock: this.otherBlock, contextKey: this.contextKey,
      inputs: this.dirty ? (this.snapshotInputs().length ? this.snapshotInputs() : this.pendingTabInputs) : null, groupId: context.scene?.id === this.selectionSceneId ? context.groupId : this.selection.groupId,
      stateId: context.scene?.id === this.selectionSceneId ? context.selectedStateId : this.selection.stateId });
  }
  restoreTabState(tab, sceneId = this.selectionSceneId) {
    const saved = this.tabStates.get(this.stateKey(tab, sceneId));
    if (saved?.groupId) {
      const context = this.controller.getContext();
      if (context.definitions?.some((definition) => definition.groupId === saved.groupId)) {
        this.controller.selectGroup(saved.groupId, { render: false });
        if (this.controller.getContext().definition.states.some((state) => state.id === saved.stateId)) this.controller.selectState(saved.stateId, { render: false, resetDraft: false });
      }
    }
    this.selection = clone(saved?.selection ?? { kind: null, id: null, groupId: this.controller.getContext().groupId });
    this.parameterDraft = clone(saved?.parameterDraft ?? null); this.parameterRevision = saved?.parameterRevision ?? null;
    this.draft = clone(saved?.draft ?? null); this.draftRevision = saved?.draftRevision ?? null; this.stateDirty = saved?.stateDirty ?? false;
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
    return foundry.applications.api.DialogV2.confirm({ window: { title: t("Несохранённые изменения вкладок", "Unsaved tab changes") }, content: `<p>${t("Закрыть ширму и отменить несохранённые изменения, включая скрытые вкладки?", "Close the screen and discard unsaved changes, including hidden tabs?")}</p>`, rejectClose: false });
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
    const catalog = current.scene ? new SignalCatalog(current.scene).list() : { emitters: [], signals: [], subscriptions: [], macros: [] };
    const assets = current.scene ? new SceneAssets(current.scene).list() : { shops: [], dialogues: [], revision: 0 };
    const objectState = current.scene ? new SceneObjects(current.scene).list() : { bindings: {}, revision: 0 };
    const bindings = Object.values(objectState.bindings), objects = current.scene ? listNativeSceneObjects(current.scene) : [];
    this.objectsRevision = objectState.revision;
    const definitions = current.scene ? getDefinitions(current.scene) : [];
    const runtimes = current.scene ? getRuntimes(current.scene) : [];
    const selectedDefinition = definitions.find((definition) => definition.groupId === this.selection.groupId);
    let selected;
    if (this.selection.kind === "group") selected = definitions.find((definition) => definition.groupId === this.selection.id);
    if (this.selection.kind === "state") selected = selectedDefinition?.states.find((state) => state.id === this.selection.id);
    if (this.selection.kind === "signal") selected = catalog.signals.find((signal) => signal.id === this.selection.id);
    if (this.selection.kind === "emitter") selected = catalog.emitters.find((emitter) => emitter.key === this.selection.id);
    if (this.selection.kind === "macro") selected = catalog.macros.find((macro) => macroKey(macro) === this.selection.id);
    if (this.selection.kind === "shop") selected = assets.shops.find((shop) => shop.id === this.selection.id);
    if (this.selection.kind === "dialogue") selected = assets.dialogues.find((dialogue) => dialogue.id === this.selection.id);
    if (!this.dirty || !this.parameterDraft) {
      this.parameterDraft = selected ? clone(selected) : null;
      this.parameterRevision = ["group", "state"].includes(this.selection.kind) ? selectedDefinition?.revision : ["shop", "dialogue"].includes(this.selection.kind) ? assets.revision : catalog.revision;
    }
    const activeMain = preferences.mainTab, activeDetail = preferences.detailTab;
    this.toolRows = [];
    let mainHTML = "", detailHTML = "", nodeActions = "";
    if (activeMain === "scene") {
      mainHTML = renderSceneTree(definitions, runtimes, this.selection, this.mode);
      if (!definitions.length) mainHTML = `<p class="ms-note">${t("В этой сцене пока нет групп. Создайте группу — в ней появится первое состояние.", "This scene has no groups yet. Create a group to add its first state.")}</p>`;
      if (this.mode === "constructor") nodeActions = actionButton("addGroup", t("Создать группу", "Create group")) + (definitions.length ? actionButton("addSceneState", t("+ Состояние", "+ State")) + actionButton("editSelected", t("Править", "Edit")) + actionButton("deleteSelected", t("Удалить", "Delete")) : "") + generics.components.renderJSONControls({ id: "group-list", importLabel: t("Импорт группы", "Import group"), exportLabel: t("Экспорт группы", "Export group") });
    }
    if (activeMain === "signals") {
      mainHTML = renderSignalTree(catalog, this.selection, this.mode, definitions);
      if (this.mode === "constructor") nodeActions = actionButton("addSignal", t("+ \u0421\u0438\u0433\u043d\u0430\u043b", "+ Signal")) + actionButton("editSelected", t("\u041f\u0440\u0430\u0432\u0438\u0442\u044c", "Edit")) + actionButton("deleteSelected", t("\u0423\u0434\u0430\u043b\u0438\u0442\u044c", "Delete"));
    }
    if (activeMain === "macros") {
      this.selectedMacroOwner ??= `Scene:${current.scene.id}`;
      const validation = new Map(await Promise.all(catalog.macros.map(async (macro) => [macroKey(macro), await macroValidationSummary(catalog, macro)])));
      mainHTML = renderMacroList(catalog, this.selection, (uuid) => globalThis.game?.macros?.get(uuid.split(".").pop()), this.selectedMacroOwner, validation);
      if (this.mode === "constructor") nodeActions = actionButton("createMacro", t("+ Макрос", "+ Macro")) + actionButton("deleteSelected", t("Убрать из ширмы", "Remove from screen"));
    }
    if (activeMain === "other") mainHTML = renderOtherList(this.mode, this.otherBlock);
    if (["shops", "dialogues"].includes(activeMain)) {
      const kind = activeMain === "shops" ? "shop" : "dialogue";
      const rows = assets[activeMain].map((entry) => ({ ...entry, detail: `${bindings.filter((binding) => binding[`${kind}s`]?.some((link) => link[`${kind}Id`] === entry.id)).length}${t(" об.", " obj.")}` }));
      mainHTML = renderObjectList(rows, this.selection, kind);
      nodeActions = (this.mode === "constructor" ? actionButton(kind === "shop" ? "addShopAsset" : "addDialogueAsset", kind === "shop" ? t("+ Магазин", "+ Shop") : t("+ Диалог", "+ Dialogue")) + actionButton("deleteSelected", t("Удалить", "Delete")) + generics.components.renderJSONControls({ id: `${kind}-list`, importLabel: t("Импорт", "Import"), exportLabel: t("Экспорт", "Export") }) : "")
        + actionButton(activeMain === "shops" ? "shops" : "dialogues", activeMain === "shops" ? t("Состояния магазинов", "Shop sessions") : t("Просмотр и ручной показ", "View and show manually"));
    }

    if (activeDetail === "reference") {
      const page = { scene: "constructor", signals: "signals", macros: "macros", shops: "shops", dialogues: "dialogues", other: "start" }[activeMain];
      detailHTML = `<p class="ms-note">${t("Выберите элемент в основной зоне. Параметры сохраняются отдельно от запуска; ручной переход доступен в Режиссёре.", "Select an entry in the main area. Saving parameters does not start automation; manual transitions are available in Director mode.")}</p>${actionButton("contextHelp", t("Открыть справку", "Open help"), `data-page="${page}"`)}`;
    } else if (["shops", "dialogues"].includes(activeMain)) {
      detailHTML = renderAssetForm({ kind: activeMain === "shops" ? "shop" : "dialogue", draft: this.parameterDraft, pageId: this.assetPageIds.get(`${current.scene?.id}:${this.selection.id}`), mode: this.mode, catalog, bindings, objects, definitions, scene: current.scene });
    } else if (activeMain === "other") {
      if (this.otherBlock === "manual") detailHTML = `<p class="ms-note">${t("Просматривайте магазины, читайте реплики и показывайте диалоги игрокам. Ручные диалоги доступны и после остановки автоматизации.", "View shops, read lines and show dialogues to players. Manual dialogues remain available after automation stops.")}</p>${actionButton("shops", t("Магазины", "Shops"))}${actionButton("dialogues", t("Диалоги и действия", "Dialogues and actions"))}`;
      else {
        detailHTML = await this.stateTool(this.otherBlock, base);
      }
    } else {
      detailHTML = renderParameters({ selection: this.selection, draft: this.parameterDraft, catalog, definitions, runtimes, mode: this.mode });
      if (["signal", "macro"].includes(this.selection.kind) && selected) {
        const rows = catalog.subscriptions.filter((row) => this.selection.kind === "signal" ? row.signalId === selected.id : row.ownerKey === selected.ownerKey && row.macroUuid === selected.uuid);
        detailHTML += renderSubscriptions(rows, catalog);
        if (this.subscriptionDraft) detailHTML += renderSubscriptionFields(this.subscriptionDraft, catalog, this.subscriptionConstraints());
        detailHTML += renderMacroValidation(this.subscriptionValidation);
      }
      if (this.selection.kind === "group" && selected) detailHTML += renderOwnedObjects(selected.groupId, bindings, objects, this.mode !== "constructor");
    }
    return { ...base, mainHTML, detailHTML, nodeActions,
      badgesHTML: renderGroupBadges(definitions, runtimes),
      mainMenuHTML: renderMenu("main", preferences.hiddenMain, activeMain, this.menuBranch), detailMenuHTML: renderMenu("detail", preferences.hiddenDetail, activeDetail),
      isRight: this.dock.preferences.side === "right", isBottom: this.dock.preferences.side === "bottom",
      presentationIcon: this.layout.presentation === "panel" ? "fa-up-right-from-square" : "fa-table-columns",
      presentationTitle: this.layout.presentation === "panel" ? t("Открыть ширму в отдельном окне", "Open screen in a separate window") : t("Вернуть ширму в панель", "Return screen to panel") };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.layout.bind();
    this.controller.refreshConstructorFrame?.();
    updateSceneNavigationBadges(this.controller);
    const queues = new Map();
    for (const item of this.pendingTabInputs ?? []) { if (!queues.has(item.name)) queues.set(item.name, []); queues.get(item.name).push(item); }
    const detailInputs = this.element.querySelectorAll("[data-detail-content] input[name],[data-detail-content] select[name],[data-detail-content] textarea[name]");
    for (const input of detailInputs) {
      const item = queues.get(input.name)?.shift(); if (!item) continue;
      input.value = item.value; if (["checkbox", "radio"].includes(item.type)) input.checked = item.checked;
    }
    if (detailInputs.length) this.pendingTabInputs = null;
    for (const id of this.foldedGroups) this.applyFold(id);
    const signalBranchKey = (node) => `${this.selectionSceneId}:${node.dataset.emitterNode ? `emitter:${node.dataset.emitterNode}` : `category:${node.dataset.signalCategory}`}`;
    for (const node of this.element.querySelectorAll("[data-signal-category],[data-emitter-node]")) {
      node.open = !this.foldedSignalBranches.has(signalBranchKey(node));
      const button = node.querySelector(':scope > summary [data-screen-action="toggleSignalBranch"]');
      if (button) button.textContent = node.open ? "▾" : "▸";
    }
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
    if (this.selection.kind === "signal") this.componentsDisposers.push(bindSignalFields(this.element, {
      getSignal: () => this.parameterDraft,
      onChange: () => { this.captureParameterDraft(); this.dirty = true; },
      onError: notify
    }));
    for (const key of ["background", "textColor"]) {
      const value = this.parameterDraft?.[key], input = this.element.querySelector(`[data-ide-parameters] [name="${key}"]`);
      if (input && value !== undefined && !/^#[0-9a-f]{6}$/i.test(value)) {
        input.value = value;
        input.dispatchEvent(new this.element.ownerDocument.defaultView.Event("input", { bubbles: true }));
      }
    }
    this.bindJSON();
    const listeners = { signal: this.events.signal };
    this.element.addEventListener("toggle", (event) => {
      if (!event.target.matches("[data-signal-category],[data-emitter-node]")) return;
      const key = signalBranchKey(event.target);
      if (event.target.open) this.foldedSignalBranches.delete(key); else this.foldedSignalBranches.add(key);
    }, { ...listeners, capture: true });
    const symbol = this.element.querySelector('[name="groupSymbol"]');
    const constrainSymbol = (event) => {
      if (event?.isComposing) return;
      const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(symbol.value)];
      if (segments.length > 1) symbol.value = segments[0].segment;
    };
    if (symbol) { symbol.addEventListener("input", constrainSymbol, listeners); symbol.addEventListener("compositionend", constrainSymbol, listeners); }
    this.element.querySelector("[data-shop-stock-drop]")?.addEventListener("dragover", (event) => event.preventDefault(), listeners);
    this.element.querySelector("[data-shop-stock-drop]")?.addEventListener("drop", (event) => { event.preventDefault(); void this.dropShopItem(event).catch(notify); }, listeners);
    this.element.addEventListener("click", (event) => {
      const row = event.target.closest("[data-select-kind]");
      if (!row || event.target.closest("button,a,input,select,textarea,label,[role=button],[contenteditable]")) return;
      event.preventDefault(); void this.selectNode(row.dataset.selectKind, row.dataset.selectId, row.dataset.groupId).catch(notify);
    }, listeners);
    this.element.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key) || !event.target.matches("[data-select-kind]")) return;
      event.preventDefault(); const row = event.target;
      void this.selectNode(row.dataset.selectKind, row.dataset.selectId, row.dataset.groupId).catch(notify);
    }, listeners);
    this.menuObserver?.disconnect();
    this.menuController?.dispose(); this.menuController = bindIDEMenus(this.element);
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
      } else if (event.target.matches('[name="macroOwner"]')) {
        this.selectedMacroOwner = event.target.value;
      } else if (event.target.matches('[name="subscription-owner"]')) {
        this.captureSubscription(); void this.render({ force: true });
      } else if (event.target.matches('[name="shopDisplay"]')) {
        try { this.captureParameterDraft(); this.dirty = true; void this.render({ force: true }); } catch (error) { notify(error); }
      }
    }, listeners);
    this.element.addEventListener("dragstart", (event) => {
      const node = event.target.closest("[data-ide-kind][draggable=true], [data-macro-uuid]");
      if (!node) return;
      const payload = node.dataset.macroUuid ? { type: "Macro", uuid: node.dataset.macroUuid } : { type: "DmicherScreenNode", sceneId: this.selectionSceneId, kind: node.dataset.ideKind, id: node.dataset.ideId, groupId: node.dataset.groupId };
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
    if (!root || !draft) return draft;
    if (["shop", "dialogue"].includes(this.selection.kind)) return this.mode === "constructor" ? readAssetForm(root, draft, this.selection.kind) : draft;
    const description = (input, name, original) => { const text = fieldValue(input, name); return text === localizedDescription(original) ? clone(original ?? "") : text; };
    if (["group", "state"].includes(this.selection.kind)) draft.description = description(root, "description", draft.description);
    if (["group", "state"].includes(this.selection.kind)) {
      const key = this.selection.kind === "group" ? "groupName" : "name";
      draft[key] = fieldValue(root, key).trim();
      draft.background = fieldValue(root, "background"); draft.textColor = fieldValue(root, "textColor");
      if (this.selection.kind === "group") draft.symbol = fieldValue(root, "groupSymbol");
      if (this.selection.kind === "group") draft.entryStateId = fieldValue(root, "entryStateId");

    }
    if (this.selection.kind === "signal") return readSignalFields(root, draft);
    return draft;
  }

  assertScene() {
    const scene = this.controller.getContext().scene;
    if (!scene || scene.id !== this.selectionSceneId) throw new Error(t("Сцена изменилась. Дождитесь обновления ширмы или вернитесь к сцене черновика.", "The scene changed. Wait for the screen to refresh or return to the draft's scene."));
    return scene;
  }

  async selectNode(kind, id, groupId) {
    if (!(await this.mayDiscard())) return;
    this.resetDraft(); this.parameterDraft = null;
    this.subscriptionDraft = null; this.subscriptionValidation = null;
    if (["group", "state"].includes(kind)) {
      this.controller.selectGroup(groupId ?? id, { render: false });
      if (kind === "state") this.controller.selectState(id, { render: false });
    }
    const tool = this.toolRows?.find((entry) => entry.id === id);
    if (tool?.groupId) { this.controller.selectGroup(tool.groupId, { render: false }); this.controller.selectState(tool.stateId, { render: false }); }
    this.selection = { kind, id, groupId: groupId || this.controller.getContext().groupId, stateId: tool?.stateId };
    this.layout.preferences.detailTab = "parameters";
    this.layout.preferences.hiddenDetail = this.layout.preferences.hiddenDetail.filter((tab) => tab !== "parameters");
    this.layout.save();
    if (this.mode === "constructor" && ["emitter", "signal", "macro"].includes(kind)) {
      const catalog = new SignalCatalog(this.assertScene()).list();
      const key = kind === "emitter" ? id : kind === "signal" ? catalog.signals.find((signal) => signal.id === id)?.emitterKey : catalog.macros.find((macro) => macroKey(macro) === id)?.ownerKey;
      const emitter = catalog.emitters.find((entry) => entry.key === key);
      if (emitter) await this.controller.focusObject?.({ type: emitter.type ?? key.split(":")[0], id: emitter.id ?? key.slice(key.indexOf(":") + 1) });
    }
    return this.render({ force: true });
  }

  async openAsset(kind, id) {
    if (!["shop", "dialogue"].includes(kind)) throw new Error(t("Неизвестный вид каталога.", "Unknown catalog type."));
    await this.switchMainTab(kind === "shop" ? "shops" : "dialogues");
    return this.selectNode(kind, id);
  }

  async dropShopItem(event) {
    if (this.mode !== "constructor" || this.selection.kind !== "shop") return;
    let data; try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { throw new Error(t("Перетащите предмет Foundry.", "Drop a Foundry item.")); }
    const original = { scene: this.selectionSceneId, id: this.selection.id };
    const item = data.type === "Item" && typeof data.uuid === "string" ? await fromUuid(data.uuid) : null;
    if (item?.documentName !== "Item" || typeof item.toObject !== "function") throw new Error(t("Перетащите доступный предмет Foundry.", "Drop an accessible Foundry item."));
    if (original.scene !== this.selectionSceneId || original.id !== this.selection.id) throw new Error(t("Выбор изменился. Повторите перенос предмета.", "The selection changed. Drop the item again."));
    const source = item.toObject(); delete source._id;
    return this.mutateParameters((draft) => draft.items.push({ id: randomId(), data: source, stock: 1 }));
  }

  async assignObject(descriptor, remove = false) {
    const scene = this.assertScene(), service = new SceneObjects(scene), existing = service.get(descriptor);
    if (this.mode !== "constructor" || this.selection.kind !== "group") throw new Error(t("Выберите группу в Конструкторе.", "Select a group in Constructor mode."));
    let allowReassign = false;
    if (remove && await this.inlineChoice(t("Отвязать объект от группы? Его назначения магазинов, диалогов и поведения этой группы будут сняты.", "Unassign the object from the group? Its shop, dialogue and behavior assignments for this group will be removed."), [{ value: "yes", label: t("Отвязать", "Unassign") }, { value: "cancel", label: t("Отмена", "Cancel") }]) !== "yes") return;
    if (!remove && existing?.groupId && existing.groupId !== this.selection.id) {
      allowReassign = await this.inlineChoice(t("Объект уже принадлежит другой группе. Переназначить его выбранной группе?", "This object belongs to another group. Assign it to the selected group?"), [{ value: "yes", label: t("Переназначить", "Reassign") }, { value: "cancel", label: t("Отмена", "Cancel") }]) === "yes";
      if (!allowReassign) return;
    }
    this.captureParameterDraft();
    await service.save(descriptor, { groupId: remove ? null : this.selection.id }, { expectedRevision: this.objectsRevision, allowReassign: remove || allowReassign });
    this.controller.changed(scene); return this.render({ force: true });
  }

  async setTabVisible(zone, id, visible) {
    if (zone === "main") this.storeTabState(); else this.captureParameterDraft();
    const active = this.layout.preferences.mainTab;
    if (!this.layout.toggleTab(zone, id, visible)) ui.notifications.warn(t("Оставьте хотя бы одну вкладку в зоне.", "Keep at least one tab in the area."));
    if (zone === "main" && active !== this.layout.preferences.mainTab) this.restoreTabState(this.layout.preferences.mainTab);
    this.menuBranch = menuParent(this.layout.preferences.mainTab);
    return this.render({ force: true });
  }

  async stateTool(id, base) {
    if (!this.controller.getContext().definition && id !== "sceneIO") return `<p class="ms-note">${t("Сначала создайте группу во вкладке «Сцена».", "Create a group in the Scene tab first.")}</p>`;
    if (id === "sceneIO") return `<div>${actionButton("export", t("Экспорт сцены", "Export scene"))}${actionButton("import", t("Импорт сцены", "Import scene"))}<input type="file" data-import-file accept=".json,application/json" hidden></div>`;
    const renderTemplate = foundry.applications.handlebars?.renderTemplate ?? globalThis.renderTemplate;
    return renderTemplate("modules/dmicher-master-screen/templates/state-tools.hbs", { ...base, blocks: { [id]: true } });
  }

  openMenuSettings(zone) {
    this.menuDialog?.close(); this.menuDialog?.remove();
    const doc = this.element.ownerDocument, dialog = doc.createElement("dialog");
    dialog.className = "dmicher-window dmicher-master-screen ms-menu-settings-dialog";
    if (this.element.dataset.dmicherTheme) dialog.dataset.dmicherTheme = this.element.dataset.dmicherTheme;
    dialog.setAttribute("aria-label", zone === "main" ? t("Основные вкладки", "Main tabs") : t("Дополнительные вкладки", "Secondary tabs"));
    const draw = () => {
      dialog.innerHTML = `<h3>${zone === "main" ? t("Основные вкладки", "Main tabs") : t("Дополнительные вкладки", "Secondary tabs")}</h3>${renderMenuSettings(zone, this.layout.preferences[zone === "main" ? "hiddenMain" : "hiddenDetail"])}<footer><button type="button" data-close-menu>${t("Готово", "Done")}</button></footer>`;
      for (const input of dialog.querySelectorAll("[data-indeterminate]")) input.indeterminate = true;
    };
    draw(); this.menuDialog = dialog; doc.body.append(dialog);
    dialog.addEventListener("change", (event) => { if (event.target.matches("[data-menu-visible]")) void this.setTabVisible(zone, event.target.dataset.menuVisible, event.target.checked).then(draw).catch(notify); });
    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-close-menu]")) dialog.close(); });
    dialog.addEventListener("close", () => { dialog.remove(); if (this.menuDialog === dialog) this.menuDialog = null; }, { once: true });
    dialog.showModal();
  }

  applyFold(id) {
    const folded = this.foldedGroups.has(id);
    for (const row of this.element.querySelectorAll('[data-ide-kind="state"]')) if (row.dataset.groupId === id) row.hidden = folded;
    for (const button of this.element.querySelectorAll('[data-screen-action="foldGroup"]')) if (button.dataset.groupId === id) { button.textContent = folded ? "▸" : "▾"; button.setAttribute("aria-expanded", String(!folded)); }
  }

  async mutateParameters(change) {
    this.parameterDraft = this.readParameterDraft();
    if (this.parameterDraft?.builtin && this.selection.kind !== "signal") throw new Error(t("Встроенное определение нельзя изменять.", "Built-in definitions cannot be edited."));
    await change(this.parameterDraft); this.dirty = true; return this.render({ force: true });
  }

  async saveParameters() {
    const scene = this.assertScene(), draft = this.readParameterDraft();
    if (!draft || draft.builtin && this.selection.kind !== "signal") throw new Error(t("Выберите изменяемый элемент.", "Select an editable entry."));
    const groups = new GroupEditor(scene), catalog = new SignalCatalog(scene);
    const options = { expectedRevision: this.parameterRevision };
    if (["group", "state"].includes(this.selection.kind)) {
      try { draft.background = generics.components.normalizeHexColor(draft.background); draft.textColor = generics.components.normalizeHexColor(draft.textColor); }
      catch { throw new Error(t("Цвет фона и текста указывается в формате #RRGGBB.", "Background and text colors must use #RRGGBB format.")); }
    }
    if (this.selection.kind === "group") await groups.updateGroup(this.selection.id, { groupName: draft.groupName, symbol: draft.symbol, entryStateId: draft.entryStateId, description: draft.description, background: draft.background, textColor: draft.textColor }, options);
    if (this.selection.kind === "state") await groups.updateState(this.selection.groupId, this.selection.id, { name: draft.name, description: draft.description, background: draft.background, textColor: draft.textColor }, options);
    if (this.selection.kind === "signal") await catalog.saveSignal(draft, options);
    if (this.selection.kind === "shop") await new SceneAssets(scene).saveShop(draft, options);
    if (this.selection.kind === "dialogue") await new SceneAssets(scene).saveDialogue(draft, options);
    this.resetDraft(); this.parameterDraft = null; this.controller.changed(scene);
    return this.render({ force: true });
  }

  async handleAction(action, button, event) {
    if (action === "previewAsset") {
      this.parameterDraft = this.readParameterDraft();
      return this.controller.previewAsset(this.selection.kind, this.selection.id, { draft: clone(this.parameterDraft), pageId: this.assetPageIds.get(`${this.selectionSceneId}:${this.selection.id}`) });
    }
    if (action === "assetFilePicker") {
      const sceneId = this.selectionSceneId, assetId = this.selection.id, pageId = this.element.querySelector("[data-asset-page]")?.dataset.assetPage, name = button.dataset.field;
      const Picker = foundry.applications.apps.FilePicker.implementation;
      return new Picker({ type: "image", current: fieldValue(this.element, name), callback: (path) => {
        if (this.selectionSceneId !== sceneId || this.selection.id !== assetId || (pageId && this.element.querySelector("[data-asset-page]")?.dataset.assetPage !== pageId)) { ui.notifications.warn(t("Выбор изменился. Откройте выбор изображения ещё раз.", "The selection changed. Open the image picker again.")); return; }
        const field = this.element.querySelector(`[name="${name}"]`); if (!field) return;
        field.value = path; field.dispatchEvent(new field.ownerDocument.defaultView.Event("input", { bubbles: true }));
      } }).render({ force: true });
    }
    if (action === "objectInfo") return this.controller.openObjectInfo({ type: button.dataset.objectType, id: button.dataset.objectId });
    if (action === "assignObject") {
      const [type, id] = fieldValue(this.element, "newOwnedObject").split(":");
      if (!type || !id) throw new Error(t("Выберите объект сцены.", "Select a scene object."));
      return this.assignObject({ type, id });
    }
    if (action === "unassignObject") return this.assignObject({ type: button.dataset.objectType, id: button.dataset.objectId }, true);
    if (action === "previewAssetDialogue") return this.controller.previewDialogueAsset(this.selection.id, this.assetPageIds.get(`${this.selectionSceneId}:${this.selection.id}`));
    if (action === "selectAssetPage") {
      this.parameterDraft = this.readParameterDraft(); this.pendingTabInputs = null;
      this.assetPageIds.set(`${this.selectionSceneId}:${this.selection.id}`, button.dataset.id); return this.render({ force: true });
    }
    if (action === "removeShopItem") return this.mutateParameters((draft) => { draft.items = draft.items.filter((item) => item.id !== button.dataset.id); });
    if (["addAssetPage", "deleteAssetPage", "addAssetResponse", "removeAssetResponse"].includes(action)) {
      return this.mutateParameters((draft) => {
        const key = `${this.selectionSceneId}:${draft.id}`, page = draft.pages.find((entry) => entry.id === this.assetPageIds.get(key)) ?? draft.pages[0];
        if (action === "addAssetPage") { const entry = { id: randomId(), name: nextName(draft.pages, t("Новый блок", "New page")), text: "", art: "", responses: [] }; draft.pages.push(entry); this.assetPageIds.set(key, entry.id); }
        if (action === "deleteAssetPage") {
          if (draft.pages.length === 1) throw new Error(t("В диалоге должен остаться хотя бы один блок.", "A dialogue must retain at least one page."));
          draft.pages = draft.pages.filter((entry) => entry.id !== page.id);
          for (const entry of draft.pages) for (const response of entry.responses) if (response.nextPageId === page.id) response.nextPageId = "";
          if (draft.startPageId === page.id) draft.startPageId = draft.pages[0].id;
          this.assetPageIds.set(key, draft.pages[0].id);
        }
        if (action === "addAssetResponse") page.responses.push({ id: randomId(), label: t("Новый ответ", "New response"), nextPageId: "", signalId: "", parameters: {} });
        if (action === "removeAssetResponse") page.responses.splice(Number(button.dataset.index), 1);
      });
    }
    if (action === "togglePresentation") {
      const next = this.layout.presentation === "panel" ? "window" : "panel";
      if (next === "window") this.reservePopup();
      return this.setPresentation(next);
    }
    if (action === "ideSide") { this.captureParameterDraft(); this.layout.setSide(button.dataset.side); return this.render({ force: true }); }
    if (action === "tabSettings") return this.openMenuSettings(button.dataset.zone);
    if (action === "menuCategory") return this.menuController.open(button);
    if (action === "scrollMenu") { const strip = this.element.querySelector(`[data-menu-strip="${button.dataset.menuId}"]`); strip?.scrollBy({ left: Number(button.dataset.direction) * strip.clientWidth * .75, behavior: "smooth" }); return; }
    if (action === "ideTab") {
      this.menuController.close();
      if (button.dataset.zone === "main") return this.switchMainTab(button.dataset.id);
      this.captureParameterDraft();
      this.layout.preferences[`${button.dataset.zone}Tab`] = button.dataset.id; this.layout.save();
      return this.render({ force: true });
    }
    if (action === "configureTool") {
      const row = this.toolRows.find((entry) => entry.id === this.selection.id); if (!row) return;
      if (row.objectTarget) return this.controller.openObjectBehavior(row.objectTarget);
      if (row.type === "dialogue") return this.openAsset("dialogue", row.assetId);
      if (row.type === "interaction") { await this.switchMainTab("other"); this.controller.selectGroup(row.groupId, { render: false }); this.controller.selectState(row.stateId, { render: false }); this.otherBlock = "dialogues"; return this.render({ force: true }); }
      if (row.type === "state") { await this.switchMainTab("scene"); return this.selectNode("state", row.stateId, row.groupId); }
      await this.switchMainTab("other"); this.controller.selectGroup(row.groupId, { render: false }); this.controller.selectState(row.stateId, { render: false }); this.otherBlock = "zones"; return this.render({ force: true });
    }
    if (action === "selectNode") return this.selectNode(button.dataset.kind, button.dataset.id, button.dataset.groupId);
    if (action === "selectOther") {
      if (!(await this.mayDiscard())) return;
      this.resetDraft(); this.parameterDraft = null; this.otherBlock = button.dataset.id;
      return this.render({ force: true });
    }
    if (action === "foldGroup") { const id = button.dataset.groupId; if (this.foldedGroups.has(id)) this.foldedGroups.delete(id); else this.foldedGroups.add(id); this.applyFold(id); return; }
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
    if (await this.signalAction(action, button)) return;
    if (action === "enterNode") return this.controller.transition(button.dataset.id, { groupId: button.dataset.groupId });
    if (action === "enterSelectedState") return this.controller.transition(this.selection.id, { groupId: this.selection.groupId });
    if (action === "haltSelectedGroup") return this.controller.haltGroup(this.selection.groupId);
    if (action === "resumeSelectedGroup") return this.controller.resumeGroup(fieldValue(this.element, "resumeState"), this.selection.groupId);
    if (action === "editMacro") {
      const macro = await fromUuid(button.dataset.uuid ?? this.selection.id);
      if (!macro || macro.documentName !== "Macro") throw new Error(t("Макрос недоступен. Проверьте каталог Foundry.", "The macro is unavailable. Check the Foundry directory."));
      return macro.sheet.render(true);
    }
    if (action === "addSignal") this.pendingSignalEmitter = button.dataset.emitterKey;
    if (["addGroup", "addSceneState", "addSignal", "createMacro", "addShopAsset", "addDialogueAsset", "deleteSelected"].includes(action)) return this.changeStructure(action);
    return super.handleAction(action, button, event);
  }

  async changeStructure(action) {
    if (this.mode !== "constructor") throw new Error(t("Изменение структуры доступно в Конструкторе.", "Structure can be edited in Constructor mode."));
    if (!(await this.mayDiscard())) return;
    const scene = this.assertScene(), groups = new GroupEditor(scene), catalog = new SignalCatalog(scene), definitions = groups.list(), data = catalog.list();
    let selection;
    if (action === "addShopAsset") { const assets = new SceneAssets(scene), entry = await assets.saveShop({ name: nextName(assets.list().shops, t("Новый магазин", "New shop")), items: [], display: "list", requireGMApproval: true, img: "" }); selection = ["shop", entry.id]; }
    if (action === "addDialogueAsset") { const assets = new SceneAssets(scene), id = randomId(), entry = await assets.saveDialogue({ name: nextName(assets.list().dialogues, t("Новый диалог", "New dialogue")), startPageId: id, pages: [{ id, name: t("Начало", "Start"), text: "", art: "", responses: [] }] }); selection = ["dialogue", entry.id]; }
    if (action === "addGroup") { const entry = await groups.createGroup({ name: nextName(definitions, t("Новая группа", "New group"), "groupName") }); selection = ["group", entry.groupId, entry.groupId]; }
    if (action === "addSceneState") { const definition = definitions.find((item) => item.groupId === this.selection.groupId) ?? definitions[0]; if (!definition) throw new Error(t("Сначала создайте группу.", "Create a group first.")); const entry = await groups.createState(definition.groupId, { name: nextName(definition.states, t("Новое состояние", "New state")) }); selection = ["state", entry.id, definition.groupId]; }
    if (action === "addSignal") {
      const emitterKey = this.pendingSignalEmitter ?? (this.selection.kind === "emitter" ? this.selection.id : this.parameterDraft?.emitterKey);
      this.pendingSignalEmitter = null;
      if (!emitterKey) throw new Error(t("Выберите эмитента или нажмите + в его строке.", "Select an emitter or press + in its row."));
      const entry = await catalog.saveSignal({ emitterKey, name: nextName(data.signals.filter((row) => row.emitterKey === emitterKey), t("Новый сигнал", "New signal")), description: "", parameters: [], returns: [] });
      selection = ["signal", entry.id];
    }
    if (action === "createMacro") {
      const Macro = foundry.documents.Macro?.implementation ?? globalThis.Macro;
      const macro = await Macro.create({ name: t("Новый макрос ширмы", "New screen macro"), type: "script", scope: "global", command: "" }, { renderSheet: true });
      if (!macro) return;
      const ownerKey = this.selectedMacroOwner ?? `Scene:${scene.id}`; await catalog.attachMacro(ownerKey, macro.uuid); selection = ["macro", macroKey({ownerKey,uuid:macro.uuid})];
    }
    if (action === "deleteSelected") {
      if (this.parameterDraft?.builtin) throw new Error(t("Встроенные определения нельзя удалять.", "Built-in definitions cannot be deleted."));
      const confirmed = await this.inlineChoice(t("Удалить выбранный элемент?", "Delete the selected entry?"), [{ value: "delete", label: t("Удалить", "Delete") }, { value: "cancel", label: t("Отмена", "Cancel") }]);
      if (confirmed !== "delete") return;
      if (this.selection.kind === "group") await groups.deleteGroup(this.selection.id);
      else if (this.selection.kind === "state") await groups.deleteState(this.selection.groupId, this.selection.id);
      else if (this.selection.kind === "signal") await catalog.removeSignal(this.selection.id);
      else if (this.selection.kind === "macro") await catalog.removeMacro(this.parameterDraft.ownerKey,this.parameterDraft.uuid);
      else if (this.selection.kind === "shop") await new SceneAssets(scene).deleteShop(this.selection.id);
      else if (this.selection.kind === "dialogue") await new SceneAssets(scene).deleteDialogue(this.selection.id);
      else throw new Error(t("Выберите удаляемый элемент.", "Select an entry to delete."));
    }
    this.resetDraft(); this.parameterDraft = null;
    if (selection) await this.selectNode(...selection); else await this.render({ force: true });
    this.controller.changed(scene);
  }

  subscriptionConstraints() {
    return this.selection.kind === "signal" ? { fixedSignal: this.selection.id } : { fixedOwner: this.parameterDraft?.ownerKey };
  }
  captureSubscription() {
    if (this.subscriptionDraft && this.element.querySelector("[data-subscription-fields]")) this.subscriptionDraft = readSubscriptionFields(this.element, this.subscriptionDraft, new SignalCatalog(this.assertScene()).list(), this.subscriptionConstraints());
  }
  async signalAction(action, button) {
    if (action === "toggleSignalBranch") {
      const node = button.closest("[data-emitter-node]");
      if (node) { node.open = !node.open; button.textContent = node.open ? "▾" : "▸"; }
      return true;
    }
    const actions = ["addSignalField", "removeSignalField", "removeTreeSignal", "newSignalSubscription", "editSignalSubscription", "deleteSignalSubscription", "saveSignalSubscription"];
    if (!actions.includes(action)) return false;
    if (this.mode !== "constructor") throw new Error(t("Изменения доступны в Конструкторе.", "Editing is available in Constructor."));
    this.captureParameterDraft(); this.captureSubscription(); const catalog = new SignalCatalog(this.assertScene());
    if (action === "addSignalField") { this.parameterDraft[button.dataset.direction].push({ name: `field${this.parameterDraft[button.dataset.direction].length + 1}`, type: "string", nullable: false }); this.dirty = true; }
    if (action === "removeSignalField") { const fields = this.parameterDraft[button.dataset.direction], index = Number(button.dataset.index); if (!fields[index]?.builtin) fields.splice(index, 1); this.dirty = true; }
    if (action === "removeTreeSignal") { await catalog.removeSignal(button.dataset.id); if (this.selection.id === button.dataset.id) { this.parameterDraft = null; this.selection = { kind: null, id: null, groupId: this.selection.groupId }; this.dirty = false; } }
    if (action === "newSignalSubscription") { this.subscriptionDraft = { ownerKey: this.parameterDraft?.ownerKey ?? catalog.list().emitters[0]?.key, emitterKey: this.parameterDraft?.emitterKey, signalId: this.selection.kind === "signal" ? this.selection.id : "", macroUuid: this.parameterDraft?.uuid ?? "", enabled: true }; this.subscriptionValidation = null; }
    if (action === "editSignalSubscription") { this.subscriptionDraft = clone(catalog.list().subscriptions.find((row) => row.id === button.dataset.id)); this.subscriptionValidation = null; }
    if (action === "deleteSignalSubscription") { await catalog.removeSubscription(button.dataset.id); this.subscriptionDraft = null; }
    if (action === "saveSignalSubscription") {
      try { this.subscriptionDraft = await catalog.saveSubscription(this.subscriptionDraft); this.subscriptionValidation = { valid: true }; this.parameterRevision = catalog.list().revision; }
      catch (error) { this.subscriptionValidation = { valid: false, error: error.message, snippet: error.snippet }; notify(error); }
    }
    await this.render({ force: true }); return true;
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
    const scene = this.assertScene(), catalog = new SignalCatalog(scene), groups = new GroupEditor(scene);
    if (data.type === "Macro" || data.uuid?.startsWith("Macro.")) {
      const macro = await fromUuid(data.uuid);
      if (macro?.documentName !== "Macro") throw new Error(t("Перетащите макрос Foundry.", "Drop a Foundry macro."));
      if (!(await this.mayDiscard())) return;
      const ownerKey = this.selectedMacroOwner ?? `Scene:${scene.id}`;
      await catalog.attachMacro(ownerKey,macro.uuid);
      this.resetDraft(); return this.selectNode("macro",macroKey({ownerKey,uuid:macro.uuid}));
    }
    if (data.type !== "DmicherScreenNode" || data.sceneId !== scene.id || !(await this.mayDiscard())) return;
    if (data.kind === "group" && target.dataset.ideKind === "group") {
      const ids = groups.list().map((entry) => entry.groupId), from = ids.indexOf(data.id), to = ids.indexOf(target.dataset.ideId);
      if (from >= 0 && to >= 0) { ids.splice(to, 0, ids.splice(from, 1)[0]); await groups.reorderGroups(ids); }
    } else if (data.kind === "state") {
      const destination = target.dataset.groupId;
      if (data.groupId === destination) {
        const ids = groups.get(destination).states.map((entry) => entry.id), from = ids.indexOf(data.id), to = target.dataset.ideKind === "state" ? ids.indexOf(target.dataset.ideId) : ids.length - 1;
        if (from >= 0 && to >= 0) { ids.splice(to, 0, ids.splice(from, 1)[0]); await groups.reorderStates(destination, ids); }
      } else {
        const result = await this.inlineChoice(t("Состояние в другой группе: скопировать или переместить?", "State from another group: copy or move?"), [{ value: "copy", label: t("Скопировать", "Copy") }, { value: "move", label: t("Переместить", "Move") }, { value: "cancel", label: t("Отмена", "Cancel") }]);
        if (result === "cancel") return;
        const entry = await groups.transferState(data.groupId, destination, data.id, { copy: result === "copy" });
        this.resetDraft(); await this.selectNode("state", entry.id, destination);
      }
    }
    this.resetDraft(); this.parameterDraft = null; this.controller.changed(scene); return this.render({ force: true });
  }

  bindJSON() {
    for (const id of ["selection", "group-list", "asset-selection", "shop-list", "dialogue-list"]) {
      if (!this.element.querySelector(`[data-dmicher-json-id="${id}"]`)) continue;
      const originalScene = this.selectionSceneId, originalSelection = clone(this.selection);
      const assert = () => { const scene = this.assertScene(); if (scene.id !== originalScene || JSON.stringify(this.selection) !== JSON.stringify(originalSelection)) throw new Error(t("Выбор изменился. Повторите импорт или экспорт.", "The selection changed. Repeat the import or export.")); return scene; };
      const transfer = generics.components.createJSONTransfer({
        filename: () => `master-screen-${originalSelection.kind}-${originalSelection.id}.json`,
        validate: (value) => { const expected = id.endsWith("-list") ? id.slice(0, -5) : originalSelection.kind; if (!value || value.format !== "dmicher-master-screen" || value.version !== 1 || value.kind !== expected) throw new Error(t("JSON не соответствует выбранному виду объекта Ширмы.", "The JSON does not match the selected screen object type.")); return value; },
        exportValue: () => {
          const scene = assert();
          if (this.dirty) throw new Error(t("Сначала сохраните изменения, затем экспортируйте.", "Save your changes before exporting."));
          if (id === "group-list") { if (!originalSelection.groupId) throw new Error(t("Выберите группу для экспорта.", "Select a group to export.")); return new GroupEditor(scene).exportGroup(originalSelection.groupId); }
          if (originalSelection.kind === "group") return new GroupEditor(scene).exportGroup(originalSelection.id);
          if (originalSelection.kind === "state") return new GroupEditor(scene).exportState(originalSelection.groupId, originalSelection.id);
          if (originalSelection.kind === "shop") return new SceneAssets(scene).exportShop(originalSelection.id);
          if (originalSelection.kind === "dialogue") return new SceneAssets(scene).exportDialogue(originalSelection.id);
        throw new Error(t("Выберите группу или состояние для экспорта.", "Select a group or state to export."));
        },
        importValue: async (value) => {
          const scene = assert();
          if (!(await this.mayDiscard())) return;
          let selection;
          if (value.kind === "group") { const entry = await new GroupEditor(scene).importGroup(value); selection = ["group", entry.groupId, entry.groupId]; }
          if (value.kind === "state") { const entry = await new GroupEditor(scene).importState(originalSelection.groupId, value); selection = ["state", entry.id, originalSelection.groupId]; }
          if (value.kind === "shop") { const entry = await new SceneAssets(scene).importShop(value); selection = ["shop", entry.id]; }
          if (value.kind === "dialogue") { const entry = await new SceneAssets(scene).importDialogue(value); selection = ["dialogue", entry.id]; }
          this.resetDraft(); this.parameterDraft = null; this.controller.changed(scene);
          if (selection) await this.selectNode(...selection);
        }, onError: notify
      });
      this.componentsDisposers.push(transfer.bind(this.element, id));
    }
  }
}
