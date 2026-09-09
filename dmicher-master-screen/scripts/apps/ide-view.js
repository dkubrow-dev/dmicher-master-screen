import { generics } from "../generics.js";
import { MAIN_MENU, DETAIL_MENU, leaves, menuRows, menuPath } from "./navigation-tree.js";
import { localizedDescription } from "../model.js";

const esc = generics.utilities.escapeHTML;
export const TAB_LABELS = Object.freeze({ scene: "Сцена", shops: "Магазины", dialogues: "Диалоги", events: "События", macros: "Макросы", sources: "Источники", other: "Иное", parameters: "Параметры", reference: "Подсказка" });
export const OTHER_BLOCKS = Object.freeze([
  { id: "tokens", name: "НИП и поведение", mode: "constructor" },
  { id: "tags", name: "Теги объектов", mode: "constructor" },
  { id: "subscriptions", name: "Прежние реакции эпизода", mode: "constructor" },
  { id: "entry", name: "Пауза, звук и подкрепление", mode: "constructor" },
  { id: "zones", name: "Зоны перехода", mode: "constructor" },
  { id: "workspaceGM", name: "Рабочий стол мастера", mode: "constructor" },
  { id: "workspacePlayers", name: "Окна игроков", mode: "constructor" },
  { id: "sceneIO", name: "Перенос всей сцены", mode: "constructor" },
  { id: "playback", name: "Переход и бой", mode: "director" },
  { id: "automation", name: "Автоматизация НИП", mode: "director" },
  { id: "counts", name: "Допуск и счётчики", mode: "director" },
  { id: "journal", name: "Журнал событий", mode: "director" },
  { id: "manual", name: "Ручное ведение сцены", mode: "director" }
]);
const input = (name, label, value = "", extra = "") => `<label class="ms-field">${esc(label)}<input name="${name}" value="${esc(value ?? "")}" ${extra}></label>`;
const button = (action, label, extra = "") => `<button type="button" data-screen-action="${action}" ${extra}>${esc(label)}</button>`;
const options = (rows, selected, blank = "") => `${blank ? `<option value="">${esc(blank)}</option>` : ""}${rows.map((row) => `<option value="${esc(row.id ?? row.value)}" ${String(row.id ?? row.value) === String(selected) ? "selected" : ""}>${esc(row.name ?? row.label)}</option>`).join("")}`;
const select = (name, label, rows, selected, blank = "") => `<label class="ms-field">${esc(label)}<select name="${name}">${options(rows, selected, blank)}</select></label>`;
const descriptionField = (description, name = "description") => `<label class="ms-field">${name === "parameterDescription" ? "Описание параметра" : "Описание"}<textarea name="${name}" rows="2" maxlength="8000">${esc(localizedDescription(description))}</textarea></label>`;
const colorStyle = (entry) => {
  const valid = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
  return `background:${valid(entry.background, "#26303C")};color:${valid(entry.textColor, "#FFFFFF")}`;
};

