import { MODULE_ID, defaultDefinition, defaultState, normalizeDefinition, randomId } from "./model.js";
import { getDefinitions, getDefinition, getRuntimes, requireGM, withSceneLock } from "./store.js";
import { removeSignalOwner, normalizeCatalog } from "./signal-catalog.js";
import { reconcileDefinitionBindings, exportObjectConfiguration, importObjectConfiguration, getObjectBindings } from "./scene-objects.js";

const clone = (value) => structuredClone(value);
const unique = (entries, name, except, key = "name") => {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) throw new Error("Введите название длиной от 1 до 100 символов.");
  if (entries.some((entry) => (entry.id ?? entry.groupId) !== except && entry[key].toLocaleLowerCase() === name.trim().toLocaleLowerCase())) throw new Error("В этой группе уже есть такое название.");
  return name.trim();
};
const reorder = (entries, ids, key) => {
  if (!Array.isArray(ids) || new Set(ids).size !== entries.length || ids.length !== entries.length || ids.some((id) => !entries.some((entry) => entry[key] === id))) throw new Error("Порядок должен содержать каждый элемент ровно один раз.");
  return ids.map((id) => entries.find((entry) => entry[key] === id));
};
function remapScope(states, from, to, stateIds = new Map()) {
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.groupIds)) value.groupIds = value.groupIds.map((id) => id === from ? to : id);
    if (Array.isArray(value.stateIds)) value.stateIds = value.stateIds.map((id) => stateIds.get(id) ?? id);
    for (const entry of Object.values(value)) if (entry && typeof entry === "object") visit(entry);
  };
  states.forEach(visit);
}

