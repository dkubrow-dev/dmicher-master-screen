import { getRuntimeForRun, saveRuntime, withSceneLock } from "./store.js";
import { tokenCenter } from "./effects.js";
import { getEventCatalog, validateTypedTrigger } from "./event-catalog.js";
import { onExecutionChange } from "./execution.js";

const clone = structuredClone;
const INSTANT_LIMIT = 16;
const keyOf = (scene, state, token) => `${scene.id}:${state.runId}:${token.id}`;

/** One small persisted program per token. A pending external action is never replayed
 * by a replacement client: its outcome is unknown until an explicit episode restart. */
export class TokenRoutineRuntime {
  constructor(runtime, { random = Math.random } = {}) { this.runtime = runtime; this.random = random; this.jobs = new Map(); this.cancels = new Set(); }
  next(routine, step) {
    if (step.next.length) return step.next[Math.min(step.next.length - 1, Math.floor(this.random() * step.next.length))];
    return routine.repeat ? routine.steps[0]?.id ?? null : null;
  }
  advance(state, tokenId, next) {
    const progress = state.routineStates[tokenId]; progress.stepId = next; progress.status = next === null ? "done" : "ready";
    delete progress.remainingMs; delete progress.nextStepId;
  }
  async tick(scene, initial, token, routine, elapsed) {
    const runtime = this.runtime, key = keyOf(scene, initial, token);
    let state = getRuntimeForRun(scene, initial.runId);
    if (!state || !runtime.currentToken(scene, state.runId, token.id)) return;
    state.routineStates ??= {};
    let progress = state.routineStates[token.id] ??= { stepId: routine.steps[0]?.id ?? null, status: routine.steps.length ? "ready" : "done", sequence: 0 };
    if (progress.status === "pending") {
      if (!this.jobs.has(key)) {
        progress.status = "uncertain"; state.error = `Распорядок «${token.name}»: исход прежнего действия неизвестен. Явно перезапустите эпизод после проверки.`;
        await saveRuntime(scene, state); runtime.onChange(scene);
      }
      return;
    }
    if (["done", "uncertain", "failed"].includes(progress.status)) return;
    for (let index = 0; index < INSTANT_LIMIT; index++) {
      if (!runtime.currentToken(scene, state.runId, token.id)) return;
      const step = routine.steps.find((entry) => entry.id === progress.stepId);
      if (!step) { progress.status = "done"; await saveRuntime(scene, state); return; }
      const params = step.parameters;
      if (step.kind === "wait") {
        progress.remainingMs ??= params.seconds * 1000;
        progress.remainingMs = Math.max(0, progress.remainingMs - elapsed * 1000);
        if (progress.remainingMs > 0) { await saveRuntime(scene, state); return; }
      } else if (step.kind === "move") {
        const distance = Math.hypot(params.x - token.x, params.y - token.y);
        const stride = params.speed * Number(scene.grid?.size ?? 100) / Number(scene.grid?.distance || 1) * elapsed;
        if (distance > 0.001 && stride <= 0) return;
        if (distance > 0.001) {
          const ratio = Math.min(1, stride / distance), changes = { x: token.x + (params.x - token.x) * ratio, y: token.y + (params.y - token.y) * ratio };
          const origin = tokenCenter(token, scene), destination = { x: origin.x + changes.x - token.x, y: origin.y + changes.y - token.y };
          if (token.object?.checkCollision?.(destination, { origin, type: "move", mode: "any" })) {
            progress.status = "failed"; state.error = `Распорядок «${token.name}»: путь пересекает стену.`;
            await saveRuntime(scene, state); runtime.onChange(scene); return;
          }
          await token.update(changes, { animate: true, animation: { duration: Math.min(500, elapsed * 1000) } });
          if (!runtime.currentToken(scene, state.runId, token.id)) return;
          if (ratio < 1) return;
        }
      } else if (step.kind === "emotion") {
        progress.emoji = params.emoji;
      } else {
        progress.sequence = Number(progress.sequence ?? 0) + 1;
        progress.status = "pending"; progress.nextStepId = this.next(routine, step);
        const job = { key, scene, tokenId: token.id, runId: state.runId, schemeId: state.schemeId,
          step: clone(step), sequence: progress.sequence };
        this.jobs.set(key, job);
        try { await saveRuntime(scene, state); } catch (error) { this.jobs.delete(key); throw error; }
        return job;
      }
      this.advance(state, token.id, this.next(routine, step));
      await saveRuntime(scene, state); runtime.refreshToken(token);
      if (progress.status === "done") return;
      elapsed = 0;
    }
  }
  async execute(job) {
    const { scene, tokenId, runId, step, sequence } = job, runtime = this.runtime;
    const token = scene.tokens.get(tokenId), current = () => runtime.currentToken(scene, runId, tokenId);
    const stillOwned = () => runtime.currentToken(scene, runId, tokenId, { ignoreInteractionPause: true });
    let dispose, cancel;
    const cancelled = new Promise((resolve) => { cancel = () => resolve({ stale: true });
      dispose = onExecutionChange(scene, (reason) => { if (reason === "canvas-teardown" || !stillOwned()) cancel(); }); this.cancels.add(cancel); });
    try {
      // Admission can pause between the claim and execution. No side effect has begun:
      // put this exact step back; its random successor remains unobserved preparation.
      if (!current()) {
        if (stillOwned()) await withSceneLock(scene, async () => { const state = getRuntimeForRun(scene, runId), progress = state?.routineStates?.[tokenId];
          if (progress?.status === "pending" && progress.sequence === sequence) { progress.status = "ready"; await saveRuntime(scene, state); } });
        return;
      }
      const operation = async () => {
        // Foundry may resolve a Macro UUID or Generics may await its chat queue.
        // A pause before that first side effect defers this step instead of silently
        // consuming it. Once an effect has happened, it is never replayed.
        const admitted = () => {
          if (current()) return true;
          const error = new Error("Шаг ожидает завершения взаимодействия."); error.code = "routine-deferred"; throw error;
        };
        const context = { originSceneId: scene.id, originRunId: runId, originSchemeId: job.schemeId, chainId: job.key + sequence, depth: 0 };
        const invoke = (name, trigger) => { if (!current()) throw new Error("Распорядок остановлен или приостановлен взаимодействием.");
          if (typeof runtime.onTypedEvent !== "function") throw new Error("Исполнитель событий не подключён.");
          return runtime.onTypedEvent(scene, name, trigger, { context }); };
        if (step.kind === "speech") {
          const options = step.parameters;
          if (options.chat) await runtime.effects.speak(scene, token, options.text, { range: 30, visibleOnly: true }, `${job.key}:${sequence}:chat`, admitted);
          if (options.bubble && (!options.chat || current())) await runtime.effects.bubble(token, options.text, admitted);
        } else if (step.kind === "event") {
          const catalog = getEventCatalog(scene), descriptor = catalog.triggers.find((entry) => entry.id === step.parameters.triggerId);
          const event = catalog.events.find((entry) => entry.id === descriptor?.eventId && entry.name === step.parameters.eventName);
          if (!descriptor || !event) throw new Error("Событие или триггер распорядка больше не существует.");
          const trigger = validateTypedTrigger(catalog, event, { ...clone(step.parameters.parameters), type: descriptor.name });
          await invoke(event.name, trigger);
        } else if (step.kind === "macro") {
          await runtime.effects.macro(step.parameters.macroUuid, { scene, token, episode: getRuntimeForRun(scene, runId)?.episode,
            runId, parameters: clone(step.parameters.parameters), stepId: step.id, isCurrent: admitted, InvokeDmicherMasterScreenEvent: invoke });
        } else throw new Error("Неизвестный шаг распорядка.");
      };
      const outcome = await Promise.race([Promise.resolve().then(operation).then(() => ({ done: true }), (error) => ({ error })), cancelled]);
      if (outcome.stale || !stillOwned()) return;
      await withSceneLock(scene, async () => {
        if (!stillOwned()) return;
        const state = getRuntimeForRun(scene, runId), progress = state.routineStates?.[tokenId];
        if (progress?.status !== "pending" || progress.sequence !== sequence) return;
        if (outcome.error?.code === "routine-deferred") progress.status = "ready";
        else if (outcome.error) { progress.status = "failed"; state.error = `Распорядок «${token.name}»: ${outcome.error.message}`; }
        else this.advance(state, tokenId, progress.nextStepId);
        await saveRuntime(scene, state); runtime.onChange(scene);
      });
    } finally { dispose?.(); this.cancels.delete(cancel); if (this.jobs.get(job.key) === job) this.jobs.delete(job.key); }
  }
  dispose() { for (const cancel of this.cancels) cancel(); this.cancels.clear(); this.jobs.clear(); }
}
