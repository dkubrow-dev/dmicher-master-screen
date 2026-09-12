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
    let dispose = () => {};
    const bind = () => { dispose(); dispose = generics.help.bindSettingHelp(root, { open, entries: getScreenSettingHelp(), tabIndex: -1 }); };
    bind();
    // Mode and JSON edits replace only their parameter rows. Their new controls
    // need help too; ignore help's own inserted icons to avoid observer loops.
    const Observer = root.ownerDocument.defaultView?.MutationObserver;
    const observer = Observer ? new Observer((changes) => {
      if (changes.some((change) => [...change.addedNodes].some((node) => node.matches?.('.ms-signal-field, .ms-script-parameter-table')))) bind();
    }) : null;
    observer?.observe(root, { childList: true, subtree: true });
    bindings.set(app, () => { observer?.disconnect(); dispose(); });
  });
  const closed = hooks.on("closeApplicationV2", clear);
  return () => {
    hooks.off("renderApplicationV2", rendered); hooks.off("closeApplicationV2", closed);
    for (const app of bindings.keys()) clear(app);
  };
}
