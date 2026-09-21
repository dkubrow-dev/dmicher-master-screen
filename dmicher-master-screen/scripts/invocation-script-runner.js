import { ObjectScriptRuntime, scriptProgressKey } from "./script-runtime.js";
import { normalizeScript } from "./script-model.js";
import { getScriptFunction } from "./script-functions/index.js";
import { createExecutionScope, notifyExecutionChange } from "./execution.js";
import { withSceneLock } from "./store.js";
import { text } from "./localization.js";

const terminal = progress => ["done", "stopped", "failed", "uncertain"].includes(progress?.status);

/** A host adapter for the shared interpreter. Group and world events have no
 * moving document or combat turn. Their progress lives only for the invocation;
 * preparation stays with the owning tool. No hidden Actor/Scene is created. */
export class InvocationScriptRunner {
  constructor({ effects, now = () => Date.now(), onError = console.error, canUsePremiumStep } = {}) {
    this.runs = new Map(); this.now = now; this.onError = onError; this.disposed = false;
    this.effects = effects ?? {};
    this.combat = { context: () => null };
    this.canUsePremiumStep = canUsePremiumStep;
    this.engine = new ObjectScriptRuntime(this);
  }
  scriptState(_host, runId) { const run = this.runs.get(runId); return run && structuredClone(run.state); }
  saveScriptState(_host, state) { const run = this.runs.get(state.runId); if (run?.current()) run.state = structuredClone(state); }
  currentObject(host, runId) { const run = this.runs.get(runId); return !this.disposed && run?.host === host && run.current(); }
  owns(host, runId) { return this.currentObject(host, runId); }
  scriptScope(_host, runId) { return this.runs.get(runId)?.scope; }
  refreshObject() {}
  onChange() {}
  variableContext(_host, object, current, extra) {
    const run = [...this.runs.values()].find(entry => entry.object === object);
    return { ...extra, ...run?.context,
      parameters: structuredClone(run?.state.executionContext.parameters ?? {}),
      signal: run?.state.executionContext.signal && structuredClone(run.state.executionContext.signal),
      isCurrent: current };
  }
  isObjectMacroAttached(host, target, uuid) {
    return [...this.runs.values()].find(run => run.host === host && run.object.id === target.id)?.adapters.isMacroAttached?.(uuid) === true;
  }
  emitObjectSignal(host, _target, signalId, parameters, context) {
    const run = this.runs.get(context.originRunId);
    if (!run?.current()) return {};
    return run.adapters.emitSignal?.(signalId, parameters, run.current) ?? {};
  }
  changeStates(host, transitions, options) {
    const run = this.runs.get(options.originRunId);
    return run?.current() ? run.adapters.changeStates?.(transitions, run.current) : undefined;
  }
  async run({ host, owner, scope, script: prepared, current = () => true, context = {}, adapters = {} }) {
    if (this.disposed || !host || !current()) return {};
    if (this.runs.size >= 100) throw new Error(text("Слишком много одновременных обработчиков.", "Too many simultaneous handlers."));
    const script = normalizeScript(prepared);
    if (!script.enabled || !script.steps.length) return {};
    for (const step of script.steps) {
      const fn = getScriptFunction(step.kind);
      if (!fn?.scopes.includes(scope) || fn.acceptsOwner && !fn.acceptsOwner(owner)) throw new Error(text("Функция недоступна этому источнику.", "This function is unavailable to this source."));
    }
    const runId = globalThis.crypto.randomUUID();
    const object = { documentName: owner.type, id: owner.id, name: owner.name ?? owner.id, uuid: owner.uuid };
    let resolve;
    const completion = new Promise(done => { resolve = done; });
    const invocation = { host, object, adapters, context, scope, current: () => !this.disposed && this.runs.has(runId) && current(),
      script, resolve, at: this.now(), state: { runId, groupId: owner.groupId ?? null, stateId: context.state?.id ?? null,
        state: context.state ?? null, manual: true, purpose: "subscription", script, executionContext: context, scriptStates: {} } };
    // Context may contain callable capabilities. Persisted interpreter progress
    // uses only the serializable signal input; callable scope stays in the adapter.
    invocation.state.executionContext = { parameters: structuredClone(context.parameters ?? {}), signal: context.signal && structuredClone(context.signal) };
    this.runs.set(runId, invocation);
    const lease = createExecutionScope(host, { isCurrent: invocation.current });
    try {
      this.startClock();
      const result = await lease.run(() => completion);
      if (result.stale) return {};
      if (result.value.error) throw result.value.error;
      return result.value.values ?? {};
    } finally {
      lease.dispose(); this.runs.delete(runId); notifyExecutionChange(host, "invocation-finished");
      if (!this.runs.size) this.stopClock();
    }
  }
  startClock() {
    if (!this.interval) this.interval = globalThis.setInterval(() => { void this.tick().catch(this.onError); }, 100);
  }
  stopClock() { globalThis.clearInterval(this.interval); this.interval = null; }
  async tick() {
    if (this.busy || this.disposed) return;
    this.busy = true; const jobs = [];
    try {
      for (const [runId, run] of this.runs) {
        if (!run.current()) { run.resolve({}); notifyExecutionChange(run.host, "invocation-cancelled"); continue; }
        const now = this.now(), elapsed = Math.min(1, Math.max(0, (now - run.at) / 1000)); run.at = now;
        if (globalThis.game?.paused) continue;
        await withSceneLock(run.host, async () => {
          if (!run.current()) return;
          const job = await this.engine.tick(run.host, this.scriptState(run.host, runId), run.object, run.script, elapsed, { slot: "subscription" });
          if (job) jobs.push(job);
          const progress = this.runs.get(runId)?.state.scriptStates[scriptProgressKey({ type: run.object.documentName, id: run.object.id }, run.script, "subscription")];
          if (terminal(progress)) run.resolve({ values: progress.returns ?? {}, error: ["failed", "uncertain"].includes(progress.status) ? new Error(run.state.error || text("Обработчик завершился с ошибкой.", "The handler failed.")) : null });
        });
      }
    } finally { this.busy = false; }
    await Promise.all(jobs.map(job => this.engine.execute(job)));
  }
  cancel(host, predicate = () => true) {
    for (const [runId, run] of this.runs) if ((!host || run.host === host) && predicate(run)) { this.runs.delete(runId); run.resolve({}); notifyExecutionChange(run.host, "invocation-cancelled"); }
    if (!this.runs.size) this.stopClock();
  }
  dispose() { this.disposed = true; this.cancel(); this.engine.dispose(); this.stopClock(); }
}
