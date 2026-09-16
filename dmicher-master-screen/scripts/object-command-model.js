import { text } from "./localization.js";
import { MODULE_ID, normalizeTags } from "./model.js";
import { normalizeScript } from "./script-model.js";
import { normalizeScriptInterruptions } from "./script-interruption-model.js";

export const COMMAND_LIGHT_FLAG = "commandLight";
/** Command-created light is a runtime effect, not scene preparation. Full scene
 * exports omit only this exact owner marker; unrelated ambient lights remain. */
export function isCommandLightSource(source) {
  const marker = source?.flags?.[MODULE_ID]?.[COMMAND_LIGHT_FLAG];
  return marker?.version === 1 && typeof marker.targetUuid === "string" && marker.targetUuid.startsWith("Scene.");
}

/** Preparation only. No document reads, player input, or active command state. */
export const OBJECT_COMMAND_DEFINITIONS = Object.freeze([
  { id: "come", category: "movement", defaults: { speed: 5, duration: 10 } },
  { id: "away", category: "movement", defaults: { speed: 5, duration: 10 } },
  { id: "go", category: "movement", defaults: { speed: 5, duration: 10, waitSeconds: 1 } },
  { id: "follow", category: "movement", defaults: { speed: 5, minDistance: 0, maxDistance: 5, mode: "path" } },
  { id: "patrol", category: "movement", defaults: { speed: 5 } },
  { id: "wait", category: "movement", defaults: { seconds: 10 } },
  { id: "open-door", category: "interaction", defaults: { speed: 5 } },
  { id: "close-door", category: "interaction", defaults: { speed: 5 } },
  { id: "light-on", category: "interaction", defaults: { bright: 10, dim: 20 } },
  { id: "light-off", category: "interaction", defaults: {} },
  { id: "stop", category: "interaction", defaults: { issuer: "gm" } },
  { id: "cancel", category: "interaction", defaults: { issuer: "commander", waitSeconds: 1 } },
  { id: "delegate", category: "interaction", defaults: { speed: 5 } },
  { id: "visible", category: "interaction", defaults: {} },
  { id: "invisible", category: "interaction", defaults: {} },
  { id: "signals-on", category: "interaction", defaults: {} },
  { id: "signals-off", category: "interaction", defaults: {} },
  { id: "behavior-on", category: "interaction", defaults: {} },
  { id: "behavior-off", category: "interaction", defaults: {} },
  { id: "delete", category: "interaction", defaults: {} },
  { id: "open", category: "interaction", defaults: {} },
  { id: "close", category: "interaction", defaults: {} },
  { id: "source-on", category: "interaction", defaults: {} },
  { id: "source-off", category: "interaction", defaults: {} },
  { id: "note-open", category: "interaction", defaults: {} }
].map(entry => Object.freeze({ ...entry, defaults: Object.freeze(entry.defaults) })));
export const OBJECT_COMMAND_IDS = Object.freeze(OBJECT_COMMAND_DEFINITIONS.map(entry => entry.id));

const controls = ["signals-on", "signals-off", "behavior-on", "behavior-off"];
const motion = ["come", "away", "go", "follow", "patrol", "wait", "cancel", "light-on", "light-off"];
export const OBJECT_COMMAND_TYPES = Object.freeze({
  Token: Object.freeze(["delegate", ...motion, ...controls]),
  Tile: Object.freeze(["visible", "invisible", ...controls, "delete"]),
  Drawing: Object.freeze([...motion, "visible", "invisible", ...controls, "delete"]),
  Wall: Object.freeze(["open", "close", ...controls, "delete"]),
  AmbientLight: Object.freeze(["source-on", "source-off", ...controls, "delete"]),
  AmbientSound: Object.freeze(["source-on", "source-off", ...controls, "delete"]),
  Region: Object.freeze([...controls, "delete"]),
  Note: Object.freeze(["visible", "invisible", "note-open", ...controls, "delete"]),
  MeasuredTemplate: Object.freeze(["visible", "invisible", ...controls, "delete"])
});
export const commandDefinitionsFor = type => (OBJECT_COMMAND_TYPES[type] ?? []).map(id => OBJECT_COMMAND_DEFINITIONS.find(entry => entry.id === id));
// Token door travel remains the executor of a delegated door operation, with the
// same footprint collision rules. The old menu shortcuts are no longer exposed.
export const objectSupportsCommand = (type, id) => OBJECT_COMMAND_TYPES[type]?.includes(id) === true
  || type === "Token" && ["open-door", "close-door", "stop"].includes(id);
