import { text as t } from "../localization.js";
import { generics } from "../generics.js";
import { MAIN_MENU, DETAIL_MENU, leaves, menuRows, menuPath, selectableTreeAttributes } from "./navigation-tree.js";
import { localizedDescription } from "../model.js";
import { renderSignalFields, renderSubscriptions, macroKey, emitterName } from "./signal-fields.js";
import { escapeHTML as esc, actionButton as button, textInput, selectOptions } from "./form-fields.js";

const otherBlocks = () => [
  { id: "tokens", name: t("НИП и поведение", "NPCs and behavior"), mode: "constructor" },
  { id: "tags", name: t("Теги объектов", "Object tags"), mode: "constructor" },
  { id: "dialogues", name: t("Прямые взаимодействия", "Direct interactions"), mode: "constructor" },
  { id: "entry", name: t("Пауза, звук и подкрепление", "Pause, sound and reinforcements"), mode: "constructor" },
  { id: "zones", name: t("Зоны сигналов", "Signal zones"), mode: "constructor" },
  { id: "workspaceGM", name: t("Рабочий стол мастера", "GM workspace"), mode: "constructor" },
  { id: "workspacePlayers", name: t("Окна игроков", "Player windows"), mode: "constructor" },
  { id: "sceneIO", name: t("Перенос всей сцены", "Transfer entire scene"), mode: "constructor" },
  { id: "playback", name: t("Переход и бой", "Transitions and combat"), mode: "director" },
  { id: "automation", name: t("Автоматизация НИП", "NPC automation"), mode: "director" },
  { id: "counts", name: t("Допуск и счётчики", "Access and counters"), mode: "director" },
  { id: "journal", name: t("Журнал сигналов", "Signal log"), mode: "director" },
  { id: "manual", name: t("Ручное ведение сцены", "Manual scene control"), mode: "director" }
];
const input = (name, label, value = "", extra = "") => textInput(name, label, value, extra, "ms-field");
const options = (rows, selected, blank = "") => selectOptions(rows.map((row) => ({ id: row.id ?? row.value, name: row.name ?? row.label })), selected, blank || undefined);
const select = (name, label, rows, selected, blank = "") => `<label class="ms-field">${esc(label)}<select name="${name}">${options(rows, selected, blank)}</select></label>`;
const descriptionField = (description, name = "description") => `<label class="ms-field">${name === "parameterDescription" ? t("Описание параметра", "Parameter description") : t("Описание", "Description")}<textarea name="${name}" rows="2" maxlength="8000">${esc(localizedDescription(description))}</textarea></label>`;
const colorStyle = (entry) => {
  const valid = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
  return `background:${valid(entry.background, "#26303C")};color:${valid(entry.textColor, "#FFFFFF")}`;
};