export function renderSceneTree(definitions, runtimes, selection, mode) {
  const rows = [];
  for (const definition of definitions) {
    const active = runtimes.find((runtime) => runtime.schemeId === definition.schemeId);
    const selected = selection.kind === "scheme" && selection.id === definition.schemeId;
    rows.push(`<tr role="row" aria-level="1" aria-selected="${selected}" class="${selected ? "is-selected" : ""}" data-select-kind="scheme" data-select-id="${esc(definition.schemeId)}" data-ide-kind="scheme" data-ide-id="${esc(definition.schemeId)}" data-scheme-id="${esc(definition.schemeId)}" draggable="${mode === "constructor"}">
      <td><button type="button" class="ms-tree-toggle" data-screen-action="foldScheme" data-scheme-id="${esc(definition.schemeId)}" aria-label="Свернуть или раскрыть схему" aria-expanded="true">▾</button><button type="button" class="ms-tree-name" data-screen-action="selectNode" data-kind="scheme" data-id="${esc(definition.schemeId)}" data-scheme-id="${esc(definition.schemeId)}"><span class="ms-color-swatch" style="${colorStyle(definition)}">${esc(definition.symbol ?? "🎬")}</span>${esc(definition.schemeName)}</button></td>
      <td>${mode === "director" ? `<span class="ms-note">${active?.halted ? "Остановлена" : active?.episodeId ? "Работает" : "Не запущена"}</span>` : `${definition.episodes.length}`}</td></tr>`);
    for (const episode of definition.episodes) {
      const chosen = selection.kind === "episode" && selection.id === episode.id && selection.schemeId === definition.schemeId;
      rows.push(`<tr role="row" aria-level="2" aria-selected="${chosen}" class="${chosen ? "is-selected" : ""} ${active?.episodeId === episode.id ? "is-active" : ""}" data-select-kind="episode" data-select-id="${esc(episode.id)}" data-ide-kind="episode" data-ide-id="${esc(episode.id)}" data-scheme-id="${esc(definition.schemeId)}" draggable="${mode === "constructor"}"><td><button type="button" class="ms-tree-name ms-tree-child" data-screen-action="selectNode" data-kind="episode" data-id="${esc(episode.id)}" data-scheme-id="${esc(definition.schemeId)}"><span class="ms-color-swatch" style="${colorStyle(episode)}">${active?.episodeId === episode.id ? "●" : "○"}</span>${esc(episode.name)}</button></td><td>${mode === "director" ? button("enterNode", active?.episodeId === episode.id ? "Заново" : "Войти", `data-scheme-id="${esc(definition.schemeId)}" data-id="${esc(episode.id)}" title="Явный вход в эпизод"`) : `${(episode.events ?? []).length} соб.`}</td></tr>`);
    }
  }
  return `<table class="ms-ide-tree" role="treegrid" aria-label="Схемы и эпизоды"><tbody>${rows.join("")}</tbody></table>`;
}

export function renderEventTree(catalog, selection, mode) {
  const rows = [];
  for (const event of catalog.events) {
    const selected = selection.kind === "event" && selection.id === event.id;
    rows.push(`<tr role="row" aria-level="1" aria-selected="${selected}" class="${selected ? "is-selected" : ""}" data-select-kind="event" data-select-id="${esc(event.id)}"><td><button class="ms-tree-name" type="button" data-screen-action="selectNode" data-kind="event" data-id="${esc(event.id)}">◇ ${esc(event.name)}</button></td><td>${event.builtin ? "Встроенное" : ""}</td></tr>`);
    for (const trigger of catalog.triggers.filter((item) => item.eventId === event.id)) {
      const chosen = selection.kind === "trigger" && selection.id === trigger.id;
      rows.push(`<tr role="row" aria-level="2" aria-selected="${chosen}" class="${chosen ? "is-selected" : ""}" data-select-kind="trigger" data-select-id="${esc(trigger.id)}"><td><button class="ms-tree-name ms-tree-child" type="button" data-screen-action="selectNode" data-kind="trigger" data-id="${esc(trigger.id)}">↳ ${esc(trigger.name)}</button></td><td>${trigger.parameters.length} пол.</td></tr>`);
    }
  }
  return `<table class="ms-ide-tree" role="treegrid" aria-label="События и типы триггеров"><tbody>${rows.join("") || '<tr><td>Пока нет событий</td></tr>'}</tbody></table>${mode === "director" ? '<p class="ms-note">Выберите триггер для ручного вызова события.</p>' : ""}`;
}

export function renderMacroList(catalog, selection, resolveMacro = () => null) {
  return `<div class="ms-macro-list" data-macro-drop>${catalog.macros.map((macro) => {
    const doc = resolveMacro(macro.uuid);
    return `<div class="ms-ide-list-row ${selection.kind === "macro" && selection.id === macro.uuid ? "is-selected" : ""}" data-select-kind="macro" data-select-id="${esc(macro.uuid)}" draggable="true" data-macro-uuid="${esc(macro.uuid)}"><button class="ms-tree-name" type="button" data-screen-action="selectNode" data-kind="macro" data-id="${esc(macro.uuid)}">⌘ ${esc(doc?.name ?? macro.uuid)}${doc ? "" : " · недоступен"}</button>${button("editMacro", "Править", `data-uuid="${esc(macro.uuid)}"`)}</div>`;
  }).join("")}<p class="ms-note">Перетащите сюда макрос из каталога Foundry.</p></div>`;
}

function colorFields(entry) {
  const displayColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
  return `<div class="ms-ide-colors">${generics.components.renderColorField({ name: "background", value: displayColor(entry.background, "#26303C"), label: "Цвет фона" })}${generics.components.renderColorField({ name: "textColor", value: displayColor(entry.textColor, "#FFFFFF"), label: "Цвет текста" })}</div>`;
}

