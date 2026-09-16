import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
import { defaultObjectCommand, commandDefinitionsFor, normalizeObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";
import { validateCommandAccess, availableObjectCommands } from "../dmicher-master-screen/scripts/object-command-access.js";
import { ObjectCommandService } from "../dmicher-master-screen/scripts/object-command-service.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { SCENE_OBJECT_COLLECTIONS } from "../dmicher-master-screen/scripts/scene-object-types.js";
import { isSceneObjectHidden } from "../dmicher-master-screen/scripts/scene-object-geometry.js";
import { scriptPresentationIsCurrent, requestHalt, finishHalt } from "../dmicher-master-screen/scripts/execution.js";

function add(f, type, ids, values = {}) {
  const collection = f.scene[SCENE_OBJECT_COLLECTIONS[type]] ??= new Map(), id = `native-${type}`;
  const document = { id, name: id, documentName: type, uuid: `Scene.scene.${type}.${id}`, parent: f.scene, x: 100, y: 0, hidden: false, object: {},
    ...values, async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key.startsWith(`flags.${MODULE_ID}.`)) { this.flags ??= {}; this.flags[MODULE_ID] ??= {}; this.flags[MODULE_ID][key.slice(`flags.${MODULE_ID}.`.length)] = value; }
        else this[key] = value;
      }
    }, async delete() { collection.delete(id); } };
  collection.set(id, document);
  f.flags.objectBindings.bindings[`${type}:${id}`] = { type, id, groupId: null, commands: ids.map(id => ({ ...defaultObjectCommand(id), enabled: true })) };
  return document;
}
const packet = (f, document, commandId, parameters = {}, method = "player") => ({ ...f.packet(commandId, parameters), targetUuid: document.uuid, method });
async function finish(f, target, { limit = 15 } = {}) {
  for (let n = 0; n < limit && f.executor.activeForObject(f.scene, { type: target.documentName, id: target.id }); n++) { await f.tick(); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(f.executor.activeForObject(f.scene, { type: target.documentName, id: target.id }), null);
}

test("command matrices include only the requested native capabilities and remain disabled until configured", () => {
  assert.ok(commandDefinitionsFor("Token").some(value => value.id === "delegate"));
  assert.equal(commandDefinitionsFor("Token").some(value => value.id === "open-door" || value.id === "delete"), false);
  for (const type of ["Tile", "Drawing", "Wall", "AmbientLight", "AmbientSound", "Region", "Note"]) {
    assert.ok(commandDefinitionsFor(type).some(value => value.id === "delete"));
    for (const { id } of commandDefinitionsFor(type)) assert.equal(defaultObjectCommand(id).enabled, false);
  }
  assert.equal(commandDefinitionsFor("Tile").some(value => value.id === "come"), false);
  assert.equal(commandDefinitionsFor("Drawing").some(value => value.id === "follow"), true);
  assert.throws(() => normalizeObjectCommand({ id: "open", permissions: { player: "yes" } }));
});

test("an ungrouped wall accepts an allowed player command without creating a group or fake actor", async () => {
  const f = await commandFixture(), wall = add(f, "Wall", ["open", "close"], { c: [100, 0, 100, 100], door: 1, ds: 0 });
  try {
    const groups = Object.keys(f.flags.groupDefinitions);
    await f.executor.accept(f.scene, packet(f, wall, "open"), f.player); await finish(f, wall); assert.equal(wall.ds, 1);
    assert.deepEqual(Object.keys(f.flags.groupDefinitions), groups);
    await f.executor.accept(f.scene, packet(f, wall, "close"), f.player); await finish(f, wall); assert.equal(wall.ds, 0);
    wall.ds = 2; await assert.rejects(f.executor.accept(f.scene, packet(f, wall, "open"), f.player), error => error.code === "locked");
    assert.equal(f.errors.length, 0);
  } finally { f.runtime.dispose(); }
});

test("GM direct commands need no selected actor; permissions cannot be forged by a player", async () => {
  const f = await commandFixture(), tile = add(f, "Tile", ["invisible", "visible"], { width: 50, height: 50 });
  try {
    const command = f.flags.objectBindings.bindings[`Tile:${tile.id}`].commands[0]; command.permissions = { gm: true, player: false, delegated: false };
    assert.throws(() => validateCommandAccess(f.scene, packet(f, tile, "invisible"), f.player), error => error.code === "issuer");
    assert.throws(() => validateCommandAccess(f.scene, packet(f, tile, "invisible", {}, "gm"), f.player), error => error.code === "issuer");
    assert.equal(availableObjectCommands(f.scene, { type: "Tile", id: tile.id }, null, f.gm).find(value => value.id === "invisible").gmOnly, true);
    await f.executor.accept(f.scene, { ...packet(f, tile, "invisible", {}, "gm"), actorTokenUuid: "" }, f.gm); await finish(f, tile); assert.equal(tile.hidden, true);
    await f.executor.accept(f.scene, { ...packet(f, tile, "visible", {}, "gm"), actorTokenUuid: "" }, f.gm); await finish(f, tile); assert.equal(tile.hidden, false);
  } finally { f.runtime.dispose(); }
});

test("ungrouped signal/behavior switches stay independent from another group's halt", async () => {
  const f = await commandFixture(), region = add(f, "Region", ["signals-off", "signals-on", "behavior-off", "behavior-on"], { shapes: [{ x: 100, y: 0, width: 50, height: 50 }] });
  try {
    for (const command of ["signals-off", "behavior-off"]) { await f.executor.accept(f.scene, packet(f, region, command), f.player); await finish(f, region); }
    assert.equal(f.flags.objectSignalState[`Region:${region.id}`], false); assert.equal(f.flags.objectBehaviorState[`Region:${region.id}`], false);
    const generation = requestHalt(f.scene, "main");
    assert.doesNotThrow(() => validateCommandAccess(f.scene, packet(f, region, "behavior-on"), f.player)); finishHalt(f.scene, generation, "main");
    await f.executor.accept(f.scene, packet(f, region, "behavior-on"), f.player); await finish(f, region);
    assert.equal(f.flags.objectBehaviorState[`Region:${region.id}`], undefined);
    await f.executor.accept(f.scene, packet(f, region, "signals-on"), f.player); await finish(f, region);
    assert.equal(f.flags.objectSignalState[`Region:${region.id}`], undefined);
  } finally { f.runtime.dispose(); }
});

test("native light/sound commands toggle sources and a hidden note retains journal visibility protection", async () => {
  const f = await commandFixture();
  try {
    for (const type of ["AmbientLight", "AmbientSound"]) {
      const doc = add(f, type, ["source-off", "source-on"]);
      await f.executor.accept(f.scene, packet(f, doc, "source-off"), f.player); await finish(f, doc); assert.equal(doc.hidden, true);
      await f.executor.accept(f.scene, packet(f, doc, "source-on", {}, "gm"), f.gm); await finish(f, doc); assert.equal(doc.hidden, false);
    }
    const note = add(f, "Note", ["invisible", "visible"]);
    await f.executor.accept(f.scene, packet(f, note, "invisible"), f.player); await finish(f, note); assert.equal(isSceneObjectHidden(note), true);
    await f.executor.accept(f.scene, packet(f, note, "visible", {}, "gm"), f.gm); await finish(f, note); assert.equal(isSceneObjectHidden(note), false);
  } finally { f.runtime.dispose(); }
});

test("ungrouped command phase delivery has a scene lease and stops on the next full halt", async () => {
  const f = await commandFixture(), tile = add(f, "Tile", ["signals-off"]);
  try {
    const result = await f.executor.accept(f.scene, packet(f, tile, "signals-off"), f.player);
    const scope = { runId: result.runId, target: { type: "Tile", id: tile.id }, manual: false };
    assert.equal(scriptPresentationIsCurrent(f.scene, scope), true);
    await f.runtime.haltAll(f.scene); assert.equal(scriptPresentationIsCurrent(f.scene, scope), false);
  } finally { f.runtime.dispose(); }
});

test("delegation approaches another object then issues its allowed command with its patron retained", async () => {
  const f = await commandFixture({ commands: ["delegate"] }), light = add(f, "AmbientLight", ["source-off"], { x: 300 });
  const service = new ObjectCommandService({ executor: f.executor, signals: f.executor.signals, chat: {} });
  const provenance=[];
  f.runtime.objectEvents={async withInitiator(document,origin,operation){if(document === light) provenance.push(origin);return operation();}};
  try {
    const accepted = await service.execute({ ...packet(f, light, "source-off", {}, "delegated"), delegateTokenUuid: f.npc.uuid }, f.player);
    assert.equal(accepted.ok, true); assert.equal(f.active().config.id, "delegate");
    await finish(f, f.npc, { limit: 90 }); await finish(f, light);
    assert.equal(light.hidden, true); assert.ok(f.npc.x > 0);
    const started = f.signals.find(value => value.name === "commandStarted" && value.emitterKey === `AmbientLight:${light.id}`);
    assert.equal(started.parameters.playerTokenUuid, f.npc.uuid); assert.equal(started.parameters.patronUuid, f.pc.uuid);
    assert.ok(started.parameters.startedAt > 0);
    assert.deepEqual(provenance,[{userId:f.player.id,patronUuid:f.pc.uuid}]);
  } finally { service.dispose(); f.runtime.dispose(); }
});

test("initial restoration clears addressed standalone behavior overrides and preserves unrelated objects",async()=>{
  const f=await commandFixture(),tile=add(f,"Tile",["behavior-off"]),region=add(f,"Region",["behavior-off"]);
  try {
    f.flags.objectBindings.bindings[`Tile:${tile.id}`].initialScript={enabled:true,steps:[]};
    f.flags.objectBehaviorState={[`Tile:${tile.id}`]:false,[`Region:${region.id}`]:false};
    await f.runtime.restoreInitial(f.scene,{type:"Tile",id:tile.id});
    assert.equal(f.flags.objectBehaviorState[`Tile:${tile.id}`],undefined);assert.equal(f.flags.objectBehaviorState[`Region:${region.id}`],false);
    await f.runtime.restoreAllInitial(f.scene);assert.deepEqual(f.flags.objectBehaviorState,{});
  } finally {f.runtime.dispose();}
});

test("script-issued commands have trusted parameters and recheck the source execution before admission", async () => {
  const f = await commandFixture({ commands: ["wait"] }), service = new ObjectCommandService({ executor: f.executor, chat: {} });
  try {
    await service.invokeFromScript({ scene: f.scene, target: f.npc, commander: f.npc, commandId: "wait", parameters: { seconds: 0.2 }, context: { isCurrent: () => true } });
    assert.equal(f.active().config.parameters.seconds, 0.2); await finish(f, f.npc);
    await service.invokeFromScript({ scene: f.scene, target: f.npc, commander: f.npc, commandId: "wait", parameters: {}, context: { isCurrent: () => false } });
    assert.equal(f.active(), null);
  } finally { service.dispose(); f.runtime.dispose(); }
});

test("Delete waits for the trailing script, and cancelling that script preserves the document", async () => {
  for (const cancel of [false, true]) {
    const f = await commandFixture(), tile = add(f, "Tile", ["delete"], { width: 50, height: 50 });
    const command = f.flags.objectBindings.bindings[`Tile:${tile.id}`].commands[0];
    command.afterScript = { enabled: true, steps: [{ id: 1, kind: "wait", parameters: { seconds: 1 }, next: [] }] };
    try {
      await f.executor.accept(f.scene, packet(f, tile, "delete"), f.player);
      for (let n = 0; n < 5; n++) await f.tick();
      assert.equal(f.scene.tiles.has(tile.id), true, "the after script still owns an existing document");
      if (cancel) { await f.runtime.haltAll(f.scene); await f.tick(1500); assert.equal(f.scene.tiles.has(tile.id), true); }
      else { await finish(f, tile, { limit: 25 }); assert.equal(f.scene.tiles.has(tile.id), false); }
    } finally { f.runtime.dispose(); }
  }
});

test("delegation cannot bypass disabled intermediary permissions or endpoint permissions", async () => {
  const f = await commandFixture({ commands: ["delegate"] }), light = add(f, "AmbientLight", ["source-off"]);
  const service = new ObjectCommandService({ executor: f.executor, chat: {} });
  const originalWarn = console.warn; console.warn = () => {};
  try {
    f.flags.objectBindings.bindings[`AmbientLight:${light.id}`].commands[0].permissions = { gm: true, player: true, delegated: false };
    let response = await service.execute({ ...packet(f, light, "source-off", {}, "delegated"), delegateTokenUuid: f.npc.uuid }, f.player);
    assert.equal(response.ok, false); assert.equal(f.active(), null);
    f.flags.objectBindings.bindings[`AmbientLight:${light.id}`].commands[0].permissions.delegated = true;
    f.flags.objectBindings.bindings["Token:npc"].commands[0].permissions.player = false;
    response = await service.execute({ ...packet(f, light, "source-off", {}, "delegated"), delegateTokenUuid: f.npc.uuid }, f.player);
    assert.equal(response.ok, false); assert.equal(f.active(), null); assert.equal(light.hidden, false);
  } finally { console.warn = originalWarn; service.dispose(); f.runtime.dispose(); }
});
