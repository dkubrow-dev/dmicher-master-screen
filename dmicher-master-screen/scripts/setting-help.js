import { generics } from "./generics.js";
import { getScreenSettingHelp } from "./help-content.js";

/** Labels are attached to the current render only; module content stays in Master screen. */
export function installScreenSettingHelp(open, hooks = globalThis.Hooks) {
  const bindings = new Map();
  const clear = app => { bindings.get(app)?.(); bindings.delete(app); };
  const rendered = hooks.on("renderApplicationV2", (app, html) => {
    clear(app);
    const root = generics.windows.getRenderedElement(app) ?? generics.windows.getRenderedElement(html);
    if (!root?.classList?.contains("dmicher-master-screen")) return;
    bindings.set(app, generics.help.bindSettingHelp(root, { open, entries: getScreenSettingHelp(), tabIndex: -1 }));
  });
  const closed = hooks.on("closeApplicationV2", clear);
  return () => {
    hooks.off("renderApplicationV2", rendered); hooks.off("closeApplicationV2", closed);
    for (const app of bindings.keys()) clear(app);
  };
}
