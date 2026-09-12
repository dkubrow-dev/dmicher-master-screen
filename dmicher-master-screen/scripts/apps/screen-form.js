import { message as localizedMessage, text } from "../localization.js";
import { notifyError } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Shared form lifecycle, independent of scene preparation and gameplay services. */
export class ScreenFormApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  dirty = false;
  events = null;

  refresh() {
    if (this.rendered && !this.dirty) return this.render({ force: true });
  }

  resetDraft() { this.dirty = false; this.draft = null; }

  bindEvents() {
    this.events?.abort();
    const Controller = this.element.ownerDocument.defaultView.AbortController;
    this.events = new Controller();
    const options = { signal: this.events.signal };
    this.element.addEventListener("input", (event) => {
      if (this.onDraftInput?.(event) === false) return;
      this.dirty = true;
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
      button.disabled = true;
      void this.runAction(button.dataset.screenAction, button, event)
        .finally(() => { if (button.isConnected) button.disabled = false; });
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
