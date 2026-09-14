import test from "node:test";
import assert from "node:assert/strict";
import { createDialogueService, validateDialogueAccess } from "../dmicher-master-screen/scripts/dialogues.js";
import { createGroupDefinition, defaultState } from "../dmicher-master-screen/scripts/model.js";
import { isInteractionPaused } from "../dmicher-master-screen/scripts/interaction-pause.js";

const MODULE_ID = "dmicher-master-screen";
function fixture({ emitFailure = false, signal = async () => ({ status: "done", allowed: true }) } = {}) {
  let serial = 0, locked = false;
  const gm = { id: "gm", isGM: true, role: 4, active: true };
  const player = { id: "player", isGM: false, role: 1, active: true };
  const other = { id: "other", isGM: false, role: 1, active: true };
  const pc = { id: "pc", documentName: "Token", x: 0, y: 0, width: 1, height: 1,
    actor: { id: "actor-pc", testUserPermission: (user) => user.id === player.id }, object: { checkCollision: () => false } };
  const npc = { id: "npc", documentName: "Token", name: "Shopkeeper", x: 100, y: 0, width: 1, height: 1, texture: { src: "npc.webp" } };
  const tile = { id: "chest", documentName: "Tile", name: "Chest", x: 100, y: 0, width: 100, height: 100, texture: { src: "chest.webp" } };
  const tags = {};
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: new Map([["pc", pc], ["npc", npc]]), tiles: new Map([["chest", tile]]),
    getFlag: (_module, name) => name === "objectBindings" ? { bindings: Object.fromEntries(Object.entries(tags).map(([id, values]) => [`Token:${id}`, { type: "Token", id, tags: values }])) }
      : name === "signalCatalog" ? { signals: [{ id: "alarm", name: "merchant.alarmed", emitterKey: "Dialogue:talk" }, { id: "open", name: "chest.opened", emitterKey: "Tile:chest" }] } : undefined };
  let runtime = { schemaVersion: 1, runId: "run", groupId: "main", stateId: "calm", disabledObjects: [], dialogueSessions: {}, dialogueCommands: {}, state: {
    dialogues: [{ id: "talk", name: "Conversation", enabled: true, target: { type: "Token", id: "npc" }, range: 5, startPageId: "start", pages: [
      { id: "start", text: "Welcome", art: "", responses: [{ id: "ask", label: "Ask", nextPageId: "info", signalId: "" },
        { id: "alarm", label: "Alarm", nextPageId: "", signalId: "alarm", parameters: {} }] },
      { id: "info", text: "Information", art: "info.webp", responses: [{ id: "finish", label: "Done", nextPageId: "", signalId: "" }] }
    ] }], interactions: [{ id: "lever", name: "Open", enabled: true, target: { type: "Tile", id: "chest" }, range: 5, signalId: "open", parameters: {} }]
  } };
  const context = (_sceneId, dialogueId) => {
    const dialogue = runtime.state.dialogues.find((entry) => entry.id === dialogueId);
    return { scene, runtime: structuredClone(runtime), dialogue: structuredClone(dialogue),
      target: dialogue?.target.type === "Token" ? scene.tokens.get(dialogue.target.id) : dialogue ? scene.tiles.get(dialogue.target.id) : null };
  };
  let queue = Promise.resolve();
  const lock = (_scene, task) => { const result = queue.then(async () => { locked = true; try { return await task(); } finally { locked = false; } }); queue = result.catch(() => {}); return result; };
  const events = [], messages = new Map();
  globalThis.game = { user: gm, users: new Map([[gm.id, gm], [player.id, player], [other.id, other]]), messages };
  globalThis.canvas = { scene };
  globalThis.foundry ??= {}; foundry.utils = { ...(foundry.utils ?? {}), randomID: () => `id-${++serial}` };
  const service = createDialogueService({ context, runtimeOf: () => structuredClone(runtime), save: async (_scene, state) => { runtime = structuredClone(state); },
    lock, authority: () => true, emitSignal: async (_scene, event) => {
      assert.equal(locked, false, "event admission must be outside the Scene lock");
      if (emitFailure) throw new Error("event queue unavailable");
      events.push(structuredClone(event)); return signal(_scene, event);
    } });
  const message = (command, { user = player, messageId = `message-${++serial}` } = {}) => {
    const flags = { dialogueCommand: structuredClone(command) };
    const record = { id: messageId, author: user, whisper: [gm.id, user.id], flags,
      getFlag: (_module, key) => flags[key], async update(changes) {
        if (changes[`flags.${MODULE_ID}.dialogueResult`]) flags.dialogueResult = structuredClone(changes[`flags.${MODULE_ID}.dialogueResult`]);
      }, async delete() { messages.delete(messageId); } };
    messages.set(messageId, record); return record;
  };
  const send = async (command, options) => {
    const record = message(command, options); await service.processCommand(record, record.author.id); return { result: record.flags.dialogueResult, record };
  };
  const start = { kind: "start", sceneId: "scene", dialogueId: "talk", actorTokenId: "pc", runId: "run", groupId: "main" };
  return { service, events, context, pc, npc, tile, scene, tags, gm, player, other, message, send, start, runtime: () => runtime, setRuntime: (state) => { runtime = state; } };
}

