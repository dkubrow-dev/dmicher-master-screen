import { getRuntimes } from "./store.js";

const pending = new WeakMap();
export const INTERACTION_LEASE_MS = 120_000;
const keyOf = (target) => typeof target === "string" ? (target.includes(":") ? target : `Token:${target}`) : target?.id ? `${target.type}:${target.id}` : null;
export const dialogueSessionIsLive = (session, now = Date.now()) => ["active", "processing", "finished"].includes(session?.status)
  && session.expiresAt > now;

/** An authenticated admission claims this before joining the scene queue. An old
 * movement may finish, but no following movement may race the geometry check. */
export function beginInteractionPause(scene, target) {
  const key = keyOf(target);
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

export function isInteractionPaused(scene, tokenId, now = Date.now()) {
  tokenId = keyOf(tokenId);
  if (pending.get(scene)?.get(tokenId)) return true;
  return getRuntimes(scene).some((state) => {
    const targetsToken = (session) => keyOf(session.target) === tokenId;
    return Object.values(state.shopSessions ?? {}).some((session) => session && session.runId === state.runId && targetsToken(session)
      && (session.status === "pending" || session.expiresAt > now))
      || Object.values(state.dialogueSessions ?? {}).some((session) => session && session.runId === state.runId && targetsToken(session)
        && session.expiresAt > now && dialogueSessionIsLive(session, now));
  });
}

/** Caller owns the scene lock. Mark the first pause so the resume tick consumes no elapsed time. */
export function freezeInteractionClock(state, target, now = Date.now()) {
  const key = keyOf(target);
  if (!key) return;
  state.interactionClocks ??= {};
  state.interactionClocks[key] ??= { pausedAt: now };
}
