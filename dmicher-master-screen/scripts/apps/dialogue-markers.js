import { createObjectDecorations } from "./object-decorations.js";
import { listListeningSessions, DIALOGUE_SYMBOL } from "../dialogue-listeners.js";
import { getRuntimes } from "../store.js";

/** A separate presentation owner keeps the dialogue marker independent from
 * scripted emotions. A single lease deadline removes stale markers, not a poll. */
export function createDialogueMarkers({ decorations = createObjectDecorations(), list = listListeningSessions,
  schedule = setTimeout, cancel = clearTimeout, now = Date.now } = {}) {
  let documents = new Set(), timer = null;
  const refresh = (document) => {
    if (documents.has(document)) decorations.update(document, { emoji: DIALOGUE_SYMBOL, emojiSize: 24, emojiOffset: 42 });
  };
  function clear() {
    if (timer !== null) cancel(timer);
    timer = null; decorations.clear(); documents.clear();
  }
  function sync(scene) {
    if (timer !== null) cancel(timer);
    timer = null;
    if (!scene || globalThis.canvas?.scene?.id !== scene.id) { clear(); return; }
    const sessions = list(scene, { now: now() });
    const visible = new Set(sessions.map((session) => scene.tokens?.get(session.actorTokenId)).filter(Boolean));
    for (const document of documents) if (!visible.has(document)) decorations.remove(document);
    documents = visible;
    for (const document of documents) refresh(document);
    const sessionIds = new Set(sessions.map((session) => session.sessionId));
    const deadlines = getRuntimes(scene).flatMap((runtime) => Object.values(runtime.dialogueSessions ?? {}))
      .filter((session) => sessionIds.has(session?.sessionId)).map((session) => session.expiresAt).filter(Number.isFinite);
    if (deadlines.length) {
      timer = schedule(() => { timer = null; sync(scene); }, Math.max(1, Math.min(...deadlines) - now() + 1));
      timer?.unref?.();
    }
  }
  return Object.freeze({ sync, refresh, clear });
}
