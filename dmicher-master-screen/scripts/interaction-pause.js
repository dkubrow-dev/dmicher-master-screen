import { getRuntimes } from "./store.js";
import { objectReferenceKey } from "./object-reference.js";
import { shopSessionIsLive, dialogueSessionIsLive } from "./interaction-session-model.js";

const pending = new WeakMap();

/** An authenticated admission claims this before joining the scene queue. An old
 * movement may finish, but no following movement may race the geometry check. */
export function beginInteractionPause(scene, target) {
  const key = objectReferenceKey(target);
  if (!scene || !key) return () => {};
  let counts = pending.get(scene); if (!counts) pending.set(scene, counts = new Map());
  counts.set(key, (counts.get(key) ?? 0) + 1);
  let released = false;
  return () => { if (released) return; released = true;
    const count = (counts.get(key) ?? 1) - 1;
    if (count) counts.set(key, count); else counts.delete(key);
    if (!counts.size) pending.delete(scene);
  };
}

export function isInteractionPaused(scene, target, now = Date.now()) {
  const objectKey = objectReferenceKey(target);
  if (!objectKey) return false;
  if (pending.get(scene)?.get(objectKey)) return true;
  return getRuntimes(scene).some((runtime) => {
    const ownsSession = (session) => session?.runId === runtime.runId && objectReferenceKey(session.target) === objectKey;
    return Object.values(runtime.shopSessions ?? {}).some((session) => shopSessionIsLive(session, now) && ownsSession(session))
      || Object.values(runtime.dialogueSessions ?? {}).some((session) => dialogueSessionIsLive(session, now) && ownsSession(session));
  });
}

/** Caller owns the scene lock. Mark the first pause so the resume tick consumes no elapsed time. */
export function freezeInteractionClock(state, target, now = Date.now()) {
  const key = objectReferenceKey(target);
  if (!key) return;
  state.interactionClocks ??= {};
  state.interactionClocks[key] ??= { pausedAt: now };
}
