import { text as t } from "../localization.js";
import { ScreenFormApplication } from "./screen-form.js";
import { getDefinitions, getRuntimes } from "../store.js";
import { generics } from "../generics.js";
import { themedClasses } from "../ui.js";

const e = (value) => generics.utilities.escapeHTML(String(value ?? ""));

/** A local draft: dismissing the chooser does not change any group's state. */
export class StateChooserApplication extends ScreenFormApplication {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-state-chooser"), position: { width: 510, height: "auto" }, window: { resizable: true } };
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/object-tools.hbs", scrollable: [".ms-object-scroll"] } };
  constructor(controller, options = {}) { super(options); this.controller = controller; this.sceneId = controller.getContext().scene?.id; this.original = new Map(); }
  get title() { return t("Сменить состояние", "Change state"); }
  async _prepareContext() {
    const scene = this.controller.getContext().scene;
    if (scene?.id !== this.sceneId) throw new Error(t("Сцена изменилась. Откройте выбор заново.", "The scene changed. Reopen the chooser."));
    const states = getRuntimes(scene);
    const rows = getDefinitions(scene).map((group) => {
      const selected = states.find((state) => state.groupId === group.groupId)?.stateId ?? group.entryStateId;
      if (!this.original.has(group.groupId)) this.original.set(group.groupId, selected);
      return `<fieldset><legend>${e(group.symbol)} ${e(group.groupName)}</legend>${group.states.map((state) => `<label class="ms-check"><input type="radio" name="group-${e(group.groupId)}" value="${e(state.id)}"${state.id === selected ? " checked" : ""}>${e(state.name)}</label>`).join("")}</fieldset>`;
    }).join("");
    return { body: `<div class="ms-object-scroll">${rows || `<p>${t("На сцене нет групп.", "There are no groups on this scene.")}</p>`}</div><footer><button type="button" data-screen-action="cancel">${t("Отмена", "Cancel")}</button><button type="button" data-screen-action="save">${t("Сохранить", "Save")}</button></footer>` };
  }
  async _onRender(context, options) { await super._onRender(context, options); this.bindEvents(); }
  async handleAction(action) {
    if (action === "cancel") return this.close();
    if (action !== "save") return;
    if (this.controller.getContext().scene?.id !== this.sceneId) throw new Error(t("Сцена изменилась.", "The scene changed."));
    const changes = [];
    for (const [groupId, original] of this.original) {
      const stateId = [...this.element.querySelectorAll('input[type="radio"]:checked')].find((input) => input.name === `group-${groupId}`)?.value;
      if (stateId && stateId !== original) changes.push({ groupId, stateId });
    }
    await this.controller.changeStates(changes); this.dirty = false; return this.close();
  }
}
