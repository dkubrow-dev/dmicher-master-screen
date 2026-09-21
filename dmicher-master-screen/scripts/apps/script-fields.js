import { text as t } from "../localization.js";
import { moveScriptStep } from "../script-editing.js";
import { escapeHTML as e, formValue, parameterRow, selectOptions } from "./form-fields.js";
import { normalizeScriptInterruptions } from "../script-interruption-model.js";
import { completeScriptParameters, renderScriptParameters } from "./script-parameters.js";
import { generics } from "../generics.js";
import { scriptTransitionMacroTemplate } from "../script-transitions.js";
import { canExecuteScriptKind, isPlayerActionLockAvailable } from "../premium-provider.js";
import { getScriptCatalogEntries } from "./script-catalog-input.js";

export function buildScriptInterruptionFields(interruptions, prefix, { legend = t("При прерывании скрипта", "When the script is interrupted"), modeNames = {}, excludedSources = [], playerCharacter = false } = {}) {
  const settings = normalizeScriptInterruptions(interruptions);
  const modes = [
    { id: "stop", name: t("Прервать", "Stop") },
    { id: "restart-step", name: modeNames["restart-step"] ?? t("Продолжить с начала текущего шага", "Restart the current step") },
    { id: "next-step", name: modeNames["next-step"] ?? t("Перейти к следующему шагу", "Go to the next step") },
    { id: "restart-script", name: modeNames["restart-script"] ?? t("Продолжить с начала скрипта", "Restart the script") }
  ];
  const rows = [
    ["combat", t("Боем", "Combat")], playerCharacter ? ["playerAction", t("Действием игрока", "Player action")] : ["interaction", t("Взаимодействием с игроком", "Player interaction")],
    ["manual", t("Ручной остановкой", "Manual stop")], ["command", t("Командой", "Command")], ["error", t("Ошибкой", "Error")]
  ].filter(([source]) => !excludedSources.includes(source)).map(([source, label]) => {
    if (source === "playerAction") {
      const forbid = settings.playerAction === "forbid", access = isPlayerActionLockAvailable();
      return parameterRow(label, `<select name="${prefix}-interruption-playerAction" aria-label="${e(label)}"><option value="stop"${forbid ? "" : " selected"}>${t("Прервать", "Stop")}</option><option value="forbid"${forbid ? " selected" : ""}${access ? "" : " disabled"}>${t("Запрещать", "Forbid")}</option></select><span class="dmicher-premium-badge">Premium</span>`);
    }
    return parameterRow(label, `<select name="${prefix}-interruption-${source}" aria-label="${e(label)}"${source === "error" ? " data-script-error-mode" : ""}>${selectOptions(source === "command" ? [...modes, { id: "ignore", name: t("Игнорировать", "Ignore") }] : modes, source === "error" ? settings.error.mode : settings[source])}</select>`);
  });
  const disabled = settings.error.mode === "stop" ? " disabled" : "";
  const retriesLabel = t("Повторов после ошибки", "Retries after an error");
  const delayLabel = t("Таймаут повторений, с", "Retry delay, seconds");
  rows.push(parameterRow(retriesLabel, `<input type="number" name="${prefix}-interruption-retries" aria-label="${e(retriesLabel)}" min="1" max="10" step="1" value="${settings.error.retries}" data-script-error-setting${disabled}>`));
  rows.push(parameterRow(delayLabel, `<input type="number" name="${prefix}-interruption-delay" aria-label="${e(delayLabel)}" min="0.1" max="60" step="any" value="${settings.error.delaySeconds}" data-script-error-setting${disabled}>`));
  return `<fieldset class="ms-script-interruptions"><legend>${e(legend)}</legend><table class="ms-parameter-table"><tbody>${rows.join("")}</tbody></table></fieldset>`;
}

export function readScriptInterruptionFields(root, prefix, previous) {
  if (!root.querySelector(`[name="${prefix}-interruption-combat"]`)) return previous;
  const value = name => formValue(root, `${prefix}-interruption-${name}`);
  const playerAction = root.querySelector(`[name="${prefix}-interruption-playerAction"]`);
  return {
    combat: value("combat"), interaction: playerAction ? previous?.interaction ?? "stop" : value("interaction"), playerAction: playerAction ? value("playerAction") : previous?.playerAction ?? "stop",
    manual: value("manual"), command: value("command") || previous?.command || "stop",
    error: { mode: value("error"), retries: Number(value("retries")), delaySeconds: Number(value("delay")) }
  };
}

