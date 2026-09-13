import { message as localizedMessage } from "../localization.js";
import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";
import { validateDialogueAccess } from "../dialogues.js";
import { objectReferenceKey } from "../object-reference.js";
import { dialogueSessionIsLive } from "../interaction-session-model.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DialogueApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  get title() { return localizedMessage("Ширма мастера · Диалог"); }
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-dialogue"), position: { width: 660, height: 580 },
    window: { icon: "fa-solid fa-comments", resizable: true },
    actions: { answer: DialogueApplication.answer, leave: DialogueApplication.leave }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/dialogue.hbs` } };
  constructor(service, { sceneId, dialogueId, target, actorTokenId, groupId = "main", runId: requestedRunId, initialView }, options = {}) {
    const runId = requestedRunId ?? service.getContext(sceneId, dialogueId, groupId, target).runtime?.runId ?? "inactive";
    super({ ...options, id: `dmicher-master-screen-dialogue-${sceneId}-${groupId}-${runId}-${dialogueId}-${target?.type ?? ""}-${target?.id ?? ""}-${actorTokenId}` });
    Object.assign(this, { service, sceneId, dialogueId, target, actorTokenId, groupId });
    this.runId = runId;
    this.initialView = initialView === undefined ? undefined : structuredClone(initialView);
    this.busy = false; this.error = ""; this.closing = false;
  }
  checkedInitialView(view) {
    const current = this.service.getContext(this.sceneId, this.dialogueId, this.groupId, this.target, { sessionId: view?.sessionId });
    validateDialogueAccess({ ...current, descriptor: current.dialogue }, this.actorTokenId, game.user, this.runId);
    const session = Object.values(current.runtime?.dialogueSessions ?? {}).find((entry) => entry.sessionId === view?.sessionId);
    if (!session || !dialogueSessionIsLive(session) || !["active", "finished"].includes(session.status)
      || session.userId !== game.user.id || session.actorTokenId !== this.actorTokenId
      || session.actorId !== current.scene?.tokens?.get(this.actorTokenId)?.actor?.id
      || session.runId !== this.runId || session.groupId !== this.groupId || session.dialogueId !== this.dialogueId
      || objectReferenceKey(session.target) !== objectReferenceKey(this.target)
      || view.dialogueId !== this.dialogueId || view.actorTokenId !== this.actorTokenId
      || objectReferenceKey(view.target) !== objectReferenceKey(this.target)
      || view.nodeId !== session.nodeId || view.step !== session.step || view.status !== session.status) {
      throw new Error(localizedMessage("Разговор не найден или принадлежит другому игроку."));
    }
    return view;
  }
  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    if (!this.view && !this.error && !this.closing) {
      try {
        if (this.initialView !== undefined) {
          // A delivered session already owns its admission and quota. An invalid
          // envelope must fail closed instead of silently starting a new dialogue.
          this.view = this.checkedInitialView(this.initialView);
          this.initialView = undefined;
        } else {
          this.startPromise ??= this.service.requestStart({ sceneId: this.sceneId, dialogueId: this.dialogueId, target: this.target, actorTokenId: this.actorTokenId, groupId: this.groupId, runId: this.runId });
          this.view = await this.startPromise;
        }
        this.error = this.view.error ?? "";
        if (this.closing && this.view.sessionId) void this.service.leaveSession({ sceneId: this.sceneId, groupId: this.groupId, sessionId: this.view.sessionId }).catch(() => {});
      } catch (error) { this.error = error.message; }
    }
    const current = this.service.getContext(this.sceneId, this.dialogueId, this.groupId, this.target, { sessionId: this.view?.sessionId });
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
