import { message as localizedMessage, text } from "./localization.js";
import { MODULE_ID, randomId } from "./model.js";
import { requireGM, withSceneLock } from "./store.js";
import { getSignalCatalog, exportCatalogDependencies, mergeCatalogDependencies, removeSignalOwner, normalizeCatalog } from "./signal-catalog.js";
import { stageScene, remapDialogueSignals } from "./configuration-transfer.js";

import { normalizeShopAsset, normalizeDialogueAsset, normalizeInteractionCatalog, mergeInteractionCatalogs, interactionType, validateDialogueSignals } from "./interaction-model.js";
import { writeSceneFlags } from "./scene-flags.js";
import { getShopInventory, hasShopInventory, prepareShopInventoryChange, requireShopInventoryAuthority } from "./shop-inventory.js";
export { normalizeShopAsset, normalizeDialogueAsset, normalizeInteractionCatalog } from "./interaction-model.js";

const clone = (value) => structuredClone(value);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const fail = (message) => { throw new Error(message); };

export function getInteractionCatalog(scene) {
  const raw = scene?.getFlag(MODULE_ID, "interactionCatalog");
  return normalizeInteractionCatalog(raw ?? {});
}

export function mergeInteractionAssets(scene, source = {}) {
  return mergeInteractionCatalogs(getInteractionCatalog(scene), source);
}

/** Scene assets own preparation; stock and active trading sessions belong to runtime. */
export class SceneAssets {
  constructor(scene) { this.scene = scene; }
  list() { return getInteractionCatalog(this.scene); }
  getShop(id) { return this.list().shops.find((entry) => entry.id === id) ?? null; }
  getDialogue(id) { return this.list().dialogues.find((entry) => entry.id === id) ?? null; }
  async change(operation, { expectedRevision } = {}) {
    return withSceneLock(this.scene, async () => {
      requireGM(); const catalog = this.list(), relatedFlags = {};
      if (expectedRevision !== undefined && catalog.revision !== expectedRevision) fail(localizedMessage("Каталог изменён другим окном. Обновите его перед сохранением."));
      const result = await operation(catalog, relatedFlags);
      const next = normalizeInteractionCatalog({ ...catalog, revision: catalog.revision + 1 });
      const fields = { interactionCatalog: next, ...relatedFlags };
      const signals = getSignalCatalog(stageScene(this.scene, fields)).signals;
      validateDialogueSignals(next.dialogues, signals);
      await writeSceneFlags(this.scene, fields);
      return clone(result);
    });
  }
  saveShop(value, options = {}) {
    return this.change((catalog, relatedFlags) => {
      const shop = normalizeShopAsset(value), previous = catalog.shops.find(entry => entry.id === shop.id);
      const current = getShopInventory(this.scene, shop.id, { initialItems: previous?.items ?? shop.items });
      if (options.expectedInventoryRevision !== undefined && options.expectedInventoryRevision !== current.revision)
        fail(text("Текущие товары магазина изменились. Обновите их перед сохранением.", "The shop's current stock changed. Reload it before saving."));
      const hasCurrentDraft = Object.hasOwn(options, "currentItems");
      const currentItems = hasCurrentDraft ? options.currentItems : options.resetInventory ? shop.items : current.items;
      const changesCurrent = hasCurrentDraft && JSON.stringify(currentItems) !== JSON.stringify(current.items);
      const initialChanged = previous && JSON.stringify(previous.items) !== JSON.stringify(shop.items);
      // Editing initial stock is explicit preparation, not a replenishment. Capture
      // the previous stock first when this shop has no canonical snapshot yet.
      if (changesCurrent || options.resetInventory || initialChanged && !hasShopInventory(this.scene, shop.id)) {
        requireShopInventoryAuthority();
        const { fields } = prepareShopInventoryChange(this.scene, shop.id, currentItems, {
          expectedRevision: options.expectedInventoryRevision, initialItems: current.items,
          cancelTrades: changesCurrent || options.resetInventory === true,
          incrementRevision: changesCurrent || options.resetInventory === true
        });
        Object.assign(relatedFlags, fields);
      }
      return this.save(catalog.shops, shop);
    }, options);
  }
  saveDialogue(value, options = {}) { return this.change((catalog) => this.save(catalog.dialogues, normalizeDialogueAsset(value)), options); }
  save(rows, value) { const index = rows.findIndex((entry) => entry.id === value.id); if (index < 0) rows.push(value); else rows[index] = value; return value; }
  deleteShop(id, options) { return this.remove("shop", id, options); }
  deleteDialogue(id, options) { return this.remove("dialogue", id, options); }
  remove(kind, id, options) { return this.change(async (catalog, relatedFlags) => {
    const { assetReferences } = await import("./scene-objects.js");
    if (assetReferences(this.scene, kind, id).length) fail(localizedMessage("Сначала снимите привязки этого инструмента с объектов сцены."));
    const { collection, emitterType } = interactionType(kind), index = catalog[collection].findIndex((entry) => entry.id === id);
    if (index < 0) fail(localizedMessage("Инструмент больше не существует."));
    catalog[collection].splice(index, 1);
    relatedFlags.signalCatalog = removeSignalOwner(normalizeCatalog(this.scene.getFlag(MODULE_ID, "signalCatalog") ?? {}), `${emitterType}:${id}`);
    return true;
  }, options); }
  exportShop(id) { return this.export("shop", id); }
  exportDialogue(id) { return this.export("dialogue", id); }
  export(kind, id) {
    requireGM(); const { collection, emitterType } = interactionType(kind), data = this.list()[collection].find((entry) => entry.id === id); if (!data) fail(localizedMessage("Инструмент не найден."));
    return { format: MODULE_ID, kind, version: 1, data,
      catalog: exportCatalogDependencies(this.scene, [`${emitterType}:${id}`]) };
  }
  importShop(envelope, options) { return this.import("shop", envelope, options); }
  importDialogue(envelope, options) { return this.import("dialogue", envelope, options); }
  import(kind, envelope, { name, ...options } = {}) {
    if (envelope?.format !== MODULE_ID || envelope.version !== 1 || envelope.kind !== kind || !object(envelope.data)) return Promise.reject(new Error(localizedMessage("Ожидается JSON выбранного инструмента Ширмы.")));
    const data = { ...clone(envelope.data), id: randomId(), ...(name !== undefined ? { name } : {}) };
    return this.change((catalog, relatedFlags) => {
      const { collection, emitterType, normalize } = interactionType(kind);
      const prepared = normalize(data);
      this.save(catalog[collection], prepared);
      const idMapping = new Map();
      relatedFlags.signalCatalog = mergeCatalogDependencies(stageScene(this.scene, { interactionCatalog: catalog }), envelope.catalog ?? {},
        { emitterMapping: new Map([[`${emitterType}:${envelope.data.id}`, `${emitterType}:${data.id}`]]), idMapping });
      // Item data belongs to the game system. Only dialogue answers own signal references.
      const saved = kind === "dialogue" ? remapDialogueSignals(prepared, idMapping) : prepared;
      return this.save(catalog[collection], normalize(saved));
    }, options);
  }
}
