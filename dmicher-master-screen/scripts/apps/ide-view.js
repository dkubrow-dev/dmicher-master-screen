import { generics } from "../generics.js";
import { MAIN_MENU, DETAIL_MENU, leaves, menuRows, menuPath } from "./navigation-tree.js";
import { localizedDescription } from "../model.js";
import { renderSignalFields, renderSubscriptions, macroKey, emitterName } from "./signal-fields.js";
const t = (ru,en) => (globalThis.game?.i18n?.lang ?? "ru").startsWith("ru") ? ru : en;

const esc = generics.utilities.escapeHTML;
export const TAB_LABELS = Object.freeze({ scene: "Сцена", shops: "Магазины", dialogues: "Диалоги", signals: "Сигналы", macros: "Макросы", other: "Иное", parameters: "Параметры", reference: "Подсказка" });
export const OTHER_BLOCKS = Object.freeze([
  { id: "tokens", name: "НИП и поведение", mode: "constructor" },
  { id: "tags", name: "Теги объектов", mode: "constructor" },
  { id: "dialogues", name: "Прямые взаимодействия", mode: "constructor" },
  { id: "entry", name: "Пауза, звук и подкрепление", mode: "constructor" },
  { id: "zones", name: "Зоны событий", mode: "constructor" },
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
    const active = runtimes.find((runtime) => runtime.groupId === definition.groupId);
    const selected = selection.kind === "group" && selection.id === definition.groupId;
    rows.push(`<tr role="row" aria-level="1" aria-selected="${selected}" class="${selected ? "is-selected" : ""}" data-select-kind="group" data-select-id="${esc(definition.groupId)}" data-ide-kind="group" data-ide-id="${esc(definition.groupId)}" data-group-id="${esc(definition.groupId)}" draggable="${mode === "constructor"}">
      <td><button type="button" class="ms-tree-toggle" data-screen-action="foldGroup" data-group-id="${esc(definition.groupId)}" aria-label="Свернуть или раскрыть группу" aria-expanded="true">▾</button><button type="button" class="ms-tree-name" data-screen-action="selectNode" data-kind="group" data-id="${esc(definition.groupId)}" data-group-id="${esc(definition.groupId)}"><span class="ms-color-swatch" style="${colorStyle(definition)}">${esc(definition.symbol ?? "🎬")}</span>${esc(definition.groupName)}</button></td>
      <td>${mode === "director" ? `<span class="ms-note">${active?.halted ? "Остановлена" : active?.stateId ? "Работает" : "Не запущена"}</span>` : `${definition.states.length}`}</td></tr>`);
    for (const state of definition.states) {
      const chosen = selection.kind === "state" && selection.id === state.id && selection.groupId === definition.groupId;
      rows.push(`<tr role="row" aria-level="2" aria-selected="${chosen}" class="${chosen ? "is-selected" : ""} ${active?.stateId === state.id ? "is-active" : ""}" data-select-kind="state" data-select-id="${esc(state.id)}" data-ide-kind="state" data-ide-id="${esc(state.id)}" data-group-id="${esc(definition.groupId)}" draggable="${mode === "constructor"}"><td><button type="button" class="ms-tree-name ms-tree-child" data-screen-action="selectNode" data-kind="state" data-id="${esc(state.id)}" data-group-id="${esc(definition.groupId)}"><span class="ms-color-swatch" style="${colorStyle(state)}">${active?.stateId === state.id ? "●" : "○"}</span>${esc(state.name)}</button></td><td>${mode === "director" ? button("enterNode", active?.stateId === state.id ? "Заново" : "Войти", `data-group-id="${esc(definition.groupId)}" data-id="${esc(state.id)}" title="Явный вход в состояние"`) : ""}</td></tr>`);
    }
  }
  return `<table class="ms-ide-tree" role="treegrid" aria-label="Группы и состояния"><tbody>${rows.join("")}</tbody></table>`;
}

export function renderSignalTree(catalog, selection, mode, definitions = []) {
  const groups = [...definitions.map((group) => ({ id: group.groupId, name: group.groupName })), { id: null, name: t("Без группы", "Ungrouped") }];
  return `<div class="ms-signal-tree" role="tree">${groups.map((group) => {
    const emitters = catalog.emitters.filter((emitter) => (emitter.groupId ?? null) === group.id);
    if (!emitters.length) return "";
    return `<details open><summary>${esc(group.name)}</summary>${emitters.map((emitter) => `<details open data-emitter-node="${esc(emitter.key)}"><summary><span data-select-kind="emitter" data-select-id="${esc(emitter.key)}">${esc(emitter.name)}</span>${mode === "constructor" ? button("addSignal", "+", `data-emitter-key="${esc(emitter.key)}" aria-label="${t("Добавить сигнал", "Add signal")}"`) : ""}</summary><table><tbody>${catalog.signals.filter((signal) => signal.emitterKey === emitter.key).map((signal) => `<tr data-select-kind="signal" data-select-id="${esc(signal.id)}" aria-selected="${selection.id === signal.id}" class="${selection.id === signal.id ? "is-selected" : ""}"><td>${button("selectNode", `${localizedDescription(signal.label) || signal.name}`, `data-kind="signal" data-id="${esc(signal.id)}"`)}<small>${signal.label ? esc(signal.name) : ""}</small></td><td>${signal.builtin ? t("Системный", "System") : mode === "constructor" ? button("removeTreeSignal", "×", `data-id="${esc(signal.id)}" aria-label="${t("Удалить сигнал", "Delete signal")}"`) : ""}</td></tr>`).join("")}</tbody></table></details>`).join("")}</details>`;
  }).join("")}</div>`;
}

