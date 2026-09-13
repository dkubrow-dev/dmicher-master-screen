import test from "node:test";
import assert from "node:assert/strict";
import { sceneFixture, clone, descriptor } from "./fixtures/scene.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { GroupEditor } from "../dmicher-master-screen/scripts/group-editor.js";
import { SceneObjects } from "../dmicher-master-screen/scripts/scene-objects.js";
import { exportBundle, importBundle } from "../dmicher-master-screen/scripts/transfer.js";

const transition = (groupId, stateId, id = 1) => ({ id, kind: "state", parameters: { transitions: [{ groupId, stateId }] }, next: [] });
const script = (group, stateId = group.entryStateId) => ({ steps: [transition(group.groupId, stateId)] });
const destinations = (entry) => entry.steps.map((step) => step.parameters.transitions[0]);

test("group imports retarget owned state actions and preserve valid external destinations", async () => {
  const f = sceneFixture(), own = await f.editor.createGroup({ name: "Source" }), external = await f.editor.createGroup({ name: "External" });
  const prepared = { steps: [transition(own.groupId, own.entryStateId), transition(external.groupId, external.entryStateId, 2)] };
  await f.objects.save(descriptor, { groupId: own.groupId, initialScript: prepared,
    transitionScripts: { [own.entryStateId]: prepared }, scripts: [{ ...prepared, stateId: own.entryStateId }] });
  const receiver = f.create("receiver");
  receiver.flags[MODULE_ID].groupDefinitions = { [external.groupId]: clone(external) };
  const imported = await new GroupEditor(receiver).importGroup(f.editor.exportGroup(own.groupId)), binding = new SceneObjects(receiver).get(descriptor);
  for (const entry of [binding.initialScript, binding.transitionScripts[own.entryStateId], ...binding.scripts]) {
    assert.deepEqual(destinations(entry), [{ groupId: imported.groupId, stateId: own.entryStateId }, { groupId: external.groupId, stateId: external.entryStateId }]);
  }
});

test("unresolved external state destinations reject group imports before any catalog write", async () => {
  const f = sceneFixture(), own = await f.editor.createGroup({ name: "Source" }), external = await f.editor.createGroup({ name: "External" });
  await f.objects.save(descriptor, { groupId: own.groupId, initialScript: script(external) });
  const receiver = f.create("receiver"), before = clone(receiver.flags), writes = f.writes();
  await assert.rejects(new GroupEditor(receiver).importGroup(f.editor.exportGroup(own.groupId)));
  assert.deepEqual(receiver.flags, before); assert.equal(f.writes(), writes);
});

test("copying one state retargets its own pair and keeps references to uncopied states", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), other = await f.editor.createState(group.groupId, { name: "Other" });
  const prepared = { steps: [transition(group.groupId, group.entryStateId), transition(group.groupId, other.id, 2)] };
  await f.objects.save(descriptor, { groupId: group.groupId, scripts: [{ ...prepared, stateId: group.entryStateId }] });
  const copied = await f.editor.importState(group.groupId, f.editor.exportState(group.groupId, group.entryStateId), { name: "Copy" });
  const binding = f.objects.get(descriptor);
  assert.deepEqual(destinations(binding.scripts.find((entry) => entry.stateId === copied.id)), [
    { groupId: group.groupId, stateId: copied.id }, { groupId: group.groupId, stateId: other.id }
  ]);
  assert.deepEqual(destinations(binding.scripts.find((entry) => entry.stateId === group.entryStateId)), destinations(prepared));
});

