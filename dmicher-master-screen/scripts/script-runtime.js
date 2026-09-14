import { message as localizedMessage, text } from "./localization.js";
import { withSceneLock } from "./store.js";
import { notifyExecutionChange, createExecutionScope } from "./execution.js";
import { planScriptMovement, advanceScriptMovement, scriptObjectCapabilities, stopObjectAnimation } from "./script-movement.js";
import { createCombatAdapter } from "./combat-adapter.js";
import { DEFAULT_EMOTION_SIZE } from "./script-model.js";
import { planScriptApproach, planScriptFollow, advanceScriptFollow } from "./script-target-movement.js";
import { scriptDialoguesPending } from "./interaction-session-model.js";
import { debugTrace, debugError } from "./debug.js";
import { interruptScriptProgress, resumeScriptProgress, scriptHasActivity, clearScriptPresentation } from "./script-interruptions.js";

const clone = structuredClone;
const LIMIT = 16;
const targetOf = (object) => ({ type: object.documentName, id: object.id });
const parallel = (step) => step.parameters.executionMode === "parallel" || step.kind === "emotion" && step.parameters.executionMode === undefined;
const traceContext = (scene, state, object, script, step, extra = {}) => ({ sceneId: scene.id, sceneName: scene.name, groupId: state.groupId,
  stateId: state.stateId ?? state.state?.id, stateName: state.state?.name, runId: state.runId, objectId: object.id, objectName: object.name,
  objectType: object.documentName, scriptName: script.name, stepId: step?.id, kind: step?.kind, ...extra });
const visualTime = (state) => Math.max(Date.now(), ...Object.values(state.scriptStates ?? {}).flatMap((progress) => [Number(progress?.emojiAt ?? 0) + 1, Number(progress?.bubbleAt ?? 0) + 1]));
export const scriptProgressKey = (target, script, slot = "routine") => `${target.type}:${target.id}:${slot}:${script.id ?? script.stateId ?? "script"}`;
export function initialScriptProgress(script) {
  return { stepId: script.steps.length ? 1 : null, status: script.steps.length && script.enabled !== false ? "ready" : "done", sequence: 0,
    action: null, nextStepId: null, emoji: "", emojiSize: DEFAULT_EMOTION_SIZE, emojiAt: 0, emojiEffect: null, bubble: null, bubbleAt: 0,
    speechEffect: null, messageIds: [], dialogueSessions: [], deleteMessages: false, combat: null,
    generation: 0, errorRetries: 0, interruption: null };
}
const duration = (step, action) => {
  if (["speech", "emotion"].includes(step.kind) && parallel(step)) return 0;
  if (action?.movement) return action.movement.remainingMs / 1000;
  if (step.kind === "speech" && action?.phase === "effect") return step.parameters.duration;
  if (action) return action.remainingMs / 1000 + (["signal", "macro"].includes(step.kind) && ["before", "effect"].includes(action.phase) ? step.parameters.after : 0);
  return step.parameters.seconds ?? step.parameters.duration ?? (step.parameters.before ?? 0) + (step.parameters.after ?? 0);
};
function actionFor(scene, object, step) {
  const p = step.parameters;
  if (step.kind === "move") return { stepId: step.id, phase: "duration", movement: planScriptMovement(scene, object, p), remainingMs: 0 };
  if (step.kind === "approach") return { stepId: step.id, phase: "duration", movement: planScriptApproach(scene, object, p), remainingMs: 0 };
  if (step.kind === "follow") return { stepId: step.id, phase: "duration", follow: planScriptFollow(scene, object, p), remainingMs: 0 };
  if (step.kind === "wait" || step.kind === "emotion") return { stepId: step.id, phase: "duration", remainingMs: step.kind === "emotion" && parallel(step) ? 0 : (p.seconds ?? p.duration) * 1000 };
  if (["signal", "macro"].includes(step.kind)) return { stepId: step.id, phase: "before", remainingMs: p.before * 1000 };
  return { stepId: step.id, phase: "effect", remainingMs: 0 };
}
const sameTurn = (expected, current) => expected
  ? Boolean(current?.isTurn && current.turnKey === expected.turnKey)
  : !current;

/** One executor serves state transitions, routine and explicit initial restoration.
 * The caller owns run authorization and storage. External actions are claimed before
 * execution and an interrupted unknown result is never automatically replayed. */
