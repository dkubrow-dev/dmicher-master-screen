import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./signal-fixture.js";
import { ObjectEventSignals } from "../dmicher-master-screen/scripts/object-event-signals.js";
import { normalizeObjectSignalSettings } from "../dmicher-master-screen/scripts/object-signal-settings.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const f = fixture(), emitted = [];
  const events = new ObjectEventSignals({ emit: async (_scene, packet) => emitted.push(packet) });
  const object = (type, id, data = {}) => ({ documentName: type, id, parent: f.scene, uuid: `Scene.scene.${type}.${id}`, ...data });
  const enable = (document, name) => {
    const key = `${document.documentName}:${document.id}`, binding = f.data.objectBindings.bindings[key] ??= {};
    binding.signals ??= normalizeObjectSignalSettings();
    binding.signals.enabledIds.push(`builtin:${key}:${name}`);
  };
  return { ...f, events, emitted, object, enable };
}

test("native and custom object publication is opt-in while core validation remains available", async () => {
  const f = setup(), signal = await f.catalog.saveSignal({ emitterKey: "Token:npc", name: "custom" });
  assert.equal(f.catalog.list().signals.find(entry => entry.id === signal.id).enabled, false);
  assert.equal((await f.bus.emit(f.scene, { emitterKey: "Token:npc", signalId: signal.id })).status, "disabled");
  assert.equal(f.catalog.list().signals.find(entry => entry.emitterKey === "Token:npc" && entry.name === "commandRequested").enabled, true);
});

test("native hooks perform no publication by default and preserve trusted command provenance", async () => {
  const f = setup(), door = f.object("Wall", "door", { c: [0, 0, 10, 0], door: 1, ds: 1 });
  f.scene.walls = new Map([[door.id, door]]);
  f.events.observeUpdate(door, { ds: 1 }, {}, "player"); await settle(); assert.equal(f.emitted.length, 0);
  f.enable(door, "doorOpened");
  await f.events.withInitiator(door, { userId: "player", patronUuid: "Scene.scene.Token.npc" }, async () => {
    f.events.observeUpdate(door, { ds: 1 }, { patronUuid: "spoofed" }, "gm");
  });
  await settle();
  assert.equal(f.emitted[0].parameters.userUuid, "User.player"); assert.equal(f.emitted[0].parameters.patronUuid, "Scene.scene.Token.npc");
  f.events.observeUpdate(door, { ds: 1 }, { patronUuid: "spoofed" }, "gm"); await settle();
  assert.equal(f.emitted[1].parameters.patronUuid, null);
});

test("collision observers respond to position changes and new contact, not visual refreshes", async () => {
  const f = setup(), moving = f.object("Token", "npc", { x: 0, y: 0, width: 1, height: 1 }), target = f.object("Tile", "tile", { x: 200, y: 0, width: 50, height: 50 });
  f.scene.grid = { size: 100 }; f.scene.tokens = new Map([[moving.id, moving]]); f.scene.tiles = new Map([[target.id, target]]);
  f.enable(target, "collision");
  f.events.observeBefore(moving, { x: 150 }); moving.x = 150; f.events.observeUpdate(moving, { x: 150 }, {}, "player");
  await settle(); assert.equal(f.emitted.length, 1); assert.equal(f.emitted[0].parameters.otherObjectUuid, moving.uuid);
  f.events.observeUpdate(moving, { rotation: 90 }, {}, "player");
  f.events.observeBefore(moving, { x: 160 }); moving.x = 160; f.events.observeUpdate(moving, { x: 160 }, {}, "player");
  await settle(); assert.equal(f.emitted.length, 1);
});

test("script subscriptions receive typed inputs and owner variable capabilities", async () => {
  const f = setup(), signal = await f.catalog.saveSignal({ emitterKey: "Scene:scene", name: "event", parameters: [{ name: "amount", type: "integer" }] });
  f.data.objectBindings.bindings["Token:npc"] = { variables: [{ name: "counter", type: "integer", value: 0 }] };
  await f.catalog.saveSubscription({ ownerKey: "Token:npc", emitterKey: signal.emitterKey, signalId: signal.id, handler: "script" });
  f.bus.runObjectEvent = async (_scene, { owner, parameters, variables }) => {
    assert.equal(owner.key, "Token:npc");
    await variables.SetValue(variables.objectUuid, "counter", parameters.amount);
    return {};
  };
  const result = await f.bus.emit(f.scene, { emitterKey: signal.emitterKey, signalId: signal.id, parameters: { amount: 4 } });
  assert.equal(result.status, "done"); assert.equal(result.results.length, 1);
  assert.equal(f.data.objectVariableValues.values["Token:npc"].counter, 4);
});
