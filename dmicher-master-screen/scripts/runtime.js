import { MODULE_ID, getEpisode, emptyRuntime } from "./model.js";
import { getDefinition, getDefinitions, getRuntime, getRuntimes, getRuntimeForRun, saveRuntime, withSceneLock, requireGM, isAuthority, asArray } from "./store.js";
import { createFoundryEffects, tokenCenter, crossesRectangle, setTokenEmoji, clearTokenEmojis } from "./effects.js";
import { getTriggerKey, getTriggerGate, consumeTrigger, resetEpisodeTriggerCounts } from "./triggers.js";
import { executionGeneration, requestHalt, finishHalt, isExecutionHalted, notifyExecutionChange } from "./execution.js";
import { materializeEpisode, getSceneObject, getObjectBindings } from "./scene-objects.js";
import { objectKey } from "./interaction-access.js";
import { isInteractionPaused, freezeInteractionClock } from "./interaction-pause.js";
import { TokenRoutineRuntime } from "./routine-runtime.js";

const clone = (value) => structuredClone(value);
const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID();

/** A small, scene-owned executor. Persisted entry claims are never replayed on connection. */
export class EpisodeRuntime {
  constructor({ onChange = () => {}, onWorkspace = async () => {}, onEvent = async () => {}, onTypedEvent, chat, effects, now = () => Date.now() } = {}) {
    this.onChange = onChange;
    this.onWorkspace = onWorkspace;
    this.onEvent = onEvent;
    this.onTypedEvent = onTypedEvent;
    this.effects = effects ?? createFoundryEffects(chat ?? globalThis.game?.modules?.get("dmicher-generics")?.api?.chat);
    this.now = now;
    this.hooks = [];
    this.previousPositions = new Map();
    this.tickTimes = new Map();
    this.busy = false;
    this.disposed = false;
    this.routines = new TokenRoutineRuntime(this);
  }

