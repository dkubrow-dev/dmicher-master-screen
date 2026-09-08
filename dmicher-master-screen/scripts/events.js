import { MODULE_ID, randomId } from "./model.js";
import { asArray, getRuntime, isAuthority, requireGM, saveRuntime, withSceneLock } from "./store.js";
import { speechRecipients } from "./effects.js";
import { isExecutionHalted } from "./execution.js";

const copy = (value) => structuredClone(value);
const EVENT_NAME = /^[a-z][a-z0-9_.-]{0,99}$/;
const MAX_DEPTH = 16;
const MAX_LOG = 100;
const MAX_CLAIMS = 300;
const escapeHTML = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function eventChatAudience(scene, event, audience = {}) {
  const users = asArray(game.users), ids = new Set();
  if (audience.gms) for (const user of users) if (Number(user.role) >= 3) ids.add(user.id);
  const interactor = game.users.get(event.payload?.userId);
  const actorToken = scene.tokens.get(event.actorTokenId);
  if (audience.interactor && interactor && actorToken?.actor
    && (interactor.isGM || actorToken.actor.testUserPermission?.(interactor, "OWNER"))) ids.add(interactor.id);
  const target = event.payload?.target;
  const document = target?.type === "Token" ? scene.tokens.get(target.id) : target?.type === "Tile" ? scene.tiles?.get(target.id) : null;
  if (audience.nearby && document) {
    const origin = target.type === "Tile" ? {
      id: null, hidden: document.hidden,
      getCenterPoint: () => document.object?.center ?? { x: document.x + document.width / 2, y: document.y + document.height / 2 }
    } : document;
    const near = speechRecipients(scene, origin, { range: audience.range ?? 30, visibleOnly: audience.visibleOnly !== false });
    for (const id of near) if (Number(game.users.get(id)?.role) < 3) ids.add(id);
  }
  return { userIds: [...ids], target: document, targetType: target?.type };
}

/** Episode events have an explicit, bounded queue; recorded history is never replayed. */
export class SceneEvents {
  constructor({ runtime, onChange = () => {}, now = () => Date.now(), executeMacro, chat } = {}) {
    this.runtime = runtime;
    this.onChange = onChange;
    this.now = now;
    this.chat = chat;
    this.messages = chat?.createMessageService({ ownerId: MODULE_ID, channel: "events" });
    this.executeMacro = executeMacro ?? (async (uuid, event, scene) => {
      const macro = await fromUuid(uuid);
      if (!this.current(scene, event.runId)) return;
      if (macro?.documentName !== "Macro" || macro.type !== "script" || !macro.canExecute) throw new Error("Подписка требует доступный скриптовый макрос Foundry.");
      return macro.execute({ scene, event: copy(event), screen: runtime });
    });
    this.queue = [];
    this.draining = null;
    this.admissions = new Set();
    this.context = null;
    this.disposed = false;
  }

  requireAuthority() {
    requireGM();
    if (!isAuthority()) throw new Error("События исполняет выбранный активный полный мастер.");
    if (this.disposed) throw new Error("Обработчик событий остановлен.");
  }

  current(scene, runId) {
    return !this.disposed && isAuthority() && globalThis.canvas?.scene?.id === scene?.id
      && !isExecutionHalted(scene) && getRuntime(scene).runId === runId;
  }

  emit(scene, input) {
    const task = this.admit(scene, input);
    this.admissions.add(task);
    void task.finally(() => this.admissions.delete(task)).catch(() => {});
    return task;
  }

  async admit(scene, input) {
    this.requireAuthority();
    if (!scene || !EVENT_NAME.test(input?.name ?? "")) throw new Error("ID события: строчная латиница, цифры, точка, дефис или подчёркивание.");
    const encoded = JSON.stringify(input.payload ?? {});
    if (encoded === undefined || encoded.length > 8000) throw new Error("Полезные данные события должны быть JSON объёмом до 8000 символов.");
    const inherited = input.context ?? this.context;
    const event = {
      id: String(input.id ?? randomId()).slice(0, 160), name: input.name,
      source: String(input.source ?? "module").slice(0, 100), actorTokenId: input.actorTokenId ?? null,
      payload: JSON.parse(encoded), runId: input.runId ?? getRuntime(scene).runId,
      chainId: String(inherited?.chainId ?? randomId()).slice(0, 160), depth: Math.max(0, Number(inherited?.depth) || 0),
      handled: input.handled === true, at: this.now(), status: "queued", results: []
    };
    if (!event.id) throw new Error("Нужен ID события.");
    let admitted = false;
    const receipt = await withSceneLock(scene, async () => {
      this.requireAuthority();
      const state = getRuntime(scene);
      state.eventClaims ??= {}; state.eventLog ??= [];
      if (state.eventClaims[event.id]) return copy(state.eventClaims[event.id]);
      const removable = Object.keys(state.eventClaims).filter((id) => !["queued", "running"].includes(state.eventClaims[id].status));
      while (Object.keys(state.eventClaims).length >= MAX_CLAIMS && removable.length) delete state.eventClaims[removable.shift()];
      if (Object.keys(state.eventClaims).length >= MAX_CLAIMS) throw new Error("Очередь событий заполнена: мастер должен проверить незавершённые действия.");
      if (!this.current(scene, event.runId) || !state.episode) event.status = "stale";
      else if (event.depth >= MAX_DEPTH) { event.status = "failed"; event.error = "Цепочка событий остановлена: достигнут предел 16 переходов."; }
      else if (event.handled) event.status = "observed";
      state.eventClaims[event.id] = copy(event);
      state.eventLog.push(copy(event));
      state.eventLog = state.eventLog.slice(-MAX_LOG);
      if (event.error) state.error = event.error;
      await saveRuntime(scene, state);
      admitted = event.status === "queued";
      return copy(event);
    });
    this.onChange(scene);
    if (admitted) {
      this.queue.push({ scene, event });
      this.drain();
    }
    // Admission completes before scripts: a script may await emitting its next event safely.
    return receipt;
  }

