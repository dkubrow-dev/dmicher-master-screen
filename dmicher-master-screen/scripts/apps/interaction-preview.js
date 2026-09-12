import { ScreenFormApplication } from "./editor.js";
import { themedClasses } from "../ui.js";
import { SceneAssets } from "../scene-assets.js";
import { SceneObjects, listNativeSceneObjects, resolveObjectShop, resolveObjectDialogue } from "../scene-objects.js";
import { getDefinitions, getObjectTags } from "../store.js";
import { normalizeTags } from "../model.js";
import { generics } from "../generics.js";
import { evaluateInteractionPreview } from "../interaction-access.js";

const esc = generics.utilities.escapeHTML;
const clone = structuredClone;
const button = (action, text, attrs = "") => `<button type="button" data-screen-action="${action}" ${attrs}>${esc(text)}</button>`;
const select = (name, label, entries, value) => `<label class="ms-field">${esc(label)}<select name="${name}"><option value="">—</option>${entries.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === value ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}</select></label>`;

/** All state below is local rehearsal data. No session, Item update or event is produced. */
export class InteractionPreviewApplication extends ScreenFormApplication {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-interaction-preview"), position: { width: 940, height: 780 }, window: { title: "Предпросмотр взаимодействия", icon: "fa-solid fa-eye", resizable: true } };
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/interaction-preview.hbs", scrollable: [".ms-preview-result"] } };
  constructor(controller, { kind, assetId, draft, pageId } = {}, options = {}) {
    super(options); this.controller = controller; this.kind = kind; this.assetId = assetId; this.sceneId = controller.getContext().scene?.id;
    this.assetDraft = draft ? clone(draft) : null; this.pageId = pageId; this.conditions = null; this.take = {}; this.give = new Set(); this.feedback = "";
  }
  onDraftInput() { return false; }
  getAsset(scene) { return clone(this.assetDraft ?? (this.kind === "shop" ? new SceneAssets(scene).getShop(this.assetId) : new SceneAssets(scene).getDialogue(this.assetId))); }
  async _prepareContext(options) {
    const parent = await super._prepareContext(options), scene = this.controller.getContext().scene;
    if (!game.user.isGM || !scene || scene.id !== this.sceneId) return { ...parent, html: '<p>Вернитесь к сцене предпросмотра.</p>' };
    const asset = this.getAsset(scene); if (!asset) return { ...parent, html: '<p>Инструмент больше не существует.</p>' };
    const definitions = getDefinitions(scene), bindings = Object.values(new SceneObjects(scene).list().bindings);
    const objects = listNativeSceneObjects(scene);
    const actors = [...scene.tokens.values()].filter((token) => token.actor);
    if (!this.conditions) {
      const binding = bindings.find((entry) => entry[`${this.kind}s`]?.some((link) => link[`${this.kind}Id`] === asset.id)), group = definitions.find((entry) => entry.groupId === binding?.groupId) ?? definitions[0];
      const actor = actors.find((entry) => entry.object?.controlled) ?? actors[0];
      this.conditions = { groupId: group?.groupId ?? "", stateId: group?.entryStateId ?? group?.states[0]?.id ?? "", target: binding ? `${binding.type}:${binding.id}` : objects[0]?.key ?? "", actorTokenId: actor?.id ?? "", tags: actor ? getObjectTags(scene, { type: "Token", id: actor.id }).join(", ") : "", distance: 0, visible: true, enabled: true, used: 0, halted: false, showBlocked: true };
    }
    const state = this.conditions, group = definitions.find((entry) => entry.groupId === state.groupId), actor = scene.tokens.get(state.actorTokenId)?.actor;
    if (!group?.states.some((entry) => entry.id === state.stateId)) state.stateId = group?.entryStateId ?? group?.states[0]?.id ?? "";
    const [type, id] = state.target.split(":"), descriptor = { type, id };
    let resolved; try { resolved = (this.kind === "shop" ? resolveObjectShop : resolveObjectDialogue)(scene, descriptor, state, asset.id); } catch { /* No selectable object yet. */ }
    const gate = !actor ? { allowed: false, reason: "Выберите токен с персонажем (Actor)." }
      : resolved?.asset.id !== asset.id ? { allowed: false, reason: "У выбранного объекта нет этой привязки в выбранном состоянии." }
      : evaluateInteractionPreview({ config: resolved.config, kind: this.kind, ...state, tags: normalizeTags(state.tags.split(",")) });
    this.allowed = gate.allowed || state.showBlocked;
    this.inventory ??= actor ? [...(actor.items?.values?.() ?? [])].map((item) => ({ id: item.id, name: item.name, img: item.img, data: clone(item.toObject?.() ?? { name: item.name, img: item.img, type: item.type }) })) : [];
    this.localShopItems ??= clone(asset.items ?? []);
    this.currentAsset = this.kind === "shop" ? { ...asset, items: this.localShopItems } : asset;
    this.stock ??= new Map((asset.items ?? []).map((item) => [item.id, item.stock]));
    const checks = [["visible", "Объект виден"], ["enabled", "Запуск разрешён"], ["halted", "Группа остановлена"], ["showBlocked", "Показать содержимое при отказе"]].map(([key, label]) => `<label class="ms-check"><input type="checkbox" name="${key}" ${state[key] ? "checked" : ""}>${label}</label>`).join("");
    const form = `<details open class="ms-details"><summary>Имитируемые условия</summary><div class="ms-grid-two">${select("groupId", "Группа", definitions.map((entry) => ({ id: entry.groupId, name: entry.groupName })), state.groupId)}${select("stateId", "Состояние", group?.states ?? [], state.stateId)}${select("target", "Объект", objects.map((entry) => ({ id: entry.key, name: entry.name })), state.target)}${select("actorTokenId", "Персонаж", actors.map((token) => ({ id: token.id, name: `${token.name} · ${token.actor.name}` })), state.actorTokenId)}</div><label class="ms-field">Имитируемые теги персонажа<input name="tags" value="${esc(state.tags)}"></label><div class="ms-grid-two"><label class="ms-field">Расстояние<input name="distance" type="number" min="0" step="any" value="${state.distance}"></label><label class="ms-field">Произошедших запусков<input name="used" type="number" min="0" step="1" value="${state.used}"></label></div><div class="ms-grid-two">${checks}</div>${button("applyPreview", "Применить условия и начать заново")}</details>`;
    return { ...parent, html: `<p class="ms-preview-banner">Предпросмотр: инвентарь и остатки мира не меняются, сигналы не отправляются.</p><h3>${esc(asset.name)}</h3>${form}<p class="ms-preview-gate" data-preview-allowed="${gate.allowed}">${gate.allowed ? "Действие доступно при выбранных условиях." : esc(gate.reason)}</p><div class="ms-preview-result">${this.allowed ? this.kind === "shop" ? this.renderShop(this.currentAsset) : this.renderDialogue(asset) : ""}<p data-preview-feedback>${esc(this.feedback)}</p></div>` };
  }
  renderShop(asset) {
    return `<div class="ms-shop-columns"><section><h3>Каталог магазина</h3>${asset.img ? `<img class="ms-dialogue-art" src="${esc(asset.img)}" alt="">` : ""}<div class="ms-asset-stock ${asset.display === "tiles" ? "is-tiles" : ""}"><div class="ms-stock-items">${asset.items.map((item) => `<div class="ms-stock-entry"><img src="${esc(item.data.img || "icons/svg/item-bag.svg")}" alt=""><span>${esc(item.data.name)} · ${this.stock.get(item.id) ?? 0}</span>${button("previewTake", "+", `data-id="${esc(item.id)}" ${(this.stock.get(item.id) ?? 0) <= (this.take[item.id] ?? 0) ? "disabled" : ""}`)}</div>`).join("")}</div></div></section><section><h3>Предложение персонажа</h3>${this.inventory.map((item) => button("previewGive", `${this.give.has(item.id) ? "✓ " : "+ "}${item.name}`, `data-id="${esc(item.id)}"`)).join("") || '<p>У персонажа нет предметов.</p>'}<h3>Предложение магазина</h3>${Object.entries(this.take).map(([id, count]) => `<div>${esc(asset.items.find((item) => item.id === id)?.data.name)} × ${count} ${button("previewRemoveTake", "Убрать", `data-id="${esc(id)}"`)}</div>`).join("")}${button("previewTrade", asset.requireGMApproval ? "Имитировать одобрение мастера" : "Имитировать обмен")}</section></div>`;
  }
  renderDialogue(asset) {
    const page = asset.pages.find((entry) => entry.id === this.pageId) ?? asset.pages.find((entry) => entry.id === asset.startPageId);
    if (!page || this.ended) return button("previewRestart", "Начать диалог заново");
    this.pageId = page.id;
    return `${page.art ? `<img class="ms-dialogue-art" src="${esc(page.art)}" alt="">` : ""}<p class="ms-dialogue-text">${esc(page.text)}</p><div class="ms-dialogue-responses">${page.responses.map((response) => button("previewAnswer", response.label, `data-id="${esc(response.id)}"`)).join("")}${button("previewLeave", "Уйти")}</div>`;
  }
  async _onRender(context, options) {
    await super._onRender(context, options); const listeners = this.bindEvents();
    this.element.addEventListener("change", (event) => {
      if (!["groupId", "actorTokenId"].includes(event.target.name)) return;
      try {
        this.readConditions();
        if (event.target.name === "actorTokenId") {
          const scene = this.controller.getContext().scene;
          this.conditions.tags = this.conditions.actorTokenId ? getObjectTags(scene, { type: "Token", id: this.conditions.actorTokenId }).join(", ") : "";
          this.inventory = null;
        }
        this.take = {}; this.give.clear(); this.ended = false;
        void this.render({ force: true });
      } catch (error) { ui.notifications.error(error.message); }
    }, listeners);
  }
  readConditions() {
    const previous = this.conditions, field = (name) => this.element.querySelector(`[name="${name}"]`);
    for (const key of ["groupId", "stateId", "target", "actorTokenId", "tags"]) previous[key] = field(key).value;
    for (const key of ["distance", "used"]) { if (!field(key).checkValidity() || !field(key).value) throw new Error("Проверьте имитируемые числовые условия."); previous[key] = Number(field(key).value); }
    for (const key of ["visible", "enabled", "halted", "showBlocked"]) previous[key] = field(key).checked;
  }
  async handleAction(action, button) {
    if (action === "applyPreview") { this.readConditions(); this.inventory = null; this.stock = null; this.localShopItems = null; this.take = {}; this.give.clear(); this.ended = false; this.pageId = null; this.feedback = ""; return this.render({ force: true }); }
    if (!this.allowed || !this.currentAsset || !game.user.isGM) return;
    const asset = this.currentAsset, id = button?.dataset.id;
    if (action === "previewTake" && (this.stock.get(id) ?? 0) > (this.take[id] ?? 0)) this.take[id] = (this.take[id] ?? 0) + 1;
    if (action === "previewRemoveTake") delete this.take[id];
    if (action === "previewGive" && this.inventory.some((item) => item.id === id)) { if (this.give.has(id)) this.give.delete(id); else this.give.add(id); }
    if (action === "previewTrade") {
      for (const [itemId, count] of Object.entries(this.take)) if (!asset.items.some((item) => item.id === itemId) || count > (this.stock.get(itemId) ?? 0)) throw new Error("Не хватает предметов в имитации магазина.");
      for (const item of this.inventory.filter((entry) => this.give.has(entry.id))) {
        const id = `preview-sold-${this.sequence = (this.sequence ?? 0) + 1}`;
        this.localShopItems.push({ id, data: clone(item.data ?? { name: item.name, img: item.img }), stock: 1 }); this.stock.set(id, 1);
      }
      this.inventory = this.inventory.filter((item) => !this.give.has(item.id));
      for (const [itemId, count] of Object.entries(this.take)) {
        const item = asset.items.find((entry) => entry.id === itemId); if (!item || count > this.stock.get(itemId)) throw new Error("Не хватает предметов в имитации магазина.");
        this.stock.set(itemId, this.stock.get(itemId) - count);
        for (let index = 0; index < count; index++) this.inventory.push({ id: `preview-bought-${this.sequence = (this.sequence ?? 0) + 1}`, name: item.data.name, img: item.data.img, data: clone(item.data) });
      }
      this.give.clear(); this.take = {}; this.feedback = "Имитация обмена завершена. Документы мира не изменены.";
    }
    if (action === "previewAnswer") {
      const response = asset.pages.find((page) => page.id === this.pageId)?.responses.find((entry) => entry.id === id); if (!response) return;
      if (response.nextPageId) this.pageId = response.nextPageId;
      else { this.ended = true; this.feedback = response.signalId ? `Диалог завершён. В игре ответ отправит сигнал «${response.signalId}». Предпросмотр его не отправляет.` : "Диалог завершён без сигнала."; }
    }
    if (action === "previewLeave") { this.ended = true; this.feedback = "Уход без сигнала."; }
    if (action === "previewRestart") { this.ended = false; this.pageId = asset.startPageId; this.feedback = ""; }
    return this.render({ force: true });
  }
}
