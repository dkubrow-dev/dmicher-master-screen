import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, defaultDefinition, defaultTokenBehavior, normalizeDefinition, normalizeTokenBehavior,
  getEpisode, canTransition, parseTransitions, transitionsText, emptyRuntime, normalizeRuntime, normalizeDialogue } from "../dmicher-master-screen/scripts/model.js";
import { getDefinition, getRuntime, saveDefinition, saveRuntime, withSceneLock, isAuthority, getObjectTags, saveObjectTags } from "../dmicher-master-screen/scripts/store.js";

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

test("default scene has one explicit main scheme, four episodes and all-to-all transitions", () => {
  const definition = defaultDefinition();
  assert.equal(definition.schemeId, "main");
  assert.deepEqual(definition.episodes.map((episode) => episode.id), ["calm", "tension", "alarm", "stop"]);
  for (const from of definition.episodes) for (const to of definition.episodes) assert.equal(canTransition(definition, from.id, to.id), true);
  assert.equal(getEpisode(definition, "stop").stop, true);
  assert.equal(canTransition(definition, "calm", "missing"), false);
  definition.episodes[0].name = "changed";
  assert.notEqual(defaultDefinition().episodes[0].name, "changed");
});

test("restricted graph admits declared incoming transitions while Stop remains reachable", () => {
  const definition = defaultDefinition();
  definition.episodes = parseTransitions("calm -> tension\ntension -> alarm", definition.episodes);
  assert.equal(canTransition(definition, "calm", "tension"), true);
  assert.equal(canTransition(definition, "alarm", "tension"), false);
  assert.equal(canTransition(definition, "alarm", "stop"), true);
  assert.equal(canTransition(definition, null, "calm"), true);
});

test("plain graph syntax supports names, IDs, wildcard and comments without mutating input", () => {
  const definition = defaultDefinition(), before = copy(definition);
  const result = parseTransitions(`# comment\n${definition.episodes[0].name} -> tension\n* -> alarm\ncalm -> *`, definition.episodes);
  assert.deepEqual(definition, before);
  assert.deepEqual(result.find((episode) => episode.id === "tension").from, ["calm"]);
  assert.equal(result.find((episode) => episode.id === "alarm").allowFromAll, true);
  assert.deepEqual(result.find((episode) => episode.id === "stop").from, ["calm"]);
});

test("graph syntax rejects missing targets, executable-looking text and ambiguous names", () => {
  const definition = defaultDefinition();
  for (const input of ["calm => alarm", "calm -> absent", "calm -> alarm -> stop", "game.togglePause(true)"])
    assert.throws(() => parseTransitions(input, definition.episodes));
  definition.episodes[0].name = "Same";
  definition.episodes[1].name = "Same";
  assert.throws(() => parseTransitions("Same -> alarm", definition.episodes));
});

test("serialized graph uses IDs and survives ambiguous display names", () => {
  const definition = defaultDefinition();
  definition.episodes[0].name = "Room -> Door";
  definition.episodes[1].name = "Room -> Door";
  const output = transitionsText(definition);
  assert.equal(output.includes("Room"), false);
  const restored = parseTransitions(output, definition.episodes);
  assert.equal(restored.every((episode) => episode.allowFromAll), true);
});

test("invalid schemas and duplicate episode IDs are rejected before use", () => {
  assert.throws(() => normalizeDefinition({ ...defaultDefinition(), schemaVersion: 2 }));
  assert.throws(() => normalizeDefinition({ ...defaultDefinition(), schemeId: "another" }));
  const definition = defaultDefinition();
  definition.episodes[1].id = definition.episodes[0].id;
  assert.throws(() => normalizeDefinition(definition));
  assert.throws(() => normalizeRuntime({ schemaVersion: 2 }));
  assert.throws(() => normalizeRuntime({ ...emptyRuntime(), schemeId: "another" }));
});

test("zone, interaction and patrol transitions reject references to deleted episodes", () => {
  for (const change of [
    (episode) => { episode.zones.push({ id: "zone", targetEpisodeId: "absent" }); },
    (episode) => { episode.tokens.npc = defaultTokenBehavior(); episode.tokens.npc.interaction.targetEpisodeId = "absent"; },
    (episode) => { episode.tokens.npc = defaultTokenBehavior(); episode.tokens.npc.patrol.points = [{ x: 0, y: 0, onTrue: "absent" }]; }
  ]) {
    const definition = defaultDefinition(); change(definition.episodes[0]);
    assert.throws(() => normalizeDefinition(definition));
  }
});

