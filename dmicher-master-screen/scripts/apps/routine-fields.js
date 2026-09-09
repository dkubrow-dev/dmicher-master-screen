import { generics } from "../generics.js";
import { routineStepTemplate } from "../routine-model.js";

const t = (ru, en) => game.i18n?.lang?.startsWith("ru") ? ru : en;
const e = (value) => generics.utilities.escapeHTML(String(value ?? ""));
const kinds = () => [["wait", t("Ожидание", "Wait")], ["move", t("Перемещение", "Move")],
  ["speech", t("Реплика", "Speech")], ["emotion", t("Эмоция", "Emotion")],
  ["event", t("Событие", "Event")], ["macro", t("Макрос", "Macro")]];

/** Row order is presentation only. IDs and outgoing edges define execution. */
export function buildRoutineFields(routines, definition, type, catalog) {
  if (type !== "Token") return `<p>${t("Рутина доступна для токенов.", "Routines are available for tokens.")}</p>`;
  const blocks = routines.map((routine, index) => {
    const prefix = `routine-${index}`;
    const episodes = definition.episodes.filter((episode) => episode.id === routine.episodeId || !routines.some((item) => item.episodeId === episode.id));
    return `<section class="ms-object-feature" data-routine-index="${index}"><div class="ms-object-row">
      <label>${t("Эпизод", "Episode")}<select name="${prefix}-episode">${episodes.map((episode) => `<option value="${e(episode.id)}"${episode.id === routine.episodeId ? " selected" : ""}>${e(episode.name)}</option>`).join("")}</select></label>
      <button type="button" data-screen-action="remove-routine" data-index="${index}">${t("Удалить блок", "Remove block")}</button></div>
      <div class="ms-routine-table-scroll"><table class="ms-routine-table"><thead><tr><th>№</th><th>${t("Функция", "Function")}</th><th>${t("Параметры (JSON)", "Parameters (JSON)")}</th><th>${t("Переход", "Next")}</th><th></th></tr></thead><tbody>
      ${routine.steps.map((step, stepIndex) => `<tr data-routine-step="${stepIndex}" data-step-id="${step.id}"><td><span role="button" tabindex="0" class="ms-routine-drag" data-routine-drag draggable="true" aria-label="${t(`Переместить шаг ${step.id}; Alt и стрелки вверх/вниз`, `Move step ${step.id}; Alt and Up/Down arrows`)}">⠿</span>${step.id}</td><td><select aria-label="${t("Функция", "Function")}" name="${prefix}-step-${stepIndex}-kind" data-routine-kind data-index="${index}" data-step="${stepIndex}">${kinds().map(([kind, name]) => `<option value="${kind}"${step.kind === kind ? " selected" : ""}>${e(name)}</option>`).join("")}</select>
        ${step.kind === "move" ? `<button type="button" data-screen-action="routine-point" data-index="${index}" data-step="${stepIndex}">${t("Точка с карты", "Map point")}</button>` : ""}
        ${step.kind === "event" || step.kind === "macro" ? `<select aria-label="${t("Выбрать определение", "Choose definition")}" data-routine-definition data-index="${index}" data-step="${stepIndex}"><option value="">${t("Выбрать…", "Choose…")}</option>${(step.kind === "event" ? catalog.triggers : catalog.macros).map((item) => {
          const id = item.id ?? item.uuid, label = item.uuid ? game.macros?.get?.(item.uuid.split(".").at(-1))?.name ?? item.uuid : item.name;
          return `<option value="${e(id)}"${id === (step.parameters.triggerId ?? step.parameters.macroUuid) ? " selected" : ""}>${e(label)}</option>`;
        }).join("")}</select>` : ""}</td>
        <td><textarea name="${prefix}-step-${stepIndex}-parameters" aria-label="${t("Параметры шага", "Step parameters")}" spellcheck="false">${e(JSON.stringify(step.parameters, null, 2))}</textarea></td>
        <td><input name="${prefix}-step-${stepIndex}-next" aria-label="${t("Следующие шаги", "Next steps")}" value="${e(step.next.join(", "))}" placeholder="—"></td>
        <td><button type="button" data-screen-action="remove-routine-step" data-index="${index}" data-step="${stepIndex}" aria-label="${t("Удалить шаг", "Remove step")}"${step.id === 1 && routine.steps.length > 1 ? ` disabled data-tooltip="${t("Начальный шаг 1 нужен, пока в блоке есть другие шаги.", "Entry step 1 is required while other steps remain.")}"` : ""}>×</button></td></tr>`).join("")}
      </tbody></table></div>
      <p class="ms-note">${t("Перетаскивание меняет только порядок строк. Запуск начинается с шага 1; номера и переходы сохраняются.", "Dragging changes row order only. Execution starts at step 1; IDs and transitions stay unchanged.")}</p>
      <button type="button" data-screen-action="add-routine-step" data-index="${index}">+ ${t("Шаг", "Step")}</button>
      <label class="ms-check"><input type="checkbox" name="${prefix}-repeat"${routine.repeat ? " checked" : ""}>${t("Повторять", "Repeat")}</label></section>`;
  }).join("");
  const available = definition.episodes.some((episode) => !routines.some((routine) => routine.episodeId === episode.id));
  return `${blocks || `<p class="ms-note">${t("Блоков нет — рутина не выполняется. Добавьте поведение для нужного эпизода.", "No blocks: no routine runs. Add behavior for an episode.")}</p>`}
    <button type="button" data-screen-action="add-routine"${available ? "" : " disabled"}>+ ${t("Рутина эпизода", "Episode routine")}</button>`;
}

