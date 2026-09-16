import { message as localizedMessage, text } from "./localization.js";
import { MODULE_ID } from "./model.js";
import { assertSignalInterface, normalizeSignalFields, validateSignalValues, fieldInitialValue, isRecord } from "./signal-types.js";
import { objectVariableMacroSnippet } from "./object-variables.js";
import { bindingScripts, objectKey } from "./object-binding-model.js";
import { objectActionContract } from "./object-action-contract.js";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const annotation = /\/\*\s*dmicher-signal-interface\s+([\s\S]*?)\*\//;
const cleanField = ({ name, type, nullable, ...field }) => ({ name, type, nullable, ...Object.fromEntries(["min", "max", "minLength", "maxLength", "decimals", "default"].filter((key) => Object.hasOwn(field, key)).map((key) => [key, field[key]])) });
export function signalMacroSnippet(signal, { variables = [], objectUuid } = {}) {
  const contract = { parameters: signal.parameters.map(cleanField), returns: signal.returns.map(cleanField) };
  const members = (fields) => fields.map((field) => {
    const { name, ...descriptor } = cleanField(field);
    return `    [${JSON.stringify(name)}]: ${JSON.stringify({ ...descriptor, value: fieldInitialValue(field) })}`;
  }).join(",\n");
  const encodedContract = JSON.stringify(contract, null, 2).replaceAll("/", "\\u002f");
  const variableSource = variables.length ? `\n${objectVariableMacroSnippet(variables, { objectUuid }).split("\n").map(line => `    ${line}`).join("\n")}\n` : "";
  return `/* dmicher-signal-interface\n${encodedContract}\n*/\nreturn {\n  parameters: {\n${members(signal.parameters)}\n  },\n  returns: {\n${members(signal.returns)}\n  },\n  async execute(context) {${variableSource}\n    // this.parameters[field].value -> this.returns[field].value\n  }\n};`;
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

/** Save-time validation of explicitly selected input contracts does not execute
 * a macro factory. Empty selection remains an ordinary attached script macro. */
export async function validateScriptMacroInterfaces(steps, catalog, { resolveMacro = globalThis.fromUuid } = {}) {
  const checked = new Set();
  for (const step of steps) {
    if (step.kind !== "macro" || !step.parameters?.signalId) continue;
    const { macroUuid, signalId } = step.parameters, key = `${macroUuid}\0${signalId}`;
    if (checked.has(key)) continue;
    checked.add(key);
    const signal = catalog.signals.find(entry => entry.id === signalId);
    if (!signal) throw new Error(localizedMessage("Сигнал этого эмитента не зарегистрирован."));
    const validation = await validateSignalMacro(macroUuid, signal, { resolveMacro });
    if (!validation.valid) { const error = new Error(validation.error); error.snippet = validation.snippet; throw error; }
  }
}

/** The chosen input must be the contract that this particular block will receive,
 * not merely another compatible signal somewhere in the scene catalog. */
export function assertBindingScriptContracts(binding, catalog) {
  const contexts = new Map(), ownerKey = objectKey(binding);
  for (const entry of binding.eventScripts ?? []) {
    const subscription = catalog.subscriptions?.find(row => row.id === entry.subscriptionId && row.ownerKey === ownerKey && row.handler === "script");
    const signal = subscription && catalog.signals.find(row => row.id === subscription.signalId && row.emitterKey === subscription.emitterKey);
    if (!signal) throw new Error(text("Событие должно ссылаться на действующую подписку этого объекта со скриптом.", "An event must refer to an existing script subscription of this object."));
    contexts.set(entry.script, signal);
  }
  for (const entry of binding.reactionScripts ?? []) {
    const action = binding.actions?.find(row => row.id === entry.actionId);
    if (!action) throw new Error(text("Реакция должна ссылаться на действие объекта.", "A reaction must refer to an object action."));
    contexts.set(entry.script, objectActionContract(binding, action));
  }
  for (const script of bindingScripts(binding)) for (const step of script.steps ?? []) {
    if (step.kind !== "macro" || !step.parameters?.signalId) continue;
    if (contexts.get(script)?.id !== step.parameters.signalId)
      throw new Error(text("Параметры макроса должны соответствовать подписке или действию этого блока.", "Macro inputs must match this block's subscription or action."));
  }
  return contexts;
}

export async function validateBindingScriptMacroInterfaces(binding, catalog, options) {
  const contexts = assertBindingScriptContracts(binding, catalog);
  for (const [script, signal] of contexts) await validateScriptMacroInterfaces(script.steps ?? [], { signals: [signal] }, options);
}
function instanceFields(source) {
  if (!isRecord(source)) throw new Error(localizedMessage("Фабрика должна вернуть объекты parameters и returns."));
  return normalizeSignalFields(Object.entries(source).map(([name, field]) => ({ ...field, name })));
}
/** The saved annotation is checked without running code. The live factory is checked
 * again before execute so stale or dishonest declarations never bypass the contract. */
export async function executeSignalMacro(macro, signal, parameters, context = {}, { isCurrent = () => true } = {}) {
  requireMacro(macro);
  const inspection = inspectSignalMacro(macro, signal);
  if (!inspection.valid) throw new Error(inspection.error);
  if (!isCurrent()) return;
  const instance = await macro.execute({ signalContext: context });
  // The factory can await I/O too. A cancelled delivery must never invoke the
  // returned behavior, even if its original scene becomes current again.
  if (!isCurrent()) return;
  if (!isRecord(instance) || typeof instance.execute !== "function") throw new Error(localizedMessage("Макрос должен вернуть объект с методом execute."));
  const contract = assertSignalInterface(signal, { parameters: instanceFields(instance.parameters), returns: instanceFields(instance.returns) });
  const values = validateSignalValues(signal.parameters, parameters);
  for (const field of contract.parameters) instance.parameters[field.name].value = structuredClone(values[field.name]);
  await instance.execute(context);
  if (!isCurrent()) return;
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