function visibilityFixture(initialMode) {
  const f = fixture(); let mode = initialMode;
  f.player.getFlag = () => mode;
  f.runtime().state.dialogues[0].presentation = { visibility: "player" };
  f.scene.tokens.set("listener", { id: "listener", documentName: "Token", parent: f.scene, x: 0, y: 0, width: 1, height: 1,
    actor: { id: "listener-actor", testUserPermission: user => user.id === f.other.id }, object: { checkCollision: () => false } });
  const listen = sessionId => f.send({ ...f.start, kind: "listen", sessionId, actorTokenId: "listener" }, { user: f.other });
  const refresh = sessionId => {
    game.user = f.other;
    try { return f.service.refreshSession({ ...f.start, sessionId, listenerTokenId: "listener" }); }
    finally { game.user = f.gm; }
  };
  return { ...f, setMode: value => { mode = value; }, listen, refresh };
}

test("a listener joining after private to public sees only public lines, including cached command replies", async () => {
  const f = visibilityFixture("gmroll"), { result: opened } = await f.send(f.start);
  assert.equal(opened.history[0].visibility, "private");
  f.setMode("publicroll");
  await f.send({ ...f.start, kind: "answer", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  const { result, record } = await f.listen(opened.sessionId);
  assert.equal(result.failure, undefined);
  assert.deepEqual(result.history.map(entry => [entry.role, entry.text, entry.visibility]), [["player", "Ask", "public"], ["object", "Information", "public"]]);
  assert.equal(result.text, "Information"); assert.deepEqual(result.responses, []);
  await f.service.processCommand(record, f.other.id);
  assert.deepEqual(record.flags.dialogueResult.history, result.history, "the persisted history-length cache must slice the filtered stream");
  assert.equal(f.refresh(opened.sessionId).history.length, 2);
  for (const entry of Object.values(f.runtime().dialogueSessions)[0].history) delete entry.visibility;
  Object.assign(f.runtime().dialogueCommands[`${f.other.id}:${record.id}`], { text: "Old private fallback", art: "private.webp", audio: "private.ogg" });
  await f.service.processCommand(record, f.other.id);
  assert.deepEqual(record.flags.dialogueResult.history, []);
  assert.equal(record.flags.dialogueResult.text, ""); assert.equal(record.flags.dialogueResult.art, ""); assert.equal(record.flags.dialogueResult.audio, "");
});

test("public to private to public never discloses the private interval to a returning listener", async () => {
  const f = visibilityFixture("publicroll"), { result: opened } = await f.send(f.start);
  const { result: joined } = await f.listen(opened.sessionId);
  assert.deepEqual(joined.history.map(entry => entry.text), ["Welcome"]);
  f.setMode("blindroll");
  await f.send({ ...f.start, kind: "answer", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  assert.equal(f.refresh(opened.sessionId), null);
  f.setMode("publicroll");
  const returned = f.refresh(opened.sessionId);
  assert.deepEqual(returned.history.map(entry => entry.text), ["Welcome"]);
  assert.equal(returned.text, "Welcome"); assert.equal(returned.art, "npc.webp");
  assert.ok(!JSON.stringify(returned).includes("Information")); assert.ok(!JSON.stringify(returned).includes("info.webp"));
  await f.send({ ...f.start, kind: "answer", sessionId: opened.sessionId, responseId: "finish", nodeId: "info", step: 1 });
  assert.deepEqual(f.refresh(opened.sessionId).history.map(entry => entry.text), ["Welcome", "Done"]);
  assert.deepEqual(Object.values(f.runtime().dialogueSessions)[0].history.map(entry => entry.visibility), ["public", "private", "private", "public"]);
});

test("cached listener commands recheck current privacy while speaker replay remains idempotent", async () => {
  const f = visibilityFixture("publicroll"), { result: opened, record: startRecord } = await f.send(f.start);
  const { record } = await f.listen(opened.sessionId);
  f.setMode("gmroll");
  await f.service.processCommand(record, f.other.id);
  assert.match(record.flags.dialogueResult.failure, /no longer have access|доступ/);
  assert.equal(record.flags.dialogueResult.history, undefined);
  await f.service.processCommand(startRecord, f.player.id);
  assert.equal(startRecord.flags.dialogueResult.failure, undefined);
  assert.deepEqual(startRecord.flags.dialogueResult.history, opened.history);
  assert.equal(f.events.filter(event => event.name === "opened").length, 1);
});

test("Debug records dialogue steps and errors without logging lease traffic", async (t) => {
  const f = fixture();
  game.settings = { get: () => true };
  t.mock.method(console, "debug", () => {});
  t.mock.method(console, "error", () => {});
  const { result: opened } = await f.send(f.start);
  assert.ok(console.debug.mock.calls.some((call) => call.arguments[0].endsWith("start.result") && call.arguments[1].nodeId === "start"));
  console.debug.mock.resetCalls();
  await f.send({ ...f.start, kind: "renew", sessionId: opened.sessionId });
  assert.equal(console.debug.mock.callCount(), 0);
  const { result: next } = await f.send({ ...f.start, kind: "answer", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  assert.equal(next.nodeId, "info");
  const accepted = console.debug.mock.calls.find((call) => call.arguments[0].endsWith("answer.result"));
  assert.equal(accepted.arguments[1].step, 1);
  await f.send({ ...f.start, kind: "answer", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  assert.ok(console.error.mock.calls.some((call) => call.arguments[0].endsWith("answer.failed") && call.arguments[1].sessionId === opened.sessionId));
});

test("dialogue advances only on an offered answer and emits typed lifecycle signals", async () => {
  const f = fixture();
  const { result: opened } = await f.send(f.start);
  assert.equal(opened.text, "Welcome");
  assert.equal(opened.art, "npc.webp");
  assert.deepEqual(f.events.map((event) => event.name), ["opened"]);
  const { result: next } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  assert.equal(next.nodeId, "info");
  assert.equal(next.art, "info.webp");
  const { result: ended } = await f.send({ kind: "answer", sceneId: "scene", sessionId: next.sessionId, responseId: "finish", nodeId: "info", step: 1 });
  assert.equal(ended.status, "finished");
  assert.deepEqual(f.events.map((event) => event.name), ["opened", "response", "response", "closed"]);
  assert.equal(f.events[0].parameters.actorUuid, "Actor.actor-pc");
  assert.equal(f.events[0].parameters.userUuid, `User.${f.player.id}`);
  assert.equal(f.events[1].parameters.responseUuid, "Scene.scene.dmicher.Dialogue.talk.Page.start.Response.ask");
});

test("transcript snapshots accepted replies once and preserves prior page text and portraits", async () => {
  const f = fixture(); f.pc.actor.img = "portrait.webp"; f.pc.name = "Player character";
  const { result: opened } = await f.send(f.start);
  assert.deepEqual(opened.history.map(({ role, text }) => ({ role, text })), [{ role: "object", text: "Welcome" }]);
  const state = f.runtime(); state.state.dialogues[0].pages[0].text = "Edited after opening";
  state.state.dialogues[0].pages[1].imageAlignment = "right"; f.setRuntime(state);
  const request = f.message({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 }, { messageId: "history" });
  await f.service.processCommand(request, f.player.id); await f.service.processCommand(request, f.player.id);
  const history = request.flags.dialogueResult.history;
  assert.deepEqual(history.map(({ role, text }) => ({ role, text })), [
    { role: "object", text: "Welcome" }, { role: "player", text: "Ask" }, { role: "object", text: "Information" }
  ]);
  assert.equal(history[1].img, "portrait.webp"); assert.equal(history[1].imageAlignment, "right");
  assert.equal(history[2].imageAlignment, "right"); assert.equal(new Set(history.map(({ id }) => id)).size, 3);
  assert.ok(Object.values(f.runtime().dialogueCommands).every((entry) => !Object.hasOwn(entry, "history")), "command cache must not multiply the transcript");
  await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "finish", nodeId: "info", step: 1 });
  await f.service.processCommand(request, f.player.id);
  assert.deepEqual(request.flags.dialogueResult.history, history, "a replay returns the original transcript prefix, without later replies");
});

function addListener(f) {
  // These scenarios deliberately exercise an open conversation. Unspecified
  // presentation is private and has separate denial coverage.
  f.runtime().state.dialogues[0].presentation = { visibility: "public" };
  const token = { id: "listener", documentName: "Token", name: "Listener", x: 0, y: 0, width: 1, height: 1,
    actor: { id: "listener-actor", testUserPermission: (user) => user.id === f.other.id }, object: { checkCollision: () => false } };
  f.scene.tokens.set(token.id, token); return token;
}

test("a listener receives the history but cannot answer or finish and has an independent lease", async () => {
  const f = fixture(); const listener = addListener(f);
  const { result: opened } = await f.send(f.start);
  const { result: joined } = await f.send({ kind: "listen", sceneId: "scene", sessionId: opened.sessionId, actorTokenId: listener.id }, { user: f.other });
  assert.equal(joined.role, "listener"); assert.equal(joined.actorTokenId, f.pc.id); assert.equal(joined.listenerTokenId, listener.id);
  assert.deepEqual(joined.responses, []); assert.deepEqual(joined.history, opened.history);
  const reader = { sceneId: "scene", sessionId: opened.sessionId, listenerTokenId: listener.id };
  for (const kind of ["answer", "finish"]) assert.ok((await f.send({ ...reader, kind, responseId: "ask", nodeId: "start", step: 0 }, { user: f.other })).result.failure);
  const expiresAt = Object.values(f.runtime().dialogueSessions)[0].expiresAt;
  await f.send({ ...reader, kind: "renew" }, { user: f.other });
  assert.equal(Object.values(f.runtime().dialogueSessions)[0].expiresAt, expiresAt, "a reader cannot keep the speaker's automation paused");
  await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  game.user = f.other;
  const before = structuredClone(f.runtime()), eventCount = f.events.length;
  const latest = f.service.refreshSession(reader);
  assert.equal(latest.history.length, 3); assert.deepEqual(latest.responses, []);
  assert.deepEqual(f.runtime(), before); assert.equal(f.events.length, eventCount, "local refresh emits no commands, events or writes");
  await f.send({ ...reader, kind: "leave" }, { user: f.other });
  assert.equal(Object.values(f.runtime().dialogueSessions)[0].status, "active"); assert.equal(f.service.refreshSession(reader), null);
});

test("listener admission and ongoing reads validate token ownership and the exact stored Actor", async () => {
  const f = fixture(); const token = addListener(f); const { result: opened } = await f.send(f.start);
  const command = { kind: "listen", sceneId: "scene", sessionId: opened.sessionId, actorTokenId: token.id };
  token.x = 1000; assert.ok((await f.send(command, { user: f.other })).result.failure);
  token.x = 0; token.hidden = true; assert.ok((await f.send(command, { user: f.other })).result.failure);
  token.hidden = false; assert.ok((await f.send({ ...command, actorTokenId: f.pc.id }, { user: f.other })).result.failure);
  assert.equal((await f.send(command, { user: f.other })).result.role, "listener");
  game.user = f.other;
  const reader = { ...command, listenerTokenId: token.id };
  token.x = 1000; assert.equal(f.service.refreshSession(reader).role, "listener", "range is a join condition, not a continuous read restriction");
  token.actor = { ...token.actor, id: "replacement" };
  assert.equal(f.service.refreshSession(reader), null);
  assert.ok((await f.send({ ...reader, kind: "renew" }, { user: f.other })).result.failure);
  token.x = 0;
  assert.equal((await f.send(command, { user: f.other })).result.role, "listener", "explicit rejoining admits the new owned Actor");
  assert.equal(f.service.refreshSession(reader).role, "listener");
});

test("finish keeps the transcript and emits closed only once, while later close cannot replay it", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  const command = { sceneId: "scene", sessionId: opened.sessionId };
  const { result: finished } = await f.send({ ...command, kind: "finish" });
  assert.equal(finished.status, "finished"); assert.deepEqual(finished.history, opened.history);
  assert.equal((await f.send({ ...command, kind: "finish" })).result.status, "finished");
  await f.send({ ...command, kind: "leave" });
  assert.deepEqual(f.events.map(({ name }) => name), ["opened", "closed"]);
});
test("response interruption preserves the next page and resumes without another quota use", async () => {
  let interrupt = true;
  const f = fixture({ signal: async (_scene, packet) => ({ status: "done", allowed: true, interrupt: packet.name === "response" && interrupt, exit: false }) });
  const { result: opened } = await f.send(f.start);
  const { result: paused } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "ask" });
  assert.equal(paused.status, "interrupted"); assert.equal(paused.nodeId, "info"); assert.equal(f.events.some((packet) => packet.name === "closed"), false);
  const uses = structuredClone(f.runtime().conditionCounts);
  const { result: resumed } = await f.send(f.start);
  assert.equal(resumed.status, "active"); assert.equal(resumed.nodeId, "info"); assert.equal(resumed.sessionId, opened.sessionId); assert.deepEqual(f.runtime().conditionCounts, uses);
  interrupt = false;
  assert.equal((await f.send({ kind: "answer", sceneId: "scene", sessionId: resumed.sessionId, nodeId: resumed.nodeId, step: resumed.step, responseId: "finish" })).result.status, "finished");
});
test("response exit ends a branching conversation and emits closed", async () => {
  const f = fixture({ signal: async () => ({ status: "done", allowed: true, exit: true, interrupt: false }) });
  const { result: opened } = await f.send(f.start);
  const { result } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "ask" });
  assert.equal(result.status, "finished"); assert.deepEqual(f.events.map((packet) => packet.name), ["opened", "response", "closed"]);
});
test("answer handlers finish outside the scene lock and changing access blocks the saved answer", async () => {
  let begin, release;
  const ready = new Promise((resolve) => { begin = resolve; }), delay = new Promise((resolve) => { release = resolve; });
  const f = fixture({ signal: async (_scene, packet) => { if (packet.name === "response") { begin(); await delay; } return { status: "done", allowed: true }; } });
  const { result: opened } = await f.send(f.start);
  const task = f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "ask" });
  await ready; assert.equal(Object.values(f.runtime().dialogueSessions)[0].status, "processing");
  f.npc.hidden = true; release(); const { result } = await task;
  assert.ok(result.failure); assert.equal(Object.values(f.runtime().dialogueSessions)[0].status, "interrupted"); assert.equal(Object.values(f.runtime().dialogueSessions)[0].nodeId, "start");
});
test("simultaneous duplicate answer messages invoke subscribers only once", async () => {
  const f = fixture(), { result: opened } = await f.send(f.start);
  const message = f.message({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "ask" }, { messageId: "duplicate" });
  await Promise.all([f.service.processCommand(message, f.player.id), f.service.processCommand(message, f.player.id)]);
  assert.equal(f.events.filter((packet) => packet.name === "response").length, 1); assert.equal(message.flags.dialogueResult.nodeId, "info");
});

