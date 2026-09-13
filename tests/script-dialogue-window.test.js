import test from "node:test";
import assert from "node:assert/strict";

class Application {
  constructor(options = {}) { this.options = options; this.rendered = false; }
  async _prepareContext() { return {}; }
  async _onRender() {}
  render() { this.renders = (this.renders ?? 0) + 1; return this; }
  async close() { this.rendered = false; }
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
    nodeId: session.nodeId, step: session.step, status, role: "speaker", text: "Delivered text",
    history: [{ id: "message-1", role: "object", name: "NPC", text: "Delivered text", img: "npc.webp", imageAlignment: "left" }],
    responses: status === "active" ? [{ id: "answer", label: "Answer" }] : [] };
  const calls = [];
  const service = { getContext: (_sceneId, _dialogueId, _groupId, _target, { sessionId } = {}) => ({ scene, runtime, dialogue, target: npc,
    ...(sessionId === session.sessionId ? { session } : {}) }),
    requestStart: async (command) => { calls.push(command); return view; }, leaveSession: async () => {}, refreshSession: async () => structuredClone(view) };
  globalThis.game = { user, users: new Map([[user.id, user]]), settings: { get: () => "dark" } };
  globalThis.canvas = { scene };
  const selection = { sceneId: scene.id, groupId: "group", runId: "run", dialogueId: dialogue.id, target, actorTokenId: pc.id, initialView: view };
  return { service, calls, selection, runtime, session, view, pc, npc, dialogue };
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

test("transcript messages retain order, reply art stays on the right and only the latest prompt offers responses", async () => {
  const f = fixture();
  f.view.history.push({ id: "message-2", role: "player", name: "PC", text: "Answer", img: "hero.webp", imageAlignment: "left" },
    { id: "message-3", role: "object", name: "NPC", text: "New prompt", img: "scene.webp", imageAlignment: "right" });
  const context = await new DialogueApplication(f.service, f.selection)._prepareContext({});
  assert.deepEqual(context.messages.map((message) => message.id), ["message-1", "message-2", "message-3"]);
  assert.deepEqual(context.messages.map((message) => message.imageRight), [false, true, true]);
  assert.deepEqual(context.messages.map((message) => message.responses.length), [0, 0, 1]);
  assert.equal(context.messages[1].img, "hero.webp"); assert.equal(context.canFinish, true);
});

test("listener delivery is authorized by a fresh read and never exposes answer or finish actions", async () => {
  const f = fixture(); f.selection.listenerTokenId = "listener-token";
  f.selection.initialView = { ...f.view, role: "listener", history: [{ id: "forged", text: "Not trusted" }] };
  let read;
  f.service.refreshSession = async (command) => { read = command; return { ...f.view, role: "listener" }; };
  f.service.requestAnswer = f.service.requestFinish = () => assert.fail("listeners cannot submit actions");
  const app = new DialogueApplication(f.service, f.selection), context = await app._prepareContext({});
  assert.equal(read.listenerTokenId, "listener-token"); assert.equal(read.sessionId, f.session.sessionId);
  assert.equal(context.messages[0].text, "Delivered text"); assert.deepEqual(context.responses, []);
  assert.equal(context.listener, true); assert.equal(context.canFinish, false);
  await DialogueApplication.answer.call(app, null, { dataset: { responseId: "answer" } });
  await DialogueApplication.finish.call(app);
  let left;
  f.service.leaveSession = async (command) => { left = command; };
  await app.close(); assert.equal(left.listenerTokenId, "listener-token");
});

test("finishing keeps the same window and transcript visible until close", async () => {
  const f = fixture(), app = new DialogueApplication(f.service, f.selection);
  await app._prepareContext({}); app.rendered = true;
  let finishes = 0, leaves = 0;
  f.service.requestFinish = async (command) => { finishes++; assert.equal(command.sessionId, f.session.sessionId); return { ...app.view, status: "finished", responses: [] }; };
  f.service.leaveSession = async () => { leaves++; };
  await DialogueApplication.finish.call(app);
  const context = await app._prepareContext({});
  assert.equal(finishes, 1); assert.equal(leaves, 0); assert.equal(app.rendered, true);
  assert.equal(context.finished, true); assert.equal(context.canFinish, false); assert.equal(context.messages.length, 1);
  await app.close(); assert.equal(leaves, 1); assert.equal(app.rendered, false);
});

test("finished delivery keeps readable history without a live automation lease", async () => {
  const f = fixture("finished"); f.runtime.halted = true;
  const app = new DialogueApplication(f.service, f.selection), context = await app._prepareContext({});
  assert.equal(context.error, ""); assert.equal(context.finished, true); assert.equal(context.messages.length, 1);
  await app._onRender(context, {}); assert.equal(app.leaseTimer, null);
  f.session.expiresAt = 0; app.rendered = true; f.service.refreshSession = () => null;
  await app.refresh(); assert.equal(app.unavailable, false); assert.equal(app.renders ?? 0, 0);
  assert.equal((await app._prepareContext({})).messages.length, 1);
});

