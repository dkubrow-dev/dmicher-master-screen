import test from "node:test";
import assert from "node:assert/strict";
import { exportScriptBlock, importScriptBlock } from "../dmicher-master-screen/scripts/script-transfer.js";
import { toolRegistration } from "../dmicher-master-screen/scripts/object-binding-model.js";

const wait = (id, next = []) => ({ id, kind: "wait", parameters: { seconds: 1.5 }, next });
function references() {
  return { binding: { type: "Token", id: "npc", groupId: "main", playerCharacter: false,
    shops: [], dialogues: [toolRegistration("dialogue", "greeting")] },
  definitions: [{ groupId: "main", states: [{ id: "calm" }] }],
  signals: [{ id: "own-signal", emitterKey: "Token:npc", parameters: [] }],
  macros: [{ ownerKey: "Token:npc", uuid: "Macro.own" }],
  assets: { shops: [], dialogues: [{ id: "greeting" }, { id: "unregistered" }] } };
}

test("a script block round trip preserves row order, graph, timing and options without exporting its state slot", () => {
  const original = { name: "Patrol", stateId: "calm", enabled: false, repeat: true, combat: { enabled: true, turnSeconds: 9 },
    steps: [wait(8, [1]), wait(1, [8])] }, before = structuredClone(original), refs = references();
  const envelope = exportScriptBlock(original, refs);
  assert.equal(envelope.format, "dmicher-master-screen"); assert.equal(envelope.version, 1); assert.equal(envelope.kind, "script");
  assert.equal(envelope.data.stateId, undefined);
  const imported = importScriptBlock(envelope, { stateId: "destination" }, refs);
  assert.equal(imported.stateId, "destination"); assert.equal(imported.enabled, false); assert.equal(imported.repeat, true);
  assert.equal(imported.combat.turnSeconds, 9);
  assert.deepEqual(imported.steps.map(({ id, next }) => [id, next]), [[8, [1]], [1, [8]]]);
  assert.deepEqual(original, before);
});

test("files cannot reassign initial, transition or routine containers", () => {
  const refs = references(), envelope = exportScriptBlock({ name: "One", steps: [wait(1)] }, refs);
  envelope.data.stateId = "foreign";
  assert.equal(importScriptBlock(envelope, {}, refs).stateId, undefined);
  assert.equal(importScriptBlock(envelope, { stateId: "calm" }, refs).stateId, "calm");
  assert.equal(envelope.data.stateId, "foreign", "validation does not rewrite the selected file");
});

test("transfer rejects other object envelopes and invalid actions instead of interpreting old formats", () => {
  const refs = references(), good = exportScriptBlock({ steps: [wait(1)] }, refs);
  for (const value of [null, [], good.data, { ...good, version: 2 }, { ...good, kind: "state" }, { ...good, data: [] }]) {
    assert.throws(() => importScriptBlock(value, {}, refs));
  }
  assert.throws(() => importScriptBlock({ ...good, data: { steps: [wait(9)] } }, {}, refs));
  assert.throws(() => importScriptBlock({ ...good, data: { steps: [{ ...wait(1), parameters: { seconds: "7" } }] } }, {}, refs));
});

test("import and export require the destination object's registered dialogues, macros and signals", () => {
  const refs = references();
  for (const [kind, parameters] of [["dialogue", { dialogueId: "greeting" }], ["macro", { macroUuid: "Macro.own" }], ["signal", { signalId: "own-signal", parameters: {} }]]) {
    const value = exportScriptBlock({ steps: [{ id: 1, kind, parameters, next: [] }] }, refs);
    assert.equal(importScriptBlock(value, {}, refs).steps[0].kind, kind);
    const differentOwner = references(); differentOwner.binding.id = "another"; differentOwner.binding.dialogues = [];
    assert.throws(() => importScriptBlock(value, {}, differentOwner));
    assert.throws(() => exportScriptBlock(value.data, differentOwner));
  }
  assert.throws(() => exportScriptBlock({ steps: [{ id: 1, kind: "dialogue", parameters: { dialogueId: "unregistered" }, next: [] }] }, refs));
});

test("transferring one block does not validate or export unrelated unfinished blocks and player assignments", () => {
  const refs = references();
  refs.binding.scripts = [{ stateId: "missing", steps: [{ kind: "invalid" }] }];
  refs.binding.transitionScripts = { gone: { steps: null } };
  refs.binding.dialogues = [{ dialogueId: "greeting", stateIds: ["missing"], conditions: { enabled: false } }];
  refs.binding.shops = [toolRegistration("shop", "deleted-unused-shop")];
  refs.binding.dialogues.push(toolRegistration("dialogue", "deleted-unused-dialogue"));
  const envelope = exportScriptBlock({ steps: [wait(1)] }, refs);
  assert.deepEqual(Object.keys(envelope).sort(), ["data", "format", "kind", "version"]);
  assert.equal(importScriptBlock(envelope, {}, refs).steps.length, 1);
});
