import test from "node:test";
import assert from "node:assert/strict";
import { OBJECT_COMMAND_IDS, defaultObjectCommand, normalizeObjectCommand, normalizeObjectCommands,
  objectCommandName, objectCommandConditionsMatch } from "../dmicher-master-screen/scripts/object-command-model.js";
import { normalizeObjectBinding, bindingScripts, reconcileBindingGroups } from "../dmicher-master-screen/scripts/object-binding-model.js";

const waitScript = () => ({ stateId: "foreign", steps: [{ id: 1, kind: "wait", parameters: { seconds: 1 }, next: [] }] });

test("unconfigured objects allocate no commands, and each explicit built-in starts disabled", () => {
  assert.deepEqual(normalizeObjectBinding({ type: "Token", id: "npc" }).commands, []);
  assert.equal(OBJECT_COMMAND_IDS.length, 25);
  for (const id of OBJECT_COMMAND_IDS) {
    const command = defaultObjectCommand(id);
    assert.equal(command.enabled, false);
    assert.equal(command.interruptions.command, "stop");
    assert.deepEqual(command.conditions, { allowTags: [], denyTags: [], groups: [], range: 5 });
    assert.equal(command.beforeScript, null);
    assert.equal(command.afterScript, null);
  }
  const first = defaultObjectCommand("come"), second = defaultObjectCommand("come");
  first.parameters.speed = 999; first.conditions.allowTags.push("changed");
  assert.equal(second.parameters.speed, 5);
  assert.deepEqual(second.conditions.allowTags, []);
});

test("finite positive motion and wait times reject ambiguous or never-ending commands", () => {
  for (const [id, key] of [["come", "duration"], ["away", "duration"], ["go", "duration"],
    ["go", "waitSeconds"], ["wait", "seconds"], ["cancel", "waitSeconds"], ["patrol", "speed"]]) {
    for (const value of [0, -1, Infinity, NaN, "3", null]) {
      assert.throws(() => normalizeObjectCommand({ id, parameters: { [key]: value } }), `${id}.${key}: ${value}`);
    }
    assert.equal(normalizeObjectCommand({ id, parameters: { [key]: 0.25 } }).parameters[key], 0.25);
  }
  assert.throws(() => normalizeObjectCommand({ id: "come", parameters: { unknown: 1 } }));
});

test("follow distances are ordered while native light radii remain independent", () => {
  assert.throws(() => normalizeObjectCommand({ id: "follow", parameters: { minDistance: 5, maxDistance: 2 } }));
  assert.throws(() => normalizeObjectCommand({ id: "follow", parameters: { mode: "invalid" } }));
  const light = normalizeObjectCommand({ id: "light-on", parameters: { bright: 10.5, dim: 0 } });
  assert.deepEqual(light.parameters, { bright: 10.5, dim: 0 });
  assert.equal(normalizeObjectCommand({ id: "follow", parameters: { minDistance: 0, maxDistance: 0 } }).parameters.maxDistance, 0);
});

test("commands reject duplicate built-ins, invalid scopes, and invalid issuer permissions", () => {
  assert.throws(() => normalizeObjectCommands([{ id: "wait" }, { id: "wait" }]));
  assert.throws(() => normalizeObjectCommands([{ id: "unknown" }]));
  assert.throws(() => normalizeObjectCommand({ id: "wait", enabled: "true" }));
  assert.throws(() => normalizeObjectCommand({ id: "wait", conditions: { groups: [{ groupId: "g" }, { groupId: "g" }] } }));
  assert.throws(() => normalizeObjectCommand({ id: "wait", conditions: { groups: [{ groupId: "g", stateIds: ["bad.id"] }] } }));
  assert.throws(() => normalizeObjectCommand({ id: "stop", parameters: { issuer: "commander" } }));
  assert.throws(() => normalizeObjectCommand({ id: "cancel", parameters: { issuer: "anybody" } }));
  for (const issuer of ["gm", "commander", "players"]) assert.equal(normalizeObjectCommand({ id: "cancel", parameters: { issuer } }).parameters.issuer, issuer);
});

test("command phase scripts ignore incoming commands by default, preserve explicit policy, and lose foreign state slots", () => {
  const raw = { id: "wait", beforeScript: waitScript(), afterScript: { ...waitScript(), interruptions: { command: "next-step" } } };
  const before = structuredClone(raw), command = normalizeObjectCommand(raw);
  assert.equal(command.beforeScript.interruptions.command, "ignore");
  assert.equal(command.afterScript.interruptions.command, "next-step");
  assert.equal(command.beforeScript.stateId, undefined);
  assert.deepEqual(raw, before);
  assert.throws(() => normalizeObjectCommand({ id: "wait", beforeScript: { ...waitScript(), interruptions: null } }));
  assert.equal(bindingScripts({ commands: [command] }).length, 2);
});

test("command admission combines alternative scopes, any allowed tag, deny exclusions, and finite range", () => {
  const command = normalizeObjectCommand({ id: "wait", enabled: true, conditions: {
    allowTags: ["friend", "owner"], denyTags: ["hostile"], range: 5,
    groups: [{ groupId: "hall", stateIds: ["calm"] }, { groupId: "street", stateIds: [] }]
  } });
  const context = { tags: ["friend"], groupStates: [{ groupId: "hall", stateId: "calm" }], distance: 5 };
  assert.equal(objectCommandConditionsMatch(command, context), true);
  assert.equal(objectCommandConditionsMatch(command, { ...context, tags: ["friend", "hostile"] }), false);
  assert.equal(objectCommandConditionsMatch(command, { ...context, tags: [] }), false);
  assert.equal(objectCommandConditionsMatch(command, { ...context, distance: Infinity }), false);
  assert.equal(objectCommandConditionsMatch(command, { ...context, distance: 5.01 }), false);
  assert.equal(objectCommandConditionsMatch(command, { ...context, groupStates: [{ groupId: "street", stateId: "alarm" }] }), true);
  assert.equal(objectCommandConditionsMatch(command, { ...context, groupStates: [{ groupId: "hall", stateId: "alarm" }] }), false);
  assert.equal(objectCommandConditionsMatch({ ...command, enabled: false }, context), false);
});

test("deleting a referenced group or last state disables command admission without broadening it", () => {
  const command = normalizeObjectCommand({ id: "wait", enabled: true,
    conditions: { groups: [{ groupId: "other", stateIds: ["calm"] }] } });
  const raw = { schemaVersion: 1, revision: 3, bindings: { "Token:npc": normalizeObjectBinding({ type: "Token", id: "npc", commands: [command] }) } };
  const previous = [{ groupId: "other", states: [{ id: "calm" }] }];
  for (const definitions of [[], [{ groupId: "other", states: [{ id: "alarm" }] }]]) {
    const next = reconcileBindingGroups(raw, previous, definitions);
    assert.equal(next.revision, 4);
    assert.equal(next.bindings["Token:npc"].commands[0].enabled, false);
    assert.equal(raw.bindings["Token:npc"].commands[0].enabled, true);
  }
  assert.equal(reconcileBindingGroups(raw, previous, previous), null);
});

test("command titles and invalid preparation diagnostics are localized in both languages", () => {
  for (const lang of ["ru", "en"]) {
    globalThis.game = { i18n: { lang } };
    for (const id of OBJECT_COMMAND_IDS) assert.equal(/[\u0400-\u04ff]/u.test(objectCommandName(id)), lang === "ru");
    assert.throws(() => normalizeObjectCommand({ id: "wait", parameters: { seconds: 0 } }), error => {
      assert.equal(/[\u0400-\u04ff]/u.test(error.message), lang === "ru"); return true;
    });
  }
});
