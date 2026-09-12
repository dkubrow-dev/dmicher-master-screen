import { withSceneLock } from "./store.js";
import { onExecutionChange } from "./execution.js";
import { planScriptMovement, advanceScriptMovement, scriptObjectCapabilities } from "./script-movement.js";
import { createCombatAdapter } from "./combat-adapter.js";

const clone = structuredClone;
const LIMIT = 16;
const targetOf = (object) => ({ type: object.documentName, id: object.id });
const visualTime = (state) => Math.max(Date.now(), ...Object.values(state.scriptStates ?? {}).flatMap((progress) => [Number(progress?.emojiAt ?? 0) + 1, Number(progress?.bubbleAt ?? 0) + 1]));
export const scriptProgressKey = (target, script, slot = "routine") => `${target.type}:${target.id}:${slot}:${script.id ?? script.stateId ?? "script"}`;
export function initialScriptProgress(script) {
  return { stepId: script.steps.length ? 1 : null, status: script.steps.length && script.enabled !== false ? "ready" : "done", sequence: 0,
    action: null, nextStepId: null, emoji: "", emojiAt: 0, bubble: null, bubbleAt: 0, messageIds: [], deleteMessages: false, combat: null };
}
const duration = (step, action) => {
  if (action?.movement) return action.movement.remainingMs / 1000;
  if (step.kind === "speech" && action?.phase === "effect") return step.parameters.duration;
  if (action) return action.remainingMs / 1000 + (["signal", "macro"].includes(step.kind) && ["before", "effect"].includes(action.phase) ? step.parameters.after : 0);
  return step.parameters.seconds ?? step.parameters.duration ?? (step.parameters.before ?? 0) + (step.parameters.after ?? 0);
};
function actionFor(scene, object, step) {
  const p = step.parameters;
  if (step.kind === "move") return { stepId: step.id, phase: "duration", movement: planScriptMovement(scene, object, p), remainingMs: 0 };
  if (step.kind === "wait" || step.kind === "emotion") return { stepId: step.id, phase: "duration", remainingMs: (p.seconds ?? p.duration) * 1000 };
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
    this.combat = runtime.combat ?? createCombatAdapter();
  }
  state(scene, runId) { return this.runtime.scriptState(scene, runId); }
  save(scene, state) { return this.runtime.saveScriptState(scene, state); }
  current(scene, runId, target, options) { return this.runtime.currentObject(scene, runId, target, options); }
  next(script, step) { return step.next.length ? step.next[Math.min(step.next.length - 1, Math.floor(this.random() * step.next.length))] : script.repeat ? 1 : null; }
  advance(progress, next) {
    progress.stepId = next; progress.status = next === null ? "done" : "ready";
    // Explicit null is essential: Foundry recursively merges flag objects.
    progress.action = null; progress.nextStepId = null;
  }
  async claim(scene, state, object, script, progress, key, stage, step, extra = {}) {
    progress.sequence = Number(progress.sequence ?? 0) + 1; progress.status = "pending";
    const job = { key: `${scene.id}:${state.runId}:${key}`, progressKey: key, scene, object, target: targetOf(object), runId: state.runId,
      groupId: state.groupId, script: clone(script), step: clone(step), sequence: progress.sequence, stage,
      combat: this.combat.context(scene, object), ...extra };
    this.jobs.set(job.key, job);
    try { await this.save(scene, state); } catch (error) { this.jobs.delete(job.key); throw error; }
    return job;
  }
  async tick(scene, initial, object, script, elapsed, { slot = "routine" } = {}) {
    const target = targetOf(object), key = scriptProgressKey(target, script, slot), jobKey = `${scene.id}:${initial.runId}:${key}`;
    let state = this.state(scene, initial.runId);
    if (!state || !this.current(scene, initial.runId, target) || script.enabled === false) return;
    state.scriptStates ??= {};
    const progress = state.scriptStates[key] ??= initialScriptProgress(script);
    if (progress.status === "pending") {
      if (!this.jobs.has(jobKey)) { progress.status = "uncertain"; state.error = `Скрипт «${script.name || object.name}»: исход прежнего действия неизвестен. Проверьте результат и явно перезапустите состояние.`; await this.save(scene, state); this.runtime.onChange(scene); }
      return;
    }
    const combat = this.combat.context(scene, object);
    if (combat) {
      if (!script.combat.enabled || !combat.isTurn || progress.combat?.stoppedId === combat.id) return;
      if (progress.combat?.turnKey !== combat.turnKey) {
        progress.combat = { id: combat.id, turnKey: combat.turnKey, remaining: script.combat.turnSeconds, confirmedStepId: null, ended: false, stoppedId: null };
      }
      if (progress.status === "done" || progress.combat.remaining <= 0) {
        if (script.combat.endTurn && !progress.combat.ended) return this.claim(scene, state, object, script, progress, key, "endTurn", { id: progress.stepId ?? 0, kind: "wait", parameters: {}, next: [] }, { combat });
        await this.save(scene, state); return;
      }
    } else if (progress.combat) progress.combat = null;
    if (["done", "uncertain", "failed"].includes(progress.status)) return;
    let available = combat ? progress.combat.remaining : Math.max(0, elapsed);
    for (let index = 0; index < LIMIT; index++) {
      if (!this.current(scene, state.runId, target) || !sameTurn(combat, this.combat.context(scene, object))) return;
      if (combat && progress.combat.remaining <= 0) return;
      const step = script.steps.find((entry) => entry.id === progress.stepId);
      if (!step) { progress.status = "done"; await this.save(scene, state); return; }
      if (progress.action?.stepId !== step.id) {
        progress.action = actionFor(scene, object, step);
      }
      const action = progress.action, params = step.parameters;
      if (combat && progress.combat.confirmedStepId !== step.id) {
        const remaining = duration(step, action);
        const rounds = 1 + Math.ceil(Math.max(0, remaining - progress.combat.remaining) / script.combat.turnSeconds);
        return this.claim(scene, state, object, script, progress, key, "combat", step, { combat, rounds });
      }
      if (step.kind === "emotion" && !action.started) { progress.emoji = params.emoji; progress.emojiAt = visualTime(state); action.started = true; }
      let consumed = 0;
      if (step.kind === "move") {
        const movement = await advanceScriptMovement(scene, object, action.movement, available, { isCurrent: () => this.current(scene, state.runId, target) });
        consumed = movement.consumed;
        if (combat) progress.combat.remaining = Math.max(0, progress.combat.remaining - consumed);
        available = Math.max(0, available - consumed);
        await this.save(scene, state);
        if (!movement.done) return;
      } else if (["duration", "before", "after"].includes(action.phase)) {
        consumed = Math.min(available, action.remainingMs / 1000);
        action.remainingMs = Math.max(0, action.remainingMs - consumed * 1000);
        available = Math.max(0, available - consumed);
        if (combat) progress.combat.remaining = Math.max(0, progress.combat.remaining - consumed);
        if (action.remainingMs > 0) { await this.save(scene, state); this.runtime.refreshObject(object); return; }
        if (action.phase === "before") { action.phase = "effect"; return this.claim(scene, state, object, script, progress, key, "effect", step); }
        if (step.kind === "speech" && action.phase === "duration") return this.claim(scene, state, object, script, progress, key, "speechEnd", step);
        if (step.kind === "emotion" && params.duration > 0) { progress.emoji = ""; progress.emojiAt = visualTime(state); }
      } else return this.claim(scene, state, object, script, progress, key, "effect", step);
      this.advance(progress, this.next(script, step));
      await this.save(scene, state); this.runtime.refreshObject(object);
      if (progress.status === "done") return;
      if (!combat) available = 0; // A new step always starts with its own full timer.
    }
  }
  async effect(job, admitted) {
    const { scene, object, target, script, step, runId, stage } = job, p = step.parameters, effects = this.runtime.effects;
    const current = this.state(scene, runId)?.scriptStates?.[job.progressKey];
    if (stage === "combat") {
      await this.combat.notify(object, script, step, job.rounds, `${job.key}:${job.sequence}`);
      if (!admitted()) return;
      return { decision: await this.combat.confirmAction(object, script, step, job.rounds) };
    }
    if (stage === "endTurn") { if (admitted()) await this.combat.finishTurn(scene, object, job.combat); return {}; }
    if (step.kind === "speech") {
      const start = stage === "effect";
      if (start && admitted()) await effects.clearPreviousSpeech?.(scene, object);
      if ((start && current?.deleteMessages || !start && p.duration > 0 && p.chat.deleteAfter) && current?.messageIds?.length) await effects.removeSpeech(current.messageIds);
      if (admitted() && p.chat.enabled && p.chat.timing === (start ? "before" : "after")) {
        const messages = await effects.speak(scene, object, p.chat.text, { ...p.chat, visibleOnly: true, rich: true,
          expiresAfter: !start && p.chat.deleteAfter ? p.duration : 0 }, `${job.key}:${job.sequence}:chat`, admitted);
        return { messageIds: (messages ?? []).map((message) => message.id) };
      }
      return { messageIds: start ? [] : current?.messageIds ?? [] };
    }
    if (step.kind === "visibility") {
      if (!scriptObjectCapabilities(object).visibility) throw new Error("Этот объект не поддерживает скрытие.");
      if (admitted()) await object.update({ hidden: !p.visible }); return {};
    }
    if (step.kind === "sound") { if (admitted()) await effects.sound(p.src, p.volume); return {}; }
    if (step.kind === "signal") {
      if (admitted()) await this.runtime.emitObjectSignal(scene, target, p.signalId, clone(p.parameters), { originSceneId: scene.id, originRunId: runId, originGroupId: job.groupId, chainId: `${job.key}:${job.sequence}`, depth: 0 });
      return {};
    }
    if (step.kind === "macro") {
      if (!this.runtime.isObjectMacroAttached(scene, target, p.macroUuid)) throw new Error("Этот макрос не прикреплён к объекту скрипта.");
      try { await effects.macro(p.macroUuid, { scene, token: object, state: this.state(scene, runId)?.state, runId, stepId: step.id, isCurrent: admitted }); }
      catch (error) { if (error.code === "script-deferred") throw error; console.error("dmicher-master-screen | script macro", error); globalThis.ui?.notifications?.error(`Макрос скрипта: ${error.message ?? error}`); }
      return {};
    }
    throw new Error("Неизвестное действие скрипта.");
  }
  async execute(job) {
    const { scene, runId, target, sequence, step, script } = job;
    const current = () => this.current(scene, runId, target), owned = () => this.current(scene, runId, target, { ignoreInteractionPause: true });
    let dispose, cancel;
    const cancelled = new Promise((resolve) => { cancel = () => resolve({ stale: true }); dispose = onExecutionChange(scene, (reason) => { if (reason === "canvas-teardown" || !owned()) cancel(); }); this.cancels.add(cancel); });
    const admitted = () => {
      if (current() && sameTurn(job.combat, this.combat.context(scene, job.object))) return true;
      // A turn may change while the claimed job waits outside the scene queue.
      // Keep the action ready for its next admission; never start it off-turn.
      const error = new Error("Скрипт ожидает своего хода или завершения взаимодействия."); error.code = "script-deferred"; throw error;
    };
    try {
      const outcome = await Promise.race([Promise.resolve().then(() => { admitted(); return this.effect(job, admitted); }).then((result) => ({ result }), (error) => ({ error })), cancelled]);
      if (outcome.stale || !owned()) return;
      await withSceneLock(scene, async () => {
        if (!owned()) return;
        const state = this.state(scene, runId), progress = state?.scriptStates?.[job.progressKey];
        if (progress?.status !== "pending" || progress.sequence !== sequence) return;
        if (outcome.error?.code === "script-deferred") progress.status = "ready";
        else if (outcome.error) { progress.status = "failed"; state.error = `Скрипт «${script.name || job.object.name}»: ${outcome.error.message}`; globalThis.ui?.notifications?.error(state.error); }
        else if (job.stage === "combat") {
          progress.status = "ready";
          if (progress.combat?.turnKey === job.combat.turnKey) {
            if (outcome.result?.decision === "stop") progress.combat.stoppedId = job.combat.id;
            else if (outcome.result?.decision === "continue") progress.combat.confirmedStepId = step.id;
            else progress.combat.remaining = 0;
          }
        } else if (job.stage === "endTurn") { progress.status = progress.stepId === null ? "done" : "ready"; progress.combat.ended = true; }
        else if (step.kind === "speech" && job.stage === "effect") {
          progress.messageIds = outcome.result.messageIds; progress.deleteMessages = step.parameters.chat.deleteAfter;
          progress.bubble = step.parameters.bubble.enabled ? { text: step.parameters.bubble.text, fontSize: step.parameters.bubble.fontSize } : null;
          progress.bubbleAt = visualTime(state);
          progress.status = "ready"; progress.action.phase = "duration"; progress.action.remainingMs = step.parameters.duration * 1000;
        } else if (["signal", "macro"].includes(step.kind)) {
          progress.status = "ready"; progress.action.phase = "after"; progress.action.remainingMs = step.parameters.after * 1000;
        } else {
          if (job.stage === "speechEnd") {
            if (step.parameters.duration > 0) { progress.bubble = null; progress.bubbleAt = visualTime(state); }
            progress.messageIds = outcome.result.messageIds;
          }
          this.advance(progress, this.next(script, step));
        }
        await this.save(scene, state); this.runtime.onChange(scene); this.runtime.refreshObject(job.object);
      });
    } finally { dispose?.(); this.cancels.delete(cancel); if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); }
  }
  dispose() { for (const cancel of this.cancels) cancel(); this.cancels.clear(); this.jobs.clear(); }
}
