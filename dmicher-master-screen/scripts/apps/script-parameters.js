import { text as t } from "../localization.js";
import { escapeHTML as e, parameterRow as row } from "./form-fields.js";
import { scriptStepTemplate } from "../script-model.js";
import { readObjectGeometry, scriptObjectCapabilities } from "../script-movement.js";
import { fieldInitialValue } from "../signal-types.js";
import { openEmojiPicker } from "./emoji-picker.js";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const own = (object, key, value) => Object.defineProperty(object, key, { value, writable: true, configurable: true, enumerable: true });

function stateTransitionFields(transitions, definitions) {
  const used = new Set(transitions.map((pair) => pair.groupId));
  const options = (items, selected) => items.map(([id, name]) => `<option value="${e(id)}"${id === selected ? " selected" : ""}>${e(name)}</option>`).join("");
  return `<table class="ms-state-pairs"><thead><tr><th>${t("Группа", "Group")}</th><th>${t("Состояние", "State")}</th><th></th></tr></thead><tbody>${transitions.map((pair, index) => {
    const group = definitions.find((item) => item.groupId === pair.groupId);
    const groups = definitions.filter((item) => item.groupId === pair.groupId || !used.has(item.groupId)).map((item) => [item.groupId, item.groupName]);
    if (!group) groups.unshift([pair.groupId, t(`Недоступна: ${pair.groupId}`, `Unavailable: ${pair.groupId}`)]);
    const states = (group?.states ?? []).map((state) => [state.id, state.name]);
    if (!states.some(([id]) => id === pair.stateId)) states.unshift([pair.stateId, t(`Недоступно: ${pair.stateId}`, `Unavailable: ${pair.stateId}`)]);
    return `<tr><td><select data-script-state-group data-pair-index="${index}" aria-label="${t("Группа", "Group")}">${options(groups, pair.groupId)}</select></td><td><select data-script-state-value data-pair-index="${index}" aria-label="${t("Состояние", "State")}">${options(states, pair.stateId)}</select></td><td><button type="button" data-script-state-remove="${index}" aria-label="${t("Удалить переход", "Remove transition")}">×</button></td></tr>`;
  }).join("")}</tbody></table><button type="button" data-script-state-add${definitions.some((item) => !used.has(item.groupId)) ? "" : " disabled"}>+ ${t("Группа", "Group")}</button>`;
}

/** Editor defaults are a presentation contract, not a migration of stored scenes.
 * Inactive mode fields stay in JSON; explicit null keeps an action disabled. */
export function completeScriptParameters(kind, source, document) {
  if (source !== undefined && !record(source)) throw new Error(t("Параметры шага должны быть объектом JSON.", "Step parameters must be a JSON object."));
  const defaults = scriptStepTemplate(kind).parameters;
  if (kind === "move") {
    const geometry = document ? readObjectGeometry(document) : { position: { x: 0, y: 0 }, rotation: 0, size: { x: 1, y: 1, z: null } };
    defaults.position = geometry.position && { ...geometry.position, speed: 5 };
    defaults.rotation = geometry.rotation === null ? null : { mode: "absolute", angle: geometry.rotation, speed: 90 };
    defaults.size = geometry.size && { ...geometry.size, speed: 1 };
  }
  const merge = (base, value) => {
    const result = clone(base);
    for (const [key, item] of Object.entries(value ?? {})) own(result, key, record(result[key]) && record(item) ? merge(result[key], item) : clone(item));
    return result;
  };
  return merge(defaults, source);
}

export function setScriptParameter(parameters, path, value) {
  const keys = Array.isArray(path) ? path : JSON.parse(path);
  if (!keys.length || keys.some((key) => typeof key !== "string")) throw new Error(t("Некорректный путь параметра.", "Invalid parameter path."));
  let target = parameters;
  for (const key of keys.slice(0, -1)) {
    if (!Object.hasOwn(target, key) || !record(target[key])) own(target, key, {});
    target = target[key];
  }
  own(target, keys.at(-1), value);
}

