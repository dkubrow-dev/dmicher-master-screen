import { message as localizedMessage } from "./localization.js";
import { MODULE_ID } from "./model.js";
import { assertSignalInterface, normalizeSignalFields, validateSignalValues, fieldInitialValue, isRecord } from "./signal-types.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const annotation = /\/\*\s*dmicher-signal-interface\s+([\s\S]*?)\*\//;
const cleanField = ({ name, type, nullable, ...field }) => ({ name, type, nullable, ...Object.fromEntries(["min", "max", "minLength", "maxLength", "decimals", "default"].filter((key) => Object.hasOwn(field, key)).map((key) => [key, field[key]])) });
export function signalMacroSnippet(signal) {
  const contract = { parameters: signal.parameters.map(cleanField), returns: signal.returns.map(cleanField) };
  const members = (fields) => fields.map((field) => {
    const { name, ...descriptor } = cleanField(field);
    return `    [${JSON.stringify(name)}]: ${JSON.stringify({ ...descriptor, value: fieldInitialValue(field) })}`;
  }).join(",\n");
  const encodedContract = JSON.stringify(contract, null, 2).replaceAll("/", "\\u002f");
  return `/* dmicher-signal-interface\n${encodedContract}\n*/\nreturn {\n  parameters: {\n${members(signal.parameters)}\n  },\n  returns: {\n${members(signal.returns)}\n  },\n  async execute(context) {\n    // this.parameters[field].value -> this.returns[field].value\n  }\n};`;
}
function requireMacro(macro) {
  if (macro?.documentName !== "Macro" || macro.type !== "script" || macro.canExecute === false) throw new Error(localizedMessage("Нужен доступный скриптовый макрос Foundry."));
  // Compiling validates syntax only; it does not execute the player's factory or body.
  new AsyncFunction(String(macro.command ?? ""));
  return macro;
}
export function inspectSignalMacro(macro, signal) {
  const snippet = signalMacroSnippet(signal);
  try {
    requireMacro(macro);
    const match = String(macro.command ?? "").match(annotation);
    if (!match) throw new Error(localizedMessage("Добавьте объявление интерфейса и фабрику обработчика сигнала."));
    const contract = assertSignalInterface(signal, JSON.parse(match[1]));
    return { valid: true, contract, snippet };
  } catch (error) { return { valid: false, error: error.message ?? String(error), snippet }; }
}
export async function validateSignalMacro(uuid, signal, { resolveMacro = globalThis.fromUuid } = {}) {
  try { return inspectSignalMacro(await resolveMacro(uuid), signal); }
  catch (error) { return { valid: false, error: error.message ?? String(error), snippet: signalMacroSnippet(signal) }; }
}
export async function validateStandaloneMacro(uuid, { resolveMacro = globalThis.fromUuid } = {}) {
  try { requireMacro(await resolveMacro(uuid)); return { valid: true }; }
  catch (error) { return { valid: false, error: error.message ?? String(error) }; }
}
function instanceFields(source) {
  if (!isRecord(source)) throw new Error(localizedMessage("Фабрика должна вернуть объекты parameters и returns."));
  return normalizeSignalFields(Object.entries(source).map(([name, field]) => ({ ...field, name })));
}
/** The saved annotation is checked without running code. The live factory is checked
 * again before execute so stale or dishonest declarations never bypass the contract. */
export async function executeSignalMacro(macro, signal, parameters, context = {}) {
  requireMacro(macro);
  const inspection = inspectSignalMacro(macro, signal);
  if (!inspection.valid) throw new Error(inspection.error);
  const instance = await macro.execute({ signalContext: context });
  if (!isRecord(instance) || typeof instance.execute !== "function") throw new Error(localizedMessage("Макрос должен вернуть объект с методом execute."));
  const contract = assertSignalInterface(signal, { parameters: instanceFields(instance.parameters), returns: instanceFields(instance.returns) });
  const values = validateSignalValues(signal.parameters, parameters);
  for (const field of contract.parameters) instance.parameters[field.name].value = structuredClone(values[field.name]);
  await instance.execute(context);
  const output = Object.fromEntries(contract.returns.map((field) => [field.name, instance.returns[field.name]?.value]));
  // Extra declared return fields are allowed, but every declared value remains typed.
  validateSignalValues(contract.returns, output, { defaults: false });
  return validateSignalValues(signal.returns, output, { allowExtra: true, defaults: false });
}
export function reportMacroError(error, { name = "", signalName = "", notify = false } = {}) {
  const message = localizedMessage("Макрос «{0}»{1}: {2}", [name, signalName ? localizedMessage(", сигнал «{0}»", [signalName]) : "", error.message ?? String(error)]);
  console.error(MODULE_ID, message, error);
  if (notify) globalThis.ui?.notifications?.error(message);
  return message;
}
export async function executeStandaloneMacro(uuid, { resolveMacro = globalThis.fromUuid, current = () => true } = {}) {
  let macro;
  try {
    macro = requireMacro(await resolveMacro(uuid));
    if (!current()) return { status: "stale" };
    await macro.execute();
    return { status: current() ? "done" : "stale" };
  } catch (error) { return { status: "failed", error: reportMacroError(error, { name: macro?.name ?? uuid, notify: true }) }; }
}