test("behavior normalization bounds speeds and clocks but retains explicit zero range and hidden policy", () => {
  const behavior = normalizeTokenBehavior({ enabled: false, hidden: false,
    speech: { interval: -1, range: 0, visibleOnly: false, phrases: ["hello"] },
    patrol: { enabled: true, speed: Infinity, points: [] }, shop: { items: [{ id: "item", stock: -4, data: { name: "Item" } }] } });
  assert.equal(behavior.speech.interval, 1);
  assert.equal(behavior.speech.range, 0);
  assert.equal(behavior.speech.visibleOnly, false);
  assert.equal(behavior.hidden, false);
  assert.equal(behavior.enabled, false);
  assert.ok(Number.isFinite(behavior.patrol.speed));
  assert.equal(behavior.shop.items[0].stock, 0);
  const first = defaultTokenBehavior(), second = defaultTokenBehavior();
  first.speech.phrases.push("isolated");
  assert.deepEqual(second.speech.phrases, []);
});

test("runtime snapshots clone nested mutable values and deduplicate manual disabled tokens", () => {
  const source = { ...emptyRuntime(), disabledTokens: ["npc", "npc"], shops: { npc: { items: [{ stock: 1 }] } } };
  const result = normalizeRuntime(source);
  result.shops.npc.items[0].stock = 0;
  assert.equal(source.shops.npc.items[0].stock, 1);
  assert.deepEqual(result.disabledTokens, ["npc"]);
  assert.equal(result.schemeId, "main");
});

test("definitions and runs are stored under Scene plus scheme without overwriting unrelated scopes", async () => {
  const makeScene = world(), first = makeScene("a"), second = makeScene("b");
  first.flags[MODULE_ID] = { definitions: { future: { marker: "keep" } }, runtimes: { future: { marker: "also-keep" } } };
  const definition = defaultDefinition(); definition.schemeName = "Market";
  await saveDefinition(first, definition, { expectedRevision: 0 });
  await saveRuntime(first, { ...emptyRuntime(), runId: "run-a" });
  assert.equal(first.writes[0].key, "definitions.main");
  assert.equal(first.writes[1].key, "runtimes.main");
  assert.equal(first.flags[MODULE_ID].definitions.future.marker, "keep");
  assert.equal(first.flags[MODULE_ID].runtimes.future.marker, "also-keep");
  assert.equal(getDefinition(first).schemeName, "Market");
  assert.equal(getRuntime(first).runId, "run-a");
  assert.equal(getRuntime(second).runId, "");
  assert.throws(() => getRuntime(first, { schemeId: "future" }));
});