function fields(parameters, context) {
  const attrs = (path, type = "text", extra = "") => `data-script-param="${e(JSON.stringify(path))}" data-param-type="${type}" ${extra}`;
  const value = (path) => path.reduce((parent, key) => parent?.[key], parameters);
  const table = (rows) => `<table class="ms-parameter-table ms-script-parameter-table"><tbody>${rows}</tbody></table>`;
  const input = (path, label, { type = "text", step = "any", min, unit = "", disabled = false, nullable = false, duration = false } = {}) => row(label, `<span class="ms-script-value"><input ${attrs(path, type, nullable ? 'data-param-nullable="true"' : "")}${duration ? " data-script-duration" : ""} aria-label="${e(label)}" type="${type === "number" ? "number" : "text"}" value="${e(value(path))}"${type === "number" ? ` step="${step}"${min === undefined ? "" : ` min="${min}"`}` : ""}${disabled ? " disabled" : ""}>${unit ? `<span class="ms-script-unit">${e(unit)}</span>` : ""}</span>`, duration && value(path) === 0 ? "ms-script-zero-duration" : "");
  const num = (path, label, options = {}) => input(path, label, { type: "number", ...options, ...(options.step === "1" && typeof value(path) === "number" && !Number.isInteger(value(path)) ? { step: "any" } : {}) });
  const select = (path, label, values, type = "text") => row(label, `<select ${attrs(path, type)} aria-label="${e(label)}">${values.map(([id, text]) => `<option value="${e(id)}"${value(path) === id ? " selected" : ""}>${e(text)}</option>`).join("")}</select>`);
  const check = (path, label) => row(label, `<input type="checkbox" ${attrs(path, "boolean")} aria-label="${e(label)}"${value(path) ? " checked" : ""}>`);
  const textParameterRow = (path, label) => row(label, `<textarea ${attrs(path)} aria-label="${e(label)}" rows="2">${e(value(path))}</textarea>`);
  const tags = (path, label) => row(label, `<input ${attrs(path, "tags")} aria-label="${e(label)}" value="${e((value(path) ?? []).join(", "))}">`);
  const group = (key, label, rows, { enabled, supported = true } = {}) => `<tr><td colspan="2"><details class="ms-script-parameter-group" data-param-group="${e(key)}" open><summary>${e(label)}${enabled === undefined ? "" : `<input type="checkbox" data-script-param-group="${e(key)}" aria-label="${e(t(`Включить: ${label}`, `Enable: ${label}`))}"${enabled ? " checked" : ""}${supported ? "" : " disabled"}>`}</summary>${supported ? table(rows) : `<span class="ms-note">${t("Объект не поддерживает это действие.", "This object does not support this action.")}</span>`}</details></td></tr>`;
  const action = (name, label) => `<button type="button" data-screen-action="${name}" data-step="${context.stepIndex}" data-index="${context.index}">${e(label)}</button>`;
  const sec = { min: 0, unit: t("сек.", "sec.") };
  // Only an action's duration is highlighted. Optional before/after offsets and
  // speed fields have different meanings, even when their numeric value is zero.
  const duration = { ...sec, duration: true };
  const effectTiming = () => select(["executionMode"], t("Режим выполнения", "Execution mode"), [["parallel", t("Вместе со следующим", "Alongside next step")], ["wait", t("До следующего", "Before next step")]])
    + num(["duration"], t("Длительность", "Duration"), duration);
  const delays = () => num(["before"], t("Перед вызовом", "Before call"), sec) + num(["after"], t("После вызова", "After call"), sec);
  const typedParameters = (values, declarations, path = ["parameters"]) => Object.entries(values ?? {}).map(([key, entry]) => {
    const field = declarations.find((item) => item.name === key), itemPath = [...path, key], label = key;
    let html;
    if (record(entry)) return group(JSON.stringify(itemPath), label, typedParameters(entry, [], itemPath));
    if (Array.isArray(entry)) html = row(label, `<input ${attrs(itemPath, "json")} aria-label="${e(label)}" value="${e(JSON.stringify(entry))}">`);
    else if (field?.type === "boolean" || typeof entry === "boolean") html = check(itemPath, label);
    else if (["integer", "number"].includes(field?.type) || typeof entry === "number") html = num(itemPath, label, { step: field?.type === "integer" ? "1" : "any", nullable: field?.nullable });
    else html = input(itemPath, label, { nullable: field?.nullable });
    if (field?.nullable) html += row(`${label}: null`, `<input type="checkbox" data-script-param-null="${e(JSON.stringify(itemPath))}" data-null-type="${e(field.type)}" aria-label="${e(`${label}: null`)}"${entry === null ? " checked" : ""}>`);
    return html;
  }).join("");
  let rows = "";
  switch (context.kind) {
    case "wait": rows = num(["seconds"], t("Ожидание", "Wait"), duration); break;
    case "visibility": rows = check(["visible"], t("Показывать объект", "Show object")); break;
    case "move": {
      const capabilities = context.document ? scriptObjectCapabilities(context.document) : { position: true, rotation: true, size: true, sizeZ: false };
      const speed = parameters.timeMode === "speed";
      rows = select(["timeMode"], t("Режим", "Mode"), [["duration", t("Длительность", "Duration")], ["speed", t("Скорость", "Speed")]]);
      if (!speed) rows += num(["duration"], t("Длительность", "Duration"), duration);
      else if (parameters.position) rows += num(["position", "speed"], t("Скорость", "Speed"), { min: 0, unit: t("ед./сек.", "units/sec.") });
      rows += group("position", t("Позиция", "Position"), parameters.position ? num(["position", "x"], "x", { step: "1" }) + num(["position", "y"], "y", { step: "1" }) + row(t("Заполнить по", "Fill from"), `<span class="ms-script-inline-actions">${action("script-current-position", t("Текущее положение", "Current position"))}${action("script-point", t("Точка с карты", "Map point"))}</span>`) : "", { enabled: Boolean(parameters.position), supported: capabilities.position });
      rows += group("rotation", t("Поворот", "Rotation"), parameters.rotation ? select(["rotation", "mode"], t("Отсчёт", "Reference"), [["absolute", t("Абсолютный", "Absolute")], ["relative", t("Относительный", "Relative")]]) + num(["rotation", "angle"], t("Угол", "Angle"), { unit: t("град.", "deg.") }) + (speed ? num(["rotation", "speed"], t("Скорость", "Speed"), { min: 0, unit: t("град./сек.", "deg./sec.") }) : "") : "", { enabled: Boolean(parameters.rotation), supported: capabilities.rotation });
      rows += group("size", t("Размер", "Size"), parameters.size ? ["x", "y", "z"].map((axis) => num(["size", axis], axis, { step: "1", min: axis === "z" ? 0 : 0, nullable: true, disabled: axis === "z" && !capabilities.sizeZ })).join("") + (speed ? num(["size", "speed"], t("Скорость", "Speed"), { min: 0, unit: t("клеток/сек.", "grid units/sec.") }) : "") + row(t("Заполнить по", "Fill from"), action("script-current-size", t("Текущий размер", "Current size"))) + (!capabilities.sizeZ ? row("z", t("Недоступен для этого объекта", "Not available for this object")) : "") : "", { enabled: Boolean(parameters.size), supported: capabilities.size });
      break;
    }
    case "speech": {
      rows = effectTiming();
      rows += group("chat", t("Чат", "Chat"), check(["chat", "enabled"], t("Включить", "Enable")) + (parameters.chat.enabled ? select(["chat", "timing"], t("Публикация", "Publish"), [["before", t("До реплики", "Before speech")], ["after", t("После реплики", "After speech")]]) + textParameterRow(["chat", "text"], t("Текст", "Text")) + tags(["chat", "allowTags"], t("Разрешённые теги", "Allowed tags")) + tags(["chat", "denyTags"], t("Исключённые теги", "Excluded tags")) + num(["chat", "range"], t("Дальность", "Range"), { min: 0, unit: t("ед.", "units") }) + check(["chat", "deleteAfter"], t("Удалить после реплики", "Delete after speech")) : ""));
      rows += group("bubble", t("Облачко", "Bubble"), check(["bubble", "enabled"], t("Включить", "Enable")) + (parameters.bubble.enabled ? textParameterRow(["bubble", "text"], t("Текст", "Text")) + num(["bubble", "fontSize"], t("Размер шрифта", "Font size"), { min: 1, step: "1", unit: "px" }) : "")); break;
    }
    case "emotion":
      rows = row(t("Эмоция", "Emotion"), `<span class="ms-script-value ms-emotion-value"><input ${attrs(["emoji"])} aria-label="${t("Эмоция", "Emotion")}" value="${e(parameters.emoji)}"><button type="button" data-script-emoji-picker aria-haspopup="dialog" aria-expanded="false" aria-label="${t("Выбрать эмоцию", "Choose emotion")}" title="${t("Выбрать эмоцию", "Choose emotion")}">☺</button></span>`)
        + num(["size"], t("Размер", "Size"), { min: 0, unit: "px" }) + effectTiming(); break;
    case "sound": rows = input(["src"], t("Файл", "File")) + row(t("Выбрать", "Choose"), action("script-sound", t("Выбрать звук", "Choose sound"))) + num(["volume"], t("Громкость", "Volume"), { min: 0 }); break;
    case "signal": {
      const signals = (context.catalog?.signals ?? []).filter((signal) => signal.emitterKey === context.ownerKey), signal = signals.find((item) => item.id === parameters.signalId);
      rows = select(["signalId"], t("Сигнал", "Signal"), [["", "—"], ...signals.map((item) => [item.id, item.name])]);
      rows += group("parameters", t("Параметры сигнала", "Signal parameters"), typedParameters(parameters.parameters, signal?.parameters ?? []));
      rows += delays(); break;
    }
    case "macro": rows = select(["macroUuid"], t("Макрос", "Macro"), [["", "—"], ...(context.catalog?.macros ?? []).filter((item) => item.ownerKey === context.ownerKey).map((item) => [item.uuid, game.macros?.get?.(item.uuid.split(".").at(-1))?.name ?? item.uuid])]) + delays(); break;
    case "state": rows = row(t("Переходы", "Transitions"), stateTransitionFields(parameters.transitions, context.definitions ?? [])); break;
    case "approach":
      rows = input(["targetUuid"], t("Объект (UUID)", "Object (UUID)"))
        + num(["distance"], t("Расстояние", "Distance"), { min: 0, unit: t("ед.", "units") })
        + select(["timeMode"], t("Режим", "Mode"), [["duration", t("Длительность", "Duration")], ["speed", t("Скорость", "Speed")]])
        + (parameters.timeMode === "speed" ? num(["speed"], t("Скорость", "Speed"), { min: 0, unit: t("ед./сек.", "units/sec.") }) : num(["duration"], t("Длительность", "Duration"), duration));
      break;
    case "follow":
      rows = input(["targetUuid"], t("Объект (UUID)", "Object (UUID)"))
        + num(["minDistance"], t("Минимальное расстояние", "Minimum distance"), { min: 0, unit: t("ед.", "units") })
        + num(["maxDistance"], t("Максимальное расстояние", "Maximum distance"), { min: 0, unit: t("ед.", "units") })
        + num(["speed"], t("Скорость", "Speed"), { min: 0, unit: t("ед./сек.", "units/sec.") })
        + select(["mode"], t("Режим", "Mode"), [["trajectory", t("По траектории", "Along trajectory")], ["direct", t("По прямой", "Straight line")]])
        + select(["finishOn"], t("Завершать по", "Finish on"), [["arrival", t("Достижению цели", "Reaching the target")], ["state-change", t("Смене состояния", "State change")]]);
      break;
    case "dialogue": {
      const dialogues = [...(context.dialogueOptions ?? [])].map((item) => [item.id, item.name]);
      if (parameters.dialogueId && !dialogues.some(([id]) => id === parameters.dialogueId)) dialogues.push([parameters.dialogueId, t(`Недоступен: ${parameters.dialogueId}`, `Unavailable: ${parameters.dialogueId}`)]);
      rows = select(["dialogueId"], t("Диалог", "Dialogue"), [["", "—"], ...dialogues])
        + row(t("Персонажи", "Characters"), `<textarea ${attrs(["tokenUuids"], "lines")} aria-label="${t("UUID токенов, по одному в строке", "Token UUIDs, one per line")}" rows="3">${e(parameters.tokenUuids.join("\n"))}</textarea>`)
        + select(["waitMode"], t("Ожидание", "Waiting"), [["all", t("Дожидаться всех диалогов", "Wait for all dialogues")], ["first", t("Дождаться завершения первого из диалогов", "Wait for the first dialogue to finish")], ["none", t("Не дожидаться завершения диалогов", "Do not wait for dialogues")]]);
      break;
    }
  }
  return table(rows);
}