  start() {
    if (this.interval) return this;
    this.disposed = false;
    const on = (name, callback) => this.hooks.push([name, Hooks.on(name, callback)]);
    on("canvasReady", () => { this.tickTimes.clear(); this.refresh(canvas.scene); });
    on("canvasTearDown", () => { notifyExecutionChange(globalThis.canvas?.scene, "canvas-teardown"); this.tickTimes.clear(); clearTokenEmojis(); });
    on("updateUser", () => notifyExecutionChange(globalThis.canvas?.scene));
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
    this.routines.dispose();
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
      void Promise.resolve().then(() => this.disposed || !isAuthority() ? undefined : this.onEvent(scene, snapshot))
        .catch((error) => { if (!this.disposed) this.report(error); });
    });
  }

  owns(scene, runId, schemeId) {
    const state = runId ? getRuntimeForRun(scene, runId) : schemeId ? getRuntime(scene, { schemeId }) : null;
    return Boolean(scene?.id) && !this.disposed && isAuthority() && globalThis.canvas?.scene?.id === scene.id
      && (!runId || state) && (state ? !isExecutionHalted(scene, state) : getRuntimes(scene).some((entry) => !isExecutionHalted(scene, entry)));
  }

  requireAuthority(scene) {
    requireGM();
    if (!isAuthority()) throw new Error("Исполнение доступно на клиенте выбранного активного мастера (первый полный ГМ по ID).");
    if (globalThis.canvas?.scene?.id !== scene?.id) throw new Error("Для исполнения откройте карту этой сцены.");
  }

  isTokenEnabled(state, id) {
    return Boolean(state?.episode?.tokens?.[id]) && !state.halted && !state.episode.stop && state.episode.tokens[id].enabled !== false && !state.disabledTokens.includes(id);
  }

  async refresh(scene) {
    notifyExecutionChange(scene);
    if (!scene || globalThis.canvas?.scene?.id !== scene.id) return;
    for (const token of asArray(scene.tokens)) this.refreshToken(token);
    this.onChange(scene, getRuntime(scene));
  }

  refreshToken(token) {
    if (!token?.parent || globalThis.canvas?.scene?.id !== token.parent.id) return;
    const binding = getObjectBindings(token.parent).bindings[`Token:${token.id}`];
    const state = getRuntimes(token.parent).find((entry) => entry.episode?.tokens?.[token.id] && !isExecutionHalted(token.parent, entry) && this.isTokenEnabled(entry, token.id)
      && binding && !binding.playerCharacter && binding.schemeId === entry.schemeId);
    if (!state) { setTokenEmoji(token, ""); return; }
    const config = state.episode?.tokens?.[token.id];
    setTokenEmoji(token, config && !isExecutionHalted(token.parent, state) && this.isTokenEnabled(state, token.id) ? state.routineStates?.[token.id]?.emoji ?? "" : "");
  }

  async enter(scene, episodeId, { force = false, expectedRunId, eventContext, eventName, schemeId = "main" } = {}) {
    this.requireAuthority(scene);
    const generation = executionGeneration(scene, schemeId);
    let entered;
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const previous = getRuntime(scene, { schemeId });
      if (executionGeneration(scene, schemeId) !== generation) return null;
      const resuming = isExecutionHalted(scene, previous) && force && !expectedRunId;
      if (isExecutionHalted(scene, previous) && !resuming) throw new Error("Схема аварийно остановлена. Выберите эпизод и явно возобновите её.");
      if (expectedRunId && previous.runId !== expectedRunId) return null;
      if (previous.episodeId === episodeId && !force) return previous;
      const definition = getDefinition(scene, { schemeId });
      episodeId ??= definition.entryEpisodeId ?? definition.episodes[0]?.id;
      const prepared = getEpisode(definition, episodeId);
      if (!prepared) throw new Error("Эпизод не найден.");
      const episode = materializeEpisode(scene, definition, prepared);
      if (expectedRunId && (!eventName || !episode.events.includes(eventName))) throw new Error("Автоматический переход не разрешён таблицей событий эпизода.");
      const managed = new Set(Object.entries(episode.tokens).filter(([id, config]) => config.enabled !== false && !previous.disabledTokens.includes(id) && !episode.stop).map(([id]) => id));
      const conflict = getRuntimes(scene).find((entry) => entry.schemeId !== schemeId && !isExecutionHalted(scene, entry) && !entry.episode?.stop
        && Object.keys(entry.episode?.tokens ?? {}).some((id) => managed.has(id) && this.isTokenEnabled(entry, id)));
      if (conflict) throw new Error(`Токен уже управляется схемой «${getDefinition(scene, { schemeId: conflict.schemeId }).schemeName}». Отключите его автоматизацию в одной из схем.`);
      const state = {
        ...emptyRuntime(), schemeId: definition.schemeId, episodeId, runId: randomId(), enteredAt: this.now(),
        definitionRevision: definition.revision, disabledTokens: [...previous.disabledTokens], episode: clone(episode),
        shops: clone(previous.shops), tradeRequests: clone(previous.tradeRequests ?? {}),
        shopSessions: Object.fromEntries(Object.entries(previous.shopSessions ?? {}).filter(([, session]) => session.status === "pending")),
        objectEntries: clone(previous.objectEntries ?? {}),
        routineStates: {}, interactionClocks: {},
        eventLog: clone(previous.eventLog ?? []), eventClaims: clone(previous.eventClaims ?? {}),
        dialogueSessions: {}, dialogueCommands: clone(previous.dialogueCommands ?? {}), triggerCounts: clone(previous.triggerCounts ?? {}),
        triggerEnabledOverrides: clone(previous.triggerEnabledOverrides ?? {})
      };
      resetEpisodeTriggerCounts(state, episode);
      for (const routine of episode.routines ?? []) state.routineStates[routine.target.id] = { stepId: routine.steps.length ? 1 : null,
        status: routine.steps.length ? "ready" : "done", sequence: 0, remainingMs: null, waitStepId: null, nextStepId: null, emoji: "" };
      for (const config of episode.shops ?? []) {
        const shopId = config.shopId;
        const sharedInventory = scene.getFlag(MODULE_ID, "shopInventories")?.[shopId];
        state.shops[shopId] = sharedInventory ? clone(sharedInventory) : state.shops[shopId] ?? { items: clone(config.items ?? []) };
      }
      // Persist the new generation before touching the world. Reconnect only resumes this snapshot.
      await saveRuntime(scene, state);
      notifyExecutionChange(scene);
      if (executionGeneration(scene, schemeId) !== generation) return getRuntime(scene, { schemeId });
      finishHalt(scene, generation, schemeId);
      this.tickTimes.set(`${scene.id}:${schemeId}`, this.now());
      await this.refresh(scene);
      await this.once(scene, state.runId, "workspace", () => this.onWorkspace(scene, clone(episode.workspace), { runId: state.runId, schemeId }));
      if (!episode.stop) {
        for (const config of episode.objects ?? []) {
          const key = objectKey(config.target), target = getSceneObject(scene, config.target);
          if (!target || (config.target.type === "Token" && state.disabledTokens.includes(config.target.id))) continue;
          if (config.target.type === "Token" && isInteractionPaused(scene, config.target.id)) continue;
          // Entry preparation is claimed in persistent state before any document change.
          // A reconnect and later explicit episode transitions never repeat this first placement.
          if (!state.objectEntries[key]) {
            state.objectEntries[key] = true;
            const current = getRuntimeForRun(scene, state.runId);
            if (!current || !this.owns(scene, state.runId)) break;
            current.objectEntries = clone(state.objectEntries);
            await saveRuntime(scene, current);
            await this.once(scene, state.runId, `object-entry:${key}`, () => this.applyObjectState(target, config.entry));
          }
          await this.once(scene, state.runId, `object-transition:${key}`, () => this.applyObjectState(target, config.transition));
        }
        if (episode.pause) await this.once(scene, state.runId, "pause", () => game.togglePause(true, { broadcast: true }));
        if (episode.sound) await this.once(scene, state.runId, "sound", () => this.effects.sound(episode.sound));
        for (const spawn of episode.spawns) await this.once(scene, state.runId, `spawn:${spawn.id}`, () => this.effects.spawn(scene, spawn, state.runId, () => this.owns(scene, state.runId)));
      }
      await this.refresh(scene);
      entered = { name: "episode.entered", runId: state.runId, schemeId, context: eventContext,
        payload: { episodeId, previousEpisodeId: previous.episodeId, schemeId: state.schemeId } };
      return getRuntime(scene, { schemeId });
    }).then((state) => { if (entered) this.emitEvent(scene, entered); return state; });
  }

  async halt(scene, { schemeId = "main", all = false } = {}) {
    this.requireAuthority(scene);
    const ids = all ? getDefinitions(scene).map((entry) => entry.schemeId) : [getDefinition(scene, { schemeId }).schemeId];
    const generations = new Map(ids.map((id) => [id, requestHalt(scene, id)]));
    for (const id of ids) this.tickTimes.delete(`${scene.id}:${id}`);
    for (const token of asArray(scene.tokens)) this.refreshToken(token);
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const states = [];
      for (const id of ids) {
        const state = getRuntime(scene, { schemeId: id });
        state.halted = true; state.haltedAt = this.now();
        await saveRuntime(scene, state);
        finishHalt(scene, generations.get(id), id); states.push(state);
      }
      await this.refresh(scene);
      return all ? states : states[0];
    });
  }

  haltAll(scene) { return this.halt(scene, { schemeId: "main", all: true }); }

  applyObjectState(target, placement) {
    if (!placement) return;
    const changes = {};
    if (placement.position) Object.assign(changes, { x: placement.position.x, y: placement.position.y });
    if (typeof placement.hidden === "boolean") changes.hidden = placement.hidden;
    if (Object.keys(changes).length) return target.update(changes, { animate: false });
  }

  currentToken(scene, runId, tokenId, { ignoreInteractionPause = false } = {}) {
    if (!this.owns(scene, runId)) return false;
    const state = getRuntimeForRun(scene, runId), binding = getObjectBindings(scene).bindings[`Token:${tokenId}`];
    if (!binding || binding.playerCharacter || binding.schemeId !== state.schemeId) return false;
    if (!ignoreInteractionPause && isInteractionPaused(scene, tokenId)) return false;
    return Boolean(scene.tokens.get(tokenId)) && this.isTokenEnabled(state, tokenId);
  }

  async once(scene, runId, key, operation) {
    if (!this.owns(scene, runId)) return;
    let state = getRuntimeForRun(scene, runId);
    if (state.effects[key]) return;
    state.effects[key] = { status: "pending", at: this.now() };
    await saveRuntime(scene, state);
    if (!this.owns(scene, runId)) return;
    let result, error;
    try { result = await operation(); }
    catch (cause) { error = cause; }
    if (!this.owns(scene, runId)) return;
    state = getRuntimeForRun(scene, runId);
    state.effects[key] = { status: error ? "failed" : "done", at: this.now(), ...(error ? { error: error.message ?? String(error) } : {}) };
    if (error) state.error = `${key}: ${error.message ?? String(error)}`;
    await saveRuntime(scene, state);
    if (error) this.report(error);
    return result;
  }

  async setAutomation(scene, tokenId, enabled, { schemeId = "main" } = {}) {
    this.requireAuthority(scene);
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      if (!scene.tokens.get(tokenId)) throw new Error("Токен не найден.");
      const state = getRuntime(scene, { schemeId });
      if (enabled && getRuntimes(scene).some((entry) => entry.schemeId !== schemeId && entry.episode?.tokens?.[tokenId] && this.isTokenEnabled(entry, tokenId) && !isExecutionHalted(scene, entry))) throw new Error("Токен уже управляется другой схемой.");
      state.disabledTokens = state.disabledTokens.filter((id) => id !== tokenId);
      if (!enabled) state.disabledTokens.push(tokenId);
      await saveRuntime(scene, state);
      await this.refresh(scene);
      return state;
    }).then((state) => {
      this.emitEvent(scene, { name: "automation.changed", runId: state.runId, actorTokenId: tokenId, payload: { tokenId, enabled: Boolean(enabled) } });
      return state;
    });
  }

  async resetTriggers(scene, { triggerKey, schemeId = "main" } = {}) {
    this.requireAuthority(scene);
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const state = getRuntime(scene, { schemeId }), prefix = `${state.schemeId ?? "main"}:`;
      if (triggerKey && !triggerKey.startsWith(prefix)) throw new Error("Счётчик относится к другой схеме.");
      state.triggerCounts ??= {};
      if (triggerKey) delete state.triggerCounts[triggerKey];
      else for (const key of Object.keys(state.triggerCounts)) if (key.startsWith(prefix)) delete state.triggerCounts[key];
      await saveRuntime(scene, state);
      await this.refresh(scene);
      return state;
    });
  }

  resetTriggerCounter(scene, triggerKey) { return this.resetTriggers(scene, { triggerKey, schemeId: triggerKey?.split(":")[0] ?? "main" }); }

  async setTriggerEnabled(scene, triggerKey, enabled) {
    this.requireAuthority(scene);
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const state = getRuntime(scene, { schemeId: triggerKey?.split(":")[0] ?? "main" });
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
    this.busy = true;
    let jobs;
    try { jobs = await Promise.all(getRuntimes(scene).map(async (state) => ({ state, transition: await this.tickScheme(scene, state) }))); }
    finally { this.busy = false; }
    await Promise.all(jobs.flatMap(({ transition }) => (transition?.routineJobs ?? []).map((job) => this.routines.execute(job))));
  }

  async tickScheme(scene, state) {
    const clockKey = `${scene.id}:${state.schemeId}`;
    if (!state.episode || state.episode.stop || state.halted || game.paused) { this.tickTimes.set(clockKey, this.now()); return; }
    return withSceneLock(scene, async () => {
        if (!this.owns(scene, state.runId)) return null;
        const elapsed = Math.min(1, Math.max(0, (this.now() - (this.tickTimes.get(clockKey) ?? this.now())) / 1000));
        this.tickTimes.set(clockKey, this.now());
        const routineJobs = [];
        for (const id of Object.keys(state.episode.tokens)) {
          if (!this.currentToken(scene, state.runId, id, { ignoreInteractionPause: true })) continue;
          const current = getRuntimeForRun(scene, state.runId);
          if (isInteractionPaused(scene, id)) {
            if (!current.interactionClocks?.[id]) { freezeInteractionClock(current, id, this.now()); await saveRuntime(scene, current); }
            continue;
          }
          let tokenElapsed = elapsed;
          if (current.interactionClocks?.[id]) {
            current.interactionClocks[id] = null; await saveRuntime(scene, current); tokenElapsed = 0;
          }
          const token = scene.tokens.get(id);
          const routine = state.episode.routines?.find((entry) => entry.target.id === id);
          if (routine) {
            try { const job = await this.routines.tick(scene, current, token, routine, tokenElapsed); if (job) routineJobs.push(job); }
            catch (error) {
              const latest = getRuntimeForRun(scene, state.runId);
              if (latest && this.currentToken(scene, state.runId, id, { ignoreInteractionPause: true })) {
                latest.routineStates[id].status = "failed"; latest.error = `Распорядок «${token.name}»: ${error.message}`;
                await saveRuntime(scene, latest); this.onChange(scene);
              }
            }
            continue;
          }
        }
        return { routineJobs };
      });
  }

  async onTokenMove(token, previous) {
    const scene = token.parent;
    if (!this.owns(scene) || game.paused) return;
    for (const state of getRuntimes(scene)) await this.onSchemeTokenMove(scene, state.runId, token, previous);
  }

  async onSchemeTokenMove(scene, runId, token, previous) {
    if (!this.owns(scene, runId) || !runId) return;
    const admitted = await withSceneLock(scene, async () => {
      if (!this.owns(scene, runId)) return null;
      const state = getRuntimeForRun(scene, runId);
      if (!state.episode || state.episode.stop) return null;
      const playerOwned = asArray(game.users).some((user) => Number(user.role) >= 1 && Number(user.role) <= 2 && token.actor?.testUserPermission?.(user, "OWNER"));
      if (!playerOwned) return null;
      const next = tokenCenter(token, scene);
      for (const zone of state.episode.zones) {
        if (!crossesRectangle(previous, next, zone)) continue;
        const key = getTriggerKey(state, "zone", zone.id);
        if (!getTriggerGate(scene, state, zone.trigger, token, { triggerKey: key }).allowed) continue;
        consumeTrigger(state, key, zone.trigger);
        await saveRuntime(scene, state);
        return { state, zone };
      }
      return null;
    });
    if (admitted) {
      const { state, zone } = admitted;
      this.emitEvent(scene, { name: "zone.entered", runId: state.runId, actorTokenId: token.id, handled: false,
        payload: { zoneId: zone.id, label: zone.label } });
      if (zone.eventName && zone.eventName !== "zone.entered") this.emitEvent(scene, { name: zone.eventName, runId: state.runId, actorTokenId: token.id, handled: false,
        payload: { zoneId: zone.id, label: zone.label } });
    }
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
