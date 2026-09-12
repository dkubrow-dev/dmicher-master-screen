import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** This window navigates text locally. It has no runtime, event bus, socket or permission-changing method. */
export class ManualDialogueApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-dialogue", "ms-manual-dialogue"), position: { width: 660, height: 580 },
    window: { title: "Ширма мастера · Ручной диалог", icon: "fa-solid fa-comments", resizable: true },
    actions: { answer: ManualDialogueApplication.answer, leave: ManualDialogueApplication.leave }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/manual-dialogue.hbs` } };
  constructor({ dialogue, sourceName, invitationId, gmPreview = false }, options = {}) {
    super({ ...options, id: `dmicher-master-screen-manual-dialogue-${invitationId ?? foundry.utils.randomID()}` });
    this.dialogue = structuredClone(dialogue); this.sourceName = sourceName; this.gmPreview = gmPreview;
    this.nodeId = dialogue.startNodeId; this.finished = false; this.signalId = "";
  }
  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const node = this.dialogue.nodes.find((entry) => entry.id === this.nodeId);
    return { ...base, targetName: this.sourceName, title: this.dialogue.name, text: node?.text ?? "", art: node?.art ?? "",
      responses: this.finished ? [] : (node?.responses ?? []).map((response) => ({ ...response, nodeId: this.nodeId })),
      finished: this.finished || !node?.responses?.length, gmPreview: this.gmPreview,
      signalId: this.gmPreview ? this.signalId : "" };
  }
  static answer(_event, button) {
    if (this.finished || button.dataset.nodeId !== this.nodeId) return;
    const node = this.dialogue.nodes.find((entry) => entry.id === this.nodeId);
    const response = node?.responses.find((entry) => entry.id === button.dataset.responseId);
    if (!response) return;
    if (response.nextNodeId) {
      if (!this.dialogue.nodes.some((entry) => entry.id === response.nextNodeId)) return;
      this.nodeId = response.nextNodeId;
    } else { this.finished = true; this.signalId = response.signalId; }
    return this.render({ force: true });
  }
  static leave() { return this.close(); }
}
