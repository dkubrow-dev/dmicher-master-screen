import { message as localizedMessage } from "../localization.js";
import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";
import { dialogueObjectMessage, dialoguePlayerMessage } from "../dialogue-history.js";
import { dialogueMessages, captureDialogueScroll, restoreDialogueScroll, confirmDialogueClose } from "./dialogue-presentation.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** This window navigates text locally. It has no runtime, event bus, socket or permission-changing method. */
export class ManualDialogueApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  get title() { return localizedMessage("Ширма мастера · Ручной диалог"); }
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-dialogue", "ms-manual-dialogue"), position: { width: 660, height: 580 },
    window: { icon: "fa-solid fa-comments", resizable: true },
    actions: { answer: ManualDialogueApplication.answer, finish: ManualDialogueApplication.finish, leave: ManualDialogueApplication.leave }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/dialogue.hbs` } };
  constructor({ dialogue, sourceName, invitationId, gmPreview = false }, options = {}) {
    super({ ...options, id: `dmicher-master-screen-manual-dialogue-${invitationId ?? foundry.utils.randomID()}` });
    this.dialogue = structuredClone(dialogue); this.sourceName = sourceName; this.gmPreview = gmPreview;
    this.pageId = dialogue.startPageId; this.finished = false; this.signalId = "";
    this.session = { sessionId: invitationId ?? this.id, step: 0 };
    this.history = [];
    this.appendPage();
  }
  appendPage() {
    const page = this.dialogue.pages.find((entry) => entry.id === this.pageId);
    if (page) this.history.push(dialogueObjectMessage(this.session, page, this.dialogue, { name: this.sourceName }));
    if (!page?.responses?.length) this.finished = true;
  }
  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const page = this.dialogue.pages.find((entry) => entry.id === this.pageId);
    return { ...base, targetName: this.sourceName, title: this.dialogue.name, text: page?.text ?? "", art: page?.art ?? "",
      messages: dialogueMessages({ history: this.history }, this.finished ? [] : (page?.responses ?? []).map((response) => ({ ...response, pageId: this.pageId }))),
      responses: this.finished ? [] : (page?.responses ?? []).map((response) => ({ ...response, pageId: this.pageId })),
      finished: this.finished, canFinish: !this.finished, manual: true, gmPreview: this.gmPreview,
      signalId: this.gmPreview ? this.signalId : "" };
  }
  async _onRender(context, options) { await super._onRender(context, options); restoreDialogueScroll(this); }
  static answer(_event, button) {
    if (this.finished || button.dataset.pageId !== this.pageId) return;
    const page = this.dialogue.pages.find((entry) => entry.id === this.pageId);
    const response = page?.responses.find((entry) => entry.id === button.dataset.responseId);
    if (!response) return;
    if (response.nextPageId && !this.dialogue.pages.some((entry) => entry.id === response.nextPageId)) return;
    captureDialogueScroll(this);
    const character = game.user.character;
    this.history.push(dialoguePlayerMessage(this.session, response, { name: character?.name, actor: character, texture: character?.prototypeToken?.texture }, game.user));
    this.session.step++;
    if (response.nextPageId) {
      this.pageId = response.nextPageId;
      this.appendPage();
    } else { this.finished = true; this.signalId = response.signalId; }
    return this.render({ force: true });
  }
  static finish() { captureDialogueScroll(this); this.finished = true; return this.render({ force: true }); }
  static leave() { return this.close(); }
  async close(options = {}) {
    if (this.closeTask) return this.closeTask;
    this.closeTask = (async () => {
      if (!this.finished && !await confirmDialogueClose()) return;
      this.finished = true;
      return super.close(options);
    })().finally(() => { this.closeTask = null; });
    return this.closeTask;
  }
}
