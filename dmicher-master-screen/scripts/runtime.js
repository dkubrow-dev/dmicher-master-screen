import { MODULE_ID, getEpisode, canTransition, emptyRuntime } from "./model.js";
import { getDefinition, getRuntime, saveRuntime, withSceneLock, requireGM, isAuthority, asArray } from "./store.js";
import { createFoundryEffects, tokenCenter, sceneDistance, crossesRectangle, setTokenEmoji, clearTokenEmojis } from "./effects.js";
import { getTriggerKey, getTriggerGate, consumeTrigger, resetEpisodeTriggerCounts } from "./triggers.js";
import { executionGeneration, requestHalt, finishHalt, isExecutionHalted } from "./execution.js";

const clone = (value) => structuredClone(value);
const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID();

/** A small, scene-owned executor. Persisted entry claims are never replayed on connection. */
export class EpisodeRuntime {
  constructor({ onChange = () => {}, onWorkspace = async () => {}, onEvent = async () => {}, chat, effects, now = () => Date.now() } = {}) {
    this.onChange = onChange;
    this.onWorkspace = onWorkspace;
    this.onEvent = onEvent;
    this.effects = effects ?? createFoundryEffects(chat ?? globalThis.game?.modules?.get("dmicher-generics")?.api?.chat);
    this.now = now;
    this.hooks = [];
    this.previousPositions = new Map();
    this.tickTimes = new Map();
    this.macroJobs = new Map();
    this.busy = false;
    this.disposed = false;
  }

  start() {
    if (this.interval) return this;
    this.disposed = false;
    const on = (name, callback) => this.hooks.push([name, Hooks.on(name, callback)]);
    on("canvasReady", () => { this.tickTimes.clear(); this.refresh(canvas.scene); });
    on("canvasTearDown", () => { this.tickTimes.clear(); clearTokenEmojis(); });
    on("updateScene", (scene, changes) => {
      if (changes.flags?.[MODULE_ID] || Object.keys(changes).some((key) => key.startsWith(`flags.${MODULE_ID}`))) this.refresh(scene);
    });
    on("refreshToken", (token) => this.refreshToken(token.document));
    on("destroyToken", (token) => setTokenEmoji(token, ""));
    on("preUpdateToken", (token, changes) => {
      if (("x" in changes) || ("y" in changes)) this.previousPositions.set(token.uuid, tokenCenter(token, token.parent));
    });
    on("updateToken", (token, changes) => {
      if (!("x" in changes) && !("y" in changes)) return;
      const previous = this.previousPositions.get(token.uuid);
      this.previousPositions.delete(token.uuid);
      if (previous) void this.onTokenMove(token, previous).catch((error) => this.report(error));
    });
    this.interval = setInterval(() => { void this.tick().catch((error) => this.report(error)); }, 500);
    this.refresh(globalThis.canvas?.scene);
    return this;
  }

  dispose() {
    this.disposed = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = [];
    this.previousPositions.clear();
    this.tickTimes.clear();
    this.macroJobs.clear();
    clearTokenEmojis();
  }

  report(error) {
    console.error(MODULE_ID, error);
    globalThis.ui?.notifications?.error?.(error.message ?? String(error));
  }

  emitEvent(scene, event) {
    const snapshot = { source: "runtime", ...event };
    queueMicrotask(() => {
      if (this.disposed || !isAuthority()) return;
      void Promise.resolve().then(() => this.onEvent(scene, snapshot)).catch((error) => this.report(error));
    });
  }

  owns(scene, runId) {
    return Boolean(scene?.id) && !this.disposed && isAuthority() && globalThis.canvas?.scene?.id === scene.id
      && !isExecutionHalted(scene)
      && (!runId || getRuntime(scene).runId === runId);
  }

  requireAuthority(scene) {
    requireGM();
    if (!isAuthority()) throw new Error("Исполнение доступно на клиенте выбранного активного мастера (первый полный ГМ по ID).");
    if (globalThis.canvas?.scene?.id !== scene?.id) throw new Error("Для исполнения откройте карту этой сцены.");
  }