export function renderParameters({ selection, draft, catalog, definitions, mode }) {
  if (!draft) return '<p class="ms-note">Выберите элемент в основной зоне.</p>';
  const readOnly = draft.builtin || (mode === "director" && !["scheme", "episode", "trigger"].includes(selection.kind));
  const kind = selection.kind;
  let html = "";
  if (kind === "scheme" || kind === "episode") {
    const isScheme = kind === "scheme";
    if (mode === "director") {
      const definition = definitions.find((entry) => entry.schemeId === selection.schemeId);
      html = `<h3 style="${colorStyle(draft)}" class="ms-node-heading">${esc(isScheme ? draft.schemeName : draft.name)}</h3><p class="ms-note">Мастер может выбрать любой эпизод. Автоматические переходы используют список событий.</p>`;
      if (isScheme) html += select("resumeEpisode", "Возобновить с эпизода", definition?.episodes ?? [], "", "Выберите эпизод") + button("resumeSelectedScheme", "Возобновить") + button("haltSelectedScheme", "Остановить схему");
      else html += button("enterSelectedEpisode", "Перейти в этот эпизод") + button("haltSelectedScheme", "Остановить схему");
      return html + `<p class="ms-note">${esc(localizedDescription(draft.description))}</p>`;
    }
    html += input(isScheme ? "schemeName" : "name", "Название", isScheme ? draft.schemeName : draft.name, 'required maxlength="120"');
    if (isScheme) html += input("schemeSymbol", "Символ схемы", draft.symbol ?? "🎬", 'required aria-describedby="ms-symbol-hint"') + '<p id="ms-symbol-hint" class="ms-note">Один символ, в том числе составной эмоджи.</p>';
    html += descriptionField(draft.description);
    html += colorFields(draft);
    if (!isScheme) {
      html += `<label class="ms-check"><input name="stop" type="checkbox" ${draft.stop ? "checked" : ""}> Остановка автоматизации</label><h4>События перехода</h4><p class="ms-note">Внутри схемы одно событие ведёт только к одному эпизоду.</p><div class="ms-ide-binding-list">${(draft.events ?? []).map((name, index) => `<div class="ms-ide-list-row"><span>${esc(catalog.events.find((event) => event.id === name)?.name ?? name)}</span>${button("removeEpisodeEvent", "Убрать", `data-index="${index}"`)}</div>`).join("")}</div>${select("newEpisodeEvent", "Событие", catalog.events, "", "Выберите событие")}${button("addEpisodeEvent", "Добавить событие")}`;
    }
    html += generics.components.renderJSONControls({ id: "selection", importLabel: "Импорт JSON", exportLabel: "Экспорт JSON" });
  } else if (kind === "event") {
    html += input("eventName", "Название события", draft.name, 'required maxlength="100"');
    html += descriptionField(draft.description);
    html += `<h4>Подписанты · порядок выполнения</h4><div class="ms-subscriber-list">${(draft.subscribers ?? []).map((subscriber, index) => renderSubscriber(subscriber, index, catalog, definitions)).join("")}</div>${button("addSubscriber", "Добавить подписанта")}`;
    html += generics.components.renderJSONControls({ id: "selection", importLabel: "Импорт JSON", exportLabel: "Экспорт JSON" });
  } else if (kind === "trigger") {
    if (mode === "director") {
      const parent = catalog.events.find((entry) => entry.id === draft.eventId);
      return `<h3>${esc(draft.name)}</h3><p class="ms-note">Событие: ${esc(parent?.name ?? draft.eventId)}</p>${draft.parameters.map((parameter) => renderTriggerValue(parameter)).join("")}${button("invokeTrigger", "Вызвать событие")}`;
    }
    html += input("triggerName", "Название триггера", draft.name, 'required maxlength="100"');
    html += descriptionField(draft.description);
    html += select("triggerEventId", "Принадлежит событию", catalog.events, draft.eventId);
    html += `<h4>Типизированные параметры</h4>${(draft.parameters ?? []).map((parameter, index) => renderParameterSchema(parameter, index)).join("")}${button("addParameter", "Добавить параметр")}`;
    html += generics.components.renderJSONControls({ id: "selection", importLabel: "Импорт JSON", exportLabel: "Экспорт JSON" });
  } else if (kind === "macro") {
    html += `<p class="ms-note">${esc(draft.uuid)}</p>${button("editMacro", "Открыть редактор Foundry", `data-uuid="${esc(draft.uuid)}"`)}<h4>Принимаемые триггеры</h4>${catalog.triggers.map((trigger) => `<label class="ms-check"><input type="checkbox" name="macroTrigger" value="${esc(trigger.id)}" ${(draft.triggerIds ?? []).includes(trigger.id) ? "checked" : ""}> ${esc(trigger.name)}</label>`).join("") || '<p class="ms-note">Сначала создайте триггер события.</p>'}`;
  }
  return `<form data-screen-form="saveParameters" data-ide-parameters><fieldset ${readOnly ? "disabled" : ""}>${html}</fieldset>${readOnly ? '<p class="ms-note">Встроенные определения доступны только для просмотра и вызова.</p>' : `<footer class="ms-ide-save"><span data-save-status class="ms-note"></span>${button("discardParameters", "Отменить ввод")}<button type="submit">Сохранить</button></footer>`}</form>`;
}

