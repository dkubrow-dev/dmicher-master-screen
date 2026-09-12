import { text as t } from "../localization.js";
import { MODULE_ID } from "../model.js";
import { getRuntime } from "../store.js";
import { getSceneObject } from "../scene-objects.js";
import { listAvailableInteractions } from "../interaction-access.js";
import { themedClasses, notifyError } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class InteractionApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-interaction"), position: { width: 420, height: "auto" },
    window: { icon: "fa-solid fa-comments" }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/interaction.hbs` } };

  constructor(controller, { sceneId, tokenId, sourceTokenId, targetType = "Token", groupId }) {
    super({ id: `dmicher-master-screen-interaction-${sceneId}-${groupId}-${targetType}-${tokenId}` });
    Object.assign(this, { controller, sceneId, tokenId, sourceTokenId, targetType, groupId });
  }

  get target() { return { type: this.targetType, id: this.tokenId }; }
  get title() { return t("Взаимодействие", "Interaction"); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options), scene = game.scenes.get(this.sceneId);
    const object = getSceneObject(scene, this.target);
    const choices = scene?.id === globalThis.canvas?.scene?.id
      ? listAvailableInteractions(scene, this.target, scene.tokens.get(this.sourceTokenId), game.user).filter((entry) => !this.groupId || entry.groupId === this.groupId)
      : [];
    return { ...context, name: object?.name ?? object?.label, missing: !object, choices,
      characters: this.controller.getPlayerTokens().filter((entry) => game.user.isGM || entry.actor.testUserPermission(game.user, "OWNER"))
        .map((entry) => ({ id: entry.id, name: entry.name, selected: entry.id === this.sourceTokenId })) };
  }

  async choose(choice, actorTokenId) {
    const scene = game.scenes.get(this.sceneId);
    if (!choice || globalThis.canvas?.scene?.id !== this.sceneId || getRuntime(scene, { groupId: choice.groupId }).runId !== choice.runId) {
      throw new Error(t("Сцена или состояние изменились. Откройте взаимодействие заново.", "The scene or state changed. Open the interaction again."));
    }
    if (choice.kind === "shop") return this.controller.openShop(this.target, { actorTokenId, groupId: choice.groupId, shopId: choice.id });
    if (choice.kind === "dialogue") return this.controller.openDialogue(choice.id, actorTokenId, { groupId: choice.groupId, target: this.target });
    return this.controller.requestNamedInteraction(choice.id, actorTokenId, { groupId: choice.groupId });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector("select")?.addEventListener("change", (event) => {
      this.sourceTokenId = event.target.value; void this.render({ force: true });
    });
    for (const button of this.element.querySelectorAll("[data-interaction]")) button.addEventListener("click", () => {
      if (button.disabled) return;
      button.disabled = true;
      const choice = context.choices[Number(button.dataset.interaction)];
      void this.choose(choice, this.element.querySelector("select").value)
        .then(() => this.close()).catch(notifyError)
        .finally(() => { if (button.isConnected) button.disabled = false; });
    });
  }
}
