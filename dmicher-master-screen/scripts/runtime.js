import { MODULE_ID, getState, emptyRuntime } from "./model.js";
import { getDefinition, getDefinitions, getRuntime, getRuntimes, getRuntimeForRun, saveRuntime, withSceneLock, requireGM, isAuthority, asArray } from "./store.js";
import { createFoundryEffects, tokenCenter, crossesRectangle, clearTokenEmojis, setTokenEmoji, setObjectSpeech } from "./effects.js";
import { getConditionKey, getConditionGate, consumeCondition, resetStateConditions } from "./interaction-conditions.js";
import { executionGeneration, requestHalt, finishHalt, isExecutionHalted, notifyExecutionChange,
  sceneExecutionGeneration, requestSceneHalt, finishSceneHalt, isSceneAutomationHalted } from "./execution.js";
import { materializeState, getSceneObject, getObjectBindings, objectKey } from "./scene-objects.js";
import { isInteractionPaused } from "./interaction-pause.js";
import { ObjectScriptRuntime, scriptProgressKey, initialScriptProgress } from "./script-runtime.js";
import { createCombatAdapter } from "./combat-adapter.js";
import { getSignalCatalog } from "./signal-catalog.js";
import { SCENE_OBJECT_TYPES, SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";

const clone = (value) => structuredClone(value);
const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID();
const uuid = (scene) => scene.uuid ?? `Scene.${scene.id}`;

/** Owns group lifetimes. Scripts and signals have separate executors and never own group state. */
export class GroupRuntime {
  constructor({ onChange = () => {}, onWorkspace = async () => {}, emitSignal = async () => ({ allowed: true }), chat,
    effects, now = () => Date.now(), isConstructor = () => false, combat } = {}) {
    Object.assign(this, { onChange, onWorkspace, emitSignal, now, isConstructor });
    this.effects = effects ?? createFoundryEffects(chat);
    this.chat = chat; this.hooks = []; this.previousPositions = new Map(); this.tickTimes = new Map();
    this.manualRuns = new Map(); this.manualVisuals = new Map(); this.busy = false; this.disposed = false;
    this.combat = combat ?? createCombatAdapter({ chat, emitSignal: (scene, name, parameters) => this.emitSignal(scene, { emitterKey: `Combat:${scene.id}`, name, parameters }) });
    this.scripts = new ObjectScriptRuntime(this);
  }
  requireAuthority(scene) { requireGM(); if (!isAuthority() || !scene || globalThis.canvas?.scene?.id !== scene.id) throw new Error("Действие доступно исполняющему мастеру текущей сцены."); }
  owns(scene, runId) {
    if (this.disposed || !isAuthority() || globalThis.canvas?.scene?.id !== scene?.id) return false;
    if (!runId) return true;
    if (this.manualRuns.has(runId)) return this.manualRuns.get(runId).sceneId === scene.id;
    const run = getRuntimeForRun(scene, runId);
    return Boolean(run?.state && !isExecutionHalted(scene, run));
  }
  report(error) { console.error(MODULE_ID, error); globalThis.ui?.notifications?.error?.(error.message ?? String(error)); }
  start() {
    if (this.interval) return this;
    this.disposed = false;
    const on = (name, fn) => this.hooks.push([name, Hooks.on(name, fn)]);
    on("canvasReady", () => { this.tickTimes.clear(); this.refresh(canvas.scene); });
    on("canvasTearDown", () => { this.manualRuns.clear(); this.manualVisuals.clear(); notifyExecutionChange(globalThis.canvas?.scene, "canvas-teardown"); this.tickTimes.clear(); clearTokenEmojis(); });
    on("updateUser", () => notifyExecutionChange(globalThis.canvas?.scene));
    on("updateScene", (scene, changes) => { if (changes.flags?.[MODULE_ID] || Object.keys(changes).some((key) => key.startsWith(`flags.${MODULE_ID}`))) this.refresh(scene); });
    for (const type of SCENE_OBJECT_TYPES) on(`refresh${type}`, (object) => this.refreshObject(object.document));
    on("preUpdateToken", (token, changes) => { if ("x" in changes || "y" in changes) this.previousPositions.set(token.uuid ?? token.id, tokenCenter(token, token.parent)); });
    on("updateToken", (token, changes) => {
      if (!("x" in changes || "y" in changes)) return;
      const key = token.uuid ?? token.id, previous = this.previousPositions.get(key); this.previousPositions.delete(key);
      if (previous) void this.onTokenMove(token, previous).catch((error) => this.report(error));
    });
    this.combat.activate?.();
    this.interval = setInterval(() => { void this.tick().catch((error) => this.report(error)); }, 100);
    return this;
  }
  dispose() {
    this.disposed = true; clearInterval(this.interval); this.interval = null;
    this.manualRuns.clear(); this.manualVisuals.clear(); this.scripts.dispose?.(); this.combat.dispose?.(); clearTokenEmojis();
    for (const [name, id] of this.hooks) Hooks.off(name, id); this.hooks = []; this.tickTimes.clear();
  }
  scriptState(scene, runId) { return this.manualRuns.has(runId) ? clone(this.manualRuns.get(runId)) : getRuntimeForRun(scene, runId); }
  async saveScriptState(scene, state) {
    if (state.manual) {
      if (!this.manualRuns.has(state.runId)) return;
      this.manualRuns.set(state.runId, clone(state)); this.refresh(scene); return state;
    }
    return saveRuntime(scene, state);
  }
  currentObject(scene, runId, target, { ignoreInteractionPause = false } = {}) {
    if (!this.owns(scene, runId)) return false;
    const run = this.scriptState(scene, runId), binding = getObjectBindings(scene).bindings[objectKey(target)];
    if (!run) return false;
    if (!getSceneObject(scene, target) || binding?.playerCharacter) return false;
    if (run.manual && objectKey(run.target) !== objectKey(target)) return false;
    if (!run.manual && [...this.manualRuns.values()].some((manual) => manual.sceneId === scene.id && objectKey(manual.target) === objectKey(target))) return false;
    if (!run.manual && (!binding || binding.groupId !== run.groupId || run.disabledObjects.includes(objectKey(target)))) return false;
    if (!ignoreInteractionPause && isInteractionPaused(scene, target)) return false;
    return true;
  }
  isTokenEnabled(run, id) { return !run.halted && !run.disabledObjects.includes(`Token:${id}`); }
  refreshObject(object) {
    if (!object) return;
    const scene = object.parent ?? globalThis.canvas?.scene;
    const target = { type: object.documentName ?? (scene?.tokens?.get(object.id) === object ? "Token" : "Tile"), id: object.id };
    const runs = [...getRuntimes(scene).filter((run) => !isExecutionHalted(scene, run) && !run.disabledObjects.includes(objectKey(target))),
      ...[...this.manualRuns.values(), ...this.manualVisuals.values()].filter((run) => run.sceneId === scene?.id)];
    const prefix = `${objectKey(target)}:`, progress = runs.flatMap((run) => Object.entries(run.scriptStates ?? {}).filter(([key]) => key.startsWith(prefix)).map(([, value]) => value)).filter(Boolean);
    const latest = (field) => progress.reduce((selected, entry) => Number(entry[`${field}At`] ?? 0) > Number(selected?.[`${field}At`] ?? 0) ? entry : selected, null);
    setTokenEmoji(object, latest("emoji")?.emoji ?? ""); setObjectSpeech(object, latest("bubble")?.bubble ?? null);
  }
  refreshToken(token) { this.refreshObject(token); }
  refresh(scene) {
    if (scene?.id !== globalThis.canvas?.scene?.id) return;
    for (const collection of Object.values(SCENE_OBJECT_COLLECTIONS)) for (const object of asArray(scene[collection])) this.refreshObject(object);
    this.onChange(scene);
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
      const reasons = result.messages?.map((message) => typeof message === "string" ? message : `${message.name || message.ownerKey || "Подписчик"}: ${message.message ?? ""}`).join("; ") || "Подписчик запретил действие.";
      const error = new Error(reasons); this.report(error); throw error;
    }
    return parameters;
  }
  async enter(scene, stateId, { groupId = "main", force = false, restart = false, expectedRunId, signalContext, preserveStatus = false } = {}) {
    this.requireAuthority(scene);
    const previous = getRuntime(scene, { groupId }), group = getDefinition(scene, { groupId });
    stateId ??= previous.stateId ?? group.entryStateId;
    const prepared = getState(group, stateId); if (!prepared) throw new Error("Состояние не найдено.");
    if (expectedRunId && previous.runId !== expectedRunId) return null;
    if (!force && !restart && !previous.halted && !isSceneAutomationHalted(scene) && previous.stateId === stateId) return previous;
    const starting = !preserveStatus && (restart || !previous.runId || previous.halted);
    const generation = executionGeneration(scene, groupId), sceneGeneration = sceneExecutionGeneration(scene);
    const parameters = await this.validateChange(scene, group, prepared, previous, starting, signalContext);
    const active = preserveStatus ? Boolean(previous.runId && !previous.halted) : true;
    const run = await withSceneLock(scene, async () => {
      this.requireAuthority(scene);
      const current = getRuntime(scene, { groupId });
      if (current.runId !== previous.runId || current.stateId !== previous.stateId || getDefinition(scene, { groupId }).revision !== group.revision || executionGeneration(scene, groupId) !== generation || sceneExecutionGeneration(scene) !== sceneGeneration) throw new Error("Группа изменилась во время проверки. Повторите команду.");
      const snapshot = materializeState(scene, group, prepared);
      const next = { ...emptyRuntime(groupId), groupId, stateId, state: snapshot, runId: active ? randomId() : previous.runId,
        halted: preserveStatus ? previous.halted : false, haltedAt: preserveStatus ? previous.haltedAt : 0,
        enteredAt: this.now(), definitionRevision: group.revision, disabledObjects: clone(previous.disabledObjects),
        shops: clone(previous.shops), tradeRequests: clone(previous.tradeRequests), dialogueCommands: clone(previous.dialogueCommands),
        shopSessions: Object.fromEntries(Object.entries(previous.shopSessions).filter(([, session]) => session?.status === "pending")),
        conditionCounts: clone(previous.conditionCounts), conditionEnabledOverrides: clone(previous.conditionEnabledOverrides) };
      if (active) resetStateConditions(next);
      await saveRuntime(scene, next);
      if (!preserveStatus) { await scene.setFlag(MODULE_ID, "automationHalted", false); finishSceneHalt(scene, sceneGeneration); }
      finishHalt(scene, generation, groupId); notifyExecutionChange(scene);
      this.tickTimes.set(`${scene.id}:${groupId}`, this.now()); return next;
    });
    if (active) {
      await this.once(scene, run.runId, "workspace", () => this.onWorkspace(scene, clone(run.state.workspace), { runId: run.runId, groupId }));
      if (run.state.pause) await this.once(scene, run.runId, "pause", () => game.togglePause(true, { broadcast: true }));
      if (run.state.sound) await this.once(scene, run.runId, "sound", () => this.effects.sound(run.state.sound));
      for (const spawn of run.state.spawns) await this.once(scene, run.runId, `spawn:${spawn.id}`, () => this.effects.spawn(scene, spawn, run.runId, () => this.owns(scene, run.runId)));
    }
    this.refresh(scene);
    await this.emitSignal(scene, { emitterKey: `Group:${groupId}`, name: starting ? "started" : "transitioned", parameters,
      context: { ...signalContext, runId: run.runId, groupId, manual: !active } });
    return getRuntime(scene, { groupId });
  }
  async halt(scene, { groupId = "main", all = false } = {}) {
    this.requireAuthority(scene);
    const ids = all ? getDefinitions(scene).map((entry) => entry.groupId) : [getDefinition(scene, { groupId }).groupId];
    const sceneGeneration = all ? requestSceneHalt(scene) : null;
    const generations = new Map(ids.map((id) => [id, requestHalt(scene, id)]));
    if (all) { this.manualRuns.clear(); this.manualVisuals.clear(); notifyExecutionChange(scene, "halt"); }
    return withSceneLock(scene, async () => {
      const result = [];
      if (all) { await scene.setFlag(MODULE_ID, "automationHalted", true); finishSceneHalt(scene, sceneGeneration); }
      for (const id of ids) { const run = getRuntime(scene, { groupId: id }); run.halted = true; run.haltedAt = this.now();
        await saveRuntime(scene, run); finishHalt(scene, generations.get(id), id); this.tickTimes.delete(`${scene.id}:${id}`); result.push(run); }
      this.refresh(scene); return all ? result : result[0];
    });
  }
  haltAll(scene) { return this.halt(scene, { all: true }); }
  async startAll(scene) {
    this.requireAuthority(scene); const result = [];
    for (const group of getDefinitions(scene)) {
      try { result.push(await this.enter(scene, getRuntime(scene, { groupId: group.groupId }).stateId ?? group.entryStateId, { groupId: group.groupId, force: true, restart: true })); }
      catch (error) { this.report(error); result.push({ groupId: group.groupId, error: error.message }); }
    }
    return result;
  }
  async restoreInitial(scene, target) {
    this.requireAuthority(scene);
    const binding = getObjectBindings(scene).bindings[objectKey(target)];
    if (!binding?.initialScript?.enabled) throw new Error("Исходное состояние объекта не настроено.");
    for (const [id, previous] of this.manualRuns) if (previous.sceneId === scene.id && objectKey(previous.target) === objectKey(target)) this.manualRuns.delete(id);
    const run = { ...emptyRuntime(binding.groupId), manual: true, sceneId: scene.id, runId: randomId(), target: clone(target), script: clone(binding.initialScript) };
    this.manualRuns.set(run.runId, run); this.tickTimes.set(`${scene.id}:${run.runId}`, this.now()); notifyExecutionChange(scene, "initial-restoration"); return run.runId;
  }
  async once(scene, runId, key, operation) {
    const claimed = await withSceneLock(scene, async () => {
      if (!this.owns(scene, runId)) return false;
      const run = getRuntimeForRun(scene, runId); if (run.effects[key]) return false;
      run.effects[key] = { status: "pending", at: this.now() }; await saveRuntime(scene, run); return true;
    });
    if (!claimed || !this.owns(scene, runId)) return;
    let error; try { await operation(); } catch (cause) { error = cause; this.report(cause); }
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
    this.requireAuthority(scene); const key = objectKey(target);
    return withSceneLock(scene, async () => {
      const run = getRuntime(scene, { groupId }); run.disabledObjects = run.disabledObjects.filter((id) => id !== key);
      if (!enabled) run.disabledObjects.push(key); await saveRuntime(scene, run); notifyExecutionChange(scene); this.refresh(scene); return run;
    });
  }
  async resetConditions(scene, { conditionKey, groupId = "main" } = {}) {
    this.requireAuthority(scene); return withSceneLock(scene, async () => {
      const run = getRuntime(scene, { groupId });
      if (conditionKey && !conditionKey.startsWith(`${groupId}:`)) throw new Error("Счётчик относится к другой группе.");
      if (conditionKey) delete run.conditionCounts[conditionKey]; else run.conditionCounts = {};
      await saveRuntime(scene, run); this.refresh(scene); return run;
    });
  }
  async setConditionEnabled(scene, conditionKey, enabled) {
    this.requireAuthority(scene); return withSceneLock(scene, async () => {
      const groupId = conditionKey.split(":")[0], run = getRuntime(scene, { groupId });
      if (!conditionKey.startsWith(`${groupId}:${run.stateId}:`) || typeof enabled !== "boolean") throw new Error("Условия относятся к другому состоянию.");
      run.conditionEnabledOverrides[conditionKey] = enabled; await saveRuntime(scene, run); this.refresh(scene); return run;
    });
  }
  async tick() {
    const scene = globalThis.canvas?.scene; if (this.busy || !this.owns(scene)) return;
    this.busy = true; const jobs = [];
    try {
      await this.effects.cleanupSpeech?.();
      for (const run of [...getRuntimes(scene), ...this.manualRuns.values()]) {
        const clockKey = `${scene.id}:${run.manual ? run.runId : run.groupId}`, now = this.now();
        const elapsed = Math.min(1, Math.max(0, (now - (this.tickTimes.get(clockKey) ?? now)) / 1000)); this.tickTimes.set(clockKey, now);
        if ((!run.manual && (!run.state || !run.runId || run.halted)) || game.paused) continue;
        await withSceneLock(scene, async () => {
          if (!this.owns(scene, run.runId)) return;
          const objects = run.manual ? [{ target: run.target }] : run.state.objects;
          for (const { target } of objects) {
            if (!this.currentObject(scene, run.runId, target, { ignoreInteractionPause: true })) continue;
            let current = this.scriptState(scene, run.runId); const key = objectKey(target);
            if (isInteractionPaused(scene, target)) { if (!current.interactionClocks[key]) { current.interactionClocks[key] = { at: now }; await this.saveScriptState(scene, current); } continue; }
            let budget = elapsed; if (current.interactionClocks[key]) { current.interactionClocks[key] = null; await this.saveScriptState(scene, current); budget = 0; }
            const object = getSceneObject(scene, target);
            const transition = run.manual ? run.script : run.state.transitions.find((script) => objectKey(script.target) === key);
            let slot = run.manual ? "initial" : "transition", script = transition;
            const status = script && this.scriptState(scene, run.runId).scriptStates[scriptProgressKey(target, script, slot)]?.status;
            if (!script || script.enabled === false || status === "done" || run.manual && ["failed", "uncertain"].includes(status)) {
              if (run.manual) { this.manualVisuals.set(`${scene.id}:${key}`, this.scriptState(scene, run.runId)); this.manualRuns.delete(run.runId); this.tickTimes.delete(clockKey); this.refreshObject(object); continue; }
              script = run.state.scripts.find((entry) => objectKey(entry.target) === key); slot = "routine";
            }
            if (!script) continue;
            try { const job = await this.scripts.tick(scene, this.scriptState(scene, run.runId), object, script, budget, { slot }); if (job) jobs.push(job); }
            catch (error) { this.report(error); current = this.scriptState(scene, run.runId); if (current) {
              const progress = current.scriptStates[scriptProgressKey(target, script, slot)] ??= initialScriptProgress(script); progress.status = "failed";
              current.error = error.message; await this.saveScriptState(scene, current);
            } }
          }
        });
      }
    } finally { this.busy = false; }
    await Promise.all(jobs.map((job) => this.scripts.execute(job)));
  }
  async onTokenMove(token, previous) {
    const scene = token.parent; if (!this.owns(scene) || game.paused) return;
    if (!asArray(game.users).some((user) => [1, 2].includes(Number(user.role)) && token.actor?.testUserPermission?.(user, "OWNER"))) return;
    for (const snapshot of getRuntimes(scene)) {
      if (!this.owns(scene, snapshot.runId)) continue;
      for (const zone of snapshot.state?.zones ?? []) {
        if (!zone.signalId || !crossesRectangle(previous, tokenCenter(token, scene), zone)) continue;
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
    if (!Combat?.create) throw new Error("Боевая система Foundry недоступна.");
    let combat = asArray(game.combats).find((entry) => (entry.scene?.id ?? entry.scene) === scene.id);
    if (!combat) combat = await Combat.create({ scene: scene.id, active: true });
    const selected = asArray(canvas.tokens?.controlled).map((object) => object.document), tokens = (selected.length ? selected : asArray(scene.tokens)).filter((token) => token.actor);
    const present = new Set(asArray(combat.combatants).map((entry) => entry.tokenId));
    const additions = tokens.filter((token) => !present.has(token.id)).map((token) => ({ tokenId: token.id, actorId: token.actor.id, hidden: Boolean(token.hidden) }));
    if (additions.length) await combat.createEmbeddedDocuments("Combatant", additions);
    await combat.activate?.(); if (rollInitiative) await combat.rollAll(); if (!combat.started) await combat.startCombat(); return combat;
  }
}