export function renderMacroList(catalog, selection, resolveMacro = () => null, ownerKey = "", validation = new Map()) {
  return `<label>${t("Объект для нового макроса", "Owner for a new macro")}<select name="macroOwner">${options(catalog.emitters.map((emitter) => ({ id: emitter.key, name: emitter.name })), ownerKey)}</select></label><div class="ms-macro-list" data-macro-drop>${catalog.macros.map((macro) => {
    const doc = resolveMacro(macro.uuid);
    const key = macroKey(macro), subscriptions = catalog.subscriptions.filter((row) => row.ownerKey === macro.ownerKey && row.macroUuid === macro.uuid);
    return `<div class="ms-ide-list-row ${selection.kind === "macro" && selection.id === key ? "is-selected" : ""}" data-select-kind="macro" data-select-id="${esc(key)}" draggable="true" data-macro-uuid="${esc(macro.uuid)}"><button class="ms-tree-name" type="button" data-screen-action="selectNode" data-kind="macro" data-id="${esc(key)}">⌘ ${esc(emitterName(catalog, macro.ownerKey))} · ${esc(doc?.name ?? macro.uuid)}</button><small>${subscriptions.length ? `${t("Подписок", "Subscriptions")}: ${subscriptions.length}` : t("Без подписок", "No subscriptions")}</small>${button("editMacro", t("Править", "Edit"), `data-uuid="${esc(macro.uuid)}"`)}</div>`;
  }).join("")}<div class="ms-macro-validation-list">${catalog.macros.map((macro) => `<p class="ms-note">${esc(resolveMacro(macro.uuid)?.name ?? macro.uuid)}: ${esc(validation.get(macroKey(macro))?.text ?? "")}</p>`).join("")}</div><p class="ms-note">Перетащите сюда макрос из каталога Foundry.</p></div>`;
}

function colorFields(entry) {
  const displayColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
  return `<div class="ms-ide-colors">${generics.components.renderColorField({ name: "background", value: displayColor(entry.background, "#26303C"), label: "Цвет фона" })}${generics.components.renderColorField({ name: "textColor", value: displayColor(entry.textColor, "#FFFFFF"), label: "Цвет текста" })}</div>`;
}

export function renderParameters({ selection, draft, catalog, definitions, runtimes = [], mode }) {
  if (!draft) return '<p class="ms-note">Выберите элемент в основной зоне.</p>';
  if (selection.kind === "emitter") return `<h3>${esc(draft.name)}</h3><p>${esc(draft.key)}</p>${mode === "constructor" ? button("addSignal", t("Добавить сигнал", "Add signal"), `data-emitter-key="${esc(draft.key)}"`) : ""}`;
  const readOnly = mode === "director" && !["group", "state"].includes(selection.kind);
  const kind = selection.kind;
  let html = "";
  if (kind === "group" || kind === "state") {
    const isGroup = kind === "group";
    if (mode === "director") {
      const definition = definitions.find((entry) => entry.groupId === selection.groupId);
      html = `<h3 style="${colorStyle(draft)}" class="ms-node-heading">${esc(isGroup ? draft.groupName : draft.name)}</h3><p class="ms-note">Мастер может выбрать любое состояние. Реакции на сигналы задаются подписками.</p>`;
      if (isGroup) {
        const runtime = runtimes.find((entry) => entry.groupId === selection.groupId), started = Boolean(runtime?.stateId);
        html += select("resumeState", started ? "Возобновить с состояния" : "Состояние запуска", definition?.states ?? [], definition?.entryStateId, "Выберите состояние") + button("resumeSelectedGroup", started ? "Возобновить" : "Запустить") + button("haltSelectedGroup", "Остановить группу");
      }
      else html += button("enterSelectedState", "Перейти в это состояние") + button("haltSelectedGroup", "Остановить группу");
      return html + `<p class="ms-note">${esc(localizedDescription(draft.description))}</p>`;
    }
    html += input(isGroup ? "groupName" : "name", "Название", isGroup ? draft.groupName : draft.name, 'required maxlength="120"');
    if (isGroup) html += `<div class="ms-group-symbol">${input("groupSymbol", "Символ группы", draft.symbol ?? "🎬", 'required aria-describedby="ms-symbol-hint"')}<span id="ms-symbol-hint" class="ms-note">Одна видимая графема, включая составной эмоджи.</span></div>${select("entryStateId", "Состояние входа", draft.states ?? [], draft.entryStateId)}`;
    html += descriptionField(draft.description);
    html += colorFields(draft);

    html += generics.components.renderJSONControls({ id: "selection", importLabel: "Импорт JSON", exportLabel: "Экспорт JSON" });
  } else if (kind === "signal") {
    html += renderSignalFields(draft, catalog);
  } else if (kind === "macro") {
    html += `<p>${esc(emitterName(catalog, draft.ownerKey))}</p><p>${esc(draft.uuid)}</p>${button("editMacro", t("\u041f\u0440\u0430\u0432\u0438\u0442\u044c", "Edit"), `data-uuid="${esc(draft.uuid)}"`)}`;
  }
  return `<form data-screen-form="saveParameters" data-ide-parameters><fieldset ${readOnly ? "disabled" : ""}>${html}</fieldset>${readOnly ? '<p class="ms-note">Встроенные определения доступны только для просмотра и вызова.</p>' : `<footer class="ms-ide-save"><span data-save-status class="ms-note"></span>${button("discardParameters", "Отменить ввод")}<button type="submit">Сохранить</button></footer>`}</form>`;
}

