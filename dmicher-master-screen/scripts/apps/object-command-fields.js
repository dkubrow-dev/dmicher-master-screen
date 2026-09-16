import { text as t } from "../localization.js";
import { commandDefinitionsFor, defaultObjectCommand, objectCommandName } from "../object-command-model.js";
import { escapeHTML as e, actionButton as button, parameterRow, selectOptions, formValue } from "./form-fields.js";
import { splitTags } from "./condition-fields.js";
import { buildScriptInterruptionFields, readScriptInterruptionFields } from "./script-fields.js";

const check = (name, label, checked, attrs = "") => `<label class="ms-check"><input type="checkbox" name="${name}"${checked ? " checked" : ""} ${attrs}>${e(label)}</label>`;
const categories = () => [["movement", t("Команды движения", "Movement commands")], ["interaction", t("Команды взаимодействия", "Interaction commands")]];
const parameterNames = () => ({ speed: t("Скорость, ед./с", "Speed, units/sec."), duration: t("Длительность, с", "Duration, seconds"),
  seconds: t("Время ожидания, с", "Wait, seconds"), waitSeconds: t("Ожидание после команды, с", "Wait after command, seconds"),
  minDistance: t("Минимальное расстояние", "Minimum distance"), maxDistance: t("Максимальное расстояние", "Maximum distance"),
  bright: t("Яркий свет, ед.", "Bright light, units"), dim: t("Тусклый свет, ед.", "Dim light, units"),
  mode: t("Режим следования", "Following mode"), issuer: t("Кто может выдать команду", "Who may issue the command") });

/** The catalogue is fixed; opening this view does not create disabled bindings. */
export function renderObjectCommandList(commands = [], selectedId, type = "Token") {
  return categories().filter(([category]) => commandDefinitionsFor(type).some(entry => entry.category === category)).map(([category, name]) => `<section class="ms-object-feature"><h3>${e(name)}</h3><table class="ms-object-commands"><tbody>${commandDefinitionsFor(type).filter(entry => entry.category === category).map(entry => {
    const configured = commands.find(command => command.id === entry.id);
    return `<tr${selectedId === entry.id ? ' class="is-selected"' : ""}><td>${check(`command-enabled-${entry.id}`, objectCommandName(entry.id, type), configured?.enabled === true, `data-command-enabled="${entry.id}"`)}</td><td>${button("edit-command", t("Настроить", "Configure"), `data-command-id="${entry.id}" aria-pressed="${selectedId === entry.id}"`)}</td></tr>`;
  }).join("")}</tbody></table></section>`).join("");
}

function parameterFields(command) {
  const names = parameterNames();
  const rows = Object.entries(defaultObjectCommand(command.id).parameters).map(([key, fallback]) => {
    const current = command.parameters?.[key] ?? fallback, name = `command-param-${key}`, label = names[key] ?? key;
    let field;
    if (key === "issuer") {
      const choices = [{ id: "gm", name: t("Мастер", "GM") }, ...(command.id === "cancel" ? [{ id: "commander", name: t("Командующий игрок", "Commanding player") }] : []), { id: "players", name: t("Все игроки", "All players") }];
      field = `<select name="${name}" aria-label="${e(label)}">${selectOptions(choices, current)}</select>`;
    } else if (key === "mode") {
      field = `<select name="${name}" aria-label="${e(label)}">${selectOptions([{ id: "path", name: t("По траектории", "Along trajectory") }, { id: "direct", name: t("По прямой", "Straight line") }], current)}</select>`;
    } else field = `<input name="${name}" aria-label="${e(label)}" type="number" min="0" step="any" value="${e(current)}" required>`;
    return parameterRow(label, field);
  });
  return rows.length ? `<table class="ms-parameter-table"><tbody>${rows.join("")}</tbody></table>` : "";
}