test("header close of an unfinished speaker conversation asks once and honours cancellation", async () => {
  const f = fixture(), app = new DialogueApplication(f.service, f.selection);
  await app._prepareContext({}); app.rendered = true;
  let confirmations = 0, leaves = 0;
  foundry.applications.api.DialogV2 = { confirm: async () => { confirmations++; return false; } };
  f.service.leaveSession = async () => { leaves++; };
  await app.close(); assert.equal(confirmations, 1); assert.equal(leaves, 0); assert.equal(app.rendered, true);
  foundry.applications.api.DialogV2.confirm = async () => { confirmations++; return true; };
  await Promise.all([app.close(), app.close()]);
  assert.equal(confirmations, 2); assert.equal(leaves, 1); assert.equal(app.rendered, false);
});

test("refresh leaves an unchanged transcript and the reader's scroll position alone", async () => {
  const f = fixture(), app = new DialogueApplication(f.service, f.selection);
  await app._prepareContext({}); app.rendered = true;
  const scroller = { scrollTop: 120, scrollHeight: 1800, clientHeight: 400 };
  app.element = { querySelector: () => scroller };
  await app.refresh(); assert.equal(app.renders ?? 0, 0);
  f.view.history.push({ id: "message-2", role: "object", name: "NPC", text: "Later" });
  await app.refresh(); assert.equal(app.renders, 1);
  scroller.scrollTop = 0;
  await app._onRender(await app._prepareContext({}), {});
  assert.equal(scroller.scrollTop, 120);
  clearInterval(app.leaseTimer);
});

test("a late refresh cannot replace a newly answered conversation", async () => {
  const f = fixture(), app = new DialogueApplication(f.service, f.selection);
  await app._prepareContext({}); app.rendered = true;
  let resolveRead;
  f.service.refreshSession = () => new Promise((resolve) => { resolveRead = resolve; });
  const reading = app.refresh();
  f.service.requestAnswer = async () => ({ ...f.view, step: 1, history: [...f.view.history, { id: "answer", role: "player", text: "Chosen" }] });
  await DialogueApplication.answer.call(app, null, { dataset: { responseId: "answer" } });
  resolveRead({ ...f.view, step: 0 }); await reading;
  assert.equal(app.view.step, 1); assert.equal(app.view.history.at(-1).text, "Chosen");
});

test("a vanished dialogue refresh disables actions without losing history or reporting a null error", async () => {
  const f = fixture(), app = new DialogueApplication(f.service, f.selection);
  await app._prepareContext({}); app.rendered = true;
  f.service.refreshSession = () => null;
  await app.refresh();
  const context = await app._prepareContext({});
  assert.equal(context.error, ""); assert.equal(context.unavailable, true);
  assert.equal(context.messages[0].text, "Delivered text"); assert.equal(context.canFinish, false);
  assert.deepEqual(context.responses, []);
  const renders = app.renders; await app.refresh(); assert.equal(app.renders, renders);
});

test("listener admission lost before display neither exposes the envelope nor starts a new dialogue", async () => {
  const f = fixture(); f.selection.initialView = { ...f.view, role: "listener" };
  f.selection.listenerTokenId = "pc2"; f.service.refreshSession = () => null;
  const app = new DialogueApplication(f.service, f.selection), context = await app._prepareContext({});
  assert.equal(context.error, ""); assert.equal(context.unavailable, true); assert.deepEqual(context.messages, []);
  assert.equal(f.calls.length, 0); await app._prepareContext({}); assert.equal(f.calls.length, 0);
  assert.match(app.options.id, /listener-pc2$/);
});

test("refresh coalesces an update arriving while a snapshot is being read", async () => {
  const f = fixture(), app = new DialogueApplication(f.service, f.selection);
  await app._prepareContext({}); app.rendered = true;
  let resolveRead, reads = 0;
  f.service.refreshSession = () => ++reads === 1 ? new Promise((resolve) => { resolveRead = resolve; }) : ({ ...f.view, step: 1 });
  const first = app.refresh(), next = app.refresh();
  resolveRead(f.view); await Promise.all([first, next]);
  assert.equal(reads, 2); assert.equal(app.view.step, 1);
});

test("a delivered script dialogue renders outside player conditions using the stored session origin", async () => {
  const f = fixture(); f.session.origin = "script";
  f.dialogue.enabled = false; f.dialogue.conditions = { enabled: false };
  f.npc.hidden = true; f.npc.x = 100000; f.pc.object.checkCollision = () => true;
  const app = new DialogueApplication(f.service, f.selection);
  const current = await app._prepareContext({});
  assert.equal(current.error, ""); assert.equal(current.responses.length, 1); assert.equal(f.calls.length, 0);
  f.runtime.halted = true;
  assert.ok((await app._prepareContext({})).error);
});

test("a forged view origin does not bypass player conditions", async () => {
  const f = fixture(); f.selection.initialView.origin = "script"; f.npc.hidden = true;
  const current = await new DialogueApplication(f.service, f.selection)._prepareContext({});
  assert.ok(current.error); assert.equal(current.missing, true); assert.equal(f.calls.length, 0);
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
