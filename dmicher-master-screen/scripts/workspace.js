import { MODULE_ID } from "./model.js";
import { asArray, getRuntime } from "./store.js";
import { isExecutionHalted } from "./execution.js";

const allowed = new Set(["Actor", "Item", "JournalEntry", "JournalEntryPage", "RollTable"]);
const writes = new WeakMap();
const apps = () => [...new Set([...asArray(foundry.applications?.instances), ...Object.values(ui.windows ?? {})])];
const descriptor = (app) => ({ uuid: app.document?.uuid ?? app.object?.uuid,
  x: Number(app.position?.left) || 0, y: Number(app.position?.top) || 0,
  width: Number(app.position?.width) || 500, height: Number(app.position?.height) || 450 });

async function renderSheet(app) {
  if (app.rendered) return;
  if (app.addEventListener) { await app.render(true); return; }
  // ApplicationV1.render returns the instance before its asynchronous HTML is ready.
  let hook, timer;
  try {
    await new Promise((resolve, reject) => {
      hook = Hooks.on("renderApplication", (rendered) => { if (rendered === app) resolve(); });
      timer = setTimeout(() => reject(new Error("Окно не завершило открытие за 10 секунд")), 10000);
      try {
        const result = app.render(true);
        if (result?.then) result.then(resolve, reject);
        else if (app.rendered) resolve();
      } catch (error) { reject(error); }
    });
  } finally { clearTimeout(timer); if (hook !== undefined) Hooks.off("renderApplication", hook); }
}

