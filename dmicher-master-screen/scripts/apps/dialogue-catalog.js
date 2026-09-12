import { message as localizedMessage } from "../localization.js";
import { themedClasses } from "../ui.js";
import { generics } from "../generics.js";
import { SceneAssets } from "../scene-assets.js";
import { getSceneObject } from "../scene-objects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "dmicher-master-screen";
const all = (collection) => Array.from(collection?.values?.() ?? collection ?? []);

/** Read-only preparation catalog. Manual invitations never execute prepared scene actions. */
export class DialogueCatalogApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  get title() { return localizedMessage("Диалоги и действия · Ширма мастера"); }
  static DEFAULT_OPTIONS = {
    id: "dmicher-master-screen-dialogue-catalog", classes: themedClasses("ms-dialogue-catalog"),
    position: { width: 830, height: 740 },
    window: { icon: "fa-solid fa-book-open", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/dialogue-catalog.hbs` } };

  constructor(controller, options = {}) {
    super(options);
    this.controller = controller;
    this.sceneId = null;
    this.dialogueId = null;
    this.pageId = null;
    this.recipients = new Set();
    this.events = null;
  }

  refresh() { if (this.rendered) return this.render({ force: true }); }

  async _prepareContext(options) {
    const parent = await super._prepareContext(options), context = this.controller.getContext();
    if (!context.isGM || !context.scene) return { ...parent, missing: true };
    if (context.scene.id !== this.sceneId) {
      this.sceneId = context.scene.id;
      this.dialogueId = null;
      this.pageId = null;
    }
    const dialogues = new SceneAssets(context.scene).list().dialogues;
    const dialogue = dialogues.find((entry) => entry.id === this.dialogueId) ?? dialogues[0];
    this.dialogueId = dialogue?.id ?? null;
    const page = dialogue?.pages.find((entry) => entry.id === this.pageId) ?? dialogue?.pages.find((entry) => entry.id === dialogue.startPageId) ?? dialogue?.pages[0];
    this.pageId = page?.id ?? null;
    return { ...parent, sceneName: context.scene.name, sceneId: this.sceneId,
      dialogues: dialogues.map((entry) => ({ ...entry, selected: entry.id === this.dialogueId })),
      dialogue: dialogue ? { ...dialogue, enabled: true } : null,
      page: page ?? null,
      pages: (dialogue?.pages ?? []).map((entry) => ({ id: entry.id, label: entry.name })),
      actions: (context.state?.interactions ?? []).map((entry) => ({ ...entry, targetName: getSceneObject(context.scene, entry.target)?.name ?? entry.target.id })),
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
      if (event.target.name === "catalogPage") { this.pageId = event.target.value; void this.refresh(); }
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
    if (!context.isGM || context.scene?.id !== this.sceneId) throw new Error(localizedMessage("Сцена изменилась. Обновите каталог под учётной записью мастера."));
    if (action === "select") { this.dialogueId = data.dialogueId; this.pageId = null; return this.refresh(); }
    if (!this.dialogueId) throw new Error(localizedMessage("Выберите диалог."));
    const descriptor = { sceneId: this.sceneId, dialogueId: this.dialogueId, pageId: this.pageId };
    if (action === "self") return this.controller.dialogues.openManualDialogue(descriptor);
    if (action === "players") {
      if (!this.recipients.size) throw new Error(localizedMessage("Выберите игроков для показа диалога."));
      await this.controller.dialogues.invitePlayers({ ...descriptor, userIds: [...this.recipients] });
      ui.notifications.info(localizedMessage("Приглашение к ручному диалогу отправлено выбранным игрокам."));
    }
  }

  async _onClose(options) { this.events?.abort(); this.events = null; return super._onClose(options); }
}