/** Scene-local editing never enters an state or rewrites an existing run. */
export class GroupEditor {
  constructor(scene) { this.scene = scene; }
  list() { return getDefinitions(this.scene); }
  get(id) { return getDefinition(this.scene, { groupId: id }); }
  async change(operation, { groupId, expectedRevision } = {}) {
    return withSceneLock(this.scene, async () => {
      requireGM();
      const previous = this.list(), definitions = clone(previous);
      if (expectedRevision !== undefined && previous.find((entry) => entry.groupId === groupId)?.revision !== expectedRevision) throw new Error("Параметры группы изменены другим окном. Обновите их перед сохранением.");
      const result = operation(definitions);
      const names = new Set();
      const next = definitions.map((definition, order) => {
        const normalized = normalizeDefinition({ ...definition, order });
        const name = normalized.groupName.toLocaleLowerCase();
        if (names.has(name)) throw new Error("Названия групп сцены должны быть уникальными.");
        names.add(name);
        normalized.revision = (previous.find((entry) => entry.groupId === normalized.groupId)?.revision ?? 0) + 1;
        return normalized;
      });
      const bindingChanges = reconcileDefinitionBindings(this.scene, previous, next);
      const data = { ...(this.scene.getFlag(MODULE_ID, "groupDefinitions") ?? {}), ...Object.fromEntries(next.map((entry) => [entry.groupId, entry])) };
      for (const entry of previous) if (!next.some((value) => value.groupId === entry.groupId)) data[`-=${entry.groupId}`] = null;
      for (const removed of previous.filter((entry) => !next.some((value) => value.groupId === entry.groupId))) definitions.signalCatalog = removeSignalOwner(definitions.signalCatalog ?? normalizeCatalog(this.scene.getFlag(MODULE_ID, "signalCatalog") ?? {}), `Group:${removed.groupId}`);
      const fields = { groupDefinitions: data, ...(definitions.signalCatalog ? { signalCatalog: definitions.signalCatalog } : {}),
        ...(definitions.objectBindings || bindingChanges ? { objectBindings: definitions.objectBindings ?? bindingChanges } : {}), ...(definitions.interactionCatalog ? { interactionCatalog: definitions.interactionCatalog } : {}) };
      if (this.scene.update) await this.scene.update(Object.fromEntries(Object.entries(fields).map(([key, value]) => [`flags.${MODULE_ID}.${key}`, value])));
      else for (const [key, value] of Object.entries(fields)) await this.scene.setFlag(MODULE_ID, key, value);
      return clone(result ?? next);
    });
  }
  createGroup({ name = "Новая группа", background, textColor, description, symbol } = {}) {
    return this.change((definitions) => {
      const state = defaultState();
      const entry = { ...defaultDefinition(), groupId: randomId(), groupName: unique(definitions, name, null, "groupName"), states: [state], entryStateId: state.id, background, textColor,
        ...(description !== undefined ? { description } : {}), ...(symbol !== undefined ? { symbol } : {}) };
      definitions.push(entry); return entry;
    });
  }
  updateGroup(id, patch, options = {}) { return this.change((definitions) => {
    const entry = definitions.find((value) => value.groupId === id);
    if (!entry) throw new Error("Группа не найдена.");
    if (patch.name !== undefined || patch.groupName !== undefined) entry.groupName = unique(definitions, patch.name ?? patch.groupName, id, "groupName");
    for (const key of ["background", "textColor", "description", "symbol", "entryStateId"]) if (patch[key] !== undefined) entry[key] = patch[key];
    return entry;
  }, { ...options, groupId: id }); }
  deleteGroup(id) { return this.change((definitions) => {
    if (!definitions.some((entry) => entry.groupId === id)) throw new Error("Группа не найдена.");
    if (getRuntimes(this.scene).some((state) => state.groupId === id && state.runId && !state.halted)) throw new Error("Сначала остановите автоматизацию удаляемой группы.");
    definitions.splice(definitions.findIndex((entry) => entry.groupId === id), 1);
  }); }
  reorderGroups(ids) { return this.change((definitions) => definitions.splice(0, definitions.length, ...reorder(definitions, ids, "groupId"))); }
  createState(groupId, { name = "Новое состояние", ...patch } = {}) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.groupId === groupId);
    if (!definition) throw new Error("Группа не найдена.");
    const state = { ...defaultState(unique(definition.states, name)), ...patch, id: randomId(), name: name.trim() };
    definition.states.push(state); return state;
  }); }
  updateState(groupId, stateId, patch, options = {}) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.groupId === groupId), state = definition?.states.find((entry) => entry.id === stateId);
    if (!state) throw new Error("Состояние не найдено.");
    const name = patch.name === undefined ? state.name : unique(definition.states, patch.name, stateId);
    Object.assign(state, clone(patch), { id: stateId, name }); return state;
  }, { ...options, groupId }); }
  deleteState(groupId, stateId) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.groupId === groupId);
    if (!definition?.states.some((entry) => entry.id === stateId)) throw new Error("Состояние не найдено.");
    if (definition.states.length === 1) throw new Error("В группе должно оставаться хотя бы одно состояние.");
    if (definition.entryStateId === stateId) throw new Error("Сначала выберите другое состояние входа группы.");
    definition.states = definition.states.filter((entry) => entry.id !== stateId);
  }); }
  reorderStates(groupId, ids) { return this.change((definitions) => {
    const definition = definitions.find((entry) => entry.groupId === groupId);
    if (!definition) throw new Error("Группа не найдена.");
    definition.states = reorder(definition.states, ids, "id");
  }); }
  transferState(from, to, stateId, { copy = true, name } = {}) { return this.change((definitions) => {
    const source = definitions.find((entry) => entry.groupId === from), destination = definitions.find((entry) => entry.groupId === to);
    const state = source?.states.find((entry) => entry.id === stateId);
    if (!state || !destination || from === to) throw new Error("Выберите состояние и другую группу.");
    if (!copy && source.states.length === 1) throw new Error("Последнее состояние группы можно скопировать, но нельзя переместить.");
    if (!copy && source.entryStateId === stateId) throw new Error("Сначала выберите другое состояние входа исходной группы.");
    const scoped = (entry) => !entry.stateIds.length || entry.stateIds.includes(stateId);
    const owned = Object.values(getObjectBindings(this.scene).bindings).some((binding) => binding.groupId === from && (
      binding.transitionScripts[stateId] || [...binding.shops, ...binding.dialogues].some(scoped)
      || binding.scripts.some((entry) => entry.stateId === stateId)));
    if (owned) throw new Error("Состояние содержит настройки объектов исходной группы. Сначала разделите или явно переназначьте объекты: другая группа не может управлять ими одновременно.");
    const next = clone(state);
    next.name = unique(destination.states, name ?? state.name);
    next.id = copy || destination.states.some((entry) => entry.id === next.id) ? randomId() : next.id;
    remapScope([next], from, to, new Map([[stateId, next.id]]));
    destination.states.push(next);
    if (!copy) { source.states = source.states.filter((entry) => entry.id !== stateId); }
    return next;
  }); }
  exportGroup(id) { requireGM(); const data = this.get(id), objects = exportObjectConfiguration(this.scene, id);
    return { format: MODULE_ID, kind: "group", version: 1, data, ...objects }; }
  exportState(groupId, id) {
    requireGM(); const data = this.get(groupId).states.find((entry) => entry.id === id);
    if (!data) throw new Error("Состояние не найдено.");
    const objects = exportObjectConfiguration(this.scene, groupId, { stateId: id });
    return { format: MODULE_ID, kind: "state", version: 1, groupId, data: clone(data), ...objects };
  }
  importGroup(envelope, { name } = {}) {
    if (envelope?.format !== MODULE_ID || envelope.kind !== "group" || envelope.version !== 1) throw new Error("Ожидается JSON группы Ширмы.");
    const source = normalizeDefinition(envelope.data);
    return this.change((definitions) => {
      const next = { ...source, groupId: randomId(), groupName: unique(definitions, name ?? source.groupName, null, "groupName"), revision: 0 };
      remapScope(next.states, source.groupId, next.groupId);
      definitions.push(next);
      Object.assign(definitions, importObjectConfiguration(this.scene, envelope, { groupId: next.groupId, sourceGroupId: source.groupId, definitions }));
      return next;
    });
  }
  importState(groupId, envelope, { name } = {}) {
    if (envelope?.format !== MODULE_ID || envelope.kind !== "state" || envelope.version !== 1) throw new Error("Ожидается JSON состояния Ширмы.");
    if (typeof envelope.groupId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(envelope.groupId)) throw new Error("В JSON состояния отсутствует ID исходной группы.");
    const source = normalizeDefinition({ ...defaultDefinition(), entryStateId: envelope.data?.id, states: [envelope.data] }).states[0];
    return this.change((definitions) => {
      const destination = definitions.find((entry) => entry.groupId === groupId);
      if (!destination) throw new Error("Группа не найдена.");
      const next = { ...source, id: randomId(), name: unique(destination.states, name ?? source.name) };
      remapScope([next], envelope.groupId, groupId, new Map([[source.id, next.id]]));
      destination.states.push(next);
      Object.assign(definitions, importObjectConfiguration(this.scene, envelope, { groupId, sourceGroupId: envelope.groupId, stateMapping: new Map([[source.id, next.id]]), definitions }));
      return next;
    });
  }
}
