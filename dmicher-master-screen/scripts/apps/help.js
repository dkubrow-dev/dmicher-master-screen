import { MODULE_ID } from "../model.js";
import { getRuntime } from "../store.js";
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
  constructor(controller, { sceneId, tokenId, sourceTokenId, targetType = "Token" }) {
    super(); this.controller = controller; this.sceneId = sceneId; this.tokenId = tokenId; this.sourceTokenId = sourceTokenId; this.targetType = targetType;
  }
  async _prepareContext(options) {
    const context = await super._prepareContext(options), scene = game.scenes.get(this.sceneId);
    const state = getRuntime(scene), token = this.targetType === "Token" ? scene?.tokens.get(this.tokenId) : scene?.tiles?.get(this.tokenId);
    const choices = this.controller.getInteractions(this.targetType, this.tokenId), config = choices.behavior;
    const available = scene?.id === globalThis.canvas?.scene?.id && Boolean(token) && !state.episode?.stop
      && Boolean(config?.shop.enabled || config?.interaction.targetEpisodeId || choices.dialogues.length || choices.actions.length);
    return { ...context, name: token?.name, missing: !available, runId: state.runId,
      shop: available && config?.shop.enabled, label: config?.interaction.label || "Взаимодействовать",
      transition: available && Boolean(config?.interaction.targetEpisodeId),
      dialogues: available ? choices.dialogues : [], actions: available ? choices.actions : [],
      characters: this.controller.getPlayerTokens().filter((entry) => game.user.isGM || entry.actor.testUserPermission(game.user, "OWNER"))
        .map((entry) => ({ id: entry.id, name: entry.name, selected: entry.id === this.sourceTokenId })) };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.querySelectorAll("[data-interaction]").forEach((button) => button.addEventListener("click", () => {
      if (button.disabled) return;
      button.disabled = true;
      void Promise.resolve().then(() => {
        const scene = game.scenes.get(this.sceneId);
        if (globalThis.canvas?.scene?.id !== this.sceneId || getRuntime(scene).runId !== context.runId) {
          throw new Error("Сцена или эпизод изменились. Откройте взаимодействие заново.");
        }
        const actorTokenId = this.element.querySelector("select").value;
        if (button.dataset.interaction === "shop") return this.controller.openShop(this.tokenId, { actorTokenId });
        if (button.dataset.interaction === "dialogue") return this.controller.openDialogue(button.dataset.dialogueId, actorTokenId);
        if (button.dataset.interaction === "event") return this.controller.requestNamedInteraction(button.dataset.interactionId, actorTokenId);
        return this.controller.triggerInteraction(this.tokenId, actorTokenId);
      }).then(() => this.close()).catch(notifyError).finally(() => { if (button.isConnected) button.disabled = false; });
    }));
  }
}
