import { isSceneObjectHidden } from "./scene-object-geometry.js";

/** Note has no native hidden field in supported Foundry generations. Its narrow
 * override is stored on that document and applied after native refresh on every
 * client; journal permission and native vision remain independent restrictions. */
export function installCommandNoteVisibility() {
  const hooks = [], refresh = object => {
    const document = object?.document ?? object, placeable = document?.object ?? object;
    if (!placeable || placeable.destroyed) return;
    placeable.visible = !isSceneObjectHidden(document) && placeable.isVisible !== false;
  };
  const on = (name, callback) => hooks.push([name, Hooks.on(name, callback)]);
  on("refreshNote", refresh); on("updateNote", refresh);
  const all = () => { for (const document of globalThis.canvas?.scene?.notes?.values?.() ?? []) refresh(document); };
  on("canvasReady", all); all();
  return () => { for (const [name, id] of hooks) Hooks.off(name, id); };
}
