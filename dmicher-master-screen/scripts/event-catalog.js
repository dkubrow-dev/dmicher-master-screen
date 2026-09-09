import { MODULE_ID, randomId, normalizeDescription } from "./model.js";
import { getDefinitions, requireGM, withSceneLock } from "./store.js";
import { BUILTIN_EVENT_DESCRIPTIONS, BUILTIN_FIELD_DESCRIPTIONS } from "./object-descriptions.js";

const clone = (value) => structuredClone(value);
export const EVENT_NAME = /^[a-zA-Z\p{L}][\p{L}\p{N}_. -]{0,99}$/u;
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const identifier = (value, label) => { if (typeof value !== "string" || !EVENT_NAME.test(value.trim())) throw new Error(`${label}: требуется имя длиной до 100 символов.`); return value.trim(); };
const fields = (names) => names.map(([name, type]) => ({ name, type, required: false, description: clone(BUILTIN_FIELD_DESCRIPTIONS[name]) }));
const builtinSpecs = [
  ["episode.entered", fields([["episodeId", "string"], ["previousEpisodeId", "string"], ["schemeId", "string"]])],
  ["automation.changed", fields([["tokenId", "string"], ["enabled", "boolean"]])],
  ["zone.entered", fields([["zoneId", "string"], ["label", "string"]])],
  ["dialogue.finished", fields([["dialogueId", "string"], ["responseId", "string"], ["userId", "string"]])]
];
export function builtinCatalog() {
  // Return independent snapshots: callers may prepare UI drafts but cannot mutate the
  // module's authored contracts, descriptions or another reader's localized fields.
  return { events: builtinSpecs.map(([name]) => ({ id: `builtin-${name.replaceAll(".", "-")}`, name, builtin: true, description: clone(BUILTIN_EVENT_DESCRIPTIONS[name]), subscribers: [] })),
    triggers: builtinSpecs.map(([name, parameters]) => ({ id: `trigger-${name.replaceAll(".", "-")}`, name, eventId: `builtin-${name.replaceAll(".", "-")}`, builtin: true,
      description: { ru: `Типизированные данные события «${name}». ${BUILTIN_EVENT_DESCRIPTIONS[name].ru}`,
        en: `Typed data for the "${name}" event. ${BUILTIN_EVENT_DESCRIPTIONS[name].en}` }, parameters: clone(parameters) })) };
}
function normalizeParameter(raw) {
  const name = String(raw.name ?? "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name) || ["type", "__proto__", "constructor", "prototype"].includes(name)) throw new Error("Имя параметра: латиница, цифры и подчёркивание; поле type занято именем триггера.");
  const type = raw.type;
  if (!["string", "integer", "number", "boolean"].includes(type)) throw new Error("Неизвестный тип параметра.");
  const result = { name, type, description: normalizeDescription(raw.description), required: raw.required !== false };
  for (const key of type === "string" ? ["minLength", "maxLength"] : type === "integer" || type === "number" ? ["min", "max", ...(type === "number" ? ["decimals"] : [])] : []) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || ((["minLength", "maxLength", "decimals"].includes(key) || type === "integer") && !Number.isInteger(value)) || (["minLength", "maxLength", "decimals"].includes(key) && value < 0)) throw new Error("Некорректное ограничение параметра.");
    if (key === "decimals" && value > 12) throw new Error("Допустимо до 12 знаков после запятой.");
    if (["minLength", "maxLength"].includes(key) && value > 8000) throw new Error("Длина строки ограничена 8000 символами.");
    result[key] = value;
  }
  if ((result.min !== undefined && result.max !== undefined && result.min > result.max) || (result.minLength !== undefined && result.maxLength !== undefined && result.minLength > result.maxLength)) throw new Error("Минимум не может превышать максимум.");
  return result;
}
export function validateTypedTrigger(catalog, event, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype) throw new Error("Триггер должен быть обычным объектом с полем type.");
  const trigger = catalog.triggers.find((entry) => entry.eventId === event.id && entry.name === payload.type);
  if (!trigger) throw new Error(`Событие «${event.name}» не принимает триггер «${String(payload.type ?? "") }».`);
  const allowed = new Set(["type", ...trigger.parameters.map((entry) => entry.name)]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error("Триггер содержит незаявленные параметры.");
  if (JSON.stringify(payload).length > 8000) throw new Error("Триггер превышает 8000 символов.");
  for (const parameter of trigger.parameters) {
    const value = payload[parameter.name];
    if (value === undefined) { if (parameter.required !== false) throw new Error(`Не задан параметр «${parameter.name}».`); continue; }
    if ((parameter.type === "string" && typeof value !== "string") || (parameter.type === "boolean" && typeof value !== "boolean")
      || (["integer", "number"].includes(parameter.type) && (typeof value !== "number" || !Number.isFinite(value)))
      || (parameter.type === "integer" && !Number.isInteger(value))) throw new Error(`Параметр «${parameter.name}»: неверный тип.`);
    if (parameter.type === "string" && ((parameter.minLength !== undefined && [...value].length < parameter.minLength) || (parameter.maxLength !== undefined && [...value].length > parameter.maxLength))) throw new Error(`Параметр «${parameter.name}»: недопустимая длина.`);
    if (["integer", "number"].includes(parameter.type) && ((parameter.min !== undefined && value < parameter.min) || (parameter.max !== undefined && value > parameter.max))) throw new Error(`Параметр «${parameter.name}»: значение вне диапазона.`);
    if (parameter.type === "number" && parameter.decimals !== undefined && Math.abs(value - Number(value.toFixed(parameter.decimals))) > Number.EPSILON * Math.max(1, Math.abs(value))) throw new Error(`Параметр «${parameter.name}»: слишком много знаков после запятой.`);
  }
  return clone(payload);
}
function assertUnique(entries, key, label) {
  const seen = new Set();
  for (const entry of entries) { const value = String(entry[key]).toLocaleLowerCase(); if (seen.has(value)) throw new Error(`${label}: имя должно быть уникальным в сцене.`); seen.add(value); }
}
export function normalizeCatalog(raw = {}) {
  const builtin = builtinCatalog();
  if (!Array.isArray(raw.events ?? []) || !Array.isArray(raw.triggers ?? []) || !Array.isArray(raw.macros ?? [])) throw new Error("События, триггеры и макросы должны быть списками.");
  if ((raw.events?.length ?? 0) > 200 || (raw.triggers?.length ?? 0) > 500 || (raw.macros?.length ?? 0) > 500) throw new Error("Превышен размер каталога сцены.");
  const events = (raw.events ?? []).map((entry) => {
    if (entry.builtin || builtin.events.some((item) => item.id === entry.id || item.name === entry.name)) throw new Error("Встроенные события нельзя изменять.");
    return { id: entry.id || randomId(), name: identifier(entry.name, "Событие"), builtin: false, description: normalizeDescription(entry.description),
      subscribers: (entry.subscribers ?? []).map((subscriber) => {
        if (!["macro", "builtin", "trigger"].includes(subscriber.kind)) throw new Error("Неизвестный вид подписанта.");
        if (subscriber.kind === "builtin" && !["pause", "unpause", "halt-scheme", "halt-all", "chat"].includes(subscriber.action)) throw new Error("Неизвестное встроенное действие. Переходы задаются в таблице событий эпизода.");
        return { id: subscriber.id || randomId(), kind: subscriber.kind, enabled: subscriber.enabled !== false,
          macroUuid: String(subscriber.macroUuid ?? "").slice(0, 256), triggerId: String(subscriber.triggerId ?? ""), parameters: clone(subscriber.parameters ?? {}),
          action: subscriber.action || "", schemeId: String(subscriber.schemeId ?? "main"), text: String(subscriber.text ?? "").slice(0, 8000), audience: clone(subscriber.audience ?? { gms: true }) };
      }) };
  });
  const triggers = (raw.triggers ?? []).map((entry) => {
    if (entry.builtin || builtin.triggers.some((item) => item.id === entry.id || item.name === entry.name)) throw new Error("Встроенные триггеры нельзя изменять.");
    const parameters = (entry.parameters ?? []).map(normalizeParameter);
    if (parameters.length > 50) throw new Error("Допустимо до 50 параметров триггера.");
    assertUnique(parameters, "name", "Параметр");
    return { id: entry.id || randomId(), name: identifier(entry.name, "Триггер"), eventId: String(entry.eventId ?? ""), builtin: false, description: normalizeDescription(entry.description), parameters };
  });
  const allEvents = [...builtin.events, ...events], allTriggers = [...builtin.triggers, ...triggers];
  for (const [entries, label] of [[allEvents, "Событие"], [allTriggers, "Триггер"]]) {
    assertUnique(entries, "name", label); assertUnique(entries, "id", label);
    if (entries.some((entry) => !idPattern.test(entry.id))) throw new Error("Некорректный идентификатор каталога.");
  }
  for (const entry of triggers) if (!allEvents.some((event) => event.id === entry.eventId)) throw new Error("Триггер ссылается на отсутствующее событие.");
  const macros = (raw.macros ?? []).map((entry) => ({ uuid: String(entry.uuid ?? "").slice(0, 256), triggerIds: [...new Set(entry.triggerIds ?? [])] }));
  assertUnique(macros, "uuid", "Макрос");
  for (const entry of macros) if (!entry.uuid || entry.triggerIds.some((id) => !allTriggers.some((trigger) => trigger.id === id))) throw new Error("Макрос ссылается на отсутствующий триггер.");
  for (const event of events) {
    if (event.subscribers.length > 100) throw new Error("Допустимо до 100 подписантов события.");
    assertUnique(event.subscribers, "id", "Подписант");
    for (const subscriber of event.subscribers) if (subscriber.kind === "trigger") {
      const trigger = allTriggers.find((entry) => entry.id === subscriber.triggerId), target = allEvents.find((entry) => entry.id === trigger?.eventId);
      if (!trigger || !target) throw new Error("Подписант ссылается на отсутствующий триггер.");
      validateTypedTrigger({ triggers: allTriggers }, target, { ...subscriber.parameters, type: trigger.name });
    }
  }
  return { schemaVersion: 1, revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, events, triggers, macros };
}
export function getEventCatalog(scene) {
  const custom = normalizeCatalog(scene?.getFlag(MODULE_ID, "eventCatalog") ?? {}), builtin = builtinCatalog();
  const result = { ...custom, events: [...builtin.events, ...custom.events], triggers: [...builtin.triggers, ...custom.triggers] };
  return result;
}

