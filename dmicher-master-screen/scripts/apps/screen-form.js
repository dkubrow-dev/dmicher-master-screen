import { message as localizedMessage, text } from "../localization.js";
import { notifyError } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Shared form lifecycle, independent of scene preparation and gameplay services. */
export class ScreenFormApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  dirty = false;
  events = null;

  refresh() {
    if (this.refreshTask) {
      this.refreshAgain = true;
      return this.refreshTask;
    }
    if (!this.rendered || this.dirty && !this.captureRefreshDraft) return;
    // External updates share a render. A dirty form still needs fresh reference
    // lists; its capture hook preserves inputs and the original save revision.
    this.refreshTask = Promise.resolve().then(async () => {
      do {
        this.refreshAgain = false;
        if (!this.rendered || this.dirty && !this.captureRefreshDraft) break;
        this.refreshing = true;
        try { this.captureRefreshDraft?.(); await this.render({ force: true }); }
        finally { this.refreshing = false; }
      } while (this.refreshAgain);
    }).finally(() => {
      this.refreshTask = null;
      // A change can arrive after the loop exits but before this promise settles.
      // Drain that last request too; awaiting the old task includes its refresh.
      if (this.refreshAgain) return this.refresh();
    });
    return this.refreshTask;
  }

  resetDraft() { this.dirty = false; this.draft = null; }

  disableActionWhilePending(_action) { return true; }

  bindEvents() {
    this.events?.abort();
    const Controller = this.element.ownerDocument.defaultView.AbortController;
    this.events = new Controller();
    const options = { signal: this.events.signal };
    this.element.addEventListener("input", (event) => {
      if (this.onDraftInput?.(event) === false) return;
      this.dirty = true;
      if (this.refreshing) this.captureRefreshDraft?.();
      const status = this.element.querySelector("[data-save-status]");
      if (status) status.textContent = localizedMessage("Есть несохранённые изменения");
    }, options);
    this.element.addEventListener("keydown", (event) => {
      const graphNode = event.target.closest("g[data-screen-action]");
      if (!graphNode || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      void this.runAction(graphNode.dataset.screenAction, graphNode, event);
    }, options);
    this.element.addEventListener("click", (event) => {
      const button = event.target.closest("[data-screen-action]");
      if (!button || button.disabled) return;
      event.preventDefault();
      const disable = this.disableActionWhilePending(button.dataset.screenAction);
      if (disable) button.disabled = true;
      void this.runAction(button.dataset.screenAction, button, event)
        .finally(() => { if (disable && button.isConnected) button.disabled = false; });
    }, options);
    this.element.addEventListener("submit", (event) => {
      const action = event.target.dataset.screenForm;
      // Native embedded forms retain their submit contract; only our marked forms
      // route their submission through the screen's action handler.
      if (!action) return;
      event.preventDefault();
      void this.runAction(action, event.submitter, event);
    }, options);
    return options;
  }

  async runAction(action, target, event) {
    try { return await this.handleAction(action, target, event); }
    catch (error) { notifyError(error); }
  }

  async _onClose(options) {
    this.events?.abort();
    this.events = null;
    return super._onClose(options);
  }

  async mayDiscard() {
    if (!this.dirty) return true;
    return DialogV2.confirm({
      window: { title: localizedMessage("Несохранённые изменения") },
      content: `<p>${text("Продолжить и отменить несохранённые изменения в этом окне?", "Continue and discard unsaved changes in this window?")}</p>`,
      rejectClose: false
    });
  }
}