test("a terminating answer emits its selected signal and closed exactly once", async () => {
  const f = fixture();
  const { result: opened } = await f.send(f.start);
  const command = { kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 };
  const request = f.message(command, { messageId: "same" });
  await f.service.processCommand(request, f.player.id);
  await f.service.processCommand(request, f.player.id);
  assert.deepEqual(f.events.map((event) => event.name), ["opened", "response", "merchant.alarmed", "closed"]);
  assert.notEqual(f.events[0].id, f.events[1].id);
});

test("leaving a conversation emits closed and rejects late answers", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  const { result } = await f.send({ kind: "leave", sceneId: "scene", sessionId: opened.sessionId });
  assert.equal(result.status, "left");
  assert.deepEqual(f.events.map((event) => event.name), ["opened", "closed"]);
  const { result: late } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 });
  assert.ok(late.failure);
});

test("reopening an active conversation resumes its node without entry or finish replay", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  const { result: restored } = await f.send(f.start);
  assert.equal(restored.sessionId, opened.sessionId);
  assert.equal(restored.nodeId, "info");
  assert.deepEqual(f.events.map((event) => event.name), ["opened", "response"]);
});

test("old steps, unoffered response IDs, changed states and another user are rejected", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  const request = { kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 };
  assert.ok((await f.send({ ...request, responseId: "invented" })).result.failure);
  assert.ok((await f.send(request, { user: f.other })).result.failure);
  await f.send({ ...request, responseId: "ask" });
  assert.ok((await f.send(request)).result.failure);
  const runtime = f.runtime(); runtime.runId = "other"; f.setRuntime(runtime);
  assert.ok((await f.send({ ...request, responseId: "finish", nodeId: "info", step: 1 })).result.failure);
  assert.deepEqual(f.events.map((event) => event.name), ["opened", "response"]);
});

