import { MODULE_ID } from "./model.js";
import { isAuthority } from "./store.js";
import { InvocationScriptRunner } from "./invocation-script-runner.js";
import { registerScriptFunctions, getScriptFunction } from "./script-functions/index.js";
import { normalizeScript } from "./script-model.js";
import { canExecuteScriptKind } from "./premium-provider.js";
import { text as t } from "./localization.js";

export const SPOTLIGHT_MODULE = "dmicher-spotlight-tools";
const SETTING = "spotlightAutomationPaused";
const keyOf = owner => `${owner.type}:${owner.id}`;
const clone = value => structuredClone(value);
const ownerTypes = ["requests", "polls", "timers", "break", "stopwatch", "focus"];

export function validateWorldScript(script, owner) {
  const normalized = normalizeScript(script);
  for (const step of normalized.steps) {
    const fn = getScriptFunction(step.kind);
    if (!fn?.scopes.includes("world") || fn.acceptsOwner && !fn.acceptsOwner(owner)) throw new Error(t("Функция недоступна этому инструменту.", "The function is unavailable to this tool."));
  }
  return normalized;
}

export function normalizeSpotlightParameters(template, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(t("Ожидаются параметры функции.", "Function parameters are required."));
  const result = {};
  for (const [key, fallback] of Object.entries(template)) {
    const value = input[key] ?? fallback;
    if (typeof fallback === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(t(`Некорректный параметр: ${key}.`, `Invalid parameter: ${key}.`));
      result[key] = value;
    } else if (typeof fallback === "string") {
      if (typeof value !== "string" || value.length > 256) throw new Error(t(`Некорректный параметр: ${key}.`, `Invalid parameter: ${key}.`));
      result[key] = value.trim();
    } else result[key] = clone(value);
  }
  return result;
}

/** One bridge consumes confirmed business events; the shared interpreter owns
 * waiting, transitions, cancellation, retry policies and Premium step skipping. */