  isTokenEnabled(state, id) {
    return !state.halted && !state.episode?.stop && state.episode?.tokens?.[id]?.enabled !== false && !state.disabledTokens.includes(id);
  }

  async refresh(scene) {
    if (!scene || globalThis.canvas?.scene?.id !== scene.id) return;
    for (const token of asArray(scene.tokens)) this.refreshToken(token);
    this.onChange(scene, getRuntime(scene));
  }

  refreshToken(token) {
    if (!token?.parent || globalThis.canvas?.scene?.id !== token.parent.id) return;
    const state = getRuntime(token.parent);
    const config = state.episode?.tokens?.[token.id];
    setTokenEmoji(token, config && !isExecutionHalted(token.parent, state) && this.isTokenEnabled(state, token.id) ? config.emoji : "");
  }

  async enter(scene, episodeId, { force = false, expectedRunId, eventContext, schemeId = "main" } = {}) {
    this.requireAuthority(scene);
    if (schemeId !== "main") throw new Error("В версии 0.0.1 доступна основная схема.");
    const generation = executionGeneration(scene);
    let entered;
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const previous = getRuntime(scene);
      if (executionGeneration(scene) !== generation) return null;
      const resuming = isExecutionHalted(scene, previous) && force && !expectedRunId;
      if (isExecutionHalted(scene, previous) && !resuming) throw new Error("Схема аварийно остановлена. Выберите эпизод и явно возобновите её.");
      if (expectedRunId && previous.runId !== expectedRunId) return null;
      if (previous.episodeId === episodeId && !force) return previous;
      const definition = getDefinition(scene);
      const episode = getEpisode(definition, episodeId);
      if (!episode) throw new Error("Эпизод не найден.");
      if (!resuming && previous.episodeId !== episodeId && !canTransition(definition, previous.episodeId, episodeId)) throw new Error("Переход к этому эпизоду запрещён графом.");
      const state = {
        ...emptyRuntime(), schemeId: definition.schemeId, episodeId, runId: randomId(), enteredAt: this.now(),
        definitionRevision: definition.revision, disabledTokens: [...previous.disabledTokens], episode: clone(episode),
        shops: clone(previous.shops), tradeRequests: clone(previous.tradeRequests ?? {}), shopSessions: {},
        eventLog: clone(previous.eventLog ?? []), eventClaims: clone(previous.eventClaims ?? {}),
        dialogueSessions: {}, dialogueCommands: clone(previous.dialogueCommands ?? {}), triggerCounts: clone(previous.triggerCounts ?? {}),
        triggerEnabledOverrides: clone(previous.triggerEnabledOverrides ?? {})
      };
      resetEpisodeTriggerCounts(state, episode);
      for (const [id, config] of Object.entries(episode.tokens)) {
        state.speech[id] = { nextAt: this.now() + Number(config.speech?.interval ?? 30) * 1000, sequence: 0 };
        state.patrol[id] = { index: 0 };
        state.shops[id] ??= { items: clone(config.shop?.items ?? []) };
      }
      // Persist the new generation before touching the world. Reconnect only resumes this snapshot.
      await saveRuntime(scene, state);
      if (executionGeneration(scene) !== generation) return getRuntime(scene);
      finishHalt(scene, generation);
      this.tickTimes.set(scene.id, this.now());
      await this.refresh(scene);
      await this.once(scene, state.runId, "workspace", () => this.onWorkspace(scene, clone(episode.workspace), { runId: state.runId }));
      if (!episode.stop) {
        for (const [id, config] of Object.entries(episode.tokens)) {
          if (!this.currentToken(scene, state.runId, id)) continue;
          const token = scene.tokens.get(id);
          if (!token) continue;
          const changes = {};
          if (config.position) Object.assign(changes, { x: config.position.x, y: config.position.y });
          if (typeof config.hidden === "boolean") changes.hidden = config.hidden;
          if (Object.keys(changes).length) await this.once(scene, state.runId, `placement:${id}`, () => token.update(changes, { animate: false }));
          if (config.entrySpeech?.trim()) await this.once(scene, state.runId, `speech:${id}`, () => this.effects.speak(scene, token, config.entrySpeech, config.speech, `${scene.id}:${state.schemeId}:${state.runId}:entry:${id}`, () => this.currentToken(scene, state.runId, id)));
        }
        if (episode.pause) await this.once(scene, state.runId, "pause", () => game.togglePause(true, { broadcast: true }));
        if (episode.sound) await this.once(scene, state.runId, "sound", () => this.effects.sound(episode.sound));
        for (const spawn of episode.spawns) await this.once(scene, state.runId, `spawn:${spawn.id}`, () => this.effects.spawn(scene, spawn, state.runId, () => this.owns(scene, state.runId)));
      }
      await this.refresh(scene);
      entered = { name: "episode.entered", runId: state.runId, context: eventContext,
        payload: { episodeId, previousEpisodeId: previous.episodeId, schemeId: state.schemeId } };
      return getRuntime(scene);
    }).then((state) => { if (entered) this.emitEvent(scene, entered); return state; });
  }

  async halt(scene, { schemeId = "main", all = false } = {}) {
    this.requireAuthority(scene);
    if (schemeId !== "main") throw new Error("В версии 0.0.1 доступна основная схема.");
    const generation = requestHalt(scene);
    this.tickTimes.delete(scene.id);
    for (const token of asArray(scene.tokens)) setTokenEmoji(token, "");
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const state = getRuntime(scene);
      state.halted = true;
      state.haltedAt = this.now();
      // Preserve the episode, NPC/world facts and pending receipts for diagnosis.
      await saveRuntime(scene, state);
      finishHalt(scene, generation);
      await this.refresh(scene);
      return state;
    });
  }

  haltAll(scene) { return this.halt(scene, { schemeId: "main", all: true }); }

  currentToken(scene, runId, tokenId) {
    if (!this.owns(scene, runId)) return false;
    return Boolean(scene.tokens.get(tokenId)) && this.isTokenEnabled(getRuntime(scene), tokenId);
  }

  async once(scene, runId, key, operation) {
    if (!this.owns(scene, runId)) return;
    let state = getRuntime(scene);
    if (state.effects[key]) return;
    state.effects[key] = { status: "pending", at: this.now() };
    await saveRuntime(scene, state);
    if (!this.owns(scene, runId)) return;
    let result, error;
    try { result = await operation(); }
    catch (cause) { error = cause; }
    if (!this.owns(scene, runId)) return;
    state = getRuntime(scene);
    state.effects[key] = { status: error ? "failed" : "done", at: this.now(), ...(error ? { error: error.message ?? String(error) } : {}) };
    if (error) state.error = `${key}: ${error.message ?? String(error)}`;
    await saveRuntime(scene, state);
    if (error) this.report(error);
    return result;
  }

  async setAutomation(scene, tokenId, enabled) {
    this.requireAuthority(scene);
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      if (!scene.tokens.get(tokenId)) throw new Error("Токен не найден.");
      const state = getRuntime(scene);
      state.disabledTokens = state.disabledTokens.filter((id) => id !== tokenId);
      if (!enabled) state.disabledTokens.push(tokenId);
      if (enabled && state.episode?.tokens?.[tokenId]) {
        state.speech[tokenId] = { ...state.speech[tokenId], nextAt: this.now() + Number(state.episode.tokens[tokenId].speech.interval) * 1000 };
      }
      await saveRuntime(scene, state);
      await this.refresh(scene);
      return state;
    }).then((state) => {
      this.emitEvent(scene, { name: "automation.changed", runId: state.runId, actorTokenId: tokenId, payload: { tokenId, enabled: Boolean(enabled) } });
      return state;
    });
  }

  async resetTriggers(scene, { triggerKey } = {}) {
    this.requireAuthority(scene);
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const state = getRuntime(scene), prefix = `${state.schemeId ?? "main"}:`;
      if (triggerKey && !triggerKey.startsWith(prefix)) throw new Error("Счётчик относится к другой схеме.");
      state.triggerCounts ??= {};
      if (triggerKey) delete state.triggerCounts[triggerKey];
      else for (const key of Object.keys(state.triggerCounts)) if (key.startsWith(prefix)) delete state.triggerCounts[key];
      await saveRuntime(scene, state);
      await this.refresh(scene);
      return state;
    });
  }

  resetTriggerCounter(scene, triggerKey) { return this.resetTriggers(scene, { triggerKey }); }

  async setTriggerEnabled(scene, triggerKey, enabled) {
    this.requireAuthority(scene);
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const state = getRuntime(scene);
      if (!triggerKey?.startsWith(`${state.schemeId ?? "main"}:${state.episodeId}:`)) throw new Error("Триггер относится к другому эпизоду или схеме.");
      if (typeof enabled !== "boolean") throw new Error("Укажите включённое или выключенное состояние.");
      state.triggerEnabledOverrides ??= {};
      state.triggerEnabledOverrides[triggerKey] = enabled;
      await saveRuntime(scene, state);
      await this.refresh(scene);
      return state;
    });
  }

  async tick() {
    const scene = globalThis.canvas?.scene;
    if (this.busy || !this.owns(scene)) return;
    const state = getRuntime(scene);
    if (!state.episode || state.episode.stop || game.paused) { this.tickTimes.set(scene.id, this.now()); return; }
    this.busy = true;
    let transition;
    try {
      transition = await withSceneLock(scene, async () => {
        if (!this.owns(scene, state.runId)) return null;
        const elapsed = Math.min(1, Math.max(0, (this.now() - (this.tickTimes.get(scene.id) ?? this.now())) / 1000));
        this.tickTimes.set(scene.id, this.now());
        for (const [id, config] of Object.entries(state.episode.tokens)) {
          if (!this.currentToken(scene, state.runId, id)) continue;
          const token = scene.tokens.get(id);
          if (config.speech?.phrases?.length && Number(config.speech.interval) > 0) await this.speechTick(scene, state.runId, token, config);
          if (!this.currentToken(scene, state.runId, id)) continue;
          if (config.patrol?.enabled && config.patrol.points.length) {
            const macroJob = await this.patrolTick(scene, state.runId, token, config, elapsed);
            if (macroJob) return macroJob;
          }
        }
        return null;
      });
    } finally { this.busy = false; }
    // A world macro is not cancellable JavaScript. Await it outside the scene lock so Stop
    // and token overrides remain immediately available; stale results cannot transition.
    if (transition) {
      try {
        if (!this.currentToken(scene, transition.runId, transition.token.id)) return;
        const result = await this.effects.macro(transition.uuid, transition);
        let handled = false;
        if (result === true && transition.target && this.currentToken(scene, transition.runId, transition.token.id)) {
          await this.enter(scene, transition.target, { expectedRunId: transition.runId });
          handled = true;
        }
        this.emitEvent(scene, { name: "patrol.check", runId: transition.runId, actorTokenId: transition.token.id, handled,
          payload: { result: result === true, macroUuid: transition.uuid, directRoute: handled, targetEpisodeId: transition.target || "" } });
      } catch (error) { await withSceneLock(scene, () => this.disableAfterError(scene, transition.runId, transition.token.id, error)); }
      finally {
        if (this.macroJobs.get(transition.key) === transition) this.macroJobs.delete(transition.key);
      }
    }
  }

  async speechTick(scene, runId, token, config) {
    const state = getRuntime(scene);
    const clock = state.speech[token.id] ?? { nextAt: this.now() + Number(config.speech.interval) * 1000, sequence: 0 };
    if (Number(clock.nextAt) > this.now()) return;
    const sequence = Number(clock.sequence ?? 0) + 1;
    state.speech[token.id] = { nextAt: this.now() + Number(config.speech.interval) * 1000, sequence };
    // Claim this occurrence first. Missed time is never caught up in a burst after reconnect.
    await saveRuntime(scene, state);
    if (!this.currentToken(scene, runId, token.id)) return;
    const phrases = config.speech.phrases;
    const phrase = phrases[Math.floor(Math.random() * phrases.length)];
    try {
      await this.effects.speak(scene, token, phrase, config.speech, `${scene.id}:${state.schemeId}:${runId}:periodic:${token.id}:${sequence}`, () => this.currentToken(scene, runId, token.id));
    } catch (error) { await this.saveError(scene, runId, error); }
  }

  async patrolTick(scene, runId, token, config, elapsed) {
    const key = `${scene.id}:${getRuntime(scene).schemeId}:${runId}:${token.id}`;
    if (this.macroJobs.has(key)) return null;
    const state = getRuntime(scene), route = config.patrol;
    if (state.patrol[token.id]?.completed) return null;
    const index = Number(state.patrol[token.id]?.index ?? 0) % route.points.length;
    const point = route.points[index];
    const distance = Math.hypot(point.x - token.x, point.y - token.y);
    const step = Number(route.speed) * Number(scene.grid?.size || 100) / Number(scene.grid?.distance || 1) * elapsed;
    if (step <= 0) return null;
    const arrived = distance <= step;
    const target = arrived ? { x: point.x, y: point.y } : {
      x: token.x + (point.x - token.x) * step / distance,
      y: token.y + (point.y - token.y) * step / distance
    };
    const origin = tokenCenter(token, scene);
    const destination = { x: origin.x + target.x - token.x, y: origin.y + target.y - token.y };
    if (token.object?.checkCollision?.(destination, { origin, type: "move", mode: "any" })) {
      await this.disableAfterError(scene, runId, token.id, new Error(`Патруль «${token.name}» остановлен стеной. Отключена автоматизация токена.`));
      return null;
    }
    try { await token.update(target, { animate: true, animation: { duration: 500 } }); }
    catch (error) { await this.disableAfterError(scene, runId, token.id, error); return null; }
    if (!arrived || !this.currentToken(scene, runId, token.id)) return null;
    const fresh = getRuntime(scene);
    fresh.patrol[token.id] = { index: (index + 1) % route.points.length, completed: route.points.length === 1 };
    await saveRuntime(scene, fresh);
    this.emitEvent(scene, { name: "patrol.arrived", runId, actorTokenId: token.id, payload: { pointIndex: index, x: point.x, y: point.y } });
    if (!point.macroUuid || !this.currentToken(scene, runId, token.id)) return null;
    const job = { key, uuid: point.macroUuid, scene, token, episode: clone(state.episode), runId, target: point.onTrue,
      isCurrent: () => this.currentToken(scene, runId, token.id) };
    this.macroJobs.set(key, job);
    return job;
  }

  async saveError(scene, runId, error) {
    if (!this.owns(scene, runId)) return;
    const state = getRuntime(scene);
    state.error = error.message ?? String(error);
    await saveRuntime(scene, state);
    this.report(error);
  }

  async disableAfterError(scene, runId, tokenId, error) {
    if (!this.owns(scene, runId)) return;
    const state = getRuntime(scene);
    if (!state.disabledTokens.includes(tokenId)) state.disabledTokens.push(tokenId);
    state.error = error.message ?? String(error);
    await saveRuntime(scene, state);
    this.report(error);
    await this.refresh(scene);
  }

  async onTokenMove(token, previous) {
    const scene = token.parent;
    if (!this.owns(scene) || game.paused) return;
    const runId = getRuntime(scene).runId;
    const admitted = await withSceneLock(scene, async () => {
      if (!this.owns(scene, runId)) return null;
      const state = getRuntime(scene);
      if (!state.episode || state.episode.stop) return null;
      const playerOwned = asArray(game.users).some((user) => Number(user.role) >= 1 && Number(user.role) <= 2 && token.actor?.testUserPermission?.(user, "OWNER"));
      if (!playerOwned) return null;
      const next = tokenCenter(token, scene);
      for (const zone of state.episode.zones) {
        if (!crossesRectangle(previous, next, zone)) continue;
        const key = getTriggerKey(state, "zone", zone.id);
        if (!getTriggerGate(scene, state, zone.trigger, token, { triggerKey: key }).allowed) continue;
        if (zone.targetEpisodeId && !canTransition(getDefinition(scene), state.episodeId, zone.targetEpisodeId)) continue;
        consumeTrigger(state, key, zone.trigger);
        await saveRuntime(scene, state);
        return { state, zone };
      }
      return null;
    });
    if (admitted) {
      const { state, zone } = admitted;
      if (zone.targetEpisodeId) await this.enter(scene, zone.targetEpisodeId, { expectedRunId: state.runId });
      this.emitEvent(scene, { name: "zone.entered", runId: state.runId, actorTokenId: token.id, handled: Boolean(zone.targetEpisodeId),
        payload: { zoneId: zone.id, label: zone.label, directRoute: Boolean(zone.targetEpisodeId), targetEpisodeId: zone.targetEpisodeId || "" } });
    }
  }

  async interact(scene, tokenId, { sourceTokenId, user = game.user } = {}) {
    this.requireAuthority(scene);
    const admission = await withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const currentUser = game.users.get(user?.id);
      const state = getRuntime(scene), npc = scene.tokens.get(tokenId), config = state.episode?.tokens?.[tokenId];
      if (!currentUser || !npc || !config || !this.currentToken(scene, state.runId, tokenId)) throw new Error("Взаимодействие сейчас недоступно.");
      const source = scene.tokens.get(sourceTokenId);
      if (!currentUser.isGM) {
        if (npc.hidden || !source?.actor?.testUserPermission?.(currentUser, "OWNER")) throw new Error("Нет права взаимодействовать этим персонажем.");
        if (sceneDistance(scene, tokenCenter(source, scene), tokenCenter(npc, scene)) > Number(scene.grid?.distance || 1) * 2) throw new Error("Для взаимодействия подойдите к НИП на две клетки.");
      }
      const key = getTriggerKey(state, "npc-interaction", tokenId), policy = config.interaction?.trigger;
      const gate = getTriggerGate(scene, state, policy, source, { triggerKey: key });
      if (!gate.allowed) throw new Error(gate.reason);
      if (config.interaction?.targetEpisodeId && !canTransition(getDefinition(scene), state.episodeId, config.interaction.targetEpisodeId)) throw new Error("Переход к этому эпизоду запрещён графом.");
      consumeTrigger(state, key, policy);
      await saveRuntime(scene, state);
      return { state, config, currentUser };
    });
    const { state, config, currentUser } = admission;
    const target = config.interaction?.targetEpisodeId;
    const result = target ? await this.enter(scene, target, { expectedRunId: state.runId }) : state;
    this.emitEvent(scene, { name: "npc.interacted", runId: state.runId, actorTokenId: sourceTokenId ?? null, handled: Boolean(target),
      payload: { tokenId, userId: currentUser.id, directRoute: Boolean(target), targetEpisodeId: target || "" } });
    return result;
  }

  async startCombat(scene, { rollInitiative = true } = {}) {
    this.requireAuthority(scene);
    const CombatClass = globalThis.CONFIG?.Combat?.documentClass ?? globalThis.foundry?.documents?.Combat;
    if (!CombatClass?.create) throw new Error("Документ боя Foundry недоступен.");
    let combat = asArray(game.combats).find((entry) => (entry.scene?.id ?? entry.scene) === scene.id);
    if (!combat) combat = await CombatClass.create({ scene: scene.id, active: true });
    const selected = asArray(globalThis.canvas?.tokens?.controlled).map((token) => token.document);
    const tokens = (selected.length ? selected : asArray(scene.tokens)).filter((token) => token.actor);
    const existing = new Set(asArray(combat.combatants).map((entry) => entry.tokenId));
    const additions = tokens.filter((token) => !existing.has(token.id)).map((token) => ({ tokenId: token.id, actorId: token.actor.id, hidden: Boolean(token.hidden) }));
    if (additions.length) await combat.createEmbeddedDocuments("Combatant", additions);
    await combat.activate?.();
    if (rollInitiative) await combat.rollAll();
    if (!combat.started) await combat.startCombat();
    return combat;
  }
}
