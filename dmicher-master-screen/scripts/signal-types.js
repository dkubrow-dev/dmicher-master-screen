import { normalizeDescription } from "./model.js";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export const SIGNAL_TYPES = ["string", "integer", "number", "boolean"];
export const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function signalName(value, label = "Имя") {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error(`${label}: требуется непустое имя длиной до 256 символов.`);
  return value;
}
export function normalizeSignalFields(source = []) {
  if (!Array.isArray(source) || source.length > 100) throw new Error("Поля сигнала должны быть списком не более 100 элементов.");
  const names = new Set();
  return source.map((raw) => {
    if (!isRecord(raw)) throw new Error("Ожидалось описание поля.");
    const name = signalName(raw.name, "Поле");
    if (names.has(name)) throw new Error(`Поле «${name}» повторяется.`);
    names.add(name);
    if (!SIGNAL_TYPES.includes(raw.type)) throw new Error(`Поле «${name}»: неизвестный тип.`);
    const field = { name, type: raw.type, nullable: raw.nullable === true, description: normalizeDescription(raw.description), builtin: raw.builtin === true };
    const bounds = field.type === "string" ? ["minLength", "maxLength"] : ["number", "integer"].includes(field.type) ? ["min", "max", ...(field.type === "number" ? ["decimals"] : [])] : [];
    for (const key of bounds) {
      if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
      const value = raw[key];
      if (typeof value !== "number" || !Number.isFinite(value) || ((["minLength", "maxLength", "decimals"].includes(key) || field.type === "integer") && !Number.isInteger(value))
        || (["minLength", "maxLength", "decimals"].includes(key) && value < 0) || (key === "decimals" && value > 12)) throw new Error(`Поле «${name}»: неверное ограничение.`);
      field[key] = value;
    }
    if ((field.min !== undefined && field.max !== undefined && field.min > field.max)
      || (field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength)) throw new Error(`Поле «${name}»: минимум больше максимума.`);
    if (own(raw, "default")) { assertSignalValue(field, raw.default); field.default = structuredClone(raw.default); }
    return field;
  });
}
export function assertSignalValue(field, value) {
  if (value === null && field.nullable) return;
  const valid = field.type === "string" ? typeof value === "string" : field.type === "boolean" ? typeof value === "boolean"
    : typeof value === "number" && Number.isFinite(value) && (field.type !== "integer" || Number.isInteger(value));
  if (!valid) throw new Error(`Поле «${field.name}»: неверный тип${field.nullable ? " или null" : ""}.`);
  if (field.type === "string" && ((field.minLength !== undefined && [...value].length < field.minLength) || (field.maxLength !== undefined && [...value].length > field.maxLength))) throw new Error(`Поле «${field.name}»: недопустимая длина.`);
  if (["number", "integer"].includes(field.type) && ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) throw new Error(`Поле «${field.name}»: значение вне диапазона.`);
  if (field.type === "number" && field.decimals !== undefined && Math.abs(value - Number(value.toFixed(field.decimals))) > Number.EPSILON * Math.max(1, Math.abs(value))) throw new Error(`Поле «${field.name}»: превышена точность.`);
}
/** Names are data, including punctuation and prototype-looking names; never code paths. */
export function validateSignalValues(fields, values, { allowExtra = false, defaults = true } = {}) {
  if (!isRecord(values)) throw new Error("Данные сигнала должны быть объектом.");
  const names = new Set(fields.map((field) => field.name));
  if (!allowExtra && Object.keys(values).some((name) => !names.has(name))) throw new Error("Сигнал содержит незаявленные поля.");
  const entries = fields.map((field) => {
    const value = own(values, field.name) ? values[field.name] : defaults && own(field, "default") ? field.default : undefined;
    assertSignalValue(field, value);
    return [field.name, value];
  });
  if (JSON.stringify(entries).length > 64000) throw new Error("Данные сигнала превышают 64000 символов.");
  return structuredClone(Object.fromEntries(entries));
}
export function validateParameters(signal, values) { return validateSignalValues(signal.parameters, values); }
export function fieldInitialValue(field) {
  if (own(field, "default")) return structuredClone(field.default);
  if (field.nullable) return null;
  if (field.type === "string") return " ".repeat(field.minLength ?? 0);
  if (field.type === "boolean") return false;
  return Math.max(field.min ?? 0, Math.min(0, field.max ?? 0));
}
export function assertSignalInterface(signal, contract) {
  const parameters = normalizeSignalFields(contract.parameters), returns = normalizeSignalFields(contract.returns);
  for (const field of parameters) {
    const source = signal.parameters.find((entry) => entry.name === field.name);
    if (!source) throw new Error(`Макрос ожидает незаявленный параметр «${field.name}».`);
    if (source.type !== field.type || (source.nullable && !field.nullable)) throw new Error(`Несовместимый тип параметра «${field.name}».`);
    for (const key of ["min", "minLength"]) if (field[key] !== undefined && (source[key] === undefined || field[key] > source[key])) throw new Error(`Макрос сужает допустимые значения «${field.name}».`);
    for (const key of ["max", "maxLength", "decimals"]) if (field[key] !== undefined && (source[key] === undefined || field[key] < source[key])) throw new Error(`Макрос сужает допустимые значения «${field.name}».`);
  }
  for (const expected of signal.returns) {
    const field = returns.find((entry) => entry.name === expected.name);
    if (!field) throw new Error(`Макрос не объявляет возврат «${expected.name}».`);
    if (expected.type !== field.type || (!expected.nullable && field.nullable)) throw new Error(`Несовместимый тип возврата «${expected.name}».`);
  }
  return { parameters, returns };
}
