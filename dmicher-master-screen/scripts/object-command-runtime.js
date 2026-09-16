import { MODULE_ID } from "./model.js";
import { getRuntime, getRuntimeForRun, getRuntimes, withSceneLock, saveRuntime, isAuthority } from "./store.js";
import { getObjectBindings, getSceneObject, objectKey } from "./scene-objects.js";
import { writeSceneFlags, replacementFlagData } from "./scene-flags.js";
import { createExecutionScope, isExecutionHalted, notifyExecutionChange } from "./execution.js";
import { isInteractionPaused } from "./interaction-pause.js";
import { validateCommandAccess, commandDocument, rejectCommand, CommandRejection, commandLevelsOverlap } from "./object-command-access.js";
import { text } from "./localization.js";
import { validateCommandPoint, commandPoint, clipCommandMovement, commandCenter } from "./object-command-movement.js";
import { commandDoorVisible } from "./object-command-visibility.js";
import { ObjectCommandCore } from "./object-command-core.js";
import { scriptProgressKey } from "./script-runtime.js";
import { scriptHasActivity, clearScriptPresentation } from "./script-interruptions.js";
import { stopObjectAnimation } from "./script-movement.js";
import { appendFollowWaypoint } from "./script-target-movement.js";
import { debugError, commandTrace } from "./debug.js";
import { normalizeObjectCommand, commandStopsBehavior, commandPermitsDisabledBehavior } from "./object-command-model.js";
import { commandParent, commandBehaviorEnabled, setCommandBehavior, isCommandParentHalted } from "./object-command-state.js";

const clone = structuredClone;
const id = () => globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID();
const terminal = progress => !progress || ["done", "stopped", "failed", "uncertain"].includes(progress.status);
const rawRuns = scene => scene?.getFlag?.(MODULE_ID, "objectCommandRuns") ?? {};
const parentOf = commandParent;
const phaseAfter = phase => ({ waiting: "before", before: "core", core: "after", after: "complete" })[phase];

/** One command per object, sharing the group clock and its cancellable script
 * executor. Preparation, transport and rendering are separate consumers. */
