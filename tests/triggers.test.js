import test from "node:test";
import assert from "node:assert/strict";
import { getTriggerKey, getTriggerGate, consumeTrigger, resetEpisodeTriggerCounts } from "../dmicher-master-screen/scripts/triggers.js";
import { MODULE_ID, defaultEpisode, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { requestHalt, finishHalt } from "../dmicher-master-screen/scripts/execution.js";

function fixture() {
  const scene = { id: "scene", tokens: new Map(), flags: { [MODULE_ID]: { objectTags: { Token: { pc: [" Member ", "human"] }, Tile: {} } } },
    getFlag(scope, key) { return structuredClone(this.flags[scope]?.[key]); } };
  const pc = { id: "pc", parent: scene };
  scene.tokens.set(pc.id, pc);
  const state = { ...emptyRuntime(), runId: "run", episodeId: "calm", episode: defaultEpisode("Calm", "calm") };
  const key = getTriggerKey(state, "zone", "door");
  return { scene, pc, state, key, gate: (policy = {}, options = {}) => getTriggerGate(scene, state, policy, pc, { triggerKey: key, ...options }) };
}

test("allow tags match any normalized tag and deny tags veto even an allowed actor", () => {
  const f = fixture();
  assert.equal(f.gate({ allowTags: ["elf", "MEMBER"] }).allowed, true);
  assert.equal(f.gate({ allowTags: ["elf"] }).allowed, false);
  assert.equal(f.gate({ allowTags: ["member"], denyTags: [" Human "] }).allowed, false);
  assert.equal(f.gate({ denyTags: ["elf"] }).allowed, true);
  assert.equal(f.gate().allowed, true);
});

test("scope predicates restrict the owning scheme and episode and reject foreign-scene tokens", () => {
  const f = fixture();
  assert.equal(f.gate({ schemeIds: ["main"], episodeIds: ["calm"] }).allowed, true);
  assert.equal(f.gate({ schemeIds: ["other"] }).allowed, false);
  assert.equal(f.gate({ episodeIds: ["alarm"] }).allowed, false);
  assert.equal(f.gate({}, { triggerKey: "main:alarm:zone:door" }).allowed, false);
  assert.equal(f.gate({}, { triggerKey: "other:calm:zone:door" }).allowed, false);
  const impostor = { id: "pc", parent: { id: "other" } };
  assert.equal(getTriggerGate(f.scene, f.state, {}, impostor, { triggerKey: f.key }).allowed, false);
});

test("default quota is one and an existing admitted session may ignore only its quota", () => {
  const f = fixture();
  assert.equal(consumeTrigger(f.state, f.key), 1);
  assert.equal(f.gate().allowed, false);
  assert.throws(() => consumeTrigger(f.state, f.key));
  assert.equal(f.gate({}, { ignoreQuota: true }).allowed, true);
  assert.equal(f.gate({ enabled: false }, { ignoreQuota: true }).allowed, false);
  assert.equal(f.gate({ allowTags: ["elf"] }, { ignoreQuota: true }).allowed, false);
  assert.equal(f.gate({ episodeIds: ["alarm"] }, { ignoreQuota: true }).allowed, false);
});

test("limited quotas count each admission and always retains diagnostic counts without blocking", () => {
  const f = fixture();
  const policy = { limit: 2 };
  consumeTrigger(f.state, f.key, policy);
  assert.equal(f.gate(policy).allowed, true);
  consumeTrigger(f.state, f.key, policy);
  assert.equal(f.gate(policy).allowed, false);
  for (let index = 0; index < 3; index++) consumeTrigger(f.state, f.key, { repeat: "always" });
  assert.equal(f.state.triggerCounts[f.key], 5);
  assert.equal(f.gate({ repeat: "always" }).allowed, true);
});

test("explicit runtime enable overrides both directions and does not reset consumed quota", () => {
  const f = fixture();
  f.state.triggerEnabledOverrides[f.key] = true;
  assert.equal(f.gate({ enabled: false }).allowed, true);
  consumeTrigger(f.state, f.key, { enabled: false });
  assert.equal(f.gate({ enabled: false }).allowed, false);
  f.state.triggerEnabledOverrides[f.key] = false;
  assert.equal(f.gate({ enabled: true, repeat: "always" }).allowed, false);
  assert.throws(() => consumeTrigger(f.state, f.key, { repeat: "always" }));
});

test("entry resets only incoming episode policies that opt in and preserves manual overrides", () => {
  const f = fixture();
  f.state.episode.zones = [{ id: "door", trigger: {} }, { id: "once-ever", trigger: { resetOnEntry: false } }];
  f.state.episode.dialogues = [{ id: "talk", trigger: {} }];
  f.state.episode.interactions = [{ id: "touch", trigger: {} }];
  f.state.episode.tokens = { npc: { shop: { trigger: {} }, interaction: { trigger: { resetOnEntry: false } } } };
  const keep = ["main:calm:zone:once-ever", "main:calm:npc-interaction:npc", "main:alarm:zone:door", "other:calm:zone:door"];
  const reset = [f.key, "main:calm:dialogue:talk", "main:calm:interaction:touch", "main:calm:shop:npc"];
  f.state.triggerCounts = Object.fromEntries([...keep, ...reset].map((key) => [key, 3]));
  f.state.triggerEnabledOverrides[f.key] = false;
  resetEpisodeTriggerCounts(f.state);
  assert.deepEqual(Object.keys(f.state.triggerCounts).sort(), keep.sort());
  assert.equal(f.state.triggerEnabledOverrides[f.key], false);
});

test("stop, persisted emergency halt and an immediate pending halt reject without consuming", () => {
  const f = fixture();
  f.state.episode.stop = true;
  assert.equal(f.gate().allowed, false);
  f.state.episode.stop = false;
  f.state.halted = true;
  assert.equal(f.gate({}, { ignoreQuota: true }).allowed, false);
  f.state.halted = false;
  const generation = requestHalt(f.scene);
  assert.equal(f.gate().allowed, false);
  finishHalt(f.scene, generation);
  assert.equal(f.gate().allowed, true);
  assert.deepEqual(f.state.triggerCounts, {});
});
