import test from "node:test";
import assert from "node:assert/strict";

class Application {
  constructor(options) { this.options = options; }
  render() { this.rendered = true; return this; }
  bringToFront() { this.raised = true; }
}
globalThis.foundry = { applications: { api: { ApplicationV2: Application, HandlebarsApplicationMixin: base => base } } };
const { ScreenController } = await import("../dmicher-master-screen/scripts/controller.js");

test("GM entry points open a fresh session snapshot in one dedicated moderator window", () => {
  globalThis.game = { user: { id: "gm", isGM: true }, settings: { get: () => "dark" } };
  const controller = Object.create(ScreenController.prototype), inspected = [];
  controller.dialogueWindows = new Map();
  const command = { sceneId: "scene", groupId: "group", runId: "run", sessionId: "session" };
  let view = { ...command, dialogueId: "dialogue", actorTokenId: "pc", target: { type: "Token", id: "npc" },
    role: "moderator", status: "active", history: [{ id: "line", text: "Committed text" }] };
  controller.dialogues = { inspectSession: packet => { inspected.push(packet); return view; } };
  const first = controller.openModeratorDialogue(command);
  assert.equal(first.moderator, true);
  assert.equal(first.groupId, "group");
  assert.deepEqual(first.initialView, view);
  assert.notEqual(first.initialView, view, "a window cannot mutate the service snapshot");
  assert.equal(controller.openModeratorDialogue(command), first);
  assert.equal(first.raised, true);
  assert.equal(inspected.length, 2, "each entry checks current GM/session access");
  view = null;
  assert.equal(controller.openModeratorDialogue(command), null, "stale notices cannot reopen unavailable sessions");
  game.user.isGM = false;
  assert.throws(() => controller.openModeratorDialogue(command));
  assert.equal(inspected.length, 3, "a player never reaches the privileged reader");
});
