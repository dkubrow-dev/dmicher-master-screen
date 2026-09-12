import { MODULE_ID, randomId, normalizeDescription } from "./model.js";
import { requireGM, withSceneLock } from "./store.js";
import { getSignalCatalog, exportCatalogDependencies, mergeCatalogDependencies, removeSignalOwner, normalizeCatalog } from "./signal-catalog.js";
import { validateParameters } from "./signal-types.js";
import { stageScene, remapSignalIds } from "./configuration-transfer.js";

const clone = (value) => structuredClone(value);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const fail = (message) => { throw new Error(message); };
const id = (value, label) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : fail(`${label}: неверный идентификатор.`);
const prose = (value, limit, label) => typeof value === "string" && [...value].length <= limit ? value : fail(`${label}: требуется текст длиной до ${limit} символов.`);
const name = (value, label) => prose(value, 100, label).trim() || fail(`${label}: требуется название.`);
const unique = (rows, label) => { for (const field of ["id", "name"]) if (new Set(rows.map((row) => String(row[field]).toLocaleLowerCase())).size !== rows.length) fail(`${label}: названия и ID должны быть уникальны.`); };
const array = (value, max, label) => Array.isArray(value) && value.length <= max ? value : fail(`${label}: требуется список до ${max} элементов.`);
const stock = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 10000 ? value : fail("Остаток — целое число от 0 до 10000.");

/** System-owned Item data is opaque; one stock unit remains one complete document. */
export function normalizeShopAsset(raw) {
  if (!object(raw)) fail("Ожидается магазин.");
  const items = array(raw.items ?? [], 200, "Товары").map((item) => {
    if (!object(item?.data) || typeof item.data.name !== "string" || typeof item.data.type !== "string") fail("Товар должен содержать документ Item с именем и типом.");
    return { id: id(item.id || randomId(), "Товар"), data: clone(item.data), stock: stock(item.stock ?? 1) };
  });
  if (new Set(items.map((entry) => entry.id)).size !== items.length) fail("ID товаров магазина не должны повторяться.");
  if (raw.display !== undefined && !["list", "tiles"].includes(raw.display)) fail("Отображение магазина: list или tiles.");
  return { id: id(raw.id || randomId(), "Магазин"), name: name(raw.name, "Магазин"), description: normalizeDescription(raw.description),
    img: prose(raw.img ?? "", 1024, "Арт магазина"), display: raw.display ?? "list", requireGMApproval: raw.requireGMApproval !== false, items };
}

/** Pages carry text and references only; no inline script is interpreted. */
export function normalizeDialogueAsset(raw) {
  if (!object(raw)) fail("Ожидается диалог.");
  const pages = array(raw.pages ?? [], 100, "Страницы диалога").map((page) => {
    if (!object(page)) fail("Ожидается страница диалога.");
    const responses = array(page.responses ?? [], 30, "Ответы").map((response) => {
      if (!object(response)) fail("Ожидается ответ диалога.");
      const nextPageId = response.nextPageId ? id(response.nextPageId, "Следующая страница") : "";
      const signalId = prose(response.signalId ?? "", 240, "Сигнал");
      if (!object(response.parameters ?? {})) fail("Параметры сигнала должны быть объектом JSON.");
      return { id: id(response.id || randomId(), "Ответ"), label: prose(response.label ?? "", 200, "Текст ответа"), nextPageId, signalId, parameters: clone(response.parameters ?? {}) };
    });
    if (new Set(responses.map((entry) => entry.id)).size !== responses.length) fail("ID ответов страницы не должны повторяться.");
    return { id: id(page.id || randomId(), "Страница"), name: name(page.name || "Страница", "Страница"),
      text: prose(page.text ?? "", 12000, "Текст страницы"), art: prose(page.art ?? "", 1024, "Арт страницы"), responses };
  });
  if (!pages.length || new Set(pages.map((entry) => entry.id)).size !== pages.length) fail("Диалог должен содержать страницы с уникальными ID.");
  const startPageId = raw.startPageId ?? pages[0].id;
  if (!pages.some((page) => page.id === startPageId)) fail("Начальная страница диалога отсутствует.");
  for (const page of pages) for (const response of page.responses) if (response.nextPageId && !pages.some((entry) => entry.id === response.nextPageId)) fail("Ответ ссылается на отсутствующую страницу.");
  return { id: id(raw.id || randomId(), "Диалог"), name: name(raw.name, "Диалог"), description: normalizeDescription(raw.description), startPageId, pages };
}

export function normalizeInteractionCatalog(raw = {}) {
  if (!object(raw) || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1)) fail("Неподдерживаемый каталог взаимодействий.");
  const shops = array(raw.shops ?? [], 500, "Магазины").map(normalizeShopAsset);
  const dialogues = array(raw.dialogues ?? [], 500, "Диалоги").map(normalizeDialogueAsset);
  unique(shops, "Магазины"); unique(dialogues, "Диалоги");
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, shops, dialogues };
}

export function getInteractionCatalog(scene) {
  const raw = scene?.getFlag(MODULE_ID, "interactionCatalog");
  return normalizeInteractionCatalog(raw ?? {});
}