test("Tile interaction emits an event directly and never opens or changes dialogue state", async () => {
  const f = fixture();
  const request = f.message({ kind: "interaction", sceneId: "scene", interactionId: "lever", actorTokenId: "pc", runId: "run" });
  await f.service.processCommand(request, f.player.id);
  await f.service.processCommand(request, f.player.id);
  assert.equal(request.flags.dialogueResult.status, "completed");
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].name, "chest.opened");
  assert.equal(f.events[0].emitterKey, "Tile:chest");
  assert.deepEqual(f.runtime().dialogueSessions, {});
});

test("Tile conversations use the same ownership, hidden, range and wall checks", async () => {
  const f = fixture();
  const runtime = f.runtime(); runtime.state.dialogues[0].target = { type: "Tile", id: "chest" }; f.setRuntime(runtime);
  assert.equal((await f.send(f.start)).result.art, "chest.webp");
  f.tile.hidden = true;
  assert.ok((await f.send(f.start)).result.failure);
  f.tile.hidden = false; f.tile.x = 500;
  assert.ok((await f.send(f.start)).result.failure);
  f.tile.x = 100; f.pc.object.checkCollision = () => true;
  assert.ok((await f.send(f.start)).result.failure);
  f.pc.object.checkCollision = () => false;
  assert.ok((await f.send(f.start, { user: f.other })).result.failure);
});

