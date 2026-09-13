import test from "node:test";
import assert from "node:assert/strict";

class Application {
  constructor(options = {}) { this.options = options; this.rendered = false; }
  async _prepareContext() { return {}; }
  async _onRender() {}
  async close() {}
}
globalThis.foundry = { applications: { api: { ApplicationV2: Application, HandlebarsApplicationMixin: (base) => base } } };
const { DialogueApplication } = await import("../dmicher-master-screen/scripts/apps/dialogue-window.js");

function fixture(status = "active") {
  const user = { id: "player", isGM: false }, target = { type: "Token", id: "npc" };
  const pc = { id: "pc", documentName: "Token", x: 0, y: 0, width: 1, height: 1,
    actor: { id: "actor", testUserPermission: (candidate) => candidate.id === user.id }, object: { checkCollision: () => false } };
  const npc = { id: "npc", documentName: "Token", x: 100, y: 0, width: 1, height: 1 };
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: new Map([[pc.id, pc], [npc.id, npc]]), getFlag: () => undefined };
  const session = { sessionId: "session", runId: "run", groupId: "group", dialogueId: "dialogue", target,
    userId: user.id, actorId: pc.actor.id, actorTokenId: pc.id, nodeId: "page", step: 0, status, expiresAt: Date.now() + 60000 };
  const runtime = { runId: "run", groupId: "group", stateId: "state", state: {}, dialogueSessions: { only: session } };
  const dialogue = { id: "dialogue", enabled: true, target, range: 5, conditions: { repeat: "always" } };
  const view = { sessionId: session.sessionId, dialogueId: dialogue.id, target, actorTokenId: pc.id,
    nodeId: session.nodeId, step: session.step, status, text: "Delivered text", responses: status === "active" ? [{ id: "answer", label: "Answer" }] : [] };
  const calls = [];
  const service = { getContext: () => ({ scene, runtime, dialogue, target: npc }),
    requestStart: async (command) => { calls.push(command); return view; }, leaveSession: async () => {} };
  globalThis.game = { user, users: new Map([[user.id, user]]), settings: { get: () => "dark" } };
  globalThis.canvas = { scene };
  const selection = { sceneId: scene.id, groupId: "group", runId: "run", dialogueId: dialogue.id, target, actorTokenId: pc.id, initialView: view };
  return { service, calls, selection, runtime, session, view, pc };
}

test("delivered active and final dialogue pages use the admitted session without starting it again", async () => {
  for (const status of ["active", "finished"]) {
    const f = fixture(status), app = new DialogueApplication(f.service, f.selection);
    const context = await app._prepareContext({});
    assert.equal(context.text, "Delivered text"); assert.equal(context.error, "");
    assert.equal(context.finished, status === "finished"); assert.equal(f.calls.length, 0);
    await app._prepareContext({}); assert.equal(f.calls.length, 0);
    assert.notEqual(app.view, f.view, "delivery data is copied instead of retaining the mutable envelope");
  }
});

test("an invalid or stale delivered session fails closed instead of falling back to a new start", async () => {
  const changes = [
    (f) => { f.session.userId = "another"; },
    (f) => { f.session.expiresAt = Date.now() - 1; },
    (f) => { f.session.nodeId = "other-page"; },
    (f) => { f.session.step = 3; },
    (f) => { f.session.status = "left"; },
    (f) => { f.session.actorId = "previous-actor"; },
    (f) => { f.runtime.runId = "replacement-run"; },
    (f) => { f.selection.initialView = null; },
    (f) => { f.selection.initialView = { ...f.view, dialogueId: "unattached" }; }
  ];
  for (const change of changes) {
    const f = fixture(), app = new DialogueApplication(f.service, f.selection);
    change(f);
    if (f.selection.initialView !== f.view) app.initialView = f.selection.initialView;
    const context = await app._prepareContext({});
    assert.ok(context.error); assert.equal(context.missing, true); assert.equal(context.text, undefined);
    assert.equal(f.calls.length, 0); await app._prepareContext({}); assert.equal(f.calls.length, 0);
  }
});