/** Error retry fields retain their values while Stop makes them inactive. */
export function bindScriptInterruptions(root, options) {
  root.addEventListener("change", event => {
    if (event.target.matches?.("[data-script-transition-mode]")) {
      const cell = event.target.closest("[data-script-transition]"), mode = event.target.value;
      for (const field of cell.querySelectorAll("[data-transition-field]")) field.hidden = field.dataset.transitionField !== mode;
      const macro = cell.querySelector("[data-transition-source]");
      if (mode === "macro" && !macro.value.trim()) macro.value = scriptTransitionMacroTemplate({ steps: [...cell.closest(".ms-script-table").querySelectorAll("[data-step-id]")].map(row => ({ id: Number(row.dataset.stepId) })) });
      return;
    }
    if (!event.target.matches?.("[data-script-error-mode]")) return;
    const disabled = event.target.value === "stop";
    for (const field of event.target.closest(".ms-script-interruptions").querySelectorAll("[data-script-error-setting]")) field.disabled = disabled;
  }, options);
}

function transitionFields(step, prefix) {
  const transition = step.transition ?? { mode: "any", macro: "" };
  const options = [{ id: "next", name: t("Следующий", "Next row") }, { id: "any", name: t("Любой из", "Any of") }, { id: "macro", name: t("Макрос", "Macro") }];
  return `<select data-script-transition-mode name="${prefix}-transition-mode" aria-label="${t("Режим перехода", "Transition mode")}">${selectOptions(options, transition.mode)}</select>
    <input data-transition-field="any" name="${prefix}-next" aria-label="${t("Следующие шаги", "Next steps")}" value="${e(step.next.join(", "))}" placeholder="—"${transition.mode === "any" ? "" : " hidden"}>
    <div data-transition-field="macro"${transition.mode === "macro" ? "" : " hidden"}><textarea data-transition-source name="${prefix}-transition-macro" aria-label="${t("Макрос перехода", "Transition macro")}" spellcheck="false">${e(transition.macro)}</textarea></div>`;
}