export function renderSceneTree(definitions, runtimes, selection, mode) {
  const rows = [];
  for (const definition of definitions) {
    const active = runtimes.find((runtime) => runtime.groupId === definition.groupId);
    const selected = selection.kind === "group" && selection.id === definition.groupId;
    rows.push(`<tr role="row" aria-level="1" ${selectableTreeAttributes("group", definition.groupId, selected, esc)} class="${selected ? "is-selected" : ""}" data-ide-kind="group" data-ide-id="${esc(definition.groupId)}" data-group-id="${esc(definition.groupId)}" draggable="${mode === "constructor"}">
      <td><button type="button" class="ms-tree-toggle" data-screen-action="foldGroup" data-group-id="${esc(definition.groupId)}" aria-label="${t("Свернуть или раскрыть группу", "Collapse or expand group")}" aria-expanded="true">▾</button><button type="button" class="ms-tree-name" data-screen-action="selectNode" data-kind="group" data-id="${esc(definition.groupId)}" data-group-id="${esc(definition.groupId)}"><span class="ms-color-swatch" style="${colorStyle(definition)}">${esc(definition.symbol ?? "🎬")}</span>${esc(definition.groupName)}</button></td>
      <td>${mode === "director" ? `<span class="ms-note">${active?.halted ? t("Остановлена", "Stopped") : active?.stateId ? t("Работает", "Running") : t("Не запущена", "Not started")}</span>` : `${definition.states.length}`}</td></tr>`);
    for (const state of definition.states) {
      const chosen = selection.kind === "state" && selection.id === state.id && selection.groupId === definition.groupId;
      rows.push(`<tr role="row" aria-level="2" aria-selected="${chosen}" class="${chosen ? "is-selected" : ""} ${active?.stateId === state.id ? "is-active" : ""}" data-select-kind="state" data-select-id="${esc(state.id)}" data-ide-kind="state" data-ide-id="${esc(state.id)}" data-group-id="${esc(definition.groupId)}" draggable="${mode === "constructor"}"><td><button type="button" class="ms-tree-name ms-tree-child" data-screen-action="selectNode" data-kind="state" data-id="${esc(state.id)}" data-group-id="${esc(definition.groupId)}"><span class="ms-color-swatch" style="${colorStyle(state)}">${active?.stateId === state.id ? "●" : "○"}</span>${esc(state.name)}</button></td><td>${mode === "director" ? button("enterNode", active?.stateId === state.id ? t("Заново", "Re-enter") : t("Войти", "Enter"), `data-group-id="${esc(definition.groupId)}" data-id="${esc(state.id)}" title="${t("Явный вход в состояние", "Explicit state entry")}"`) : ""}</td></tr>`);
    }
  }
  return `<table class="ms-ide-tree" role="treegrid" aria-label="${t("Группы и состояния", "Groups and states")}"><tbody>${rows.join("")}</tbody></table>`;
}

export function signalTreeCategories(catalog) {
  const byType = (type) => catalog.emitters.filter((emitter) => (emitter.type ?? emitter.key.split(":")[0]) === type);
  const assigned = new Set(["Scene", "Combat", "Shop", "Dialogue", "Group", "Token", "Tile", "Drawing", "Wall"]);
  return [
    { id: "scene", name: t("Сцена", "Scene"), emitters: [...byType("Scene"), ...byType("Combat")], children: [
      { id: "shops", name: t("Магазины", "Shops"), emitters: byType("Shop") },
      { id: "dialogues", name: t("Диалоги", "Dialogues"), emitters: byType("Dialogue") }
    ] },
    { id: "groups", name: t("Группы", "Groups"), emitters: byType("Group") },
    { id: "tokens", name: t("Токены", "Tokens"), emitters: byType("Token") },
    { id: "tiles", name: t("Тайлы", "Tiles"), emitters: byType("Tile") },
    { id: "drawings", name: t("Рисунки", "Drawings"), emitters: byType("Drawing") },
    { id: "walls", name: t("Стены", "Walls"), emitters: byType("Wall") },
    { id: "other", name: t("Прочие", "Other"), emitters: catalog.emitters.filter((emitter) => !assigned.has(emitter.type ?? emitter.key.split(":")[0])) }
  ];
}

