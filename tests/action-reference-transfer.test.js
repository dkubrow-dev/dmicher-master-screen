import test from "node:test";
import assert from "node:assert/strict";
import { sceneFixture, clone, descriptor, shopData, dialogueData } from "./fixtures/scene.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { GroupEditor } from "../dmicher-master-screen/scripts/group-editor.js";
import { SceneObjects } from "../dmicher-master-screen/scripts/scene-objects.js";
import { getInteractionCatalog } from "../dmicher-master-screen/scripts/scene-assets.js";
import { exportBundle, importBundle } from "../dmicher-master-screen/scripts/transfer.js";

async function preparation() {
  const f = sceneFixture(), group = await f.editor.createGroup({ name: "Source" });
  const dialogue = await f.assets.saveDialogue({ ...dialogueData(), id: "shared" });
  const shop = await f.assets.saveShop({ ...shopData(), id: "shared" });
  const script = { steps: [
    { id: 1, kind: "dialogue", parameters: { dialogueId: dialogue.id, tokenUuids: ["Scene.map.Token.pc"], waitMode: "all" }, next: [2] },
    { id: 2, kind: "approach", parameters: { targetUuid: "Scene.map.Tile.counter", distance: 2, timeMode: "duration", duration: 3, speed: 5 }, next: [3] },
    { id: 3, kind: "follow", parameters: { targetUuid: "Scene.map.Token.pc", minDistance: 1, maxDistance: 5, speed: 5, mode: "trajectory", finishOn: "arrival" }, next: [] }
  ] };
  await f.objects.save(descriptor, { groupId: group.groupId, initialScript: script,
    transitionScripts: { [group.entryStateId]: script }, scripts: [{ ...script, stateId: group.entryStateId }],
    dialogues: [{ dialogueId: dialogue.id }], shops: [{ shopId: shop.id }] });
  return { ...f, group, dialogue, script };
}

function checkReferences(binding, targetSceneId, dialogueId, stateId) {
  for (const script of [binding.initialScript, binding.transitionScripts[stateId], ...binding.scripts]) {
    assert.equal(script.steps[0].parameters.dialogueId, dialogueId);
    assert.deepEqual(script.steps[0].parameters.tokenUuids, [`Scene.${targetSceneId}.Token.pc`]);
    assert.equal(script.steps[1].parameters.targetUuid, `Scene.${targetSceneId}.Tile.counter`);
    assert.equal(script.steps[2].parameters.targetUuid, `Scene.${targetSceneId}.Token.pc`);
  }
}

test("group exports include an attached scripted dialogue and import it independently of equal shop IDs", async () => {
  const f = await preparation(), envelope = f.editor.exportGroup(f.group.groupId);
  assert.equal(envelope.interactionCatalog.dialogues.length, 1);
  assert.equal(envelope.interactionCatalog.dialogues[0].id, f.dialogue.id);
  const before = clone(envelope), receiver = f.create("receiver");
  const imported = await new GroupEditor(receiver).importGroup(envelope), binding = new SceneObjects(receiver).get(descriptor);
  const catalog = getInteractionCatalog(receiver);
  assert.notEqual(catalog.dialogues[0].id, catalog.shops[0].id);
  checkReferences(binding, receiver.id, catalog.dialogues[0].id, imported.entryStateId);
  assert.deepEqual(envelope, before);
});

test("single-state imports retain scripted dialogue dependencies and retarget their native UUID arrays", async () => {
  const f = await preparation(), envelope = f.editor.exportState(f.group.groupId, f.group.entryStateId);
  assert.equal(envelope.interactionCatalog.dialogues.length, 1);
  const receiver = f.create("receiver"), editor = new GroupEditor(receiver), target = await editor.createGroup({ name: "Target" });
  const imported = await editor.importState(target.groupId, envelope, { name: "Imported" });
  const binding = new SceneObjects(receiver).get(descriptor), catalogue = getInteractionCatalog(receiver);
  checkReferences(binding, receiver.id, catalogue.dialogues[0].id, imported.id);
});

test("whole-scene imports remap known UUIDs inside all new action fields and keep dialogue IDs", async () => {
  const f = await preparation(), bundle = await exportBundle(f.scene), before = clone(bundle);
  let imported;
  globalThis.CONFIG = { Scene: { documentClass: { create: async () => { imported = f.create("imported"); return imported; } } } };
  await importBundle(bundle);
  checkReferences(new SceneObjects(imported).get(descriptor), "imported", f.dialogue.id, f.group.entryStateId);
  assert.deepEqual(bundle, before);
});

test("dialogue actions require their own attachment in RU and EN while empty preparation remains editable", async () => {
  for (const language of ["ru", "en"]) {
    const f = sceneFixture(), group = await f.editor.createGroup(), dialogue = await f.assets.saveDialogue(dialogueData());
    game.i18n = { lang: language };
    const action = { steps: [{ id: 1, kind: "dialogue", parameters: { dialogueId: dialogue.id, tokenUuids: [], waitMode: "all" }, next: [] }] };
    const before = clone(f.scene.flags);
    await assert.rejects(f.objects.save(descriptor, { groupId: group.groupId, initialScript: action }), (error) => {
      assert.equal(error.message, language === "en" ? "A script can start only a dialogue registered in this object's properties." : "Скрипт может запускать только диалог, зарегистрированный в свойствах этого объекта.");
      return true;
    });
    assert.deepEqual(f.scene.flags, before);
    action.steps[0].parameters.dialogueId = "";
    await f.objects.save(descriptor, { groupId: group.groupId, initialScript: action });
    assert.equal(f.objects.get(descriptor).initialScript.steps[0].parameters.dialogueId, "");
  }
});

test("removing a dialogue attachment used by a script is rejected before saving", async () => {
  const f = await preparation(), before = clone(f.scene.flags);
  await assert.rejects(f.objects.save(descriptor, { dialogues: [] }));
  assert.deepEqual(f.scene.flags, before);
  assert.ok(f.scene.flags[MODULE_ID].objectBindings.bindings["Token:npc"].dialogues.length);
});

test("a state export retains registered script dialogues without widening player availability", async () => {
  for (const language of ["ru", "en"]) {
    const f = await preparation(), other = await f.editor.createState(f.group.groupId, { name: "Other" });
    await f.objects.save(descriptor, { dialogues: [{ dialogueId: f.dialogue.id, stateIds: [other.id] }] });
    game.i18n = { lang: language };
    const before = clone(f.scene.flags);
    const stateExport = f.editor.exportState(f.group.groupId, f.group.entryStateId);
    const registration = stateExport.objectBindings.bindings["Token:npc"].dialogues[0];
    assert.equal(registration.dialogueId, f.dialogue.id);
    assert.equal(registration.playerAction, false);
    assert.deepEqual(registration.stateIds, []);
    assert.equal(stateExport.interactionCatalog.dialogues[0].id, f.dialogue.id);
    const groupExport = f.editor.exportGroup(f.group.groupId);
    assert.deepEqual(groupExport.objectBindings.bindings["Token:npc"].dialogues[0].stateIds, [other.id]);
    assert.deepEqual(f.scene.flags, before);
  }
});
