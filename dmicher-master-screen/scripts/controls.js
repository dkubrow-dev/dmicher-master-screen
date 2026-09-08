import { MODULE_ID } from "./model.js";
const ROOT = "screen-menu";
export function buildControls(controller) {
  const definitions = [
    ["help", "Справка", "fa-solid fa-circle-question", () => controller.openHelp()],
    ["panel", "Ширма (панель)", "fa-solid fa-table-columns", () => controller.openScreen("panel")],
    ["window", "Ширма (окно)", "fa-solid fa-up-right-from-square", () => controller.openScreen("window")]
  ];
  return { name: MODULE_ID, title: "▥ Ширма мастера", icon: "fa-solid fa-chalkboard", order: 91,
    visible: game.user?.isGM === true, activeTool: ROOT,
    tools: Object.fromEntries([[ROOT, { name: ROOT, title: "Ширма мастера", visible: false, button: false, order: -1, onChange: () => {} }],
      ...definitions.map(([name, title, icon, action], order) => [name, {
        name, title, icon, order, visible: true, button: true,
        onChange: () => { if (game.user?.isGM) void Promise.resolve().then(action).catch((error) => ui.notifications.error(error.message)); }
      }])]) };
}
export function installControls(controller) {
  const id = Hooks.on("getSceneControlButtons", (controls) => { controls[MODULE_ID] = buildControls(controller); });
  return () => Hooks.off("getSceneControlButtons", id);
}
