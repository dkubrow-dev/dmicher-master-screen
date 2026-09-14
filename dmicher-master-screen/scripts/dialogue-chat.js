import { MODULE_ID } from "./model.js";
import { text } from "./localization.js";
import { generics } from "./generics.js";
import { getRuntime, saveRuntime, withSceneLock, isAuthority } from "./store.js";
import { dialogueAudience } from "./dialogue-visibility.js";
import { normalizeDialoguePresentation } from "./interaction-model.js";
import { dialogueSessionView } from "./dialogue-history.js";
import { dialogueParticipant } from "./dialogue-participants.js";
import { dialogueSessionIsLive } from "./interaction-session-model.js";
import { isExecutionHalted } from "./execution.js";
import { requestGMReply } from "./gm-request.js";
import { debugError } from "./debug.js";
import { notifyError } from "./ui.js";
import { renderDialogueMessages, renderDialogueResponses, dialogueResponseId, bindDialogueResponses, dialogueChatTitle } from "./dialogue-response-presentation.js";
import { ChatDialogueAudio } from "./apps/dialogue-chat-audio.js";
import { escapeScriptText as esc } from "./script-text.js";

const clone = structuredClone;
const terminal = session => ["finished", "left"].includes(session?.status);
const flag = message => message?.getFlag?.(MODULE_ID, "dialogueChat");
const sessionKey = packet => `${packet.sceneId}:${packet.sessionId}`;

/** The GM writes transcript snapshots; the speaker sends the same authenticated
 * commands as a dialogue window. Public copies never contain response options. */