export function exportCatalogDependencies(scene, episodes) {
  const catalog = getEventCatalog(scene), names = new Set(episodes.flatMap((episode) => [...(episode.events ?? []),
    ...(episode.interactions ?? []).map((entry) => entry.eventName),
    ...(episode.zones ?? []).map((entry) => entry.eventName)
  ]).filter(Boolean));
  const eventIds = new Set(catalog.events.filter((entry) => names.has(entry.name)).map((entry) => entry.id));
  let changed;
  do {
    changed = false;
    for (const event of catalog.events.filter((entry) => eventIds.has(entry.id))) for (const subscriber of event.subscribers) {
      const ids = subscriber.kind === "trigger" ? [subscriber.triggerId] : subscriber.kind === "macro" ? catalog.macros.find((entry) => entry.uuid === subscriber.macroUuid)?.triggerIds ?? [] : [];
      for (const id of ids) {
        const trigger = catalog.triggers.find((entry) => entry.id === id);
        if (trigger && !eventIds.has(trigger.eventId)) { eventIds.add(trigger.eventId); changed = true; }
      }
    }
  } while (changed);
  const events = catalog.events.filter((entry) => eventIds.has(entry.id) && !entry.builtin);
  const macroIds = new Set(events.flatMap((event) => event.subscribers.filter((entry) => entry.kind === "macro").map((entry) => entry.macroUuid)));
  const macros = catalog.macros.filter((entry) => macroIds.has(entry.uuid));
  const triggerIds = new Set(macros.flatMap((entry) => entry.triggerIds));
  return { schemaVersion: 1, events, triggers: catalog.triggers.filter((entry) => !entry.builtin && (eventIds.has(entry.eventId) || triggerIds.has(entry.id))), macros };
}