export class SpotlightAutomationBridge {
  constructor({ effects, runner, authority = isAuthority, onError = console.error, onSceneEvent, onStop } = {}) {
    Object.assign(this, { authority, onError, onSceneEvent, onStop });
    this.runner = runner ?? new InvocationScriptRunner({ effects, onError, canUsePremiumStep: canExecuteScriptKind });
    this.sources = new Map(); this.preparation = new Map(); this.owners = new Map();
    this.active = new Map(); this.receipts = new Set(); this.chains = new Map(); this.listeners = new Set();
    this.generation = 0; this.disposed = false; this.hooks = []; this.paused = false;
    this.api = Object.freeze({ apiVersion: 1,
      openEditor: (owner, host) => this.openEditor(owner, host),
      mountEditor: (element, owner, host) => this.mountEditor(element, owner, host),
      stop: () => this.stop(), resume: () => this.resume(), getStatus: () => this.status() });
  }
  registerSettings() {
    game.settings.register(MODULE_ID, SETTING, { scope: "world", config: false, type: Boolean, default: false,
      onChange: value => { this.paused = Boolean(value); if (this.paused) this.cancel(); this.changed(); } });
  }
  install() {
    this.paused = game.settings.get(MODULE_ID, SETTING) === true;
    const on = (name, callback) => this.hooks.push([name, Hooks.on(name, callback)]);
    on("dmicherSpotlightReady", () => this.connect());
    on("updateSetting", setting => {
      if (String(setting?.key ?? "").startsWith(`${SPOTLIGHT_MODULE}.`) && !String(setting.key).endsWith(".automationEvent")) this.refresh();
    });
    on("updateUser", () => { if (!this.authority()) this.cancel(); });
    on("userConnected", () => { if (!this.authority()) this.cancel(); });
    this.connect();
    return () => this.dispose();
  }
  connect(host = game.modules.get(SPOTLIGHT_MODULE)?.active ? game.modules.get(SPOTLIGHT_MODULE)?.api?.automation : null) {
    if (this.disposed || this.host === host) return;
    this.cancel(); this.unsubscribe?.(); this.unregisterFunctions?.(); this.host = host;
    this.unsubscribe = null; this.unregisterFunctions = null;
    if (!host || host.apiVersion !== 1) { this.refresh(); return; }
    const definitions = new Map();
    for (const type of ownerTypes) for (const fn of host.functions({ type, id: "catalog" })) definitions.set(fn.id, fn);
    this.unregisterFunctions = registerScriptFunctions([...definitions.values()].map(fn => ({
      id: fn.id, label: fn.label, category: fn.path, description: fn.description, premium: fn.premium,
      scopes: ["world"], template: clone(fn.template), available: () => host.canExecute?.(fn.id) === true,
      fields: context => host.functions(context?.owner ?? { type: fn.ownerTypes[0], id: "catalog" }).find(candidate => candidate.id === fn.id)?.fields ?? {},
      acceptsOwner: owner => fn.ownerTypes.includes(owner?.type),
      normalize: parameters => normalizeSpotlightParameters(fn.template, parameters),
      execute: async ({ engine, job, p, admitted, executionCurrent }) => {
        const run = engine.runtime.runs.get(job.runId), context = run?.context;
        if (!context || this.host !== host) return {};
        const current = () => {
          if (!this.authority() || this.disposed || this.paused || !executionCurrent()) return false;
          try { return admitted(); } catch { return false; }
        };
        if (!current()) return {};
        await host.execute(fn.id, p, { owner: context.owner, current, origin: context.event, causality: context.causality });
        return {};
      }
    })));
    this.refresh();
    this.unsubscribe = host.subscribe(event => this.receive(event));
  }
  refresh() {
    if (this.disposed) return;
    const sources = new Map(), preparation = new Map();
    for (const source of this.host?.sources?.() ?? []) {
      const owner = source.owner ?? { type: source.type, id: source.id }, key = keyOf(owner);
      sources.set(key, { ...source, owner });
      try { preparation.set(key, this.host.readBindings(owner)); }
      catch (error) { this.onError(error); }
      if (!this.owners.has(key)) this.owners.set(key, { id: `spotlight:${key}`, name: source.label || key });
    }
    this.sources = sources; this.preparation = preparation;
    for (const key of this.owners.keys()) if (!sources.has(key)) this.owners.delete(key);
    for (const entry of this.active.values()) if (!entry.current()) this.runner.cancel(entry.ownerHost, run => run.context.invocationId === entry.id);
    this.changed();
  }
  status() { return { available: Boolean(this.host), paused: this.paused, active: this.active.size }; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed() { for (const listener of this.listeners) listener(this.status()); }
  async receive(event) {
    if (this.disposed || this.paused || !this.authority() || !this.host || !event?.id || this.receipts.has(event.id)) return;
    const sourceKey = keyOf(event.owner ?? {}), source = this.sources.get(sourceKey);
    if (!source?.events.includes(event.name)) return;
    this.receipts.add(event.id); if (this.receipts.size > 256) this.receipts.delete(this.receipts.values().next().value);
    const inherited = event.causality;
    const cause = inherited && typeof inherited.rootId === "string" && Array.isArray(inherited.visited)
      ? { rootId: inherited.rootId, depth: Number(inherited.depth), visited: inherited.visited.filter(id => typeof id === "string").slice(0, 64) }
      : { rootId: event.id, depth: 0, visited: [] };
    if (!Number.isSafeInteger(cause.depth) || cause.depth < 0 || cause.depth >= 16) return;
    const count = this.chains.get(cause.rootId) ?? 0;
    if (count >= 64) return;
    this.chains.set(cause.rootId, count + 1);
    if (this.chains.size > 256) this.chains.delete(this.chains.keys().next().value);
    const generation = this.generation, host = this.host;
    const eventCurrent = () => !this.disposed && !this.paused && this.authority() && this.host === host && this.generation === generation && this.sources.has(sourceKey);
    if (eventCurrent()) void Promise.resolve(this.onSceneEvent?.(event, eventCurrent, cause)).catch(this.onError);
    const pending = [];
    for (const [ownerKey, preparation] of this.preparation) for (const subscription of preparation.subscriptions ?? []) {
      if (!subscription.enabled || subscription.event !== event.name || keyOf(subscription.source ?? {}) !== sourceKey) continue;
      const signature = `${ownerKey}:${subscription.id}`;
      if (cause.visited.includes(signature) || this.active.size >= 100) continue;
      const sourceOwner = this.sources.get(ownerKey), owner = sourceOwner?.owner;
      if (!owner) continue;
      const ownerHost = this.owners.get(ownerKey), id = crypto.randomUUID();
      const current = () => eventCurrent() && this.active.has(id) && this.preparation.get(ownerKey)?.revision === preparation.revision;
      const causality = { rootId: cause.rootId, depth: cause.depth + 1, visited: [...cause.visited, signature] };
      const context = { owner: clone(owner), event: clone(event), causality, invocationId: id,
        parameters: { event: JSON.stringify(event.parameters) },
        signal: { id: `${sourceKey}:${event.name}`, name: event.name, parameters: [{ name: "event", type: "string" }], returns: [] } };
      this.active.set(id, { id, ownerHost, current }); this.changed();
      const operation = this.runner.run({ host: ownerHost, owner: { ...owner, name: sourceOwner.label || ownerKey }, scope: "world",
        script: subscription.script, context, current,
        adapters: { isMacroAttached: uuid => current() && (this.preparation.get(ownerKey)?.registeredMacroUuids ?? []).includes(uuid) } });
      pending.push(Promise.resolve(operation).catch(this.onError).finally(() => { this.active.delete(id); this.changed(); }));
    }
    await Promise.all(pending);
  }
  cancel() { this.generation += 1; this.runner.cancel(); this.active.clear(); this.changed(); }
  async stop() {
    if (!this.authority()) throw new Error(t("Остановку выполняет исполняющий мастер.", "Only the executing GM can stop automation."));
    this.paused = true; this.cancel(); this.onStop?.();
    await game.settings.set(MODULE_ID, SETTING, true); this.changed();
  }
  async resume() {
    if (!this.authority()) throw new Error(t("Запуск выполняет исполняющий мастер.", "Only the executing GM can resume automation."));
    await game.settings.set(MODULE_ID, SETTING, false); this.paused = false; this.changed();
  }
  async openEditor(owner, host = this.host) {
    if (!game.user?.isGM) throw new Error(t("Требуются права мастера.", "GM permissions required."));
    const { SpotlightAutomationEditor } = await import("./apps/spotlight-automation-editor.js");
    return new SpotlightAutomationEditor({ owner, host, bridge: this }).render({ force: true });
  }
  async mountEditor(element, owner, host = this.host) {
    if (!game.user?.isGM) throw new Error(t("Требуются права мастера.", "GM permissions required."));
    const { mountSpotlightAutomationEditor } = await import("./apps/spotlight-automation-editor.js");
    return mountSpotlightAutomationEditor(element, { owner, host, bridge: this });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.runner.dispose(); this.unsubscribe?.(); this.unregisterFunctions?.();
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = []; this.listeners.clear();
  }
}