export const commandStopsBehavior = id => ["stop", "behavior-off"].includes(id);
export const commandPermitsDisabledBehavior = id => ["stop", "cancel", "behavior-on", "behavior-off", "signals-on", "signals-off"].includes(id);

export function objectCommandName(id, type) {
  if (type === "AmbientLight" && ["source-on", "source-off"].includes(id)) return id === "source-on" ? text("Зажгись", "Light up") : text("Погасни", "Extinguish");
  if (type === "Note" && ["visible", "invisible"].includes(id)) return id === "visible" ? text("Видимая", "Visible") : text("Невидимая", "Hidden");
  const names = {
    come: text("Подойди", "Come here"), away: text("Отойди", "Move away"), go: text("Встань там", "Stand there"),
    follow: text("Следуй за мной", "Follow me"), patrol: text("Патрулируй", "Patrol"), wait: text("Жди здесь", "Wait here"),
    "open-door": text("Открой дверь", "Open the door"), "close-door": text("Закрой дверь", "Close the door"),
    "light-on": text("Зажги свет", "Light on"), "light-off": text("Потуши свет", "Light off"),
    stop: text("Стой", "Stop"), cancel: text("Отмена", "Cancel"), delegate: text("Поручение", "Delegate"),
    visible: text("Видимый", "Visible"), invisible: text("Невидимый", "Hidden"),
    "signals-on": text("Включить сигналы", "Enable signals"), "signals-off": text("Выключить сигналы", "Disable signals"),
    "behavior-on": text("Включить поведение", "Enable behavior"), "behavior-off": text("Выключить поведение", "Disable behavior"),
    delete: text("Удалить", "Delete"), open: text("Открыть", "Open"), close: text("Закрыть", "Close"),
    "source-on": text("Включить", "Turn on"), "source-off": text("Выключить", "Turn off"), "note-open": text("Открыть заметку", "Open note")
  };
  return Object.hasOwn(names, id) ? names[id] : text("Неизвестная команда", "Unknown command");
}

const fail = message => { throw new Error(message); };
const record = value => value && typeof value === "object" && !Array.isArray(value);
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
function definition(id) {
  const entry = OBJECT_COMMAND_DEFINITIONS.find(item => item.id === id);
  if (!entry) fail(text("Выберите встроенную команду объекта.", "Select a built-in object command."));
  return entry;
}
function numeric(value, { positive = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    fail(text(positive ? "Параметр команды должен быть числом больше нуля." : "Параметр команды должен быть неотрицательным числом.",
      positive ? "The command parameter must be a number greater than zero." : "The command parameter must be a non-negative number."));
  }
  return value;
}
function normalizeParameters(id, raw = {}) {
  const defaults = definition(id).defaults;
  if (!record(raw) || Object.keys(raw).some(key => !Object.hasOwn(defaults, key))) {
    fail(text("В параметрах команды есть неизвестное поле.", "The command parameters contain an unknown field."));
  }
  const parameters = { ...defaults, ...raw };
  for (const key of ["speed", "duration", "seconds", "waitSeconds"]) {
    if (Object.hasOwn(parameters, key)) parameters[key] = numeric(parameters[key], { positive: true });
  }
  for (const key of ["minDistance", "maxDistance", "bright", "dim"]) {
    if (Object.hasOwn(parameters, key)) parameters[key] = numeric(parameters[key]);
  }
  if (id === "follow") {
    if (!["path", "direct"].includes(parameters.mode)) fail(text("Выберите способ следования.", "Select a following mode."));
    if (parameters.maxDistance < parameters.minDistance) fail(text("Максимальное расстояние не может быть меньше минимального.", "Maximum distance cannot be less than minimum distance."));
  }
  if (id === "stop" && !["gm", "players"].includes(parameters.issuer)
    || id === "cancel" && !["gm", "commander", "players"].includes(parameters.issuer)) {
    fail(text("Выберите, кто может выдать команду.", "Select who may issue this command."));
  }
  return parameters;
}
function normalizeGroups(raw = []) {
  if (!Array.isArray(raw) || raw.length > 100) fail(text("Выберите до 100 групп для команды.", "Select up to 100 groups for the command."));
  const seen = new Set();
  return raw.map(entry => {
    if (!record(entry) || !validId(entry.groupId) || seen.has(entry.groupId)) fail(text("Группа команды отсутствует или повторяется.", "A command group is missing or repeated."));
    seen.add(entry.groupId);
    const states = entry.stateIds ?? [];
    if (!Array.isArray(states) || states.length > 100 || states.some(id => !validId(id))) fail(text("Выберите состояния группы для команды.", "Select group states for the command."));
    return { groupId: entry.groupId, stateIds: [...new Set(states)] };
  });
}

