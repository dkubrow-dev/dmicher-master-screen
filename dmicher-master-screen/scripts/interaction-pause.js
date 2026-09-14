import { MODULE_ID } from "./model.js";
import { objectReferenceKey } from "./object-reference.js";
import { shopSessionIsLive, dialogueSessionIsLive, dialogueSessionMatchesReference } from "./interaction-session-model.js";
import { notifyExecutionChange } from "./execution.js";

const pending = new WeakMap();

/** An authenticated admission claims this before joining the scene queue. An old
 * movement may finish, but no following movement may race the geometry check. */
export function beginInteractionPause(scene, target) {
  const key = objectReferenceKey(target);
  if (!scene || !key) return () => {};
  let counts = pending.get(scene); if (!counts) pending.set(scene, counts = new Map());
  counts.set(key, (counts.get(key) ?? 0) + 1);
  notifyExecutionChange(scene, "interaction-admission");
  let released = false;
  return () => { if (released) return; released = true;
    const count = (counts.get(key) ?? 1) - 1;
    if (count) counts.set(key, count); else counts.delete(key);
    if (!counts.size) pending.delete(scene);
    notifyExecutionChange(scene, "interaction-admission-ended");
  };
}

export function isInteractionPaused(scene, target, now = Date.now(), { excludeDialogueSessions = [], playerOnly = false, includeCompleted = false } = {}) {
  const objectKey = objectReferenceKey(target);
  if (!objectKey) return false;
  // A request still being validated can freeze movement but is not yet a
  // player's accepted interaction. Script-owned dialogue is not external input.
  if (!playerOnly && pending.get(scene)?.get(objectKey)) return true;
  // Admission is queried by execution leases as well as the clock. Reading just
  // stored sessions avoids cloning every group's scripts on each such check.
  const definitions = scene?.getFlag?.(MODULE_ID, "groupDefinitions") ?? {};
  return Object.entries(scene?.getFlag?.(MODULE_ID, "groupRuntimes") ?? {}).some(([groupId, runtime]) => {
    if (definitions[groupId]?.schemaVersion !== 1 || runtime?.schemaVersion !== 1) return false;
    if (playerOnly && includeCompleted && runtime.interactionClocks?.[objectKey]?.external) return true;
    const ownsSession = (session) => session?.runId === runtime.runId && objectReferenceKey(session.target) === objectKey;
    return Object.values(runtime.shopSessions ?? {}).some((session) => shopSessionIsLive(session, now) && ownsSession(session))
      || Object.values(runtime.dialogueSessions ?? {}).some((session) => dialogueSessionIsLive(session, now) && ownsSession(session)
        && (!playerOnly || session.origin !== "script")
        && !excludeDialogueSessions.some((reference) => dialogueSessionMatchesReference(session, reference)));
  });
}

/** Caller owns the scene lock. Mark the first pause so the resume tick consumes no elapsed time. */
export function freezeInteractionClock(state, target, now = Date.now(), { external = true } = {}) {
  const key = objectReferenceKey(target);
  if (!key) return;
  state.interactionClocks ??= {};
  state.interactionClocks[key] ??= { pausedAt: now };
  // Latch a confirmed external interaction until the object's clock observes it.
  // Opening and closing within one tick still counts; rejected requests do not.
  if (external) state.interactionClocks[key].external = true;
}
