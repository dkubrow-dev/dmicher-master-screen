import { themedClasses } from "../ui.js";
import { defaultTokenBehavior, parseTransitions, transitionsText, randomId, canTransition } from "../model.js";
import { buildGraphView, splitLines, parsePointRows, formatPointRows, requireNumber, buildTriggerRows } from "./editor-view.js";
import { buildTriggerFields, readTriggerFields, splitTags } from "./trigger-fields.js";
import { ConstructorDock } from "./constructor-dock.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const MODULE_ID = "dmicher-master-screen";
const clone = (value) => foundry.utils.deepClone(value);
const field = (root, name) => root?.querySelector(`[name="${name}"]`);
const value = (root, name, fallback = "") => field(root, name)?.value ?? fallback;
const checked = (root, name) => field(root, name)?.checked === true;
const number = (root, name, label, options) => requireNumber(value(root, name), label, options);
const editorContextKey = (context, id) => `${context.scene?.id}:${context.definition?.schemeId && context.definition.schemeId !== "main" ? `${context.definition.schemeId}:` : ""}${id}`;
const errorMessage = (error) => {
  console.error(`${MODULE_ID} |`, error);
  ui.notifications.error(error?.message ?? "Не удалось выполнить действие ширмы.");
};

/** Local editor lifecycle: no gameplay work runs while drawing a window. */
export class ScreenFormApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  dirty = false;
  events = null;

  refresh() {
    if (this.rendered && !this.dirty) return this.render({ force: true });
  }

  resetDraft() { this.dirty = false; this.draft = null; }

  bindEvents() {
    this.events?.abort();
    const Controller = this.element.ownerDocument.defaultView.AbortController;
    this.events = new Controller();
    const options = { signal: this.events.signal };
    this.element.addEventListener("input", (event) => {
      if (this.onDraftInput?.(event) === false) return;
      this.dirty = true;
      const status = this.element.querySelector("[data-save-status]");
      if (status) status.textContent = "Есть несохранённые изменения";
    }, options);
    this.element.addEventListener("keydown", (event) => {
      const graphNode = event.target.closest("g[data-screen-action]");
      if (!graphNode || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      void Promise.resolve(this.handleAction(graphNode.dataset.screenAction, graphNode, event)).catch(errorMessage);
    }, options);
    this.element.addEventListener("click", (event) => {
      const button = event.target.closest("[data-screen-action]");
      if (!button || button.disabled) return;
      event.preventDefault();
      button.disabled = true;
      void Promise.resolve(this.handleAction(button.dataset.screenAction, button, event)).catch(errorMessage)
        .finally(() => { if (button.isConnected) button.disabled = false; });
    }, options);
    this.element.addEventListener("submit", (event) => {
      event.preventDefault();
      const action = event.target.dataset.screenForm;
      if (action) void Promise.resolve(this.handleAction(action, event.submitter, event)).catch(errorMessage);
    }, options);
    return options;
  }

  async _onClose(options) {
    this.events?.abort();
    this.events = null;
    return super._onClose(options);
  }

  async mayDiscard() {
    if (!this.dirty) return true;
    return DialogV2.confirm({
      window: { title: "Несохранённые изменения" },
      content: "<p>Продолжить и отменить несохранённые изменения в этом окне?</p>",
      rejectClose: false
    });
  }
}