/** Portable imports preserve matching local contracts and reject conflicting names. */
export function mergeCatalogDependencies(scene, source = {}) {
  const current = getEventCatalog(scene), incoming = normalizeCatalog(source), mapping = new Map();
  const events = current.events.filter((entry) => !entry.builtin), triggers = current.triggers.filter((entry) => !entry.builtin), macros = clone(current.macros);
  for (const event of incoming.events) {
    const match = current.events.find((entry) => entry.name.toLocaleLowerCase() === event.name.toLocaleLowerCase());
    mapping.set(event.id, match?.id ?? randomId());
  }
  for (const trigger of incoming.triggers) {
    const match = current.triggers.find((entry) => entry.name.toLocaleLowerCase() === trigger.name.toLocaleLowerCase());
    mapping.set(trigger.id, match?.id ?? randomId());
  }
  for (const trigger of incoming.triggers) {
    const next = { ...trigger, id: mapping.get(trigger.id), eventId: mapping.get(trigger.eventId) ?? trigger.eventId };
    const match = current.triggers.find((entry) => entry.id === next.id);
    // Descriptive prose may differ between campaigns without changing the data contract.
    // Reusing a local contract keeps that campaign's own descriptions intact.
    const contract = (parameters) => parameters.map(({ description, ...parameter }) => parameter);
    if (match && (match.eventId !== next.eventId || JSON.stringify(contract(match.parameters)) !== JSON.stringify(contract(next.parameters)))) throw new Error(`Конфликт типа триггера «${next.name}» в принимающей сцене.`);
    if (!match) triggers.push(next);
  }
  for (const event of incoming.events) {
    const next = { ...event, id: mapping.get(event.id), subscribers: event.subscribers.map((entry) => ({ ...entry, triggerId: mapping.get(entry.triggerId) ?? entry.triggerId })) };
    const match = current.events.find((entry) => entry.id === next.id);
    if (match && JSON.stringify(match.subscribers.map(({ id, ...entry }) => entry)) !== JSON.stringify(next.subscribers.map(({ id, ...entry }) => entry))) throw new Error(`Конфликт подписантов события «${next.name}» в принимающей сцене.`);
    if (!match) events.push(next);
  }
  for (const macro of incoming.macros) {
    const next = { uuid: macro.uuid, triggerIds: macro.triggerIds.map((id) => mapping.get(id) ?? id) }, match = macros.find((entry) => entry.uuid === next.uuid);
    if (match) match.triggerIds = [...new Set([...match.triggerIds, ...next.triggerIds])]; else macros.push(next);
  }
  return normalizeCatalog({ schemaVersion: 1, revision: current.revision + 1, events, triggers, macros });
}

