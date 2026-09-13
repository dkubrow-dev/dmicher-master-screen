import { message as localizedMessage } from "../localization.js";
import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";
import { validateDialogueAccess } from "../dialogues.js";
import { objectReferenceKey } from "../object-reference.js";
import { dialogueSessionIsPresent } from "../interaction-session-model.js";
import { dialogueMessages, captureDialogueScroll, restoreDialogueScroll, confirmDialogueClose } from "./dialogue-presentation.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class DialogueApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  get title() { return localizedMessage("Ширма мастера · Диалог"); }
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-dialogue"), position: { width: 660, height: 580 },
    window: { icon: "fa-solid fa-comments", resizable: true },
    actions: { answer: DialogueApplication.answer, finish: DialogueApplication.finish, leave: DialogueApplication.leave }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/dialogue.hbs` } };
  constructor(service, { sceneId, dialogueId, target, actorTokenId, listenerTokenId, groupId = "main", runId: requestedRunId, initialView }, options = {}) {
    const runId = requestedRunId ?? service.getContext(sceneId, dialogueId, groupId, target).runtime?.runId ?? "inactive";
    super({ ...options, id: `dmicher-master-screen-dialogue-${sceneId}-${groupId}-${runId}-${dialogueId}-${target?.type ?? ""}-${target?.id ?? ""}-${actorTokenId}${listenerTokenId ? `-listener-${listenerTokenId}` : ""}` });
    Object.assign(this, { service, sceneId, dialogueId, target, actorTokenId, listenerTokenId, groupId });
    this.runId = runId;
    this.initialView = initialView === undefined ? undefined : structuredClone(initialView);
    this.busy = false; this.error = ""; this.closing = false;
    this.viewGeneration = 0;
    this.unavailable = false;
  }
  get isListener() { return this.view?.role === "listener"; }
  get isFinished() { return ["finished", "left"].includes(this.view?.status); }
  command() { return { sceneId: this.sceneId, groupId: this.groupId, sessionId: this.view?.sessionId, target: this.target,
    ...(this.listenerTokenId ? { listenerTokenId: this.listenerTokenId } : {}) }; }
  checkedInitialView(view) {
    const current = this.service.getContext(this.sceneId, this.dialogueId, this.groupId, this.target, { sessionId: view?.sessionId });
    if (view?.status !== "finished") validateDialogueAccess({ ...current, descriptor: current.dialogue }, this.actorTokenId, game.user, this.runId);
    const session = Object.values(current.runtime?.dialogueSessions ?? {}).find((entry) => entry.sessionId === view?.sessionId);
    if (!session || !dialogueSessionIsPresent(session) || !["active", "finished"].includes(session.status)
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
    if (!this.view && !this.error && !this.closing && !this.unavailable) {
      try {
        if (this.initialView !== undefined) {
          // A delivered session already owns its admission and quota. An invalid
          // envelope must fail closed instead of silently starting a new dialogue.
          this.view = this.initialView?.role === "listener"
            ? await this.service.refreshSession({ ...this.command(), sessionId: this.initialView.sessionId })
            : this.checkedInitialView(this.initialView);
          this.unavailable = !this.view;
          this.initialView = undefined;
        } else {
          this.startPromise ??= this.service.requestStart({ sceneId: this.sceneId, dialogueId: this.dialogueId, target: this.target, actorTokenId: this.actorTokenId, groupId: this.groupId, runId: this.runId });
          this.view = await this.startPromise;
        }
        this.error = this.view?.error ?? "";
        if (this.closing && this.view?.sessionId) void this.service.leaveSession(this.command()).catch(() => {});
      } catch (error) { this.error = error.message; }
    }
    const current = this.service.getContext(this.sceneId, this.dialogueId, this.groupId, this.target, { sessionId: this.view?.sessionId });
    let unavailable = "";
    if (!this.isListener && !this.isFinished && !this.unavailable) try {
      validateDialogueAccess({ ...current, descriptor: current.dialogue }, this.actorTokenId, game.user, this.runId);
    } catch (error) { unavailable = error.message; }
    const responses = unavailable || this.unavailable || this.isListener || this.view?.status !== "active" ? []
      : (this.view?.responses ?? []).map((response) => ({ ...response, disabled: this.busy }));
    const messages = dialogueMessages(this.view, responses);
    return { ...base, ...this.view, busy: this.busy, error: this.error || unavailable,
      messages, responses, listener: this.isListener, unavailable: this.unavailable,
      canFinish: Boolean(this.view) && !this.unavailable && !this.isListener && !this.isFinished,
      finished: this.isFinished, missing: !this.view };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    restoreDialogueScroll(this);
    if (this.view?.status !== "active" || this.error || this.unavailable) { clearInterval(this.leaseTimer); this.leaseTimer = null; return; }
    this.leaseTimer ??= setInterval(() => {
      if (!this.rendered || this.closing || this.view?.status !== "active") return;
      void this.service.renewSession(this.command())
        .catch((error) => { this.error = error.message; clearInterval(this.leaseTimer); this.leaseTimer = null; if (this.rendered) this.render({ force: true }); });
    }, 30_000);
    this.leaseTimer.unref?.();
  }
  static async answer(_event, button) {
    if (this.busy || this.closing || this.unavailable || this.isListener || this.view?.status !== "active") return;
    const request = { ...this.command(), responseId: button.dataset.responseId,
      nodeId: this.view.nodeId, step: this.view.step };
    return this.perform(() => this.service.requestAnswer(request));
  }
  static async finish() {
    if (this.busy || this.closing || this.unavailable || this.isListener || this.isFinished || !this.view?.sessionId) return;
    return this.perform(() => this.service.requestFinish(this.command()));
  }
  captureScroll() { captureDialogueScroll(this); }
  async perform(operation) {
    this.captureScroll(); this.busy = true; this.viewGeneration++;
    void this.render({ force: true });
    try { this.view = { ...this.view, ...await operation() }; this.error = this.view.error ?? ""; }
    catch (error) { this.error = error.message; }
    finally {
      this.busy = false;
      if (this.rendered && !this.closing) await this.render({ force: true });
      if (this.refreshAgain) { this.refreshAgain = false; await this.refresh(); }
    }
  }
  static leave() { return this.close(); }
  async refresh() {
    if (!this.rendered || this.closing || !this.view?.sessionId) return;
    if (this.busy) { this.refreshAgain = true; return; }
    if (this.refreshTask) { this.refreshAgain = true; return this.refreshTask; }
    this.refreshTask = (async () => {
      do {
        this.refreshAgain = false;
        const generation = this.viewGeneration;
        try {
          const view = await this.service.refreshSession(this.command());
          if (this.closing || this.busy || generation !== this.viewGeneration || !this.rendered) continue;
          if (!view) {
            if (this.isFinished) continue;
            if (this.unavailable) continue;
            this.captureScroll(); this.unavailable = true; this.error = "";
          } else {
            if (JSON.stringify(view) === JSON.stringify(this.view) && !this.error && !this.unavailable) continue;
            this.captureScroll(); this.view = view; this.error = view.error ?? ""; this.unavailable = false;
          }
          await this.render({ force: true });
        } catch (error) {
          if (this.closing || this.busy || generation !== this.viewGeneration || !this.rendered || this.isFinished) continue;
          if (this.error !== error.message) { this.captureScroll(); this.error = error.message; await this.render({ force: true }); }
        }
      } while (this.refreshAgain && this.rendered && !this.closing && !this.busy);
    })().finally(() => {
      this.refreshTask = null;
      // A request may arrive after the loop ends but before promise cleanup.
      if (this.refreshAgain && this.rendered && !this.closing && !this.busy) return this.refresh();
    });
    return this.refreshTask;
  }
  async close(options = {}) {
    if (this.closing) return;
    if (this.closeTask) return this.closeTask;
    this.closeTask = this.closeConfirmed(options).finally(() => { this.closeTask = null; });
    return this.closeTask;
  }
  async closeConfirmed(options) {
    if (this.view?.sessionId && !this.unavailable && !this.isListener && !this.isFinished) {
      const confirmed = await confirmDialogueClose();
      if (!confirmed) return;
    }
    this.closing = true;
    this.viewGeneration++;
    clearInterval(this.leaseTimer); this.leaseTimer = null;
    if (this.view?.sessionId) {
      // Closing remains possible while the authority is disconnected; its lease
      // still bounds the lifetime of an unacknowledged departure.
      void this.service.leaveSession(this.command()).catch(() => {});
    }
    return super.close(options);
  }
}
