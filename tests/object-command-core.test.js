import test from "node:test";
import assert from "node:assert/strict";
import { ObjectCommandCore } from "../dmicher-master-screen/scripts/object-command-core.js";
import { normalizeObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";
import { advanceCommandMovement } from "../dmicher-master-screen/scripts/object-command-movement.js";

function fixture() {
  const scene = { id: "scene", uuid: "Scene.scene", grid: { size: 100, distance: 5 }, tokens: new Map(), walls: new Map() };
  const updates = [];
  const token = (id, x) => {
    const source = { x, y: 0, width: 1, height: 1, rotation: 0 };
    const document = { id, uuid: `Scene.scene.Token.${id}`, documentName: "Token", parent: scene, ...source, _source: { ...source },
      object: { checkCollision: () => false }, async update(changes, options) { updates.push({ changes, options }); Object.assign(this, changes); Object.assign(this._source, changes); } };
    scene.tokens.set(id, document); return document;
  };
  const npc = token("npc", 0), pc = token("pc", 500), core = new ObjectCommandCore();
  const run = (id, parameters = {}, input = {}) => ({ config: normalizeObjectCommand({ id, parameters }), request: { actorTokenUuid: pc.uuid, parameters: input } });
  globalThis.CONFIG = {}; globalThis.CONST = { WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 } };
  return { scene, npc, pc, core, run, updates };
}

test("come stops on footprint contact or its finite time limit, while away keeps the opposite direction", async () => {
  const f = fixture(), come = f.run("come", { speed: 5, duration: 10 });
  assert.equal((await f.core.tick(f.scene, come, f.npc, 10)).done, true);
  assert.equal(f.npc._source.x, 400);
  Object.assign(f.npc._source, { x: 0 }); f.npc.x = 0;
  const limited = f.run("come", { speed: 5, duration: 1 });
  assert.equal((await f.core.tick(f.scene, limited, f.npc, 5)).done, true);
  assert.equal(f.npc._source.x, 100, "movement spends only its remaining duration");
  const away = f.run("away", { speed: 5, duration: 2 });
  assert.equal((await f.core.tick(f.scene, away, f.npc, 1)).done, false);
  assert.equal(f.npc._source.x, 0);
  f.pc._source.x = -500;
  assert.equal((await f.core.tick(f.scene, away, f.npc, 1)).done, true);
  assert.equal(f.npc._source.x, -100, "an away command does not turn into pursuit if the issuer moves");
});

test("go ends with its configured wait using the same tick budget", async () => {
  const f = fixture(), run = f.run("go", { speed: 5, duration: 10, waitSeconds: 2 }, { point: { x: 150, y: 50 } });
  assert.equal((await f.core.tick(f.scene, run, f.npc, 1.5)).done, false);
  assert.equal(f.npc.x, 100);
  assert.equal(run.core.stage, "wait");
  assert.equal(run.core.waitRemaining, 1.5);
  assert.equal((await f.core.tick(f.scene, run, f.npc, 1.5)).done, true);
  assert.equal(f.updates.length, 1);
});

test("a footprint corner collision stops go without allowing the clear centre ray through", async () => {
  const f = fixture();
  f.npc.object.checkCollision = (point, { origin }) => origin.y < 10 && point.x >= 150;
  const run = f.run("go", { waitSeconds: 1 }, { point: { x: 450, y: 50 } });
  await f.core.tick(f.scene, run, f.npc, 1);
  assert.equal(run.core.stage, "wait");
  assert.ok(f.npc._source.x < 102);
  assert.ok(f.npc._source.x > 0);
});

test("wait and cancel use elapsed engine time and do not move or create timers", async () => {
  const f = fixture();
  for (const id of ["wait", "cancel"]) {
    const run = f.run(id, id === "wait" ? { seconds: 0.5 } : { waitSeconds: 0.5 });
    assert.equal((await f.core.tick(f.scene, run, f.npc, 0.2)).done, false);
    assert.equal((await f.core.tick(f.scene, run, f.npc, 0.3)).done, true);
  }
  assert.equal(f.updates.length, 0);
});