export function renderSignalTree(catalog, selection, mode) {
  const renderEmitter = (emitter) => {
    const selected = selection.kind === "emitter" && selection.id === emitter.key;
    const name = emitter.type === "Combat" ? t("Боевой агент", "Combat agent") : emitter.name;
    const rows = catalog.signals.filter((signal) => signal.emitterKey === emitter.key).map((signal) => {
      const chosen = selection.kind === "signal" && selection.id === signal.id;
      return `<tr ${selectableTreeAttributes("signal", signal.id, chosen, esc)} class="${chosen ? "is-selected" : ""}"><td><span class="ms-tree-name">${esc(localizedDescription(signal.label) || signal.name)}</span></td><td class="ms-signal-technical"><code>${esc(signal.name)}</code></td><td>${signal.builtin ? `<span class="ms-signal-status">${t("Системный", "System")}</span>` : mode === "constructor" ? button("removeTreeSignal", "×", `data-id="${esc(signal.id)}" aria-label="${t("Удалить сигнал", "Delete signal")}"`) : ""}</td></tr>`;
    });
    return `<details open class="ms-signal-emitter" data-emitter-node="${esc(emitter.key)}"><summary ${selectableTreeAttributes("emitter", emitter.key, selected, esc)} class="${selected ? "is-selected" : ""}">${button("toggleSignalBranch", "▾", `class="ms-tree-toggle" aria-label="${t("Свернуть или раскрыть", "Collapse or expand")}"`)}<span class="ms-tree-name">${esc(name)}</span>${mode === "constructor" ? button("addSignal", "+", `data-emitter-key="${esc(emitter.key)}" aria-label="${t("Добавить сигнал", "Add signal")}"`) : ""}</summary><table class="ms-ide-tree ms-signal-table"><colgroup><col><col class="ms-signal-technical-column"><col class="ms-signal-status-column"></colgroup><thead><tr><th>${t("Название", "Name")}</th><th>${t("Техническое имя", "Technical name")}</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table></details>`;
  };
  const renderCategory = (category) => `<details open class="ms-signal-category" data-signal-category="${category.id}"><summary>${esc(category.name)} <small>${category.emitters.length}</small></summary>${category.emitters.map(renderEmitter).join("")}${(category.children ?? []).map(renderCategory).join("")}</details>`;
  return `<div class="ms-signal-tree">${signalTreeCategories(catalog).map(renderCategory).join("")}</div>`;
}

export function renderMacroList(catalog, selection, resolveMacro = () => null, ownerKey = "", validation = new Map()) {
  return `<label>${t("Объект для нового макроса", "Owner for a new macro")}<select name="macroOwner">${options(catalog.emitters.map((emitter) => ({ id: emitter.key, name: emitter.name })), ownerKey)}</select></label><div class="ms-macro-list" data-macro-drop>${catalog.macros.map((macro) => {
    const doc = resolveMacro(macro.uuid);
    const key = macroKey(macro), subscriptions = catalog.subscriptions.filter((row) => row.ownerKey === macro.ownerKey && row.macroUuid === macro.uuid);
    return `<div class="ms-ide-list-row ${selection.kind === "macro" && selection.id === key ? "is-selected" : ""}" data-select-kind="macro" data-select-id="${esc(key)}" draggable="true" data-macro-uuid="${esc(macro.uuid)}"><button class="ms-tree-name" type="button" data-screen-action="selectNode" data-kind="macro" data-id="${esc(key)}">⌘ ${esc(emitterName(catalog, macro.ownerKey))} · ${esc(doc?.name ?? macro.uuid)}</button><small>${subscriptions.length ? `${t("Подписок", "Subscriptions")}: ${subscriptions.length}` : t("Без подписок", "No subscriptions")}</small>${button("editMacro", t("Править", "Edit"), `data-uuid="${esc(macro.uuid)}"`)}</div>`;
  }).join("")}<div class="ms-macro-validation-list">${catalog.macros.map((macro) => `<p class="ms-note">${esc(resolveMacro(macro.uuid)?.name ?? macro.uuid)}: ${esc(validation.get(macroKey(macro))?.text ?? "")}</p>`).join("")}</div><p class="ms-note">${t("Перетащите сюда макрос из каталога Foundry.", "Drop a macro here from the Foundry directory.")}</p></div>`;
}

function colorFields(entry) {
  const displayColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
  return `<div class="ms-ide-colors">${generics.components.renderColorField({ name: "background", value: displayColor(entry.background, "#26303C"), label: t("Цвет фона", "Background color") })}${generics.components.renderColorField({ name: "textColor", value: displayColor(entry.textColor, "#FFFFFF"), label: t("Цвет текста", "Text color") })}</div>`;
}

