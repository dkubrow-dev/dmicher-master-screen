import { getRuntimes } from "./store.js";

const pending = new WeakMap();
export const INTERACTION_LEASE_MS = 120_000;
const keyOf = (target) => target?.type === "Token" ? target.id : null;
export const dialogueSessionIsLive = (session, now = Date.now()) => ["active", "finished"].includes(session?.status)
  && (session.expiresAt === undefined || session.expiresAt > now);

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
  if (pending.get(scene)?.get(tokenId)) return true;
  return getRuntimes(scene).some((state) => {
    const targetsToken = (session, legacyId) => session.target ? keyOf(session.target) === tokenId : legacyId === tokenId;
    return Object.entries(state.shopSessions ?? {}).some(([id, session]) => session.runId === state.runId && targetsToken(session, id)
      && (session.status === "pending" || session.expiresAt > now))
      || Object.values(state.dialogueSessions ?? {}).some((session) => session.runId === state.runId && targetsToken(session)
        && session.expiresAt > now && dialogueSessionIsLive(session, now));
  });
}

/** Caller owns the scene lock. Preserve speech delay instead of catching up after a pause. */
export function freezeInteractionClock(state, tokenId, now = Date.now()) {
  state.interactionClocks ??= {};
  state.interactionClocks[tokenId] ??= { speechRemainingMs: Math.max(0, Number(state.speech?.[tokenId]?.nextAt ?? now) - now) };
}
