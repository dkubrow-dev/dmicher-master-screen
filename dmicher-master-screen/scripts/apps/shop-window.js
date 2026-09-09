import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";
import { asArray } from "../store.js";
import { shopEntries, validateTradeContext, shopKey } from "../shop.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const clone = (value) => structuredClone(value);
const newId = () => foundry.utils.randomID();

export class ShopApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: themedClasses("ms-shop"), position: { width: 920, height: 760 },
    window: { title: "Ширма мастера · Магазин", icon: "fa-solid fa-store", resizable: true },
    actions: { addTake: ShopApplication.addTake, removeTake: ShopApplication.removeTake,
      addGive: ShopApplication.addGive, removeGive: ShopApplication.removeGive,
      confirm: ShopApplication.confirm, display: ShopApplication.display, refresh: ShopApplication.refresh,
      newOffer: ShopApplication.newOffer, sheet: ShopApplication.sheet }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/shop.hbs` } };
  constructor(controller, { sceneId, tokenId, target, actorTokenId, schemeId = "main", sessionId = null, join = false }, options = {}) {
    const source = target ?? { type: "Token", id: tokenId };
    const current = controller.shop.getContext(sceneId, source, schemeId), runId = current.runtime?.runId ?? "inactive";
    super({ ...options, id: `dmicher-master-screen-shop-${sceneId}-${schemeId}-${runId}-${source.type}-${source.id}-${actorTokenId}-${sessionId ?? "own"}` });
    Object.assign(this, { controller, sceneId, tokenId: source.id, target: source, shopId: shopKey(current) ?? source.id, actorTokenId, schemeId, sessionId, join });
    this.runId = runId;
    this.requestId = newId(); this.draft = { giveItemIds: [], take: [] };
    this.feedback = ""; this.busy = false; this.pending = false; this.finished = false;
  }
  intent(extra = {}) {
    return { sceneId: this.sceneId, tokenId: this.tokenId, target: this.target, shopId: this.shopId, actorTokenId: this.actorTokenId, schemeId: this.schemeId,
      sessionId: this.sessionId, runId: this.runId, requestId: this.requestId, ...extra };
  }
  async ensureSession() {
    if (this.session || this.sessionError || this.finished) return;
    if (this.join) {
      const current = this.controller.shop.getContext(this.sceneId, this.target, this.schemeId).runtime?.shopSessions?.[this.shopId];
      if (!current || current.sessionId !== this.sessionId) throw new Error("Сессия участника уже завершилась.");
      this.session = current; this.readOnly = current.userId !== game.user.id;
    } else {
      this.sessionPromise ??= this.controller.shop.requestSession(this.intent());
      this.session = await this.sessionPromise;
      this.sessionPromise = null;
    }
    this.sessionId = this.session.sessionId; this.runId = this.session.runId;
    this.actorTokenId = this.session.actorTokenId; this.draft = clone(this.session.draft);
    this.revision = this.session.revision ?? 0;
  }
  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    let unavailable = "", actor;
    try { await this.ensureSession(); } catch (error) { this.sessionError = error.message; }
    const current = this.controller.shop.getContext(this.sceneId, this.target, this.schemeId);
    const receipt = Object.values(current.runtime?.tradeRequests ?? {}).find((record) => record.intent?.sessionId === this.sessionId
      && (record.intent.requestId === this.requestId || record.status === "pending"));
    if (receipt) {
      this.requestId = receipt.intent.requestId;
      this.pending = ["pending", "processing", "uncertain"].includes(receipt.status);
      this.finished = ["done", "rejected", "failed"].includes(receipt.status);
      this.feedback = ({ pending: "Предложение ожидает решения мастера.", processing: "Обмен выполняется.",
        uncertain: "Обмен требует ручной сверки мастером. Не отправляйте его повторно.", done: "Обмен выполнен.",
        rejected: "Предложение отклонено.", failed: "Обмен отменён." })[receipt.status] + (receipt.error ? ` ${receipt.error}` : "");
      if (receipt.status === "done") this.draft = { giveItemIds: [], take: [] };
    }
    if (!receipt && this.messageId) {
      const result = game.messages.get(this.messageId)?.getFlag(MODULE_ID, "tradeResult");
      if (["rejected", "failed"].includes(result)) {
        this.pending = false; this.finished = true; this.feedback = "Предложение отклонено. Причина указана в чате.";
      }
    }
    const live = current.runtime?.shopSessions?.[this.shopId];
    if (this.readOnly && live?.sessionId === this.sessionId) this.draft = clone(live.draft);
    try { actor = validateTradeContext(current, this.intent(), game.user); }
    catch (error) { unavailable = error.message; }
    unavailable ||= this.sessionError ?? "";
    const locked = Boolean(this.readOnly || this.busy || this.pending || this.finished || unavailable);
    const entries = unavailable ? [] : shopEntries(current);
    const inventory = asArray(actor?.items);
    const describe = (entry) => ({ id: entry.id, name: entry.data.name, img: entry.data.img || "icons/svg/item-bag.svg",
      category: game.i18n.localize(CONFIG.Item?.typeLabels?.[entry.data.type] ?? entry.data.type), stock: entry.stock,
      unavailable: locked || entry.stock <= (this.draft.take.find((item) => item.entryId === entry.id)?.count ?? 0) });
    const groups = new Map();
    for (const entry of entries.map(describe)) {
      if (!groups.has(entry.category)) groups.set(entry.category, []);
      groups.get(entry.category).push(entry);
    }
    this.view ??= current.behavior?.shop?.display ?? "list";
    return { ...base, unavailable, feedback: this.feedback, locked, finished: this.finished && !this.readOnly,
      readOnly: this.readOnly, npcName: unavailable ? "Взаимодействие недоступно" : current.asset?.name || current.token?.name,
      npcImg: unavailable ? null : current.asset?.img || current.token?.texture?.src || current.token?.actor?.img,
      actorName: actor?.name, ownerName: game.users.get(this.session?.userId)?.name,
      needsApproval: current.behavior?.shop?.requireGMApproval !== false,
      groups: [...groups].map(([name, items]) => ({ name, items })), tiles: this.view === "tiles",
      offeredGive: this.draft.giveItemIds.map((itemId) => { const item = inventory.find((item) => item.id === itemId);
        return { id: itemId, name: item?.name ?? "Предмет уже отсутствует", img: item?.img || "icons/svg/hazard.svg", locked }; }),
      offeredTake: this.draft.take.map(({ entryId, count }) => {
        const entry = entries.find((entry) => entry.id === entryId);
        return { id: entryId, name: entry?.data?.name ?? "Предмет уже отсутствует", img: entry?.data?.img || "icons/svg/hazard.svg", count, locked };
      }),
      inventory: inventory.filter((item) => !this.draft.giveItemIds.includes(item.id)).map((item) => ({ id: item.id,
        name: item.name, img: item.img || "icons/svg/item-bag.svg", locked })),
      confirmDisabled: locked || (!this.draft.giveItemIds.length && !this.draft.take.length) };
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.listeners?.abort();
    this.listeners = new this.element.ownerDocument.defaultView.AbortController();
    for (const node of this.element.querySelectorAll("[data-stock-drag]")) node.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", JSON.stringify({ type: "MasterScreenStock", entryId: node.dataset.stockDrag, tokenId: this.tokenId, sceneId: this.sceneId, schemeId: this.schemeId }));
    }, { signal: this.listeners.signal });
    for (const area of this.element.querySelectorAll("[data-offer-drop]")) {
      area.addEventListener("dragover", (event) => event.preventDefault(), { signal: this.listeners.signal });
      area.addEventListener("drop", (event) => { event.preventDefault(); void this.drop(event, area.dataset.offerDrop); }, { signal: this.listeners.signal });
    }
    if (!this.heartbeat) this.heartbeat = setInterval(() => {
      if (!this.sessionId || this.readOnly || this.finished || this.pending || this.busy) return;
      void this.controller.shop.renewSession(this.intent()).catch((error) => {
        this.sessionError = error.message; if (this.rendered) this.render({ force: true });
      });
    }, 30_000);
    if (!this.statusTimer) this.statusTimer = setInterval(() => {
      if (this.rendered && (this.pending || this.readOnly)) this.render({ force: true });
    }, 2000);
  }
  async drop(event, side) {
    try {
      const data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}");
      if (side === "npc" && data.type === "MasterScreenStock" && data.tokenId === this.tokenId && data.sceneId === this.sceneId && data.schemeId === this.schemeId) {
        return this.edit((draft) => { const item = draft.take.find((item) => item.entryId === data.entryId);
          if (item) item.count++; else draft.take.push({ entryId: data.entryId, count: 1 }); });
      }
      if (side !== "player" || data.type !== "Item" || typeof data.uuid !== "string") throw new Error("Перенесите предмет в соответствующую колонку предложения.");
      const item = await fromUuid(data.uuid);
      const current = this.controller.shop.getContext(this.sceneId, this.target, this.schemeId);
      const actor = validateTradeContext(current, this.intent(), game.user);
      if (item?.documentName !== "Item" || item.parent?.uuid !== actor.uuid) throw new Error("Предмет не принадлежит выбранному персонажу.");
      return this.edit((draft) => { if (!draft.giveItemIds.includes(item.id)) draft.giveItemIds.push(item.id); });
    } catch (error) { this.feedback = error.message; this.render({ force: true }); }
  }
  async edit(change) {
    if (this.busy || this.pending || this.finished || this.readOnly || this.sessionError) return;
    this.busy = true;
    const next = clone(this.draft); change(next);
    try {
      this.session = await this.controller.shop.updateOffer(this.intent({ draft: next, revision: ++this.revision }));
      this.draft = clone(this.session.draft); this.feedback = "Предложение изменено. Предметы ещё не переданы.";
    } catch (error) { this.feedback = error.message; }
    finally { this.busy = false; if (this.rendered) this.render({ force: true }); }
  }
  static addTake(_event, button) { return this.edit((draft) => { const item = draft.take.find((item) => item.entryId === button.dataset.entryId);
    if (item) item.count++; else draft.take.push({ entryId: button.dataset.entryId, count: 1 }); }); }
  static removeTake(_event, button) { return this.edit((draft) => {
    const item = draft.take.find((item) => item.entryId === button.dataset.entryId);
    if (item && --item.count <= 0) draft.take = draft.take.filter((item) => item.entryId !== button.dataset.entryId);
  }); }
  static addGive(_event, button) { return this.edit((draft) => { if (!draft.giveItemIds.includes(button.dataset.itemId)) draft.giveItemIds.push(button.dataset.itemId); }); }
  static removeGive(_event, button) { return this.edit((draft) => { draft.giveItemIds = draft.giveItemIds.filter((itemId) => itemId !== button.dataset.itemId); }); }
  static async confirm() {
    if (this.busy || this.pending || this.finished || this.readOnly) return;
    this.busy = true;
    try {
      const result = await this.controller.shop.requestTrade(this.intent({ kind: "exchange", ...clone(this.draft) }));
      this.messageId = result?.id ?? null;
      this.pending = !["done", "failed", "rejected"].includes(result?.status);
      this.feedback = this.pending ? "Предложение отправлено. Ожидаем результат." : (result.error || "Обмен выполнен.");
    } catch (error) { this.feedback = error.message; }
    finally { this.busy = false; if (this.rendered) this.render({ force: true }); }
  }
  static display(_event, button) { this.view = button.dataset.view; return this.render({ force: true }); }
  static refresh() { return this.render({ force: true }); }
  refresh() { if (this.rendered) return this.render({ force: true }); }
  static newOffer() {
    this.finished = false; this.pending = false; this.session = null; this.sessionId = null;
    this.requestId = newId(); this.sessionError = null; this.feedback = "";
    return this.render({ force: true });
  }
  static sheet() { return this.controller.shop.getContext(this.sceneId, this.target, this.schemeId).scene?.tokens.get(this.actorTokenId)?.actor?.sheet?.render(true); }
  async close(options = {}) {
    this.listeners?.abort(); clearInterval(this.heartbeat); clearInterval(this.statusTimer);
    this.heartbeat = null; this.statusTimer = null;
    if (this.sessionId && !this.readOnly && !this.pending && !this.finished && !this.busy) {
      // Closing is local; if the GM is unavailable, the editing lease expires after two minutes.
      void this.controller.shop.releaseSession(this.intent()).catch(() => {});
    }
    return super.close(options);
  }
}
