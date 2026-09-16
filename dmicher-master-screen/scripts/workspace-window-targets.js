import { text as t } from "./localization.js";
import { workspaceApplications } from "./workspace.js";

const appId = app => String(app?.id ?? app?.options?.id ?? "");
/** Explicit module APIs keep replay independent of stored class names and internals. */
export function registerKnownWorkspaceWindows(controller, adapter) {
  const disposers = [];
  const fixed = (id, open) => disposers.push(adapter.register(id, { match: app => appId(app) === id,
    open: async ({ isCurrent }) => {
      if (!isCurrent()) return null;
      const app = await open();
      return app ?? workspaceApplications().find(candidate => appId(candidate) === id);
    } }));
  fixed("dmicher-master-screen-help", () => controller.openHelp());
  fixed("dmicher-master-screen-shops", () => controller.openShops());
  fixed("dmicher-master-screen-dialogue-catalog", () => controller.openDialogues());
  disposers.push(adapter.register("dmicher-master-screen-automation", {
    match: app => [...(controller.objectWindows?.values() ?? [])].includes(app) && app.sceneId && app.descriptor
      ? { uuid: `Scene.${app.sceneId}.${app.descriptor.type}.${app.descriptor.id}` } : false,
    open: ({ target, isCurrent }) => {
      if (!isCurrent()) return null;
      const match = /^Scene\.([A-Za-z0-9_-]+)\.([A-Za-z]+)\.([A-Za-z0-9_-]+)$/.exec(target.uuid ?? "");
      if (!match || match[1] !== globalThis.canvas?.scene?.id) throw new Error(t("Окно автоматизации относится к другой сцене. Откройте нужную карту.", "The automation window belongs to another scene. Open that map first."));
      return controller.openObjectAutomation({ type: match[2], id: match[3] });
    }
  }));
  const spotlight = (method, ...args) => {
    const module = game.modules?.get("dmicher-spotlight-tools"), api = module?.active && module.api;
    if (typeof api?.[method] !== "function") throw new Error(t("Для этого окна включите Spotlight.", "Enable Spotlight to open this window."));
    return api[method](...args);
  };
  for (const [id, method] of [["active-requests", "openActiveRequests"], ["focus-audit", "openFocusAudit"], ["focus-audit-settings", "openFocusAuditSettings"],
    ["timer-manager", "openTimers"], ["poll-manager", "openPolls"], ["stopwatch", "openStopwatch"], ["request-help", "openHelp"],
    ["request-settings", "openRequestSettings"], ["request-master-settings", "openRequestMasterSettings"], ["thank-author", "openThankAuthor"]]) {
    fixed(`dmicher-spotlight-tools-${id}`, () => spotlight(method));
  }
  for (const [type, method] of [["timer", "openTimer"], ["poll-launch", "openPollLaunch"]]) {
    const prefix = `dmicher-spotlight-tools-${type}-`, accepts = id => id.startsWith(prefix) && /^[A-Za-z0-9_-]{1,64}$/.test(id.slice(prefix.length));
    disposers.push(adapter.register(`spotlight-${type}`, { accepts, match: app => accepts(appId(app)) ? appId(app) : false,
      open: async ({ id, isCurrent }) => {
        if (!isCurrent()) return null;
        const app = await spotlight(method, id.slice(prefix.length));
        return app ?? workspaceApplications().find(candidate => appId(candidate) === id);
      } }));
  }
  return () => disposers.forEach(dispose => dispose());
}