export function renderParameterSchema(parameter, index) {
  const numeric = ["integer", "number"].includes(parameter.type);
  return `<fieldset class="ms-parameter-row" data-parameter-index="${index}"><div class="ms-grid-two">${input("parameterName", "Имя поля", parameter.name, 'required pattern="[A-Za-z_][A-Za-z0-9_]*"')}${select("parameterType", "Тип", [{ id: "string", name: "Текст" }, { id: "integer", name: "Целое число" }, { id: "number", name: "Дробное число" }, { id: "boolean", name: "Логическое" }], parameter.type)}</div><div class="ms-grid-two">${parameter.type === "string" ? input("minLength", "Минимальная длина", parameter.minLength, 'type="number" min="0" step="1"') + input("maxLength", "Максимальная длина", parameter.maxLength, 'type="number" min="0" step="1"') : ""}${numeric ? input("min", "Минимум", parameter.min, 'type="number" step="any"') + input("max", "Максимум", parameter.max, 'type="number" step="any"') : ""}${parameter.type === "number" ? input("decimals", "Знаков после запятой", parameter.decimals, 'type="number" min="0" max="12" step="1"') : ""}</div>${parameter.type === "boolean" ? '<p class="ms-note">Значение true или false задаётся при вызове триггера.</p>' : ""}${descriptionField(parameter.description, "parameterDescription")}${button("removeParameter", "Убрать поле", `data-index="${index}"`)}</fieldset>`;
}

export function renderTriggerValue(parameter) {
  const name = esc(parameter.name);
  if (parameter.type === "boolean") return `<label class="ms-check"><input type="checkbox" data-trigger-value="${name}"> ${name}</label>`;
  if (parameter.type === "string") return `<label class="ms-field">${name}<input data-trigger-value="${name}" minlength="${parameter.minLength ?? 0}" ${parameter.maxLength !== undefined ? `maxlength="${parameter.maxLength}"` : ""}></label>`;
  return `<label class="ms-field">${name}<input type="number" data-trigger-value="${name}" step="${parameter.type === "integer" ? 1 : "any"}" ${parameter.min !== undefined ? `min="${parameter.min}"` : ""} ${parameter.max !== undefined ? `max="${parameter.max}"` : ""} required></label>`;
}

