import test from "node:test";
import assert from "node:assert/strict";
import { sceneFixture, descriptor, dialogueData, shopData, clone } from "./fixtures/scene.js";
import { registeredToolIds, toolRegistration, normalizeObjectBinding } from "../dmicher-master-screen/scripts/object-binding-model.js";
import { resolveObjectTools, resolveRegisteredObjectDialogue } from "../dmicher-master-screen/scripts/scene-objects.js";

test("registration before assigning a group grants no player action and does not create automation", async () => {
  const f = sceneFixture(), dialogue = await f.assets.saveDialogue(dialogueData()), shop = await f.assets.saveShop(shopData());
  await f.objects.save(descriptor, { dialogues: [toolRegistration("dialogue", dialogue.id)], shops: [toolRegistration("shop", shop.id)] });
  const binding = f.objects.get(descriptor);
  assert.equal(binding.groupId, null);
  assert.deepEqual(registeredToolIds(binding, "dialogue"), [dialogue.id]);
  assert.deepEqual(resolveObjectTools(f.scene, descriptor, { groupId: "main", stateId: "calm" }, "dialogue"), []);
  assert.equal(f.editor.list().length, 0);
});

test("registered tools are shared by scripts and separately gated player assignments", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), dialogue = await f.assets.saveDialogue(dialogueData());
  const registration = toolRegistration("dialogue", dialogue.id);
  await f.objects.save(descriptor, { groupId: group.groupId, dialogues: [registration] });
  const context = { groupId: group.groupId, stateId: group.entryStateId };
  assert.deepEqual(resolveObjectTools(f.scene, descriptor, context, "dialogue"), []);
  assert.equal(resolveRegisteredObjectDialogue(f.scene, descriptor, context, dialogue.id).asset.id, dialogue.id);
  assert.equal(resolveRegisteredObjectDialogue(f.scene, descriptor, { groupId: "other" }, dialogue.id), null);
  await f.objects.save(descriptor, { dialogues: [registration, { dialogueId: dialogue.id, stateIds: [group.entryStateId], conditions: { enabled: false, allowTags: ["special"] } }] });
  assert.deepEqual(registeredToolIds(f.objects.get(descriptor), "dialogue"), [dialogue.id]);
  const player = resolveObjectTools(f.scene, descriptor, context, "dialogue");
  assert.equal(player.length, 1);
  assert.equal(player[0].config.conditions.enabled, false);
  assert.deepEqual(player[0].config.conditions.allowTags, ["special"]);
  assert.equal(resolveRegisteredObjectDialogue(f.scene, descriptor, context, dialogue.id).config.conditions, undefined);
});

test("deleting a state or detaching a group retains registration without player access", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup(), dialogue = await f.assets.saveDialogue(dialogueData());
  const state = await f.editor.createState(group.groupId, { name: "Extra" });
  await f.objects.save(descriptor, { groupId: group.groupId, dialogues: [{ dialogueId: dialogue.id, stateIds: [state.id] }] });
  await f.editor.deleteState(group.groupId, state.id);
  assert.equal(f.objects.get(descriptor).dialogues[0].playerAction, false);
  await f.objects.save(descriptor, { groupId: null }, { allowReassign: true });
  const binding = f.objects.get(descriptor);
  assert.equal(binding.groupId, null);
  assert.deepEqual(registeredToolIds(binding, "dialogue"), [dialogue.id]);
});

test("reading current tool assignments preserves their fields and never mutates preparation", () => {
  const raw = { ...descriptor, dialogues: [{ dialogueId: "talk", stateIds: ["calm"], range: 8, conditions: { repeat: "always" } }] }, before = clone(raw);
  const binding = normalizeObjectBinding(raw);
  assert.equal(binding.dialogues[0].playerAction, undefined);
  assert.deepEqual(registeredToolIds(binding, "dialogue"), ["talk"]);
  assert.deepEqual(raw, before);
  assert.throws(() => normalizeObjectBinding({ ...descriptor, dialogues: [{ dialogueId: "talk", playerAction: "false" }] }));
});
