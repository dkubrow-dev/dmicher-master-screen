import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, defaultDefinition, normalizeDefinition, normalizeConditions, getState, emptyRuntime, normalizeRuntime } from "../dmicher-master-screen/scripts/model.js";
import { getDefinition, getDefinitions, getRuntime, saveDefinition, saveRuntime, withSceneLock, isAuthority, getObjectTags, saveObjectTags } from "../dmicher-master-screen/scripts/store.js";

const copy = (value) => structuredClone(value);
function world() {
  const users = new Map([["a", { id: "a", isGM: true, role: 4, active: true }], ["b", { id: "b", isGM: true, role: 4, active: true }]]);
  globalThis.game = { user: users.get("a"), users };
  return (id = "scene") => ({ id, flags: { [MODULE_ID]: {} }, writes: [],
    getFlag(scope, key) { return copy(this.flags[scope]?.[key]); },
    async setFlag(scope, key, value) {
      this.writes.push({ scope, key, value: copy(value) });
      let target = this.flags[scope] ??= {};
      const parts = key.split(".");
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = copy(value);
    }
  });
}

test("current definitions require an explicit entry and ignore removed event routing fields", () => {
  const definition = defaultDefinition();
  definition.states[1].events = ["alarm.started"];
  assert.equal(normalizeDefinition(definition).entryStateId, "calm");
  definition.states[2].events = ["alarm.started"];
  assert.equal(normalizeDefinition(definition).states[1].events, undefined);
  delete definition.entryStateId;
  assert.throws(() => normalizeDefinition(definition));
  assert.throws(() => normalizeDefinition({ ...defaultDefinition(), states: [] }));
});

test("scene readers never adopt singular definitions, runtime or separate tag flags", () => {
  const scene = world()();
  scene.flags[MODULE_ID] = { definition: defaultDefinition(), runtime: { ...emptyRuntime(), runId: "old" }, objectTags: { Token: { npc: ["old"] } } };
  const before = copy(scene.flags);
  assert.deepEqual(getDefinitions(scene), []); assert.equal(getRuntime(scene).runId, ""); assert.deepEqual(getObjectTags(scene), {});
  assert.deepEqual(scene.flags, before); assert.equal(scene.writes.length, 0);
});

test("current state preparation preserves zones, direct actions, alarm, spawn and workspace", () => {
  const definition = defaultDefinition(), state = definition.states[0];
  state.pause = true; state.sound = "alarm.ogg";
  state.zones = [{ id: "zone", x: 0, y: 0, width: 10, height: 20, signalId: "zone-entered" }];
  state.interactions = [{ id: "door", target: { type: "Tile", id: "tile" }, signalId: "door-open" }];
  state.spawns = [{ id: "guards", actorUuid: "Actor.guard", x: 0, y: 0, count: 2 }];
  state.workspace.gm = [{ uuid: "JournalEntry.notes", x: 0, y: 0, width: 500, height: 400 }];
  const result = normalizeDefinition(definition).states[0];
  assert.equal(result.pause, true); assert.equal(result.sound, "alarm.ogg"); assert.equal(result.spawns[0].count, 2);
  assert.equal(result.interactions[0].target.type, "Tile"); assert.equal(result.workspace.gm[0].uuid, "JournalEntry.notes");
  assert.equal(result.zones[0].signalId, "zone-entered");
  assert.equal(result.tokens, undefined); assert.equal(result.dialogues, undefined); assert.equal(result.subscriptions, undefined);
  assert.deepEqual(normalizeConditions(), { enabled: true, groupIds: [], stateIds: [], allowTags: [], denyTags: [], repeat: "limited", limit: 1, resetOnEntry: true });
});

test("runtime snapshot writes remove absent nested facts only inside the selected group", async () => {
  const scene = world()();
  scene.flags[MODULE_ID] = { groupDefinitions: { main: defaultDefinition() }, groupRuntimes: { other: { untouched: true } }, external: { untouched: true } };
  const merge = (target, patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (key.startsWith("-=")) { delete target[key.slice(2)]; continue; }
      if (value && typeof value === "object" && !Array.isArray(value)) { target[key] ??= {}; merge(target[key], value); }
      else target[key] = copy(value);
    }
  };
  scene.setFlag = async (scope, key, patch) => { let parent = scene.flags[scope]; const parts = key.split(".");
    for (const part of parts.slice(0, -1)) parent = parent[part] ??= {};
    merge(parent[parts.at(-1)] ??= {}, patch);
  };
  await saveRuntime(scene, { ...emptyRuntime(), effects: { completed: true }, dialogueSessions: { gone: { state: "open" } }, scriptStates: { npc: { stepId: 1, remainingMs: 0, nextAt: 40 } } });
  await saveRuntime(scene, { ...emptyRuntime(), scriptStates: { npc: { stepId: 2 } } });
  const state = getRuntime(scene);
  assert.deepEqual(state.effects, {}); assert.deepEqual(state.dialogueSessions, {}); assert.deepEqual(state.scriptStates.npc, { stepId: 2 });
  assert.deepEqual(scene.flags[MODULE_ID].groupRuntimes.other, { untouched: true }); assert.deepEqual(scene.flags[MODULE_ID].external, { untouched: true });
});






