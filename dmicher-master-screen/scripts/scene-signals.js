import { asArray, isAuthority } from "./store.js";
import { sceneUuid } from "./builtin-signals.js";

/** Observe Foundry's existing user state. Navigation renders after userActivity has
 * applied viewedScene in both supported versions; reconnect does not replay a start. */
export function installSceneSignals(signals, { hooks = globalThis.Hooks, onError = console.error } = {}) {
  const ids = [], presence = new Map();
  const emit = (scene, name, parameters) => {
    if (!scene || !isAuthority()) return;
    void Promise.resolve().then(() => signals.emit(scene, { emitterKey: `Scene:${scene.id}`, name, parameters })).catch(onError);
  };
  const snapshot = (notify) => {
    for (const user of asArray(game.users)) {
      const previous = presence.get(user.id) ?? null, next = user.active ? user.viewedScene ?? null : null;
      presence.set(user.id, next);
      if (!notify || previous === next) continue;
      const userUuid = user.uuid ?? `User.${user.id}`;
      for (const [id, name] of [[previous, "userLeft"], [next, "userEntered"]]) {
        const scene = game.scenes?.get(id);
        if (scene) emit(scene, name, { sceneUuid: sceneUuid(scene), userUuid });
      }
    }
  };
  snapshot(false);
  const on = (name, fn) => ids.push([name, hooks.on(name, fn)]);
  on("updateScene", (scene, changes) => { if (changes.active === true) emit(scene, "activated", {}); });
  for (const name of ["renderSceneNavigation", "canvasReady", "userConnected"]) on(name, () => snapshot(true));
  on("pauseGame", (paused) => {
    const scene = globalThis.canvas?.scene;
    if (scene) emit(scene, "pauseChanged", { sceneUuid: sceneUuid(scene), paused });
  });
  return () => { for (const [name, id] of ids) hooks.off(name, id); presence.clear(); };
}
