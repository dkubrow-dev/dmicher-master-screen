import { text as t } from "./localization.js";
import { randomId } from "./model.js";
import { workspaceApplications, renderWorkspaceApplication } from "./workspace.js";
import { windowTargetKey, normalizeWindowTarget } from "./workspace-presets-model.js";

const elementOf = app => app?.element?.[0] ?? app?.element;
const applicationId = app => String(app?.id ?? app?.options?.id ?? app?.appId ?? "");
const documentOf = app => app?.document ?? app?.object;
const sidebarEntries = () => Object.entries(globalThis.ui ?? {}).filter(([, app]) => app?.renderPopout && app?.tabName);
const all = () => workspaceApplications().filter(app => app?.rendered && app.options?.popOut !== false && app.options?.window?.frame !== false);

/** Explicit factories may restore module windows. Stored data cannot construct arbitrary classes. */
export class WorkspaceWindowAdapter {
  constructor({ exclude = () => false, resolveDocument = uuid => globalThis.fromUuid(uuid) } = {}) {
    this.factories = new Map(); this.remembered = new Map(); this.exclude = exclude; this.resolveDocument = resolveDocument;
  }
  register(id, { match, open, accepts }) {
    if (!id || typeof match !== "function" || typeof open !== "function" || this.factories.has(id)) throw new Error("Invalid or duplicate workspace window factory");
    const factory = { match, open, accepts }; this.factories.set(String(id), factory);
    return () => { if (this.factories.get(String(id)) === factory) this.factories.delete(String(id)); };
  }
  target(app) {
    for (const [id, factory] of this.factories) {
      const matched = factory.match(app);
      if (matched && typeof matched === "object") return normalizeWindowTarget({ kind: "application", id, ...matched });
      if (matched) return { kind: "application", id: typeof matched === "string" ? matched : id };
    }
    const document = documentOf(app);
    if (document?.uuid && document.documentName) return { kind: "document", uuid: document.uuid };
    for (const [key, sidebar] of sidebarEntries()) if (app === sidebar._popout || app === sidebar.popout) return { kind: "application", id: `sidebar:${key}` };
    const id = applicationId(app);
    return id ? { kind: "application", id } : null;
  }
  list() {
    return all().filter(app => !this.exclude(app)).map(app => {
      const target = this.target(app);
      if (!target) return null;
      this.remembered.set(windowTargetKey(target), app);
      return { app, target };
    }).filter(Boolean);
  }
  capture() {
    const visible = this.list();
    const entries = visible.map(({ app, target }) => ({ id: randomId(), name: String(app.title ?? documentOf(app)?.name ?? applicationId(app)), target,
      x: Number(app.position?.left) || 0, y: Number(app.position?.top) || 0,
      width: Number(app.position?.width) || 500, height: Number(app.position?.height) || 450,
      minimized: Boolean(app.minimized ?? app._minimized), hidden: Boolean(elementOf(app)?.hidden), closeOnLeave: true }));
    const active = globalThis.ui?.activeWindow;
    const activeIndex = visible.findIndex(({ app }) => app === active || applicationId(app) === String(active));
    const topIndex = activeIndex >= 0 ? activeIndex : visible.reduce((best, value, index) => Number(elementOf(value.app)?.style?.zIndex ?? 0) > Number(elementOf(visible[best]?.app)?.style?.zIndex ?? 0) ? index : best, 0);
    return { entries, activeWindowId: entries[topIndex]?.id ?? "", sidebarTab: String(globalThis.ui?.sidebar?.activeTab ?? ""), closeUnmanaged: false };
  }
  async resolve(target, isCurrent = () => true) {
    if (!isCurrent()) return null;
    const key = windowTargetKey(target);
    const opened = this.list().find(entry => windowTargetKey(entry.target) === key)?.app;
    if (opened) return opened;
    if (target.kind === "document") {
      const document = await this.resolveDocument(target.uuid);
      if (!isCurrent()) return null;
      if (!document || document.testUserPermission && !document.testUserPermission(globalThis.game?.user, "OBSERVER")) throw new Error(t("Документ окна отсутствует или недоступен.", "The window document is missing or unavailable."));
      if (!document.sheet) throw new Error(t("У документа нет доступного окна.", "The document has no available window."));
      return document.sheet;
    }
    const factory = this.factories.get(target.id) ?? [...this.factories.values()].find(value => value.accepts?.(target.id));
    if (factory) return factory.open({ id: target.id, target, isCurrent });
    if (target.id.startsWith("sidebar:")) {
      const app = globalThis.ui?.[target.id.slice(8)];
      if (app?.renderPopout) { await app.renderPopout(); return app._popout ?? app.popout; }
    }
    const remembered = this.remembered.get(key);
    if (remembered) return remembered;
    throw new Error(t("Окно недоступно. Откройте его один раз или включите предоставляющий его модуль.", "The window is unavailable. Open it once or enable its module."));
  }
  async show(app, entry, isCurrent = () => true) {
    const newlyOpened = !app.rendered;
    await renderWorkspaceApplication(app);
    if (!isCurrent()) { if (newlyOpened && app.rendered) await app.close(); return false; }
    await app.setPosition?.({ left: entry.x, top: entry.y, width: entry.width, height: entry.height });
    if (!isCurrent()) return false;
    if (entry.minimized) await app.minimize?.(); else await app.maximize?.();
    if (!isCurrent()) return false;
    const element = elementOf(app); if (element) element.hidden = entry.hidden;
    return true;
  }
  async close(app) { if (app?.rendered) await app.close(); }
  async activate(app) { if (app?.rendered) await app.bringToFront?.(); }
  async sidebar(tab) { if (tab && globalThis.ui?.sidebar?.activateTab) await ui.sidebar.activateTab(tab); }
  storageKey() { return `dmicher-master-screen:workspace:${globalThis.game?.world?.id ?? "world"}:${globalThis.game?.user?.id ?? "user"}`; }
  loadActive() { try { return JSON.parse(globalThis.localStorage?.getItem(this.storageKey()) ?? "null"); } catch { return null; } }
  saveActive(value) {
    try { if (value) globalThis.localStorage?.setItem(this.storageKey(), JSON.stringify(value)); else globalThis.localStorage?.removeItem(this.storageKey()); } catch { /* Presentation also works when browser storage is unavailable. */ }
  }
  dispose() { this.remembered.clear(); this.factories.clear(); }
}