export function renderObjectCommandFields(command, definitions = [], type) {
  const conditions = command.conditions, choices = new Map(conditions.groups.map(entry => [entry.groupId, entry]));
  const groups = definitions.map(group => {
    const selected = choices.get(group.groupId), groupId = e(group.groupId);
    return `<details class="ms-details"${selected ? " open" : ""}><summary>${e(group.groupName)}</summary>${check("command-group", t("Принимать в этой группе", "Accept in this group"), Boolean(selected), `value="${groupId}"`)}<div class="ms-command-state-options">${group.states.map(state => check("command-state", state.name, selected?.stateIds.includes(state.id), `data-group-id="${groupId}" value="${e(state.id)}"${selected ? "" : " disabled"}`)).join("")}</div></details>`;
  }).join("");
  return `<section class="ms-object-feature" data-command-fields="${e(command.id)}"><h3>${e(objectCommandName(command.id, type))}</h3>
    <fieldset><legend>${t("Кто и когда может командовать", "Who may command and when")}</legend>
      <div class="ms-form-row">${check("command-permission-gm", t("Мастер", "GM"), command.permissions?.gm !== false)}${check("command-permission-player", t("Персонаж игрока", "Player character"), command.permissions?.player !== false)}${check("command-permission-delegated", t("По поручению игрока", "Delegated by a player"), command.permissions?.delegated !== false)}</div>
      <label>${t("Разрешающие теги, через запятую", "Allowed tags, comma-separated")}<input name="command-allow" value="${e(conditions.allowTags.join(", "))}"></label>
      <label>${t("Запрещающие теги, через запятую", "Denied tags, comma-separated")}<input name="command-deny" value="${e(conditions.denyTags.join(", "))}"></label>
      <label>${t("Расстояние, ед.", "Range, scene units")}<input type="number" name="command-range" min="0" step="any" value="${e(conditions.range)}" required></label>
      <details class="ms-details"><summary>${t("Группы и состояния", "Groups and states")}</summary>${groups || `<p>${t("В сцене пока нет групп.", "This scene has no groups yet.")}</p>`}</details>
    </fieldset>${parameterFields(command)}
    ${buildScriptInterruptionFields(command.interruptions, "command", { legend: t("При прерывании команды", "When the command is interrupted"), excludedSources: ["command"], modeNames: {
      "restart-step": t("Начать текущую фазу заново", "Restart the current phase"), "next-step": t("Перейти к следующей фазе", "Go to the next phase"), "restart-script": t("Начать команду заново", "Restart the command")
    } })}
  </section>`;
}

/** Group selection controls state eligibility without rebuilding the draft. */
export function bindObjectCommandFields(root, options) {
  root.addEventListener("change", event => {
    const target = event.target;
    if (!target.matches?.('[name="command-group"]')) return;
    for (const field of target.closest("details").querySelectorAll('[name="command-state"]')) field.disabled = !target.checked;
  }, options);
}

/** Capture only configured commands and actual checkbox changes. Unknown saved
 * references stay in the draft until the GM deliberately edits that scope. */
export function readObjectCommandFields(root, commands = [], selectedId, definitions = []) {
  const next = commands.map(command => structuredClone(command));
  for (const field of root.querySelectorAll("[data-command-enabled]")) {
    let command = next.find(entry => entry.id === field.dataset.commandEnabled);
    if (!command && field.checked) { command = defaultObjectCommand(field.dataset.commandEnabled); next.push(command); }
    if (command) command.enabled = field.checked;
  }
  const command = next.find(entry => entry.id === selectedId);
  if (!command || !root.querySelector("[data-command-fields]")) return next;
  const fields = root.querySelectorAll('[data-command-fields] input[type="number"]');
  for (const field of fields) if (!field.disabled && field.checkValidity?.() === false) throw new Error(`${field.getAttribute("aria-label") ?? field.name}: ${field.validationMessage}`);
  const value = name => formValue(root, name);
  command.permissions = Object.fromEntries(["gm", "player", "delegated"].map(role => [role, root.querySelector(`[name="command-permission-${role}"]`)?.checked ?? command.permissions?.[role] ?? true]));
  const knownIds = new Set(definitions.map(group => group.groupId));
  const groups = command.conditions.groups.filter(group => !knownIds.has(group.groupId));
  for (const selected of root.querySelectorAll('[name="command-group"]:checked')) {
    const definition = definitions.find(group => group.groupId === selected.value);
    if (!definition) continue;
    const knownStates = new Set(definition.states.map(state => state.id));
    const previous = command.conditions.groups.find(group => group.groupId === selected.value);
    groups.push({ groupId: selected.value, stateIds: [...new Set([...(previous?.stateIds ?? []).filter(id => !knownStates.has(id)),
      ...[...root.querySelectorAll('[name="command-state"]:checked')].filter(field => field.dataset.groupId === selected.value).map(field => field.value)])] });
  }
  command.conditions = { ...command.conditions, allowTags: splitTags(value("command-allow")), denyTags: splitTags(value("command-deny")), range: Number(value("command-range")), groups };
  for (const key of Object.keys(defaultObjectCommand(command.id).parameters)) command.parameters[key] = ["issuer", "mode"].includes(key) ? value(`command-param-${key}`) : Number(value(`command-param-${key}`));
  command.interruptions = readScriptInterruptionFields(root, "command", command.interruptions);
  return next;
}
