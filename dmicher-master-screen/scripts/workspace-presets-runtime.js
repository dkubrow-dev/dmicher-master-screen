import { MODULE_ID, randomId } from "./model.js";
import { requireGM, asArray } from "./store.js";
import { text as t } from "./localization.js";
import { WorkspacePresetStore } from "./workspace-presets-store.js";
import { normalizeNoteEntry, normalizeWorkspacePreset, requirePresetKind, windowTargetKey } from "./workspace-presets-model.js";
import { WorkspaceWindowAdapter } from "./workspace-window-adapter.js";

const markerOf = note => note?.getFlag?.(MODULE_ID, "workspacePreset") ?? note?.flags?.[MODULE_ID]?.workspacePreset;
const ownedBy = (note, presetId, entryId) => { const marker = markerOf(note); return marker?.version === 1 && marker.presetId === presetId && (!entryId || marker.entryId === entryId); };
export const WORKSPACE_NOTES_RUNTIME_FLAG = "workspaceNotesRuntime";
const noteData = (preset, entry) => ({ ...structuredClone(entry.data), flags: {
  ...structuredClone(entry.data.flags ?? {}), [MODULE_ID]: { ...structuredClone(entry.data.flags?.[MODULE_ID] ?? {}), workspacePreset: { version: 1, presetId: preset.id, entryId: entry.id } }
} });

/** Explicit preparation capture and one serialized presentation lane per resource kind.
 * No render hooks, scene polling, or automatic reapplication after manual changes. */