test("server initiating user and message author must match", async () => {
  const f = fixture(); const request = f.message(f.start);
  await f.service.processCommand(request, f.other.id);
  assert.equal(request.flags.dialogueResult, undefined);
  assert.deepEqual(f.runtime().dialogueSessions, {});
});

test("signal failure keeps saved state and diagnostics without replaying completion", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const f = fixture({ emitFailure: true }); const { result: opened } = await f.send(f.start);
  const request = f.message({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 });
  await f.service.processCommand(request, f.player.id);
  assert.equal(request.flags.dialogueResult.status, "finished");
  assert.match(request.flags.dialogueResult.error, /event queue unavailable/);
  assert.match(f.runtime().error, /event queue unavailable/);
  await f.service.processCommand(request, f.player.id);
  assert.equal(request.flags.dialogueResult.status, "finished");
  assert.equal(f.events.length, 0);
  assert.equal(errors.mock.callCount(), 4);
});

test("GM direct interaction still requires a current PC and obeys range", async () => {
  const f = fixture();
  assert.equal((await f.service.requestInteraction({ sceneId: "scene", interactionId: "lever", actorTokenId: "pc" })).status, "completed");
  f.tile.x = 1000;
  await assert.rejects(f.service.requestInteraction({ sceneId: "scene", interactionId: "lever", actorTokenId: "pc" }));
  assert.equal(f.events.length, 1);
});