export function renderParameters({ selection, draft, catalog, definitions, runtimes = [], mode }) {
  if (!draft) return `<p class="ms-note">${t("Выберите элемент в основной зоне.", "Select an entry in the main area.")}</p>`;
  if (selection.kind === "emitter") return `<h3>${esc(draft.name)}</h3><p>${esc(draft.key)}</p>${mode === "constructor" ? button("addSignal", t("Добавить сигнал", "Add signal"), `data-emitter-key="${esc(draft.key)}"`) : ""}`;
  const readOnly = mode === "director" && !["group", "state"].includes(selection.kind);
  const kind = selection.kind;
  let html = "";
  if (kind === "group" || kind === "state") {
    const isGroup = kind === "group";
    if (mode === "director") {
      const definition = definitions.find((entry) => entry.groupId === selection.groupId);
      html = `<h3 style="${colorStyle(draft)}" class="ms-node-heading">${esc(isGroup ? draft.groupName : draft.name)}</h3><p class="ms-note">${t("Мастер может выбрать любое состояние. Реакции на сигналы задаются подписками.", "The GM can choose any state. Signal responses are configured through subscriptions.")}</p>`;
      if (isGroup) {
        const runtime = runtimes.find((entry) => entry.groupId === selection.groupId), started = Boolean(runtime?.stateId);
        html += select("resumeState", started ? t("Возобновить с состояния", "Resume from state") : t("Состояние запуска", "Starting state"), definition?.states ?? [], definition?.entryStateId, t("Выберите состояние", "Choose a state")) + button("resumeSelectedGroup", started ? t("Возобновить", "Resume") : t("Запустить", "Start")) + button("haltSelectedGroup", t("Остановить группу", "Stop group"));
      }
      else html += button("enterSelectedState", t("Перейти в это состояние", "Enter this state")) + button("haltSelectedGroup", t("Остановить группу", "Stop group"));
      return html + `<p class="ms-note">${esc(localizedDescription(draft.description))}</p>`;
    }
    html += input(isGroup ? "groupName" : "name", t("Название", "Name"), isGroup ? draft.groupName : draft.name, 'required maxlength="120"');
    if (isGroup) html += `<div class="ms-group-symbol">${input("groupSymbol", t("Символ группы", "Group symbol"), draft.symbol ?? "🎬", 'required aria-describedby="ms-symbol-hint"')}<span id="ms-symbol-hint" class="ms-note">${t("Одна видимая графема, включая составной эмоджи.", "One visible symbol, including a compound emoji.")}</span></div>${select("entryStateId", t("Состояние входа", "Entry state"), draft.states ?? [], draft.entryStateId)}`;
    html += descriptionField(draft.description);
    html += colorFields(draft);

    html += generics.components.renderJSONControls({ id: "selection", importLabel: t("Импорт JSON", "Import JSON"), exportLabel: t("Экспорт JSON", "Export JSON") });
  } else if (kind === "signal") {
    html += renderSignalFields(draft, catalog);
  } else if (kind === "macro") {
    html += `<p>${esc(emitterName(catalog, draft.ownerKey))}</p><p>${esc(draft.uuid)}</p>${button("editMacro", t("\u041f\u0440\u0430\u0432\u0438\u0442\u044c", "Edit"), `data-uuid="${esc(draft.uuid)}"`)}`;
  }
  return `<form data-screen-form="saveParameters" data-ide-parameters><fieldset ${readOnly ? "disabled" : ""}>${html}</fieldset>${readOnly ? `<p class="ms-note">${t("Встроенные определения доступны только для просмотра и вызова.", "Built-in definitions can only be viewed and invoked.")}</p>` : `<footer class="ms-ide-save"><span data-save-status class="ms-note"></span>${button("discardParameters", t("Отменить ввод", "Discard edits"))}<button type="submit">${t("Сохранить", "Save")}</button></footer>`}</form>`;
}

export function renderOtherList(mode, selected) {
  return otherBlocks().filter((block) => block.mode === mode).map((block) => `<button class="ms-ide-block-link ${selected === block.id ? "is-selected" : ""}" type="button" data-screen-action="selectOther" data-id="${block.id}">${esc(block.name)}</button>`).join("");
}

