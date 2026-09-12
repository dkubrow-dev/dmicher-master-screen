import { message as localizedMessage } from "./localization.js";
import { randomId, normalizeDescription } from "./model.js";
import { validateParameters } from "./signal-types.js";

const clone = (value) => structuredClone(value);
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const fail = (message) => { throw new Error(message); };
const id = (value, label) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : fail(localizedMessage("{0}: неверный идентификатор.", [label]));
const prose = (value, limit, label) => typeof value === "string" && [...value].length <= limit ? value : fail(localizedMessage("{0}: требуется текст длиной до {1} символов.", [label, limit]));
const name = (value, label) => prose(value, 100, label).trim() || fail(localizedMessage("{0}: требуется название.", [label]));
const unique = (rows, label) => { for (const field of ["id", "name"]) if (new Set(rows.map((row) => String(row[field]).toLocaleLowerCase())).size !== rows.length) fail(localizedMessage("{0}: названия и ID должны быть уникальны.", [label])); };
const array = (value, max, label) => Array.isArray(value) && value.length <= max ? value : fail(localizedMessage("{0}: требуется список до {1} элементов.", [label, max]));
const stock = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 10000 ? value : fail(localizedMessage("Остаток — целое число от 0 до 10000."));

/** System-owned Item data is opaque; one stock unit remains one complete document. */
export function normalizeShopAsset(raw) {
  if (!object(raw)) fail(localizedMessage("Ожидается магазин."));
  const items = array(raw.items ?? [], 200, localizedMessage("Товары")).map((item) => {
    if (!object(item?.data) || typeof item.data.name !== "string" || typeof item.data.type !== "string") fail(localizedMessage("Товар должен содержать документ Item с именем и типом."));
    return { id: id(item.id || randomId(), localizedMessage("Товар")), data: clone(item.data), stock: stock(item.stock ?? 1) };
  });
  if (new Set(items.map((entry) => entry.id)).size !== items.length) fail(localizedMessage("ID товаров магазина не должны повторяться."));
  if (raw.display !== undefined && !["list", "tiles"].includes(raw.display)) fail(localizedMessage("Отображение магазина: list или tiles."));
  return { id: id(raw.id || randomId(), localizedMessage("Магазин")), name: name(raw.name, localizedMessage("Магазин")), description: normalizeDescription(raw.description),
    img: prose(raw.img ?? "", 1024, localizedMessage("Арт магазина")), display: raw.display ?? "list", requireGMApproval: raw.requireGMApproval !== false, items };
}

/** Pages carry text and references only; no inline script is interpreted. */
export function normalizeDialogueAsset(raw) {
  if (!object(raw)) fail(localizedMessage("Ожидается диалог."));
  const pages = array(raw.pages ?? [], 100, localizedMessage("Страницы диалога")).map((page) => {
    if (!object(page)) fail(localizedMessage("Ожидается страница диалога."));
    const responses = array(page.responses ?? [], 30, localizedMessage("Ответы")).map((response) => {
      if (!object(response)) fail(localizedMessage("Ожидается ответ диалога."));
      const nextPageId = response.nextPageId ? id(response.nextPageId, localizedMessage("Следующая страница")) : "";
      const signalId = prose(response.signalId ?? "", 240, localizedMessage("Сигнал"));
      if (!object(response.parameters ?? {})) fail(localizedMessage("Параметры сигнала должны быть объектом JSON."));
      return { id: id(response.id || randomId(), localizedMessage("Ответ")), label: prose(response.label ?? "", 200, localizedMessage("Текст ответа")), nextPageId, signalId, parameters: clone(response.parameters ?? {}) };
    });
    if (new Set(responses.map((entry) => entry.id)).size !== responses.length) fail(localizedMessage("ID ответов страницы не должны повторяться."));
    return { id: id(page.id || randomId(), localizedMessage("Страница")), name: name(page.name || localizedMessage("Страница"), localizedMessage("Страница")),
      text: prose(page.text ?? "", 12000, localizedMessage("Текст страницы")), art: prose(page.art ?? "", 1024, localizedMessage("Арт страницы")), responses };
  });
  if (!pages.length || new Set(pages.map((entry) => entry.id)).size !== pages.length) fail(localizedMessage("Диалог должен содержать страницы с уникальными ID."));
  const startPageId = raw.startPageId ?? pages[0].id;
  if (!pages.some((page) => page.id === startPageId)) fail(localizedMessage("Начальная страница диалога отсутствует."));
  for (const page of pages) for (const response of page.responses) if (response.nextPageId && !pages.some((entry) => entry.id === response.nextPageId)) fail(localizedMessage("Ответ ссылается на отсутствующую страницу."));
  return { id: id(raw.id || randomId(), localizedMessage("Диалог")), name: name(raw.name, localizedMessage("Диалог")), description: normalizeDescription(raw.description), startPageId, pages };
}

