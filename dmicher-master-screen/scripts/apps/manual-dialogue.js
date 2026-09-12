import { message as localizedMessage } from "../localization.js";
import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** This window navigates text locally. It has no runtime, event bus, socket or permission-changing method. */
export class ManualDialogueApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  get title() { return localizedMessage("Ширма мастера · Ручной диалог"); }
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-dialogue", "ms-manual-dialogue"), position: { width: 660, height: 580 },
    window: { icon: "fa-solid fa-comments", resizable: true },
    actions: { answer: ManualDialogueApplication.answer, leave: ManualDialogueApplication.leave }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/manual-dialogue.hbs` } };
  constructor({ dialogue, sourceName, invitationId, gmPreview = false }, options = {}) {
    super({ ...options, id: `dmicher-master-screen-manual-dialogue-${invitationId ?? foundry.utils.randomID()}` });
    this.dialogue = structuredClone(dialogue); this.sourceName = sourceName; this.gmPreview = gmPreview;
    this.pageId = dialogue.startPageId; this.finished = false; this.signalId = "";
  }
  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const page = this.dialogue.pages.find((entry) => entry.id === this.pageId);
    return { ...base, targetName: this.sourceName, title: this.dialogue.name, text: page?.text ?? "", art: page?.art ?? "",
      responses: this.finished ? [] : (page?.responses ?? []).map((response) => ({ ...response, pageId: this.pageId })),
      finished: this.finished || !page?.responses?.length, gmPreview: this.gmPreview,
      signalId: this.gmPreview ? this.signalId : "" };
  }
  static answer(_event, button) {
    if (this.finished || button.dataset.pageId !== this.pageId) return;
    const page = this.dialogue.pages.find((entry) => entry.id === this.pageId);
    const response = page?.responses.find((entry) => entry.id === button.dataset.responseId);
    if (!response) return;
    if (response.nextPageId) {
      if (!this.dialogue.pages.some((entry) => entry.id === response.nextPageId)) return;
      this.pageId = response.nextPageId;
    } else { this.finished = true; this.signalId = response.signalId; }
    return this.render({ force: true });
  }
  static leave() { return this.close(); }
}
