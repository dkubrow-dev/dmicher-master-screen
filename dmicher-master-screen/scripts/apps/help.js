import { MODULE_ID } from "../model.js";
import { getRuntime } from "../store.js";
import { listAvailableInteractions } from "../interaction-access.js";
import { themedClasses, notifyError } from "../ui.js";
import { generics } from "../generics.js";
import { getScreenHelpContent } from "../help-content.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const HelpApplication = generics.help.createHelpApplication({
  id: "dmicher-master-screen-help", classes: themedClasses("ms-help"),
  title: () => String(game.i18n.lang).startsWith("ru") ? "Справка · Ширма мастера" : "Help · Master screen",
  getContent: getScreenHelpContent, initialPageId: "start"
});

export class InteractionApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-interaction"), position: { width: 420, height: "auto" },
    window: { title: "Взаимодействие", icon: "fa-solid fa-comments" } };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/interaction.hbs` } };
  constructor(controller, { sceneId, tokenId, sourceTokenId, targetType = "Token", groupId }) {
    super({ id: `dmicher-master-screen-interaction-${sceneId}-${groupId}-${targetType}-${tokenId}` });
    Object.assign(this, { controller, sceneId, tokenId, sourceTokenId, targetType, groupId });
  }
  async _prepareContext(options) {
    const context = await super._prepareContext(options), scene = game.scenes.get(this.sceneId);
    const token = this.targetType === "Token" ? scene?.tokens.get(this.tokenId) : scene?.tiles?.get(this.tokenId);
    const choices = scene?.id === globalThis.canvas?.scene?.id ? listAvailableInteractions(scene, { type: this.targetType, id: this.tokenId }, scene.tokens.get(this.sourceTokenId), game.user).filter((entry) => !this.groupId || entry.groupId === this.groupId) : [];
    return { ...context, name: token?.name, missing: !token,
      choices,
      characters: this.controller.getPlayerTokens().filter((entry) => game.user.isGM || entry.actor.testUserPermission(game.user, "OWNER"))
        .map((entry) => ({ id: entry.id, name: entry.name, selected: entry.id === this.sourceTokenId })) };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelector("select")?.addEventListener("change", (event) => { this.sourceTokenId = event.target.value; void this.render({ force: true }); });
    this.element.querySelectorAll("[data-interaction]").forEach((button) => button.addEventListener("click", () => {
      if (button.disabled) return;
      button.disabled = true;
      void Promise.resolve().then(() => {
        const scene = game.scenes.get(this.sceneId);
        const choice = context.choices[Number(button.dataset.interaction)];
        if (!choice || globalThis.canvas?.scene?.id !== this.sceneId || getRuntime(scene, { groupId: choice.groupId }).runId !== choice.runId) {
          throw new Error("Сцена или состояние изменились. Откройте взаимодействие заново.");
        }
        const actorTokenId = this.element.querySelector("select").value;
        const target = { type: this.targetType, id: this.tokenId };
        if (choice.kind === "shop") return this.controller.openShop(target, { actorTokenId, groupId: choice.groupId });
        if (choice.kind === "dialogue") return this.controller.openDialogue(choice.id, actorTokenId, { groupId: choice.groupId, target });
        return this.controller.requestNamedInteraction(choice.id, actorTokenId, { groupId: choice.groupId });
      }).then(() => this.close()).catch(notifyError).finally(() => { if (button.isConnected) button.disabled = false; });
    }));
  }
}
