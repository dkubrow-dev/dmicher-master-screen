import { message as localizedMessage } from "../localization.js";
import { themedClasses } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "dmicher-master-screen";
const expiredSession = (session) => session?.expired ?? (session?.status !== "pending" && Number.isFinite(session?.expiresAt) && session.expiresAt <= Date.now());

/** A GM overview of scene shops; session ownership and exchanges remain in the shop service. */
export class ShopsManagerApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  get title() { return localizedMessage("Магазины · Ширма мастера"); }
  static DEFAULT_OPTIONS = {
    id: "dmicher-master-screen-shops",
    classes: themedClasses("ms-shops-manager"),
    position: { width: 800, height: 640 },
    window: { icon: "fa-solid fa-shop", resizable: true }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/shops-manager.hbs` } };

  constructor(controller, options = {}) {
    super(options);
    this.controller = controller;
    this.events = null;
    this.sceneId = null;
  }

  refresh() { if (this.rendered) return this.render({ force: true }); }

  async _prepareContext(options) {
    const parent = await super._prepareContext(options);
    const context = this.controller.getContext();
    this.sceneId = context.scene?.id ?? null;
    if (!context.isGM || !context.scene) return { ...parent, unavailable: true };
    const shops = this.controller.shop.listSceneShops(context.scene).map((shop) => {
      const expiresAt = shop.session?.expiresAt;
      const expired = shop.expired === true || expiredSession(shop.session);
      return { ...shop,
        expired,
        occupied: Boolean(shop.session && !expired),
        status: !shop.enabled ? localizedMessage("Недоступен в текущем состоянии") : !shop.session ? localizedMessage("Свободен") : expired ? localizedMessage("Сессия истекла") : shop.session.status === "pending" ? localizedMessage("Ожидает решения мастера") : localizedMessage("Игрок составляет обмен"),
        expiresText: Number.isFinite(expiresAt) ? new Date(expiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "",
        pending: (shop.pending ?? []).map((request) => ({ ...request, actionable: request.status === "pending" && Boolean(request.messageId) })),
        issues: (shop.issues ?? []).map((request) => ({ ...request,
          statusLabel: request.status === "uncertain" ? localizedMessage("Нужна ручная сверка. Не повторяйте обмен автоматически.") : localizedMessage("Обмен выполняется. Дождитесь результата.") }))
      };
    });
    return { ...parent, sceneName: context.scene.name, shops, hasShops: shops.length > 0 };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.events?.abort();
    this.events = new this.element.ownerDocument.defaultView.AbortController();
    this.element.addEventListener("click", (event) => {
      const button = event.target.closest("[data-shop-manager-action]");
      if (!button || button.disabled) return;
      event.preventDefault();
      button.disabled = true;
      void this.handleAction(button.dataset.shopManagerAction, button.dataset).catch((error) => {
        console.error(`${MODULE_ID} | Shops manager`, error);
        ui.notifications.error(error.message ?? localizedMessage("Не удалось выполнить действие магазина."));
      }).finally(() => { if (button.isConnected) button.disabled = false; });
    }, { signal: this.events.signal });
  }

  async handleAction(action, data = {}) {
    const context = this.controller.getContext();
    if (!context.isGM) throw new Error(localizedMessage("Управление магазинами доступно мастеру."));
    if (action === "refresh") return this.refresh();
    if (!context.scene || context.scene.id !== this.sceneId) throw new Error(localizedMessage("Сцена изменилась. Обновите список магазинов."));
    // Re-read the session instead of trusting the rendered owner or actor fields.
    const shop = this.controller.shop.listSceneShops(context.scene).find((entry) => data.shopId ? entry.shopId === data.shopId : entry.tokenId === data.tokenId && (entry.groupId ?? "main") === (data.groupId ?? "main"));
    if (!shop) throw new Error(localizedMessage("Магазин больше недоступен."));
    if (action === "join" || action === "release") {
      const session = shop.session;
      if (!session || (session.id ?? session.sessionId) !== data.sessionId) throw new Error(localizedMessage("Сессия магазина изменилась. Обновите список."));
      if (action === "join") {
        if (shop.expired || expiredSession(session)) throw new Error(localizedMessage("Сессия магазина уже истекла."));
        return this.controller.openShop(shop.target ?? shop.tokenId, { groupId: shop.groupId ?? "main", shopId: shop.shopId, actorTokenId: session.actorTokenId, sessionId: session.id ?? session.sessionId, join: true });
      }
      await this.controller.shop.releaseSession({ sceneId: context.scene.id, groupId: shop.groupId ?? "main", tokenId: shop.tokenId, target: shop.target, shopId: shop.shopId, sessionId: session.id ?? session.sessionId });
    } else if (action === "approve" || action === "reject") {
      const request = (shop.pending ?? []).find((entry) => entry.messageId === data.messageId && entry.status === "pending");
      if (!request) throw new Error(localizedMessage("Предложение уже обработано или больше недоступно."));
      if (action === "approve") await this.controller.shop.approveTrade(request.messageId);
      else await this.controller.shop.rejectTrade(request.messageId);
    }
    return this.refresh();
  }

  async _onClose(options) {
    this.events?.abort();
    this.events = null;
    return super._onClose(options);
  }
}