export function renderOtherList(mode, selected) {
  return OTHER_BLOCKS.filter((block) => block.mode === mode).map((block) => `<button class="ms-ide-block-link ${selected === block.id ? "is-selected" : ""}" type="button" data-screen-action="selectOther" data-id="${block.id}">${esc(block.name)}</button>`).join("");
}

export function renderMenu(zone, hidden, active) {
  const tree = zone === "main" ? MAIN_MENU : DETAIL_MENU;
  const visible = (node) => leaves([node]).some((id) => !hidden.includes(id));
  const entry = (node, popup = false) => `<button type="button" role="menuitem" data-screen-action="${node.children ? "menuCategory" : "ideTab"}" data-zone="${zone}" data-id="${node.id}" ${popup ? 'tabindex="-1"' : ""} ${node.children ? `aria-haspopup="menu" aria-controls="ms-menu-${zone}-${node.id}" aria-expanded="false"` : `aria-pressed="${active === node.id}"`} class="${node.children && leaves([node]).includes(active) ? "has-active-child" : ""}">${esc(t(node.label, node.labelEn ?? node.label))}${node.children ? popup ? " ▸" : " ▾" : ""}</button>`;
  const popups = (nodes, parent = "") => nodes.filter(visible).filter((node) => node.children).map((node) => `<nav id="ms-menu-${zone}-${node.id}" class="ms-menu-popup" data-menu-popup="${node.id}" data-zone="${zone}" data-parent-menu="${parent}" role="menu" aria-label="${esc(t(node.label, node.labelEn ?? node.label))}" popover="manual">${node.children.filter(visible).map((child) => entry(child, true)).join("")}</nav>${popups(node.children, node.id)}`).join("");
  const id = `${zone}-0`;
  return `<div class="ms-menu-level"><button type="button" data-screen-action="scrollMenu" data-menu-id="${id}" data-direction="-1" class="ms-menu-arrow" aria-label="Предыдущие вкладки">‹</button><nav class="ms-menu-strip" role="menubar" data-menu-strip="${id}" aria-label="${zone === "main" ? "Основные вкладки" : "Дополнительные вкладки"}">${tree.filter(visible).map((node) => entry(node)).join("")}</nav><button type="button" data-screen-action="scrollMenu" data-menu-id="${id}" data-direction="1" class="ms-menu-arrow" aria-label="Следующие вкладки">›</button></div>${popups(tree)}`;
}

export function renderMenuSettings(zone, hidden) {
  const nodes = zone === "main" ? MAIN_MENU : DETAIL_MENU;
  return `<table class="ms-menu-settings-table" role="treegrid" aria-label="Состав меню"><tbody>${menuRows(nodes, hidden).map((node) => `<tr role="row" aria-level="${node.depth + 1}" data-menu-setting-row="${node.id}"><td style="padding-inline-start:${8 + node.depth * 22}px"><label><input type="checkbox" data-menu-visible="${node.id}" ${node.checked ? "checked" : ""} ${node.partial ? 'data-indeterminate="true"' : ""}> <span>${esc(t(node.label, node.labelEn ?? node.label))}</span>${node.category ? '<small>Категория</small>' : ""}</label></td></tr>`).join("")}</tbody></table>`;
}

export function renderObjectList(rows, selected, kind) {
  return `<table class="ms-ide-tree" role="grid"><tbody>${rows.map((row) => `<tr data-select-kind="${kind}" data-select-id="${esc(row.id)}" data-group-id="${esc(row.groupId ?? "")}" aria-selected="${selected.kind === kind && selected.id === row.id}" class="${selected.kind === kind && selected.id === row.id ? "is-selected" : ""}"><td><button type="button" class="ms-tree-name" data-screen-action="selectNode" data-kind="${kind}" data-id="${esc(row.id)}" data-group-id="${esc(row.groupId ?? "")}">${esc(row.name)}</button></td><td title="${esc(row.groupName ?? "")}">${esc(row.stateName ?? row.detail ?? "")}</td></tr>`).join("") || '<tr><td>Нет элементов</td></tr>'}</tbody></table>`;
}