/** Only explicit document sheets; no arbitrary window serialization or prototype changes. */
export class WorkspaceManager {
  constructor({ isolated = false } = {}) {
    this.isolated = isolated; this.groups = new Map();
    this.slots = new Map(); this.generation = 0; this.saving = Promise.resolve(); this.lifecycle = Promise.resolve();
    this.activeKey = null; this.activeRunId = ""; this.requestedKey = null; this.requestedRunId = "";
    this.activePlan = [];
  }
  capture() {
    return apps().filter((app) => app.rendered && allowed.has((app.document ?? app.object)?.documentName))
      .map(descriptor).filter((entry) => entry.uuid);
  }
  key(scene, state) { return `${scene.id}:${state.groupId ?? "main"}`; }
  async persist(key, runId, entries) {
    const snapshot = structuredClone(entries);
    const user = game.user;
    this.saving = (writes.get(user) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const records = structuredClone(user.getFlag(MODULE_ID, "workspaces") ?? {});
      records[key] = { runId, entries: snapshot };
      await user.setFlag(MODULE_ID, "workspaces", records);
    });
    writes.set(user, this.saving);
    return this.saving;
  }
  entries(key) {
    const entries = new Map((this.activeKey === key ? this.activePlan : []).map((entry) => [entry.uuid, { ...entry }]));
    for (const slot of this.slots.values()) if (slot.key === key) {
      const entry = { ...descriptor(slot.app), closed: slot.closed || !slot.app.rendered };
      entries.set(entry.uuid, entry);
    }
    return [...entries.values()];
  }
  remember(key, runId) {
    return this.persist(key, runId, this.entries(key));
  }
  queue(task) {
    this.lifecycle = this.lifecycle.catch(() => {}).then(task);
    return this.lifecycle;
  }
  apply(scene, state = getRuntime(scene)) {
    if (!this.isolated && state.groupId !== "main") {
      const key = this.key(scene, state);
      if (!this.groups.has(key)) this.groups.set(key, new WorkspaceManager({ isolated: true }));
      return this.groups.get(key).apply(scene, state);
    }
    if (!this.isolated) for (const [key, manager] of this.groups) if (!key.startsWith(`${scene?.id}:`)) {
      void manager.close(); this.groups.delete(key);
    }
    if (scene && isExecutionHalted(scene, state)) {
      this.generation++;
      // Keep already visible sheets and their geometry; invalidate pending presentations.
      return this.lifecycle;
    }
    const key = scene && state.state && state.runId ? this.key(scene, state) : null;
    const runId = key ? state.runId : "";
    if (this.requestedKey === key && this.requestedRunId === runId) return this.lifecycle;
    this.requestedKey = key; this.requestedRunId = runId;
    const generation = ++this.generation;
    const current = () => {
      const actual = scene ? getRuntime(scene, { groupId: state.groupId }) : null;
      return generation === this.generation && (!key || (globalThis.canvas?.scene?.id === scene.id && actual.runId === runId && !isExecutionHalted(scene, actual)));
    };
    return this.queue(async () => {
      if (!current()) return;
      // Read current positions before the old scene's sheets are closed, including legacy sheets.
      if (this.activeKey) await this.remember(this.activeKey, this.activeRunId);
      if (!current()) return;
      await this.release(current);
      if (!current()) return;
      this.activeKey = null; this.activeRunId = ""; this.activePlan = [];
      if (!key || !current()) return;
      const saved = game.user.getFlag(MODULE_ID, "workspaces")?.[key];
      const audience = game.user.isGM ? "gm" : "players";
      const source = saved?.runId === runId ? saved.entries : state.state.workspace?.[audience] ?? [];
      const plan = [...new Map(source.map((entry) => [entry.uuid, structuredClone(entry)])).values()];
      const failures = [];
      this.activeKey = key; this.activeRunId = runId;
      this.activePlan = plan;
      for (const entry of plan) {
        if (!current()) return;
        if (entry.closed) continue;
        try {
          const document = await fromUuid(entry.uuid);
          if (!current()) return;
          if (!allowed.has(document?.documentName) || !document.testUserPermission(game.user, "OBSERVER")) continue;
          const app = document.sheet;
          if (!app) continue;
          const owned = !app.rendered;
          await renderSheet(app);
          // Presentation is serialized: a newer lifecycle cannot own this sheet yet.
          if (!current()) { if (owned) await app.close(); return; }
          app.setPosition({ left: entry.x, top: entry.y, width: entry.width, height: entry.height });
          const slot = { app, key, owned, closed: false };
          const remember = () => { void this.remember(key, runId).catch((error) => console.warn(MODULE_ID, error)); };
          const close = () => { slot.closed = true; remember(); };
          app.addEventListener?.("position", remember);
          app.addEventListener?.("close", close);
          // ApplicationV1 has no EventEmitter API; observe only its own geometry, without patching it.
          let observer, closeHook;
          if (!app.addEventListener) {
            const element = app.element?.[0] ?? app.element;
            if (element && globalThis.MutationObserver) {
              observer = new MutationObserver(remember);
              observer.observe(element, { attributes: true, attributeFilter: ["style"] });
            }
            closeHook = globalThis.Hooks?.on("closeApplication", (closed) => { if (closed === app) close(); });
          }
          slot.dispose = () => {
            app.removeEventListener?.("position", remember); app.removeEventListener?.("close", close);
            observer?.disconnect();
            if (closeHook !== undefined) Hooks.off("closeApplication", closeHook);
          };
          this.slots.set(entry.uuid, slot);
        } catch (error) { failures.push(`${entry.uuid}: ${error.message}`); }
      }
      if (current()) await this.remember(key, runId);
      if (failures.length) ui.notifications.warn(`Рабочие окна: ${failures.join("; ")}`);
    });
  }
  async release(current = () => true) {
    for (const [uuid, slot] of [...this.slots]) {
      if (!current()) return;
      this.slots.delete(uuid);
      slot.dispose();
      if (slot.owned && slot.app.rendered) {
        try { await slot.app.close(); } catch (error) { ui.notifications.warn(`Не удалось закрыть окно: ${error.message}`); }
      }
    }
  }
  close() {
    const children = [...this.groups.values()].map((manager) => manager.close()); this.groups.clear();
    this.generation++;
    const scene = globalThis.canvas?.scene, groupId = this.activeKey?.split(":")[1] ?? "main", state = getRuntime(scene, { groupId });
    const key = scene && state.runId ? this.key(scene, state) : null;
    this.requestedKey = key; this.requestedRunId = state.runId;
    return this.queue(async () => {
      await Promise.all(children);
      if (this.activeKey) await this.remember(this.activeKey, this.activeRunId);
      if (key) {
        const saved = game.user.getFlag(MODULE_ID, "workspaces")?.[key];
        const audience = game.user.isGM ? "gm" : "players";
        const plan = saved?.runId === state.runId ? saved.entries : state.state?.workspace?.[audience] ?? [];
        await this.persist(key, state.runId, plan.map((entry) => ({ ...entry, closed: true })));
      }
      await this.release();
      this.activeKey = null; this.activeRunId = ""; this.activePlan = [];
    });
  }
}
