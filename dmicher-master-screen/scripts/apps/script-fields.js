import { generics } from "../generics.js";
import { scriptStepTemplate } from "../script-model.js";
import { completeScriptParameters, renderScriptParameters } from "./script-parameters.js";

const t = (ru, en) => game.i18n?.lang?.startsWith("ru") ? ru : en;
const e = (value) => generics.utilities.escapeHTML(String(value ?? ""));
const kinds = () => [["wait", t("Ожидание", "Wait")], ["move", t("Перемещение", "Move")],
  ["visibility", t("Видимость", "Visibility")],
  ["speech", t("Реплика", "Speech")], ["emotion", t("Эмоция", "Emotion")],
  ["sound", t("Звук", "Sound")], ["signal", t("Сигнал", "Signal")], ["macro", t("Макрос", "Macro")]];

/** Row order is presentation only. IDs and outgoing edges define execution. */
export function buildScriptFields(scripts, definition, type, catalog, { ownerKey, document, open = false, combatSupported = false } = {}) {
  const blocks = scripts.map((script, index) => {
    const prefix = `script-${index}`;
    const check = (name, label, active) => `<label class="ms-check"><input type="checkbox" name="${prefix}-${name}"${active ? " checked" : ""}>${e(label)}</label>`;
    const combat = script.combat ?? {};
    return `<details class="ms-object-feature ms-script-block" data-script-index="${index}"${open ? " open" : ""}><summary>${e(script.name || t("Скрипт", "Script"))}</summary><div class="ms-object-row">
      <label>${t("Название скрипта", "Script name")}<input name="${prefix}-name" value="${e(script.name)}"></label>${check("enabled", t("Включить", "Enable"), script.enabled !== false)}</div>
      <div class="ms-script-table-scroll"><table class="ms-script-table"><thead><tr><th>№</th><th>${t("Функция", "Function")}</th><th>${t("Параметры", "Parameters")}</th><th>${t("Переход", "Next")}</th><th></th></tr></thead><tbody>
      ${script.steps.map((step, stepIndex) => `<tr data-script-step="${stepIndex}" data-step-id="${step.id}"><td><span role="button" tabindex="0" class="ms-script-drag" data-script-drag draggable="true" aria-label="${t(`Переместить шаг ${step.id}; Alt и стрелки вверх/вниз`, `Move step ${step.id}; Alt and Up/Down arrows`)}">⠿</span>${step.id}</td><td><select aria-label="${t("Функция", "Function")}" name="${prefix}-step-${stepIndex}-kind" data-script-kind data-index="${index}" data-step="${stepIndex}">${kinds().map(([kind, name]) => `<option value="${kind}"${step.kind === kind ? " selected" : ""}>${e(name)}</option>`).join("")}</select>
        <button type="button" data-script-json aria-expanded="false" aria-label="${t("Редактор JSON параметров", "Parameter JSON editor")}">JSON</button></td>
        <td><div data-script-parameter-fields>${renderScriptParameters(step, { index, stepIndex, document, ownerKey, catalog })}</div><textarea name="${prefix}-step-${stepIndex}-parameters" data-script-json-value hidden aria-label="${t("Параметры шага", "Step parameters")}" spellcheck="false">${e(JSON.stringify(completeScriptParameters(step.kind, step.parameters, document), null, 2))}</textarea></td>
        <td><input name="${prefix}-step-${stepIndex}-next" aria-label="${t("Следующие шаги", "Next steps")}" value="${e(step.next.join(", "))}" placeholder="—"></td>
        <td><button type="button" data-screen-action="remove-script-step" data-index="${index}" data-step="${stepIndex}" aria-label="${t("Удалить шаг", "Remove step")}"${step.id === 1 && script.steps.length > 1 ? ` disabled data-tooltip="${t("Начальный шаг 1 нужен, пока в блоке есть другие шаги.", "Entry step 1 is required while other steps remain.")}"` : ""}>×</button></td></tr>`).join("")}
      </tbody></table></div>
      <p class="ms-note">${t("Перетаскивание меняет только порядок строк. Запуск начинается с шага 1; номера и переходы сохраняются.", "Dragging changes row order only. Execution starts at step 1; IDs and transitions stay unchanged.")}</p>
      <button type="button" data-screen-action="add-script-step" data-index="${index}">+ ${t("Шаг", "Step")}</button>
      ${check("repeat", t("Повторять", "Repeat"), script.repeat)}
      ${combatSupported ? `<fieldset class="ms-script-combat"><legend>${t("Использование в бою", "Combat use")}</legend>${check("combat-enabled", t("Использовать", "Use in combat"), combat.enabled)}${check("combat-confirm", t("Подтверждать действие", "Confirm action"), combat.confirm !== false)}<div>${check("combat-warning", t("Предупреждение", "Warning"), combat.notifyWarning !== false)}${check("combat-chat", t("В чате мастеру", "In GM chat"), combat.notifyChat)}${check("combat-end-turn", t("Завершать ход", "End turn"), combat.endTurn)}</div><label>${t("Длительность хода, с", "Turn duration, seconds")}<input type="number" min="0.01" step="any" name="${prefix}-combat-seconds" value="${e(combat.turnSeconds ?? 6)}"></label></fieldset>` : ""}
      <button type="button" data-screen-action="save">${t("Сохранить", "Save")}</button></details>`;
  }).join("");
  return blocks;
}

