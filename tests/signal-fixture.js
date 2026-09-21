import { MODULE_ID, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition as defaultDefinition } from "./fixtures/definitions.js";
import { SignalCatalog } from "../dmicher-master-screen/scripts/signal-catalog.js";
import { SceneSignals } from "../dmicher-master-screen/scripts/signals.js";
import { signalMacroSnippet } from "../dmicher-master-screen/scripts/signal-macros.js";
import { generics } from "../dmicher-master-screen/scripts/generics.js";

let macroProvider;
export function fixture({ premiumMacros = true } = {}) {
  macroProvider?.dispose();
  // Existing signal-contract tests exercise the Premium macro handler itself;
  // collection limits retain their free defaults unless a test grants them.
  macroProvider = premiumMacros ? generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => true,
    extensions: [{ moduleId: MODULE_ID, apiVersion: 1, methods: { canExecuteScriptKind: () => true,
      resolveInteractivePresentation: () => true, resolveShopRestoration: () => true, resolvePlayerActionLock: () => true } }] }) : null;
  let sequence = 0;
  globalThis.foundry = { utils: { randomID: () => `id-${++sequence}` } };
  const user = { id: "gm", isGM: true, role: 4, active: true };
  globalThis.game = { user, users: new Map([[user.id, user]]), combats: new Map() };
  const notifications = [];
  globalThis.ui = { notifications: { error: (message) => notifications.push(message) } };
  const definition = defaultDefinition();
  const data = { groupDefinitions: { main: definition }, groupRuntimes: { main: { ...emptyRuntime(), runId: "run", stateId: definition.states[0].id, state: definition.states[0] } },
    objectBindings: { bindings: {} }, interactionCatalog: { shops: [{ id: "shop", name: "Shop" }], dialogues: [{ id: "dialogue", name: "Dialogue" }] } };
  let writes = 0;
  const scene = { id: "scene", name: "Scene", uuid: "Scene.scene", tokens: new Map([["npc", { id: "npc", name: "NPC" }], ["other", { id: "other", name: "Other" }]]),
    getFlag: (scope, key) => scope === MODULE_ID ? structuredClone(data[key]) : undefined,
    setFlag: async (scope, key, value) => { data[key] = structuredClone(value); writes++; } };
  globalThis.canvas = { scene };
  const macros = new Map(), calls = [];
  const resolveMacro = async (uuid) => macros.get(uuid);
  const runtime = { enter: async (...args) => calls.push(["enter", ...args]), halt: async (...args) => calls.push(["halt", ...args]), haltAll: async (...args) => calls.push(["haltAll", ...args]) };
  const bus = new SceneSignals({ runtime, resolveMacro });
  const catalog = new SignalCatalog(scene, { resolveMacro });
  function macro(uuid, signal, operation = () => {}) {
    const command = signalMacroSnippet(signal), execute = new (Object.getPrototypeOf(async function () {}).constructor)(command);
    const result = { documentName: "Macro", type: "script", canExecute: true, name: uuid, command,
      async execute() { const instance = await execute(); instance.execute = async function (context) { return operation.call(this, context); }; return instance; } };
    macros.set(uuid, result); return result;
  }
  async function subscribe(signal, ownerKey = "Token:other", operation) {
    if (signal.emitterKey.startsWith("Token:")) {
      const binding = data.objectBindings.bindings[signal.emitterKey] ??= {};
      binding.signals ??= { enabled: true, enabledIds: [] };
      if (!binding.signals.enabledIds.includes(signal.id)) binding.signals.enabledIds.push(signal.id);
    }
    const uuid = `Macro.${++sequence}`; macro(uuid, signal, operation);
    await catalog.attachMacro(ownerKey, uuid);
    const entry = await catalog.saveSubscription({ ownerKey, emitterKey: signal.emitterKey, signalId: signal.id, macroUuid: uuid });
    return { entry, macro: macros.get(uuid) };
  }
  return { scene, data, definition, bus, catalog, macros, macro, subscribe, notifications, calls, writes: () => writes };
}