export class ObjectScriptRuntime {
  constructor(runtime, { random = Math.random } = {}) {
    this.runtime = runtime; this.random = random; this.jobs = new Map(); this.cancels = new Set();
    this.persistenceFailures = new WeakMap();
    this.combat = runtime.combat ?? createCombatAdapter();
  }
  state(scene, runId) { return this.runtime.scriptState(scene, runId); }
  save(scene, state) { return this.runtime.saveScriptState(scene, state); }
  current(scene, runId, target, options) {
    return !this.persistenceFailures.get(scene)?.has(`${runId}:${options?.scriptKey}`)
      && this.runtime.currentObject(scene, runId, target, options);
  }
  next(script, step) { return step.next.length ? step.next[Math.min(step.next.length - 1, Math.floor(this.random() * step.next.length))] : script.repeat ? 1 : null; }
  advance(progress, next) {
    progress.stepId = next; progress.status = next === null ? "done" : "ready";
    // Explicit null is essential: Foundry recursively merges flag objects.
    progress.action = null; progress.nextStepId = null;
  }
  resumeManualProgress(script, previous) {
    if (!previous) return initialScriptProgress(script);
    const progress = { ...initialScriptProgress(script), stepId: previous.stepId, status: previous.status,
      sequence: Number(previous.sequence ?? 0) + 1, generation: Number(previous.generation ?? 0) + 1,
      errorRetries: Number(previous.errorRetries ?? 0) };
    if (["done", "stopped", "failed", "uncertain"].includes(progress.status)) return progress;
    interruptScriptProgress(progress, script, "manual", { now: this.now(), next: step => this.next(script, step) });
    resumeScriptProgress(progress, this.now());
    return progress;
  }
  now() { return this.runtime.now?.() ?? Date.now(); }
  interruptionSource(scene, object, script) {
    const external = this.runtime.scriptInterruptionSource?.(scene, targetOf(object), script);
    if (external) return external;
    if (!script.combat.enabled && this.combat.context(scene, object)) return "combat";
    return null;
  }
  generationCurrent(scene, runId, key, generation) {
    return Number(this.state(scene, runId)?.scriptStates?.[key]?.generation ?? 0) === generation;
  }
  scriptForKey(state, object, key) {
    if (state.manual) return state.script;
    const target = targetOf(object);
    for (const [slot, scripts] of [["transition", state.state?.transitions], ["routine", state.state?.scripts]]) {
      const script = scripts?.find(script => scriptProgressKey(target, script, slot) === key
        && script.target?.type === target.type && script.target?.id === target.id);
      if (script) return script;
    }
    return null;
  }
  async interrupt(scene, state, object, script, key, source, error) {
    const progress = state.scriptStates[key];
    const presentationOnly = progress?.status === "done" && scriptHasActivity(progress);
    if (presentationOnly) {
      // An effect can outlive its script. Cancelling it never reopens completed
      // foreground work, whether observed by the clock or an asynchronous job.
      clearScriptPresentation(progress, this.now()); progress.generation = Number(progress.generation ?? 0) + 1;
    } else if (!interruptScriptProgress(progress, script, source, { now: this.now(), next: step => this.next(script, step) })) return false;
    if (!presentationOnly) stopObjectAnimation(object);
    this.runtime.effects.stop?.(scene, { runIds: [state.runId], target: targetOf(object), scriptKey: key });
    if (error) {
      state.error = localizedMessage("Скрипт «{0}»: {1}", [script.name || object.name, error.message ?? String(error)]);
      globalThis.ui?.notifications?.error?.(state.error);
      debugError("script", "action.failed", error, () => traceContext(scene, state, object, script,
        script.steps.find(step => step.id === progress.stepId), { source, retry: progress.errorRetries, interruption: progress.interruption }));
    }
    debugTrace("script", "interrupted", () => traceContext(scene, state, object, script,
      script.steps.find(step => step.id === progress.stepId), { source, interruption: progress.interruption, retry: progress.errorRetries }));
    try { await this.save(scene, state); }
    catch (persistenceError) {
      // A failed progress write cannot persist the retry budget. Stop locally
      // instead of replaying the same failure on every simulation tick.
      let failed = this.persistenceFailures.get(scene);
      if (!failed) this.persistenceFailures.set(scene, failed = new Map());
      for (const [id, runId] of failed) if (this.runtime.owns && !this.runtime.owns(scene, runId)) failed.delete(id);
      failed.set(`${state.runId}:${key}`, state.runId);
      notifyExecutionChange(scene, "script-persistence-failed");
      debugError("script", "persistence.failed", persistenceError, () => traceContext(scene, state, object, script, null, { stoppedLocally: true }));
      throw persistenceError;
    }
    notifyExecutionChange(scene, "script-interrupted");
    this.runtime.refreshObject(object); this.runtime.onChange(scene);
    return true;
  }
  async fail(scene, state, object, script, key, error) {
    if (!this.current(scene, state.runId, targetOf(object), { ignoreInteractionPause: true, scriptKey: key })) return false;
    state.scriptStates[key] ??= initialScriptProgress(script);
    return this.interrupt(scene, state, object, script, key, "error", error);
  }
  async recordCancelledJob(job) {
    if (!job.interruptedBy) return;
    await withSceneLock(job.scene, async () => {
      if (!this.current(job.scene, job.runId, job.target, { ignoreInteractionPause: true, scriptKey: job.progressKey })) return;
      const state = this.state(job.scene, job.runId), progress = state?.scriptStates?.[job.progressKey];
      if (!progress || Number(progress.generation ?? 0) !== job.generation
        || (job.background ? progress.speechEffect?.id !== job.sequence : progress.sequence !== job.sequence)) return;
      await this.interrupt(job.scene, state, job.object, job.script, job.progressKey, job.interruptedBy);
    });
  }
  replaceEffect(state, object, field) {
    const prefix = `${object.documentName}:${object.id}:`;
    for (const [key, progress] of Object.entries(state.scriptStates ?? {})) if (key.startsWith(prefix)) progress[field] = null;
  }
  consumeEffectTime(scene, state, object, seconds, foreground) {
    const turn = this.combat.context(scene, object);
    if (!(seconds > 0) || !turn?.isTurn) return;
    const prefix = `${object.documentName}:${object.id}:`;
    for (const [key, progress] of Object.entries(state.scriptStates ?? {})) {
      if (!key.startsWith(prefix) || !this.current(scene, state.runId, targetOf(object), { scriptKey: key })) continue;
      const effects = ["emojiEffect", "speechEffect"].map(field => [field, progress[field]])
        .filter(([, effect]) => effect?.combat?.enabled && !["pending", "uncertain"].includes(effect.status));
      if (!effects.length) continue;
      let spent = seconds;
      // A former transition can keep an effect while its routine spends time.
      // Its own idle clock must count those same seconds once, including after a
      // turn change. The foreground's budget has already been charged by tick().
      if (progress !== foreground) {
        if (progress.combat?.stoppedId === turn.id) continue;
        if (progress.combat?.turnKey !== turn.turnKey) {
          progress.combat = { id: turn.id, turnKey: turn.turnKey, remaining: effects[0][1].combat.turnSeconds, confirmedStepId: null, ended: false, stoppedId: null };
        }
        spent = Math.min(seconds, progress.combat.remaining);
        progress.combat.remaining = Math.max(0, progress.combat.remaining - spent);
      }
      for (const [field, effect] of effects) {
        effect.remainingMs = Math.max(0, effect.remainingMs - spent * 1000);
        if (field === "emojiEffect" && effect.remainingMs === 0) { progress.emoji = ""; progress.emojiEffect = null; }
      }
    }
  }
  async claim(scene, state, object, script, progress, key, stage, step, extra = {}) {
    // Invalidate older delayed completions before queuing the new speech action.
    // A transition and its routine may otherwise publish competing "after" text.
    if (step.kind === "speech" && stage === "effect") this.replaceEffect(state, object, "speechEffect");
    progress.sequence = Number(progress.sequence ?? 0) + 1; progress.status = "pending";
    const job = { key: `${scene.id}:${state.runId}:${key}`, progressKey: key, scene, object, target: targetOf(object), runId: state.runId,
      groupId: state.groupId, script: clone(script), step: clone(step), sequence: progress.sequence, generation: Number(progress.generation ?? 0), stage,
      combat: this.combat.context(scene, object), ...extra };
    this.jobs.set(job.key, job);
    debugTrace("script", "action.claim", () => traceContext(scene, state, object, script, step, { stage, sequence: progress.sequence }));
    try { await this.save(scene, state); } catch (error) { this.jobs.delete(job.key); throw error; }
    // Release replaced background work even if its external promise never settles.
    // Notify only after persistence, so listeners see the new effect ownership.
    if (step.kind === "speech" && stage === "effect") notifyExecutionChange(scene, "speech-replaced");
    return job;
  }
  /** Concurrent presentation owns its lifetime, not the following step's action.
   * The group calls this once per object on its active clock, including after the
   * foreground script finishes. Interaction/game pauses never catch up later. */
  async tickEffects(scene, runId, object, elapsed, { idle = false } = {}) {
    const target = targetOf(object), state = this.state(scene, runId), jobs = [];
    if (!state || !this.current(scene, runId, target, { ignoreInteractionPause: true })) return jobs;
    let changed = false, visualChanged = false;
    const turn = this.combat.context(scene, object), prefix = `${target.type}:${target.id}:`;
    // Completed foreground work may still own a timed presentation. Cancelling
    // that presentation must not reopen the completed transition or its routine.
    for (const [key, progress] of Object.entries(state.scriptStates ?? {})) {
      if (!key.startsWith(prefix) || !scriptHasActivity(progress)
        || !this.current(scene, runId, target, { ignoreInteractionPause: true, scriptKey: key })) continue;
      const script = this.scriptForKey(state, object, key);
      const source = script && this.interruptionSource(scene, object, script);
      if (!source) continue;
      await this.interrupt(scene, state, object, script, key, source);
    }
    // With no following action, the remaining turn can still carry a timed
    // effect. Spend this once, exactly as a trailing wait, not on every poll.
    if (idle && turn?.isTurn) for (const [key, progress] of Object.entries(state.scriptStates ?? {})) {
      if (!key.startsWith(prefix) || !this.current(scene, runId, target, { scriptKey: key })) continue;
      if (progress.combat?.stoppedId === turn.id) continue;
      const effects = [progress.emojiEffect, progress.speechEffect].filter(effect => effect?.combat?.enabled && !["pending", "uncertain"].includes(effect.status));
      if (!effects.length) continue;
      if (progress.combat?.turnKey !== turn.turnKey) {
        progress.combat = { id: turn.id, turnKey: turn.turnKey, remaining: effects[0].combat.turnSeconds, confirmedStepId: null, ended: false, stoppedId: null };
        changed = true;
      }
      const spent = Math.min(progress.combat.remaining, Math.max(...effects.map(effect => effect.remainingMs / 1000)));
      if (spent > 0) {
        for (const effect of effects) effect.remainingMs = Math.max(0, effect.remainingMs - spent * 1000);
        progress.combat.remaining = Math.max(0, progress.combat.remaining - spent); changed = true;
      }
    }
    for (const [key, progress] of Object.entries(state.scriptStates ?? {})) {
      if (!key.startsWith(prefix)) continue;
      const admitted = this.current(scene, runId, target, { scriptKey: key });
      for (const field of ["emojiEffect", "speechEffect"]) {
        const effect = progress[field];
        if (!effect) continue;
        if (turn && progress.combat?.stoppedId === turn.id) continue;
        if (!admitted) { if (!effect.paused) { effect.paused = true; changed = true; } continue; }
        const seconds = effect.paused || turn ? 0 : Math.max(0, elapsed);
        if (effect.paused) { effect.paused = false; changed = true; }
        if (effect.remainingMs > 0 && turn && (!effect.combat?.enabled || !turn.isTurn)) continue;
        if (effect.status === "pending" || effect.status === "uncertain") {
          if (effect.status === "pending" && !this.jobs.has(`${scene.id}:${runId}:${key}:speech:${effect.id}`)) {
            effect.status = "uncertain"; changed = true;
            state.error = text("Исход отложенного завершения реплики неизвестен. Проверьте результат и перезапустите состояние.", "The delayed speech completion result is unknown. Check it and restart the state.");
            debugError("script", "speech.uncertain", new Error(state.error), () => traceContext(scene, state, object, effect.script ?? {}, effect.step));
          }
          continue;
        }
        const remaining = Math.max(0, effect.remainingMs - seconds * 1000);
        changed ||= remaining !== effect.remainingMs; effect.remainingMs = remaining;
        if (remaining > 0) continue;
        changed = true;
        if (field === "emojiEffect") {
          progress.emoji = ""; progress.emojiEffect = null; visualChanged = true;
          debugTrace("script", "emotion.expired", () => traceContext(scene, state, object, {}, undefined));
          continue;
        }
        if (effect.step.parameters.duration > 0) { progress.bubble = null; visualChanged = true; }
        effect.status = "pending";
        const job = { key: `${scene.id}:${runId}:${key}:speech:${effect.id}`, progressKey: key, scene, object, target, runId,
          groupId: state.groupId, script: clone(this.scriptForKey(state, object, key) ?? effect.script), step: clone(effect.step), sequence: effect.id,
          generation: Number(progress.generation ?? 0), stage: "speechEnd",
          combat: turn, background: clone(effect) };
        this.jobs.set(job.key, job); jobs.push(job);
        debugTrace("script", "speech.expired", () => traceContext(scene, state, object, effect.script, effect.step));
      }
    }
    if (changed) {
      try { await this.save(scene, state); } catch (error) { for (const job of jobs) this.jobs.delete(job.key); throw error; }
      if (visualChanged) this.runtime.refreshObject(object);
    }
    return jobs;
  }
  hasPendingEffects(state) {
    return Object.values(state?.scriptStates ?? {}).some(progress => progress.emojiEffect || progress.speechEffect && progress.speechEffect.status !== "uncertain");
  }
  async tick(scene, initial, object, script, elapsed, { slot = "routine" } = {}) {
    const target = targetOf(object), key = scriptProgressKey(target, script, slot), jobKey = `${scene.id}:${initial.runId}:${key}`;
    let state = this.state(scene, initial.runId);
    if (!state || !this.current(scene, initial.runId, target, { ignoreInteractionPause: true, scriptKey: key }) || script.enabled === false) return;
    state.scriptStates ??= {};
    const source = this.interruptionSource(scene, object, script);
    // A script which has not started is merely unavailable in this context.
    // Do not manufacture an interrupted run while opening a scene in combat.
    if (source && !state.scriptStates[key]) return;
    const progress = state.scriptStates[key] ??= initialScriptProgress(script);
    if (source) { await this.interrupt(scene, state, object, script, key, source); return; }
    if (!this.current(scene, initial.runId, target, { scriptKey: key })) return;
    if (progress.status === "interrupted") {
      if (progress.interruption?.source === "manual" || !resumeScriptProgress(progress, this.now())) return;
      debugTrace("script", "resumed", () => traceContext(scene, state, object, script,
        script.steps.find(step => step.id === progress.stepId), { retry: progress.errorRetries }));
      await this.save(scene, state); return;
    }
    if (["stopped", "failed", "uncertain"].includes(progress.status)) return;
    if (progress.status === "pending") {
      if (!this.jobs.has(jobKey)) { progress.status = "uncertain"; state.error = localizedMessage("Скрипт «{0}»: исход прежнего действия неизвестен. Проверьте результат и явно перезапустите состояние.", [script.name || object.name]);
        debugError("script", "action.uncertain", new Error(state.error), () => traceContext(scene, state, object, script, script.steps.find(step => step.id === progress.stepId)));
        await this.save(scene, state); this.runtime.onChange(scene); }
      return;
    }
    const combat = this.combat.context(scene, object);
    let combatChanged = false;
    if (combat) {
      if (!script.combat.enabled || !combat.isTurn || progress.combat?.stoppedId === combat.id) return;
      if (progress.combat?.turnKey !== combat.turnKey) {
        progress.combat = { id: combat.id, turnKey: combat.turnKey, remaining: script.combat.turnSeconds, confirmedStepId: null, ended: false, stoppedId: null };
        combatChanged = true;
      }
      if (progress.status === "done" || progress.combat.remaining <= 0) {
        if (script.combat.endTurn && !progress.combat.ended) return this.claim(scene, state, object, script, progress, key, "endTurn", { id: progress.stepId ?? 0, kind: "wait", parameters: {}, next: [] }, { combat });
        if (combatChanged) await this.save(scene, state);
        return;
      }
    } else if (progress.combat) { progress.combat = null; combatChanged = true; }
    if (["done", "uncertain", "failed"].includes(progress.status)) return;
    let available = combat ? progress.combat.remaining : Math.max(0, elapsed);
    const instantSteps = new Set();
    for (let index = 0; index < LIMIT; index++) {
      if (!this.current(scene, state.runId, target, { scriptKey: key }) || !sameTurn(combat, this.combat.context(scene, object))) return;
      if (combat && progress.combat.remaining <= 0) return;
      const step = script.steps.find((entry) => entry.id === progress.stepId);
      if (!step) { progress.status = "done"; await this.save(scene, state); return; }
      // An authored instant loop is valid, but yields to the next runtime tick
      // instead of spending this whole tick repeating the same zero-time work.
      if (instantSteps.has(step.id)) return;
      instantSteps.add(step.id);
      if (progress.action?.stepId !== step.id) {
        progress.action = actionFor(scene, object, step);
        debugTrace("script", "step.start", () => traceContext(scene, state, object, script, step, { slot, next: step.next, parameters: step.parameters }));
      }
      const action = progress.action, params = step.parameters;
      if (combat && progress.combat.confirmedStepId !== step.id) {
        const remaining = duration(step, action);
        const rounds = 1 + Math.ceil(Math.max(0, remaining - progress.combat.remaining) / script.combat.turnSeconds);
        return this.claim(scene, state, object, script, progress, key, "combat", step, { combat, rounds });
      }
      if (step.kind === "emotion" && !action.started) {
        this.replaceEffect(state, object, "emojiEffect");
        progress.emoji = params.emoji; progress.emojiSize = params.size ?? DEFAULT_EMOTION_SIZE;
        progress.emojiAt = visualTime(state); action.started = true;
        progress.emojiEffect = parallel(step) && params.duration > 0 ? { remainingMs: params.duration * 1000, combat: clone(script.combat) } : null;
      }
      let consumed = 0;
      if (["move", "approach", "follow"].includes(step.kind)) {
        if (!action.started) {
          action.started = true;
          // Record the begun step before yielding to native I/O so even a short
          // interaction during its first movement has a progress to interrupt.
          await this.save(scene, state);
        }
        // Foundry owns the submitted document update. The scene queue must not
        // wait for its animation/network promise after this execution is revoked.
        const generation = Number(progress.generation ?? 0);
        let interruptedBy = null;
        const scope = createExecutionScope(scene, { isCurrent: () => {
          interruptedBy ??= this.interruptionSource(scene, object, script);
          return !interruptedBy && !globalThis.game?.paused && this.generationCurrent(scene, state.runId, key, generation)
            && this.current(scene, state.runId, target, { scriptKey: key }) && sameTurn(combat, this.combat.context(scene, object));
        } });
        const options = { isCurrent: scope.current, signal: scope.signal, ignoreObstacles: step.kind === "approach" };
        let outcome;
        try { outcome = await scope.run(() => step.kind === "follow" ? advanceScriptFollow(scene, object, action.follow, params, available, options)
          : advanceScriptMovement(scene, object, action.movement, available, options)); }
        finally { scope.dispose(); }
        if (outcome.stale) {
          if (interruptedBy && this.current(scene, state.runId, target, { ignoreInteractionPause: true })
            && this.generationCurrent(scene, state.runId, key, generation)) await this.interrupt(scene, state, object, script, key, interruptedBy);
          return;
        }
        const movement = outcome.value;
        consumed = movement.consumed;
        if (combat) { progress.combat.remaining = Math.max(0, progress.combat.remaining - consumed); this.consumeEffectTime(scene, state, object, consumed, progress); }
        available = Math.max(0, available - consumed);
        if (!movement.done) { await this.save(scene, state); return; }
      } else if (step.kind === "dialogue" && action.phase === "dialogue") {
        if (scriptDialoguesPending(state, action.sessions, Date.now(), params.waitMode)) {
          if (combat) {
            const remaining = Math.max(0, progress.combat.remaining - available);
            combatChanged ||= remaining !== progress.combat.remaining;
            this.consumeEffectTime(scene, state, object, progress.combat.remaining - remaining, progress);
            progress.combat.remaining = remaining;
          }
          // The dialogue service owns session changes. An idle poll has no new
          // state to persist; only an actual combat-clock change needs a write.
          if (combatChanged) await this.save(scene, state);
          return;
        }
      } else if (["duration", "before", "after"].includes(action.phase)) {
        consumed = Math.min(available, action.remainingMs / 1000);
        action.remainingMs = Math.max(0, action.remainingMs - consumed * 1000);
        available = Math.max(0, available - consumed);
        if (combat) { progress.combat.remaining = Math.max(0, progress.combat.remaining - consumed); this.consumeEffectTime(scene, state, object, consumed, progress); }
        if (action.remainingMs > 0) { await this.save(scene, state); this.runtime.refreshObject(object); return; }
        if (action.phase === "before") { action.phase = "effect"; return this.claim(scene, state, object, script, progress, key, "effect", step); }
        if (step.kind === "speech" && action.phase === "duration") return this.claim(scene, state, object, script, progress, key, "speechEnd", step);
        if (step.kind === "emotion" && !parallel(step) && params.duration > 0) progress.emoji = "";
      } else return this.claim(scene, state, object, script, progress, key, "effect", step);
      if (consumed > 0) instantSteps.clear();
      const next = this.next(script, step);
      debugTrace("script", "step.complete", () => traceContext(scene, state, object, script, step, { slot, nextStepId: next, repeating: !step.next.length && script.repeat }));
      this.advance(progress, next);
      await this.save(scene, state); this.runtime.refreshObject(object);
      if (progress.status === "done") return;
      if (!combat) available = 0; // A new step always starts with its own full timer.
    }
  }
  async effect(job, admitted, executionCurrent) {
    const { scene, object, target, script, step, runId, stage } = job, p = step.parameters, effects = this.runtime.effects;
    const current = job.background ?? this.state(scene, runId)?.scriptStates?.[job.progressKey];
    if (stage === "combat") {
      await this.combat.notify(object, script, step, job.rounds, `${job.key}:${job.sequence}`);
      if (!admitted()) return;
      return { decision: await this.combat.confirmAction(object, script, step, job.rounds) };
    }
    if (stage === "endTurn") { if (admitted()) await this.combat.finishTurn(scene, object, job.combat); return {}; }
    if (step.kind === "speech") {
      const start = stage === "effect";
      if (start && admitted()) await effects.clearPreviousSpeech?.(scene, object, admitted);
      if (admitted() && (start && current?.deleteMessages || !start && p.duration > 0 && p.chat.deleteAfter) && current?.messageIds?.length) await effects.removeSpeech(current.messageIds, admitted);
      if (admitted() && p.chat.enabled && p.chat.timing === (start ? "before" : "after")) {
        const messages = await effects.speak(scene, object, p.chat.text, { ...p.chat, visibleOnly: true, rich: true,
          expiresAfter: !start && p.chat.deleteAfter ? p.duration : 0 }, `${job.key}:${job.sequence}:chat`, admitted);
        return { messageIds: (messages ?? []).map((message) => message.id) };
      }
      return { messageIds: start ? [] : current?.messageIds ?? [] };
    }
    if (step.kind === "visibility") {
      if (!scriptObjectCapabilities(object).visibility) throw new Error(localizedMessage("Этот объект не поддерживает скрытие."));
      if (admitted()) await object.update({ hidden: !p.visible }); return {};
    }
    if (step.kind === "sound") { if (admitted()) await effects.sound(p.src, p.volume, { scene, runId, target, groupId: job.groupId, manual: this.state(scene, runId)?.manual === true,
      scriptKey: job.progressKey, scriptGeneration: job.generation,
      // Sound may outlive its step. Only its script generation and ownership,
      // not the next step's sequence number, can end this presentation.
      isCurrent: () => this.generationCurrent(scene, runId, job.progressKey, job.generation)
        && this.current(scene, runId, target, { ignoreInteractionPause: true, scriptKey: job.progressKey }) && !this.interruptionSource(scene, object, script) }); return {}; }
    if (step.kind === "signal") {
      if (admitted()) await this.runtime.emitObjectSignal(scene, target, p.signalId, clone(p.parameters), { originSceneId: scene.id, originRunId: runId, originGroupId: job.groupId, chainId: `${job.key}:${job.sequence}`, depth: 0 });
      return {};
    }
    if (step.kind === "state") {
      await this.runtime.changeStates(scene, p.transitions, { originRunId: runId, admitted,
        signalContext: { originSceneId: scene.id, originRunId: runId, originGroupId: job.groupId, chainId: `${job.key}:${job.sequence}`, depth: 0 } });
      return {};
    }
    if (step.kind === "dialogue") {
      if (this.state(scene, runId)?.manual) throw new Error(text("Диалог скрипта доступен в переходах и рутине запущенной группы. Для ручного показа используйте окно диалогов.",
        "Scripted dialogue is available in the transitions and routines of a running group. Use the Dialogues window for manual presentation."));
      if (!this.runtime.startScriptDialogues) throw new Error(localizedMessage("Неизвестное действие скрипта."));
      // Opening our first window pauses the object before the result references
      // can be saved. Exclude only our confirmed windows while admitting the rest.
      const isCurrent = (started = []) => {
        const turn = this.combat.context(scene, object);
        return executionCurrent() && !globalThis.game?.paused && this.current(scene, runId, target, { scriptKey: job.progressKey, excludeDialogueSessions: started })
          && (!turn || script.combat.enabled && turn.isTurn);
      };
      const sessions = await this.runtime.startScriptDialogues({ sceneId: scene.id, groupId: job.groupId, runId, target, dialogueId: p.dialogueId, tokenUuids: clone(p.tokenUuids) },
        { isCurrent, waitForAdmission: (started = []) => this.waitUntilAdmitted(job, () => isCurrent(started), executionCurrent) });
      return { sessions };
    }
    if (step.kind === "macro") {
      if (!this.runtime.isObjectMacroAttached(scene, target, p.macroUuid)) throw new Error(localizedMessage("Этот макрос не прикреплён к объекту скрипта."));
      await effects.macro(p.macroUuid, { scene, token: object, state: this.state(scene, runId)?.state, runId, stepId: step.id, isCurrent: admitted });
      return {};
    }
    throw new Error(localizedMessage("Неизвестное действие скрипта."));
  }
  /** A partially opened dialogue batch keeps its claimed job and exact views.
   * Pauses/turn changes wait in place; losing the run releases the wait entirely. */
  async waitUntilAdmitted(job, isCurrent, executionCurrent) {
    const scope = createExecutionScope(job.scene, { isCurrent: executionCurrent });
    this.cancels.add(scope.cancel); let timer;
    try {
      const outcome = await scope.run(() => new Promise((resolve, reject) => {
        const check = () => { try { if (isCurrent()) resolve(); } catch (error) { reject(error); } };
        timer = setInterval(check, 100); check();
      }));
      if (outcome.stale) throw new Error(text("Исполнение скрипта остановлено.", "Script execution was stopped."));
    } finally { clearInterval(timer); scope.dispose(); this.cancels.delete(scope.cancel); }
  }
  async execute(job) {
    const { scene, runId, target, sequence, step, script } = job;
    const sameEffect = () => !job.background || this.state(scene, runId)?.scriptStates?.[job.progressKey]?.speechEffect?.id === sequence;
    const current = () => sameEffect() && this.current(scene, runId, target, { scriptKey: job.progressKey });
    const owned = () => {
      job.interruptedBy ??= this.interruptionSource(scene, job.object, script);
      return !job.interruptedBy && sameEffect() && this.current(scene, runId, target, { ignoreInteractionPause: true, scriptKey: job.progressKey })
        && this.generationCurrent(scene, runId, job.progressKey, job.generation)
        && (job.background || this.state(scene, runId)?.scriptStates?.[job.progressKey]?.sequence === sequence);
    };
    const scope = createExecutionScope(scene, { isCurrent: owned });
    this.cancels.add(scope.cancel);
    const admitted = () => {
      if (scope.current() && !globalThis.game?.paused && current() && sameTurn(job.combat, this.combat.context(scene, job.object))) return true;
      // A turn may change while the claimed job waits outside the scene queue.
      // Keep the action ready for its next admission; never start it off-turn.
      const error = new Error(localizedMessage("Скрипт ожидает своего хода или завершения взаимодействия.")); error.code = "script-deferred"; throw error;
    };
    try {
      const result = await scope.run(async () => {
        try { admitted(); return { result: await this.effect(job, admitted, scope.current) }; }
        catch (error) { return { error }; }
      });
      const outcome = result.stale ? result : result.value;
      if (outcome.stale || !owned()) {
        await this.recordCancelledJob(job);
        debugTrace("script", "action.cancelled", () => traceContext(scene, { runId, groupId: job.groupId }, job.object, script, step, { stage: job.stage })); return;
      }
      await withSceneLock(scene, async () => {
        if (!owned()) return;
        const state = this.state(scene, runId), progress = state?.scriptStates?.[job.progressKey];
        if (job.background) {
          const effect = progress?.speechEffect;
          if (effect?.id !== sequence || effect.status !== "pending") return;
          if (outcome.error?.code === "script-deferred") effect.status = "ready";
          else {
            progress.speechEffect = null;
            if (outcome.error) {
              // A delayed "after" message belongs to its original speech step.
              // Retrying it follows that script's policy, never the next step's.
              progress.stepId = step.id; progress.status = "ready";
              await this.fail(scene, state, job.object, script, job.progressKey, outcome.error); return;
            } else {
              progress.messageIds = outcome.result?.messageIds ?? [];
              debugTrace("script", "speech.complete", () => traceContext(scene, state, job.object, script, step));
            }
          }
          await this.save(scene, state); this.runtime.refreshObject(job.object); return;
        }
        if (progress?.status !== "pending" || progress.sequence !== sequence) return;
        if (outcome.error?.code === "script-deferred") progress.status = "ready";
        else if (outcome.error) { await this.fail(scene, state, job.object, script, job.progressKey, outcome.error); return; }
        else if (job.stage === "combat") {
          progress.status = "ready";
          if (progress.combat?.turnKey === job.combat.turnKey) {
            if (outcome.result?.decision === "stop") progress.combat.stoppedId = job.combat.id;
            else if (outcome.result?.decision === "continue") progress.combat.confirmedStepId = step.id;
            else progress.combat.remaining = 0;
          }
        } else if (job.stage === "endTurn") { progress.status = progress.stepId === null ? "done" : "ready"; progress.combat.ended = true; }
        else if (step.kind === "dialogue") {
          const sessions = outcome.result?.sessions ?? [];
          progress.dialogueSessions = [...(progress.dialogueSessions ?? []).filter(reference => scriptDialoguesPending(state, [reference])), ...sessions]
            .filter((reference, index, entries) => entries.findIndex(other => other.sessionId === reference.sessionId) === index);
          progress.status = "ready"; progress.action.phase = "dialogue"; progress.action.sessions = sessions;
          if (step.parameters.waitMode === "none") this.advance(progress, this.next(script, step));
        } else if (step.kind === "speech" && job.stage === "effect") {
          progress.messageIds = outcome.result.messageIds; progress.deleteMessages = step.parameters.chat.deleteAfter;
          progress.bubble = step.parameters.bubble.enabled ? { text: step.parameters.bubble.text, fontSize: step.parameters.bubble.fontSize } : null;
          progress.bubbleAt = visualTime(state);
          progress.speechEffect = parallel(step) ? { id: progress.bubbleAt, remainingMs: step.parameters.duration * 1000,
            step: clone(step), script: { name: script.name, combat: clone(script.combat) }, combat: clone(script.combat), status: "ready",
            messageIds: clone(progress.messageIds), deleteMessages: progress.deleteMessages } : null;
          if (parallel(step)) this.advance(progress, this.next(script, step));
          else { progress.status = "ready"; progress.action.phase = "duration"; progress.action.remainingMs = step.parameters.duration * 1000; }
        } else if (["signal", "macro"].includes(step.kind)) {
          progress.status = "ready"; progress.action.phase = "after"; progress.action.remainingMs = step.parameters.after * 1000;
        } else {
          if (job.stage === "speechEnd") {
            if (step.parameters.duration > 0) { progress.bubble = null; progress.bubbleAt = visualTime(state); }
            progress.messageIds = outcome.result.messageIds;
          }
          this.advance(progress, this.next(script, step));
        }
        debugTrace("script", "action.result", () => traceContext(scene, state, job.object, script, step,
          { stage: job.stage, status: progress.status, nextStepId: progress.stepId, background: Boolean(progress.speechEffect) }));
        await this.save(scene, state); this.runtime.onChange(scene); this.runtime.refreshObject(job.object);
      });
    } finally { scope.dispose(); this.cancels.delete(scope.cancel); if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); }
  }
  dispose() { for (const cancel of this.cancels) cancel(); this.cancels.clear(); this.jobs.clear(); this.persistenceFailures = new WeakMap(); }
}