test("dialogue admission consumes once; reopening and answers keep working at the default one-use limit", async () => {
  const f = fixture();
  const { result: opened } = await f.send(f.start);
  const key = "main:calm:dialogue:talk";
  assert.equal(f.runtime().conditionCounts[key], 1);
  const { result: resumed } = await f.send(f.start);
  assert.equal(resumed.sessionId, opened.sessionId);
  assert.equal(f.runtime().conditionCounts[key], 1);
  const { result: next } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "ask" });
  assert.equal(next.nodeId, "info");
  assert.equal(f.runtime().conditionCounts[key], 1);
  await f.send({ kind: "leave", sceneId: "scene", sessionId: opened.sessionId });
  assert.ok((await f.send(f.start)).result.failure);
  assert.deepEqual(f.events.map((event) => event.name), ["opened", "response", "closed"]);
});

test("deny tags override matching allow tags and reject dialogue/direct actions before any count or event", async () => {
  const f = fixture(); const state = f.runtime();
  state.state.dialogues[0].conditions = { allowTags: ["trusted"], denyTags: ["wanted"] };
  state.state.interactions[0].conditions = { allowTags: ["trusted"], denyTags: ["wanted"] };
  f.setRuntime(state); f.tags.pc = ["Trusted", "WANTED"];
  assert.ok((await f.send(f.start)).result.failure);
  await assert.rejects(f.service.requestInteraction({ sceneId: "scene", interactionId: "lever", actorTokenId: "pc" }));
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.runtime().dialogueSessions, {});
  assert.equal(f.runtime().conditionCounts, undefined);
});

