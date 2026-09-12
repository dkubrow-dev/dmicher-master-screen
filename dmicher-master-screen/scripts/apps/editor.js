import { text as t } from "../localization.js";
import { themedClasses, notifyError } from "../ui.js";
import { ScreenFormApplication } from "./screen-form.js";
import { formValue as value, formChecked as checked } from "./form-fields.js";
import { randomId } from "../model.js";
import { requireNumber, buildConditionRows } from "./editor-view.js";
import { buildConditionFields, readConditionFields, splitTags } from "./condition-fields.js";
import { ConstructorDock } from "./constructor-dock.js";
import { getObjectBindings, listNativeSceneObjects } from "../scene-objects.js";
import { getSignalCatalog } from "../signal-catalog.js";

const MODULE_ID = "dmicher-master-screen";
const clone = (value) => foundry.utils.deepClone(value);
const number = (root, name, label, options) => requireNumber(value(root, name), label, options);
const editorContextKey = (context, id) => `${context.scene?.id}:${context.definition?.groupId && context.definition.groupId !== "main" ? `${context.definition.groupId}:` : ""}${id}`;

export class EditorApplication extends ScreenFormApplication {
  static DEFAULT_OPTIONS = {
    id: "dmicher-master-screen-editor",
    classes: themedClasses("dmicher-screen-editor"),
    position: { width: 920, height: 760 },
    window: { title: t("Ширма мастера", "Master screen"), icon: "fa-solid fa-chalkboard", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/state-tools.hbs`, scrollable: [".ms-body"] } };

  constructor(controller, { mode = "constructor", ...options } = {}) {
    super(mode === "constructor" ? { ...options,
      window: { ...options.window, frame: false, positioned: false, resizable: false } } : options);
    this.controller = controller;
    this.mode = mode;
    this.dock = mode === "constructor" ? new ConstructorDock() : null;
    this.draft = null;
    this.contextKey = "";
    this.stateDirty = false;
    this.drafts = new Map();
    this.pendingInputs = null;
    this.draftRevision = null;
    this.tagDrafts = new Map();
  }

  get title() { return `🎬 ${this.mode === "director" ? t("Режиссёр", "Director") : t("Конструктор", "Constructor")} · ${t("Ширма мастера", "Master screen")}`; }

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
        if (status) status.textContent = t("Не сохранено", "Not saved");
      }
      return false;
    }
    if (event.target.closest("[data-state-fields]")) { this.stateDirty = true; return true; }
    return false;
  }

  resetDraft() {
    super.resetDraft();
    this.stateDirty = false;
    this.pendingInputs = null;
    this.draftRevision = null;
    this.drafts?.delete(this.contextKey);
  }

  refresh() {
    const context = this.controller.getContext();
    const stateId = context.state?.id ?? context.definition?.states?.[0]?.id;
    if (this.rendered && this.contextKey !== editorContextKey(context, stateId)) return this.render({ force: true });
    return super.refresh();
  }

  selectDraftContext(key) {
    if (this.contextKey === key) return;
    if (this.contextKey && this.dirty) {
      const inputs = [...(this.element?.querySelectorAll?.("input[name], select[name], textarea[name]") ?? [])]
        .map((input) => ({ name: input.name, type: input.type, value: input.value, checked: input.checked }));
      this.drafts.set(this.contextKey, { draft: clone(this.draft), revision: this.draftRevision, dirty: true, stateDirty: this.stateDirty, inputs });
    }
    const saved = this.drafts.get(key);
    this.contextKey = key;
    this.draft = saved ? clone(saved.draft) : null;
    this.dirty = Boolean(saved?.dirty);
    this.stateDirty = Boolean(saved?.stateDirty);
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
    if (!context.definition) return { ...parent, missingGroup: true, sceneName: context.scene.name, isGM: true, isConstructor: this.mode === "constructor", isDirector: this.mode === "director" };
    const state = context.state ?? context.definition.states[0];
    const key = editorContextKey(context, state?.id);
    this.selectDraftContext(key);
    if ((!this.draft || !this.dirty) && state) {
      this.draft = clone(state);
      this.draftRevision = context.definition.revision;
    }
    const draft = this.draft;
    const bindings = getObjectBindings(context.scene).bindings;
    const signalOptions = (ownerKey) => getSignalCatalog(context.scene).signals.filter((signal) => signal.emitterKey === ownerKey).map((signal) => ({ value: signal.id, name: signal.name }));
    const active = context.definition.states.find((entry) => entry.id === context.runtime.stateId);
    return {
      ...parent,
      missing: false,
      isConstructor: this.mode === "constructor",
      isDirector: this.mode === "director",
      sceneName: context.scene.name,
      groupName: context.definition.groupName,
      contextKey: this.contextKey,
      state: draft ? { ...draft, zones: (draft.zones ?? []).map((zone) => ({ ...zone,
        signalOptions: signalOptions(`Group:${context.definition.groupId}`), parametersJSON: JSON.stringify(zone.parameters ?? {}), conditionFields: buildConditionFields(zone.conditions, context.definition.states, { prefix: "zone-conditions", groupId: context.definition.groupId, groupName: context.definition.groupName }) })) } : draft,
      hasState: Boolean(draft),
      states: context.definition.states.map((entry) => ({ ...entry,
        selected: entry.id === draft?.id,
        allowed: true
      })),
      activeName: active?.name ?? t("Состояние не запущено", "State not started"),
      activeStop: Boolean(context.runtime.halted),
      runtime: context.runtime,
      tokens: context.tokens.map((token) => ({ id: token.id, name: token.name, img: token.texture?.src,
        configured: bindings[`Token:${token.id}`]?.groupId === context.definition.groupId,
        disabled: (context.runtime.disabledObjects ?? []).includes(`Token:${token.id}`)
      })),
      saveStatus: this.dirty ? t("Есть несохранённые изменения", "Unsaved changes") : t("Изменения применяются после сохранения", "Changes apply after saving"),
      workspaceGM: draft?.workspace?.gm ?? [],
      workspacePlayers: draft?.workspace?.players ?? [],
      interactionTargets: listNativeSceneObjects(context.scene).map((object) => ({ value: object.key, name: `${object.name} · ${object.type}` })),
      interactions: (draft?.interactions ?? []).map((entry) => ({ ...entry, targetValue: `${entry.target.type}:${entry.target.id}`,
        signalOptions: signalOptions(`${entry.target.type}:${entry.target.id}`), parametersJSON: JSON.stringify(entry.parameters ?? {}), conditionFields: buildConditionFields(entry.conditions, context.definition.states, { prefix: "action-conditions", groupId: context.definition.groupId, groupName: context.definition.groupName }) })),
      taggedObjects: (context.objects ?? []).map((object) => {
        const key = `${context.scene.id}:${object.type}:${object.id}`;
        return { ...object, sceneId: context.scene.id, tagsText: this.tagDrafts.get(key) ?? object.tags.join(", "), unsaved: this.tagDrafts.has(key) };
      }),
      conditionCounts: buildConditionRows(context),
      signalLog: [...(context.signalLog ?? [])].reverse().map((entry) => ({ ...entry, source: entry.emitterKey,
        time: new Date(entry.at).toLocaleTimeString(game.i18n?.lang ?? "ru"),
        statusLabel: ({ done: t("Выполнено", "Done"), failed: t("Ошибка", "Error"), stale: t("Устарело", "Outdated") })[entry.status] ?? entry.status,
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
      }).catch(notifyError);
      event.target.value = "";
    }, listeners);
    this.element.addEventListener("dragover", (event) => {
      if (event.target.closest("[data-spawn-drop], [data-workspace-drop]")) event.preventDefault();
    }, listeners);
    this.element.addEventListener("drop", (event) => {
      const target = event.target.closest("[data-spawn-drop], [data-workspace-drop]");
      if (!target) return;
      event.preventDefault();
      void this.handleDrop(event, target).catch(notifyError);
    }, listeners);
  }

  readState() {
    const root = this.element.querySelector("[data-state-fields]");
    if (!root || !this.draft) return this.draft;
    const draft = clone(this.draft);
    const block = root.dataset?.stateTool;
    const includes = (name) => !block || block === name;
    if (includes("entry")) {
    draft.pause = checked(root, "pause");
    draft.sound = value(root, "sound").trim();
    draft.spawns = [...root.querySelectorAll("[data-spawn-row]")].map((row) => ({
      id: row.dataset.spawnRow,
      actorUuid: value(row, "spawnActor").trim(),
      x: number(row, "spawnX", t("Позиция подкрепления X", "Reinforcement X position")),
      y: number(row, "spawnY", t("Позиция подкрепления Y", "Reinforcement Y position")),
      count: number(row, "spawnCount", t("Количество подкреплений", "Reinforcement count"), { min: 1, max: 50 }),
      spacing: number(row, "spawnSpacing", t("Шаг размещения", "Placement spacing"))
    }));
    }
    if (includes("zones")) {
    draft.zones = [...root.querySelectorAll("[data-zone-row]")].map((row) => ({
      id: row.dataset.zoneRow,
      label: value(row, "zoneLabel").trim(),
      x: number(row, "zoneX", t("Зона X", "Zone X")), y: number(row, "zoneY", t("Зона Y", "Zone Y")),
      width: number(row, "zoneWidth", t("Ширина зоны", "Zone width"), { min: 1 }),
      height: number(row, "zoneHeight", t("Высота зоны", "Zone height"), { min: 1 }),
      signalId: value(row, "zoneSignal"), parameters: JSON.parse(value(row, "zoneParameters", "{}")), conditions: readConditionFields(row, "zone-conditions")
    }));
    }
    if (includes("dialogues")) {
    draft.interactions = [...root.querySelectorAll("[data-interaction-row]")].map((row) => {
      const [type, id] = value(row, "actionTarget").split(":");
      return { id: row.dataset.interactionRow, name: value(row, "actionName").trim(), enabled: checked(row, "actionEnabled"),
        target: { type, id }, range: number(row, "actionRange", t("Дальность взаимодействия", "Interaction range")), signalId: value(row, "actionSignal"), parameters: JSON.parse(value(row, "actionParameters", "{}")),
        conditions: readConditionFields(row, "action-conditions") };
    });
    }
    for (const audience of ["gm", "players"]) {
      if (!includes(audience === "gm" ? "workspaceGM" : "workspacePlayers")) continue;
      draft.workspace[audience] = [...root.querySelectorAll(`[data-workspace-row="${audience}"]`)].map((row) => ({
        uuid: value(row, "windowUuid").trim(),
        x: number(row, "windowX", t("Позиция окна X", "Window X position")), y: number(row, "windowY", t("Позиция окна Y", "Window Y position")),
        width: number(row, "windowWidth", t("Ширина окна", "Window width"), { min: 100 }),
        height: number(row, "windowHeight", t("Высота окна", "Window height"), { min: 100 })
      }));
    }
    return draft;
  }

  async changeDraft(callback) {
    this.draft = this.readState();
    await callback(this.draft);
    this.dirty = true;
    this.stateDirty = true;
    return this.render({ force: true });
  }

  async handleDrop(event, target) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (!data?.uuid) throw new Error(t("Перетащите документ из боковой панели Foundry.", "Drop a document from the Foundry sidebar."));
    const doc = await fromUuid(data.uuid);
    if (!doc) throw new Error(t("Документ не найден.", "Document not found."));
    if (target.hasAttribute("data-spawn-drop")) {
      if (doc.documentName !== "Actor") throw new Error(t("Для подкрепления требуется персонаж из списка Actors.", "Reinforcements require a character from the Actors directory."));
      return this.changeDraft((draft) => draft.spawns.push({ id: randomId(), actorUuid: doc.uuid, x: 0, y: 0, count: 1, spacing: 100 }));
    }
    if (!["Actor", "JournalEntry", "JournalEntryPage", "Item", "RollTable"].includes(doc.documentName)) {
      throw new Error(t("Рабочий стол поддерживает персонажей, предметы, журналы и таблицы.", "The workspace supports characters, items, journals and roll tables."));
    }
    const audience = target.dataset.workspaceDrop;
    return this.changeDraft((draft) => draft.workspace[audience].push({ uuid: doc.uuid, x: 100, y: 100, width: 500, height: 500 }));
  }

  async handleAction(action, button) {
    if (action === "token") return this.controller.openObjectBehavior({ type: "Token", id: button.dataset.tokenId });
    const context = this.controller.getContext();
    const currentKey = editorContextKey(context, context.state?.id ?? context.definition?.states?.[0]?.id);
    const shownKey = this.element?.querySelector?.("[data-editor-context]")?.dataset?.editorContext ?? this.contextKey;
    if (shownKey && shownKey !== currentKey) {
      void this.refresh();
      throw new Error(t("Сцена или выбранное состояние изменились. Дождитесь обновления окна; черновик сохранён отдельно.", "The scene or selected state changed. Wait for the window to refresh; your draft is kept separately."));
    }
    if (action === "saveState") {
      const draft = this.readState();
      await this.controller.saveState(draft, { sceneId: context.scene.id, expectedRevision: this.draftRevision });
      this.resetDraft();
      return this.render({ force: true });
    }
    if (action === "discard") { this.resetDraft(); return this.render({ force: true }); }
    if (action === "addSpawn") return this.changeDraft((draft) => draft.spawns.push({ id: randomId(), actorUuid: "", x: 0, y: 0, count: 1, spacing: 100 }));
    if (action === "deleteSpawn") return this.changeDraft((draft) => { draft.spawns.splice(Number(button.dataset.index), 1); });
    if (action === "pickSpawn") {
      const point = await this.controller.pickPoint();
      if (point) return this.changeDraft((draft) => Object.assign(draft.spawns[Number(button.dataset.index)], point));
      return;
    }
    if (action === "addZone") return this.changeDraft((draft) => draft.zones.push({ id: randomId(), label: t("Новая зона", "New zone"), x: 0, y: 0, width: 200, height: 200, signalId: "", parameters: {} }));
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
    if (action === "transition") return this.controller.transition(value(this.element, "targetState"));
    if (action === "stop") return this.controller.haltGroup(this.controller.getContext().groupId);
    if (action === "automation") return this.controller.setAutomation(button.dataset.tokenId, button.dataset.enable === "true");
    if (action === "combat") return this.controller.startCombat();
    if (action === "shops") return this.controller.openShops();
    if (action === "dialogues") return this.controller.openDialogues();
    if (action === "haltScene") return this.controller.haltScene();
    if (action === "haltGroup") return this.controller.haltGroup();
    if (action === "resumeGroup") return this.controller.resumeGroup(value(this.element, "resumeState"));
    if (action === "saveObjectTags") {
      const row = button.closest("[data-object-tags]");
      const key = `${row.dataset.sceneId}:${row.dataset.objectType}:${row.dataset.objectId}`;
      await this.controller.saveObjectTags(row.dataset.objectType, row.dataset.objectId, splitTags(value(row, "objectTags")), row.dataset.sceneId);
      this.tagDrafts.delete(key);
      const status = row.querySelector("[data-tag-status]");
      if (status) status.textContent = t("Сохранено", "Saved");
      return;
    }
    if (action === "resetCondition") return this.controller.resetConditions(button.dataset.conditionKey);
    if (action === "resetConditions") return this.controller.resetConditions();
    if (action === "toggleCondition") return this.controller.setConditionEnabled(button.dataset.conditionKey, button.dataset.enable === "true");
    if (action === "addInteraction") return this.changeDraft((draft) => {
      draft.interactions ??= [];
      const target = this.controller.getContext().tokens[0];
      draft.interactions.push({ id: randomId(), name: t("Взаимодействовать", "Interact"), enabled: true, target: { type: "Token", id: target?.id ?? "" }, range: 5, signalId: "", parameters: {} });
    });
    if (action === "deleteInteraction") return this.changeDraft((draft) => { draft.interactions.splice(Number(button.dataset.index), 1); });
    if (["constructor", "director", "actor"].includes(action)) return this.controller.setMode(action);
    if (action === "close") return this.controller.closeScreen();
  }


}
