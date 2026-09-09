import { generics } from "../generics.js";
import { routineStepTemplate } from "../routine-model.js";

const t = (ru, en) => game.i18n?.lang?.startsWith("ru") ? ru : en;
const e = (value) => generics.utilities.escapeHTML(String(value ?? ""));
const kinds = () => [["wait", t("Ожидание", "Wait")], ["move", t("Перемещение", "Move")],
  ["speech", t("Реплика", "Speech")], ["emotion", t("Эмоция", "Emotion")],
  ["event", t("Событие", "Event")], ["macro", t("Макрос", "Macro")]];

/** Domain form only: stable step IDs remain intact until the store renumbers a saved table. */
export function buildRoutineFields(routines, definition, type, catalog) {
  if (type !== "Token") return `<p>${t("Рутина доступна для токенов.", "Routines are available for tokens.")}</p>`;
  const blocks = routines.map((routine, index) => {
    const prefix = `routine-${index}`;
    const episodes = definition.episodes.filter((episode) => episode.id === routine.episodeId || !routines.some((item) => item.episodeId === episode.id));
    if (routine.legacy) return `<section class="ms-object-feature" data-routine-index="${index}"><h3>${e(definition.episodes.find((episode) => episode.id === routine.episodeId)?.name)}</h3>
      <p class="ms-note">${t("Сохранён прежний патруль. Его можно редактировать в «Поведении токена (техдолг)» или заменить таблицей шагов.", "The previous patrol is preserved. Edit it in Token behavior (legacy), or replace it with a step table.")}</p>
      <button type="button" data-screen-action="convert-routine" data-index="${index}">${t("Преобразовать в шаги", "Convert to steps")}</button>
      <button type="button" data-screen-action="clear-routine" data-index="${index}">${t("Отключить рутину эпизода", "Disable this episode's routine")}</button></section>`;
    return `<section class="ms-object-feature" data-routine-index="${index}"><div class="ms-object-row">
      <label>${t("Эпизод", "Episode")}<select name="${prefix}-episode">${episodes.map((episode) => `<option value="${e(episode.id)}"${episode.id === routine.episodeId ? " selected" : ""}>${e(episode.name)}</option>`).join("")}</select></label>
      <button type="button" data-screen-action="remove-routine" data-index="${index}">${t("Удалить блок", "Remove block")}</button></div>
      <div class="ms-routine-table-scroll"><table class="ms-routine-table"><thead><tr><th>№</th><th>${t("Функция", "Function")}</th><th>${t("Параметры (JSON)", "Parameters (JSON)")}</th><th>${t("Переход", "Next")}</th><th></th></tr></thead><tbody>
      ${routine.steps.map((step, stepIndex) => `<tr data-routine-step="${stepIndex}"><td>${step.id}</td><td><select aria-label="${t("Функция", "Function")}" name="${prefix}-step-${stepIndex}-kind" data-routine-kind data-index="${index}" data-step="${stepIndex}">${kinds().map(([kind, name]) => `<option value="${kind}"${step.kind === kind ? " selected" : ""}>${e(name)}</option>`).join("")}</select>
        ${step.kind === "move" ? `<button type="button" data-screen-action="routine-point" data-index="${index}" data-step="${stepIndex}">${t("Точка с карты", "Map point")}</button>` : ""}
        ${step.kind === "event" || step.kind === "macro" ? `<select aria-label="${t("Выбрать определение", "Choose definition")}" data-routine-definition data-index="${index}" data-step="${stepIndex}"><option value="">${t("Выбрать…", "Choose…")}</option>${(step.kind === "event" ? catalog.triggers : catalog.macros).map((item) => {
          const id = item.id ?? item.uuid, label = item.uuid ? game.macros?.get?.(item.uuid.split(".").at(-1))?.name ?? item.uuid : item.name;
          return `<option value="${e(id)}"${id === (step.parameters.triggerId ?? step.parameters.macroUuid) ? " selected" : ""}>${e(label)}</option>`;
        }).join("")}</select>` : ""}</td>
        <td><textarea name="${prefix}-step-${stepIndex}-parameters" aria-label="${t("Параметры шага", "Step parameters")}" spellcheck="false">${e(JSON.stringify(step.parameters, null, 2))}</textarea></td>
        <td><input name="${prefix}-step-${stepIndex}-next" aria-label="${t("Следующие шаги", "Next steps")}" value="${e(step.next.join(", "))}" placeholder="—"></td>
        <td><button type="button" data-screen-action="remove-routine-step" data-index="${index}" data-step="${stepIndex}" aria-label="${t("Удалить шаг", "Remove step")}">×</button></td></tr>`).join("")}
      </tbody></table></div>
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
    if (routine.legacy) return routine;
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
  const [removed] = routine.steps.splice(index, 1);
  if (removed) for (const step of routine.steps) step.next = step.next.filter((id) => id !== removed.id);
}
