import test from "node:test";
import assert from "node:assert/strict";
import { ObjectCommandLights, COMMAND_LIGHT_FLAG } from "../dmicher-master-screen/scripts/object-command-lights.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";

function fixture() {
  let serial = 0;
  const writes = [], scene = { id: "scene", uuid: "Scene.scene", grid: { size: 100, distance: 5 }, tokens: new Map(), lights: new Map() };
  const object = { id: "npc", uuid: "Scene.scene.Token.npc", documentName: "Token", parent: scene, x: 0, y: 0, width: 1, height: 1, elevation: 3 };
  scene.tokens.set(object.id, object);
  const light = data => ({ id: `light${++serial}`, parent: scene, documentName: "AmbientLight", ...structuredClone(data),
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }, async update(changes) { writes.push({ update: this.id, changes }); Object.assign(this, changes); } });
  scene.createEmbeddedDocuments = async (type, values) => {
    writes.push({ create: type }); return values.map(data => { const item = light(data); scene.lights.set(item.id, item); return item; });
  };
  scene.updateEmbeddedDocuments = async (type, values) => { writes.push({ updateMany: type, values }); for (const value of values) Object.assign(scene.lights.get(value._id), value); };
  scene.deleteEmbeddedDocuments = async (type, ids) => { writes.push({ delete: type, ids }); for (const id of ids) scene.lights.delete(id); };
  const foreign = light({ x: 1, y: 2, config: { bright: 100 } }); scene.lights.set(foreign.id, foreign);
  const controller = new ObjectCommandLights({ authority: () => true }); controller.reindex(scene);
  return { scene, object, controller, foreign, writes, light };
}

test("light on/off creates and deletes only the command-owned ambient source", async () => {
  const f = fixture();
  await f.controller.on(f.scene, f.object, { bright: 10, dim: 0 });
  const own = [...f.scene.lights.values()].find(light => light !== f.foreign);
  assert.deepEqual(own.getFlag(MODULE_ID, COMMAND_LIGHT_FLAG), { version: 1, targetUuid: f.object.uuid });
  assert.deepEqual([own.x, own.y, own.elevation], [50, 50, 3]);
  await f.controller.on(f.scene, f.object, { bright: 2, dim: 5 });
  assert.equal(f.scene.lights.size, 2);
  assert.equal(f.writes.filter(write => write.create).length, 1);
  await f.controller.off(f.scene, f.object);
  assert.equal(f.scene.lights.size, 1);
  assert.equal(f.scene.lights.get(f.foreign.id), f.foreign);
});

test("native updates move only cached owned lights, skip unchanged positions, and recover cache on reindex", async () => {
  const f = fixture();
  await f.controller.on(f.scene, f.object, { bright: 10, dim: 20 });
  const own = [...f.scene.lights.values()].find(light => light !== f.foreign);
  const restarted = new ObjectCommandLights({ authority: () => true }); restarted.reindex(f.scene);
  await restarted.updateObject(f.object);
  assert.equal(f.writes.filter(write => write.updateMany).length, 0);
  f.object._source = { x: 100, y: 200, width: 1, height: 1, elevation: 6 };
  await restarted.updateObject(f.object);
  assert.deepEqual([own.x, own.y, own.elevation], [150, 250, 6]);
  assert.deepEqual([f.foreign.x, f.foreign.y], [1, 2]);
  const unrelated = { ...f.object, id: "other", uuid: "Scene.scene.Token.other" };
  await restarted.updateObject(unrelated);
  assert.equal(f.writes.filter(write => write.updateMany).length, 1);
});

test("odd grid and fractional footprint round to native AmbientLight coordinates without repeated writes", async () => {
  const f = fixture(); f.scene.grid.size = 101; f.object.width = 0.5;
  await f.controller.on(f.scene, f.object, { bright: 10, dim: 20 });
  const own = [...f.scene.lights.values()].find(light => light !== f.foreign);
  assert.equal(own.x, 25); assert.equal(own.y, 51);
  await f.controller.updateObject(f.object);
  assert.equal(f.writes.filter(write => write.updateMany).length, 0);
});

test("Foundry 14 token level maps to AmbientLight levels and follows a native level change", async () => {
  const f = fixture(); f.object.level = "ground";
  await f.controller.on(f.scene, f.object, { bright: 10, dim: 20 });
  const own = [...f.scene.lights.values()].find(light => light !== f.foreign);
  assert.deepEqual(own.levels, ["ground"]); assert.equal(own.level, undefined);
  await f.controller.updateObject(f.object);
  assert.equal(f.writes.filter(write => write.updateMany).length, 0);
  f.object.level = "upper";
  await f.controller.updateObject(f.object);
  assert.deepEqual(own.levels, ["upper"]);
  await f.controller.updateObject(f.object);
  assert.equal(f.writes.filter(write => write.updateMany).length, 1);
});

test("deleting an owner removes its sources, but manually removing ownership makes a light untouchable", async () => {
  const f = fixture();
  await f.controller.on(f.scene, f.object, { bright: 10, dim: 20 });
  const own = [...f.scene.lights.values()].find(light => light !== f.foreign);
  delete own.flags[MODULE_ID][COMMAND_LIGHT_FLAG];
  await f.controller.deleteObject(f.object);
  assert.equal(f.scene.lights.size, 2);
  await f.controller.on(f.scene, f.object, { bright: 10, dim: 20 });
  assert.equal(f.scene.lights.size, 3);
  f.scene.tokens.delete(f.object.id);
  await f.controller.deleteObject(f.object);
  assert.equal(f.scene.lights.size, 2);
  assert.ok(f.scene.lights.has(own.id));
});

test("non-authority and cancelled requests cannot write lights", async () => {
  const f = fixture(), observer = new ObjectCommandLights({ authority: () => false });
  await observer.on(f.scene, f.object, { bright: 10, dim: 20 });
  await f.controller.on(f.scene, f.object, { bright: 10, dim: 20 }, { isCurrent: () => false });
  assert.equal(f.writes.length, 0);
});

test("cancellation during native creation compensates only the newly created owned source", async () => {
  const f = fixture(); let release;
  const create = f.scene.createEmbeddedDocuments;
  f.scene.createEmbeddedDocuments = async (...args) => { await new Promise(resolve => { release = resolve; }); return create(...args); };
  const abort = new AbortController(), pending = f.controller.on(f.scene, f.object, { bright: 10, dim: 20 }, { signal: abort.signal });
  abort.abort(); release(); await pending;
  assert.deepEqual([...f.scene.lights.keys()], [f.foreign.id]);
  assert.equal(f.controller.targets.size, 0);
});
