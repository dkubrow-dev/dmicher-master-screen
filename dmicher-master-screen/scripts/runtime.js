import { message as localizedMessage, text } from "./localization.js";
import { objectCenter, crossesRectangle } from "./scene-object-geometry.js";
import { MODULE_ID, getState, emptyRuntime } from "./model.js";
import { getDefinition, getDefinitions, getRuntime, getRuntimes, getRuntimeForRun, saveRuntime, withSceneLock, requireGM, isAuthority, asArray } from "./store.js";
import { createFoundryEffects } from "./effects.js";
import { getConditionKey, getConditionGate, consumeCondition, resetStateConditions } from "./interaction-conditions.js";
import { executionGeneration, requestHalt, finishHalt, isExecutionHalted, notifyExecutionChange,
  sceneExecutionGeneration, requestSceneHalt, finishSceneHalt, isSceneAutomationHalted, createExecutionScope } from "./execution.js";
import { materializeState, getSceneObject, getObjectBindings, objectKey } from "./scene-objects.js";
import { isInteractionPaused } from "./interaction-pause.js";
import { ObjectScriptRuntime, scriptProgressKey } from "./script-runtime.js";
import { createCombatAdapter } from "./combat-adapter.js";
import { getSignalCatalog } from "./signal-catalog.js";
import { SCENE_OBJECT_TYPES, SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { DEFAULT_EMOTION_SIZE, normalizeStateTransitions } from "./script-model.js";
import { appendFollowWaypoint } from "./script-target-movement.js";
import { stopObjectAnimation, scriptObjectBounds } from "./script-movement.js";
import { writeSceneFlags } from "./scene-flags.js";
import { debugTrace, debugError } from "./debug.js";

const clone = (value) => structuredClone(value);
const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID();
const uuid = (scene) => scene.uuid ?? `Scene.${scene.id}`;

/** Owns group lifetimes. Scripts and signals have separate executors and never own group state. */
export class GroupRuntime {
  constructor({ onChange = () => {}, onWorkspace = async () => {}, emitSignal = async () => ({ allowed: true }), chat,
    effects, visuals, now = () => Date.now(), isConstructor = () => false, combat, startScriptDialogues } = {}) {
    Object.assign(this, { onChange, onWorkspace, emitSignal, now, isConstructor, startScriptDialogues });
    // Views observe execution; neither a synchronous render failure nor a
    // rejected refresh promise can veto a control command or a runtime write.
    this.onChange = scene => {
      try { Promise.resolve(onChange(scene)).catch(error => this.report(error, { category: "interface", event: "refresh.failed", context: { sceneId: scene?.id } })); }
      catch (error) { this.report(error, { category: "interface", event: "refresh.failed", context: { sceneId: scene?.id } }); }
    };
    this.visuals = visuals;
    this.effects = effects ?? createFoundryEffects(chat);
    this.chat = chat; this.hooks = []; this.previousPositions = new Map(); this.tickTimes = new Map();
    this.manualRuns = new Map(); this.manualVisuals = new Map(); this.restorations = new Map(); this.busy = false; this.disposed = false;
    this.presentedRuns = new Map();
    this.startCommands = new WeakMap();
    this.groupStartCommands = new WeakMap();
    this.combat = combat ?? createCombatAdapter({ chat, emitSignal: (scene, name, parameters) => this.emitSignal(scene, { emitterKey: `Combat:${scene.id}`, name, parameters }) });
    this.scripts = new ObjectScriptRuntime(this);
  }
  requireAuthority(scene) { requireGM(); if (!isAuthority() || !scene || globalThis.canvas?.scene?.id !== scene.id) throw new Error(localizedMessage("Действие доступно исполняющему мастеру текущей сцены.")); }
  owns(scene, runId) {
    if (this.disposed || !isAuthority() || globalThis.canvas?.scene?.id !== scene?.id) return false;
    if (!runId) return true;
    if (this.commandExecutor?.has(runId)) return this.commandExecutor.owns(scene, runId);
    if (this.manualRuns.has(runId)) {
      const run = this.manualRuns.get(runId);
      return run.sceneId === scene.id && (!run.restorationId || this.restorationCurrent(scene, this.restorations.get(run.restorationId)));
    }
    const run = getRuntimeForRun(scene, runId);
    return Boolean(run?.state && !isExecutionHalted(scene, run));
  }
  report(error, { category = "runtime", event = "failed", context = {} } = {}) {
    console.error(MODULE_ID, error); debugError(category, event, error, context);
    globalThis.ui?.notifications?.error?.(error?.message ?? String(error));
  }
  start() {
    if (this.interval) return this;
    this.disposed = false;
    const on = (name, fn) => this.hooks.push([name, Hooks.on(name, fn)]);
    on("canvasReady", () => { this.tickTimes.clear(); this.refresh(canvas.scene); });
    on("canvasTearDown", () => { this.commandExecutor?.clear(globalThis.canvas?.scene); this.restorations.clear(); this.manualRuns.clear(); this.manualVisuals.clear(); notifyExecutionChange(globalThis.canvas?.scene, "canvas-teardown"); this.tickTimes.clear(); this.visuals?.clear(); });
    on("updateUser", () => notifyExecutionChange(globalThis.canvas?.scene));
    for (const hook of ["createCombat", "updateCombat", "deleteCombat", "pauseGame"]) {
      on(hook, () => notifyExecutionChange(globalThis.canvas?.scene, "combat-or-pause"));
    }
    on("updateScene", (scene, changes) => { if (changes.flags?.[MODULE_ID] || Object.keys(changes).some((key) => key.startsWith(`flags.${MODULE_ID}`))) this.refresh(scene); });
    for (const type of SCENE_OBJECT_TYPES) {
      // Native refresh hooks run during animation frames. They only reposition
      // existing decorations; reading group/script data belongs to Scene updates.
      on(`refresh${type}`, (object) => this.visuals?.refresh?.(object.document));
      on(`delete${type}`, (document) => this.visuals?.remove(document));
      on(`update${type}`, (document) => { void this.recordFollowTarget(document).catch(error => this.report(error)); });
    }
    on("preUpdateToken", (token, changes) => { if ("x" in changes || "y" in changes) this.previousPositions.set(token.uuid ?? token.id, objectCenter(token, token.parent)); });
    on("updateToken", (token, changes) => {
      if (!("x" in changes || "y" in changes)) return;
      const key = token.uuid ?? token.id, previous = this.previousPositions.get(key); this.previousPositions.delete(key);
      if (previous) void this.onTokenMove(token, previous).catch((error) => this.report(error));
    });
    this.combat.activate?.();
    this.effects.start?.();
    this.interval = setInterval(() => { void this.tick().catch((error) => this.report(error)); }, 100);
    return this;
  }
  dispose() {
    this.disposed = true; notifyExecutionChange(globalThis.canvas?.scene, "runtime-disposed"); clearInterval(this.interval); this.interval = null;
    this.commandExecutor?.dispose();
    this.restorations.clear(); this.manualRuns.clear(); this.manualVisuals.clear(); this.scripts.dispose?.(); this.combat.dispose?.(); this.effects.dispose?.(); this.visuals?.clear(); this.presentedRuns.clear();
    for (const [name, id] of this.hooks) Hooks.off(name, id); this.hooks = []; this.tickTimes.clear();
  }
  scriptState(scene, runId) {
    if (this.commandExecutor?.has(runId)) return this.commandExecutor.state(scene, runId);
    return this.manualRuns.has(runId) ? clone(this.manualRuns.get(runId)) : getRuntimeForRun(scene, runId);
  }
  async saveScriptState(scene, state) {
    if (!this.owns(scene, state.runId)) return;
    if (state.command) return this.commandExecutor?.save(scene, state);
    if (state.manual) {
      if (!this.manualRuns.has(state.runId)) return;
      this.manualRuns.set(state.runId, clone(state)); this.refresh(scene); return state;
    }
    return saveRuntime(scene, state);
  }
  currentObject(scene, runId, target, { ignoreInteractionPause = false, scriptKey, excludeDialogueSessions = [] } = {}) {
    if (!this.owns(scene, runId)) return false;
    const run = this.scriptState(scene, runId), binding = getObjectBindings(scene).bindings[objectKey(target)];
    if (!run) return false;
    if (!getSceneObject(scene, target) || binding?.playerCharacter) return false;
    if (run.command) return this.commandExecutor.current(scene, run, target, { ignoreInteractionPause, scriptKey, excludeDialogueSessions });
    if (run.manual && objectKey(run.target) !== objectKey(target)) return false;
    if (!run.manual && [...this.manualRuns.values()].some((manual) => manual.sceneId === scene.id && objectKey(manual.target) === objectKey(target))) return false;
    if (!run.manual && (!binding || binding.groupId !== run.groupId || run.disabledObjects.includes(objectKey(target)))) return false;
    const script = scriptKey ? this.scripts.scriptForKey(run, getSceneObject(scene, target), scriptKey) : null;
    if (!ignoreInteractionPause && this.commandExecutor?.blocksScript(scene, target, script, runId)) return false;
    if (!ignoreInteractionPause && this.scriptInteractionPaused(scene, run, target, scriptKey, excludeDialogueSessions)) return false;
    return true;
  }
  scriptInteractionPaused(scene, run, target, scriptKey, extraReferences = []) {
    return isInteractionPaused(scene, target, Date.now(), { excludeDialogueSessions: [...(run?.scriptStates?.[scriptKey]?.dialogueSessions ?? []), ...extraReferences] });
  }
  scriptInteractionState(scene, run) {
    // Dialogue sessions stay with their group so the existing player service,
    // listeners and visibility checks use one authoritative conversation store.
    return run?.command ? getRuntimeForRun(scene, run.parentRunId) : run;
  }
  scriptInterruptionSource(scene, target, script, runId) {
    const source = this.commandExecutor?.interruptionSource(scene, target, script, runId);
    if (source && !(source === "command" && script?.interruptions?.command === "ignore")) return source;
    return isInteractionPaused(scene, target, Date.now(), { playerOnly: true, includeCompleted: true }) ? "interaction" : null;
  }
  /** The active object clock has already observed the interruption. An initial
   * script can own that clock while the session marker lives in its group. */
  async acknowledgeExternalInteraction(scene, runId, target) {
    const key = objectKey(target), definitions = scene.getFlag(MODULE_ID, "groupDefinitions") ?? {};
    for (const [groupId, stored] of Object.entries(scene.getFlag(MODULE_ID, "groupRuntimes") ?? {})) {
      if (stored?.runId === runId || stored?.schemaVersion !== 1 || definitions[groupId]?.schemaVersion !== 1
        || !stored.interactionClocks?.[key]?.external) continue;
      const run = getRuntime(scene, { groupId });
      run.interactionClocks[key].external = false;
      await saveRuntime(scene, run);
    }
  }
  /** Capture every native update before entering the Scene queue. Keeping the
   * actual turns prevents a 100 ms tick or interaction pause from cutting corners. */
  async recordFollowTarget(document) {
    const scene = document?.parent;
    if (!scene || !this.owns(scene) || scene.id !== globalThis.canvas?.scene?.id) return;
    const bounds = scriptObjectBounds(document, scene);
    if (!bounds) return;
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const targetUuid = document.uuid ?? `${scene.uuid ?? `Scene.${scene.id}`}.${document.documentName}.${document.id}`;
    return withSceneLock(scene, async () => {
      await this.commandExecutor?.recordFollowTarget(scene, targetUuid, point);
      for (const run of [...getRuntimes(scene), ...this.manualRuns.values()]) {
        if (!this.owns(scene, run.runId)) continue;
        const state = this.scriptState(scene, run.runId); let changed = false;
        for (const progress of Object.values(state.scriptStates ?? {})) {
          const follow = progress.action?.follow;
          if (!follow || follow.targetUuid !== targetUuid || ["failed", "done", "uncertain"].includes(progress.status)) continue;
          try { changed = appendFollowWaypoint(follow, point) || changed; }
          catch (error) { progress.status = "failed"; state.error = error.message; changed = true; this.report(error); }
        }
        if (changed) await this.saveScriptState(scene, state);
      }
    });
  }
  refreshObject(object, runtimes) {
    if (!object) return;
    const scene = object.parent ?? globalThis.canvas?.scene;
    const target = { type: object.documentName ?? (scene?.tokens?.get(object.id) === object ? "Token" : "Tile"), id: object.id };
    const runs = [...(runtimes ?? getRuntimes(scene)).filter((run) => !isExecutionHalted(scene, run) && !run.disabledObjects.includes(objectKey(target))),
      ...[...this.manualRuns.values(), ...this.manualVisuals.values()].filter((run) => run.sceneId === scene?.id),
      ...(this.commandExecutor?.runs(scene) ?? []).filter(run => this.commandExecutor.owns(scene, run.runId))];
    const prefix = `${objectKey(target)}:`, progress = runs.flatMap((run) => Object.entries(run.scriptStates ?? {}).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value)).filter(Boolean);
    const latest = (field) => progress.reduce((selected, entry) => Number(entry[`${field}At`] ?? 0) > Number(selected?.[`${field}At`] ?? 0) ? entry : selected, null);
    const emotion = latest("emoji");
    this.visuals?.update(object, { emoji: emotion?.emoji ?? "", emojiSize: emotion?.emojiSize ?? DEFAULT_EMOTION_SIZE, bubble: latest("bubble")?.bubble ?? null });
  }
  refresh(scene) {
    if (scene?.id !== globalThis.canvas?.scene?.id) return;
    const presented = new Map(), runtimes = getRuntimes(scene);
    for (const run of runtimes) {
      const key = `${scene.id}:${run.groupId}`, halted = isExecutionHalted(scene, run), signature = `${run.runId}:${halted}`;
      if (halted && run.runId && this.presentedRuns.get(key) !== signature) this.stopPresentation(scene, [run]);
      presented.set(key, signature);
    }
    this.presentedRuns = presented;
    for (const collection of Object.values(SCENE_OBJECT_COLLECTIONS)) for (const object of asArray(scene[collection])) {
      try { this.refreshObject(object, runtimes); }
      catch (error) { this.report(error, { category: "interface", event: "object.refresh.failed", context: { sceneId: scene.id, objectId: object.id } }); }
    }
    this.onChange(scene);
  }
  /** Presentation cleanup never waits for storage or for a previous render. */
  stopPresentation(scene, runs) {
    for (const run of runs) for (const { target } of run.manual || run.command ? [{ target: run.target }] : run.state?.objects ?? []) {
      try { stopObjectAnimation(getSceneObject(scene, target)); }
      catch (error) { this.report(error); }
    }
    try { this.effects.stop?.(scene, { runIds: runs.map(run => run.runId).filter(Boolean) }); }
    catch (error) { this.report(error); }
  }
  isObjectMacroAttached(scene, target, macroUuid) { return getSignalCatalog(scene).macros.some((macro) => macro.ownerKey === objectKey(target) && macro.uuid === macroUuid); }
  emitObjectSignal(scene, target, signalId, parameters, context) { return this.emitSignal(scene, { emitterKey: objectKey(target), signalId, parameters, context }); }
  groupParameters(scene, group, state) {
    return { sceneUuid: uuid(scene), groupUuid: `${uuid(scene)}.dmicher.Group.${group.groupId}`, groupName: group.groupName,
      stateUuid: `${uuid(scene)}.dmicher.Group.${group.groupId}.State.${state.id}`, stateName: state.name };
  }
  async validateChange(scene, group, prepared, previous, starting, signalContext) {
    const parameters = this.groupParameters(scene, group, prepared);
    if (!starting) {
      const source = getState(group, previous.stateId) ?? getState(group, group.entryStateId);
      parameters.previousStateUuid = `${uuid(scene)}.dmicher.Group.${group.groupId}.State.${source.id}`;
      parameters.previousStateName = source.name;
    }
    const result = await this.emitSignal(scene, { emitterKey: `Group:${group.groupId}`, name: starting ? "validateStart" : "validateTransition",
      parameters, context: { ...signalContext, runId: previous.runId, groupId: group.groupId, validation: true } });
    if (result.allowed === false) {
      const reasons = result.messages?.map((message) => typeof message === "string" ? message : `${message.name || message.ownerKey || localizedMessage("Подписчик")}: ${message.message ?? ""}`).join("; ") || localizedMessage("Подписчик запретил действие.");
      const error = new Error(reasons); this.report(error); throw error;
    }
    return parameters;
  }
  prepareStateChange(scene, stateId, { groupId = "main", force = false, restart = false, expectedRunId, signalContext, preserveStatus = false, resumeInterrupted = false } = {}) {
    const previous = getRuntime(scene, { groupId }), group = getDefinition(scene, { groupId });
    stateId ??= previous.stateId ?? group.entryStateId;
    const prepared = getState(group, stateId); if (!prepared) throw new Error(localizedMessage("Состояние не найдено."));
    if (expectedRunId && previous.runId !== expectedRunId) return null;
    if (!force && !restart && !previous.halted && !isSceneAutomationHalted(scene) && previous.stateId === stateId) return { unchanged: previous };
    const starting = !preserveStatus && (restart || !previous.runId || previous.halted);
    // Start/Resume can continue a manually stopped snapshot. Selecting a state
    // explicitly is a clean entry and never inherits an old continuation.
    const resuming = Boolean(resumeInterrupted && previous.halted && previous.manualInterruption && previous.runId
      && previous.state && previous.stateId === stateId);
    const generation = executionGeneration(scene, groupId), sceneGeneration = sceneExecutionGeneration(scene);
    const active = preserveStatus ? Boolean(previous.runId && !previous.halted) : true;
    return { groupId, stateId, group, prepared, previous, starting, generation, sceneGeneration, active, preserveStatus, signalContext, resuming,
      resumeInitials: Boolean(resumeInterrupted && (previous.stateId ?? group.entryStateId) === stateId) };
  }
  resumeScriptStates(previous) {
    const result = {};
    for (const [slot, scripts] of [["transition", previous.state.transitions], ["routine", previous.state.scripts]]) {
      for (const script of scripts) {
        const key = scriptProgressKey(script.target, script, slot), progress = previous.scriptStates[key];
        // Not-yet-started scripts have no interrupted action to recover. Their
        // normal predecessor still determines whether they may start later.
        if (progress) result[key] = this.scripts.resumeManualProgress(script, progress);
      }
    }
    return result;
  }
  assertStateChangeCurrent(scene, plan) {
    const { groupId, previous, group, generation, sceneGeneration } = plan, current = getRuntime(scene, { groupId });
    if (current.runId !== previous.runId || current.stateId !== previous.stateId || current.halted !== previous.halted || getDefinition(scene, { groupId }).revision !== group.revision || executionGeneration(scene, groupId) !== generation || sceneExecutionGeneration(scene) !== sceneGeneration) throw new Error(localizedMessage("Группа изменилась во время проверки. Повторите команду."));
  }
  async commitStateChange(scene, plan, admitted = () => {}) {
    const { groupId, stateId, group, prepared, previous, generation, sceneGeneration, active, preserveStatus, resuming } = plan;
    return withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      admitted(); this.assertStateChangeCurrent(scene, plan);
      const snapshot = resuming ? clone(previous.state) : materializeState(scene, group, prepared);
      const next = { ...emptyRuntime(groupId), groupId, stateId, state: snapshot, runId: active ? randomId() : previous.runId,
        halted: preserveStatus ? previous.halted : false, haltedAt: preserveStatus ? previous.haltedAt : 0,
        enteredAt: resuming ? previous.enteredAt : this.now(), definitionRevision: resuming ? previous.definitionRevision : group.revision,
        disabledObjects: clone(previous.disabledObjects),
        shops: clone(previous.shops), tradeRequests: clone(previous.tradeRequests), dialogueCommands: clone(previous.dialogueCommands),
        shopSessions: Object.fromEntries(Object.entries(previous.shopSessions).filter(([, session]) => session?.status === "pending")),
        conditionCounts: clone(previous.conditionCounts), conditionEnabledOverrides: clone(previous.conditionEnabledOverrides),
        ...(resuming ? { effects: clone(previous.effects), scriptStates: this.resumeScriptStates(previous) } : {}) };
      if (active && !resuming) resetStateConditions(next);
      await saveRuntime(scene, next);
      if (plan.resumeInitials) this.resumeInitialContinuations(scene, previous.initialContinuations ?? []);
      debugTrace("runtime", "state.enter", () => ({ sceneId: scene.id, sceneName: scene.name, groupId, groupName: group.groupName,
        stateId, stateName: prepared.name, previousStateId: previous.stateId, runId: next.runId, active, resuming }));
      for (const transition of snapshot.transitions) if (transition.enabled !== false && transition.repeat && transition.steps.length) {
        debugTrace("runtime", "routine.blockedByRepeatingTransition", () => ({ sceneId: scene.id, groupId, groupName: group.groupName,
          stateId, stateName: prepared.name, object: transition.target, scriptName: transition.name,
          reason: text("Переход повторяется: рутина начнётся только после завершения переходного скрипта. Проверьте «Повторять».",
            "The transition repeats: the routine can start only after its transition script finishes. Check Repeat.") }));
      }
      for (const restoration of this.restorations.values()) if (restoration.runIds.has(plan.signalContext?.originRunId) && restoration.states.has(groupId)) restoration.states.set(groupId, this.restorationState(scene, groupId));
      if (!preserveStatus) { await scene.setFlag(MODULE_ID, "automationHalted", false); finishSceneHalt(scene, sceneGeneration); }
      finishHalt(scene, generation, groupId); notifyExecutionChange(scene);
      this.tickTimes.set(`${scene.id}:${groupId}`, this.now()); return next;
    });
  }
  async completeStateChange(scene, plan, run, admitted = () => {}) {
    const { active, groupId, starting, signalContext, parameters, resuming } = plan;
    admitted();
    if (active && !resuming) {
      await this.once(scene, run.runId, "workspace", () => this.onWorkspace(scene, clone(run.state.workspace), { runId: run.runId, groupId }));
      admitted();
      if (run.state.pause) await this.once(scene, run.runId, "pause", () => game.togglePause(true, { broadcast: true }));
      admitted();
      if (run.state.sound) await this.once(scene, run.runId, "sound", () => this.effects.sound(run.state.sound, 1, { scene, runId: run.runId, isCurrent: () => this.owns(scene, run.runId) }));
      admitted();
      for (const spawn of run.state.spawns) {
        await this.once(scene, run.runId, `spawn:${spawn.id}`, () => this.effects.spawn(scene, spawn, run.runId, () => this.owns(scene, run.runId)));
        admitted();
      }
    }
    this.refresh(scene);
    await this.emitSignal(scene, { emitterKey: `Group:${groupId}`, name: starting ? "started" : "transitioned", parameters,
      context: { ...signalContext, runId: run.runId, groupId, manual: !active } });
    return getRuntime(scene, { groupId });
  }
  async enter(scene, stateId, options = {}) {
    this.requireAuthority(scene);
    this.cancelRestorations(scene, { groupIds: [options.groupId ?? "main"] });
    const admitted = () => {
      if (options.isCurrent && !options.isCurrent()) {
        const error = new Error(text("Команда запуска заменена или остановлена.", "The start command was replaced or stopped."));
        error.code = "execution-cancelled"; throw error;
      }
    };
    admitted();
    const plan = this.prepareStateChange(scene, stateId, options);
    if (!plan || plan.unchanged) return plan?.unchanged ?? null;
    if (options.isCurrent) {
      const previous = plan.signalContext?.current;
      plan.signalContext = { ...plan.signalContext, current: () => options.isCurrent() && (!previous || previous()) };
    }
    plan.parameters = await this.validateChange(scene, plan.group, plan.prepared, plan.previous, plan.starting, plan.signalContext);
    const run = await this.commitStateChange(scene, plan, admitted);
    return this.completeStateChange(scene, plan, run, admitted);
  }
  /** Both manual selection and scripts preserve each group's automation status.
   * Resolve and validate the entire selection before writes; later intervention
   * stops the remainder but cannot undo transitions which have already completed. */
  async changeStates(scene, transitions, { originRunId, admitted = () => {}, signalContext } = {}) {
    this.requireAuthority(scene);
    const pairs = normalizeStateTransitions(transitions);
    this.cancelRestorations(scene, { groupIds: pairs.map(pair => pair.groupId), exceptRunId: originRunId });
    const requireOrigin = admitted, applied = [];
    const requireApplied = () => {
      for (const { run, generation, sceneGeneration } of applied) {
        const current = getRuntime(scene, { groupId: run.groupId });
        if (current.runId !== run.runId || current.stateId !== run.stateId || current.halted !== run.halted
          || executionGeneration(scene, run.groupId) !== generation || sceneExecutionGeneration(scene) !== sceneGeneration) {
          throw new Error(localizedMessage("Группа изменилась во время проверки. Повторите команду."));
        }
      }
    };
    admitted = () => {
      if (originRunId && !this.owns(scene, originRunId)) throw new Error(text("Скрипт относится к прежнему запуску автоматизации.", "The script belongs to a previous automation run."));
      requireOrigin(); requireApplied();
    };
    this.requireAuthority(scene); admitted();
    const originGroupId = originRunId ? this.scriptState(scene, originRunId)?.groupId : null;
    const plans = pairs.map(({ groupId, stateId }) => this.prepareStateChange(scene, stateId, { groupId, force: true, preserveStatus: true, signalContext }))
      .filter((plan) => plan.previous.stateId !== plan.stateId)
      .sort((a, b) => Number(a.groupId === originGroupId) - Number(b.groupId === originGroupId));
    for (const plan of plans) {
      admitted();
      plan.parameters = await this.validateChange(scene, plan.group, plan.prepared, plan.previous, false, signalContext);
      admitted();
    }
    await withSceneLock(scene, async () => {
      this.requireAuthority(scene); admitted();
      for (const plan of plans) this.assertStateChangeCurrent(scene, plan);
    });
    const result = [];
    for (const plan of plans) {
      admitted();
      const run = await this.commitStateChange(scene, plan, admitted);
      applied.push({ run, generation: plan.generation, sceneGeneration: plan.sceneGeneration });
      // The final own-group transition deliberately retires the originating run.
      // New-state effects belong to the new run; old script steps cannot resume.
      const guard = plan.groupId === originGroupId ? requireApplied : admitted;
      if (plan.groupId === originGroupId && this.manualRuns.delete(originRunId)) {
        this.tickTimes.delete(`${scene.id}:${originRunId}`); notifyExecutionChange(scene);
      }
      result.push(await this.completeStateChange(scene, plan, run, guard));
    }
    return result;
  }
  async halt(scene, { groupId = "main", all = false } = {}) {
    this.requireAuthority(scene);
    const ids = all ? getDefinitions(scene).map((entry) => entry.groupId) : [getDefinition(scene, { groupId }).groupId];
    const sceneGeneration = all ? requestSceneHalt(scene) : null;
    const generations = new Map(ids.map((id) => [id, requestHalt(scene, id)]));
    const initialContinuations = this.captureInitialContinuations(scene, all ? undefined : ids);
    this.cancelRestorations(scene, { groupIds: all ? undefined : ids });
    this.stopPresentation(scene, [...getRuntimes(scene).filter(run => ids.includes(run.groupId)), ...[...this.manualRuns.values()].filter(run => all || ids.includes(run.groupId))]);
    for (const [id, run] of this.manualRuns) if (all || ids.includes(run.groupId)) this.manualRuns.delete(id);
    for (const [id, run] of this.manualVisuals) if (all || ids.includes(run.groupId)) this.manualVisuals.delete(id);
    notifyExecutionChange(scene, "halt");
    // The local barrier is already effective; show it before the queued write.
    this.refresh(scene);
    return withSceneLock(scene, async () => {
      await this.commandExecutor?.captureHalt?.(scene, { groupIds: all ? undefined : ids });
      const result = [];
      if (all) { await writeSceneFlags(scene, { automationHalted: true, automationHaltId: randomId() }); finishSceneHalt(scene, sceneGeneration); }
      if (all && initialContinuations.some(entry => !entry.groupId)) {
        await scene.setFlag(MODULE_ID, "initialContinuations", this.mergeInitialContinuations(scene.getFlag(MODULE_ID, "initialContinuations") ?? [], initialContinuations.filter(entry => !entry.groupId)));
      }
      for (const id of ids) { const run = getRuntime(scene, { groupId: id });
        if (!run.halted && run.runId && run.state) run.manualInterruption = true;
        if (initialContinuations.some(entry => entry.groupId === id)) run.initialContinuations = this.mergeInitialContinuations(run.initialContinuations ?? [], initialContinuations.filter(entry => entry.groupId === id));
        run.halted = true; run.haltedAt = this.now();
        await saveRuntime(scene, run); finishHalt(scene, generations.get(id), id); this.tickTimes.delete(`${scene.id}:${id}`); result.push(run); }
      debugTrace("runtime", "automation.halted", () => ({ sceneId: scene.id, sceneName: scene.name, all, groupIds: ids }));
      this.refresh(scene); return all ? result : result[0];
    });
  }
  haltAll(scene) { return this.halt(scene, { all: true }); }
  async startAll(scene) {
    this.requireAuthority(scene); this.cancelRestorations(scene); this.groupStartCommands.delete(scene);
    const command = {}; this.startCommands.set(scene, command); notifyExecutionChange(scene, "start-command");
    const result = [], generation = sceneExecutionGeneration(scene);
    const groups = getDefinitions(scene), generations = new Map(groups.map(group => [group.groupId, executionGeneration(scene, group.groupId)]));
    const isCurrent = () => this.startCommands.get(scene) === command && sceneExecutionGeneration(scene) === generation
      && groups.every(group => executionGeneration(scene, group.groupId) === generations.get(group.groupId));
    // Wait only for preceding document transactions, never for their old effects.
    // A Start pressed immediately after Stop must read the newly persisted state.
    await withSceneLock(scene, () => {});
    for (const group of groups) {
      // A stop during an awaited validation/effect cancels the rest of this command.
      if (!isCurrent()) break;
      try { result.push(await this.enter(scene, getRuntime(scene, { groupId: group.groupId }).stateId ?? group.entryStateId, { groupId: group.groupId, force: true, restart: true, resumeInterrupted: true, isCurrent })); }
      catch (error) { if (!isCurrent() || error.code === "execution-cancelled") break; this.report(error); result.push({ groupId: group.groupId, error: error.message }); }
    }
    if (isCurrent()) await this.resumeUngroupedInitialContinuations(scene, isCurrent);
    return result;
  }
  /** Start/resume only the addressed group; a pending command for another group owns
   * its own admission token and is not superseded by this one. */
  async startGroup(scene, groupId, stateId) {
    this.requireAuthority(scene);
    const group = getDefinition(scene, { groupId });
    this.cancelRestorations(scene, { groupIds: [group.groupId] });
    this.startCommands.delete(scene);
    let commands = this.groupStartCommands.get(scene);
    if (!commands) this.groupStartCommands.set(scene, commands = new Map());
    const command = {}; commands.set(group.groupId, command);
    const generation = executionGeneration(scene, group.groupId), sceneGeneration = sceneExecutionGeneration(scene);
    const isCurrent = () => this.groupStartCommands.get(scene)?.get(group.groupId) === command
      && executionGeneration(scene, group.groupId) === generation && sceneExecutionGeneration(scene) === sceneGeneration;
    notifyExecutionChange(scene, "start-command");
    await withSceneLock(scene, () => {});
    if (!isCurrent()) return null;
    try {
      return await this.enter(scene, stateId ?? getRuntime(scene, { groupId }).stateId ?? group.entryStateId,
        { groupId, force: true, restart: true, resumeInterrupted: true, isCurrent });
    } catch (error) { if (!isCurrent() || error.code === "execution-cancelled") return null; throw error; }
  }
  async restoreInitial(scene, target) {
    this.requireAuthority(scene);
    const binding = getObjectBindings(scene).bindings[objectKey(target)];
    if (!binding?.initialScript?.enabled) throw new Error(localizedMessage("Исходное состояние объекта не настроено."));
    this.cancelRestorations(scene, { groupIds: [binding.groupId] });
    this.cancelObjectInitialRuns(scene, target);
    await this.clearInitialContinuation(scene, target, binding.groupId);
    return this.queueInitialRestoration(scene, target, binding);
  }
  /** Initial restoration uses the same executor and cancellation as other
   * scripts. Only a clean continuation plan survives Stop, never an old job. */
  captureInitialContinuations(scene, groupIds) {
    const entries = [];
    for (const run of this.manualRuns.values()) {
      if (run.sceneId !== scene.id || groupIds && !groupIds.includes(run.groupId)) continue;
      try {
        const key = scriptProgressKey(run.target, run.script, "initial");
        entries.push({ groupId: run.groupId ?? null, target: clone(run.target), script: clone(run.script),
          progress: this.scripts.resumeManualProgress(run.script, run.scriptStates[key]) });
      } catch (error) {
        // Preparing recovery can never veto an emergency stop.
        debugError("script", "initial.continuation.failed", error, { sceneId: scene.id, runId: run.runId, target: run.target });
      }
    }
    return entries;
  }
  mergeInitialContinuations(previous, incoming) {
    const replaced = new Set(incoming.map(entry => objectKey(entry.target)));
    return [...previous.filter(entry => !replaced.has(objectKey(entry.target))), ...incoming.filter(entry => entry.progress.status === "ready")];
  }
  resumeInitialContinuations(scene, entries) {
    if (!entries.length) return;
    const bindings = getObjectBindings(scene).bindings;
    for (const entry of entries) {
      const binding = bindings[objectKey(entry.target)];
      if (!binding || binding.playerCharacter || binding.groupId !== entry.groupId || !getSceneObject(scene, entry.target)
        || entry.progress.status !== "ready") continue;
      this.queueInitialRestoration(scene, entry.target, { ...binding, initialScript: entry.script }, null, entry.progress);
    }
  }
  async resumeUngroupedInitialContinuations(scene, isCurrent) {
    return withSceneLock(scene, async () => {
      if (!isCurrent()) return;
      const entries = scene.getFlag(MODULE_ID, "initialContinuations") ?? [];
      if (!entries.length) return;
      // Queue before the awaited flag write: a newer Stop can capture these new
      // executions immediately and persist its own plans after this transaction.
      this.resumeInitialContinuations(scene, entries);
      await scene.setFlag(MODULE_ID, "initialContinuations", []);
      if (isCurrent() && !getDefinitions(scene).length) {
        await scene.setFlag(MODULE_ID, "automationHalted", false);
        finishSceneHalt(scene, sceneExecutionGeneration(scene)); notifyExecutionChange(scene, "initial-resumed");
      }
    });
  }
  async clearInitialContinuation(scene, target, groupId) {
    return withSceneLock(scene, async () => {
      const key = objectKey(target);
      if (groupId) {
        const run = getRuntime(scene, { groupId });
        if (!run.initialContinuations?.some(entry => objectKey(entry.target) === key)) return;
        run.initialContinuations = run.initialContinuations.filter(entry => objectKey(entry.target) !== key); await saveRuntime(scene, run);
      } else {
        const entries = scene.getFlag(MODULE_ID, "initialContinuations") ?? [];
        if (entries.some(entry => objectKey(entry.target) === key)) await scene.setFlag(MODULE_ID, "initialContinuations", entries.filter(entry => objectKey(entry.target) !== key));
      }
    });
  }
  cancelObjectInitialRuns(scene, target) {
    const runs = [...this.manualRuns.values()].filter(run => run.sceneId === scene.id && objectKey(run.target) === objectKey(target));
    if (!runs.length) return;
    this.stopPresentation(scene, runs);
    for (const run of runs) { this.manualRuns.delete(run.runId); this.tickTimes.delete(`${scene.id}:${run.runId}`); }
    notifyExecutionChange(scene, "initial-restoration-replaced");
  }
  queueInitialRestoration(scene, target, binding, restoration = null, progress) {
    this.cancelObjectInitialRuns(scene, target);
    const run = { ...emptyRuntime(binding.groupId), manual: true, sceneId: scene.id, runId: randomId(), target: clone(target), script: clone(binding.initialScript), restorationId: restoration?.id };
    if (progress) run.scriptStates[scriptProgressKey(target, run.script, "initial")] = clone(progress);
    restoration?.runIds.add(run.runId);
    this.manualRuns.set(run.runId, run); this.tickTimes.set(`${scene.id}:${run.runId}`, this.now()); notifyExecutionChange(scene, "initial-restoration"); return run.runId;
  }
  restorationState(scene, groupId) {
    const run = getRuntime(scene, { groupId });
    return JSON.stringify([run.runId, run.stateId, run.halted, executionGeneration(scene, groupId)]);
  }
  restorationCurrent(scene, restoration) {
    if (!restoration || this.restorations.get(restoration.id) !== restoration || restoration.sceneId !== scene?.id) return false;
    const groups = getDefinitions(scene);
    return Boolean((!restoration.all || isSceneAutomationHalted(scene)) && sceneExecutionGeneration(scene) === restoration.generation
      && (!restoration.all || groups.length === restoration.groups.length) && restoration.groups.every(group => groups.find(current => current.groupId === group.groupId)?.revision === group.revision
        && this.restorationState(scene, group.groupId) === restoration.states.get(group.groupId)));
  }
  isRestoringInitial(scene, groupId) {
    return [...this.restorations.values()].some(restoration => restoration.sceneId === scene?.id
      && (groupId === undefined || restoration.groups.some(group => group.groupId === groupId)));
  }
  cancelRestorations(scene, { groupIds, exceptRunId } = {}) {
    for (const restoration of this.restorations.values()) {
      if (restoration.runIds.has(exceptRunId)) continue;
      if (!groupIds || restoration.all || restoration.groups.some(group => groupIds.includes(group.groupId))) this.cancelRestoration(scene, restoration);
    }
  }
  cancelRestoration(scene, restoration) {
    if (!restoration || this.restorations.get(restoration.id) !== restoration || restoration.sceneId !== scene?.id) return;
    this.restorations.delete(restoration.id);
    this.stopPresentation(scene, [...restoration.runIds].map(id => this.manualRuns.get(id)).filter(Boolean));
    for (const runId of restoration.runIds) { this.manualRuns.delete(runId); this.tickTimes.delete(`${scene.id}:${runId}`); }
    notifyExecutionChange(scene, "initial-restoration-cancelled");
    this.refresh(scene);
  }
  /** Reset is a manual command, not a group entry: no entry effects, starts or
   * resource rollback. Initial scripts retain their normal timing and cancellation.
   * Select entry states again on completion because an initial script may change states. */
  restoreAllInitial(scene) { return this.restoreGroupsInitial(scene, { all: true }); }
  restoreGroupInitial(scene, groupId) { return this.restoreGroupsInitial(scene, { groupId }); }
  async restoreGroupsInitial(scene, { all = false, groupId } = {}) {
    this.requireAuthority(scene);
    const groups = all ? getDefinitions(scene) : [getDefinition(scene, { groupId })];
    const halt = this.halt(scene, { all, groupId }), generation = sceneExecutionGeneration(scene);
    const generations = new Map(groups.map(group => [group.groupId, executionGeneration(scene, group.groupId)]));
    await halt;
    // Preparing entry states and queueing initial scripts is one transaction.
    // A clock tick must never see a half-saved signature or an empty batch that
    // merely has not queued its scripts yet. Emergency cancellation stays local.
    return withSceneLock(scene, async () => {
      if (sceneExecutionGeneration(scene) !== generation || all && !isSceneAutomationHalted(scene)
        || groups.some(group => executionGeneration(scene, group.groupId) !== generations.get(group.groupId) || !getRuntime(scene, { groupId: group.groupId }).halted)) return [];
      const restoration = { id: randomId(), sceneId: scene.id, generation, all, groups, runIds: new Set(), states: new Map(groups.map(group => [group.groupId, this.restorationState(scene, group.groupId)])) };
      this.restorations.set(restoration.id, restoration);
      try {
        if (!await this.selectInitialStates(scene, restoration)) return [];
        for (const binding of Object.values(getObjectBindings(scene).bindings)) {
          if ((!all || binding.groupId) && !groups.some(group => group.groupId === binding.groupId) || binding.playerCharacter || !binding.initialScript?.enabled || !getSceneObject(scene, binding)) continue;
          this.queueInitialRestoration(scene, { type: binding.type, id: binding.id }, binding, restoration);
        }
        if (!restoration.runIds.size) this.restorations.delete(restoration.id);
        this.refresh(scene); return [...restoration.runIds];
      } catch (error) { this.cancelRestoration(scene, restoration); throw error; }
    });
  }
  /** Caller holds the scene queue through both the native write and its signature. */
  async selectInitialStates(scene, restoration) {
    this.requireAuthority(scene);
    if (!this.restorationCurrent(scene, restoration)) { this.cancelRestoration(scene, restoration); return false; }
    if (restoration.all && scene.getFlag(MODULE_ID, "initialContinuations")?.length) await scene.setFlag(MODULE_ID, "initialContinuations", []);
    for (const group of restoration.groups) {
      if (!this.restorationCurrent(scene, restoration)) { this.cancelRestoration(scene, restoration); return false; }
      const run = getRuntime(scene, { groupId: group.groupId });
      Object.assign(run, { stateId: group.entryStateId, state: materializeState(scene, group, getState(group, group.entryStateId)), runId: "", halted: true,
        haltedAt: this.now(), enteredAt: 0, definitionRevision: group.revision, effects: {}, scriptStates: {}, interactionClocks: {}, error: "", manualInterruption: false, initialContinuations: [] });
      await saveRuntime(scene, run);
      restoration.states.set(group.groupId, this.restorationState(scene, group.groupId));
    }
    return this.restorationCurrent(scene, restoration);
  }
  async finishRestoration(scene, restoration) {
    return withSceneLock(scene, async () => {
      if (!restoration || restoration.sceneId !== scene?.id) return;
      if (!this.restorationCurrent(scene, restoration)) { this.cancelRestoration(scene, restoration); return; }
      if ([...restoration.runIds].some(runId => this.manualRuns.has(runId))) return;
      try { await this.selectInitialStates(scene, restoration); }
      finally { this.restorations.delete(restoration.id); this.refresh(scene); }
    });
  }
  async once(scene, runId, key, operation) {
    const claimed = await withSceneLock(scene, async () => {
      if (!this.owns(scene, runId)) return false;
      const run = getRuntimeForRun(scene, runId); if (run.effects[key]) return false;
      run.effects[key] = { status: "pending", at: this.now() }; await saveRuntime(scene, run); return true;
    });
    if (!claimed || !this.owns(scene, runId)) return;
    const scope = createExecutionScope(scene, { isCurrent: () => this.owns(scene, runId) });
    let error;
    try { if ((await scope.run(operation)).stale) return; }
    catch (cause) { if (!scope.current()) return; error = cause; this.report(cause); }
    finally { scope.dispose(); }
    await withSceneLock(scene, async () => {
      if (!this.owns(scene, runId)) return;
      const run = getRuntimeForRun(scene, runId); run.effects[key] = { status: error ? "failed" : "done", at: this.now() };
      if (error) run.error = error.message; await saveRuntime(scene, run);
    });
  }
  async setAutomation(scene, tokenId, enabled, { groupId = "main" } = {}) {
    return this.setObjectAutomation(scene, { type: "Token", id: tokenId }, enabled, { groupId });
  }
  async setObjectAutomation(scene, target, enabled, { groupId } = {}) {
    this.requireAuthority(scene); this.cancelRestorations(scene, { groupIds: [groupId ?? getObjectBindings(scene).bindings[objectKey(target)]?.groupId] }); const key = objectKey(target);
    return withSceneLock(scene, async () => {
      const run = getRuntime(scene, { groupId }); run.disabledObjects = run.disabledObjects.filter((id) => id !== key);
      if (!enabled) run.disabledObjects.push(key); await saveRuntime(scene, run); notifyExecutionChange(scene); this.refresh(scene); return run;
    });
  }
  async resetConditions(scene, { conditionKey, groupId = "main" } = {}) {
    this.requireAuthority(scene); return withSceneLock(scene, async () => {
      const run = getRuntime(scene, { groupId });
      if (conditionKey && !conditionKey.startsWith(`${groupId}:`)) throw new Error(localizedMessage("Счётчик относится к другой группе."));
      if (conditionKey) delete run.conditionCounts[conditionKey]; else run.conditionCounts = {};
      await saveRuntime(scene, run); this.refresh(scene); return run;
    });
  }
  async setConditionEnabled(scene, conditionKey, enabled) {
    this.requireAuthority(scene); return withSceneLock(scene, async () => {
      const groupId = conditionKey.split(":")[0], run = getRuntime(scene, { groupId });
      if (!conditionKey.startsWith(`${groupId}:${run.stateId}:`) || typeof enabled !== "boolean") throw new Error(localizedMessage("Условия относятся к другому состоянию."));
      run.conditionEnabledOverrides[conditionKey] = enabled; await saveRuntime(scene, run); this.refresh(scene); return run;
    });
  }
  /** Advance a single object's clocks under the scene storage lock. Every await
   * re-reads ownership: a manual run can disappear while a document is saving.
   * Returned external jobs execute only after the collection phase releases it. */
  async tickObject(scene, run, target, elapsed, now, clockKey) {
    const jobs = [], key = objectKey(target);
    const read = () => this.currentObject(scene, run.runId, target, { ignoreInteractionPause: true }) ? this.scriptState(scene, run.runId) : null;
    if (!read()) return jobs;
    const object = getSceneObject(scene, target);
    jobs.push(...await this.scripts.tickEffects(scene, run.runId, object, elapsed));
    let current = read(); if (!current) return jobs;
    let slot = run.manual ? "initial" : "transition";
    let script = run.manual ? run.script : run.state.transitions.find(entry => objectKey(entry.target) === key);
    const status = script && current.scriptStates[scriptProgressKey(target, script, slot)]?.status;
    if (!script || script.enabled === false || !script.steps.length || status === "done" || run.manual && ["failed", "uncertain", "stopped"].includes(status)) {
      if (run.manual) {
        jobs.push(...await this.scripts.tickEffects(scene, run.runId, object, 0, { idle: true }));
        current = read(); if (!current || this.scripts.hasPendingEffects(current)) return jobs;
        this.manualVisuals.set(`${scene.id}:${key}`, current); this.manualRuns.delete(run.runId); this.tickTimes.delete(clockKey); this.refreshObject(object);
        this.onChange(scene);
        return jobs;
      }
      script = run.state.scripts.find(entry => objectKey(entry.target) === key); slot = "routine";
    }
    if (!script || current.scriptStates[scriptProgressKey(target, script, slot)]?.status === "done") {
      jobs.push(...await this.scripts.tickEffects(scene, run.runId, object, 0, { idle: true }));
      current = read(); if (!current) return jobs;
    }
    if (!script) return jobs;
    const context = () => ({ sceneId: scene.id, groupId: run.groupId, stateId: run.stateId, runId: run.runId, target, scriptName: script.name, slot });
    const paused = this.scriptInteractionPaused(scene, current, target, scriptProgressKey(target, script, slot));
    if (paused) {
      if (!current.interactionClocks[key]) {
        current.interactionClocks[key] = { at: now }; await this.saveScriptState(scene, current);
        debugTrace("script", "interaction.paused", context);
      }
    }
    let budget = paused ? 0 : elapsed;
    if (!paused) await this.acknowledgeExternalInteraction(scene, current.runId, target);
    if (!paused && current.interactionClocks[key]) {
      current.interactionClocks[key] = null; await this.saveScriptState(scene, current); budget = 0;
      debugTrace("script", "interaction.resumed", context);
    }
    current = read(); if (!current) return jobs;
    try { const job = await this.scripts.tick(scene, current, object, script, budget, { slot }); if (job) jobs.push(job); }
    catch (error) {
      current = read(); if (!current) return jobs;
      await this.scripts.fail(scene, current, object, script, scriptProgressKey(target, script, slot), error);
    }
    return jobs;
  }
  async tick() {
    const scene = globalThis.canvas?.scene; if (this.busy || !this.owns(scene)) return;
    // Expired chat cleanup has its own single-flight lifecycle. A delayed chat
    // deletion must not own the simulation clock or prevent Stop followed by Start.
    if (!this.cleanupTask && this.effects.cleanupSpeech) this.cleanupTask = Promise.resolve()
      .then(() => { if (!this.disposed) return this.effects.cleanupSpeech(); })
      .catch(error => this.report(error, { category: "script", event: "speech.cleanup.failed", context: { sceneId: scene.id } }))
      .finally(() => { this.cleanupTask = null; });
    this.busy = true; const jobs = [];
    try {
      if (this.restorations.size) await withSceneLock(scene, () => {
        for (const restoration of this.restorations.values()) if (!this.restorationCurrent(scene, restoration)) this.cancelRestoration(scene, restoration);
      });
      if (this.commandExecutor) {
        const now = this.now(), clockKey = `${scene.id}:commands`;
        const elapsed = Math.min(1, Math.max(0, (now - (this.tickTimes.get(clockKey) ?? now)) / 1000));
        this.tickTimes.set(clockKey, now);
        // Observe command interruptions before a group's clock acknowledges a
        // short interaction. Returned jobs still execute outside the Scene lock.
        await withSceneLock(scene, async () => { jobs.push(...await this.commandExecutor.tick(scene, elapsed)); });
      }
      for (const run of [...getRuntimes(scene), ...this.manualRuns.values()]) {
        const clockKey = `${scene.id}:${run.manual ? run.runId : run.groupId}`, now = this.now();
        const elapsed = Math.min(1, Math.max(0, (now - (this.tickTimes.get(clockKey) ?? now)) / 1000)); this.tickTimes.set(clockKey, now);
        if ((!run.manual && (!run.state || !run.runId || run.halted)) || game.paused) continue;
        if (run.manual && (!getSceneObject(scene, run.target) || getObjectBindings(scene).bindings[objectKey(run.target)]?.playerCharacter)) {
          this.manualRuns.delete(run.runId); this.tickTimes.delete(clockKey); continue;
        }
        await withSceneLock(scene, async () => {
          if (!this.owns(scene, run.runId)) return;
          const objects = run.manual ? [{ target: run.target }] : run.state.objects;
          for (const { target } of objects) jobs.push(...await this.tickObject(scene, run, target, elapsed, now, clockKey));
        });
      }
    } finally { this.busy = false; }
    await Promise.all(jobs.map((job) => this.scripts.execute(job)));
    for (const restoration of this.restorations.values()) await this.finishRestoration(scene, restoration);
  }
  async onTokenMove(token, previous) {
    const scene = token.parent; if (!this.owns(scene) || game.paused) return;
    if (!asArray(game.users).some((user) => [1, 2].includes(Number(user.role)) && token.actor?.testUserPermission?.(user, "OWNER"))) return;
    for (const snapshot of getRuntimes(scene)) {
      if (!this.owns(scene, snapshot.runId)) continue;
      for (const zone of snapshot.state?.zones ?? []) {
        if (!zone.signalId || !crossesRectangle(previous, objectCenter(token, scene), zone)) continue;
        const admitted = await withSceneLock(scene, async () => {
          const run = getRuntimeForRun(scene, snapshot.runId); if (!run || !this.owns(scene, run.runId)) return false;
          const conditionKey = getConditionKey(run, "zone", zone.id);
          if (!getConditionGate(scene, run, zone.conditions, token, { conditionKey }).allowed) return false;
          consumeCondition(run, conditionKey, zone.conditions); await saveRuntime(scene, run); return true;
        });
        if (admitted) await this.emitSignal(scene, { emitterKey: `Group:${snapshot.groupId}`, signalId: zone.signalId, parameters: zone.parameters,
          context: { runId: snapshot.runId, groupId: snapshot.groupId } });
      }
    }
  }
  async startCombat(scene, { rollInitiative = true } = {}) {
    this.requireAuthority(scene); const Combat = globalThis.CONFIG?.Combat?.documentClass ?? globalThis.foundry?.documents?.Combat;
    if (!Combat?.create) throw new Error(localizedMessage("Боевая система Foundry недоступна."));
    let combat = asArray(game.combats).find((entry) => (entry.scene?.id ?? entry.scene) === scene.id);
    if (!combat) combat = await Combat.create({ scene: scene.id, active: true });
    const selected = asArray(canvas.tokens?.controlled).map((object) => object.document), tokens = (selected.length ? selected : asArray(scene.tokens)).filter((token) => token.actor);
    const present = new Set(asArray(combat.combatants).map((entry) => entry.tokenId));
    const additions = tokens.filter((token) => !present.has(token.id)).map((token) => ({ tokenId: token.id, actorId: token.actor.id, hidden: Boolean(token.hidden) }));
    if (additions.length) await combat.createEmbeddedDocuments("Combatant", additions);
    await combat.activate?.(); if (rollInitiative) await combat.rollAll(); if (!combat.started) await combat.startCombat(); return combat;
  }
}