export function mergeInteractionAssets(scene, source = {}) {
  const current = getInteractionCatalog(scene), incoming = normalizeInteractionCatalog(source), mapping = new Map();
  for (const key of ["shops", "dialogues"]) for (const asset of incoming[key]) {
    const match = current[key].find((entry) => entry.name.toLocaleLowerCase() === asset.name.toLocaleLowerCase());
    const comparable = ({ id, description, ...value }) => value;
    if (match && JSON.stringify(comparable(match)) !== JSON.stringify(comparable(asset))) fail(`В принимающей сцене есть другой инструмент «${asset.name}».`);
    mapping.set(asset.id, match?.id ?? randomId());
    if (!match) current[key].push({ ...clone(asset), id: mapping.get(asset.id) });
  }
  current.revision++;
  return { catalog: normalizeInteractionCatalog(current), mapping };
}

/** Scene assets own preparation; stock and active trading sessions belong to runtime. */
export class SceneAssets {
  constructor(scene) { this.scene = scene; }
  list() { return getInteractionCatalog(this.scene); }
  getShop(id) { return this.list().shops.find((entry) => entry.id === id) ?? null; }
  getDialogue(id) { return this.list().dialogues.find((entry) => entry.id === id) ?? null; }
  async change(operation, { expectedRevision } = {}) {
    return withSceneLock(this.scene, async () => {
      requireGM(); const catalog = this.list();
      if (expectedRevision !== undefined && catalog.revision !== expectedRevision) fail("Каталог изменён другим окном. Обновите его перед сохранением.");
      const result = await operation(catalog);
      const next = normalizeInteractionCatalog({ ...catalog, revision: catalog.revision + 1 });
      const signals = getSignalCatalog(stageScene(this.scene, { interactionCatalog: next, ...(catalog.signalCatalog ? { signalCatalog: catalog.signalCatalog } : {}) })).signals;
      for (const dialogue of next.dialogues) for (const page of dialogue.pages) for (const response of page.responses) {
        if (response.signalId) {
          const signal = signals.find((entry) => entry.id === response.signalId && entry.emitterKey === `Dialogue:${dialogue.id}`);
          if (!signal) fail("Ответ диалога может испустить только собственный объявленный сигнал.");
          validateParameters(signal, response.parameters);
        }
      }
      const fields = { interactionCatalog: next, ...(catalog.signalCatalog ? { signalCatalog: catalog.signalCatalog } : {}) };
      if (this.scene.update) await this.scene.update(Object.fromEntries(Object.entries(fields).map(([key, value]) => [`flags.${MODULE_ID}.${key}`, value])));
      else for (const [key, value] of Object.entries(fields)) await this.scene.setFlag(MODULE_ID, key, value);
      return clone(result);
    });
  }
  saveShop(value, options = {}) { return this.change((catalog) => this.save(catalog.shops, normalizeShopAsset(value)), options); }
  saveDialogue(value, options = {}) { return this.change((catalog) => this.save(catalog.dialogues, normalizeDialogueAsset(value)), options); }
  save(rows, value) { const index = rows.findIndex((entry) => entry.id === value.id); if (index < 0) rows.push(value); else rows[index] = value; return value; }
  deleteShop(id, options) { return this.remove("shop", id, options); }
  deleteDialogue(id, options) { return this.remove("dialogue", id, options); }
  remove(kind, id, options) { return this.change(async (catalog) => {
    const { assetReferences } = await import("./scene-objects.js");
    if (assetReferences(this.scene, kind, id).length) fail("Сначала снимите привязки этого инструмента с объектов сцены.");
    const key = kind === "shop" ? "shops" : "dialogues", index = catalog[key].findIndex((entry) => entry.id === id);
    if (index < 0) fail("Инструмент больше не существует.");
    catalog[key].splice(index, 1);
    catalog.signalCatalog = removeSignalOwner(normalizeCatalog(this.scene.getFlag(MODULE_ID, "signalCatalog") ?? {}), `${kind === "shop" ? "Shop" : "Dialogue"}:${id}`);
    return true;
  }, options); }
  exportShop(id) { return this.export("shop", id); }
  exportDialogue(id) { return this.export("dialogue", id); }
  export(kind, id) {
    requireGM(); const data = kind === "shop" ? this.getShop(id) : this.getDialogue(id); if (!data) fail("Инструмент не найден.");
    return { format: MODULE_ID, kind, version: 1, data,
      catalog: exportCatalogDependencies(this.scene, [`${kind === "shop" ? "Shop" : "Dialogue"}:${id}`]) };
  }
  importShop(envelope, options) { return this.import("shop", envelope, options); }
  importDialogue(envelope, options) { return this.import("dialogue", envelope, options); }
  import(kind, envelope, { name, ...options } = {}) {
    if (envelope?.format !== MODULE_ID || envelope.version !== 1 || envelope.kind !== kind || !object(envelope.data)) return Promise.reject(new Error("Ожидается JSON выбранного инструмента Ширмы."));
    const data = { ...clone(envelope.data), id: randomId(), ...(name !== undefined ? { name } : {}) };
    return this.change((catalog) => {
      const key = kind === "shop" ? "shops" : "dialogues", ownerType = kind === "shop" ? "Shop" : "Dialogue";
      this.save(catalog[key], kind === "shop" ? normalizeShopAsset(data) : normalizeDialogueAsset(data));
      const idMapping = new Map();
      catalog.signalCatalog = mergeCatalogDependencies(stageScene(this.scene, { interactionCatalog: catalog }), envelope.catalog ?? {},
        { emitterMapping: new Map([[`${ownerType}:${envelope.data.id}`, `${ownerType}:${data.id}`]]), idMapping });
      const saved = remapSignalIds(data, idMapping);
      return this.save(catalog[key], kind === "shop" ? normalizeShopAsset(saved) : normalizeDialogueAsset(saved));
    }, options);
  }
}
