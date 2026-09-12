import { generics } from "./generics.js";
import { MODULE_ID } from "./model.js";
export const theme = generics.theme.createWindowThemeController({
  windowClass: "dmicher-master-screen", getTheme: () => generics.appearance.getTheme()
});
export const themedClasses = (...names) => theme.classes(...names);
export const notifyError = (error) => { console.error(MODULE_ID, error); ui.notifications.error(error.message ?? String(error)); };