test("optimistic definition revisions refuse stale writes and return detached snapshots", async () => {
  const scene = world()();
  await saveDefinition(scene, defaultDefinition(), { expectedRevision: 0 });
  const first = getDefinition(scene);
  first.episodes[0].name = "Unwritten";
  assert.notEqual(getDefinition(scene).episodes[0].name, "Unwritten");
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

test("dialogue responses can continue or finish with an event but cannot do both", () => {
  const dialogue = { id: "talk", target: { type: "Tile", id: "tile" }, nodes: [
    { id: "start", text: "Hello", responses: [{ id: "continue", label: "Next", nextNodeId: "end" }] },
    { id: "end", responses: [{ id: "finish", label: "Done", eventName: "talk.finished" }] }
  ] };
  assert.equal(normalizeDialogue(dialogue).startNodeId, "start");
  dialogue.nodes[0].responses[0].eventName = "talk.finished";
  assert.throws(() => normalizeDialogue(dialogue));
  delete dialogue.nodes[0].responses[0].eventName;
  dialogue.nodes[0].responses[0].nextNodeId = "absent";
  assert.throws(() => normalizeDialogue(dialogue));
});

test("dialogue and interaction bindings permit Token or Tile and retain event subscriptions", () => {
  const definition = defaultDefinition();
  definition.episodes[0].dialogues = [{ id: "draft", target: { type: "Tile", id: "tile" }, nodes: [] }];
  definition.episodes[0].interactions = [{ id: "touch", target: { type: "Token", id: "npc" }, eventName: "npc.touched" }];
  definition.episodes[0].subscriptions = [{ id: "say", event: "npc.touched", kind: "chat", text: "Notice", audience: { gms: false, interactor: true } }];
  const episode = normalizeDefinition(definition).episodes[0];
  assert.equal(episode.dialogues[0].target.type, "Tile");
  assert.equal(episode.subscriptions[0].audience.gms, false);
  assert.equal(episode.subscriptions[0].audience.interactor, true);
  definition.episodes[0].dialogues[0].target.type = "Scene";
  assert.throws(() => normalizeDefinition(definition));
});

test("dialogues, direct interactions and subscriptions survive normalization and reject dangling routes", () => {
  const definition = defaultDefinition(), episode = definition.episodes[0];
  episode.dialogues = [{ id: "door", target: { type: "Tile", id: "tile" }, startNodeId: "hello", nodes: [
    { id: "hello", text: "A door", responses: [{ id: "ask", label: "Ask", nextNodeId: "end" }] },
    { id: "end", text: "Closed", responses: [{ id: "knock", label: "Knock", eventName: "door.knocked" }] }
  ] }];
  episode.interactions = [{ id: "bell", target: { type: "Token", id: "npc" }, eventName: "bell.rang" }];
  episode.subscriptions = [{ id: "alert", event: "door.knocked", kind: "transition", episodeId: "alarm" },
    { id: "tell", event: "bell.rang", kind: "chat", text: "Hello", audience: { gms: false, interactor: true, nearby: true, range: 0 } }];
  const normalized = normalizeDefinition(definition);
  assert.equal(normalized.episodes[0].dialogues[0].nodes[1].responses[0].eventName, "door.knocked");
  assert.equal(normalized.episodes[0].interactions[0].target.type, "Token");
  assert.deepEqual(normalized.episodes[0].subscriptions[1].audience,
    { gms: false, interactor: true, nearby: true, range: 0, visibleOnly: true });
  episode.dialogues[0].nodes[0].responses[0].nextNodeId = "absent";
  assert.throws(() => normalizeDefinition(definition));
  episode.dialogues = [];
  episode.subscriptions[0].episodeId = "absent";
  assert.throws(() => normalizeDefinition(definition));
});

test("dialogue identifiers and mutually exclusive continuation/event preserve a deterministic current page", () => {
  const definition = defaultDefinition(), episode = definition.episodes[0];
  episode.dialogues = [{ id: "dialogue", nodes: [{ id: "start", responses: [
    { id: "a", nextNodeId: "start", eventName: "event" }
  ] }] }];
  assert.throws(() => normalizeDefinition(definition));
  episode.dialogues[0].nodes[0].responses[0].eventName = "";
  assert.equal(normalizeDefinition(definition).episodes[0].dialogues[0].startNodeId, "start");
  episode.dialogues[0].nodes.push({ id: "start", text: "Ambiguous" });
  assert.throws(() => normalizeDefinition(definition));
  assert.throws(() => normalizeRuntime({ ...emptyRuntime(), schemeId: "other" }));
});

test("scene object tags are normalized independently of episode definitions and require a GM", async () => {
  const scene = world()();
  scene.tokens = new Map([["hero", {}], ["guard", {}]]); scene.tiles = new Map([["door", {}]]);
  await saveObjectTags(scene, { type: "Token", id: "hero" }, [" Hero ", "hero", "invited"]);
  await saveObjectTags(scene, { type: "Tile", id: "door" }, "Door, locked");
  assert.deepEqual(getObjectTags(scene, { type: "Token", id: "hero" }), ["hero", "invited"]);
  assert.deepEqual(getObjectTags(scene, { type: "Tile", id: "door" }), ["door", "locked"]);
  assert.equal(getDefinition(scene).revision, 0);
  await assert.rejects(saveObjectTags(scene, { type: "Token", id: "absent" }, ["hero"]));
  game.user = { isGM: false };
  await assert.rejects(saveObjectTags(scene, { type: "Token", id: "hero" }, ["forged"]));
  assert.deepEqual(getObjectTags(scene, { type: "Token", id: "hero" }), ["hero", "invited"]);
});

test("default trigger is enabled once per entry and each policy is stored with its interaction", () => {
  const definition = defaultDefinition(), episode = definition.episodes[0];
  episode.tokens.guard = defaultTokenBehavior();
  episode.tokens.guard.shop.trigger = { enabled: false, allowTags: ["hero"], denyTags: ["wanted"], repeat: "always", resetOnEntry: false, episodeIds: ["calm"], schemeIds: ["main"] };
  const normalized = normalizeDefinition(definition).episodes[0].tokens.guard;
  assert.deepEqual(normalized.interaction.trigger, { enabled: true, schemeIds: [], episodeIds: [], allowTags: [], denyTags: [], repeat: "limited", limit: 1, resetOnEntry: true });
  assert.equal(normalized.shop.trigger.enabled, false);
  assert.equal(normalized.shop.trigger.resetOnEntry, false);
  assert.deepEqual(normalized.shop.trigger.denyTags, ["wanted"]);
});
