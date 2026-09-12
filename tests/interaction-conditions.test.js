import test from "node:test";
import assert from "node:assert/strict";
import { getConditionKey, getConditionGate, evaluateConditionPolicy, consumeCondition, resetStateConditions } from "../dmicher-master-screen/scripts/interaction-conditions.js";
import { evaluateInteractionPreview } from "../dmicher-master-screen/scripts/interaction-access.js";
import { MODULE_ID, defaultState, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { requestHalt, finishHalt } from "../dmicher-master-screen/scripts/execution.js";

function fixture() {
  const scene = { id: "scene", tokens: new Map(), flags: { [MODULE_ID]: { objectBindings: { schemaVersion: 1, revision: 0, bindings: {
    "Token:pc": { type: "Token", id: "pc", groupId: null, tags: [" Member ", "human"] }
  } } } },
    getFlag(scope, key) { return structuredClone(this.flags[scope]?.[key]); } };
  const pc = { id: "pc", parent: scene };
  scene.tokens.set(pc.id, pc);
  const state = { ...emptyRuntime(), runId: "run", stateId: "calm", state: defaultState("Calm", "calm") };
  const key = getConditionKey(state, "zone", "door");
  return { scene, pc, state, key, gate: (policy = {}, options = {}) => getConditionGate(scene, state, policy, pc, { conditionKey: key, ...options }) };
}

test("allow tags match any normalized tag and deny tags veto even an allowed actor", () => {
  const f = fixture();
  assert.equal(f.gate({ allowTags: ["elf", "MEMBER"] }).allowed, true);
  assert.equal(f.gate({ allowTags: ["elf"] }).allowed, false);
  assert.equal(f.gate({ allowTags: ["member"], denyTags: [" Human "] }).allowed, false);
  assert.equal(f.gate({ denyTags: ["elf"] }).allowed, true);
  assert.equal(f.gate().allowed, true);
});

test("scope predicates restrict the owning group and state and reject foreign-scene tokens", () => {
  const f = fixture();
  assert.equal(f.gate({ groupIds: ["main"], stateIds: ["calm"] }).allowed, true);
  assert.equal(f.gate({ groupIds: ["other"] }).allowed, false);
  assert.equal(f.gate({ stateIds: ["alarm"] }).allowed, false);
  assert.equal(f.gate({}, { conditionKey: "main:alarm:zone:door" }).allowed, false);
  assert.equal(f.gate({}, { conditionKey: "other:calm:zone:door" }).allowed, false);
  const impostor = { id: "pc", parent: { id: "other" } };
  assert.equal(getConditionGate(f.scene, f.state, {}, impostor, { conditionKey: f.key }).allowed, false);
});

test("preview and live admission share policy decisions without a preview Scene or document adapter", () => {
  const policies = [{}, { enabled: false }, { groupIds: ["other"] }, { stateIds: ["alarm"] },
    { allowTags: ["ELF", "MEMBER"] }, { allowTags: ["elf"] }, { allowTags: ["member"], denyTags: ["human"] },
    { repeat: "always" }, { repeat: "limited", limit: 2 }];
  for (const policy of policies) for (const used of [0, 1, 2]) for (const halted of [false, true]) {
    const f = fixture(); f.state.halted = halted; f.state.conditionCounts[f.key] = used;
    const preview = evaluateInteractionPreview({ config: { id: "door", conditions: policy }, kind: "zone",
      groupId: "main", stateId: "calm", tags: ["member", "human"], used, halted });
    assert.deepEqual(preview, f.gate(policy));
  }
});

test("pure condition policy gives stop and inactive state precedence over overrides, tags and quota", () => {
  const context = { active: true, groupId: "main", stateId: "calm", conditionKey: "main:calm:zone:door" };
  const policy = Object.freeze({ enabled: false, denyTags: Object.freeze(["blocked"]), limit: 1 });
  const stop = evaluateConditionPolicy({ ...context, halted: true }, {});
  assert.deepEqual(evaluateConditionPolicy({ ...context, active: false, halted: true, count: 20 }, policy, ["blocked"]), stop);
  const inactive = evaluateConditionPolicy({ ...context, active: false }, {});
  assert.deepEqual(evaluateConditionPolicy({ ...context, active: false, count: 20 }, policy, ["blocked"]), inactive);
  assert.equal(evaluateConditionPolicy({ ...context, enabledOverride: true }, policy).allowed, true);
  assert.equal(evaluateConditionPolicy({ ...context, enabledOverride: true }, policy, ["blocked"]).allowed, false);
});

test("default quota is one and an existing admitted session may ignore only its quota", () => {
  const f = fixture();
  assert.equal(consumeCondition(f.state, f.key), 1);
  assert.equal(f.gate().allowed, false);
  assert.throws(() => consumeCondition(f.state, f.key));
  assert.equal(f.gate({}, { ignoreQuota: true }).allowed, true);
  assert.equal(f.gate({ enabled: false }, { ignoreQuota: true }).allowed, false);
  assert.equal(f.gate({ allowTags: ["elf"] }, { ignoreQuota: true }).allowed, false);
  assert.equal(f.gate({ stateIds: ["alarm"] }, { ignoreQuota: true }).allowed, false);
});

test("limited quotas count each admission and always retains diagnostic counts without blocking", () => {
  const f = fixture();
  const policy = { limit: 2 };
  consumeCondition(f.state, f.key, policy);
  assert.equal(f.gate(policy).allowed, true);
  consumeCondition(f.state, f.key, policy);
  assert.equal(f.gate(policy).allowed, false);
  for (let index = 0; index < 3; index++) consumeCondition(f.state, f.key, { repeat: "always" });
  assert.equal(f.state.conditionCounts[f.key], 5);
  assert.equal(f.gate({ repeat: "always" }).allowed, true);
});

test("explicit runtime enable overrides both directions and does not reset consumed quota", () => {
  const f = fixture();
  f.state.conditionEnabledOverrides[f.key] = true;
  assert.equal(f.gate({ enabled: false }).allowed, true);
  consumeCondition(f.state, f.key, { enabled: false });
  assert.equal(f.gate({ enabled: false }).allowed, false);
  f.state.conditionEnabledOverrides[f.key] = false;
  assert.equal(f.gate({ enabled: true, repeat: "always" }).allowed, false);
  assert.throws(() => consumeCondition(f.state, f.key, { repeat: "always" }));
});

test("entry resets only incoming state policies that opt in and preserves manual overrides", () => {
  const f = fixture();
  f.state.state.zones = [{ id: "door", conditions: {} }, { id: "once-ever", conditions: { resetOnEntry: false } }];
  f.state.state.dialogues = [{ dialogueId: "talk", target: { type: "Token", id: "npc" }, conditions: {} }];
  f.state.state.interactions = [{ id: "touch", conditions: {} }];
  f.state.state.shops = [{ shopId: "market", target: { type: "Token", id: "npc" }, conditions: {} }];
  const keep = ["main:calm:zone:once-ever", "main:alarm:zone:door", "other:calm:zone:door"];
  const reset = [f.key, "main:calm:dialogue:Token:npc:talk", "main:calm:interaction:touch", "main:calm:shop:Token:npc:market"];
  f.state.conditionCounts = Object.fromEntries([...keep, ...reset].map((key) => [key, 3]));
  f.state.conditionEnabledOverrides[f.key] = false;
  resetStateConditions(f.state);
  assert.deepEqual(Object.keys(f.state.conditionCounts).sort(), keep.sort());
  assert.equal(f.state.conditionEnabledOverrides[f.key], false);
});

test("persisted emergency halt and an immediate pending halt reject without consuming", () => {
  const f = fixture();
  f.state.halted = true;
  assert.equal(f.gate({}, { ignoreQuota: true }).allowed, false);
  f.state.halted = false;
  const generation = requestHalt(f.scene);
  assert.equal(f.gate().allowed, false);
  finishHalt(f.scene, generation);
  assert.equal(f.gate().allowed, true);
  assert.deepEqual(f.state.conditionCounts, {});
});
