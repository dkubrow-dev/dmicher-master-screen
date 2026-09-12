import { message as localizedMessage } from "./localization.js";
import { MODULE_ID, randomId } from "./model.js";
import { getRuntime, getRuntimeForRun, requireGM, isAuthority } from "./store.js";
import { getSignalCatalog } from "./signal-catalog.js";
import { validateSignalValues } from "./signal-types.js";
import { executeSignalMacro, reportMacroError } from "./signal-macros.js";
import { isExecutionHalted, executionGeneration, onExecutionChange, isSceneAutomationHalted, sceneExecutionGeneration } from "./execution.js";

/** Awaitable, emitter-bound delivery. Nested signals run in their own call frame:
 * a handler may await its own emitted signal without waiting behind itself. */
export class SceneSignals {
  constructor({ runtime, onChange = () => {}, resolveMacro = globalThis.fromUuid, isConstructor = () => false, canHandle } = {}) {
    this.runtime = runtime; this.onChange = onChange; this.resolveMacro = resolveMacro; this.isConstructor = isConstructor; this.canHandle = canHandle;
    this.receipts = new WeakMap(); this.logs = new WeakMap(); this.pending = new Set(); this.cancelled = new Set(); this.disposed = false;
  }
  requireAuthority() {
    requireGM();
    if (!isAuthority()) throw new Error(localizedMessage("Сигналы исполняет выбранный активный полный мастер."));
    if (this.disposed) throw new Error(localizedMessage("Обработчик сигналов остановлен."));
  }
  current(scene, context = {}) {
    if (this.disposed || !isAuthority()) return false;
    if (!context.validation && isSceneAutomationHalted(scene)) return false;
    if (context._sceneGeneration !== undefined && context._sceneGeneration !== sceneExecutionGeneration(scene)) return false;
    if (context.current && !context.current()) return false;
    const runId = context.runId ?? context.originRunId;
    if (context.groupId && context._generation !== undefined && executionGeneration(scene, context.groupId) !== context._generation) return false;
    if (!runId) return true;
    const state = getRuntimeForRun(scene, runId);
    return Boolean(state && (context.validation || context.manual || !isExecutionHalted(scene, state)) && (!context.groupId || state.groupId === context.groupId));
  }
  history(scene) { return structuredClone(this.logs.get(scene) ?? []); }
  emit(scene, input) {
    this.requireAuthority();
    const catalog = getSignalCatalog(scene), emitter = catalog.emitters.find((entry) => entry.key === input.emitterKey);
    const signal = catalog.signals.find((entry) => entry.emitterKey === input.emitterKey && (input.signalId ? entry.id === input.signalId : entry.name === input.name));
    if (!emitter || !signal) throw new Error(localizedMessage("Эмитент не объявлял этот сигнал в текущей сцене."));
    const parameters = validateSignalValues(signal.parameters, input.parameters ?? {}), id = input.id ?? randomId();
    const inherited = input.context ?? {}, chain = inherited._chain ?? { count: 0 }, depth = inherited.depth ?? 0;
    if (depth >= 32 || chain.count >= 64) throw new Error(localizedMessage("Цепочка сигналов превысила 32 вложения или 64 вызова."));
    const signature = JSON.stringify([emitter.key, signal.id, parameters]);
    let receipts = this.receipts.get(scene);
    if (!receipts) this.receipts.set(scene, receipts = new Map());
    const previous = receipts.get(id);
    if (previous) {
      if (previous.signature !== signature) throw new Error(localizedMessage("ID сигнала уже использован с другими параметрами."));
      return previous.promise;
    }
    while (receipts.size >= 200) {
      const removable = [...receipts].find(([, entry]) => entry.done);
      if (!removable) throw new Error(localizedMessage("Слишком много незавершённых сигналов."));
      receipts.delete(removable[0]);
    }
    chain.count++;
    const context = { ...inherited, ...(input.runId ? { runId: input.runId } : {}), ...(input.groupId ? { groupId: input.groupId } : {}), _chain: chain, depth };
    context._sceneGeneration ??= sceneExecutionGeneration(scene);
    if (context.groupId && context._generation === undefined) context._generation = executionGeneration(scene, context.groupId);
    const receipt = { signature, done: false };
    // Defer dispatch until the receipt is registered, including synchronous recursion.
    receipt.promise = Promise.resolve().then(() => this.deliver(scene, { id, emitter, signal, parameters, context, allowStopped: input.allowStopped === true }))
      .finally(() => { receipt.done = true; this.pending.delete(receipt.promise); });
    receipts.set(id, receipt); this.pending.add(receipt.promise);
    return receipt.promise;
  }
  async awaitCurrent(scene, current, operation) {
    let cancel;
    const cancelled = new Promise((resolve) => { cancel = () => resolve({ stale: true }); });
    const check = (reason) => { if (reason === "canvas-teardown" || !current()) cancel(); };
    const dispose = onExecutionChange(scene, check); this.cancelled.add(cancel);
    try {
      check();
      const task = Promise.resolve().then(async () => current() ? { value: await operation() } : { stale: true }).catch((error) => ({ error }));
      const outcome = await Promise.race([cancelled, task]);
      if (outcome.error) throw outcome.error;
      return outcome;
    } finally { dispose(); this.cancelled.delete(cancel); }
  }
  async deliver(scene, delivery) {
    const { id, emitter, signal, parameters, context, allowStopped } = delivery;
    const result = { id, emitterKey: emitter.key, signalId: signal.id, name: signal.name, parameters, status: "done", results: [], allowed: true, exit: false, interrupt: false, messages: [] };
    const sourceCurrent = () => {
      if (!this.current(scene, context)) return false;
      const catalog = getSignalCatalog(scene);
      return catalog.emitters.some((entry) => entry.key === emitter.key)
        && catalog.signals.some((entry) => entry.id === signal.id && entry.emitterKey === emitter.key);
    };
    if (!sourceCurrent()) return { ...result, status: "stale", allowed: false };
    const subscribers = getSignalCatalog(scene).subscriptions.filter((entry) => entry.enabled && entry.signalId === signal.id && entry.emitterKey === emitter.key);
    for (const subscription of subscribers) {
      if (!sourceCurrent()) { result.status = "stale"; result.allowed = false; break; }
      const catalog = getSignalCatalog(scene), owner = catalog.emitters.find((entry) => entry.key === subscription.ownerKey);
      const live = catalog.subscriptions.find((entry) => entry.id === subscription.id && entry.enabled && entry.macroUuid === subscription.macroUuid);
      if (!owner || !live) continue;
      const state = owner.groupId ? getRuntime(scene, { groupId: owner.groupId }) : null;
      const validation = signal.returns.some((field) => field.name === "allowed");
      const binding = scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings?.[owner.key];
      if (binding?.playerCharacter || state?.disabledObjects?.includes(owner.key)) continue;
      const validatesOwnGroup = ["validateStart", "validateTransition"].includes(signal.name) && emitter.type === "Group" && emitter.id === owner.groupId;
      if (!allowStopped && !validatesOwnGroup && state && (!state.runId || isExecutionHalted(scene, state))) continue;
      if (this.canHandle && !this.canHandle(scene, owner, signal)) continue;
      const generation = owner.groupId ? executionGeneration(scene, owner.groupId) : null;
      const current = () => {
        if (!sourceCurrent() || owner.groupId && generation !== executionGeneration(scene, owner.groupId)) return false;
        const catalog = getSignalCatalog(scene), liveOwner = catalog.emitters.find((entry) => entry.key === owner.key);
        if (!liveOwner || liveOwner.groupId !== owner.groupId) return false;
        const liveState = owner.groupId ? getRuntime(scene, { groupId: owner.groupId }) : null;
        return (!owner.groupId || liveState?.runId === state?.runId && !liveState?.disabledObjects?.includes(owner.key))
          && !scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings?.[owner.key]?.playerCharacter
          && catalog.macros.some((entry) => entry.ownerKey === owner.key && entry.uuid === subscription.macroUuid)
          && catalog.subscriptions.some((entry) => entry.id === subscription.id && entry.enabled && entry.macroUuid === subscription.macroUuid
            && entry.ownerKey === owner.key && entry.emitterKey === emitter.key && entry.signalId === signal.id);
      };
      const entry = { subscriptionId: subscription.id, ownerKey: owner.key, ownerName: owner.name, status: "done", returns: {} };
      result.results.push(entry);
      try {
        const macro = await this.resolveMacro(subscription.macroUuid);
        const scope = {
          scene, emitter: structuredClone(emitter), subscriber: structuredClone(owner), signal: structuredClone(signal),
          transition: (groupId, stateId) => {
            if (!current()) throw new Error(localizedMessage("Подписка относится к прежнему запуску автоматизации."));
            const active = getRuntime(scene, { groupId });
            return this.runtime.enter(scene, stateId, { groupId, expectedRunId: active.runId, signalContext: { ...context, depth: context.depth + 1 } });
          },
          halt: (groupId = owner.groupId) => { if (!current()) throw new Error(localizedMessage("Подписка остановлена.")); return groupId ? this.runtime.halt(scene, { groupId }) : this.runtime.haltAll(scene); },
          emit: (name, values = {}) => {
            if (!current()) throw new Error(localizedMessage("Подписка относится к прежнему запуску автоматизации."));
            return this.emit(scene, { emitterKey: owner.key, name, parameters: values, context: { ...context, current, depth: context.depth + 1 } });
          }
        };
        const outcome = await this.awaitCurrent(scene, current, () => executeSignalMacro(macro, signal, parameters, scope));
        if (outcome.stale) { entry.status = "stale"; result.status = "stale"; result.allowed = false; break; }
        entry.returns = outcome.value;
        if (signal.returns.some((field) => field.name === "allowed") && entry.returns.allowed !== true) result.allowed = false;
        if (entry.returns.exit === true) result.exit = true;
        if (entry.returns.interrupt === true) result.interrupt = true;
        if (entry.returns.message) result.messages.push({ ownerKey: owner.key, name: owner.name, message: entry.returns.message });
      } catch (error) {
        entry.status = "failed"; entry.error = reportMacroError(error, { name: subscription.macroUuid, signalName: signal.name, notify: this.isConstructor() });
        result.status = "failed";
        if (validation) result.allowed = false;
        result.messages.push({ ownerKey: owner.key, name: owner.name, message: entry.error });
      }
    }
    const log = this.logs.get(scene) ?? [];
    log.push({ ...structuredClone(result), at: Date.now() }); this.logs.set(scene, log.slice(-100));
    this.onChange(scene);
    return result;
  }
  async whenIdle() { while (this.pending.size) await Promise.allSettled([...this.pending]); }
  dispose() { this.disposed = true; for (const cancel of this.cancelled) cancel(); this.cancelled.clear(); }
}
