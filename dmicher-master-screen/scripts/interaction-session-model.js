/** Session lease policies are pure: callers provide the session and clock.
 * Pending trades hold stock until a GM decides. A finished conversation releases
 * automation immediately; its transcript window may remain open for reading. */
export const INTERACTION_LEASE_MS = 120_000;
export const shopSessionIsLive = (session, now = Date.now()) => Boolean(session && (session.status === "pending" || session.expiresAt > now));
export const dialogueSessionIsLive = (session, now = Date.now()) => Boolean(session
  && ["active", "processing"].includes(session.status) && session.expiresAt > now);
// Delivery may still open a finished single-page conversation. This is a window
// admission policy, not a reason to hold movement or an explicit script wait.
export const dialogueSessionIsPresent = (session, now = Date.now()) => dialogueSessionIsLive(session, now)
  || Boolean(session?.status === "finished" && session.expiresAt > now);

export const dialogueSessionMatchesReference = (session, reference) => Boolean(session && reference
  && session.sessionId === reference.sessionId && session.userId === reference.userId && session.actorTokenId === reference.actorTokenId);
export const shopSessionMatchesReference = (session, reference) => dialogueSessionMatchesReference(session, reference) && session.shopId === reference.shopId;
export function scriptShopsPending(runtime, references, now = Date.now()) {
  return (references ?? []).some(reference => Object.values(runtime?.shopSessions ?? {}).some(session => session.runId === runtime.runId
    && shopSessionIsLive(session, now) && shopSessionMatchesReference(session, reference)));
}

/** An explicit script wait also covers an interrupted conversation: interruption
 * is not completion. Finish, Leave or an expired lease releases the waiting step. */
export function scriptDialoguesPending(runtime, references, now = Date.now(), mode = "all") {
  if (mode === "none" || !references?.length) return false;
  const sessions = Object.values(runtime?.dialogueSessions ?? {});
  const pending = (reference) => sessions.some((session) => session.runId === runtime.runId
    && ["active", "processing", "interrupted"].includes(session.status) && session.expiresAt > now
    && dialogueSessionMatchesReference(session, reference));
  // "First" means any participant may finish first, not the first array entry.
  return mode === "first" ? references.every(pending) : references.some(pending);
}