export function readRoutineFields(root, routines) {
  const value = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
  return routines.map((routine, index) => {
    const prefix = `routine-${index}`;
    return { ...routine, episodeId: value(`${prefix}-episode`), repeat: root.querySelector(`[name="${prefix}-repeat"]`)?.checked === true,
      steps: routine.steps.map((step, stepIndex) => {
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

export function appendRoutineStep(routine) {
  const id = Math.max(0, ...routine.steps.map((step) => step.id)) + 1;
  const previous = routine.steps.at(-1);
  if (previous && !previous.next.length) previous.next = [id];
  routine.steps.push({ id, ...routineStepTemplate("wait") });
}

export function removeRoutineStep(routine, index) {
  if (routine.steps[index]?.id === 1 && routine.steps.length > 1) throw new Error(t("Сначала удалите остальные шаги: шаг 1 начинает рутину.", "Remove the other steps first: step 1 starts the routine."));
  const [removed] = routine.steps.splice(index, 1);
  if (removed) for (const step of routine.steps) step.next = step.next.filter((id) => id !== removed.id);
}

export function moveRoutineStep(routine, from, to) {
  if (![from, to].every((index) => Number.isInteger(index) && index >= 0 && index < routine.steps.length) || from === to) return false;
  routine.steps.splice(to, 0, routine.steps.splice(from, 1)[0]);
  return true;
}

/** Move existing DOM rows so unfinished JSON and focus survive; never reinterpret edges. */
export function bindRoutineSorting(root, routines, onChange, options) {
  let dragging;
  const move = (row, to) => {
    const block = row.closest("[data-routine-index]"), index = Number(block.dataset.routineIndex), from = Number(row.dataset.routineStep);
    const body = row.parentElement, rows = [...body.children];
    if (!moveRoutineStep(routines[index], from, to)) return;
    body.insertBefore(row, to > from ? rows[to].nextSibling : rows[to]);
    [...body.children].forEach((entry, stepIndex) => {
      const oldPrefix = `routine-${index}-step-${entry.dataset.routineStep}-`, newPrefix = `routine-${index}-step-${stepIndex}-`;
      for (const control of entry.querySelectorAll("[name]")) if (control.name.startsWith(oldPrefix)) control.name = newPrefix + control.name.slice(oldPrefix.length);
      for (const control of entry.querySelectorAll("[data-step]")) control.dataset.step = String(stepIndex);
      entry.dataset.routineStep = String(stepIndex);
    });
    onChange();
  };
  const clear = () => { dragging?.classList.remove("is-dragging"); dragging = null; for (const row of root.querySelectorAll(".ms-routine-drop-before,.ms-routine-drop-after")) row.classList.remove("ms-routine-drop-before", "ms-routine-drop-after"); };
  root.addEventListener("dragstart", (event) => {
    if (!event.target.closest("[data-routine-drag]")) return;
    dragging = event.target.closest("[data-routine-step]"); dragging.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", dragging.dataset.stepId);
  }, options);
  root.addEventListener("dragover", (event) => {
    const target = event.target.closest("[data-routine-step]");
    if (!dragging || target?.parentElement !== dragging.parentElement) return;
    event.preventDefault(); event.dataTransfer.dropEffect = "move";
    for (const row of dragging.parentElement.children) row.classList.remove("ms-routine-drop-before", "ms-routine-drop-after");
    target.classList.add(event.clientY < target.getBoundingClientRect().top + target.offsetHeight / 2 ? "ms-routine-drop-before" : "ms-routine-drop-after");
  }, options);
  root.addEventListener("drop", (event) => {
    const target = event.target.closest("[data-routine-step]");
    if (!dragging || target?.parentElement !== dragging.parentElement) return;
    event.preventDefault(); event.stopPropagation();
    const from = Number(dragging.dataset.routineStep), targetIndex = Number(target.dataset.routineStep);
    const after = event.clientY >= target.getBoundingClientRect().top + target.offsetHeight / 2;
    move(dragging, Math.max(0, Math.min(dragging.parentElement.children.length - 1, targetIndex + (after ? 1 : 0) - (from < targetIndex + (after ? 1 : 0) ? 1 : 0)))); clear();
  }, options);
  root.addEventListener("dragend", clear, options);
  root.addEventListener("keydown", (event) => {
    const handle = event.target.closest("[data-routine-drag]");
    if (!handle || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const row = handle.closest("[data-routine-step]"); move(row, Number(row.dataset.routineStep) + (event.key === "ArrowUp" ? -1 : 1)); handle.focus();
  }, options);
}