export function normalizeInteractionCatalog(raw = {}) {
  if (!object(raw) || (raw.schemaVersion !== undefined && raw.schemaVersion !== 1)) fail(localizedMessage("Неподдерживаемый каталог взаимодействий."));
  const shops = array(raw.shops ?? [], 500, localizedMessage("Магазины")).map(normalizeShopAsset);
  const dialogues = array(raw.dialogues ?? [], 500, localizedMessage("Диалоги")).map(normalizeDialogueAsset);
  unique(shops, localizedMessage("Магазины")); unique(dialogues, localizedMessage("Диалоги"));
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, shops, dialogues };
}

export function validateDialogueSignals(dialogues, signals) {
  for (const dialogue of dialogues) for (const page of dialogue.pages) for (const response of page.responses) {
    if (!response.signalId) continue;
    const signal = signals.find((entry) => entry.id === response.signalId && entry.emitterKey === `Dialogue:${dialogue.id}`);
    if (!signal) fail(localizedMessage("Ответ диалога может испустить только собственный объявленный сигнал."));
    validateParameters(signal, response.parameters);
  }
}

export const INTERACTION_KINDS = Object.freeze(["shop", "dialogue"]);
const interactionTypes = Object.freeze({
  shop: Object.freeze({ collection: "shops", referenceId: "shopId", emitterType: "Shop", normalize: normalizeShopAsset }),
  dialogue: Object.freeze({ collection: "dialogues", referenceId: "dialogueId", emitterType: "Dialogue", normalize: normalizeDialogueAsset })
});
export function interactionType(kind) {
  if (!Object.hasOwn(interactionTypes, kind)) fail(localizedMessage("Неизвестный вид инструмента взаимодействия."));
  return interactionTypes[kind];
}

/** Assets of different kinds may share an ID. Import maps therefore identify
 * the emitter type as well; a shop never remaps an unrelated dialogue. */
export function mergeInteractionCatalogs(existing, source = {}) {
  const current = normalizeInteractionCatalog(existing), incoming = normalizeInteractionCatalog(source), mapping = new Map();
  const comparable = ({ id, description, ...value }) => value;
  for (const kind of INTERACTION_KINDS) {
    const { collection, emitterType } = interactionType(kind);
    for (const asset of incoming[collection]) {
      const match = current[collection].find((entry) => entry.name.toLocaleLowerCase() === asset.name.toLocaleLowerCase());
      if (match && JSON.stringify(comparable(match)) !== JSON.stringify(comparable(asset))) fail(localizedMessage("В принимающей сцене есть другой инструмент «{0}».", [asset.name]));
      const targetId = match?.id ?? randomId();
      mapping.set(`${emitterType}:${asset.id}`, targetId);
      if (!match) current[collection].push({ ...clone(asset), id: targetId });
    }
  }
  current.revision++;
  return { catalog: normalizeInteractionCatalog(current), mapping };
}