function renderSubscriber(subscriber, index, catalog, definitions) {
  let target = "";
  if (subscriber.kind === "macro") target = select("subscriberMacro", "Макрос", catalog.macros.map((macro) => ({ id: macro.uuid, name: globalThis.game?.macros?.get(macro.uuid.split(".").pop())?.name ?? macro.uuid })), subscriber.macroUuid, "Выберите макрос");
  else if (subscriber.kind === "trigger") target = select("subscriberTrigger", "Вызываемый триггер", catalog.triggers, subscriber.triggerId, "Выберите триггер");
  else {
    target = select("subscriberAction", "Действие", [{ id: "pause", name: "Поставить игру на паузу" }, { id: "unpause", name: "Снять паузу" }, { id: "halt-scheme", name: "Остановить схему" }, { id: "halt-all", name: "Остановить всю сцену" }, { id: "chat", name: "Сообщение в чат" }], subscriber.action);
    if (subscriber.action === "halt-scheme") target += select("subscriberScheme", "Схема", definitions.map((item) => ({ id: item.schemeId, name: item.schemeName })), subscriber.schemeId);
    if (subscriber.action === "chat") target += `<label class="ms-field">Текст сообщения<textarea name="subscriberText" rows="2">${esc(subscriber.text ?? "")}</textarea></label><div class="ms-grid-two"><label class="ms-check"><input type="checkbox" name="subscriberGMs" ${subscriber.audience?.gms !== false ? "checked" : ""}> Мастерам</label><label class="ms-check"><input type="checkbox" name="subscriberInteractor" ${subscriber.audience?.interactor ? "checked" : ""}> Участнику действия</label><label class="ms-check"><input type="checkbox" name="subscriberNearby" ${subscriber.audience?.nearby ? "checked" : ""}> Игрокам рядом</label><label class="ms-check"><input type="checkbox" name="subscriberVisible" ${subscriber.audience?.visibleOnly !== false ? "checked" : ""}> В пределах видимости</label></div>${input("subscriberRange", "Дальность", subscriber.audience?.range ?? 30, 'type="number" min="0" step="any"')}`;
  }
  const parameters = subscriber.kind === "trigger" ? `<label class="ms-field">Статические параметры (JSON)<textarea name="subscriberParameters" rows="2" spellcheck="false">${esc(JSON.stringify(subscriber.parameters ?? {}, null, 2))}</textarea></label>` : "";
  return `<fieldset class="ms-subscriber-row" data-subscriber-index="${index}" data-macro-subscriber-drop><div class="ms-ide-list-row"><strong>${index + 1}.</strong><span class="ms-ide-inline-actions">${button("moveSubscriber", "↑", `data-index="${index}" data-delta="-1" aria-label="Выше"`)}${button("moveSubscriber", "↓", `data-index="${index}" data-delta="1" aria-label="Ниже"`)}${button("removeSubscriber", "×", `data-index="${index}" aria-label="Удалить подписанта"`)}</span></div>${select("subscriberKind", "Тип подписанта", [{ id: "builtin", name: "Встроенный функционал" }, { id: "macro", name: "Макрос" }, { id: "trigger", name: "Вызвать триггер" }], subscriber.kind)}${target}${parameters}</fieldset>`;
}

export function renderOtherList(mode, selected) {
  return OTHER_BLOCKS.filter((block) => block.mode === mode).map((block) => `<button class="ms-ide-block-link ${selected === block.id ? "is-selected" : ""}" type="button" data-screen-action="selectOther" data-id="${block.id}">${esc(block.name)}</button>`).join("");
}

export function renderMenu(zone, hidden, active, branch) {
  const tree = zone === "main" ? MAIN_MENU : DETAIL_MENU;
  const visible = (node) => leaves([node]).some((id) => !hidden.includes(id));
  const level = (nodes, depth) => {
    const id = `${zone}-${depth}`;
    return `<div class="ms-menu-level"><button type="button" data-screen-action="scrollMenu" data-menu-id="${id}" data-direction="-1" class="ms-menu-arrow" aria-label="Предыдущие вкладки">‹</button><nav class="ms-menu-strip" data-menu-strip="${id}" aria-label="${zone === "main" ? "Основные вкладки" : "Дополнительные вкладки"}">${nodes.filter(visible).map((node) => `<button type="button" data-screen-action="${node.children ? "menuCategory" : "ideTab"}" data-zone="${zone}" data-id="${node.id}" ${node.children ? `aria-expanded="${branch === node.id}"` : `aria-pressed="${active === node.id}"`} class="${node.children && leaves([node]).includes(active) ? "has-active-child" : ""}">${esc(node.label)}${node.children ? " ▾" : ""}</button>`).join("")}</nav><button type="button" data-screen-action="scrollMenu" data-menu-id="${id}" data-direction="1" class="ms-menu-arrow" aria-label="Следующие вкладки">›</button></div>`;
  };
  const expanded = menuPath(tree, branch).filter((node) => node.children && visible(node));
  return level(tree, 0) + expanded.map((node, index) => level(node.children, index + 1)).join("");
}