export function renderScriptParameters(step, context = {}) {
  return fields(completeScriptParameters(step.kind, step.parameters, context.document), { ...context, kind: step.kind });
}

/** Both editors share the same textarea value, which is also what Save reads.
 * Only the parameter table is replaced when conditional fields change. */
export function bindScriptParameters(root, getContext, onChange, options) {
  let closePicker = () => {};
  const renderedParameters = new WeakMap();
  const controls = (target) => {
    const row = target.closest("[data-script-step]");
    if (!row) return null;
    const index = Number(row.closest("[data-script-index]").dataset.scriptIndex), stepIndex = Number(row.dataset.scriptStep);
    return { row, index, stepIndex, area: row.querySelector("[data-script-json-value]"), kind: row.querySelector("[data-script-kind]").value };
  };
  const repaint = (state, parameters) => {
    closePicker();
    const host = state.row.querySelector("[data-script-parameter-fields]"), closed = new Set([...host.querySelectorAll("details:not([open])")].map((entry) => entry.dataset.paramGroup));
    const active = host.ownerDocument.activeElement, focused = host.contains(active) ? { path: active.dataset.scriptParam, group: active.dataset.scriptParamGroup, nullable: active.dataset.scriptParamNull } : null;
    host.innerHTML = fields(parameters, { ...getContext(), index: state.index, stepIndex: state.stepIndex, kind: state.kind });
    renderedParameters.set(state.row, JSON.stringify(parameters));
    for (const detail of host.querySelectorAll("details")) if (closed.has(detail.dataset.paramGroup)) detail.open = false;
    if (focused) [...host.querySelectorAll("input,select,textarea")].find((control) => focused.path ? control.dataset.scriptParam === focused.path : focused.group ? control.dataset.scriptParamGroup === focused.group : focused.nullable && control.dataset.scriptParamNull === focused.nullable)?.focus();
  };
  const synchronize = (event) => {
    const target = event.target;
    if (!target.matches("[data-script-param],[data-script-param-group],[data-script-param-null],[data-script-json-value],[data-script-state-group],[data-script-state-value]")) return;
    const state = controls(target); if (!state) return;
    if (target.matches("[data-script-duration]")) target.closest("tr")?.classList.toggle("ms-script-zero-duration", target.valueAsNumber === 0);
    try {
      let parameters = completeScriptParameters(state.kind, JSON.parse(state.area.value), getContext().document);
      if (target.matches("[data-script-json-value]")) {
        // Blur emits change after input. Rebuilding again would remove a button
        // between pointerdown and click and lose the user's first action.
        if (renderedParameters.get(state.row) !== JSON.stringify(parameters)) repaint(state, parameters);
        if (event.type === "change") state.area.value = JSON.stringify(parameters, null, 2);
      }
      else if (target.matches("[data-script-state-group],[data-script-state-value]")) {
        const pair = parameters.transitions[Number(target.dataset.pairIndex)];
        if (target.matches("[data-script-state-group]")) {
          const group = getContext().definitions.find((item) => item.groupId === target.value);
          if (!group) throw new Error(t("Группа больше не существует.", "The group no longer exists."));
          pair.groupId = group.groupId; pair.stateId = group.entryStateId;
        } else pair.stateId = target.value;
        state.area.value = JSON.stringify(parameters, null, 2);
        if (event.type === "change") repaint(state, parameters);
      } else {
        if (target.matches("[data-script-param-group]")) {
          const key = target.dataset.scriptParamGroup;
          parameters[key] = target.checked ? completeScriptParameters(state.kind, undefined, getContext().document)[key] : null;
        } else if (target.matches("[data-script-param-null]")) setScriptParameter(parameters, target.dataset.scriptParamNull, target.checked ? null : target.dataset.nullType === "boolean" ? false : ["integer", "number"].includes(target.dataset.nullType) ? 0 : "");
        else {
          const type = target.dataset.paramType;
          const entry = type === "boolean" ? target.checked : type === "number" ? target.value === "" && target.dataset.paramNullable ? null : target.valueAsNumber : type === "tags" ? target.value.split(",").map((tag) => tag.trim()).filter(Boolean) : type === "lines" ? target.value.split(/[\s,]+/).filter(Boolean) : type === "json" ? JSON.parse(target.value) : target.value;
          if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error(t("Введите число.", "Enter a number."));
          setScriptParameter(parameters, target.dataset.scriptParam, entry);
          if (state.kind === "signal" && JSON.parse(target.dataset.scriptParam)[0] === "signalId") {
            const signal = getContext().catalog?.signals.find((item) => item.id === entry);
            parameters.parameters = Object.fromEntries((signal?.parameters ?? []).map((field) => [field.name, fieldInitialValue(field)]));
          }
        }
        state.area.value = JSON.stringify(parameters, null, 2);
        const path = target.dataset.scriptParam && JSON.parse(target.dataset.scriptParam);
        const changesFields = target.matches("[data-script-param-group],[data-script-param-null]") || path?.[0] === "timeMode" || path?.[0] === "signalId" || path?.at(-1) === "enabled";
        if (event.type === "change" && changesFields) repaint(state, parameters);
      }
      renderedParameters.set(state.row, JSON.stringify(parameters));
      state.area.setCustomValidity(""); target.setCustomValidity?.(""); onChange();
    } catch (error) { target.setCustomValidity?.(error.message); }
  };
  root.addEventListener("input", synchronize, options);
  root.addEventListener("change", synchronize, options);
  root.addEventListener("click", (event) => {
    const stateButton = event.target.closest("[data-script-state-add],[data-script-state-remove]");
    if (stateButton) {
      event.preventDefault(); event.stopPropagation();
      const state = controls(stateButton);
      try {
        const parameters = completeScriptParameters(state.kind, JSON.parse(state.area.value), getContext().document);
        if (stateButton.hasAttribute("data-script-state-add")) {
          const group = (getContext().definitions ?? []).find((item) => !parameters.transitions.some((pair) => pair.groupId === item.groupId));
          if (!group) return;
          parameters.transitions.push({ groupId: group.groupId, stateId: group.entryStateId });
        } else parameters.transitions.splice(Number(stateButton.dataset.scriptStateRemove), 1);
        state.area.value = JSON.stringify(parameters, null, 2); state.area.setCustomValidity(""); repaint(state, parameters); onChange();
      } catch (error) { state.area.setCustomValidity(error.message); state.area.hidden = false; state.area.reportValidity(); }
      return;
    }
    const picker = event.target.closest("[data-script-emoji-picker]");
    if (picker) {
      event.preventDefault(); event.stopPropagation();
      const wasOpen = picker.getAttribute("aria-expanded") === "true"; closePicker();
      if (!wasOpen) closePicker = openEmojiPicker(picker, { signal: options?.signal, onSelect(symbol) {
        const input = picker.parentElement.querySelector("[data-script-param]");
        input.value = symbol; input.dispatchEvent(new input.ownerDocument.defaultView.Event("input", { bubbles: true })); input.focus();
      } });
      return;
    }
    const button = event.target.closest("[data-script-json]"); if (!button) return;
    event.preventDefault(); event.stopPropagation(); const state = controls(button);
    state.area.hidden = !state.area.hidden; button.setAttribute("aria-expanded", String(!state.area.hidden));
    if (!state.area.hidden) state.area.focus();
  }, options);
}
