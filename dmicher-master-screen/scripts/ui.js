import { generics } from "./generics.js";
import { MODULE_ID } from "./model.js";
export const theme = generics.theme.createWindowThemeController({
  windowClass: "dmicher-master-screen", getTheme: () => game.settings.get(MODULE_ID, "theme")
});
export const themedClasses = (...names) => theme.classes(...names);
export const localize = (key) => game.i18n.localize(`DMICHERMASTERSCREEN.${key}`);
export const notifyError = (error) => { console.error(MODULE_ID, error); ui.notifications.error(error.message ?? String(error)); };
