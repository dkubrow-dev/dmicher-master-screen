import { MODULE_ID, randomId, normalizeDescription } from "./model.js";
import { requireGM, withSceneLock } from "./store.js";
import { builtinCatalog, listSignalEmitters } from "./builtin-signals.js";
import { normalizeSignalFields, signalName } from "./signal-types.js";
import { validateSignalMacro, validateStandaloneMacro } from "./signal-macros.js";
import { notifyExecutionChange } from "./execution.js";

export { builtinCatalog, listSignalEmitters } from "./builtin-signals.js";
const clone = (value) => structuredClone(value);
const unique = (entries, key, label) => {
  const values = new Set();
  for (const entry of entries) { const value = key(entry); if (values.has(value)) throw new Error(`${label}: повторяющееся значение.`); values.add(value); }
};
function list(raw, field, maximum = 1000) {
  const value = raw[field] ?? [];
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Каталог ${field}: требуется список не более ${maximum} элементов.`);
  return value;
}
function normalizeSignal(raw) {
  return { id: raw.id || randomId(), emitterKey: signalName(raw.emitterKey, "Эмитент"), name: signalName(raw.name, "Сигнал"), description: normalizeDescription(raw.description),
    builtin: raw.builtin === true, ...(raw.label ? { label: normalizeDescription(raw.label) } : {}), parameters: normalizeSignalFields(raw.parameters), returns: normalizeSignalFields(raw.returns) };
}
function protectBuiltin(signal, builtin) {
  if (signal.name !== builtin.name || JSON.stringify(signal.description) !== JSON.stringify(builtin.description)) throw new Error("Имя и описание системного сигнала нельзя изменять.");
  for (const kind of ["parameters", "returns"]) for (const field of builtin[kind]) {
    const candidate = signal[kind].find((entry) => entry.name === field.name);
    if (!candidate || JSON.stringify(candidate) !== JSON.stringify(normalizeSignalFields([field])[0])) throw new Error(`Системное поле «${field.name}» нельзя изменять или удалять.`);
  }
  for (const kind of ["parameters", "returns"]) for (const field of signal[kind]) field.builtin = builtin[kind].some((base) => base.name === field.name);
  return { ...signal, builtin: true, label: builtin.label };
}
export function normalizeCatalog(raw = {}, { scene } = {}) {
  const builtin = scene ? builtinCatalog(scene).signals : [], baseById = new Map(builtin.map((entry) => [entry.id, entry]));
  const signals = list(raw, "signals").map((entry) => {
    const signal = normalizeSignal(entry), base = baseById.get(signal.id);
    if (base) {
      if (base.emitterKey !== signal.emitterKey) throw new Error("Системный сигнал нельзя передать другому эмитенту.");
      return protectBuiltin(signal, base);
    }
    // Deleted scene objects may leave references visible for explicit cleanup. They
    // cannot emit signals: dispatch always requires an existing emitter document.
    if (scene && signal.builtin && listSignalEmitters(scene).some((emitter) => emitter.key === signal.emitterKey)) throw new Error("Неизвестный системный сигнал.");
    if (!signal.builtin) for (const field of [...signal.parameters, ...signal.returns]) field.builtin = false;
    return signal;
  });
  const macros = list(raw, "macros").map((entry) => ({ ownerKey: signalName(entry.ownerKey, "Владелец макроса"), uuid: signalName(entry.uuid, "UUID макроса") }));
  const subscriptions = list(raw, "subscriptions", 2000).map((entry) => ({ id: entry.id || randomId(), ownerKey: signalName(entry.ownerKey, "Подписчик"),
    emitterKey: signalName(entry.emitterKey, "Эмитент"), signalId: signalName(entry.signalId, "ID сигнала"), macroUuid: signalName(entry.macroUuid, "Макрос"), enabled: entry.enabled !== false }));
  unique(signals, (entry) => entry.id, "ID сигнала"); unique(signals, (entry) => `${entry.emitterKey}\0${entry.name}`, "Имя сигнала у эмитента");
  unique(macros, (entry) => `${entry.ownerKey}\0${entry.uuid}`, "Макрос объекта"); unique(subscriptions, (entry) => entry.id, "ID подписки");
  unique(subscriptions, (entry) => `${entry.ownerKey}\0${entry.signalId}\0${entry.macroUuid}`, "Подписка макроса");
  const allSignals = [...builtin.filter((entry) => !signals.some((signal) => signal.id === entry.id)), ...signals];
  unique(allSignals, (entry) => `${entry.emitterKey}\0${entry.name}`, "Имя системного сигнала");
  for (const subscription of subscriptions) {
    const signal = allSignals.find((entry) => entry.id === subscription.signalId && entry.emitterKey === subscription.emitterKey);
    if (scene && !signal && listSignalEmitters(scene).some((entry) => entry.key === subscription.emitterKey)) throw new Error("Подписка ссылается на отсутствующий сигнал эмитента.");
    if (!macros.some((entry) => entry.ownerKey === subscription.ownerKey && entry.uuid === subscription.macroUuid)) throw new Error("Объект не владеет макросом подписки.");
  }
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, signals, macros, subscriptions };
}
export function getSignalCatalog(scene) {
  const current = normalizeCatalog(scene?.getFlag?.(MODULE_ID, "signalCatalog") ?? {}, { scene });
  const builtin = builtinCatalog(scene).signals;
  return { ...current, signals: [...builtin.filter((entry) => !current.signals.some((signal) => signal.id === entry.id)), ...current.signals], emitters: listSignalEmitters(scene) };
}
export function findSignal(scene, { emitterKey, signalId, name }) {
  return getSignalCatalog(scene).signals.find((entry) => entry.emitterKey === emitterKey && (signalId ? entry.id === signalId : entry.name === name)) ?? null;
}
function objectReferences(scene, predicate) {
  const visit = (value) => value && typeof value === "object" && (predicate(value) || Object.values(value).some(visit));
  return visit(scene?.getFlag?.(MODULE_ID, "objectBindings")) || visit(scene?.getFlag?.(MODULE_ID, "interactionCatalog"));
}
export class SignalCatalog {
  constructor(scene, { resolveMacro = globalThis.fromUuid } = {}) { this.scene = scene; this.resolveMacro = resolveMacro; }
  list() { return getSignalCatalog(this.scene); }
  async change(operation, { expectedRevision } = {}) {
    return withSceneLock(this.scene, async () => {
      requireGM();
      const raw = normalizeCatalog(this.scene.getFlag(MODULE_ID, "signalCatalog") ?? {}, { scene: this.scene });
      if (expectedRevision !== undefined && expectedRevision !== raw.revision) throw new Error("Каталог сигналов изменён другим окном. Обновите его перед сохранением.");
      const result = await operation(raw), next = normalizeCatalog(raw, { scene: this.scene });
      next.revision++;
      await this.scene.setFlag(MODULE_ID, "signalCatalog", next);
      notifyExecutionChange(this.scene, "signal-catalog");
      return result;
    });
  }
  requireOwner(key) {
    if (!listSignalEmitters(this.scene).some((entry) => entry.key === key)) throw new Error("Объект эмитента или подписчика больше не существует.");
  }
  saveSignal(source, options) {
    return this.change(async (catalog) => {
      this.requireOwner(source.emitterKey);
      const signal = normalizeSignal(source), previous = this.list().signals.find((entry) => entry.id === signal.id);
      if (previous?.builtin) protectBuiltin(signal, builtinCatalog(this.scene).signals.find((entry) => entry.id === previous.id));
      for (const subscriber of catalog.subscriptions.filter((entry) => entry.signalId === signal.id)) await this.requireInterface(subscriber.macroUuid, signal);
      catalog.signals = [...catalog.signals.filter((entry) => entry.id !== signal.id), signal];
      return clone(signal);
    }, options);
  }
  removeSignal(id, options) {
    return this.change((catalog) => {
      if (this.list().signals.find((entry) => entry.id === id)?.builtin) throw new Error("Системный сигнал нельзя удалить.");
      if (catalog.subscriptions.some((entry) => entry.signalId === id) || objectReferences(this.scene, (value) => value.signalId === id)) throw new Error("Сигнал используется подпиской или скриптом.");
      catalog.signals = catalog.signals.filter((entry) => entry.id !== id);
    }, options);
  }
  attachMacro(ownerKey, uuid, options) {
    return this.change(async (catalog) => {
      this.requireOwner(ownerKey);
      const result = await validateStandaloneMacro(uuid, { resolveMacro: this.resolveMacro });
      if (!result.valid) throw new Error(result.error);
      if (!catalog.macros.some((entry) => entry.ownerKey === ownerKey && entry.uuid === uuid)) catalog.macros.push({ ownerKey, uuid });
      return { ownerKey, uuid };
    }, options);
  }
  removeMacro(ownerKey, uuid, options) {
    return this.change((catalog) => {
      const binding = this.scene.getFlag(MODULE_ID, "objectBindings")?.bindings?.[ownerKey];
      const used = (value) => value && typeof value === "object" && ((value.kind === "macro" && value.parameters?.macroUuid === uuid) || Object.values(value).some(used));
      if (catalog.subscriptions.some((entry) => entry.ownerKey === ownerKey && entry.macroUuid === uuid) || used(binding)) throw new Error("Макрос используется подпиской или скриптом объекта.");
      catalog.macros = catalog.macros.filter((entry) => entry.ownerKey !== ownerKey || entry.uuid !== uuid);
    }, options);
  }
  async requireInterface(uuid, signal) {
    const validation = await validateSignalMacro(uuid, signal, { resolveMacro: this.resolveMacro });
    if (!validation.valid) { const error = new Error(validation.error); error.snippet = validation.snippet; throw error; }
  }
  saveSubscription(source, options) {
    return this.change(async (catalog) => {
      this.requireOwner(source.ownerKey); this.requireOwner(source.emitterKey);
      const signal = this.list().signals.find((entry) => entry.id === source.signalId && entry.emitterKey === source.emitterKey);
      if (!signal) throw new Error("Сигнал этого эмитента не зарегистрирован.");
      if (!catalog.macros.some((entry) => entry.ownerKey === source.ownerKey && entry.uuid === source.macroUuid)) throw new Error("Подписчик не владеет выбранным макросом.");
      await this.requireInterface(source.macroUuid, signal);
      const entry = { ...source, id: source.id || randomId() };
      catalog.subscriptions = [...catalog.subscriptions.filter((item) => item.id !== entry.id), entry];
      return clone(entry);
    }, options);
  }
  removeSubscription(id, options) { return this.change((catalog) => { catalog.subscriptions = catalog.subscriptions.filter((entry) => entry.id !== id); }, options); }
}

/** Current-format transfer. Names and ownership remain explicit; no legacy inference. */
export function exportCatalogDependencies(scene, ownerKeys = []) {
  const all = getSignalCatalog(scene), owners = new Set(ownerKeys.filter((key) => typeof key === "string"));
  const subscriptions = all.subscriptions.filter((entry) => !owners.size || owners.has(entry.ownerKey)), ids = new Set(subscriptions.map((entry) => entry.signalId));
  return { schemaVersion: 1, revision: 0, signals: all.signals.filter((entry) => (!entry.builtin || [...entry.parameters, ...entry.returns].some((field) => !field.builtin)) && (!owners.size || owners.has(entry.emitterKey) || ids.has(entry.id))),
    macros: all.macros.filter((entry) => !owners.size || owners.has(entry.ownerKey)), subscriptions };
}
export function mergeCatalogDependencies(scene, source = {}, { emitterMapping = new Map(), idMapping = new Map() } = {}) {
  const current = normalizeCatalog(scene?.getFlag?.(MODULE_ID, "signalCatalog") ?? {}, { scene }), incoming = normalizeCatalog(source);
  const mapKey = (key) => emitterMapping.get(key) ?? key;
  for (const signal of incoming.signals) {
    const emitterKey = mapKey(signal.emitterKey), match = getSignalCatalog(scene).signals.find((entry) => entry.emitterKey === emitterKey && entry.name === signal.name);
    const next = { ...signal, emitterKey, id: match?.id ?? (signal.builtin ? signal.id.replace(signal.emitterKey, emitterKey) : randomId()) };
    idMapping.set(signal.id, next.id);
    if (match) {
      const contract = (fields) => fields.map(({ description, builtin, ...field }) => field);
      if (JSON.stringify(contract(match.parameters)) !== JSON.stringify(contract(next.parameters)) || JSON.stringify(contract(match.returns)) !== JSON.stringify(contract(next.returns))) throw new Error(`Конфликт сигнала «${signal.name}» принимающего эмитента.`);
    } else current.signals.push(next);
  }
  for (const entry of incoming.macros) {
    const next = { ...entry, ownerKey: mapKey(entry.ownerKey) };
    if (!current.macros.some((item) => item.ownerKey === next.ownerKey && item.uuid === next.uuid)) current.macros.push(next);
  }
  for (const entry of incoming.subscriptions) {
    const next = { ...entry, id: randomId(), ownerKey: mapKey(entry.ownerKey), emitterKey: mapKey(entry.emitterKey), signalId: idMapping.get(entry.signalId) ?? entry.signalId.replace(entry.emitterKey, mapKey(entry.emitterKey)) };
    if (!current.subscriptions.some((item) => item.ownerKey === next.ownerKey && item.signalId === next.signalId && item.macroUuid === next.macroUuid)) current.subscriptions.push(next);
  }
  return normalizeCatalog({ ...current, revision: current.revision + 1 });
}
export function removeSignalOwner(catalog, ownerKey) {
  const next = normalizeCatalog(catalog), ids = new Set(next.signals.filter((entry) => entry.emitterKey === ownerKey).map((entry) => entry.id));
  next.signals = next.signals.filter((entry) => entry.emitterKey !== ownerKey);
  next.macros = next.macros.filter((entry) => entry.ownerKey !== ownerKey);
  next.subscriptions = next.subscriptions.filter((entry) => entry.ownerKey !== ownerKey && entry.emitterKey !== ownerKey && !ids.has(entry.signalId));
  return { ...next, revision: next.revision + 1 };
}