test("patrol switches endpoints, and follow remains active after reaching its spacing", async () => {
  const f = fixture(), patrol = f.run("patrol", {}, { points: [{ x: 150, y: 50 }, { x: 250, y: 50 }] });
  assert.equal((await f.core.tick(f.scene, patrol, f.npc, 1)).done, false);
  assert.equal(patrol.core.pointIndex, 1);
  await f.core.tick(f.scene, patrol, f.npc, 1);
  assert.equal(patrol.core.pointIndex, 0);
  await f.core.tick(f.scene, patrol, f.npc, 1);
  assert.equal(f.npc.x, 100);
  const follow = f.run("follow", { minDistance: 0, maxDistance: 1 });
  assert.equal((await f.core.tick(f.scene, follow, f.npc, 10)).done, false);
  assert.equal(f.npc.x, 400);
  f.pc._source.x = 700;
  assert.equal((await f.core.tick(f.scene, follow, f.npc, 1)).done, false);
  assert.equal(f.npc.x, 500);
});

test("door operations approach a segment, respect locks, and do not open unreachable doors", async () => {
  const f = fixture(), door = { id: "door", uuid: "Scene.scene.Wall.door", documentName: "Wall", parent: f.scene,
    c: [300, -1000, 300, 200], door: 1, ds: 0, async update(changes) { Object.assign(this, changes); } };
  f.scene.walls.set(door.id, door);
  f.scene.getFlag = () => ({ bindings: { "Wall:door": { commands: [{ id: "open", enabled: true, conditions: { range: 5 } }] } } });
  const run = f.run("delegate", { speed: 5 }, { targetUuid: door.uuid, commandId: "open" });
  let delivered = 0;
  const delivery = { delegate: async (_run, input) => { delivered++; return f.core.tick(f.scene, f.run(input.commandId), door, 0); } };
  assert.equal((await f.core.tick(f.scene, run, f.npc, 1, delivery)).done, false);
  assert.equal(door.ds, 0); assert.equal(delivered, 0, "travel does not open the door or deliver early");
  assert.equal((await f.core.tick(f.scene, run, f.npc, 1, delivery)).done, true);
  assert.equal(door.ds, 1);
  assert.equal(f.npc.x, 200);
  assert.equal(f.npc.y, 0, "approach uses the nearest segment point instead of the door midpoint");
  door.ds = 2;
  await assert.rejects(f.core.tick(f.scene, f.run("close"), door, 1), error => error.code === "locked");
  door.ds = 0; f.npc._source.x = 0; f.npc.x = 0;
  f.npc.object.checkCollision = point => point.x >= 150;
  await assert.rejects(f.core.tick(f.scene, f.run("delegate", {}, { targetUuid: door.uuid, commandId: "open" }), f.npc, 5, delivery), error => error.code === "delegation-path");
  assert.equal(door.ds, 0);
});

test("cancelled core never admits late movement progress or a following door write", async () => {
  const f = fixture(), run = f.run("come"), abort = new AbortController();
  let release;
  f.npc.update = () => new Promise(resolve => { release = resolve; });
  const pending = f.core.tick(f.scene, run, f.npc, 1, { signal: abort.signal });
  abort.abort(); release();
  assert.equal((await pending).done, false);
  assert.equal(run.core.remaining, 10);
  assert.equal((await f.core.tick(f.scene, f.run("wait"), f.npc, 100, { signal: abort.signal })).done, false);
});

test("fractional movement accumulates native-pixel budget and ignores animation-frame coordinates", async () => {
  const f = fixture(), progress = {};
  for (let index = 0; index < 20; index++) {
    f.npc.x = -1000;
    await advanceCommandMovement(f.scene, f.npc, { x: 100, y: 50 }, 0.1, 0.1, { progress });
  }
  assert.equal(f.npc._source.x, 4);
  assert.equal(f.updates.length, 4);
});

test("light commands delegate ownership and cancellation to their dedicated controller", async () => {
  const f = fixture(), calls = [], lights = { on: async (...args) => calls.push(["on", ...args]), off: async (...args) => calls.push(["off", ...args]) };
  const core = new ObjectCommandCore({ lights });
  assert.equal((await core.tick(f.scene, f.run("light-on"), f.npc, 0)).done, true);
  assert.equal((await core.tick(f.scene, f.run("light-off"), f.npc, 0)).done, true);
  assert.deepEqual(calls.map(call => call[0]), ["on", "off"]);
  assert.equal((await core.tick(f.scene, f.run("light-on"), f.npc, 0, { isCurrent: () => false })).done, false);
  assert.equal(calls.length, 2);
});