function eventIsReferenced(scene, name) {
  return assetDialogues(scene).some((dialogue) => dialogue.pages.some((page) => page.responses.some((response) => response.eventName === name)))
    || objectRoutineSteps(scene).some((step) => step.kind === "event" && step.parameters.eventName === name)
    || objectFeatures(scene).some((feature) => feature.eventName === name)
    || getDefinitions(scene).some((definition) => definition.episodes.some((episode) => episode.events.includes(name)
    || episode.interactions.some((entry) => entry.eventName === name)
    || episode.zones.some((entry) => entry.eventName === name)
  ));
}
const assetDialogues = (scene) => scene?.getFlag(MODULE_ID, "interactionCatalog")?.dialogues ?? [];
const objectFeatures = (scene) => Object.values(scene?.getFlag(MODULE_ID, "objectBindings")?.bindings ?? {}).flatMap((binding) => binding?.features ?? []);
const objectRoutineSteps = (scene) => Object.values(scene?.getFlag(MODULE_ID, "objectBindings")?.bindings ?? {}).flatMap((binding) => (binding?.routines ?? []).flatMap((routine) => routine.steps));
export class EventCatalog {
  constructor(scene) { this.scene = scene; }
  list() { return getEventCatalog(this.scene); }
  async change(operation, { expectedRevision } = {}) {
    return withSceneLock(this.scene, async () => {
      requireGM();
      const inherited = this.list();
      if (expectedRevision !== undefined && inherited.revision !== expectedRevision) throw new Error("Каталог событий изменён другим окном. Обновите параметры перед сохранением.");
      const current = normalizeCatalog({ ...inherited, events: inherited.events.filter((entry) => !entry.builtin), triggers: inherited.triggers.filter((entry) => !entry.builtin) });
      const result = operation(current), next = normalizeCatalog(current);
      next.revision++;
      const builtin = builtinCatalog(), typed = { triggers: [...builtin.triggers, ...next.triggers] }, events = [...builtin.events, ...next.events];
      for (const feature of objectFeatures(this.scene)) if (feature.kind === "trigger") {
        const trigger = typed.triggers.find((entry) => entry.id === feature.triggerId), event = events.find((entry) => entry.id === trigger?.eventId);
        if (!event) throw new Error("Триггер используется особенностью объекта.");
        validateTypedTrigger(typed, event, { ...feature.parameters, type: trigger.name });
      }
      const routineSteps = current._objectBindings ? Object.values(current._objectBindings.bindings).flatMap((binding) => (binding?.routines ?? []).flatMap((routine) => routine.steps)) : objectRoutineSteps(this.scene);
      for (const step of routineSteps) if (step.kind === "event") {
        const p = step.parameters, trigger = typed.triggers.find((entry) => entry.id === p.triggerId), event = events.find((entry) => entry.id === trigger?.eventId);
        if (!event || event.name !== p.eventName) throw new Error("Триггер используется шагом распорядка и должен принадлежать его событию.");
        validateTypedTrigger(typed, event, { ...p.parameters, type: trigger.name });
      }
      const fields = { eventCatalog: next, ...(current._definitions ? { definitions: current._definitions } : {}),
        ...(current._interactionCatalog ? { interactionCatalog: current._interactionCatalog } : {}), ...(current._objectBindings ? { objectBindings: current._objectBindings } : {}) };
      if (this.scene.update) await this.scene.update(Object.fromEntries(Object.entries(fields).map(([key, value]) => [`flags.${MODULE_ID}.${key}`, value])));
      else for (const [key, value] of Object.entries(fields)) await this.scene.setFlag(MODULE_ID, key, value);
      return clone(result ?? next);
    });
  }
  saveEvent(value, options = {}) { return this.change((catalog) => {
    if (value.builtin || builtinCatalog().events.some((entry) => entry.id === value.id)) throw new Error("Встроенное событие нельзя изменять.");
    const previous = catalog.events.find((entry) => entry.id === value.id);
    if (previous && previous.name !== value.name) {
      const definitions = getDefinitions(this.scene), name = identifier(value.name, "Событие");
      const replace = (entry, key) => { if (entry[key] === previous.name) entry[key] = name; };
      for (const definition of definitions) {
        for (const episode of definition.episodes) {
          episode.events = episode.events.map((entry) => entry === previous.name ? name : entry);
          episode.interactions.forEach((entry) => replace(entry, "eventName"));
          episode.zones.forEach((entry) => replace(entry, "eventName"));
        }
        definition.revision++;
      }
      catalog._definitions = Object.fromEntries(definitions.map((entry) => [entry.schemeId, entry]));
      const assets = clone(this.scene.getFlag(MODULE_ID, "interactionCatalog")), bindings = clone(this.scene.getFlag(MODULE_ID, "objectBindings"));
      if (assets) {
        for (const dialogue of assets.dialogues ?? []) for (const page of dialogue.pages) page.responses.forEach((response) => replace(response, "eventName"));
        assets.revision = (assets.revision ?? 0) + 1; catalog._interactionCatalog = assets;
      }
      if (bindings) {
        for (const binding of Object.values(bindings.bindings)) {
          for (const feature of binding?.features ?? []) replace(feature, "eventName");
          for (const routine of binding?.routines ?? []) for (const step of routine.steps) if (step.kind === "event") replace(step.parameters, "eventName");
        }
        bindings.revision = (bindings.revision ?? 0) + 1; catalog._objectBindings = bindings;
      }
    }
    const next = { ...clone(value), id: value.id || randomId(), builtin: false };
    if (previous) catalog.events[catalog.events.indexOf(previous)] = next; else catalog.events.push(next); return next;
  }, options); }
  deleteEvent(id) { return this.change((catalog) => {
    const event = catalog.events.find((entry) => entry.id === id);
    if (!event) throw new Error("Встроенное или отсутствующее событие нельзя удалить.");
    if (catalog.triggers.some((entry) => entry.eventId === id) || eventIsReferenced(this.scene, event.name)) throw new Error("Сначала удалите триггеры и связи события.");
    catalog.events = catalog.events.filter((entry) => entry.id !== id);
  }); }
  saveTrigger(value, options = {}) { return this.change((catalog) => {
    if (value.builtin || builtinCatalog().triggers.some((entry) => entry.id === value.id)) throw new Error("Встроенный триггер нельзя изменять.");
    const next = { ...clone(value), id: value.id || randomId(), builtin: false }, index = catalog.triggers.findIndex((entry) => entry.id === next.id);
    if (index < 0) catalog.triggers.push(next); else catalog.triggers[index] = next; return next;
  }, options); }
  deleteTrigger(id) { return this.change((catalog) => {
    if (!catalog.triggers.some((entry) => entry.id === id)) throw new Error("Встроенный или отсутствующий триггер нельзя удалить.");
    if (catalog.events.some((event) => event.subscribers.some((entry) => entry.triggerId === id)) || catalog.macros.some((entry) => entry.triggerIds.includes(id))
      || objectFeatures(this.scene).some((feature) => feature.triggerId === id)
      || objectRoutineSteps(this.scene).some((step) => step.kind === "event" && step.parameters.triggerId === id)) throw new Error("Сначала удалите подписки на триггер.");
    catalog.triggers = catalog.triggers.filter((entry) => entry.id !== id);
  }); }
  saveMacro(value, options = {}) { return this.change((catalog) => {
    const next = { uuid: value.uuid, triggerIds: [...(value.triggerIds ?? [])] }, index = catalog.macros.findIndex((entry) => entry.uuid === next.uuid);
    if (index < 0) catalog.macros.push(next); else catalog.macros[index] = next; return next;
  }, options); }
  removeMacro(uuid) { return this.change((catalog) => {
    if (objectFeatures(this.scene).some((feature) => feature.macroUuid === uuid)) throw new Error("Макрос используется особенностью объекта.");
    if (objectRoutineSteps(this.scene).some((step) => step.kind === "macro" && step.parameters.macroUuid === uuid)) throw new Error("Макрос используется распорядком объекта.");
    catalog.macros = catalog.macros.filter((entry) => entry.uuid !== uuid);
  }); }
  exportTrigger(id) {
    requireGM(); const catalog = this.list(), trigger = catalog.triggers.find((entry) => entry.id === id);
    if (!trigger || trigger.builtin) throw new Error("Экспортируется пользовательский тип триггера.");
    const event = catalog.events.find((entry) => entry.id === trigger.eventId);
    return { format: MODULE_ID, version: 1, kind: "trigger", trigger: clone(trigger), event: { id: event.id, name: event.name } };
  }
  importTrigger(envelope, { eventId, name } = {}) {
    if (envelope?.format !== MODULE_ID || envelope.version !== 1 || envelope.kind !== "trigger") throw new Error("Ожидается JSON типа триггера Ширмы.");
    return this.change((catalog) => {
      const all = [...builtinCatalog().events, ...catalog.events];
      const event = eventId ? all.find((entry) => entry.id === eventId) : all.find((entry) => entry.name.toLocaleLowerCase() === String(envelope.event?.name ?? "").toLocaleLowerCase());
      if (!event) throw new Error("Родительское событие не найдено. Сначала импортируйте событие или укажите существующее.");
      const next = { ...clone(envelope.trigger), id: randomId(), eventId: event.id, name: name ?? envelope.trigger?.name, builtin: false };
      catalog.triggers.push(next); return next;
    });
  }
  exportEvent(id) {
    requireGM(); const catalog = this.list(), event = catalog.events.find((entry) => entry.id === id);
    if (!event || event.builtin) throw new Error("Экспортируется пользовательское событие.");
    return { format: MODULE_ID, version: 1, kind: "event", event: clone(event), triggers: catalog.triggers.filter((entry) => entry.eventId === id && !entry.builtin).map(clone),
      catalog: exportCatalogDependencies(this.scene, [{ events: [event.name], subscriptions: [], interactions: [], dialogues: [] }]) };
  }
  importEvent(envelope) {
    if (envelope?.format !== MODULE_ID || envelope.version !== 1 || envelope.kind !== "event") throw new Error("Ожидается JSON события Ширмы.");
    return this.change((catalog) => {
      if (envelope.catalog) {
        const merged = mergeCatalogDependencies(this.scene, envelope.catalog);
        catalog.events = merged.events; catalog.triggers = merged.triggers; catalog.macros = merged.macros;
        const imported = catalog.events.find((entry) => entry.name === envelope.event?.name);
        if (!imported) throw new Error("В JSON отсутствует экспортируемое событие.");
        return imported;
      }
      const event = { ...clone(envelope.event), id: randomId(), builtin: false }, mapping = new Map();
      const triggers = (envelope.triggers ?? []).map((entry) => { const id = randomId(); mapping.set(entry.id, id); return { ...clone(entry), id, eventId: event.id, builtin: false }; });
      event.subscribers = event.subscribers.map((entry) => ({ ...entry, id: randomId(), triggerId: mapping.get(entry.triggerId) ?? entry.triggerId }));
      catalog.events.push(event); catalog.triggers.push(...triggers); return event;
    });
  }
}