  drain() {
    if (this.draining || this.disposed) return;
    this.draining = (async () => {
      while (this.queue.length && !this.disposed) {
        const job = this.queue.shift();
        try { await this.process(job.scene, job.event); }
        catch (error) {
          await this.update(job.scene, job.event, { status: "failed", error: error.message ?? String(error) });
        }
      }
    })().finally(() => { this.draining = null; if (this.queue.length && !this.disposed) this.drain(); });
    // A late authority loss or failed world write must not produce an unhandled rejection.
    void this.draining.catch((error) => console.error(MODULE_ID, "События", error));
  }

  async whenIdle() {
    do {
      if (this.admissions.size) await Promise.allSettled([...this.admissions]);
      if (this.draining) await this.draining;
      await Promise.resolve();
    } while (this.draining || this.admissions.size);
  }

  async update(scene, event, patch) {
    if (!isAuthority() || this.disposed) return;
    await withSceneLock(scene, async () => {
      if (!isAuthority() || this.disposed) return;
      const state = getRuntime(scene);
      const claim = state.eventClaims?.[event.id];
      if (!claim) return;
      Object.assign(claim, copy(patch));
      const record = state.eventLog?.find((entry) => entry.id === event.id);
      if (record) Object.assign(record, copy(patch));
      if (patch.error) state.error = patch.error;
      await saveRuntime(scene, state);
    });
    this.onChange(scene);
  }

  async process(scene, event) {
    if (!this.current(scene, event.runId)) { await this.update(scene, event, { status: "stale" }); return; }
    const state = getRuntime(scene);
    const subscriptions = state.episode.stop ? [] : (state.episode.subscriptions ?? []).filter((entry) => entry.enabled !== false && entry.event === event.name);
    await this.update(scene, event, { status: "running" });
    const results = [];
    for (const subscription of subscriptions) {
      if (!this.current(scene, event.runId)) {
        await this.update(scene, event, { status: results.length ? "done" : "stale", results }); return;
      }
      const result = { subscriptionId: subscription.id, status: "pending" };
      results.push(result);
      await this.update(scene, event, { results });
      if (!this.current(scene, event.runId)) return;
      this.context = { chainId: event.chainId, depth: event.depth + 1 };
      try {
        if (subscription.kind === "transition") {
          await this.runtime.enter(scene, subscription.episodeId, { expectedRunId: event.runId, eventContext: this.context });
        } else if (subscription.kind === "macro") {
          await this.executeMacro(subscription.macroUuid, event, scene);
        } else if (subscription.kind === "chat") {
          if (!this.messages) throw new Error("Общий сервис чата Generics недоступен.");
          const audience = eventChatAudience(scene, event, subscription.audience);
          result.recipientCount = audience.userIds.length;
          const token = audience.targetType === "Token" ? audience.target : null;
          const messages = await this.messages.create({
            author: game.user.id, speaker: this.chat.buildChatSpeaker({ actor: token?.actor?.id, token: token?.id,
              scene: scene.id, alias: token?.name || scene.name || "Информатор" }),
            content: `<p>${escapeHTML(subscription.text)}</p>`
          }, { audience: { type: "users", userIds: audience.userIds }, key: `${scene.id}:${state.schemeId}:${event.id}:${subscription.id}`,
            kind: "event-notice", technical: !token, enabled: () => this.current(scene, event.runId) });
          result.messageIds = messages.map((message) => message.id);
        } else throw new Error("Неизвестный исполнитель подписки.");
        result.status = "done";
      } catch (error) {
        result.status = "failed"; result.error = error.message ?? String(error);
        await this.update(scene, event, { status: "failed", error: result.error, results });
        return;
      } finally { this.context = null; }
      await this.update(scene, event, { results });
    }
    await this.update(scene, event, { status: "done", results });
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
    this.context = null;
  }
}