export class EditorApplication extends ScreenFormApplication {
  static DEFAULT_OPTIONS = {
    id: "dmicher-master-screen-editor",
    classes: themedClasses("dmicher-screen-editor"),
    position: { width: 920, height: 760 },
    window: { title: "Ширма мастера", icon: "fa-solid fa-chalkboard", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/editor.hbs`, scrollable: [".ms-body"] } };

  constructor(controller, { mode = "constructor", ...options } = {}) {
    super(mode === "constructor" ? { ...options,
      window: { ...options.window, frame: false, positioned: false, resizable: false } } : options);
    this.controller = controller;
    this.mode = mode;
    this.dock = mode === "constructor" ? new ConstructorDock() : null;
    this.draft = null;
    this.contextKey = "";
    this.episodeDirty = false;
    this.drafts = new Map();
    this.pendingInputs = null;
    this.draftRevision = null;
    this.tagDrafts = new Map();
  }

  get title() { return `▥ ${this.mode === "director" ? "Режиссёр" : "Конструктор"} · Ширма мастера`; }

  _insertElement(element) {
    super._insertElement(element);
    this.dock?.attach(element);
  }

  setDockVisible(visible) {
    if (!this.dock || !this.element) return;
    this.element.hidden = !visible;
    if (visible) { this.dock.attach(this.element); this.dock.bindControls(); }
    else this.dock.detach();
  }

  async _onClose(options) {
    this.dock?.detach();
    return super._onClose(options);
  }

  onDraftInput(event) {
    if (event.target.name === "objectTags") {
      const row = event.target.closest("[data-object-tags]");
      if (row) {
        this.tagDrafts.set(`${row.dataset.sceneId}:${row.dataset.objectType}:${row.dataset.objectId}`, event.target.value);
        const status = row.querySelector("[data-tag-status]");
        if (status) status.textContent = "Не сохранено";
      }
      return false;
    }
    if (event.target.closest("[data-episode-fields]")) { this.episodeDirty = true; return true; }
    return event.target.name === "graphText";
  }

  resetDraft() {
    super.resetDraft();
    this.episodeDirty = false;
    this.pendingInputs = null;
    this.draftRevision = null;
    this.drafts?.delete(this.contextKey);
  }

  refresh() {
    const context = this.controller.getContext();
    const episodeId = context.episode?.id ?? context.definition?.episodes?.[0]?.id;
    if (this.rendered && this.contextKey !== editorContextKey(context, episodeId)) return this.render({ force: true });
    return super.refresh();
  }

  selectDraftContext(key) {
    if (this.contextKey === key) return;
    if (this.contextKey && this.dirty) {
      const inputs = [...(this.element?.querySelectorAll?.("input[name], select[name], textarea[name]") ?? [])]
        .map((input) => ({ name: input.name, type: input.type, value: input.value, checked: input.checked }));
      this.drafts.set(this.contextKey, { draft: clone(this.draft), revision: this.draftRevision, dirty: true, episodeDirty: this.episodeDirty, inputs });
    }
    const saved = this.drafts.get(key);
    this.contextKey = key;
    this.draft = saved ? clone(saved.draft) : null;
    this.dirty = Boolean(saved?.dirty);
    this.episodeDirty = Boolean(saved?.episodeDirty);
    this.pendingInputs = saved?.inputs ?? null;
    this.draftRevision = saved?.revision ?? null;
  }

  async _prepareContext(options) {
    const parent = await super._prepareContext(options);
    const context = this.controller.getContext();
    if (!context.scene || !context.isGM) {
      this.selectDraftContext("unavailable");
      return { ...parent, missing: true, isGM: context.isGM, isConstructor: this.mode === "constructor" };
    }
    if (!context.definition) return { ...parent, missingScheme: true, sceneName: context.scene.name, isGM: true, isConstructor: this.mode === "constructor", isDirector: this.mode === "director" };
    const episode = context.episode ?? context.definition.episodes[0];
    const key = editorContextKey(context, episode?.id);
    this.selectDraftContext(key);
    if ((!this.draft || !this.dirty) && episode) {
      this.draft = clone(episode);
      this.draftRevision = context.definition.revision;
    }
    const draft = this.draft;
    const graph = buildGraphView(context.definition.episodes, draft?.id, { columns: this.mode === "constructor" ? 2 : 3 });
    const active = context.definition.episodes.find((entry) => entry.id === context.runtime.episodeId);
    const incoming = (draft?.from ?? []);
    return {
      ...parent,
      missing: false,
      isConstructor: this.mode === "constructor",
      isDirector: this.mode === "director",
      sceneName: context.scene.name,
      schemeName: context.definition.schemeName,
      contextKey: this.contextKey,
      episode: draft ? { ...draft, zones: (draft.zones ?? []).map((zone) => ({ ...zone,
        triggerFields: buildTriggerFields(zone.trigger, context.definition.episodes, { prefix: "zone-trigger", schemeId: context.definition.schemeId, schemeName: context.definition.schemeName }) })) } : draft,
      hasEpisode: Boolean(draft),
      episodes: context.definition.episodes.map((entry) => ({ ...entry,
        selected: entry.id === draft?.id,
        incoming: incoming.includes(entry.id),
        allowed: true
      })),
      otherEpisodes: context.definition.episodes.filter((entry) => entry.id !== draft?.id).map((entry) => ({ ...entry, incoming: incoming.includes(entry.id) })),
      graph,
      graphText: transitionsText(context.definition),
      activeName: active?.name ?? "Эпизод не запущен",
      activeStop: Boolean(active?.stop),
      runtime: context.runtime,
      tokens: context.tokens.map((token) => ({ id: token.id, name: token.name, img: token.texture?.src,
        configured: Boolean(draft?.tokens?.[token.id]),
        disabled: (context.runtime.disabledTokens ?? []).includes(token.id),
        emoji: draft?.tokens?.[token.id]?.emoji ?? ""
      })),
      saveStatus: this.dirty ? "Есть несохранённые изменения" : "Изменения применяются после сохранения",
      workspaceGM: draft?.workspace?.gm ?? [],
      workspacePlayers: draft?.workspace?.players ?? [],
      subscriptions: (draft?.subscriptions ?? []).map((entry) => ({ ...entry, isMacro: entry.kind === "macro", isChat: entry.kind === "chat", isTransition: entry.kind === "transition",
        audience: { gms: true, interactor: true, nearby: false, range: 30, visibleOnly: true, ...entry.audience } })),
      interactionTargets: [
        ...context.tokens.map((token) => ({ value: `Token:${token.id}`, name: `НИП · ${token.name}` })),
        ...Array.from(context.scene.tiles?.values?.() ?? []).map((tile) => ({ value: `Tile:${tile.id}`, name: `Тайл · ${tile.name || tile.texture?.src?.split("/").pop() || tile.id}` }))
      ],
      interactions: (draft?.interactions ?? []).map((entry) => ({ ...entry, targetValue: `${entry.target.type}:${entry.target.id}`,
        triggerFields: buildTriggerFields(entry.trigger, context.definition.episodes, { prefix: "action-trigger", schemeId: context.definition.schemeId, schemeName: context.definition.schemeName }) })),
      taggedObjects: (context.objects ?? []).map((object) => {
        const key = `${context.scene.id}:${object.type}:${object.id}`;
        return { ...object, sceneId: context.scene.id, tagsText: this.tagDrafts.get(key) ?? object.tags.join(", "), unsaved: this.tagDrafts.has(key) };
      }),
      triggerCounts: buildTriggerRows(context),
      eventLog: [...(context.runtime.eventLog ?? [])].reverse().map((entry) => ({ ...entry,
        time: new Date(entry.at).toLocaleTimeString("ru-RU"),
        statusLabel: ({ queued: "Ожидает", running: "Выполняется", done: "Выполнено", failed: "Ошибка", stale: "Устарело", observed: "Зафиксировано" })[entry.status] ?? entry.status,
        resultsText: (entry.results ?? []).map((result) => `${result.subscriptionId}: ${result.status}${result.error ? ` · ${result.error}` : ""}`).join("; ")
      }))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const listeners = this.bindEvents();
    this.dock?.bindControls();
    if (this.pendingInputs) {
      const inputs = [...this.element.querySelectorAll("input[name], select[name], textarea[name]")];
      for (const saved of this.pendingInputs) {
        const index = inputs.findIndex((input) => input.name === saved.name && input.type === saved.type);
        if (index < 0) continue;
        const [input] = inputs.splice(index, 1);
        input.value = saved.value;
        if (typeof saved.checked === "boolean") input.checked = saved.checked;
      }
      this.pendingInputs = null;
    }
    this.element.querySelector("[data-import-file]")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) void this.controller.importScene(file).then(() => {
        this.resetDraft();
        if (this.rendered) return this.render({ force: true });
      }).catch(errorMessage);
      event.target.value = "";
    }, listeners);
    this.element.addEventListener("dragover", (event) => {
      if (event.target.closest("[data-spawn-drop], [data-workspace-drop]")) event.preventDefault();
    }, listeners);
    this.element.addEventListener("drop", (event) => {
      const target = event.target.closest("[data-spawn-drop], [data-workspace-drop]");
      if (!target) return;
      event.preventDefault();
      void this.handleDrop(event, target).catch(errorMessage);
    }, listeners);
  }

  readEpisode() {
    const root = this.element.querySelector("[data-episode-fields]");
    if (!root || !this.draft) return this.draft;
    const draft = clone(this.draft);
    const block = root.dataset?.legacyBlock;
    const includes = (name) => !block || block === name;
    if (includes("episode")) {
    draft.name = value(root, "name").trim();
    if (!draft.name) throw new Error("Укажите название эпизода.");
    draft.allowFromAll = checked(root, "allowFromAll");
    draft.from = [...root.querySelectorAll('[name="from"]:checked')].map((input) => input.value);
    draft.stop = checked(root, "stop");
    }
    if (includes("entry")) {
    draft.pause = checked(root, "pause");
    draft.sound = value(root, "sound").trim();
    draft.spawns = [...root.querySelectorAll("[data-spawn-row]")].map((row) => ({
      id: row.dataset.spawnRow,
      actorUuid: value(row, "spawnActor").trim(),
      x: number(row, "spawnX", "Позиция подкрепления X"),
      y: number(row, "spawnY", "Позиция подкрепления Y"),
      count: number(row, "spawnCount", "Количество подкреплений", { min: 1, max: 50 }),
      spacing: number(row, "spawnSpacing", "Шаг размещения")
    }));
    }
    if (includes("zones")) {
    draft.zones = [...root.querySelectorAll("[data-zone-row]")].map((row) => ({
      id: row.dataset.zoneRow,
      label: value(row, "zoneLabel").trim(),
      x: number(row, "zoneX", "Зона X"), y: number(row, "zoneY", "Зона Y"),
      width: number(row, "zoneWidth", "Ширина зоны", { min: 1 }),
      height: number(row, "zoneHeight", "Высота зоны", { min: 1 }),
      targetEpisodeId: value(row, "zoneTarget"), trigger: readTriggerFields(row, "zone-trigger")
    }));
    }
    if (includes("subscriptions")) {
    draft.subscriptions = [...root.querySelectorAll("[data-subscription-row]")].map((row) => ({
      id: row.dataset.subscriptionRow, enabled: checked(row, "subscriptionEnabled"),
      event: value(row, "subscriptionEvent").trim(), kind: value(row, "subscriptionKind"),
      macroUuid: value(row, "subscriptionMacro").trim(), episodeId: value(row, "subscriptionEpisode"),
      text: value(row, "subscriptionText"),
      audience: { gms: checked(row, "audienceGMs"), interactor: checked(row, "audienceInteractor"), nearby: checked(row, "audienceNearby"),
        range: number(row, "audienceRange", "Дальность сообщения"), visibleOnly: checked(row, "audienceVisible") }
    }));
    }
    if (includes("dialogues")) {
    draft.interactions = [...root.querySelectorAll("[data-interaction-row]")].map((row) => {
      const [type, id] = value(row, "actionTarget").split(":");
      return { id: row.dataset.interactionRow, name: value(row, "actionName").trim(), enabled: checked(row, "actionEnabled"),
        target: { type, id }, range: number(row, "actionRange", "Дальность взаимодействия"), eventName: value(row, "actionEvent").trim(),
        trigger: readTriggerFields(row, "action-trigger") };
    });
    }
    for (const audience of ["gm", "players"]) {
      if (!includes(audience === "gm" ? "workspaceGM" : "workspacePlayers")) continue;
      draft.workspace[audience] = [...root.querySelectorAll(`[data-workspace-row="${audience}"]`)].map((row) => ({
        uuid: value(row, "windowUuid").trim(),
        x: number(row, "windowX", "Позиция окна X"), y: number(row, "windowY", "Позиция окна Y"),
        width: number(row, "windowWidth", "Ширина окна", { min: 100 }),
        height: number(row, "windowHeight", "Высота окна", { min: 100 })
      }));
    }
    return draft;
  }

  async changeDraft(callback) {
    this.draft = this.readEpisode();
    await callback(this.draft);
    this.dirty = true;
    this.episodeDirty = true;
    return this.render({ force: true });
  }

  async handleDrop(event, target) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!data?.uuid) throw new Error("Перетащите документ из боковой панели Foundry.");
    const doc = await fromUuid(data.uuid);
    if (!doc) throw new Error("Документ не найден.");
    if (target.hasAttribute("data-spawn-drop")) {
      if (doc.documentName !== "Actor") throw new Error("Для подкрепления требуется персонаж из списка Actors.");
      return this.changeDraft((draft) => draft.spawns.push({ id: randomId(), actorUuid: doc.uuid, x: 0, y: 0, count: 1, spacing: 100 }));
    }
    if (!["Actor", "JournalEntry", "JournalEntryPage", "Item", "RollTable"].includes(doc.documentName)) {
      throw new Error("Рабочий стол поддерживает персонажей, предметы, журналы и таблицы.");
    }
    const audience = target.dataset.workspaceDrop;
    return this.changeDraft((draft) => draft.workspace[audience].push({ uuid: doc.uuid, x: 100, y: 100, width: 500, height: 500 }));
  }

  async handleAction(action, button) {
    const context = this.controller.getContext();
    const currentKey = editorContextKey(context, context.episode?.id ?? context.definition?.episodes?.[0]?.id);
    const shownKey = this.element?.querySelector?.("[data-editor-context]")?.dataset?.editorContext ?? this.contextKey;
    if (shownKey && shownKey !== currentKey) {
      void this.refresh();
      throw new Error("Сцена или выбранный эпизод изменились. Дождитесь обновления окна; черновик сохранён отдельно.");
    }
    if (action === "selectEpisode") {
      if (!(await this.mayDiscard())) return;
      this.resetDraft();
      return this.controller.selectEpisode(button.dataset.episodeId);
    }
    if (action === "addEpisode") {
      const input = field(this.element, "newEpisodeName");
      const name = input.value.trim();
      if (!name) throw new Error("Укажите название нового эпизода.");
      if (!(await this.mayDiscard())) return;
      this.resetDraft();
      return this.controller.addEpisode(name);
    }
    if (action === "saveEpisode") {
      const draft = this.readEpisode();
      await this.controller.saveEpisode(draft, { sceneId: context.scene.id, expectedRevision: this.draftRevision });
      this.resetDraft();
      return this.render({ force: true });
    }
    if (action === "discard") { this.resetDraft(); return this.render({ force: true }); }
    if (action === "deleteEpisode") {
      if (!(await DialogV2.confirm({ window: { title: "Удаление эпизода" }, content: "<p>Удалить выбранный эпизод и его настройки? Документы сцены сохранятся.</p>", rejectClose: false }))) return;
      const id = this.draft.id;
      this.resetDraft();
      return this.controller.deleteEpisode(id);
    }
    if (action === "saveGraph") {
      if (this.episodeDirty && !(await this.mayDiscard())) return;
      const definition = clone(this.controller.getContext().definition);
      const parsed = parseTransitions(value(this.element, "graphText"), definition.episodes);
      definition.episodes = parsed;
      await this.controller.saveDefinition(definition, this.draftRevision, { sceneId: context.scene.id });
      this.resetDraft();
      return this.render({ force: true });
    }
    if (action === "previewGraph") {
      const context = this.controller.getContext();
      const parsed = parseTransitions(value(this.element, "graphText"), context.definition.episodes);
      const summary = parsed.map((episode) => `${episode.name}: ${episode.allowFromAll ? "из любого" : (episode.from.map((id) => parsed.find((entry) => entry.id === id)?.name ?? id).join(", ") || "нет входов")}`).join("\n");
      this.element.querySelector("[data-graph-preview]").textContent = summary;
      this.previewGraph(parsed);
      return;
    }
    if (action === "token") {
      if (this.mode === "constructor" && this.dirty) {
        ui.notifications.warn("Сохраните настройки эпизода перед настройкой токена.");
        return;
      }
      return this.controller.openToken(button.dataset.tokenId);
    }
    if (action === "addSpawn") return this.changeDraft((draft) => draft.spawns.push({ id: randomId(), actorUuid: "", x: 0, y: 0, count: 1, spacing: 100 }));
    if (action === "deleteSpawn") return this.changeDraft((draft) => { draft.spawns.splice(Number(button.dataset.index), 1); });
    if (action === "pickSpawn") {
      const point = await this.controller.pickPoint();
      if (point) return this.changeDraft((draft) => Object.assign(draft.spawns[Number(button.dataset.index)], point));
      return;
    }
    if (action === "addZone") return this.changeDraft((draft) => draft.zones.push({ id: randomId(), label: "Новая зона", x: 0, y: 0, width: 200, height: 200, targetEpisodeId: "" }));
    if (action === "deleteZone") return this.changeDraft((draft) => { draft.zones.splice(Number(button.dataset.index), 1); });
    if (action === "pickZone") {
      const point = await this.controller.pickPoint();
      if (point) return this.changeDraft((draft) => Object.assign(draft.zones[Number(button.dataset.index)], point));
      return;
    }
    if (action === "captureWorkspace") {
      const captured = this.controller.captureWorkspace(button.dataset.audience);
      return this.changeDraft((draft) => { draft.workspace[button.dataset.audience] = captured; });
    }
    if (action === "addWindow") return this.changeDraft((draft) => draft.workspace[button.dataset.audience].push({ uuid: "", x: 100, y: 100, width: 500, height: 500 }));
    if (action === "deleteWindow") return this.changeDraft((draft) => { draft.workspace[button.dataset.audience].splice(Number(button.dataset.index), 1); });
    if (action === "export") return this.controller.exportScene();
    if (action === "import") {
      if (await this.mayDiscard()) this.element.querySelector("[data-import-file]").click();
      return;
    }
    if (action === "transition") return this.controller.transition(value(this.element, "targetEpisode"));
    if (action === "stop") {
      const stop = this.controller.getContext().definition.episodes.find((episode) => episode.stop);
      if (!stop) throw new Error("Пометьте эпизод «Остановка автоматизации» в конструкторе.");
      return this.controller.transition(stop.id);
    }
    if (action === "automation") return this.controller.setAutomation(button.dataset.tokenId, button.dataset.enable === "true");
    if (action === "combat") return this.controller.startCombat();
    if (action === "shops") return this.controller.openShops();
    if (action === "dialogues") return this.controller.openDialogues();
    if (action === "haltScene") return this.controller.haltScene();
    if (action === "haltScheme") return this.controller.haltScheme();
    if (action === "resumeScheme") return this.controller.resumeScheme(value(this.element, "resumeEpisode"));
    if (action === "saveObjectTags") {
      const row = button.closest("[data-object-tags]");
      const key = `${row.dataset.sceneId}:${row.dataset.objectType}:${row.dataset.objectId}`;
      await this.controller.saveObjectTags(row.dataset.objectType, row.dataset.objectId, splitTags(value(row, "objectTags")), row.dataset.sceneId);
      this.tagDrafts.delete(key);
      const status = row.querySelector("[data-tag-status]");
      if (status) status.textContent = "Сохранено";
      return;
    }
    if (action === "resetTrigger") return this.controller.resetTriggers(button.dataset.triggerKey);
    if (action === "resetTriggers") return this.controller.resetTriggers();
    if (action === "toggleTrigger") return this.controller.setTriggerEnabled(button.dataset.triggerKey, button.dataset.enable === "true");
    if (action === "addDialogue" || action === "dialogue") {
      if (this.dirty) throw new Error("Сохраните параметры эпизода перед открытием редактора диалога.");
      return action === "addDialogue" ? this.controller.addDialogue() : this.controller.openDialogueEditor(button.dataset.dialogueId);
    }
    if (action === "deleteDialogue") {
      if (this.dirty) throw new Error("Сначала сохраните параметры эпизода.");
      return this.controller.deleteDialogue(button.dataset.dialogueId);
    }
    if (action === "addSubscription") return this.changeDraft((draft) => {
      draft.subscriptions ??= [];
      draft.subscriptions.push({ id: randomId(), enabled: true, event: "", kind: "transition", macroUuid: "", episodeId: "", text: "",
        audience: { gms: true, interactor: true, nearby: false, range: 30, visibleOnly: true } });
    });
    if (action === "deleteSubscription") return this.changeDraft((draft) => { draft.subscriptions.splice(Number(button.dataset.index), 1); });
    if (action === "addInteraction") return this.changeDraft((draft) => {
      draft.interactions ??= [];
      const target = this.controller.getContext().tokens[0];
      draft.interactions.push({ id: randomId(), name: "Взаимодействовать", enabled: true, target: { type: "Token", id: target?.id ?? "" }, range: 5, eventName: "object.used" });
    });
    if (action === "deleteInteraction") return this.changeDraft((draft) => { draft.interactions.splice(Number(button.dataset.index), 1); });
    if (action === "emitEvent") return this.controller.emitEvent(value(this.element, "eventName").trim());
    if (["constructor", "director", "actor"].includes(action)) return this.controller.setMode(action);
    if (action === "close") return this.controller.closeScreen();
  }

  previewGraph(episodes) {
    const graph = buildGraphView(episodes, this.draft?.id);
    const svg = this.element.querySelector(".ms-graph");
    const doc = svg.ownerDocument;
    const create = (tag, attributes = {}, text) => {
      const node = doc.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, val] of Object.entries(attributes)) node.setAttribute(name, String(val));
      if (text !== undefined) node.textContent = text;
      return node;
    };
    for (const child of [...svg.children]) if (child.localName !== "defs") child.remove();
    svg.setAttribute("viewBox", `0 0 ${graph.width} ${graph.height}`);
    for (const edge of graph.edges) svg.append(create("path", { d: edge.path, class: "ms-edge", "marker-end": "url(#ms-graph-arrow)" }));
    for (const node of graph.nodes) {
      const group = create("g", { class: `ms-node${node.selected ? " is-selected" : ""}`, "data-screen-action": "selectEpisode", "data-episode-id": node.id, role: "button", tabindex: "0", "aria-label": `Настроить ${node.name}` });
      group.append(create("title", {}, node.name));
      group.append(create("rect", { x: node.x, y: node.y, width: 180, height: 56, rx: 8 }));
      group.append(create("text", { x: node.labelX, y: node.labelY, "text-anchor": "middle" }, node.label));
      if (node.all) group.append(create("text", { x: node.labelX, y: node.labelY, dy: 18, "text-anchor": "middle", class: "ms-graph-caption" }, "из любого"));
      svg.append(group);
    }
  }
}

export class TokenEditorApplication extends ScreenFormApplication {
  static DEFAULT_OPTIONS = {
    classes: themedClasses("dmicher-screen-token-editor"),
    position: { width: 620, height: 720 },
    window: { title: "Поведение токена", icon: "fa-solid fa-person-rays", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/token-editor.hbs` } };