export function renderMenu(zone, hidden, active) {
  const tree = zone === "main" ? MAIN_MENU : DETAIL_MENU;
  const visible = (node) => leaves([node]).some((id) => !hidden.includes(id));
  const entry = (node, popup = false) => `<button type="button" role="menuitem" data-screen-action="${node.children ? "menuCategory" : "ideTab"}" data-zone="${zone}" data-id="${node.id}" ${popup ? 'tabindex="-1"' : ""} ${node.children ? `aria-haspopup="menu" aria-controls="ms-menu-${zone}-${node.id}" aria-expanded="false"` : `aria-pressed="${active === node.id}"`} class="${node.children && leaves([node]).includes(active) ? "has-active-child" : ""}">${esc(t(node.label, node.labelEn ?? node.label))}${node.children ? popup ? " ▸" : " ▾" : ""}</button>`;
  const popups = (nodes, parent = "") => nodes.filter(visible).filter((node) => node.children).map((node) => `<nav id="ms-menu-${zone}-${node.id}" class="ms-menu-popup" data-menu-popup="${node.id}" data-zone="${zone}" data-parent-menu="${parent}" role="menu" aria-label="${esc(t(node.label, node.labelEn ?? node.label))}" popover="manual">${node.children.filter(visible).map((child) => entry(child, true)).join("")}</nav>${popups(node.children, node.id)}`).join("");
  const id = `${zone}-0`;
  return `<div class="ms-menu-level"><button type="button" data-screen-action="scrollMenu" data-menu-id="${id}" data-direction="-1" class="ms-menu-arrow" aria-label="${t("Предыдущие вкладки", "Previous tabs")}">‹</button><nav class="ms-menu-strip" role="menubar" data-menu-strip="${id}" aria-label="${zone === "main" ? t("Основные вкладки", "Main tabs") : t("Дополнительные вкладки", "Secondary tabs")}">${tree.filter(visible).map((node) => entry(node)).join("")}</nav><button type="button" data-screen-action="scrollMenu" data-menu-id="${id}" data-direction="1" class="ms-menu-arrow" aria-label="${t("Следующие вкладки", "Next tabs")}">›</button></div>${popups(tree)}`;
}

export function renderMenuSettings(zone, hidden) {
  const nodes = zone === "main" ? MAIN_MENU : DETAIL_MENU;
  return `<table class="ms-menu-settings-table" role="treegrid" aria-label="${t("Состав меню", "Menu contents")}"><tbody>${menuRows(nodes, hidden).map((node) => `<tr role="row" aria-level="${node.depth + 1}" data-menu-setting-row="${node.id}"><td style="padding-inline-start:${8 + node.depth * 22}px"><label><input type="checkbox" data-menu-visible="${node.id}" ${node.checked ? "checked" : ""} ${node.partial ? 'data-indeterminate="true"' : ""}> <span>${esc(t(node.label, node.labelEn ?? node.label))}</span>${node.category ? `<small>${t("Категория", "Category")}</small>` : ""}</label></td></tr>`).join("")}</tbody></table>`;
}

export function renderObjectList(rows, selected, kind) {
  return `<table class="ms-ide-tree" role="grid"><tbody>${rows.map((row) => `<tr data-select-kind="${kind}" data-select-id="${esc(row.id)}" data-group-id="${esc(row.groupId ?? "")}" aria-selected="${selected.kind === kind && selected.id === row.id}" class="${selected.kind === kind && selected.id === row.id ? "is-selected" : ""}"><td><button type="button" class="ms-tree-name" data-screen-action="selectNode" data-kind="${kind}" data-id="${esc(row.id)}" data-group-id="${esc(row.groupId ?? "")}">${esc(row.name)}</button></td><td title="${esc(row.groupName ?? "")}">${esc(row.stateName ?? row.detail ?? "")}</td></tr>`).join("") || `<tr><td>${t("Нет элементов", "No entries")}</td></tr>`}</tbody></table>`;
}