export class WorkspacePresetsRuntime {
  constructor({ windows = new WorkspaceWindowAdapter(), onChange = () => {}, onError = error => globalThis.ui?.notifications?.warn?.(error.message) } = {}) {
    this.windows = windows; this.onChange = onChange; this.onError = onError;
    this.lanes = new Map(); this.active = new Map(); this.disposed = false;
  }
  laneKey(scene, kind) { return kind === "windows" ? kind : `notes:${scene.id}`; }
  previous(scene, kind) {
    const key = this.laneKey(scene, kind), existing = this.active.get(key);
    if (existing) return existing;
    if (kind === "windows") {
      const saved = this.windows.loadActive?.();
      if (!saved?.preset) return null;
      let preset; try { preset = normalizeWorkspacePreset(kind, saved.preset); } catch { return null; }
      const apps = new Map(this.windows.list().map(({ app, target }) => [windowTargetKey(target), app]));
      const state = { sceneId: saved.sceneId, preset, apps }; this.active.set(key, state); return state;
    }
    const saved = scene.getFlag(MODULE_ID, WORKSPACE_NOTES_RUNTIME_FLAG);
    if (!saved?.presetId || !Array.isArray(saved.entries)) return null;
    const entries = saved.entries.filter(entry => entry?.id && entry?.noteId);
    const state = { sceneId: scene.id, preset: { id: saved.presetId, entries }, notes: new Map(entries.map(entry => [entry.id, entry.noteId])) };
    this.active.set(key, state); return state;
  }
  activePreset(scene, kind) { const state = this.previous(scene, requirePresetKind(kind)); return state?.sceneId === scene.id ? state?.preset?.id ?? null : null; }
  capture(scene, kind, { id = randomId(), name = t("Новая конфигурация", "New configuration") } = {}) {
    requireGM(); requirePresetKind(kind);
    if (!scene) throw new Error(t("Сначала откройте сцену.", "Open a scene first."));
    if (kind === "windows") return { id, name, ...this.windows.capture() };
    return { id, name, entries: asArray(scene.notes).map(note => normalizeNoteEntry({ id: randomId(), name: note.text ?? note.name ?? "", sourceId: note.id,
      sourceSceneId: scene.id, removeOnLeave: true, data: note.toObject ? note.toObject() : structuredClone(note._source ?? note) })) };
  }
  request(scene, kind, operation, isCurrent = () => true) {
    requireGM(); requirePresetKind(kind);
    if (this.disposed || !scene) return Promise.reject(new Error(t("Конфигурация больше недоступна.", "The configuration is no longer available.")));
    const key = this.laneKey(scene, kind), previous = this.lanes.get(key), generation = (previous?.generation ?? 0) + 1;
    const lane = { generation, promise: null }; this.lanes.set(key, lane);
    const current = () => !this.disposed && this.lanes.get(key) === lane && isCurrent() && globalThis.game?.user?.isGM
      && (!globalThis.canvas?.scene || globalThis.canvas.scene.id === scene.id);
    lane.promise = (previous?.promise ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!current()) return false;
      const result = await operation(current, key);
      if (current()) this.onChange({ kind, sceneId: scene.id, presetId: this.activePreset(scene, kind) });
      return result;
    });
    return lane.promise;
  }
  activate(scene, kind, idOrName, { isCurrent = () => true } = {}) {
    return this.request(scene, kind, async (current, key) => {
      const preset = new WorkspacePresetStore(scene).find(kind, idOrName);
      if (!preset) throw new Error(t("Конфигурация больше не существует.", "The configuration no longer exists."));
      return kind === "windows" ? this.applyWindows(scene, preset, current, key) : this.applyNotes(scene, preset, current, key);
    }, isCurrent);
  }
  deactivate(scene, kind, { isCurrent = () => true } = {}) {
    return this.request(scene, kind, async (current, key) => {
      const previous = this.previous(scene, kind); if (!previous) return true;
      if (kind === "windows") {
        for (const entry of previous.preset.entries) {
          if (!current()) return false;
          if (entry.closeOnLeave) await this.windows.close(previous.apps.get(windowTargetKey(entry.target)));
        }
      } else await this.releaseNotes(scene, previous, new Set(), current);
      if (!current()) return false;
      this.active.delete(key);
      if (kind === "windows") this.windows.saveActive?.(null);
      else await scene.setFlag(MODULE_ID, WORKSPACE_NOTES_RUNTIME_FLAG, { presetId: "", entries: [] });
      return current();
    }, isCurrent);
  }
  async applyWindows(scene, preset, current, key) {
    const previous = this.previous(scene, "windows"), destination = new Set(preset.entries.map(entry => windowTargetKey(entry.target)));
    const original = this.windows.list(), prepared = new Map(), failures = [];
    // Resolve before closing anything. Missing references leave the previous workspace intact.
    for (const entry of preset.entries) {
      if (!current()) return false;
      try {
        const app = await this.windows.resolve(entry.target, current);
        if (!current()) {
          if (app && !original.some(value => value.app === app)) await this.windows.close(app);
          return false;
        }
        if (!app) throw new Error(t("Окно недоступно.", "The window is unavailable."));
        prepared.set(windowTargetKey(entry.target), app);
      } catch (error) { failures.push(`${entry.name || windowTargetKey(entry.target)}: ${error.message}`); }
    }
    if (!current()) return false;
    if (failures.length) throw new Error(failures.join("\n"));
    const previousTargets = new Set(previous?.preset.entries.map(entry => windowTargetKey(entry.target)) ?? []);
    for (const entry of previous?.preset.entries ?? []) {
      if (!current()) return false;
      const target = windowTargetKey(entry.target);
      if (entry.closeOnLeave && !destination.has(target)) await this.windows.close(previous.apps.get(target));
    }
    if (preset.closeUnmanaged) for (const { app, target } of original) {
      if (!current()) return false;
      const identity = windowTargetKey(target);
      if (!previousTargets.has(identity) && !destination.has(identity)) await this.windows.close(app);
    }
    const state = { sceneId: scene.id, preset: structuredClone(preset), apps: prepared };
    this.active.set(key, state);
    for (const entry of preset.entries) {
      if (!current()) return false;
      if (!await this.windows.show(prepared.get(windowTargetKey(entry.target)), entry, current)) return false;
    }
    if (!current()) return false;
    await this.windows.sidebar(preset.sidebarTab);
    if (!current()) return false;
    const active = preset.entries.find(entry => entry.id === preset.activeWindowId);
    if (active && !active.hidden && !active.minimized) await this.windows.activate(prepared.get(windowTargetKey(active.target)));
    if (current()) this.windows.saveActive?.({ sceneId: scene.id, preset });
    return current();
  }
  noteForEntry(scene, preset, entry) {
    const notes = asArray(scene.notes);
    return notes.find(note => ownedBy(note, preset.id, entry.id))
      ?? (entry.sourceSceneId === scene.id && entry.sourceId ? notes.find(note => note.id === entry.sourceId) : null);
  }
  async releaseNotes(scene, previous, retainedIds, current) {
    const ids = previous.preset.entries.filter(entry => entry.removeOnLeave).flatMap(entry => {
      const id = previous.notes.get(entry.id), note = asArray(scene.notes).find(item => item.id === id);
      return note && ownedBy(note, previous.preset.id, entry.id) && !retainedIds.has(id) ? [id] : [];
    });
    if (ids.length && current()) await scene.deleteEmbeddedDocuments("Note", ids);
  }
  async applyNotes(scene, preset, current, key) {
    const previous = this.previous(scene, "notes"), retained = new Map(), updates = [], creates = [];
    for (const entry of preset.entries) {
      const journal = entry.data.entryId && globalThis.game?.journal;
      if (journal && !journal.get(entry.data.entryId)) throw new Error(t("Журнал заметки больше не существует.", "The note's journal no longer exists."));
      const note = this.noteForEntry(scene, preset, entry);
      if (note) { retained.set(entry.id, note.id); updates.push({ ...noteData(preset, entry), _id: note.id }); }
      else creates.push({ entry, data: noteData(preset, entry) });
    }
    if (!current()) return false;
    if (previous) await this.releaseNotes(scene, previous, new Set(retained.values()), current);
    if (!current()) return false;
    if (updates.length) await scene.updateEmbeddedDocuments("Note", updates);
    if (!current()) return false;
    if (creates.length) {
      const created = await scene.createEmbeddedDocuments("Note", creates.map(value => value.data));
      for (const note of created) {
        const marker = markerOf(note);
        if (marker?.presetId === preset.id) retained.set(marker.entryId, note.id);
      }
      if (!current()) {
        // A submitted Foundry create cannot be physically cancelled. Retire only its own result.
        const ids = created.filter(note => ownedBy(note, preset.id)).map(note => note.id);
        if (ids.length) await scene.deleteEmbeddedDocuments("Note", ids);
        return false;
      }
    }
    if (!current()) return false;
    this.active.set(key, { sceneId: scene.id, preset: structuredClone(preset), notes: retained });
    await scene.setFlag(MODULE_ID, WORKSPACE_NOTES_RUNTIME_FLAG, { presetId: preset.id,
      entries: preset.entries.map(entry => ({ id: entry.id, noteId: retained.get(entry.id), removeOnLeave: entry.removeOnLeave })) });
    return current();
  }
  cancel(scene, kind) {
    const key = this.laneKey(scene, requirePresetKind(kind)), previous = this.lanes.get(key);
    if (previous) this.lanes.set(key, { generation: previous.generation + 1, promise: previous.promise });
  }
  dispose() {
    this.disposed = true; this.active.clear(); this.windows.dispose();
    // Closing Screen or reloading never destroys already presented notes or windows.
  }
}
