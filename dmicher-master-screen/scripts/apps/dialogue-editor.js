import { ScreenFormApplication } from "./editor.js";
import { themedClasses } from "../ui.js";
import { randomId } from "../model.js";
import { requireNumber } from "./editor-view.js";
import { buildTriggerFields, readTriggerFields } from "./trigger-fields.js";

const MODULE_ID = "dmicher-master-screen";
const clone = structuredClone;
const value = (root, name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
const checked = (root, name) => root.querySelector(`[name="${name}"]`)?.checked === true;
const all = (collection) => Array.from(collection?.values?.() ?? collection ?? []);

export class DialogueEditorApplication extends ScreenFormApplication {
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-dialogue-editor"),
    position: { width: 800, height: 750 },
    window: { title: "Диалог · Конструктор", icon: "fa-solid fa-comments", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/dialogue-editor.hbs` } };

  constructor(controller, dialogueId, { episodeId, ...options } = {}) {
    const context = controller.getContext();
    const episode = episodeId ?? context.selectedEpisodeId;
    super({ ...options, id: `dmicher-master-screen-dialogue-editor-${context.scene?.id}-${episode}-${dialogueId}` });
    this.controller = controller;
    this.sceneId = context.scene?.id;
    this.episodeId = episode;
    this.dialogueId = dialogueId;
    this.nodeId = null;
    this.draft = null;
    this.draftRevision = null;
  }

  async _prepareContext(options) {
    const parent = await super._prepareContext(options), context = this.controller.getContext();
    const episode = context.definition.episodes.find((entry) => entry.id === this.episodeId);
    const dialogue = episode?.dialogues?.find((entry) => entry.id === this.dialogueId);
    if (!context.isGM || context.scene?.id !== this.sceneId || !dialogue) return { ...parent, missing: true };
    if (!this.draft || !this.dirty) {
      this.draft = clone(dialogue);
      this.draftRevision = context.definition.revision;
    }
    if (!this.draft.nodes.some((entry) => entry.id === this.nodeId)) this.nodeId = this.draft.startNodeId ?? this.draft.nodes[0]?.id;
    const node = this.draft.nodes.find((entry) => entry.id === this.nodeId);
    const targets = [
      ...context.tokens.map((token) => ({ value: `Token:${token.id}`, name: `НИП · ${token.name}` })),
      ...all(context.scene.tiles).map((tile) => ({ value: `Tile:${tile.id}`, name: `Тайл · ${tile.name || tile.texture?.src?.split("/").pop() || tile.id}` }))
    ];
    return { ...parent, dialogue: this.draft, episodeName: episode.name, node,
      nodes: this.draft.nodes.map((entry, index) => ({ ...entry, caption: `${index + 1}. ${(entry.text || "Без текста").slice(0, 45)}`, selected: entry.id === this.nodeId })),
      targetValue: `${this.draft.target.type}:${this.draft.target.id}`, targets,
      triggerFields: buildTriggerFields(this.draft.trigger, context.definition.episodes, { prefix: "dialogue-trigger", schemeName: context.definition.schemeName }),
      saveStatus: this.dirty ? "Есть несохранённые изменения" : "Изменения применяются при следующем входе в эпизод"
    };
  }

  async _onRender(context, options) { await super._onRender(context, options); this.bindEvents(); }

  readDialogue() {
    const draft = clone(this.draft), root = this.element;
    draft.name = value(root, "dialogueName").trim();
    if (!draft.name) throw new Error("Укажите название диалога.");
    draft.enabled = checked(root, "dialogueEnabled");
    const [type, id] = value(root, "dialogueTarget").split(":");
    if (!["Token", "Tile"].includes(type) || !id) throw new Error("Выберите НИП или тайл для взаимодействия.");
    draft.target = { type, id };
    draft.range = requireNumber(value(root, "dialogueRange"), "Дальность взаимодействия", { min: 0 });
    draft.startNodeId = value(root, "dialogueStart");
    draft.trigger = readTriggerFields(root, "dialogue-trigger");
    const node = draft.nodes.find((entry) => entry.id === this.nodeId);
    if (node) {
      node.text = value(root, "nodeText");
      node.art = value(root, "nodeArt").trim();
      node.responses = [...root.querySelectorAll("[data-dialogue-response]")].map((row) => ({
        id: row.dataset.dialogueResponse,
        label: value(row, "responseLabel").trim(), nextNodeId: value(row, "responseNext"), eventName: value(row, "responseEvent").trim()
      }));
    }
    return draft;
  }

  async changeDraft(callback) {
    this.draft = this.readDialogue();
    callback(this.draft);
    this.dirty = true;
    return this.render({ force: true });
  }

  async handleAction(action, button) {
    if (this.controller.getContext().scene?.id !== this.sceneId) throw new Error("Вернитесь на сцену редактируемого диалога.");
    if (action === "saveDialogue") {
      await this.controller.saveDialogue(this.readDialogue(), this.episodeId, { sceneId: this.sceneId, expectedRevision: this.draftRevision });
      this.resetDraft();
      return this.render({ force: true });
    }
    if (action === "discard") { this.resetDraft(); return this.render({ force: true }); }
    if (action === "node") return this.changeDraft(() => { this.nodeId = button.dataset.nodeId; });
    if (action === "addNode") return this.changeDraft((draft) => {
      const node = { id: randomId(), text: "", art: "", responses: [] };
      draft.nodes.push(node);
      this.nodeId = node.id;
    });
    if (action === "deleteNode") {
      if (this.draft.nodes.length <= 1) throw new Error("В диалоге должна остаться хотя бы одна страница.");
      return this.changeDraft((draft) => {
        draft.nodes = draft.nodes.filter((entry) => entry.id !== this.nodeId);
        for (const node of draft.nodes) for (const response of node.responses) if (response.nextNodeId === this.nodeId) response.nextNodeId = "";
        if (draft.startNodeId === this.nodeId) draft.startNodeId = draft.nodes[0].id;
        this.nodeId = draft.nodes[0].id;
      });
    }
    if (action === "addResponse") return this.changeDraft((draft) => {
      draft.nodes.find((entry) => entry.id === this.nodeId).responses.push({ id: randomId(), label: "Ответ", nextNodeId: "", eventName: "" });
    });
    if (action === "deleteResponse") return this.changeDraft((draft) => {
      const node = draft.nodes.find((entry) => entry.id === this.nodeId);
      node.responses = node.responses.filter((entry) => entry.id !== button.dataset.responseId);
    });
  }
}
