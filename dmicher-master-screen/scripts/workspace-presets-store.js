import { MODULE_ID, randomId } from "./model.js";
import { requireGM, withSceneLock } from "./store.js";
import { writeSceneFlags } from "./scene-flags.js";
import { text as t } from "./localization.js";
import { normalizeWorkspacePreset, normalizeWorkspacePresets, requirePresetKind } from "./workspace-presets-model.js";

export const WORKSPACE_PRESETS_FLAG = "workspacePresets";
export function getWorkspacePresets(scene) { return normalizeWorkspacePresets(scene?.getFlag?.(MODULE_ID, WORKSPACE_PRESETS_FLAG) ?? {}); }

/** Scene preparation only. Applying a preset does not edit its saved definition. */
export class WorkspacePresetStore {
  constructor(scene) { this.scene = scene; }
  list(kind) { const catalog = getWorkspacePresets(this.scene); return kind ? catalog[requirePresetKind(kind)] : catalog; }
  find(kind, idOrName) { return this.list(kind).find(entry => entry.id === idOrName) ?? this.list(kind).find(entry => entry.name === idOrName) ?? null; }
  async change(operation, { expectedRevision } = {}) {
    return withSceneLock(this.scene, async () => {
      requireGM();
      const current = this.list();
      if (expectedRevision !== undefined && expectedRevision !== current.revision) throw new Error(t("Конфигурации изменены другим окном. Обновите данные перед сохранением.", "Configurations changed in another window. Refresh before saving."));
      const result = operation(current);
      const next = normalizeWorkspacePresets({ ...current, revision: current.revision + 1 });
      await writeSceneFlags(this.scene, { [WORKSPACE_PRESETS_FLAG]: next });
      return structuredClone(result);
    });
  }
  save(kind, value, options) {
    const next = normalizeWorkspacePreset(kind, value);
    return this.change(catalog => {
      const index = catalog[kind].findIndex(entry => entry.id === next.id);
      if (index < 0) catalog[kind].push(next); else catalog[kind][index] = next;
      return next;
    }, options);
  }
  remove(kind, id, options) {
    requirePresetKind(kind);
    return this.change(catalog => {
      const index = catalog[kind].findIndex(entry => entry.id === id);
      if (index < 0) throw new Error(t("Конфигурация больше не существует.", "The configuration no longer exists."));
      catalog[kind].splice(index, 1); return true;
    }, options);
  }
  export(kind, id) {
    requireGM(); const value = this.find(kind, id);
    if (!value) throw new Error(t("Конфигурация больше не существует.", "The configuration no longer exists."));
    return { format: MODULE_ID, kind: `workspace-${kind}`, version: 1, data: structuredClone(value) };
  }
  import(kind, envelope, options) {
    requirePresetKind(kind);
    if (envelope?.format !== MODULE_ID || envelope.kind !== `workspace-${kind}` || envelope.version !== 1) throw new Error(t("Выберите JSON соответствующей конфигурации Ширмы.", "Choose a matching Screen configuration JSON file."));
    const value = normalizeWorkspacePreset(kind, { ...envelope.data, id: randomId() });
    if (kind === "notes") for (const entry of value.entries) { entry.sourceId = ""; entry.sourceSceneId = ""; }
    return this.save(kind, value, options);
  }
}
