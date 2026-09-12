/** Session lease policies are pure: callers provide the session and clock.
 * Pending trades hold stock until a GM decides. Completed dialogue text keeps
 * its object paused while the still-open window renews its lease. */
export const INTERACTION_LEASE_MS = 120_000;
export const shopSessionIsLive = (session, now = Date.now()) => Boolean(session && (session.status === "pending" || session.expiresAt > now));
export const dialogueSessionIsLive = (session, now = Date.now()) => Boolean(session
  && ["active", "processing", "finished"].includes(session.status) && session.expiresAt > now);
