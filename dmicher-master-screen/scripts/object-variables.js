import { MODULE_ID } from "./model.js";
import { requireGM, isAuthority, withSceneLock } from "./store.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { replacementFlagData } from "./scene-flags.js";
import { text } from "./localization.js";

export const OBJECT_VARIABLE_TYPES = Object.freeze(["text", "integer", "number"]);
const fail = message => { throw new Error(message); };
const owns = (object, name) => Object.hasOwn(object ?? {}, name);

export function validateObjectVariableValue(type, value) {
  const valid = type === "text" ? typeof value === "string" && value.length <= 64000
    : type === "integer" ? Number.isSafeInteger(value) : type === "number" && Number.isFinite(value);
  if (!valid) fail(text("Значение не соответствует типу переменной объекта.", "The value does not match the object variable type."));
  return value;
}

/** Defaults describe preparation. Reading them never initializes saved runtime data. */
export function normalizeObjectVariables(source = []) {
  if (!Array.isArray(source) || source.length > 100) fail(text("Допустимо не более 100 переменных объекта.", "An object may have at most 100 variables."));
  const names = new Set();
  return source.map(entry => {
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!name || name.length > 128 || names.has(name)) fail(text("Имена переменных должны быть непустыми и уникальными в объекте.", "Variable names must be nonempty and unique within the object."));
    names.add(name);
    const type = entry.type ?? "text";
    if (!OBJECT_VARIABLE_TYPES.includes(type)) fail(text("Неизвестный тип переменной объекта.", "Unknown object variable type."));
    return { name, type, value: validateObjectVariableValue(type, owns(entry, "value") ? entry.value : type === "text" ? "" : 0),
      access: { internal: entry.access?.internal !== false, externalRead: entry.access?.externalRead === true, externalWrite: entry.access?.externalWrite === true } };
  });
}

function resolveObject(scene, uuid) {
  for (const [type, collection] of Object.entries(SCENE_OBJECT_COLLECTIONS)) {
    const prefix = `${scene.uuid ?? `Scene.${scene.id}`}.${type}.`;
    if (typeof uuid !== "string" || !uuid.startsWith(prefix)) continue;
    const id = uuid.slice(prefix.length), document = scene[collection]?.get?.(id);
    if (document) return { document, type, id, key: `${type}:${id}`, uuid: document.uuid ?? `${prefix}${id}` };
  }
  fail(text("Переменная относится к отсутствующему объекту этой сцены.", "The variable refers to a missing object in this scene."));
}

/** This capability is created by the GM executor, never from a socket origin claim.
 * The caller cannot replace its captured owner or the execution validity check. */
export class ObjectVariableService {
  requireAuthority(current) {
    requireGM();
    if (!isAuthority() || typeof current !== "function" || !current()) fail(text("Исполнение переменных объекта больше не активно.", "The object variable execution is no longer active."));
  }
  scope(scene, { object, current } = {}) {
    this.requireAuthority(current);
    const sourceUuid = typeof object === "string" ? object : object?.uuid ?? `${scene.uuid ?? `Scene.${scene.id}`}.${object?.type}.${object?.id}`;
    const owner = resolveObject(scene, sourceUuid);
    const check = (objectUuid, name, write = false) => {
      this.requireAuthority(current); resolveObject(scene, owner.uuid);
      const target = resolveObject(scene, objectUuid), binding = scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings?.[target.key];
      const variable = normalizeObjectVariables(binding?.variables).find(entry => entry.name === name);
      if (!variable) fail(text("Переменная объекта не найдена.", "The object variable was not found."));
      const internal = target.key === owner.key;
      if (internal ? write && !variable.access.internal : !variable.access[write ? "externalWrite" : "externalRead"])
        fail(text("Доступ к переменной объекта запрещён её настройками.", "Access to the object variable is denied by its settings."));
      return { target, variable };
    };
    const GetValue = async (objectUuid, name) => {
      const { target, variable } = check(objectUuid, name);
      const values = scene.getFlag?.(MODULE_ID, "objectVariableValues")?.values?.[target.key];
      // A changed type never silently converts a formerly stored value.
      return validateObjectVariableValue(variable.type, owns(values, name) ? values[name] : variable.value);
    };
    const SetValue = (objectUuid, name, value) => withSceneLock(scene, async () => {
      const { target, variable } = check(objectUuid, name, true);
      validateObjectVariableValue(variable.type, value);
      const previous = scene.getFlag?.(MODULE_ID, "objectVariableValues") ?? { schemaVersion: 1, values: {} };
      if (owns(previous.values?.[target.key], name) && previous.values[target.key][name] === value) return value;
      const next = { schemaVersion: 1, values: { ...previous.values,
        [target.key]: { ...previous.values?.[target.key], [name]: value } } };
      await scene.setFlag(MODULE_ID, "objectVariableValues", replacementFlagData(previous, next));
      this.requireAuthority(current);
      return value;
    });
    return Object.freeze({ objectUuid: owner.uuid, GetValue, SetValue,
      async getVariables() {
        const variables = normalizeObjectVariables(scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings?.[owner.key]?.variables);
        return Object.fromEntries(await Promise.all(variables.map(async variable => [variable.name, await GetValue(owner.uuid, variable.name)])));
      },
      request(name, parameters = {}) {
        if (name === "GetValue") return GetValue(parameters.objectUuid, parameters.name);
        if (name === "SetValue") return SetValue(parameters.objectUuid, parameters.name, parameters.value);
        fail(text("Неизвестный сигнал переменных объекта.", "Unknown object variable signal."));
      }
    });
  }
}

/** Safe bracket names support Unicode, punctuation and names such as __proto__. */
export function objectVariableMacroSnippet(variables = [], { context = "context", objectUuid } = {}) {
  const source = objectUuid === undefined ? `${context}.objectUuid` : JSON.stringify(objectUuid);
  return `const objectUuid = ${source};\nconst values = Object.fromEntries([\n${normalizeObjectVariables(variables).map(variable =>
    `  [${JSON.stringify(variable.name)}, await ${context}.GetValue(objectUuid, ${JSON.stringify(variable.name)})]`).join(",\n")}\n]);`;
}
