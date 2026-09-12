import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";
import { validateDialogueAccess } from "../dialogues.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DialogueApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-dialogue"), position: { width: 660, height: 580 },
    window: { title: "Ширма мастера · Диалог", icon: "fa-solid fa-comments", resizable: true },
    actions: { answer: DialogueApplication.answer, leave: DialogueApplication.leave }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/dialogue.hbs` } };
  constructor(service, { sceneId, dialogueId, target, actorTokenId, groupId = "main" }, options = {}) {
    const runId = service.getContext(sceneId, dialogueId, groupId, target).runtime?.runId ?? "inactive";
    super({ ...options, id: `dmicher-master-screen-dialogue-${sceneId}-${groupId}-${runId}-${dialogueId}-${target?.type ?? ""}-${target?.id ?? ""}-${actorTokenId}` });
    Object.assign(this, { service, sceneId, dialogueId, target, actorTokenId, groupId });
    this.runId = runId;
    this.busy = false; this.error = ""; this.closing = false;
  }
  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    if (!this.view && !this.error && !this.closing) {
      try {
        this.startPromise ??= this.service.requestStart({ sceneId: this.sceneId, dialogueId: this.dialogueId, target: this.target, actorTokenId: this.actorTokenId, groupId: this.groupId, runId: this.runId });
        this.view = await this.startPromise;
        this.error = this.view.error ?? "";
        if (this.closing && this.view.sessionId) void this.service.leaveSession({ sceneId: this.sceneId, groupId: this.groupId, sessionId: this.view.sessionId }).catch(() => {});
      } catch (error) { this.error = error.message; }
    }
    const current = this.service.getContext(this.sceneId, this.dialogueId, this.groupId, this.target);
    let unavailable = "";
    try {
      validateDialogueAccess({ ...current, descriptor: current.dialogue }, this.actorTokenId, game.user, this.runId);
    } catch (error) { unavailable = error.message; }
    return { ...base, ...this.view, busy: this.busy, error: this.error || unavailable,
      responses: unavailable || this.view?.status !== "active" ? [] : (this.view?.responses ?? []).map((response) => ({ ...response, disabled: this.busy })),
      finished: this.view?.status === "finished", missing: !this.view };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!["active", "finished"].includes(this.view?.status) || this.error) { clearInterval(this.leaseTimer); this.leaseTimer = null; return; }
    this.leaseTimer ??= setInterval(() => {
      if (!this.rendered || this.closing || !["active", "finished"].includes(this.view?.status)) return;
      void this.service.renewSession({ sceneId: this.sceneId, groupId: this.groupId, sessionId: this.view.sessionId, target: this.target })
        .catch((error) => { this.error = error.message; clearInterval(this.leaseTimer); this.leaseTimer = null; if (this.rendered) this.render({ force: true }); });
    }, 30_000);
    this.leaseTimer.unref?.();
  }
  static async answer(_event, button) {
    if (this.busy || this.closing || this.view?.status !== "active") return;
    this.busy = true;
    const request = { sceneId: this.sceneId, groupId: this.groupId, target: this.target, sessionId: this.view.sessionId, responseId: button.dataset.responseId,
      nodeId: this.view.nodeId, step: this.view.step };
    this.render({ force: true });
    try { this.view = await this.service.requestAnswer(request); this.error = this.view.error ?? ""; }
    catch (error) { this.error = error.message; }
    finally { this.busy = false; if (this.rendered && !this.closing) this.render({ force: true }); }
  }
  static leave() { return this.close(); }
  refresh() { if (this.rendered && !this.closing) return this.render({ force: true }); }
  async close(options = {}) {
    this.closing = true;
    clearInterval(this.leaseTimer); this.leaseTimer = null;
    if (this.view?.sessionId) {
      // The local Leave button must work even while the GM is disconnected.
      void this.service.leaveSession({ sceneId: this.sceneId, groupId: this.groupId, sessionId: this.view.sessionId }).catch(() => {});
    }
    return super.close(options);
  }
}