export function readScriptFields(root, scripts) {
  for (const control of root.querySelectorAll?.("[data-script-param]") ?? []) {
    if (!control.disabled && control.checkValidity?.() === false) throw new Error(`${control.getAttribute("aria-label") ?? ""}: ${control.validationMessage}`);
  }
  const value = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
  return scripts.map((script, index) => {
    const prefix = `script-${index}`;
    const on = (name) => root.querySelector(`[name="${prefix}-${name}"]`)?.checked === true;
    const combat = root.querySelector(`[name="${prefix}-combat-enabled"]`) ? { enabled: on("combat-enabled"), confirm: on("combat-confirm"), notifyWarning: on("combat-warning"), notifyChat: on("combat-chat"), endTurn: on("combat-end-turn"), turnSeconds: Number(value(`${prefix}-combat-seconds`)) } : script.combat;
    return { ...script, name: value(`${prefix}-name`), enabled: on("enabled"), repeat: on("repeat"), ...(combat ? { combat } : {}),
      steps: script.steps.map((step, stepIndex) => {
        const key = `${prefix}-step-${stepIndex}`;
        let parameters;
        try { parameters = JSON.parse(value(`${key}-parameters`)); }
        catch { throw new Error(t(`Шаг ${step.id}: исправьте JSON параметров.`, `Step ${step.id}: correct the parameter JSON.`)); }
        const raw = value(`${key}-next`).trim(), next = raw ? raw.split(",").map((part) => {
          if (!/^\s*[1-9]\d*\s*$/.test(part) || !Number.isSafeInteger(Number(part))) throw new Error(t("Переходы — положительные номера шагов через запятую.", "Next steps must be positive step numbers separated by commas."));
          return Number(part);
        }) : [];
        return { ...step, kind: value(`${key}-kind`), parameters, next };
      }) };
  });
}

export function appendScriptStep(script) {
  const id = Math.max(0, ...script.steps.map((step) => step.id)) + 1;
  const previous = script.steps.at(-1);
  if (previous && !previous.next.length) previous.next = [id];
  script.steps.push({ id, ...scriptStepTemplate("wait") });
}

export function removeScriptStep(script, index) {
  if (script.steps[index]?.id === 1 && script.steps.length > 1) throw new Error(t("Сначала удалите остальные шаги: шаг 1 начинает рутину.", "Remove the other steps first: step 1 starts the script."));
  const [removed] = script.steps.splice(index, 1);
  if (removed) for (const step of script.steps) step.next = step.next.filter((id) => id !== removed.id);
}

export function moveScriptStep(script, from, to) {
  if (![from, to].every((index) => Number.isInteger(index) && index >= 0 && index < script.steps.length) || from === to) return false;
  script.steps.splice(to, 0, script.steps.splice(from, 1)[0]);
  return true;
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