export function renderMenuSettings(zone, hidden) {
  const nodes = zone === "main" ? MAIN_MENU : DETAIL_MENU;
  return `<table class="ms-menu-settings-table" role="treegrid" aria-label="Состав меню"><tbody>${menuRows(nodes, hidden).map((node) => `<tr role="row" aria-level="${node.depth + 1}" data-menu-setting-row="${node.id}"><td style="padding-inline-start:${8 + node.depth * 22}px"><label><input type="checkbox" data-menu-visible="${node.id}" ${node.checked ? "checked" : ""} ${node.partial ? 'data-indeterminate="true"' : ""}> <span>${esc(node.label)}</span>${node.category ? '<small>Категория</small>' : ""}</label></td></tr>`).join("")}</tbody></table>`;
}

/** Existing sources are described, never synthesized or enabled by opening this list. */
export function eventSources(definitions, scene) {
  const rows = [];
  const names = (...values) => [...new Set(values.flat().filter(Boolean))].join(", ");
  const add = (definition, episode, type, id, name, detail, tokenId) => rows.push({ id: `${definition.schemeId}:${episode.id}:${type}:${id}`, name, type, detail, tokenId, schemeId: definition.schemeId, episodeId: episode.id, schemeName: definition.schemeName, episodeName: episode.name });
  for (const definition of definitions) for (const episode of definition.episodes) {
    add(definition, episode, "episode", episode.id, "Вход в эпизод", "episode.entered");
    for (const zone of episode.zones ?? []) add(definition, episode, "zone", zone.id, zone.label || "Зона", names("zone.entered", zone.eventName));
    for (const [id, token] of Object.entries(episode.tokens ?? {})) {
      const name = scene.tokens?.get(id)?.name ?? id;
      if (token.interaction?.targetEpisodeId || token.interaction?.eventName) add(definition, episode, "npc", id, `${name} · взаимодействие`, names("npc.interacted", token.interaction.eventName), id);
      if (token.patrol?.points?.length) add(definition, episode, "patrol", id, `${name} · патруль`, names("patrol.arrived", token.patrol.points.some((point) => point.macroUuid) ? "patrol.check" : null, token.patrol.points.map((point) => point.eventName)), id);
    }
    for (const dialogue of episode.dialogues ?? []) add(definition, episode, "dialogue", dialogue.id, dialogue.name, [...new Set(["dialogue.finished", ...dialogue.nodes.flatMap((node) => node.responses.map((response) => response.eventName).filter(Boolean))])].join(", "));
    for (const action of episode.interactions ?? []) add(definition, episode, "interaction", action.id, action.name, action.eventName || "Событие не выбрано");
  }
  return rows;
}

export function renderObjectList(rows, selected, kind) {
  return `<table class="ms-ide-tree" role="grid"><tbody>${rows.map((row) => `<tr data-select-kind="${kind}" data-select-id="${esc(row.id)}" data-scheme-id="${esc(row.schemeId ?? "")}" aria-selected="${selected.kind === kind && selected.id === row.id}" class="${selected.kind === kind && selected.id === row.id ? "is-selected" : ""}"><td><button type="button" class="ms-tree-name" data-screen-action="selectNode" data-kind="${kind}" data-id="${esc(row.id)}" data-scheme-id="${esc(row.schemeId ?? "")}">${esc(row.name)}</button></td><td title="${esc(row.schemeName ?? "")}">${esc(row.episodeName ?? row.detail ?? "")}</td></tr>`).join("") || '<tr><td>Нет элементов</td></tr>'}</tbody></table>`;
}

export function extractLegacyBlock(html, id, doc = globalThis.document) {
  const template = doc.createElement("template"); template.innerHTML = html;
  const block = [...template.content.querySelectorAll("[data-legacy-block]")].find((element) => element.dataset.legacyBlock === id);
  if (!block) return '<p class="ms-note">Выберите эпизод, затем нужный блок.</p>';
  if (block.tagName === "DETAILS") { block.open = true; block.querySelector(":scope > summary")?.remove(); }
  const editable = Boolean(block.closest("[data-episode-fields]"));
  if (!editable) return block.outerHTML;
  return `<form data-screen-form="saveEpisode" data-episode-fields data-legacy-block="${esc(id)}" class="ms-episode-form">${block.outerHTML}<footer class="ms-ide-save"><span data-save-status class="ms-note"></span>${button("discard", "Отменить ввод")}<button type="submit">Сохранить блок</button></footer></form>`;
}
