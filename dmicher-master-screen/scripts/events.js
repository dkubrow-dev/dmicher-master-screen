import { MODULE_ID, randomId } from "./model.js";
import { asArray, getRuntime, getRuntimes, getRuntimeForRun, getDefinitions, isAuthority, requireGM, saveRuntime, withSceneLock } from "./store.js";
import { speechRecipients } from "./effects.js";
import { isExecutionHalted, onExecutionChange } from "./execution.js";
import { EVENT_NAME, getEventCatalog, validateTypedTrigger } from "./event-catalog.js";

const copy = (value) => structuredClone(value);
const MAX_DEPTH = 32;
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
      const context = { chainId: event.chainId, depth: event.depth + 1, originSceneId: scene.id, originRunId: event.runId, originSchemeId: event.schemeId };
      return macro.execute({ trigger: copy(event.trigger), scene, event: copy(event), screen: runtime,
        InvokeDmicherMasterScreenEvent: (name, trigger) => this.invoke(scene, name, trigger, { context }) });
    });
    this.queue = [];
    this.draining = null;
    this.admissions = new Set();
    this.context = null;
    this.chainCounts = new Map();
    this.waitingRuns = new Set();
    this.disposed = false;
  }

  requireAuthority() {
    requireGM();
    if (!isAuthority()) throw new Error("События исполняет выбранный активный полный мастер.");
    if (this.disposed) throw new Error("Обработчик событий остановлен.");
  }

  current(scene, runId) {
    const state = getRuntimeForRun(scene, runId);
    return !this.disposed && isAuthority() && globalThis.canvas?.scene?.id === scene?.id
      && Boolean(state?.episode) && !isExecutionHalted(scene, state);
  }

  invoke(scene, name, trigger, { context = this.context } = {}) {
    this.requireAuthority();
    if (context?.originRunId && (context.originSceneId !== scene?.id || !this.current(scene, context.originRunId))) throw new Error("Вызов события относится к остановленному или прежнему запуску макроса.");
    const catalog = getEventCatalog(scene), event = catalog.events.find((entry) => entry.name === name);
    if (!event) throw new Error("Событие не зарегистрировано в текущей сцене.");
    const payload = validateTypedTrigger(catalog, event, trigger);
    const state = context?.originRunId ? getRuntimeForRun(scene, context.originRunId) : getRuntimes(scene).find((entry) => entry.episode && !entry.episode.stop && !isExecutionHalted(scene, entry));
    if (!state) throw new Error("В сцене нет запущенной схемы. Автоматические события остановлены.");
    return this.emit(scene, { name, trigger: payload, payload, source: "macro", schemeId: state.schemeId, runId: state.runId, context });
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
    const inherited = input.context ?? ((!input.source || input.source === "macro") ? this.context : null);
    const origin = input.runId ? getRuntimeForRun(scene, input.runId) : getRuntime(scene, { schemeId: input.schemeId ?? "main" });
    const catalog = getEventCatalog(scene), catalogEvent = catalog.events.find((entry) => entry.name === input.name);
    let trigger = input.trigger;
    if (trigger && catalogEvent) trigger = validateTypedTrigger(catalog, catalogEvent, trigger);
    else if (catalogEvent) {
      const descriptor = catalog.triggers.find((entry) => entry.eventId === catalogEvent.id);
      trigger = descriptor ? { type: descriptor.name, ...Object.fromEntries(descriptor.parameters.filter((entry) => input.payload?.[entry.name] !== undefined && input.payload?.[entry.name] !== null).map((entry) => [entry.name, input.payload[entry.name]])) } : { type: input.name };
      if (descriptor) trigger = validateTypedTrigger(catalog, catalogEvent, trigger);
    } else trigger = { type: input.name, ...copy(input.payload ?? {}) };
    const event = {
      id: String(input.id ?? randomId()).slice(0, 160), name: input.name,
      source: String(input.source ?? "module").slice(0, 100), actorTokenId: input.actorTokenId ?? null,
      payload: JSON.parse(encoded), trigger, schemeId: origin?.schemeId ?? input.schemeId ?? "main", runId: input.runId ?? origin?.runId ?? "",
      targets: getRuntimes(scene).filter((state) => state.episode && !state.episode.stop && !isExecutionHalted(scene, state)).map((state) => ({ schemeId: state.schemeId, runId: state.runId })),
      chainId: String(inherited?.chainId ?? randomId()).slice(0, 160), depth: Math.max(0, Number(inherited?.depth) || 0),
      handled: input.handled === true, at: this.now(), status: "queued", results: []
    };
    if (!event.id) throw new Error("Нужен ID события.");
    let admitted = false;
    const receipt = await withSceneLock(scene, async () => {
      this.requireAuthority();
      const state = getRuntime(scene, { schemeId: event.schemeId });
      state.eventClaims ??= {}; state.eventLog ??= [];
      if (state.eventClaims[event.id]) return copy(state.eventClaims[event.id]);
      const removable = Object.keys(state.eventClaims).filter((id) => !["queued", "running"].includes(state.eventClaims[id].status));
      while (Object.keys(state.eventClaims).length >= MAX_CLAIMS && removable.length) delete state.eventClaims[removable.shift()];
      if (Object.keys(state.eventClaims).length >= MAX_CLAIMS) throw new Error("Очередь событий заполнена: мастер должен проверить незавершённые действия.");
      if (!this.current(scene, event.runId) || !state.episode) event.status = "stale";
      else if (event.depth >= MAX_DEPTH || (this.chainCounts.get(event.chainId) ?? 0) >= 64) { event.status = "failed"; event.error = "Цепочка событий остановлена: предел 32 вложений или 64 событий."; }
      else if (event.handled) event.status = "observed";
      state.eventClaims[event.id] = copy(event);
      state.eventLog.push(copy(event));
      state.eventLog = state.eventLog.slice(-MAX_LOG);
      if (event.error) state.error = event.error;
      await saveRuntime(scene, state);
      admitted = event.status === "queued";
      if (admitted) this.chainCounts.set(event.chainId, (this.chainCounts.get(event.chainId) ?? 0) + 1);
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
    })().finally(() => { this.draining = null; if (this.queue.length && !this.disposed) this.drain(); else if (!this.admissions.size) this.chainCounts.clear(); });
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
      const state = getRuntime(scene, { schemeId: event.schemeId });
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

  /** Detach an invalidated wait, never the arbitrary JavaScript that was already started. */
  async awaitCurrentRun(scene, runId, operation) {
    let cancel;
    const cancelled = new Promise((resolve) => { cancel = () => resolve({ stale: true }); });
    const check = (reason) => {
      let current = false;
      try { current = this.current(scene, runId); } catch { /* A removed scene or invalid definition invalidates this wait. */ }
      if (reason === "canvas-teardown" || !current) cancel();
    };
    const dispose = onExecutionChange(scene, check);
    this.waitingRuns.add(cancel);
    try {
      check();
      // Both branches settle as values so a detached operation's late rejection is observed.
      const running = Promise.resolve().then(async () => this.current(scene, runId) ? { value: await operation() } : { stale: true })
        .catch((error) => ({ error }));
      const result = await Promise.race([cancelled, running]);
      if (result.error) throw result.error;
      return result;
    } finally { dispose(); this.waitingRuns.delete(cancel); }
  }

  async process(scene, event) {
    if (!this.current(scene, event.runId)) { await this.update(scene, event, { status: "stale" }); return; }
    const state = getRuntime(scene, { schemeId: event.schemeId });
    const catalog = getEventCatalog(scene), descriptor = catalog.events.find((entry) => entry.name === event.name);
    const subscriptions = state.episode.stop ? [] : (descriptor?.subscribers ?? []).filter((entry) => entry.enabled !== false).map((entry) => ({ ...entry, _runId: event.runId, _schemeId: event.schemeId, _catalog: true }));
    for (const target of event.targets ?? [{ schemeId: event.schemeId, runId: event.runId }]) {
      const current = getRuntime(scene, { schemeId: target.schemeId });
      if (current.runId !== target.runId || current.episode?.stop || isExecutionHalted(scene, current)) continue;
      subscriptions.push(...(current.episode?.subscriptions ?? []).filter((entry) => entry.enabled !== false && entry.event === event.name).map((entry) => ({ ...entry, _runId: current.runId, _schemeId: current.schemeId })));
      const routes = getDefinitions(scene).find((entry) => entry.schemeId === target.schemeId)?.episodes.filter((episode) => episode.events.includes(event.name)) ?? [];
      if (routes.length > 1) throw new Error("Событие ведёт в несколько эпизодов одной схемы.");
      if (routes[0]) subscriptions.push({ id: `route:${target.schemeId}:${routes[0].id}`, kind: "transition", episodeId: routes[0].id, _runId: current.runId, _schemeId: current.schemeId });
    }
    await this.update(scene, event, { status: "running" });
    const results = [];
    for (const subscription of subscriptions) {
      if (!this.current(scene, subscription._runId)) continue;
      const result = { subscriptionId: subscription.id, status: "pending" };
      results.push(result);
      await this.update(scene, event, { results });
      if (!this.current(scene, subscription._runId)) continue;
      this.context = { chainId: event.chainId, depth: event.depth + 1, originSceneId: scene.id, originRunId: subscription._runId, originSchemeId: subscription._schemeId };
      try {
        if (subscription.kind === "transition") {
          await this.runtime.enter(scene, subscription.episodeId, { schemeId: subscription._schemeId, expectedRunId: subscription._runId, eventName: event.name, eventContext: this.context });
        } else if (subscription.kind === "macro") {
          const registered = catalog.macros.find((entry) => entry.uuid === subscription.macroUuid);
          const accepted = catalog.triggers.find((entry) => entry.name === event.trigger?.type && entry.eventId === descriptor?.id);
          if (subscription._catalog && (!registered || !accepted || !registered.triggerIds.includes(accepted.id))) throw new Error("Макрос не зарегистрирован как принимающий этот триггер.");
          const outcome = await this.awaitCurrentRun(scene, subscription._runId,
            () => this.executeMacro(subscription.macroUuid, { ...event, runId: subscription._runId, schemeId: subscription._schemeId }, scene));
          if (outcome.stale) {
            result.status = "stale";
            await this.update(scene, event, { status: "stale", results });
            return;
          }
        } else if (subscription.kind === "trigger") {
          const targetTrigger = catalog.triggers.find((entry) => entry.id === subscription.triggerId), targetEvent = catalog.events.find((entry) => entry.id === targetTrigger?.eventId);
          if (!targetTrigger || !targetEvent) throw new Error("Триггер подписки больше не существует.");
          await this.invoke(scene, targetEvent.name, { ...copy(subscription.parameters), type: targetTrigger.name });
        } else if (subscription.kind === "builtin" && subscription.action !== "chat") {
          if (subscription.action === "halt-all") await this.runtime.haltAll(scene);
          else if (subscription.action === "halt-scheme") await this.runtime.halt(scene, { schemeId: subscription.schemeId });
          else if (["pause", "unpause"].includes(subscription.action)) await game.togglePause(subscription.action === "pause", { broadcast: true });
          else throw new Error("Неизвестное встроенное действие.");
        } else if (subscription.kind === "chat" || subscription.kind === "builtin" && subscription.action === "chat") {
          if (!this.messages) throw new Error("Общий сервис чата Generics недоступен.");
          const audience = eventChatAudience(scene, event, subscription.audience);
          result.recipientCount = audience.userIds.length;
          const token = audience.targetType === "Token" ? audience.target : null;
          const messages = await this.messages.create({
            author: game.user.id, speaker: this.chat.buildChatSpeaker({ actor: token?.actor?.id, token: token?.id,
              scene: scene.id, alias: token?.name || scene.name || "Информатор" }),
            content: `<p>${escapeHTML(subscription.text)}</p>`
          }, { audience: { type: "users", userIds: audience.userIds }, key: `${scene.id}:${state.schemeId}:${event.id}:${subscription.id}`,
            kind: "event-notice", technical: !token, enabled: () => this.current(scene, subscription._runId) });
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
    for (const cancel of this.waitingRuns) cancel();
    this.waitingRuns.clear();
    this.queue = [];
    this.context = null;
    this.chainCounts.clear();
  }
}