export class DialogueChat {
  constructor(service, { messages, requests, authority = isAuthority, openModerator } = {}) {
    this.service = service; this.authority = authority;
    this.openModerator = openModerator;
    this.messages = messages ?? generics.chat.informer.createMessageService({ ownerId: MODULE_ID, channel: "dialogue-chat" });
    this.requests = requests ?? generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "dialogue-publication" });
    this.tasks = new Map(); this.signatures = new Map(); this.messageIds = new Map(); this.active = new Map(); this.cards = new Map(); this.disposed = false;
    this.managementCards = new Map();
    this.audio = new ChatDialogueAudio({ context: packet => this.context(packet), isCurrent: packet => Boolean(this.liveSession(packet)) });
  }
  context(packet) {
    const scene = game.scenes?.get(packet.sceneId), runtime = scene && getRuntime(scene, { groupId: packet.groupId });
    const session = Object.values(runtime?.dialogueSessions ?? {}).find(entry => entry?.sessionId === packet.sessionId);
    if (!session || session.runId !== runtime.runId) return null;
    const current = this.service.getContext(packet.sceneId, session.dialogueId, session.groupId, session.target, { sessionId: session.sessionId });
    return { ...current, scene, runtime, session };
  }
  packet(scene, session) {
    const targetName = session.history?.find(entry => entry.role === "object")?.name ?? this.service.getContext(scene.id, session.dialogueId, session.groupId, session.target, { sessionId: session.sessionId }).target?.name ?? "";
    const actorName = session.history?.find(entry => entry.role === "player")?.name ?? scene.tokens?.get(session.actorTokenId)?.name ?? game.users.get(session.userId)?.name ?? "";
    return { version: 1, sceneId: scene.id, groupId: session.groupId, sessionId: session.sessionId, runId: session.runId,
      dialogueId: session.dialogueId, target: clone(session.target), actorTokenId: session.actorTokenId, userId: session.userId, targetName, actorName };
  }
  trusted(message) {
    const metadata = generics.chat.getChatMetadata(message), packet = flag(message);
    const author = game.users?.get(message.author?.id ?? message.author);
    return metadata?.ownerId === MODULE_ID && metadata.channel === "dialogue-chat" && packet?.version === 1
      && generics.chat.isManagedIdentityUser(author) ? packet : null;
  }
  /** One authoritative notice per conversation, independent of display mode.
   * It contains identity and GM controls, never a second copy of the transcript. */
  notifyStarted(packet) {
    if (this.disposed || !this.authority() || !packet?.sessionId) return Promise.resolve();
    const key = `${sessionKey(packet)}:notice`, previous = this.tasks.get(key);
    if (previous) return previous.promise;
    const task = {};
    task.promise = this.writeNotice(packet, { create: true }).finally(() => this.tasks.delete(key));
    this.tasks.set(key, task); return task.promise;
  }
  async writeNotice(packet, { create = false } = {}) {
    if (this.disposed || !this.authority()) return;
    const current = this.context(packet); if (!current) return;
    const key = `${sessionKey(packet)}:gm-notice`, existing = this.messages.get(this.messageIds.get(key)) ?? this.messages.find({ key })[0];
    if (!existing && !create) return;
    const fresh = this.packet(current.scene, current.session);
    // Preserve the names used by the original start notice on later updates.
    packet = { ...fresh, targetName: flag(existing)?.targetName ?? fresh.targetName, actorName: flag(existing)?.actorName ?? fresh.actorName,
      management: true, status: current.session.status };
    const canFinish = ["active", "processing", "interrupted"].includes(packet.status);
    const content = `<section class="dmicher-master-screen ms-dialogue-chat"><h3 class="ms-dialogue-chat-heading">${esc(dialogueChatTitle(packet.targetName, packet.actorName))}</h3><p>${canFinish ? text("Диалог начат.", "Dialogue started.") : text("Диалог завершён.", "Dialogue finished.")}</p><div class="ms-actions"><button type="button" data-dialogue-gm-action="join">${text("Подключиться", "Join")}</button>${canFinish ? `<button type="button" data-dialogue-gm-action="finish">${text("Завершить диалог", "Finish dialogue")}</button>` : ""}</div></section>`;
    if (existing) {
      this.messageIds.set(key, existing.id);
      if (existing.content !== content || JSON.stringify(flag(existing)) !== JSON.stringify(packet)) await this.messages.update(existing.id, { content, moduleFlags: { dialogueChat: packet } });
      return existing;
    }
    const userIds = Array.from(game.users.values()).filter(user => user.isGM && !generics.chat.isManagedIdentityUser(user)).map(user => user.id);
    if (!userIds.length) return;
    const [message] = await this.messages.create({ content, flags: { [MODULE_ID]: { dialogueChat: packet } } },
      { audience: { type: "users", userIds }, kind: "dialogue-notice", key, technical: false,
        enabled: () => !this.disposed && this.authority() });
    if (message) this.messageIds.set(key, message.id);
    return message;
  }
  /** Coalesce duplicate notifications. Only committed dialogue state, not script
   * clocks or console activity, requests transcript updates. */
  publish(packet) {
    if (this.disposed || !this.authority() || !packet?.sessionId) return Promise.resolve();
    const key = sessionKey(packet), previous = this.tasks.get(key);
    if (previous) { previous.again = true; return previous.promise; }
    const task = { again: true };
    task.promise = (async () => {
      do { task.again = false; await this.publishCurrent(packet); } while (task.again && !this.disposed);
    })().finally(() => this.tasks.delete(key));
    this.tasks.set(key, task); return task.promise;
  }
  async write(packet, entry, userIds, suffix, { controls = false, responses = [], status, prompt = false, observerUserIds = [] } = {}) {
    if (!userIds.length || this.disposed || !this.authority()) return;
    const key = `${packet.sceneId}:${packet.sessionId}:${entry?.id ?? "publish"}:${suffix}`;
    const existing = this.messages.get(this.messageIds.get(key)) ?? this.messages.find({ key })[0];
    if (existing) {
      this.messageIds.set(key, existing.id);
      if (!flag(existing)?.controls && !controls && !prompt) return existing;
    }
    // Routing of an already published line is immutable. Never reveal old
    // private material because someone moves closer or changes roll mode later.
    const data = { ...packet, entry: entry ? clone(entry) : null, controls, responses: controls ? clone(responses) : [], status, prompt,
      ...(suffix === "primary" ? { observerUserIds: clone(existing ? flag(existing)?.observerUserIds ?? [] : observerUserIds) } : {}) };
    const content = `<section class="dmicher-master-screen ms-dialogue-chat"><h3 class="ms-dialogue-chat-heading">${esc(dialogueChatTitle(packet.targetName, packet.actorName))}</h3>${entry ? renderDialogueMessages([entry], { layout: "chat" }) : ""}${prompt
      ? `<p>${text("Опубликовать завершённый диалог в чате?", "Publish the completed dialogue in chat?")}</p><div class="ms-actions">${generics.chat.renderActionButton({ id: "publish", label: text("Опубликовать", "Publish") })}${generics.chat.renderActionButton({ id: "decline", label: text("Не публиковать", "Do not publish") })}</div>`
      : controls ? renderDialogueResponses(responses, { actionAttribute: "data-dialogue-chat-action", canFinish: status === "active", groupName: key }) : ""}</section>`;
    if (existing) {
      if (existing.content !== content || JSON.stringify(flag(existing)) !== JSON.stringify(data)) await this.messages.update(existing.id, { content, moduleFlags: { dialogueChat: data } });
      return existing;
    }
    const speaker = entry?.speaker ?? {};
    const [message] = await this.messages.create({ content, speaker: { ...speaker, alias: entry?.name ?? text("Диалог", "Dialogue") },
      flags: { [MODULE_ID]: { dialogueChat: data } } },
    { audience: { type: "users", userIds }, kind: "dialogue", key, speakerMode: "provided", technical: false,
      enabled: () => !this.disposed && this.authority() });
    if (message) this.messageIds.set(key, message.id);
    if (this.messageIds.size > 2000) this.messageIds.delete(this.messageIds.keys().next().value);
    return message;
  }
  async publishCurrent(packet) {
    const current = this.context(packet); if (!current) return;
    await this.writeNotice(packet);
    const { scene, runtime, session, dialogue, target } = current;
    const presentation = normalizeDialoguePresentation(session.presentation ?? dialogue?.presentation);
    const live = !isExecutionHalted(scene, runtime) && dialogueSessionIsLive(session) && session.status === "active";
    const view = dialogueSessionView(session, dialogue, target);
    packet = { ...this.packet(scene, session), nodeId: session.nodeId, step: session.step };
    if (presentation.mode === "window" && presentation.windowChat === "none") return;
    if (presentation.mode === "window" && ["complete", "confirm"].includes(presentation.windowChat)) {
      if (!terminal(session)) return;
      if (presentation.windowChat === "confirm" && session.publicationApproved !== true) {
        if (session.publicationApproved === false) return;
        await this.write(packet, null, [session.userId], "request", { prompt: true, status: session.status }); return;
      }
    }
    const primary = Array.from(game.users.values()).filter(user => !generics.chat.isManagedIdentityUser(user)
      && (user.id === session.userId || user.isGM || Number(user.role) >= 3)).map(user => user.id);
    const publicRecipients = dialogueAudience(scene, { ...session, presentation }, { observersOnly: true });
    const history = view.history ?? [], activeId = live ? history.at(-1)?.id : null;
    for (const entry of history) {
      const primaryMessage = await this.write(packet, entry, primary, "primary", { controls: presentation.mode === "chat" && entry.id === activeId,
        responses: view.responses, status: live ? "active" : session.status, observerUserIds: entry.visibility === "public" ? publicRecipients : [] });
      // An empty snapshot is meaningful: later movement, roll-mode changes or
      // reconnection cannot turn an earlier private line into public history.
      await this.write(packet, entry, flag(primaryMessage)?.observerUserIds ?? [], "observers", { status: session.status });
    }
  }
  changed(scene) {
    this.syncCards();
    if (this.disposed || !scene || !this.authority()) return;
    const runtimes = scene.getFlag(MODULE_ID, "groupRuntimes") ?? {};
    for (const run of Object.values(runtimes)) for (const session of Object.values(run.dialogueSessions ?? {})) {
      if (!session?.sessionId || session.runId !== run.runId) continue;
      const key = `${scene.id}:${session.sessionId}`;
      // Script starts are presented only after their delivery admission succeeds.
      if (session.origin === "script" && !this.signatures.has(key)) continue;
      const signature = `${session.step}:${session.status}:${session.history?.length}:${run.halted}:${scene.getFlag(MODULE_ID, "automationHalted")}:${session.publicationApproved}`;
      if (this.signatures.get(key) === signature) continue;
      this.signatures.set(key, signature);
      if (this.signatures.size > 500) this.signatures.delete(this.signatures.keys().next().value);
      const packet = this.packet(scene, session);
      void this.publish(packet).catch(error => this.report(error, packet));
    }
  }
  async present(command, view) {
    const packet = { ...command, sessionId: view.sessionId };
    this.signatures.set(sessionKey(packet), "delivered");
    return this.publish(packet);
  }
  async presentListener(command, view) {
    if (this.disposed || !this.authority() || view?.role !== "listener" || !view.sessionId || !command.userId) return;
    const packet = { ...command, sessionId: view.sessionId }, key = `${sessionKey(packet)}:listener:${command.userId}`;
    const pending = this.tasks.get(key); if (pending) return pending.promise;
    const admitted = () => {
      if (this.disposed || !this.authority()) return null;
      const current = this.context(packet), user = game.users.get(command.userId);
      if (!current || !user || current.session.runId !== view.runId || isExecutionHalted(current.scene, current.runtime)
        || !dialogueSessionIsLive(current.session) || !["active", "processing"].includes(current.session.status)
        || normalizeDialoguePresentation(current.session.presentation ?? current.dialogue?.presentation).mode !== "chat") return null;
      try {
        const participant = dialogueParticipant(current.scene, current.session, user, view.listenerTokenId);
        return participant.role === "listener" ? current : null;
      } catch { return null; }
    };
    const task = {};
    task.promise = (async () => {
      const current = admitted(); if (!current) return;
      // Existing primary, observer or listener copies already give this user
      // the line. Joining must neither duplicate them nor expand old whispers.
      const delivered = new Set(this.messages.find().filter(message => {
        const data = flag(message);
        return data?.sceneId === current.scene.id && data.sessionId === current.session.sessionId
          && data.runId === current.session.runId && message.whisper?.includes(command.userId);
      }).map(message => flag(message)?.entry?.id));
      for (const entry of current.session.history ?? []) {
        if (entry.visibility !== "public" || delivered.has(entry.id)) continue;
        const latest = admitted(); if (!latest) return;
        const message = await this.write({ ...this.packet(latest.scene, latest.session), nodeId: latest.session.nodeId,
          step: latest.session.step, role: "listener", listenerTokenId: view.listenerTokenId }, entry, [command.userId],
        `listener-${command.userId}`, { status: latest.session.status });
        if (message) delivered.add(entry.id);
      }
    })().finally(() => this.tasks.delete(key));
    this.tasks.set(key, task); return task.promise;
  }
  async open(command) {
    const view = await this.service.requestStart(command);
    if (normalizeDialoguePresentation(view.presentation).mode === "chat" && view.status === "active") {
      this.track({ ...command, sessionId: view.sessionId, userId: game.user.id });
    }
    return view;
  }
  track(packet) {
    if (packet.userId !== game.user?.id || this.disposed) return;
    this.active.set(sessionKey(packet), packet);
    this.timer ??= setInterval(() => {
      for (const [key, current] of this.active) {
        const state = this.context(current);
        if (!state || !dialogueSessionIsLive(state.session) || isExecutionHalted(state.scene, state.runtime)) { this.active.delete(key); continue; }
        try { dialogueParticipant(state.scene, state.session, game.user, current.listenerTokenId); }
        catch { this.active.delete(key); continue; }
        void this.service.renewSession(current).catch(error => { this.active.delete(key); this.report(error, current); });
      }
      if (!this.active.size) { clearInterval(this.timer); this.timer = null; }
    }, 30_000);
    this.timer.unref?.();
  }
  observe(message) {
    const packet = this.trusted(message);
    if (packet?.controls && packet.status === "active" && this.cardIsCurrent(packet)) this.track(packet);
  }
  created(message) { this.audio.created(message, this.trusted(message)); this.observe(message); }
  storedSession(packet) {
    const scene = game.scenes?.get(packet.sceneId);
    const runtime = scene?.getFlag(MODULE_ID, "groupRuntimes")?.[packet.groupId];
    if (!runtime || runtime.runId !== packet.runId) return null;
    return Object.values(runtime.dialogueSessions ?? {}).find(entry => entry?.sessionId === packet.sessionId && entry.runId === runtime.runId);
  }
  liveSession(packet) {
    const session = this.storedSession(packet), scene = game.scenes?.get(packet.sceneId);
    return session && !isExecutionHalted(scene, scene.getFlag(MODULE_ID, "groupRuntimes")[packet.groupId]) ? session : null;
  }
  cardIsCurrent(packet) {
    if (globalThis.canvas?.scene?.id !== packet.sceneId) return false;
    const session = this.liveSession(packet);
    return session && session.step === packet.step && session.nodeId === packet.nodeId
      && session.status === "active" && dialogueSessionIsLive(session);
  }
  syncCards() {
    for (const [id, card] of this.managementCards) {
      if (card.root.isConnected === false) { this.managementCards.delete(id); continue; }
      const session = game.user?.isGM && this.storedSession(card.packet);
      for (const control of card.root.querySelectorAll("[data-dialogue-gm-action]")) {
        control.disabled = !session || control.dataset.dialogueGmAction === "finish" && !["active", "processing", "interrupted"].includes(session.status);
      }
      // Archived notices retain Join, whose click rechecks the session. They
      // need no clock-driven maintenance after their finish button is retired.
      if (!session || terminal(session)) this.managementCards.delete(id);
    }
    for (const [id, card] of this.cards) {
      if (card.root.isConnected === false) { this.cards.delete(id); continue; }
      if (!this.cardIsCurrent(card.packet)) {
        card.root.querySelector("[data-dialogue-responses]")?.remove(); this.cards.delete(id);
      }
    }
  }
  render(message, html) {
    const packet = this.trusted(message), root = html?.querySelector ? html : html?.[0];
    if (!packet || !root || message.visible === false || message.isContentVisible === false) return;
    const leading = game.user.id === packet.userId;
    if (packet.management) {
      if (!game.user.isGM || generics.chat.isManagedIdentityUser(game.user)) {
        for (const control of root.querySelectorAll("[data-dialogue-gm-action]")) control.remove();
        return;
      }
      this.managementCards.set(message.id, { root, packet }); this.syncCards();
      generics.chat.bindActions({ moduleId: MODULE_ID, message, root, key: "dialogue-management", onError: notifyError,
        actions: [{ selector: "[data-dialogue-gm-action]", authorize: ({ message: fresh, user }) => Boolean(user.isGM && !generics.chat.isManagedIdentityUser(user) && this.trusted(fresh)?.management),
          handle: async ({ message: fresh, control }) => {
            const command = this.trusted(fresh), view = this.service.inspectSession(command);
            if (!view) throw new Error(text("Этот диалог больше недоступен.", "This dialogue is no longer available."));
            if (control.dataset.dialogueGmAction === "finish") return this.service.requestModeratorFinish(command);
            return this.openModerator?.(command, view);
          } }] });
      return;
    }
    if (!leading) for (const control of root.querySelectorAll("[data-dialogue-responses], [data-dmicher-chat-action]")) control.remove();
    if (packet.controls) {
      if (leading && this.cardIsCurrent(packet)) this.cards.set(message.id, { root, packet });
      else root.querySelector("[data-dialogue-responses]")?.remove();
    }
    bindDialogueResponses(root);
    if (packet.entry) this.audio.render(message, packet, root, this.context(packet));
    if (!leading) return;
    generics.chat.bindActions({ moduleId: MODULE_ID, message, root, key: "dialogue", onError: notifyError,
      actions: [{ selector: "[data-dialogue-chat-action]", authorize: ({ message: fresh, user }) => this.trusted(fresh)?.userId === user.id,
        handle: async ({ message: fresh, control }) => {
          const current = this.trusted(fresh), state = this.context(current);
          if (!state || state.session.step !== current.step || state.session.nodeId !== current.nodeId) throw new Error(text("Этот блок диалога уже завершён.", "This dialogue block has already ended."));
          const action = control.dataset.dialogueChatAction;
          if (action === "finish") await this.service.requestFinish(current);
          else { const responseId = dialogueResponseId(control); if (responseId) await this.service.requestAnswer({ ...current, responseId }); }
        } },
      { selector: "[data-dmicher-chat-action]", authorize: ({ message: fresh, user }) => this.trusted(fresh)?.userId === user.id,
        handle: ({ message: fresh, control }) => this.requestPublication(fresh.id, control.dataset.dmicherChatAction === "publish") }] });
    this.observe(message);
  }
  async decidePublication(messageId, approved, user) {
    if (!this.authority() || typeof approved !== "boolean") throw new Error(text("Публикация недоступна.", "Publication is unavailable."));
    const message = this.messages.get(messageId), packet = this.trusted(message);
    if (!packet?.prompt || packet.userId !== user.id || !message.whisper.includes(user.id)) throw new Error(text("Запрос публикации принадлежит другому игроку.", "The publication request belongs to another player."));
    const decision = await withSceneLock(game.scenes.get(packet.sceneId), async () => {
      const current = this.context(packet);
      if (!current || !terminal(current.session)) throw new Error(text("Завершённый диалог недоступен.", "The completed dialogue is unavailable."));
      dialogueParticipant(current.scene, current.session, user);
      if (current.session.publicationApproved !== undefined) return current.session.publicationApproved;
      current.session.publicationApproved = approved; await saveRuntime(current.scene, current.runtime);
      return approved;
    });
    if (decision) await this.publish(packet);
    await this.messages.update(messageId, { content: `<p>${decision ? text("Диалог опубликован.", "Dialogue published.") : text("Публикация отклонена.", "Publication declined.")}</p>`, moduleFlags: { dialogueChat: { ...packet, prompt: false } } });
    return { approved: decision };
  }
  async requestPublication(messageId, approved) {
    if (this.authority()) return this.decidePublication(messageId, approved, game.user);
    const result = await requestGMReply(this.requests, { command: { messageId, approved }, commandFlag: "dialoguePublication", responseFlag: "dialoguePublicationResult",
      content: `<p>${text("Ширма: публикация диалога.", "Master screen: dialogue publication.")}</p>`, kind: "publication",
      timeoutMessage: text("Мастер не ответил на запрос публикации.", "The GM did not respond to the publication request.") });
    if (result.failure) throw new Error(result.failure); return result;
  }
  async processPublication(message, initiatingUserId) {
    const command = message.getFlag?.(MODULE_ID, "dialoguePublication");
    if (!command || !this.authority()) return false;
    const authorId = message.author?.id ?? message.author;
    if (authorId !== initiatingUserId || !message.whisper?.includes(game.user.id)) return true;
    const user = game.users.get(authorId); if (!user || generics.chat.isManagedIdentityUser(user)) return true;
    let result;
    try { result = await this.decidePublication(command.messageId, command.approved, user); }
    catch (error) { result = { failure: error.message }; }
    await message.update({ [`flags.${MODULE_ID}.dialoguePublicationResult`]: result });
    return true;
  }
  report(error, packet) { debugError("dialogue", "chat.failed", error, packet); notifyError(error); }
  dispose() {
    this.disposed = true; clearInterval(this.timer); this.timer = null; this.active.clear(); this.signatures.clear(); this.messageIds.clear(); this.cards.clear(); this.managementCards.clear();
    this.audio.dispose();
  }
}