/** Next-row transitions follow display order; explicit edges retain step IDs. */
export function buildScriptFields(scripts, definition, type, catalog, { ownerKey, document, functionsOwner, owner = functionsOwner ?? document, scriptScope = "object", language, playerCharacter = false, definitions = definition?.groupId ? [definition] : [], dialogueOptions = [], open = false, combatSupported = false, ...parameterContext } = {}) {
  const functions = getScriptCatalogEntries({ scriptScope, owner, language });
  const blocks = scripts.map((script, index) => {
    const prefix = `script-${index}`;
    const check = (name, label, active) => `<label class="ms-check"><input type="checkbox" name="${prefix}-${name}"${active ? " checked" : ""}>${e(label)}</label>`;
    const combat = script.combat ?? {};
    return `<details class="ms-object-feature ms-script-block" data-script-index="${index}"${open ? " open" : ""}><summary>${e(script.name || t("Скрипт", "Script"))}</summary><div class="ms-object-row">
      <label>${t("Название скрипта", "Script name")}<input name="${prefix}-name" value="${e(script.name)}"></label>${check("enabled", t("Включить", "Enable"), script.enabled !== false)}</div>
      <div class="ms-script-table-scroll"><table class="ms-script-table"><thead><tr><th>№</th><th>${t("Функция и параметры", "Function and parameters")}</th><th>${t("Переход", "Next")}</th></tr></thead><tbody>
      ${script.steps.map((step, stepIndex) => `<tr data-script-step="${stepIndex}" data-step-id="${step.id}"><td><span role="button" tabindex="0" class="ms-script-drag" data-script-drag draggable="true" aria-label="${t(`Переместить шаг ${step.id}; Alt и стрелки вверх/вниз`, `Move step ${step.id}; Alt and Up/Down arrows`)}">⠿</span>${step.id}</td><td class="ms-script-main-cell"><span class="ms-script-kind-storage" hidden><input type="hidden" name="${prefix}-step-${stepIndex}-kind" data-script-kind data-index="${index}" data-step="${stepIndex}" value="${e(step.kind)}"></span><div class="ms-script-kind-row"><span class="ms-script-value ms-script-kind-field"><input type="text" data-script-kind-input aria-label="${t("Функция", "Function")}" value="${e(functions.find(entry => entry.id === step.kind)?.path ?? step.kind)}" autocomplete="off"><button type="button" data-script-kind-button aria-haspopup="dialog" aria-expanded="false" aria-label="${t("Открыть справочник функций", "Open function catalog")}">⌄</button></span>
        <span class="ms-script-json-action"><button type="button" data-script-json aria-expanded="false" aria-label="${t("Редактор JSON параметров", "Parameter JSON editor")}"${canExecuteScriptKind(step.kind) ? "" : " disabled"}>JSON</button></span></div>
        <div data-script-parameter-fields>${renderScriptParameters(step, { ...parameterContext, index, stepIndex, document, ownerKey, catalog, definitions, dialogueOptions })}</div><textarea name="${prefix}-step-${stepIndex}-parameters" data-script-json-value hidden aria-label="${t("Параметры шага", "Step parameters")}" spellcheck="false"${canExecuteScriptKind(step.kind) ? "" : " disabled"}>${e(JSON.stringify(completeScriptParameters(step.kind, step.parameters, document), null, 2))}</textarea></td>
        <td data-script-transition><div class="ms-script-transition-shell"><div class="ms-script-transition-fields">${transitionFields(step, `${prefix}-step-${stepIndex}`)}</div><button type="button" class="ms-script-remove" data-screen-action="remove-script-step" data-index="${index}" data-step="${stepIndex}" aria-label="${t("Удалить шаг", "Remove step")}"${step.id === 1 && script.steps.length > 1 ? ` disabled data-tooltip="${t("Начальный шаг 1 нужен, пока в блоке есть другие шаги.", "Entry step 1 is required while other steps remain.")}"` : ""}>×</button></div></td></tr>`).join("")}
      </tbody></table></div>
      <p class="ms-note">${t("Запуск начинается с шага 1. «Следующий» выполняет строку ниже; «Любой из» и макрос выбирают по номерам шагов.", "Execution starts at step 1. Next row follows display order; Any of and Macro select step IDs.")}</p>
      <button type="button" data-screen-action="add-script-step" data-index="${index}">+ ${t("Шаг", "Step")}</button>
      ${check("repeat", t("Повторять", "Repeat"), script.repeat)}
      ${buildScriptInterruptionFields(script.interruptions, prefix, { playerCharacter })}
      ${combatSupported ? `<fieldset class="ms-script-combat"><legend>${t("Использование в бою", "Combat use")}</legend>${check("combat-enabled", t("Использовать", "Use in combat"), combat.enabled)}${check("combat-confirm", t("Подтверждать действие", "Confirm action"), combat.confirm !== false)}<div>${check("combat-warning", t("Предупреждение", "Warning"), combat.notifyWarning !== false)}${check("combat-chat", t("В чате мастеру", "In GM chat"), combat.notifyChat)}${check("combat-end-turn", t("Завершать ход", "End turn"), combat.endTurn)}</div><label>${t("Длительность хода, с", "Turn duration, seconds")}<input type="number" min="0.01" step="any" name="${prefix}-combat-seconds" value="${e(combat.turnSeconds ?? 6)}"></label></fieldset>` : ""}
      <div class="ms-script-block-actions"><button type="button" data-screen-action="save">${t("Сохранить", "Save")}</button>${generics.components.renderJSONControls({ id: `script-block-${index}`, importLabel: t("Импорт JSON", "Import JSON"), exportLabel: t("Экспорт JSON", "Export JSON") })}</div></details>`;
  }).join("");
  return blocks;
}

