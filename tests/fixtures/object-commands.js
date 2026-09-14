import { GroupRuntime } from "../../dmicher-master-screen/scripts/runtime.js";
import { ObjectCommandRuntime } from "../../dmicher-master-screen/scripts/object-command-runtime.js";
import { ObjectCommandLights } from "../../dmicher-master-screen/scripts/object-command-lights.js";
import { defaultObjectCommand } from "../../dmicher-master-screen/scripts/object-command-model.js";
import { getRuntime } from "../../dmicher-master-screen/scripts/store.js";
import { MODULE_ID } from "../../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition } from "./definitions.js";

const clone = structuredClone;
export function mergeCommandFlags(before, after) {
  if (!after || typeof after !== "object" || Array.isArray(after)) return clone(after);
  const result = before && typeof before === "object" ? clone(before) : {};
  for (const [key, value] of Object.entries(after)) {
    if (key.startsWith("-=")) delete result[key.slice(2)]; else result[key] = mergeCommandFlags(result[key], value);
  }
  return result;
}
export async function commandFixture({ commands = ["wait", "come", "cancel", "stop"], scripts = [], core, emit } = {}) {
  let serial = 0, clock = 1000;
  const gm = { id: "gm", isGM: true, role: 4, active: true }, player = { id: "player", role: 1, active: true, isGM: false };
  globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player]]), modules: new Map(), combats: new Map(), paused: false,
    settings: { get: () => false }, i18n: { lang: "en" } };
  globalThis.foundry = { utils: { randomID: () => `command-${++serial}` } }; globalThis.CONFIG = {};
  globalThis.ui = { notifications: { warn() {}, error() {} } };
  const configs = commands.map(entry => typeof entry === "string" ? { ...defaultObjectCommand(entry), enabled: true } : entry);
  const binding = { type: "Token", id: "npc", groupId: "main", commands: configs, scripts };
  const flags = { groupDefinitions: { main: sampleGroupDefinition() }, groupRuntimes: {},
    objectBindings: { schemaVersion: 1, revision: 0, bindings: { "Token:npc": binding } } };
  let writes = 0;
  const scene = { id: "scene", uuid: "Scene.scene", name: "Scene", tokenVision: false, grid: { size: 100, distance: 5 },
    tokens: new Map(), walls: new Map(), lights: new Map(), getFlag: (_scope, key) => clone(flags[key]),
    async setFlag(_scope, key, value) {
      writes++; let target = flags; const parts = key.split(".");
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = mergeCommandFlags(target[parts.at(-1)], value);
    }
  };
  const makeToken = (id, x) => ({ id, uuid: `Scene.scene.Token.${id}`, name: id, documentName: "Token", parent: scene,
    x, y: 0, width: 1, height: 1, rotation: 0, hidden: false, actor: { testUserPermission: user => user.id === player.id || user.isGM },
    object: { stopAnimation() {} }, async update(changes) { Object.assign(this, changes); } });
  const npc = makeToken("npc", 0), pc = makeToken("pc", 100);
  scene.tokens.set(npc.id, npc); scene.tokens.set(pc.id, pc); globalThis.canvas = { scene };
  game.scenes = new Map([[scene.id, scene]]);
  const signals = [], errors = [], runtime = new GroupRuntime({ now: () => clock, effects: { stop() {}, sound: async () => {}, macro: async () => {} } });
  runtime.report = error => errors.push(error);
  const executor = new ObjectCommandRuntime({ runtime, core, lights: new ObjectCommandLights(),
    signals: { async emit(scene, signal) { signals.push(signal); return emit ? emit(scene, signal) : { allowed: true }; } } });
  runtime.commandExecutor = executor;
  await runtime.enter(scene, "calm");
  const packet = (commandId, parameters = {}) => ({ version: 1, requestId: `input-${++serial}`, sceneId: scene.id,
    actorTokenUuid: pc.uuid, targetUuid: npc.uuid, commandId, parameters });
  const tick = async (milliseconds = 100) => { clock += milliseconds; await runtime.tick(); };
  const active = () => executor.activeForObject(scene, { type: "Token", id: npc.id });
  const accept = (commandId, parameters, user = player) => executor.accept(scene, packet(commandId, parameters), user);
  return { scene, npc, pc, gm, player, flags, binding, configs, runtime, executor, packet, accept, tick, active, signals, errors,
    current: () => getRuntime(scene), writes: () => writes };
}
