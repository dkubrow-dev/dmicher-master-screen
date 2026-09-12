import { generics } from "../generics.js";
import { localizedDescription } from "../model.js";
import { getObjectTags } from "../store.js";

const esc = generics.utilities.escapeHTML;
const button = (action, label, attributes = "") => `<button type="button" data-screen-action="${action}" ${attributes}>${esc(label)}</button>`;
const input = (name, label, value = "", attributes = "") => `<label class="ms-field">${esc(label)}<input name="${name}" value="${esc(value)}" ${attributes}></label>`;
const textarea = (name, label, value = "", rows = 2) => `<label class="ms-field">${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
const options = (rows, value, blank) => `${blank !== undefined ? `<option value="">${esc(blank)}</option>` : ""}${rows.map((row) => `<option value="${esc(row.id)}" ${value === row.id ? "selected" : ""}>${esc(row.name)}</option>`).join("")}`;
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
  return `<section class="ms-asset-bindings"><h4>Привязанные объекты · ${rows.length}</h4>${rows.length ? `<table class="ms-asset-table"><thead><tr><th>Объект</th><th>Состояния и допуск</th></tr></thead><tbody>${rows.map((binding) => {
    const object = objects.find((item) => item.type === binding.type && item.id === binding.id);
    const definition = definitions.find((item) => item.groupId === binding.groupId), config = binding.config;
    const states = (config.stateIds ?? []).map((id) => definition?.states.find((state) => state.id === id)?.name ?? id).join(", ") || "Все состояния группы";
    const actor = binding.type === "Token" ? scene?.tokens?.get(binding.id)?.actor : null;
    const eligible = matchingActorTokens(scene, bindings, config.conditions);
    return `<tr><td>${button("objectInfo", object?.name ?? binding.id, `data-object-type="${esc(binding.type)}" data-object-id="${esc(binding.id)}"`)}${actor ? `<small>Персонаж: ${esc(actor.name ?? actor.id)}</small>` : ""}</td><td>${esc(definition?.groupName ?? "Без группы")} · ${esc(states)}<small>Белые теги: ${esc(tagNames(config.conditions?.allowTags))}<br>Чёрные теги: ${esc(tagNames(config.conditions?.denyTags))}</small><details><summary>Токены с Actor по тегам · ${eligible.length}</summary>${eligible.map((token) => `<small>${esc(token.name)} · ${esc(token.actorName)}</small>`).join("")}<small>Дальность, видимость и состояние проверяются при взаимодействии.</small></details></td></tr>`;
  }).join("")}</tbody></table>` : '<p class="ms-note">Магазин или диалог назначается объекту через «Поведение → Особенности». Одним каталогом могут пользоваться несколько объектов.</p>'}</section>`;
}

export function renderOwnedObjects(groupId, bindings, objects, readOnly = false) {
  const owned = bindings.filter((entry) => entry.groupId === groupId);
  const available = objects.filter((entry) => !owned.some((binding) => binding.type === entry.type && binding.id === entry.id));
  return `<section class="ms-owned-objects"><h4>Управляемые объекты · ${owned.length}</h4><table class="ms-asset-table"><tbody>${owned.map((binding) => {
    const object = objects.find((entry) => entry.type === binding.type && entry.id === binding.id);
    return `<tr><td>${button("objectInfo", object?.name ?? binding.id, `data-object-type="${esc(binding.type)}" data-object-id="${esc(binding.id)}"`)}<small>${esc(binding.type)} · ${esc(binding.id)}</small></td><td>${readOnly ? "" : button("unassignObject", "Отвязать", `data-object-type="${esc(binding.type)}" data-object-id="${esc(binding.id)}"`)}</td></tr>`;
  }).join("") || '<tr><td>Объекты ещё не привязаны.</td></tr>'}</tbody></table>${readOnly ? "" : `<div class="ms-asset-add-object"><label class="ms-field">Объект сцены<select name="newOwnedObject">${options(available.map((entry) => ({ id: `${entry.type}:${entry.id}`, name: `${entry.name} · ${entry.type}` })), "", "Выберите объект")}</select></label>${button("assignObject", "Привязать")}</div>`}</section>`;
}

function renderShopItems(draft, readOnly) {
  const groups = new Map();
  for (const item of draft.items ?? []) {
    const category = globalThis.game?.i18n?.localize(globalThis.CONFIG?.Item?.typeLabels?.[item.data.type] ?? item.data.type) ?? item.data.type;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  return `<div data-shop-stock-drop class="ms-asset-stock ${draft.display === "tiles" ? "is-tiles" : ""}">${[...groups].map(([category, items]) => `<section><h4>${esc(category)}</h4><div class="ms-stock-items">${items.map((item) => `<div class="ms-stock-entry" data-shop-entry="${esc(item.id)}"><img src="${esc(item.data.img || "icons/svg/item-bag.svg")}" alt=""><span>${esc(item.data.name)}</span><label class="ms-field">Начальный запас<input type="number" min="0" step="1" name="shopStock" data-entry-id="${esc(item.id)}" value="${item.stock}" ${readOnly ? "disabled" : ""}></label>${readOnly ? "" : button("removeShopItem", "×", `data-id="${esc(item.id)}" aria-label="Убрать товар"`)}</div>`).join("")}</div></section>`).join("") || '<p class="ms-note">Перетащите сюда предметы из каталога Foundry или листа персонажа. Сохраняется копия предмета; инвентарь источника не меняется.</p>'}</div>`;
}

export function renderDialogueGraph(pages, startPageId) {
  return `<details class="ms-details ms-dialogue-graph"><summary>Переходы между блоками</summary><ul>${pages.map((page) => `<li><strong>${page.id === startPageId ? "▶ " : ""}${esc(page.name)}</strong><ul>${page.responses.map((response) => `<li>${esc(response.label)} → ${esc(response.nextPageId ? pages.find((item) => item.id === response.nextPageId)?.name ?? "Недоступный блок" : "Завершить")}${response.signalId ? ` · ${esc(response.signalId)}` : ""}</li>`).join("")}<li>Уйти → завершить без сигнала</li></ul></li>`).join("")}</ul></details>`;
}

export function renderAssetForm({ kind, draft, pageId, mode, catalog, bindings, objects, definitions, scene }) {
  if (!draft) return '<p class="ms-note">Создайте или выберите элемент в списке.</p>';
  const readOnly = mode !== "constructor", isShop = kind === "shop";
  if (readOnly) {
    const page = draft.pages?.find((entry) => entry.id === pageId) ?? draft.pages?.[0];
    return `<h3>${esc(draft.name)}</h3><p>${esc(localizedDescription(draft.description))}</p>${button("previewAsset", "Предпросмотр с условиями")}${isShop ? renderShopItems(draft, true) + button("shops", "Состояния торговли") : `<nav class="ms-dialogue-page-tabs">${draft.pages.map((entry) => button("selectAssetPage", entry.name, `data-id="${esc(entry.id)}" aria-pressed="${entry.id === page?.id}"`)).join("")}</nav>${page?.art ? `<img class="ms-dialogue-art" src="${esc(page.art)}" alt="">` : ""}<p class="ms-dialogue-text">${esc(page?.text ?? "")}</p>${renderDialogueGraph(draft.pages, draft.startPageId)}${button("previewAssetDialogue", "Посмотреть диалог")}`}${renderAssetBindings(kind, draft.id, bindings, objects, definitions, scene)}`;
  }
  let html = input("assetName", "Название", draft.name, 'required maxlength="100"') + textarea("assetDescription", "Описание", localizedDescription(draft.description));
  if (isShop) {
    html += input("shopImg", "Изображение магазина", draft.img ?? "") + button("assetFilePicker", "Выбрать изображение", 'data-field="shopImg"') + `<label class="ms-field">Отображение товаров<select name="shopDisplay">${options([{ id: "list", name: "По категориям" }, { id: "tiles", name: "Плитки" }], draft.display)}</select></label><label class="ms-check"><input type="checkbox" name="shopApproval" ${draft.requireGMApproval !== false ? "checked" : ""}> Подтверждение мастера</label><h4>Товары</h4><p class="ms-note">Начальный запас применяется при первом открытии магазина. Изменение подготовки не восстанавливает уже потраченные товары; текущий остаток виден в торговле.</p>${renderShopItems(draft, readOnly)}`;
  } else {
    const page = draft.pages.find((entry) => entry.id === pageId) ?? draft.pages[0];
    html += `<label class="ms-field">Первый блок<select name="dialogueStartPage">${options(draft.pages, draft.startPageId)}</select></label>`;
    html += `<nav class="ms-dialogue-page-tabs">${draft.pages.map((entry) => button("selectAssetPage", entry.name, `data-id="${esc(entry.id)}" aria-pressed="${entry.id === page?.id}"`)).join("")}</nav>`;
    if (page) html += `<section data-asset-page="${esc(page.id)}">${input("dialoguePageName", "Название блока", page.name, "required")}${textarea("dialoguePageText", "Текст блока", page.text, 4)}${input("dialoguePageArt", "Изображение блока", page.art ?? "")}${button("assetFilePicker", "Выбрать изображение", 'data-field="dialoguePageArt"')}${page.art ? `<img class="ms-dialogue-art" src="${esc(page.art)}" alt="">` : ""}<h4>Ответы</h4>${page.responses.map((response, index) => `<fieldset class="ms-response-row" data-asset-response="${index}">${input("responseLabel", "Ответ", response.label, "required")}<div class="ms-grid-two"><label class="ms-field">Продолжение<select name="responseNextPage">${options(draft.pages, response.nextPageId, "Завершить диалог")}</select></label><label class="ms-field">Сигнал ответа<select name="responseSignal">${options(catalog.signals.filter((signal) => signal.emitterKey === `Dialogue:${draft.id}`).map((signal) => ({id:signal.id,name:signal.name})), response.signalId, "Без сигнала")}</select></label></div>${textarea("responseParameters", "\u041f\u0430\u0440\u0430\u043c\u0435\u0442\u0440\u044b \u0441\u0438\u0433\u043d\u0430\u043b\u0430 (JSON)", JSON.stringify(response.parameters ?? {}))}${readOnly ? "" : button("removeAssetResponse", "Убрать ответ", `data-index="${index}"`)}</fieldset>`).join("")}<p class="ms-note">«Уйти» доступно игроку всегда и не отправляет сигнал.</p>${readOnly ? "" : button("addAssetResponse", "+ Ответ")}</section>`;
    html += renderDialogueGraph(draft.pages, draft.startPageId);
  }
  const editing = readOnly ? "" : `${isShop ? "" : `<div class="ms-asset-actions">${button("addAssetPage", "+ Блок")}${button("deleteAssetPage", "Удалить блок")}</div>`}${generics.components.renderJSONControls({ id: "asset-selection", importLabel: "Импорт JSON", exportLabel: "Экспорт JSON" })}<footer class="ms-ide-save"><span data-save-status class="ms-note"></span>${button("discardParameters", "Отменить ввод")}<button type="submit">Сохранить</button></footer>`;
  return `<form data-screen-form="saveParameters" data-ide-parameters data-asset-form="${kind}"><fieldset ${readOnly ? "disabled" : ""}>${html}</fieldset>${editing}</form>${button("previewAsset", "Предпросмотр с условиями")}${isShop ? button("shops", "Состояния торговли") : button("previewAssetDialogue", "Посмотреть диалог")}${renderAssetBindings(kind, draft.id, bindings, objects, definitions, scene)}`;
}

export function readAssetForm(root, draft, kind) {
  const result = structuredClone(draft), value = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
  result.name = value("assetName").trim();
  const description = value("assetDescription");
  if (description !== localizedDescription(result.description)) result.description = description;
  if (kind === "shop") {
    result.img = value("shopImg").trim(); result.display = value("shopDisplay"); result.requireGMApproval = root.querySelector('[name="shopApproval"]')?.checked === true;
    for (const input of root.querySelectorAll('[name="shopStock"]')) {
      if (!input.checkValidity() || input.value === "") throw new Error("Остаток товара должен быть целым неотрицательным числом.");
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
