import { text as t } from "./localization.js";
import { message as localizedMessage } from "./localization.js";
import { MODULE_ID } from "./model.js";
const ROOT = "screen-menu";
export function buildControls(controller) {

  const definitions = [
    ["help", t("Справка", "Help"), "fa-solid fa-circle-question", () => controller.openHelp()],
    ["screen", t("Ширма", "Master screen"), "fa-solid fa-table-columns", () => controller.toggleScreen()],
    ["states", t("Сменить состояние", "Change state"), "fa-solid fa-diagram-project", () => controller.openStateChooser()],
    ["start", t("Старт", "Start"), "fa-solid fa-play", () => controller.startAll()],
    ["stop", t("Стоп", "Stop"), "fa-solid fa-stop", () => controller.haltAll()]
  ];
  return { name: MODULE_ID, title: localizedMessage("▥ Ширма мастера"), icon: "fa-solid fa-chalkboard", order: 91,
    visible: game.user?.isGM === true, activeTool: ROOT,
    tools: Object.fromEntries([[ROOT, { name: ROOT, title: localizedMessage("Ширма мастера"), visible: false, button: false, order: -1, onChange: () => {} }],
      ...definitions.map(([name, title, icon, action], order) => [name, {
        name, title, icon, order, visible: true, button: name !== "screen", toggle: name === "screen",
        active: name === "screen" && Boolean(controller.isScreenOpen?.()),
        onChange: () => { if (game.user?.isGM) void Promise.resolve().then(action).catch((error) => ui.notifications.error(error.message)); }
      }])]) };
}
export function installControls(controller) {
  const id = Hooks.on("getSceneControlButtons", (controls) => { controls[MODULE_ID] = buildControls(controller); });
  return () => Hooks.off("getSceneControlButtons", id);
}
