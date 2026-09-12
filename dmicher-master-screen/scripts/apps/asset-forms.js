import { text as t } from "../localization.js";
import { generics } from "../generics.js";
import { localizedDescription } from "../model.js";
import { getObjectTags } from "../store.js";
import { escapeHTML as esc, actionButton as button, textInput, selectOptions as options, formValue } from "./form-fields.js";

const input = (name, label, value = "", attributes = "") => textInput(name, label, value, attributes, "ms-field");
const textarea = (name, label, value = "", rows = 2) => `<label class="ms-field">${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
const tagNames = (tags) => {
  if (!tags?.length) return "—";
  return tags.join(", ");
};
export function matchingActorTokens(scene, bindings, conditions = {}) {
  const allow = conditions.allowTags ?? [], deny = conditions.denyTags ?? [];
  return [...(scene?.tokens?.values?.() ?? [])].filter((token) => {
    if (!token.actor) return false;
    const tags = bindings.find((entry) => entry.type === "Token" && entry.id === token.id)?.tags ?? getObjectTags(scene, { type: "Token", id: token.id });
    return (!allow.length || allow.some((tag) => tags.includes(tag))) && !deny.some((tag) => tags.includes(tag));
  }).map((token) => ({ id: token.id, name: token.name, actorName: token.actor.name ?? token.actor.id }));
}

/** Reverse references are inspected here; eligibility is edited on the object. */
export function renderAssetBindings(kind, assetId, bindings, objects, definitions, scene) {
  const key = kind === "shop" ? "shop" : "dialogue", assetKey = `${key}Id`;
  const rows = bindings.flatMap((binding) => (binding[`${key}s`] ?? []).filter((link) => link[assetKey] === assetId).map((config) => ({ ...binding, config })));
  return `<section class="ms-asset-bindings"><h4>${t("Привязанные объекты", "Assigned objects")} · ${rows.length}</h4>${rows.length ? `<table class="ms-asset-table"><thead><tr><th>${t("Объект", "Object")}</th><th>${t("Состояния и допуск", "States and access")}</th></tr></thead><tbody>${rows.map((binding) => {
    const object = objects.find((item) => item.type === binding.type && item.id === binding.id);
    const definition = definitions.find((item) => item.groupId === binding.groupId), config = binding.config;
    const states = (config.stateIds ?? []).map((id) => definition?.states.find((state) => state.id === id)?.name ?? id).join(", ") || t("Все состояния группы", "All group states");
    const actor = binding.type === "Token" ? scene?.tokens?.get(binding.id)?.actor : null;
    const eligible = matchingActorTokens(scene, bindings, config.conditions);
    return `<tr><td>${button("objectInfo", object?.name ?? binding.id, `data-object-type="${esc(binding.type)}" data-object-id="${esc(binding.id)}"`)}${actor ? `<small>${t("Персонаж", "Character")}: ${esc(actor.name ?? actor.id)}</small>` : ""}</td><td>${esc(definition?.groupName ?? t("Без группы", "Unassigned"))} · ${esc(states)}<small>${t("Белые теги", "Allowed tags")}: ${esc(tagNames(config.conditions?.allowTags))}<br>${t("Чёрные теги", "Denied tags")}: ${esc(tagNames(config.conditions?.denyTags))}</small><details><summary>${t("Токены с Actor по тегам", "Character tokens matching tags")} · ${eligible.length}</summary>${eligible.map((token) => `<small>${esc(token.name)} · ${esc(token.actorName)}</small>`).join("")}<small>${t("Дальность, видимость и состояние проверяются при взаимодействии.", "Range, visibility and state are checked on interaction.")}</small></details></td></tr>`;
  }).join("")}</tbody></table>` : `<p class="ms-note">${t("Магазин или диалог назначается объекту через «Поведение → Особенности». Одним каталогом могут пользоваться несколько объектов.", "Assign a shop or dialogue through Object behavior → Features. Several objects can use the same catalog.")}</p>`}</section>`;
}

export function renderOwnedObjects(groupId, bindings, objects, readOnly = false) {
  const owned = bindings.filter((entry) => entry.groupId === groupId);
  const available = objects.filter((entry) => !owned.some((binding) => binding.type === entry.type && binding.id === entry.id));
  return `<section class="ms-owned-objects"><h4>${t("Управляемые объекты", "Managed objects")} · ${owned.length}</h4><table class="ms-asset-table"><tbody>${owned.map((binding) => {
    const object = objects.find((entry) => entry.type === binding.type && entry.id === binding.id);
    return `<tr><td>${button("objectInfo", object?.name ?? binding.id, `data-object-type="${esc(binding.type)}" data-object-id="${esc(binding.id)}"`)}<small>${esc(binding.type)} · ${esc(binding.id)}</small></td><td>${readOnly ? "" : button("unassignObject", t("Отвязать", "Unassign"), `data-object-type="${esc(binding.type)}" data-object-id="${esc(binding.id)}"`)}</td></tr>`;
  }).join("") || `<tr><td>${t("Объекты ещё не привязаны.", "No objects assigned yet.")}</td></tr>`}</tbody></table>${readOnly ? "" : `<div class="ms-asset-add-object"><label class="ms-field">${t("Объект сцены", "Scene object")}<select name="newOwnedObject">${options(available.map((entry) => ({ id: `${entry.type}:${entry.id}`, name: `${entry.name} · ${entry.type}` })), "", t("Выберите объект", "Choose an object"))}</select></label>${button("assignObject", t("Привязать", "Assign"))}</div>`}</section>`;
}

function renderShopItems(draft, readOnly) {
  const groups = new Map();
  for (const item of draft.items ?? []) {
    const category = globalThis.game?.i18n?.localize(globalThis.CONFIG?.Item?.typeLabels?.[item.data.type] ?? item.data.type) ?? item.data.type;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return `<div data-shop-stock-drop class="ms-asset-stock ${draft.display === "tiles" ? "is-tiles" : ""}">${[...groups].map(([category, items]) => `<section><h4>${esc(category)}</h4><div class="ms-stock-items">${items.map((item) => `<div class="ms-stock-entry" data-shop-entry="${esc(item.id)}"><img src="${esc(item.data.img || "icons/svg/item-bag.svg")}" alt=""><span>${esc(item.data.name)}</span><label class="ms-field">${t("Начальный запас", "Initial stock")}<input type="number" min="0" step="1" name="shopStock" data-entry-id="${esc(item.id)}" value="${item.stock}" ${readOnly ? "disabled" : ""}></label>${readOnly ? "" : button("removeShopItem", "×", `data-id="${esc(item.id)}" aria-label="${t("Убрать товар", "Remove item")}"`)}</div>`).join("")}</div></section>`).join("") || `<p class="ms-note">${t("Перетащите сюда предметы из каталога Foundry или листа персонажа. Сохраняется копия предмета; инвентарь источника не меняется.", "Drop items here from the Foundry directory or a character sheet. A copy is saved; the source inventory is unchanged.")}</p>`}</div>`;
}

export function renderDialogueGraph(pages, startPageId) {
  return `<details class="ms-details ms-dialogue-graph"><summary>${t("Переходы между блоками", "Page transitions")}</summary><ul>${pages.map((page) => `<li><strong>${page.id === startPageId ? "▶ " : ""}${esc(page.name)}</strong><ul>${page.responses.map((response) => `<li>${esc(response.label)} → ${esc(response.nextPageId ? pages.find((item) => item.id === response.nextPageId)?.name ?? t("Недоступный блок", "Unavailable page") : t("Завершить", "Finish"))}${response.signalId ? ` · ${esc(response.signalId)}` : ""}</li>`).join("")}<li>${t("Уйти → завершить без сигнала", "Leave → finish without a signal")}</li></ul></li>`).join("")}</ul></details>`;
}

export function renderAssetForm({ kind, draft, pageId, mode, catalog, bindings, objects, definitions, scene }) {
  if (!draft) return `<p class="ms-note">${t("Создайте или выберите элемент в списке.", "Create or select an entry from the list.")}</p>`;
  const readOnly = mode !== "constructor", isShop = kind === "shop";
  if (readOnly) {
    const page = draft.pages?.find((entry) => entry.id === pageId) ?? draft.pages?.[0];
    return `<h3>${esc(draft.name)}</h3><p>${esc(localizedDescription(draft.description))}</p>${button("previewAsset", t("Предпросмотр с условиями", "Preview with conditions"))}${isShop ? renderShopItems(draft, true) + button("shops", t("Состояния торговли", "Trade sessions")) : `<nav class="ms-dialogue-page-tabs">${draft.pages.map((entry) => button("selectAssetPage", entry.name, `data-id="${esc(entry.id)}" aria-pressed="${entry.id === page?.id}"`)).join("")}</nav>${page?.art ? `<img class="ms-dialogue-art" src="${esc(page.art)}" alt="">` : ""}<p class="ms-dialogue-text">${esc(page?.text ?? "")}</p>${renderDialogueGraph(draft.pages, draft.startPageId)}${button("previewAssetDialogue", t("Посмотреть диалог", "View dialogue"))}`}${renderAssetBindings(kind, draft.id, bindings, objects, definitions, scene)}`;
  }
  let html = input("assetName", t("Название", "Name"), draft.name, 'required maxlength="100"') + textarea("assetDescription", t("Описание", "Description"), localizedDescription(draft.description));
  if (isShop) {
    html += input("shopImg", t("Изображение магазина", "Shop image"), draft.img ?? "") + button("assetFilePicker", t("Выбрать изображение", "Choose image"), 'data-field="shopImg"') + `<label class="ms-field">${t("Отображение товаров", "Catalog display")}<select name="shopDisplay">${options([{ id: "list", name: t("По категориям", "By category") }, { id: "tiles", name: t("Плитки", "Tiles") }], draft.display)}</select></label><label class="ms-check"><input type="checkbox" name="shopApproval" ${draft.requireGMApproval !== false ? "checked" : ""}> ${t("Подтверждение мастера", "GM approval")}</label><h4>${t("Товары", "Items")}</h4><p class="ms-note">${t("Начальный запас применяется при первом открытии магазина. Изменение подготовки не восстанавливает уже потраченные товары; текущий остаток виден в торговле.", "Initial stock applies when the shop first opens. Editing preparation does not replenish spent items; current stock is shown during trade.")}</p>${renderShopItems(draft, readOnly)}`;
  } else {
    const page = draft.pages.find((entry) => entry.id === pageId) ?? draft.pages[0];
    html += `<label class="ms-field">${t("Первый блок", "First page")}<select name="dialogueStartPage">${options(draft.pages, draft.startPageId)}</select></label>`;
    html += `<nav class="ms-dialogue-page-tabs">${draft.pages.map((entry) => button("selectAssetPage", entry.name, `data-id="${esc(entry.id)}" aria-pressed="${entry.id === page?.id}"`)).join("")}</nav>`;
    if (page) html += `<section data-asset-page="${esc(page.id)}">${input("dialoguePageName", t("Название блока", "Page name"), page.name, "required")}${textarea("dialoguePageText", t("Текст блока", "Page text"), page.text, 4)}${input("dialoguePageArt", t("Изображение блока", "Page image"), page.art ?? "")}${button("assetFilePicker", t("Выбрать изображение", "Choose image"), 'data-field="dialoguePageArt"')}${page.art ? `<img class="ms-dialogue-art" src="${esc(page.art)}" alt="">` : ""}<h4>${t("Ответы", "Responses")}</h4>${page.responses.map((response, index) => `<fieldset class="ms-response-row" data-asset-response="${index}">${input("responseLabel", t("Ответ", "Response"), response.label, "required")}<div class="ms-grid-two"><label class="ms-field">${t("Продолжение", "Continue to")}<select name="responseNextPage">${options(draft.pages, response.nextPageId, t("Завершить диалог", "Finish dialogue"))}</select></label><label class="ms-field">${t("Сигнал ответа", "Response signal")}<select name="responseSignal">${options(catalog.signals.filter((signal) => signal.emitterKey === `Dialogue:${draft.id}`).map((signal) => ({id:signal.id,name:signal.name})), response.signalId, t("Без сигнала", "No signal"))}</select></label></div>${textarea("responseParameters", t("Параметры сигнала (JSON)", "Signal parameters (JSON)"), JSON.stringify(response.parameters ?? {}))}${readOnly ? "" : button("removeAssetResponse", t("Убрать ответ", "Remove response"), `data-index="${index}"`)}</fieldset>`).join("")}<p class="ms-note">${t("«Уйти» доступно игроку всегда и не отправляет сигнал.", "Leave is always available and sends no signal.")}</p>${readOnly ? "" : button("addAssetResponse", t("+ Ответ", "+ Response"))}</section>`;
    html += renderDialogueGraph(draft.pages, draft.startPageId);
  }
  const editing = readOnly ? "" : `${isShop ? "" : `<div class="ms-asset-actions">${button("addAssetPage", t("+ Блок", "+ Page"))}${button("deleteAssetPage", t("Удалить блок", "Delete page"))}</div>`}${generics.components.renderJSONControls({ id: "asset-selection", importLabel: t("Импорт JSON", "Import JSON"), exportLabel: t("Экспорт JSON", "Export JSON") })}<footer class="ms-ide-save"><span data-save-status class="ms-note"></span>${button("discardParameters", t("Отменить ввод", "Discard edits"))}<button type="submit">${t("Сохранить", "Save")}</button></footer>`;
  return `<form data-screen-form="saveParameters" data-ide-parameters data-asset-form="${kind}"><fieldset ${readOnly ? "disabled" : ""}>${html}</fieldset>${editing}</form>${button("previewAsset", t("Предпросмотр с условиями", "Preview with conditions"))}${isShop ? button("shops", t("Состояния торговли", "Trade sessions")) : button("previewAssetDialogue", t("Посмотреть диалог", "View dialogue"))}${renderAssetBindings(kind, draft.id, bindings, objects, definitions, scene)}`;
}

export function readAssetForm(root, draft, kind) {
  const result = structuredClone(draft), value = (name) => formValue(root, name);
  result.name = value("assetName").trim();
  const description = value("assetDescription");
  if (description !== localizedDescription(result.description)) result.description = description;
  if (kind === "shop") {
    result.img = value("shopImg").trim(); result.display = value("shopDisplay"); result.requireGMApproval = root.querySelector('[name="shopApproval"]')?.checked === true;
    for (const input of root.querySelectorAll('[name="shopStock"]')) {
      if (!input.checkValidity() || input.value === "") throw new Error(t("Остаток товара должен быть целым неотрицательным числом.", "Item stock must be a non-negative integer."));
      const item = result.items.find((entry) => entry.id === input.dataset.entryId); if (item) item.stock = Number(input.value);
    }
  } else {
    result.startPageId = value("dialogueStartPage");
    const page = result.pages.find((entry) => entry.id === root.querySelector("[data-asset-page]")?.dataset.assetPage);
    if (page) {
      page.name = value("dialoguePageName").trim(); page.text = value("dialoguePageText"); page.art = value("dialoguePageArt").trim();
      page.responses = [...root.querySelectorAll("[data-asset-response]")].map((row) => ({ ...page.responses[Number(row.dataset.assetResponse)], label: row.querySelector('[name="responseLabel"]').value.trim(), nextPageId: row.querySelector('[name="responseNextPage"]').value, signalId: row.querySelector('[name="responseSignal"]').value, parameters: JSON.parse(row.querySelector('[name="responseParameters"]')?.value || "{}") }));
    }
  }
  return result;
}
