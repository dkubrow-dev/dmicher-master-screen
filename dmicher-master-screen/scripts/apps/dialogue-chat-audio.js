import { isExecutionHalted } from "../execution.js";
import { renderDialogueAudio, disposeDialogueAudio } from "./dialogue-presentation.js";

const keyFor = packet => `${packet.sceneId}:${packet.sessionId}`;

/** One voice and one set of subscriptions per conversation, regardless of the
 * number of rendered cards. Only delivered card snapshots enter its replay list.
 * `created` is an actual createChatMessage notification, never a history scan. */
export class ChatDialogueAudio {
  constructor({ context, isCurrent } = {}) {
    this.context = context; this.isCurrent = isCurrent; this.sessions = new Map(); this.createdMessages = new Map(); this.disposed = false;
  }

  created(message, packet) {
    if (this.disposed || !packet?.entry || !message?.id || this.createdMessages.has(message.id)) return;
    this.createdMessages.set(message.id, "pending");
    if (this.createdMessages.size > 500) this.createdMessages.delete(this.createdMessages.keys().next().value);
    const session = this.sessions.get(keyFor(packet));
    // Foundry may render a new card before firing its document creation hook.
    if (session?.cards.has(message.id)) this.sync(session, this.context?.(packet), message.id);
  }

  render(message, packet, root, current) {
    if (this.disposed || !packet?.entry || !message?.id || !root) return;
    this.prune();
    const key = keyFor(packet);
    let session = this.sessions.get(key);
    if (!session) {
      session = { packet, cards: new Map(), sounded: new Set() };
      // The existing replay presenter can bind all cards without a global DOM
      // selector, so another conversation never receives these handlers.
      session.element = { querySelectorAll: selector => [...session.cards.values()]
        .flatMap(card => [...card.root.querySelectorAll(selector)]) };
      this.sessions.set(key, session);
    }
    session.packet = packet;
    session.cards.set(message.id, { root, entry: structuredClone(packet.entry) });
    this.sync(session, current, message.id);
  }

  sync(session, current, messageId) {
    const packet = session.packet, card = session.cards.get(messageId);
    const delivered = new Map([...session.cards.values()].map(({ entry }) => [entry.id, entry]));
    // Preserve confirmed transcript ordering when older chat cards render after
    // the newest one. No unseen world-history entries are exposed for replay.
    const saved = current?.session?.history ?? [];
    const history = saved.filter(entry => delivered.has(entry.id)).map(entry => delivered.get(entry.id));
    const ordered = new Set(history.map(entry => entry.id));
    for (const [id, entry] of delivered) if (!ordered.has(id)) history.push(entry);
    const latest = saved.findLast(entry => entry.role === "object")?.id;
    const fresh = card?.entry.role === "object" && card.entry.id === latest
      && this.createdMessages.get(messageId) === "pending" && !session.sounded.has(card.entry.id)
      && current?.session?.presentation?.mode !== "window";
    if (this.createdMessages.has(messageId)) this.createdMessages.set(messageId, "consumed");
    // Archive rendering and publication beside a dialogue window are silent.
    // Audio already belongs to that window; the chat copy still permits replay.
    if (!session.dialogueAudio) renderDialogueAudio(session, []);
    for (const entry of history) session.dialogueAudio.seen.add(String(entry.id));
    if (fresh) { session.dialogueAudio.seen.delete(String(card.entry.id)); session.sounded.add(card.entry.id); }
    const isCurrent = () => {
      if (this.isCurrent) return this.isCurrent(packet);
      const state = this.context?.(packet);
      return Boolean(state && state.session?.runId === packet.runId && !isExecutionHalted(state.scene, state.runtime));
    };
    renderDialogueAudio(session, history, current?.scene ? { scene: current.scene, isCurrent } : undefined);
    for (const button of session.element.querySelectorAll("[data-dialogue-audio-replay]")) {
      const replay = button.onclick;
      button.onclick = event => {
        if (current?.scene && !isCurrent()) { event.preventDefault(); event.stopPropagation(); return; }
        replay(event);
      };
    }
  }

  prune() {
    for (const [key, session] of this.sessions) {
      for (const [id, card] of session.cards) if (card.root.isConnected === false) session.cards.delete(id);
      if (!session.cards.size) { disposeDialogueAudio(session); this.sessions.delete(key); }
    }
  }

  dispose() {
    this.disposed = true;
    for (const session of this.sessions.values()) disposeDialogueAudio(session);
    this.sessions.clear(); this.createdMessages.clear();
  }
}
