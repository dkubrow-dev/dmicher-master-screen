import { themedClasses } from "../ui.js";
import { generics } from "../generics.js";
import { getDefinitions, getDefinition } from "../store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "dmicher-master-screen";
const all = (collection) => Array.from(collection?.values?.() ?? collection ?? []);

/** Read-only preparation catalog. Manual invitations never execute prepared scene actions. */
export class DialogueCatalogApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dmicher-master-screen-dialogue-catalog", classes: themedClasses("ms-dialogue-catalog"),
    position: { width: 830, height: 740 },
    window: { title: "Диалоги и действия · Ширма мастера", icon: "fa-solid fa-book-open", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/dialogue-catalog.hbs` } };

  constructor(controller, options = {}) {
    super(options);
    this.controller = controller;
    this.sceneId = null;
    this.schemeId = null;
    this.episodeId = null;
    this.dialogueId = null;
    this.nodeId = null;
    this.recipients = new Set();
    this.events = null;
  }

  refresh() { if (this.rendered) return this.render({ force: true }); }

  async _prepareContext(options) {
    const parent = await super._prepareContext(options), context = this.controller.getContext();
    if (!context.isGM || !context.scene) return { ...parent, missing: true };
    if (context.scene.id !== this.sceneId) {
      this.sceneId = context.scene.id;
      this.schemeId = context.definition.schemeId;
      this.episodeId = context.selectedEpisodeId ?? context.definition.episodes[0]?.id;
      this.dialogueId = null;
      this.nodeId = null;
    }
    const schemes = getDefinitions(context.scene);
    if (!schemes.some((entry) => entry.schemeId === this.schemeId)) this.schemeId = schemes[0]?.schemeId;
    const definition = getDefinition(context.scene, { schemeId: this.schemeId });
    const episode = definition.episodes.find((entry) => entry.id === this.episodeId) ?? definition.episodes[0];
    this.episodeId = episode?.id;
    const dialogues = episode?.dialogues ?? [];
    const dialogue = dialogues.find((entry) => entry.id === this.dialogueId) ?? dialogues[0];
    this.dialogueId = dialogue?.id ?? null;
    const node = dialogue?.nodes.find((entry) => entry.id === this.nodeId) ?? dialogue?.nodes.find((entry) => entry.id === dialogue.startNodeId) ?? dialogue?.nodes[0];
    this.nodeId = node?.id ?? null;
    const target = dialogue?.target?.type === "Token" ? context.scene.tokens.get(dialogue.target.id) : context.scene.tiles?.get(dialogue?.target?.id);
    const targetName = (target) => (target?.type === "Token" ? context.scene.tokens.get(target.id)?.name : context.scene.tiles?.get(target?.id)?.name) || target?.id || "Не выбран";
    return { ...parent, sceneName: context.scene.name, sceneId: this.sceneId,
      schemeId: this.schemeId, schemes, episodeId: this.episodeId, episodes: definition.episodes,
      dialogues: dialogues.map((entry) => ({ ...entry, selected: entry.id === this.dialogueId })),
      dialogue, targetName: targetName(dialogue?.target), node: node ? { ...node, art: node.art || target?.texture?.src || target?.actor?.img || "" } : node,
      nodes: (dialogue?.nodes ?? []).map((entry, index) => ({ id: entry.id, label: `${index + 1}. ${(entry.text || "Без текста").slice(0, 45)}` })),
      actions: (episode?.interactions ?? []).map((entry) => ({ ...entry, targetName: targetName(entry.target) })),
      subscriptions: episode?.subscriptions ?? [],
      players: all(game.users).filter((user) => [1, 2].includes(Number(user.role)) && !generics.chat.isManagedIdentityUser(user))
        .map((user) => ({ id: user.id, name: user.name, active: user.active, selected: this.recipients.has(user.id) }))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.events?.abort();
    this.events = new this.element.ownerDocument.defaultView.AbortController();
    const listeners = { signal: this.events.signal };
    this.element.addEventListener("change", (event) => {
      if (event.target.name === "catalogScheme") {
        this.schemeId = event.target.value; this.episodeId = null; this.dialogueId = null; this.nodeId = null;
        void this.refresh();
      } else if (event.target.name === "catalogEpisode") {
        this.episodeId = event.target.value;
        this.dialogueId = null; this.nodeId = null;
        void this.refresh();
      } else if (event.target.name === "catalogNode") { this.nodeId = event.target.value; void this.refresh(); }
      else if (event.target.name === "catalogRecipient") {
        if (event.target.checked) this.recipients.add(event.target.value); else this.recipients.delete(event.target.value);
      }
    }, listeners);
    this.element.addEventListener("click", (event) => {
      const button = event.target.closest("[data-catalog-action]");
      if (!button || button.disabled) return;
      event.preventDefault(); button.disabled = true;
      void this.handleAction(button.dataset.catalogAction, button.dataset).catch((error) => {
        console.error(MODULE_ID, error); ui.notifications.error(error.message);
      }).finally(() => { if (button.isConnected) button.disabled = false; });
    }, listeners);
  }

  async handleAction(action, data = {}) {
    const context = this.controller.getContext();
    if (!context.isGM || context.scene?.id !== this.sceneId) throw new Error("Сцена изменилась. Обновите каталог под учётной записью мастера.");
    if (action === "select") { this.dialogueId = data.dialogueId; this.nodeId = null; return this.refresh(); }
    if (!this.dialogueId || !this.episodeId) throw new Error("Выберите диалог.");
    const descriptor = { sceneId: this.sceneId, schemeId: this.schemeId, episodeId: this.episodeId, dialogueId: this.dialogueId };
    if (action === "self") return this.controller.dialogues.openManualDialogue(descriptor);
    if (action === "players") {
      if (!this.recipients.size) throw new Error("Выберите игроков для показа диалога.");
      await this.controller.dialogues.invitePlayers({ ...descriptor, userIds: [...this.recipients] });
      ui.notifications.info("Приглашение к ручному диалогу отправлено выбранным игрокам.");
    }
  }

  async _onClose(options) { this.events?.abort(); this.events = null; return super._onClose(options); }
}
