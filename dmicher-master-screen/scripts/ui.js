import { generics } from "./generics.js";
import { MODULE_ID } from "./model.js";
import { debugError } from "./debug.js";
import { diagnosticError } from "./diagnostics.js";
export const theme = generics.theme.createWindowThemeController({
  windowClass: "dmicher-master-screen", getTheme: () => generics.appearance.getTheme()
});
export const themedClasses = (...names) => theme.classes(...names);
export const notifyError = (error, context = { sceneId: globalThis.canvas?.scene?.id }) => {
  debugError("interface", "failed", error, context);
  console.error(MODULE_ID, error); globalThis.ui?.notifications?.error?.(diagnosticError(error).message);
};