export function readScriptFields(root, scripts) {
  for (const control of root.querySelectorAll?.("[data-script-param]") ?? []) {
    if (!control.disabled && !control.matches?.(":disabled") && control.checkValidity?.() === false) throw new Error(`${control.getAttribute("aria-label") ?? ""}: ${control.validationMessage}`);
  }
  const value = (name) => formValue(root, name);
  return scripts.map((script, index) => {
    const prefix = `script-${index}`;
    const on = (name) => root.querySelector(`[name="${prefix}-${name}"]`)?.checked === true;
    const combat = root.querySelector(`[name="${prefix}-combat-enabled"]`) ? { enabled: on("combat-enabled"), confirm: on("combat-confirm"), notifyWarning: on("combat-warning"), notifyChat: on("combat-chat"), endTurn: on("combat-end-turn"), turnSeconds: Number(value(`${prefix}-combat-seconds`)) } : script.combat;
    const interruptions = readScriptInterruptionFields(root, prefix, script.interruptions);
    return { ...script, name: value(`${prefix}-name`), enabled: on("enabled"), repeat: on("repeat"), ...(combat ? { combat } : {}), interruptions,
      steps: script.steps.map((step, stepIndex) => {
        const key = `${prefix}-step-${stepIndex}`;
        const kind = value(`${key}-kind`);
        let parameters;
        try { parameters = canExecuteScriptKind(kind) ? JSON.parse(value(`${key}-parameters`)) : kind === step.kind ? structuredClone(step.parameters) : completeScriptParameters(kind); }
        catch { throw new Error(t(`Шаг ${step.id}: исправьте JSON параметров.`, `Step ${step.id}: correct the parameter JSON.`)); }
        const raw = value(`${key}-next`).trim(), next = raw ? raw.split(",").map((part) => {
          if (!/^\s*[1-9]\d*\s*$/.test(part) || !Number.isSafeInteger(Number(part))) throw new Error(t("Переходы — положительные номера шагов через запятую.", "Next steps must be positive step numbers separated by commas."));
          return Number(part);
        }) : [];
        return { ...step, kind, parameters, next, transition: { mode: value(`${key}-transition-mode`) || step.transition?.mode || "any", macro: value(`${key}-transition-macro`) ?? step.transition?.macro ?? "" } };
      }) };
  });
}

/** Move existing DOM rows so unfinished JSON and focus survive; never reinterpret edges. */
export function bindScriptSorting(root, scripts, onChange, options) {
  let dragging;
  const move = (row, to) => {
    const block = row.closest("[data-script-index]"), index = Number(block.dataset.scriptIndex), from = Number(row.dataset.scriptStep);
    const body = row.parentElement, rows = [...body.children];
    if (!moveScriptStep(scripts[index], from, to)) return;
    body.insertBefore(row, to > from ? rows[to].nextSibling : rows[to]);
    [...body.children].forEach((entry, stepIndex) => {
      const oldPrefix = `script-${index}-step-${entry.dataset.scriptStep}-`, newPrefix = `script-${index}-step-${stepIndex}-`;
      for (const control of entry.querySelectorAll("[name]")) if (control.name.startsWith(oldPrefix)) control.name = newPrefix + control.name.slice(oldPrefix.length);
      for (const control of entry.querySelectorAll("[data-step]")) control.dataset.step = String(stepIndex);
      entry.dataset.scriptStep = String(stepIndex);
    });
    onChange();
  };
  const clear = () => { dragging?.classList.remove("is-dragging"); dragging = null; for (const row of root.querySelectorAll(".ms-script-drop-before,.ms-script-drop-after")) row.classList.remove("ms-script-drop-before", "ms-script-drop-after"); };
  root.addEventListener("dragstart", (event) => {
    if (!event.target.closest("[data-script-drag]")) return;
    dragging = event.target.closest("[data-script-step]"); dragging.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", dragging.dataset.stepId);
  }, options);
  root.addEventListener("dragover", (event) => {
    const target = event.target.closest("[data-script-step]");
    if (!dragging || target?.parentElement !== dragging.parentElement) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    for (const row of dragging.parentElement.children) row.classList.remove("ms-script-drop-before", "ms-script-drop-after");
    target.classList.add(event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2 ? "ms-script-drop-before" : "ms-script-drop-after");
  }, options);
  root.addEventListener("drop", (event) => {
    const target = event.target.closest("[data-script-step]");
    if (!dragging || target?.parentElement !== dragging.parentElement) return;
    event.preventDefault(); event.stopPropagation();
    const from = Number(dragging.dataset.scriptStep), targetIndex = Number(target.dataset.scriptStep);
    const after = event.clientY >= target.getBoundingClientRect().top + target.offsetHeight / 2;
    move(dragging, Math.max(0, Math.min(dragging.parentElement.children.length - 1, targetIndex + (after ? 1 : 0) - (from < targetIndex + (after ? 1 : 0) ? 1 : 0)))); clear();
  }, options);
  root.addEventListener("dragend", clear, options);
  root.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-script-drag]");
    if (!handle || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const row = handle.closest("[data-script-step]"); move(row, Number(row.dataset.scriptStep) + (event.key === "ArrowUp" ? -1 : 1)); handle.focus();
  }, options);
}