export function normalizeObjectCommandScript(raw) {
  if (raw == null) return null;
  if (!record(raw)) fail(text("Ожидается блок скрипта команды.", "Expected a command script block."));
  if (raw.interruptions !== undefined && !record(raw.interruptions)) fail(text("Ожидаются настройки прерывания скрипта команды.", "Expected command script interruption settings."));
  const script = normalizeScript({ ...raw, interruptions: { ...raw.interruptions, command: raw.interruptions?.command ?? "ignore" } });
  // The command phase owns the block; a foreign routine state cannot assign it.
  const { stateId: _stateId, ...block } = script;
  return block;
}

export function normalizeObjectCommand(raw) {
  if (!record(raw)) fail(text("Ожидаются настройки команды объекта.", "Expected object command settings."));
  definition(raw.id);
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") fail(text("Включение команды должно быть логическим значением.", "Command enabled must be a boolean."));
  const conditions = raw.conditions ?? {};
  if (!record(conditions)) fail(text("Ожидаются условия команды.", "Expected command conditions."));
  const permissions = raw.permissions ?? {};
  if (!record(permissions) || Object.keys(permissions).some(key => !["gm", "player", "delegated"].includes(key) || typeof permissions[key] !== "boolean"))
    fail(text("Права команды должны содержать три логических разрешения: мастер, игрок и поручение.", "Command permissions require boolean GM, player and delegated settings."));
  return { id: raw.id, enabled: raw.enabled ?? false,
    permissions: { gm: permissions.gm ?? true, player: permissions.player ?? true, delegated: permissions.delegated ?? true },
    conditions: { allowTags: normalizeTags(conditions.allowTags), denyTags: normalizeTags(conditions.denyTags),
      groups: normalizeGroups(conditions.groups), range: numeric(conditions.range ?? 5) },
    parameters: normalizeParameters(raw.id, raw.parameters), interruptions: normalizeScriptInterruptions(raw.interruptions),
    beforeScript: normalizeObjectCommandScript(raw.beforeScript), afterScript: normalizeObjectCommandScript(raw.afterScript) };
}
export const defaultObjectCommand = id => normalizeObjectCommand({ id });
export function normalizeObjectCommands(raw = []) {
  if (!Array.isArray(raw) || raw.length > OBJECT_COMMAND_IDS.length) fail(text("Ожидается список встроенных команд объекта.", "Expected a list of built-in object commands."));
  const commands = raw.map(normalizeObjectCommand);
  if (new Set(commands.map(command => command.id)).size !== commands.length) fail(text("Команда объекта не должна повторяться.", "An object command cannot be repeated."));
  return commands;
}

/** Empty filters are unrestricted; each selected group is an alternative. */
export function objectCommandConditionsMatch(command, { tags = [], groupStates = [], distance = Infinity } = {}) {
  const { allowTags, denyTags, groups, range } = command.conditions;
  return command.enabled && (!allowTags.length || allowTags.some(tag => tags.includes(tag)))
    && !denyTags.some(tag => tags.includes(tag)) && Number.isFinite(distance) && distance >= 0 && distance <= range
    && (!groups.length || groups.some(group => groupStates.some(current => current.groupId === group.groupId
      && (!group.stateIds.length || group.stateIds.includes(current.stateId)))));
}