  constructor(controller, tokenId, { episodeId, schemeId, ...options } = {}) {
    const context = controller.getContext({ schemeId });
    const selectedId = episodeId ?? context.selectedEpisodeId;
    super({ ...options, id: `dmicher-master-screen-token-${context.scene?.id}-${context.definition.schemeId}-${selectedId}-${tokenId}` });
    this.controller = controller;
    this.tokenId = tokenId;
    this.episodeId = selectedId;
    this.sceneId = context.scene?.id;
    this.schemeId = context.definition.schemeId;
    this.draft = null;
    this.draftRevision = null;
  }

  async _prepareContext(options) {
    const parent = await super._prepareContext(options);
    const context = this.controller.getContext({ schemeId: this.schemeId });
    const token = context.tokens.find((entry) => entry.id === this.tokenId);
    const episode = context.definition?.episodes.find((entry) => entry.id === this.episodeId);
    if (!token || !episode || context.scene?.id !== this.sceneId || !context.isGM) return { ...parent, missing: true };
    if (!this.draft || !this.dirty) {
      this.draft = clone(episode.tokens[this.tokenId] ?? defaultTokenBehavior());
      this.draftRevision = context.definition.revision;
    }
    return {
      ...parent, tokenName: token.name, episodeName: episode.name, behavior: this.draft,
      hasPosition: Boolean(this.draft.position),
      hiddenUnset: this.draft.hidden == null, hiddenTrue: this.draft.hidden === true, hiddenFalse: this.draft.hidden === false,
      phrases: (this.draft.speech.phrases ?? []).join("\n"),
      points: formatPointRows(this.draft.patrol.points),
      items: this.draft.shop.items.map((item) => ({ id: item.id, name: item.data?.name ?? "Предмет", img: item.data?.img, stock: item.stock })),
      shopTiles: this.draft.shop.display === "tiles",
      shopTriggerFields: buildTriggerFields(this.draft.shop.trigger, context.definition.episodes, { prefix: "shop-trigger", schemeId: this.schemeId, schemeName: context.definition.schemeName }),
      interactionTriggerFields: buildTriggerFields(this.draft.interaction.trigger, context.definition.episodes, { prefix: "interaction-trigger", schemeId: this.schemeId, schemeName: context.definition.schemeName }),
      episodes: context.definition.episodes.map((entry) => ({ ...entry, selected: entry.id === this.draft.interaction.targetEpisodeId })),
      saveStatus: this.dirty ? "Есть несохранённые изменения" : "Настройки принадлежат выбранному эпизоду"
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const listeners = this.bindEvents();
    this.element.addEventListener("dragover", (event) => { if (event.target.closest("[data-shop-drop]")) event.preventDefault(); }, listeners);
    this.element.addEventListener("drop", (event) => {
      if (!event.target.closest("[data-shop-drop]")) return;
      event.preventDefault();
      void this.dropItem(event).catch(errorMessage);
    }, listeners);
  }

  readBehavior() {
    const root = this.element;
    const behavior = clone(this.draft);
    behavior.enabled = checked(root, "enabled");
    behavior.emoji = value(root, "emoji").trim();
    behavior.position = checked(root, "positionEnabled") ? { x: number(root, "positionX", "Позиция X"), y: number(root, "positionY", "Позиция Y") } : null;
    behavior.hidden = value(root, "hidden") === "keep" ? null : value(root, "hidden") === "true";
    behavior.speech = {
      interval: number(root, "speechInterval", "Интервал реплик", { min: 1 }),
      phrases: splitLines(value(root, "phrases")),
      range: number(root, "speechRange", "Дальность слышимости"),
      visibleOnly: checked(root, "visibleOnly")
    };
    behavior.entrySpeech = value(root, "entrySpeech").trim();
    behavior.patrol = {
      enabled: checked(root, "patrolEnabled"),
      speed: number(root, "patrolSpeed", "Скорость патруля", { min: 0.1 }),
      points: parsePointRows(value(root, "points"))
    };
    behavior.shop.enabled = checked(root, "shopEnabled");
    behavior.shop.range = number(root, "shopRange", "Дальность магазина");
    behavior.shop.requireGMApproval = checked(root, "shopApproval");
    behavior.shop.display = value(root, "shopDisplay") === "tiles" ? "tiles" : "list";
    behavior.shop.trigger = readTriggerFields(root, "shop-trigger");
    behavior.shop.items = behavior.shop.items.map((item, index) => ({ ...item,
      stock: number(root, `stock-${index}`, "Остаток предмета", { min: 0, max: 99999 })
    }));
    behavior.interaction = { label: value(root, "interactionLabel").trim(), targetEpisodeId: value(root, "interactionTarget"), trigger: readTriggerFields(root, "interaction-trigger") };
    return behavior;
  }

  async changeDraft(callback) {
    this.draft = this.readBehavior();
    await callback(this.draft);
    this.dirty = true;
    return this.render({ force: true });
  }

  async dropItem(event) {
    const drop = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (drop.type !== "Item" || !drop.uuid) throw new Error("Перетащите предмет из списка предметов или листа персонажа.");
    const document = await fromUuid(drop.uuid);
    if (document?.documentName !== "Item") throw new Error("Предмет не найден.");
    const data = document.toObject();
    delete data._id;
    return this.changeDraft((draft) => draft.shop.items.push({ id: randomId(), data, stock: 1 }));
  }

  async handleAction(action, button) {
    if (this.controller.getContext().scene?.id !== this.sceneId) throw new Error("Выбрана другая сцена. Откройте настройки её токена.");
    if (action === "saveToken") {
      await this.controller.saveToken(this.tokenId, this.readBehavior(), this.episodeId, { sceneId: this.sceneId, schemeId: this.schemeId, expectedRevision: this.draftRevision });
      this.resetDraft();
      return this.render({ force: true });
    }
    if (action === "discard") { this.resetDraft(); return this.render({ force: true }); }
    if (action === "capturePosition") {
      const point = this.controller.captureToken(this.tokenId);
      return this.changeDraft((draft) => { draft.position = { x: point.x, y: point.y }; draft.hidden = point.hidden; });
    }
    if (action === "addPatrolPoint") {
      const point = await this.controller.pickPoint();
      if (point) return this.changeDraft((draft) => draft.patrol.points.push({ ...point, macroUuid: "", onTrue: "" }));
      return;
    }
    if (action === "capturePatrolPoint") {
      const point = this.controller.captureToken(this.tokenId);
      return this.changeDraft((draft) => draft.patrol.points.push({ x: point.x, y: point.y, macroUuid: "", onTrue: "" }));
    }
    if (action === "removeItem") return this.changeDraft((draft) => { draft.shop.items.splice(Number(button.dataset.index), 1); });
    if (action === "close") return this.close();
  }
}