test("two participants racing to open a one-use dialogue produce only one admitted session", async () => {
  const f = fixture();
  f.scene.tokens.set("pc2", { ...f.pc, id: "pc2", actor: { id: "actor-pc2", testUserPermission: (user) => user.id === f.other.id } });
  const replies = await Promise.all([f.send(f.start), f.send({ ...f.start, actorTokenId: "pc2" }, { user: f.other })]);
  assert.equal(replies.filter(({ result }) => result.status === "active").length, 1);
  assert.equal(replies.filter(({ result }) => result.failure).length, 1);
  assert.equal(f.runtime().conditionCounts["main:calm:dialogue:talk"], 1);
});

test("scope, newly forbidden tags and emergency halt still gate an ongoing dialogue", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  const request = { kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "alarm" };
  let state = f.runtime(); state.state.dialogues[0].conditions = { denyTags: ["wanted"] }; f.setRuntime(state); f.tags.pc = ["wanted"];
  assert.ok((await f.send(request)).result.failure);
  f.tags.pc = []; state = f.runtime(); state.state.dialogues[0].conditions = { stateIds: ["alarm"] }; f.setRuntime(state);
  assert.ok((await f.send(request)).result.failure);
  state = f.runtime(); state.state.dialogues[0].conditions = {}; state.halted = true; f.setRuntime(state);
  assert.ok((await f.send(request)).result.failure);
  assert.equal((await f.send({ kind: "leave", sceneId: "scene", sessionId: opened.sessionId })).result.status, "left");
  assert.deepEqual(f.events.map((event) => event.name), ["opened", "closed"]);
});