test("importing one state into another group does not retarget uncopied source states", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), other = await f.editor.createState(group.groupId, { name: "Other" });
  await f.objects.save(descriptor, { groupId: group.groupId, scripts: [{ ...script(group, other.id), stateId: group.entryStateId }] });
  const receiver = f.create("receiver"), editor = new GroupEditor(receiver), target = await editor.createGroup({ name: "Target" });
  const envelope = f.editor.exportState(group.groupId, group.entryStateId), before = clone(receiver.flags), writes = f.writes();
  await assert.rejects(editor.importState(target.groupId, envelope, { name: "Imported" }));
  assert.deepEqual(receiver.flags, before); assert.equal(f.writes(), writes);
  receiver.flags[MODULE_ID].groupDefinitions[group.groupId] = clone(f.editor.get(group.groupId));
  const imported = await editor.importState(target.groupId, envelope, { name: "Imported" });
  const saved = new SceneObjects(receiver).get(descriptor).scripts.find((entry) => entry.stateId === imported.id);
  assert.deepEqual(destinations(saved), [{ groupId: group.groupId, stateId: other.id }]);
});

test("native binding save rejects missing group/state pairs in each script purpose on RU and EN", async () => {
  for (const language of ["ru", "en"]) {
    const f = sceneFixture(), group = await f.editor.createGroup(); game.i18n = { lang: language };
    for (const pair of [{ groupId: "absent", stateId: group.entryStateId }, { groupId: group.groupId, stateId: "absent" }]) {
      const invalid = { steps: [transition(pair.groupId, pair.stateId)] };
      const patches = [{ initialScript: invalid }, { transitionScripts: { [group.entryStateId]: invalid } }, { scripts: [{ ...invalid, stateId: group.entryStateId }] }];
      for (const patch of patches) {
        const before = clone(f.scene.flags);
        await assert.rejects(f.objects.save(descriptor, { groupId: group.groupId, ...patch }), (error) => {
          assert.equal(error.message, language === "en" ? "The script transition refers to a missing group or state." : "Переход скрипта ссылается на отсутствующую группу или состояние.");
          return true;
        });
        assert.deepEqual(f.scene.flags, before);
      }
    }
  }
});

test("state imports reject two destinations that would collapse onto the same target group", async () => {
  const f = sceneFixture(), source = await f.editor.createGroup({ name: "Source" }), target = await f.editor.createGroup({ name: "Target" });
  const prepared = { steps: [{ id: 1, kind: "state", parameters: { transitions: [
    { groupId: source.groupId, stateId: source.entryStateId }, { groupId: target.groupId, stateId: target.entryStateId }
  ] }, next: [] }] };
  await f.objects.save(descriptor, { groupId: source.groupId, scripts: [{ ...prepared, stateId: source.entryStateId }] });
  const envelope = f.editor.exportState(source.groupId, source.entryStateId), receiver = f.create("receiver");
  receiver.flags[MODULE_ID].groupDefinitions = { [target.groupId]: clone(target) };
  const before = clone(receiver.flags), writes = f.writes();
  await assert.rejects(new GroupEditor(receiver).importState(target.groupId, envelope, { name: "Imported" }));
  assert.deepEqual(receiver.flags, before); assert.equal(f.writes(), writes);
});

test("whole scene round trip preserves group/state action IDs and rejects missing destinations before creation", async () => {
  const f = sceneFixture(), own = await f.editor.createGroup({ name: "Own" }), external = await f.editor.createGroup({ name: "Other" });
  await f.objects.save(descriptor, { groupId: own.groupId, initialScript: script(external) });
  const bundle = await exportBundle(f.scene);
  let imported, creates = 0;
  globalThis.CONFIG = { Scene: { documentClass: { create: async () => { creates++; imported = f.create("imported"); return imported; } } } };
  for (const field of ["groupId", "stateId"]) {
    const invalid = clone(bundle); invalid.objectBindings.bindings["Token:npc"].initialScript.steps[0].parameters.transitions[0][field] = "absent";
    await assert.rejects(importBundle(invalid)); assert.equal(creates, 0);
  }
  await importBundle(bundle);
  assert.deepEqual(destinations(new SceneObjects(imported).get(descriptor).initialScript), [{ groupId: external.groupId, stateId: external.entryStateId }]);
  assert.equal(creates, 1);
});
