import test from "node:test";
import assert from "node:assert/strict";
import { commandFixture } from "./fixtures/object-commands.js";
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base } } };
const { ScreenController } = await import("../dmicher-master-screen/scripts/controller.js");

test("closed-screen GM menu has character header and separate third-level GM commands", async () => {
  const f = await commandFixture({ commands:["wait"] });
  const controller = Object.create(ScreenController.prototype); controller.mode = null;
  controller.runtime = { commandExecutor:f.executor }; controller.getAvailableInteractions = () => [];
  controller.getActingTokenId = () => f.pc.id;
  let captured; controller.objectMenu = { open: (items, options) => captured = { items, options }, close() {} };
  assert.equal(await controller.openObjectMenu({ type:"Token", id:f.npc.id }), true);
  assert.equal(captured.options.header.actor, "pc"); assert.equal(captured.options.header.target, "Influence npc");
  const commands = captured.items.find(item => item.label === "Commands").children;
  const master = commands.find(item => item.label === "As GM"); assert.equal(master.gmOnly, true);
  assert.ok(master.children.every(item => item.gmOnly));
  assert.ok(commands.some(item => item.label === "Wait here" && !item.gmOnly));
  assert.ok(commands.every(item => !item.label.includes("As character")));
});
test("GM without selected or targeted character never borrows the only player token", async () => {
  const f = await commandFixture();
  const controller = Object.create(ScreenController.prototype); controller.getPlayerTokens = () => [f.pc];
  assert.equal(controller.getActingTokenId(undefined, f.npc.id), undefined);
  game.user.targets = new Set([f.pc]); assert.equal(controller.getActingTokenId(undefined, f.npc.id), f.pc.id);
});