test("direct actions apply their count before event admission and a fresh command cannot exceed it", async () => {
  const f = fixture(); const args = { sceneId: "scene", interactionId: "lever", actorTokenId: "pc" };
  await f.service.requestInteraction(args);
  await assert.rejects(f.service.requestInteraction(args));
  assert.equal(f.events.length, 1);
  assert.equal(f.runtime().conditionCounts["main:calm:interaction:lever"], 1);
});

test("an ongoing dialogue requires its exact stored Actor and object identities", async () => {
  for (const field of ["actorId", "target"]) {
    const f = fixture(), { result: opened } = await f.send(f.start);
    const state = f.runtime(), session = Object.values(state.dialogueSessions)[0]; delete session[field]; f.setRuntime(state);
    const { result } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "ask" });
    assert.ok(result.failure, field); assert.equal(f.events.length, 1);
    assert.equal(Object.values(f.runtime().dialogueSessions)[0].nodeId, "start");
  }
});

test("finishing a dialogue releases its pause while keeping history, and close cannot replay signals", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  for (const throughAnswer of [false, true]) {
    const f = fixture();
    const dialogue = f.runtime().state.dialogues[0];
    dialogue.pages[0].responses = throughAnswer ? [{ id: "finish", label: "Finish", nextPageId: "", signalId: "" }] : [];
    const definition = createGroupDefinition({ groupId: "main", state: defaultState("Calm", "calm") });
    const getFlag = f.scene.getFlag;
    f.scene.getFlag = (scope, key) => key === "groupDefinitions" ? { main: definition }
      : key === "groupRuntimes" ? { main: f.runtime() } : getFlag(scope, key);
    const { result: opened } = await f.send(f.start);
    const finished = throughAnswer
      ? (await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "finish", nodeId: "start", step: 0 })).result
      : opened;
    assert.equal(finished.status, "finished");
    assert.equal(isInteractionPaused(f.scene, { type: "Token", id: "npc" }), false);
    const before = structuredClone(Object.values(f.runtime().dialogueSessions)[0]);
    now += 30_000;
    const { result: renewed } = await f.send({ kind: "renew", sceneId: "scene", sessionId: finished.sessionId, target: { type: "Token", id: "npc" } });
    assert.ok(renewed.failure);
    assert.deepEqual(Object.values(f.runtime().dialogueSessions)[0], before);
    assert.equal(isInteractionPaused(f.scene, { type: "Token", id: "npc" }), false);
    assert.equal(f.events.filter((event) => event.name === "closed").length, 1);
    const leave = { kind: "leave", sceneId: "scene", sessionId: finished.sessionId };
    assert.equal((await f.send(leave)).result.status, "left");
    assert.equal(Object.values(f.runtime().dialogueSessions)[0].status, "left");
    assert.equal(isInteractionPaused(f.scene, { type: "Token", id: "npc" }), false);
    assert.equal((await f.send(leave)).result.status, "left");
    assert.equal(f.events.filter((event) => event.name === "closed").length, 1);
  }
});