test("invalid schemas and duplicate state IDs are rejected before use", () => {
  assert.throws(() => normalizeDefinition({ ...defaultDefinition(), schemaVersion: 2 }));
  assert.equal(normalizeDefinition({ ...defaultDefinition(), groupId: "another" }).groupId, "another");
  const definition = defaultDefinition();
  definition.states[1].id = definition.states[0].id;
  assert.throws(() => normalizeDefinition(definition));
  assert.throws(() => normalizeRuntime({ schemaVersion: 2 }));
  assert.equal(normalizeRuntime({ ...emptyRuntime(), groupId: "another" }).groupId, "another");
});



test("runtime snapshots clone nested mutable values and deduplicate manual disabled tokens", () => {
  const source = { ...emptyRuntime(), disabledObjects: ["npc", "npc"], shops: { npc: { items: [{ stock: 1 }] } } };
  const result = normalizeRuntime(source);
  result.shops.npc.items[0].stock = 0;
  assert.equal(source.shops.npc.items[0].stock, 1);
  assert.deepEqual(result.disabledObjects, ["npc"]);
  assert.equal(result.groupId, "main");
});

test("definitions and runs are stored under Scene plus group without overwriting unrelated scopes", async () => {
  const makeScene = world(), first = makeScene("a"), second = makeScene("b");
  first.flags[MODULE_ID] = { groupDefinitions: { future: { marker: "keep" } }, groupRuntimes: { future: { marker: "also-keep" } } };
  const definition = defaultDefinition(); definition.groupName = "Market";
  await saveDefinition(first, definition, { expectedRevision: 0 });
  await saveRuntime(first, { ...emptyRuntime(), runId: "run-a" });
  assert.equal(first.writes[0].key, "groupDefinitions.main");
  assert.equal(first.writes[1].key, "groupRuntimes.main");
  assert.equal(first.flags[MODULE_ID].groupDefinitions.future.marker, "keep");
  assert.equal(first.flags[MODULE_ID].groupRuntimes.future.marker, "also-keep");
  assert.equal(getDefinition(first).groupName, "Market");
  assert.equal(getRuntime(first).runId, "run-a");
  assert.equal(getRuntime(second).runId, "");
  assert.throws(() => getRuntime(first, { groupId: "future" }));
});

test("optimistic definition revisions refuse stale writes and return detached snapshots", async () => {
  const scene = world()();
  await saveDefinition(scene, defaultDefinition(), { expectedRevision: 0 });
  const first = getDefinition(scene);
  first.states[0].name = "Unwritten";
  assert.notEqual(getDefinition(scene).states[0].name, "Unwritten");
  await assert.rejects(saveDefinition(scene, first, { expectedRevision: 0 }));
  assert.equal(scene.writes.length, 1);
  await saveDefinition(scene, first, { expectedRevision: 1 });
  assert.equal(getDefinition(scene).revision, 2);
});

test("scene queues serialize conflicting operations but independent scenes do not wait", async () => {
  const makeScene = world(), a = makeScene("a"), b = makeScene("b"), order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = withSceneLock(a, async () => { order.push("first-start"); await gate; order.push("first-end"); });
  const second = withSceneLock(a, async () => { order.push("second"); });
  await withSceneLock(b, async () => { order.push("independent"); });
  assert.deepEqual(order, ["first-start", "independent"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "independent", "first-end", "second"]);
  await assert.rejects(withSceneLock(a, () => { throw new Error("failure"); }));
  assert.equal(await withSceneLock(a, () => "next"), "next");
});

test("runtime writes require elected full GM; definition writes require current GM", async () => {
  const scene = world()();
  assert.equal(isAuthority(), true);
  game.user = game.users.get("b");
  assert.equal(isAuthority(), false);
  await assert.rejects(saveRuntime(scene, emptyRuntime()));
  game.user = { id: "player", role: 1, active: true, isGM: false };
  await assert.rejects(saveDefinition(scene, defaultDefinition()));
  assert.equal(scene.writes.length, 0);
});





test("scene object tags are normalized independently of state definitions and require a GM", async () => {
  const scene = world()();
  scene.tokens = new Map([["hero", {}], ["guard", {}]]); scene.tiles = new Map([["door", {}]]);
  await saveObjectTags(scene, { type: "Token", id: "hero" }, [" Hero ", "hero", "invited"]);
  await saveObjectTags(scene, { type: "Tile", id: "door" }, "Door, locked");
  assert.deepEqual(getObjectTags(scene, { type: "Token", id: "hero" }), ["hero", "invited"]);
  assert.deepEqual(getObjectTags(scene, { type: "Tile", id: "door" }), ["door", "locked"]);
  assert.throws(() => getDefinition(scene));
  await assert.rejects(saveObjectTags(scene, { type: "Token", id: "absent" }, ["hero"]));
  game.user = { isGM: false };
  await assert.rejects(saveObjectTags(scene, { type: "Token", id: "hero" }, ["forged"]));
  assert.deepEqual(getObjectTags(scene, { type: "Token", id: "hero" }), ["hero", "invited"]);
});