export class ObjectCommandRuntime {
  constructor({ runtime, signals, lights, core = new ObjectCommandCore({ lights }) }) {
    Object.assign(this, { runtime, signals, core });
    this.cancelled = new Set(); this.cache = new WeakMap(); this.disposed = false; this.delegations = new Map();
  }
  runs(scene) {
    if (!scene) return [];
    const raw = rawRuns(scene), cached = this.cache.get(scene);
    if (cached?.raw === raw) return cached.runs;
    const runs = Object.values(raw).filter(run => run?.schemaVersion === 1 && run.command === true && run.runId);
    this.cache.set(scene, { raw, runs }); return runs;
  }
  has(runId) { return this.runs(globalThis.canvas?.scene).some(run => run.runId === runId); }
  activeForObject(scene, target) { return this.runs(scene).find(run => objectKey(run.target) === objectKey(target)) ?? null; }
  state(scene, runId) { const run = this.runs(scene).find(run => run.runId === runId); return run ? clone(run) : null; }
  owns(scene, runId) {
    if (this.disposed || !isAuthority() || globalThis.canvas?.scene?.id !== scene?.id || this.cancelled.has(runId)) return false;
    const run = this.runs(scene).find(run => run.runId === runId), parent = run && parentOf(scene, run);
    if (!run || run.interruption || !parent || parent.runId !== run.parentRunId || isCommandParentHalted(scene, parent)) return false;
    const binding = scene.getFlag(MODULE_ID, "objectBindings")?.bindings?.[objectKey(run.target)];
    return Boolean(binding && !binding.playerCharacter && binding.groupId === run.groupId && getSceneObject(scene, run.target)
      && (commandPermitsDisabledBehavior(run.config.id) || commandBehaviorEnabled(scene, run.target, parent)));
  }
  current(scene, run, target, { ignoreInteractionPause = false, scriptKey, excludeDialogueSessions = [] } = {}) {
    if (!this.owns(scene, run.runId) || objectKey(run.target) !== objectKey(target)) return false;
    const ownDialogues = Object.values(run.scriptStates ?? {}).flatMap(progress => progress.dialogueSessions ?? []);
    return ignoreInteractionPause || !game.paused && !this.runtime.scriptInteractionPaused(scene, run, target, scriptKey, [...excludeDialogueSessions, ...ownDialogues]);
  }
  interruptionSource(scene, target, _script, runId) {
    const command = this.activeForObject(scene, target);
    return command && command.runId !== runId ? "command" : null;
  }
  blocksScript(scene, target, script, runId) {
    const command = this.activeForObject(scene, target);
    if (!command || command.runId === runId) return false;
    return !(script && command.phase === "waiting" && command.waitingScripts?.some(ref => ref.runId === runId
      && ref.key === scriptProgressKey(target, script, ref.key.split(":")[2])));
  }
  async write(scene, next) {
    await writeSceneFlags(scene, { objectCommandRuns: replacementFlagData(rawRuns(scene), next) });
    this.cache.delete(scene);
  }
  async save(scene, run) {
    if (this.activeForObject(scene, run.target)?.runId !== run.runId) return false;
    await this.write(scene, { ...rawRuns(scene), [objectKey(run.target)]: clone(run) }); return true;
  }
  stopPresentation(scene, run) {
    this.cancelled.add(run.runId);
    stopObjectAnimation(getSceneObject(scene, run.target));
    this.runtime.effects.stop?.(scene, { runIds: [run.runId], target: run.target });
    notifyExecutionChange(scene, "object-command-stopped");
    this.delegations.delete(run.runId);
  }
  signal(scene, run, name, { validation = false } = {}) {
    return this.signals.emit(scene, { id: `${run.runId}:${name}`, emitterKey: objectKey(run.target), name,
      parameters: { playerTokenUuid: run.request.delegateTokenUuid ?? run.request.actorTokenUuid ?? "", objectUuid: run.request.targetUuid,
        commandId: run.config.id, parameters: JSON.stringify({ ...run.config.parameters, ...run.request.parameters }),
        startedAt: run.startedAt ?? 0, patronUuid: run.request.delegateTokenUuid ? run.request.actorTokenUuid : null },
      context: { groupId: run.groupId, runId: run.parentRunId, validation,
        current: validation ? () => !isCommandParentHalted(scene, parentOf(scene, run)) : undefined } });
  }
  publish(scene, run, name) {
    // Do not await subscribers from the scene queue: a subscriber may request
    // that same queue. Its outcome cannot undo a completed command.
    void Promise.resolve().then(() => this.signal(scene, run, name))
      .catch(error => debugError("command", "signal.failed", error, { sceneId: scene.id, runId: run.runId, name }));
  }
  async finish(scene, run, { cancelled = false, reason, activatePending = false } = {}) {
    if (this.activeForObject(scene, run.target)?.runId !== run.runId) return;
    this.stopPresentation(scene, run);
    const next = { ...rawRuns(scene) }; delete next[objectKey(run.target)]; await this.write(scene, next);
    this.cancelled.delete(run.runId);
    commandTrace(cancelled ? "object.cancelled" : "object.completed", { sceneId: scene.id, objectId: run.target.id,
      commandId: run.config.id, userId: run.request.userId, reason });
    this.publish(scene, run, cancelled ? "commandCancelled" : "commandCompleted");
    if (run.pendingReplacement && !activatePending) this.publish(scene, run.pendingReplacement, "commandCancelled");
    this.runtime.refreshObject(getSceneObject(scene, run.target)); this.runtime.onChange(scene);
  }
  inputs(scene, packet, access) {
    const raw = packet.parameters ?? {}, { actor, object, config } = access;
    const point = input => {
      if (access.method !== "gm") return validateCommandPoint(scene, actor, object, input);
      const result = commandPoint(scene, input);
      if (clipCommandMovement(scene, object, commandCenter(object, scene), result).blocked)
        rejectCommand("obstacle", text("Прямой путь объекта к этой точке перекрыт.", "The object's straight path to that point is blocked."));
      return result;
    };
    if (config.id === "delegate") {
      const recipient = commandDocument(scene, raw.targetUuid);
      if (!recipient || recipient === object || raw.commandId === "delegate") rejectCommand("delegation", text("Выберите другой объект и команду для поручения.", "Choose another object and a command to delegate."));
      validateCommandAccess(scene, { ...packet, method: "delegated", delegateTokenUuid: packet.targetUuid,
        targetUuid: raw.targetUuid, commandId: raw.commandId, parameters: raw.parameters ?? {} }, access.user,
      { active: this.activeForObject(scene, { type: recipient.documentName, id: recipient.id }), ignoreRange: true });
      return { targetUuid: raw.targetUuid, commandId: raw.commandId, parameters: clone(raw.parameters ?? {}) };
    }
    if (config.id === "go") return { point: point(raw.point) };
    if (config.id === "patrol") {
      if (!Array.isArray(raw.points) || raw.points.length !== 2) rejectCommand("points", text("Выберите две точки патруля.", "Choose two patrol points."));
      const points = raw.points.map(point);
      if (Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) < 1) rejectCommand("points", text("Точки патруля должны различаться.", "Patrol points must be different."));
      return { points };
    }
    if (["open-door", "close-door"].includes(config.id)) {
      const door = commandDocument(scene, raw.doorUuid);
      if (door?.documentName !== "Wall" || !door.door) rejectCommand("door", text("Выберите дверь на карте.", "Choose a door on the map."));
      if (!commandLevelsOverlap(actor, door) || !commandLevelsOverlap(object, door)) rejectCommand("door-level", text("Дверь находится на другом уровне.", "The door is on a different level."));
      if (!access.user.isGM && door.door === 2) rejectCommand("door", text("Выберите доступную дверь на карте.", "Choose an available door on the map."));
      if (access.method !== "gm" && !commandDoorVisible(scene, actor, door)) rejectCommand("visibility", text("Персонаж, отдающий команду, должен видеть выбранную дверь.", "The character issuing the command must be able to see the chosen door."));
      if (config.id === "open-door" && door.ds === (globalThis.CONST?.WALL_DOOR_STATES?.LOCKED ?? 2)) rejectCommand("locked", text("Дверь заперта.", "The door is locked."));
      return { doorUuid: raw.doorUuid };
    }
    return {};
  }
  async accept(scene, packet, user, { trusted = false, isCurrent = () => true } = {}) {
    this.runtime.requireAuthority(scene);
    const assertCurrent = () => { if (!isCurrent()) rejectCommand("expired", text("Действие уже отменено.", "This action has already been cancelled.")); };
    assertCurrent();
    const object = commandDocument(scene, packet.targetUuid), target = object && { type: object.documentName, id: object.id };
    const check = active => { const access = validateCommandAccess(scene, packet, user, { active, trusted });
      if (trusted && packet.configurationParameters) access.config = normalizeObjectCommand({ ...access.config, parameters: { ...access.config.parameters, ...packet.configurationParameters } });
      return access; };
    const access = check(this.activeForObject(scene, target));
    const parameters = this.inputs(scene, packet, access);
    const proposal = { runId: id(), parentRunId: access.runtime.runId, groupId: access.runtime.groupId,
      target: access.target, config: access.config, request: { ...packet, parameters, userId: user.id } };
    const permission = await this.signal(scene, proposal, "commandRequested", { validation: true });
    assertCurrent();
    if (permission?.allowed === false) rejectCommand("veto", text("Команда отклонена условиями сцены.", "The scene's conditions rejected this command."));
    // Authorized replacement releases a pending native operation before waiting
    // for the scene queue. A later result cannot advance the replaced command.
    const old = this.activeForObject(scene, target);
    check(old);
    const stoppedOld = old && !this.waitsForScript(old, packet.commandId);
    if (stoppedOld) this.stopPresentation(scene, old);
    try {
      return await withSceneLock(scene, async () => {
        assertCurrent();
        const current = this.activeForObject(scene, target);
        const fresh = check(current);
        if (JSON.stringify(fresh.config) !== JSON.stringify(proposal.config) || fresh.runtime.runId !== proposal.parentRunId) {
          rejectCommand("changed", text("Условия команды изменились. Выберите команду заново.", "The command's conditions changed. Select the command again."));
        }
        this.inputs(scene, packet, fresh);
        const run = { ...proposal, schemaVersion: 1, command: true, parentRunId: fresh.runtime.runId,
          groupId: fresh.runtime.groupId, stateId: fresh.runtime.stateId, state: clone(fresh.runtime.state), config: fresh.config,
          request: { ...proposal.request, actorName: fresh.commander?.name ?? fresh.user.name ?? fresh.actor.name }, phase: "waiting", waitingScripts: [],
          script: null, scriptSlot: null, phaseScripts: {}, scriptStates: {}, core: {}, interruption: null, errorRetries: 0, acceptedAt: Date.now(), startedAt: null };
        if (current && this.waitsForScript(current, packet.commandId)) {
          // A replacement is reserved, never executed in parallel. Finish only
          // the already running ignored block; do not enter the old core/after.
          const waiting = clone(current); waiting.pendingReplacement = { ...run, waitingForPhase: current.phase };
          await this.save(scene, waiting);
          commandTrace("object.waiting", { sceneId: scene.id, commandId: run.config.id, objectId: target.id, userId: user.id });
          this.runtime.onChange(scene); return { runId: run.runId };
        }
        if (current) await this.finish(scene, clone(current), { cancelled: true, reason: packet.commandId });
        await this.write(scene, { ...rawRuns(scene), [objectKey(target)]: run });
        for (const parent of [...getRuntimes(scene), ...this.runtime.manualRuns.values()]) {
          for (const [key, progress] of Object.entries(parent.scriptStates ?? {})) {
            if (!key.startsWith(`${objectKey(target)}:`) || !scriptHasActivity(progress)) continue;
            const script = this.runtime.scripts.scriptForKey(parent, object, key); if (!script) continue;
            if (script.interruptions.command === "ignore" && !commandStopsBehavior(fresh.config.id)) {
              if (!terminal(progress)) run.waitingScripts.push({ runId: parent.runId, key });
            } else await this.runtime.scripts.interrupt(scene, parent, object, script, key, commandStopsBehavior(fresh.config.id) ? "manual" : "command");
          }
        }
        if (commandStopsBehavior(fresh.config.id)) await setCommandBehavior(scene, target, false, run.groupId);
        if (!run.waitingScripts.length) { this.enterPhase(run, "before"); run.startedAt = Date.now(); }
        await this.save(scene, run); notifyExecutionChange(scene, "object-command-accepted");
        commandTrace("object.accepted", { sceneId: scene.id, commandId: run.config.id, objectId: target.id, userId: user.id, waiting: run.phase === "waiting" });
        if (run.startedAt !== null) this.publish(scene, run, "commandStarted"); this.runtime.onChange(scene);
        return { runId: run.runId };
      });
    } catch (error) {
      if (stoppedOld && this.activeForObject(scene, target)?.runId === old.runId) {
        await withSceneLock(scene, () => this.finish(scene, clone(old), { cancelled: true, reason: "replacement-rejected" }));
        const failure = new CommandRejection("replacement-rejected", text(
          "Новая команда не принята: условия изменились. Предыдущая команда остановлена.",
          "The new command was not accepted because conditions changed. The previous command has been stopped."));
        failure.cause = error; throw failure;
      }
      throw error;
    }
  }
  waitsForScript(run, replacementId) {
    if (commandStopsBehavior(replacementId) || !run.script || run.script.interruptions.command !== "ignore") return false;
    const progress = run.scriptStates?.[scriptProgressKey(run.target, run.script, run.scriptSlot)];
    return progress && !terminal(progress);
  }
  async activateReplacement(scene, previous) {
    const run = clone(previous.pendingReplacement);
    await this.finish(scene, previous, { cancelled: true, reason: "replacement", activatePending: true });
    const parent = parentOf(scene, previous);
    if (!parent || parent.stateId !== previous.stateId || isCommandParentHalted(scene, parent)) {
      this.publish(scene, run, "commandCancelled"); return;
    }
    run.parentRunId = parent.runId; run.state = clone(parent.state);
    this.enterPhase(run, "before"); run.startedAt = Date.now();
    await this.write(scene, { ...rawRuns(scene), [objectKey(run.target)]: run });
    this.publish(scene, run, "commandStarted"); this.runtime.onChange(scene);
  }
  enterPhase(run, phase, { reset = false } = {}) {
    run.phase = phase; run.core = {}; run.interruption = null;
    if (reset) { run.scriptStates = {}; run.phaseScripts = {}; }
    run.script = phase === "before" ? clone(run.config.beforeScript) : phase === "after" ? clone(run.config.afterScript) : null;
    if (run.script?.enabled === false || !run.script?.steps?.length) run.script = null;
    run.scriptSlot = `command-${phase}`;
    if (run.script) (run.phaseScripts ??= {})[scriptProgressKey(run.target, run.script, run.scriptSlot)] = clone(run.script);
  }
  async interrupt(scene, run, source, error) {
    const settings = run.config.interruptions, rule = settings.error;
    let mode = source === "error" ? rule.mode : settings[source] ?? "stop";
    if (source === "error" && mode !== "stop") {
      if (run.errorRetries >= rule.retries) mode = "stop"; else run.errorRetries++;
    }
    this.stopPresentation(scene, run);
    if (error) {
      console.error(MODULE_ID, "object-command", error);
      debugError("command", "execution.failed", error, { sceneId: scene.id, runId: run.runId, phase: run.phase });
    }
    if (mode === "stop") return this.finish(scene, run, { cancelled: true, reason: source });
    for (const progress of Object.values(run.scriptStates)) clearScriptPresentation(progress);
    run.interruption = { source, mode, retryAt: source === "error" ? this.runtime.now() + rule.delaySeconds * 1000 : null };
    await this.save(scene, run); this.cancelled.delete(run.runId);
  }
  source(scene, run, object) {
    const parent = parentOf(scene, run);
    if (isCommandParentHalted(scene, parent) || !commandBehaviorEnabled(scene, run.target, parent) && !commandPermitsDisabledBehavior(run.config.id)) return "manual";
    if (this.runtime.combat.context(scene, object)) return "combat";
    if (isInteractionPaused(scene, run.target, Date.now(), { playerOnly: true, includeCompleted: true })) return "interaction";
    return null;
  }
  async tick(scene, elapsed) {
    const jobs = [];
    for (const snapshot of this.runs(scene)) {
      let run = clone(snapshot);
      const object = getSceneObject(scene, run.target), parent = parentOf(scene, run);
      const binding = scene.getFlag(MODULE_ID, "objectBindings")?.bindings?.[objectKey(run.target)];
      if (!object || !parent || binding?.groupId !== run.groupId || binding.playerCharacter
        || parent.stateId !== run.stateId || parent.runId !== run.parentRunId && run.interruption?.source !== "manual") {
        await this.finish(scene, run, { cancelled: true, reason: "state-changed" }); continue;
      }
      const source = this.source(scene, run, object);
      if (run.interruption) {
        if (source || run.interruption.retryAt > this.runtime.now()) continue;
        const phase = run.interruption.mode === "restart-script" ? "before"
          : run.interruption.mode === "next-step" ? phaseAfter(run.phase) : run.phase;
        this.enterPhase(run, phase, { reset: true }); run.parentRunId = parent.runId;
        // Resume is a fresh lease: late results retain the old identity.
        const previousId = run.runId; run.runId = id(); this.cancelled.delete(previousId);
        const starting = run.startedAt === null && phase !== "waiting";
        if (starting) run.startedAt = Date.now();
        await this.write(scene, { ...rawRuns(scene), [objectKey(run.target)]: run });
        if (starting) this.publish(scene, run, "commandStarted");
        continue;
      }
      if (source) {
        await this.interrupt(scene, run, source);
        if (source === "interaction") {
          const parentState = getRuntimeForRun(scene, run.parentRunId), clock = parentState?.interactionClocks?.[objectKey(run.target)];
          if (clock?.external) { clock.external = false; await saveRuntime(scene, parentState); }
        }
        continue;
      }
      if (game.paused || this.cancelled.has(run.runId)) continue;
      try {
        if (run.pendingReplacement && (run.phase !== run.pendingReplacement.waitingForPhase || !run.script)) {
          await this.activateReplacement(scene, run); continue;
        }
        jobs.push(...await this.runtime.scripts.tickEffects(scene, run.runId, object, elapsed));
        run = this.state(scene, run.runId); if (!run || !this.owns(scene, run.runId)) continue;
        if (run.phase === "waiting") {
          if (run.waitingScripts.some(ref => !terminal(this.runtime.scriptState(scene, ref.runId)?.scriptStates?.[ref.key]))) continue;
          this.enterPhase(run, "before"); run.startedAt ??= Date.now(); await this.save(scene, run);
          this.publish(scene, run, "commandStarted"); continue;
        }
        if (run.phase === "complete") {
          if (run.config.id === "delete") {
            const scope = createExecutionScope(scene, { isCurrent: () => !this.disposed && !this.cancelled.has(run.runId)
              && this.activeForObject(scene, run.target)?.runId === run.runId && parentOf(scene, run)?.runId === run.parentRunId
              && !isCommandParentHalted(scene, parentOf(scene, run)) });
            try { const result = await scope.run(() => object.delete()); if (result.stale) continue; }
            finally { scope.dispose(); }
          }
          await this.finish(scene, run); continue;
        }
        if (run.script) {
          const key = scriptProgressKey(run.target, run.script, run.scriptSlot);
          const current = this.state(scene, run.runId); if (!current || !this.owns(scene, run.runId)) continue;
          const job = await this.runtime.scripts.tick(scene, current, object, current.script, elapsed, { slot: current.scriptSlot });
          if (job) jobs.push(job);
          const updated = this.state(scene, run.runId), progress = updated?.scriptStates?.[key];
          if (progress && terminal(progress)) {
            if (progress.status === "failed") await this.interrupt(scene, updated, "error", new Error(updated.error ?? "Command script failed"));
            else if (progress.status !== "done") await this.finish(scene, updated, { cancelled: true, reason: progress.status });
            else if (updated.pendingReplacement) await this.activateReplacement(scene, updated);
            else { this.enterPhase(updated, phaseAfter(run.phase)); await this.save(scene, updated); }
          }
          continue;
        }
        if (run.phase !== "core") { this.enterPhase(run, phaseAfter(run.phase)); await this.save(scene, run); continue; }
        const scope = createExecutionScope(scene, { isCurrent: () => this.current(scene, run, run.target) && !this.source(scene, run, object) });
        try {
          const beforeCore = JSON.stringify(run.core);
          const execute = () => this.core.tick(scene, run, object, elapsed, { isCurrent: scope.current, signal: scope.signal,
            openNote: (document, command) => this.openNote?.(document, command), delegate: (command, parameters) => this.tickDelegation(scene, command, parameters) });
          const result = await scope.run(() => this.runtime.objectEvents
            ? this.runtime.objectEvents.withInitiator(object,{userId:run.request.userId,
              patronUuid:run.request.delegateTokenUuid ? run.request.actorTokenUuid : null},execute)
            : execute());
          if (result.stale) continue;
          if (result.value.done) this.enterPhase(run, "after");
          if (result.value.done || JSON.stringify(run.core) !== beforeCore) await this.save(scene, run);
        } finally { scope.dispose(); }
      } catch (error) { if (this.activeForObject(scene, run.target)?.runId === run.runId) await this.interrupt(scene, run, "error", error); }
    }
    return jobs;
  }
  async recordFollowTarget(scene, targetUuid, point) {
    for (const snapshot of this.runs(scene)) {
      const run = clone(snapshot);
      if (run.core?.follow?.targetUuid === targetUuid && appendFollowWaypoint(run.core.follow, point)) await this.save(scene, run);
    }
  }
  tickDelegation(scene, run, parameters) {
    let pending = this.delegations.get(run.runId);
    if (!pending) {
      pending = { done: false, error: null }; this.delegations.set(run.runId, pending);
      // Acceptance takes the scene queue and may invoke asynchronous validators.
      // Never await it while the current core tick holds that same queue.
      void Promise.resolve().then(async () => {
        if (!this.current(scene, run, run.target)) return;
        const user = game.users?.get(run.request.userId);
        await this.accept(scene, { ...run.request, requestId: `${run.runId}:delegated`, method: "delegated",
          delegateTokenUuid: run.request.targetUuid, targetUuid: parameters.targetUuid, commandId: parameters.commandId, parameters: parameters.parameters }, user,
        { isCurrent: () => this.current(scene, run, run.target) });
        pending.done = true;
      }).catch(error => { pending.error = error; });
    }
    if (pending.error) throw pending.error;
    return { done: pending.done };
  }
  async captureHalt(scene, { groupIds } = {}) {
    for (const snapshot of this.runs(scene)) if ((!groupIds || groupIds.includes(snapshot.groupId)) && snapshot.interruption?.source !== "manual") {
      await this.interrupt(scene, clone(snapshot), "manual");
    }
  }
  /** A restoration abandons the old command, including a queued replacement.
   * Unlike Halt, this is not an interruption that can later resume. The caller
   * holds the scene queue until the replacement initial execution is prepared. */
  async cancelForRestoration(scene, { groupIds, target } = {}) {
    for (const run of this.runs(scene)) {
      if (groupIds && !groupIds.includes(run.groupId) || target && objectKey(run.target) !== objectKey(target)) continue;
      await this.finish(scene, run, { cancelled: true, reason: "initial-restoration" });
    }
  }
  activate(scene) { for (const run of this.runs(scene)) this.cancelled.delete(run.runId); }
  clear(scene) { for (const run of this.runs(scene)) this.stopPresentation(scene, run); this.cache.delete(scene); }
  dispose() { this.clear(globalThis.canvas?.scene); this.disposed = true; this.cancelled.clear(); this.delegations.clear(); }
}
