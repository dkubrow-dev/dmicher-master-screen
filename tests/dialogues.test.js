import test from "node:test";
import assert from "node:assert/strict";
import { createDialogueService, validateDialogueAccess } from "../dmicher-master-screen/scripts/dialogues.js";

const MODULE_ID = "dmicher-master-screen";
function fixture({ emitFailure = false } = {}) {
  let serial = 0, locked = false;
  const gm = { id: "gm", isGM: true, role: 4, active: true };
  const player = { id: "player", isGM: false, role: 1, active: true };
  const other = { id: "other", isGM: false, role: 1, active: true };
  const pc = { id: "pc", x: 0, y: 0, width: 1, height: 1,
    actor: { testUserPermission: (user) => user.id === player.id }, object: { checkCollision: () => false } };
  const npc = { id: "npc", name: "Shopkeeper", x: 100, y: 0, width: 1, height: 1, texture: { src: "npc.webp" } };
  const tile = { id: "chest", name: "Chest", x: 100, y: 0, width: 100, height: 100, texture: { src: "chest.webp" } };
  const tags = {};
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: new Map([["pc", pc], ["npc", npc]]), tiles: new Map([["chest", tile]]),
    getFlag: (_module, name) => name === "objectTags" ? { Token: tags } : undefined };
  let runtime = { schemaVersion: 1, runId: "run", schemeId: "main", episodeId: "calm", disabledTokens: [], dialogueSessions: {}, dialogueCommands: {}, episode: {
    dialogues: [{ id: "talk", name: "Conversation", enabled: true, target: { type: "Token", id: "npc" }, range: 5, startNodeId: "start", nodes: [
      { id: "start", text: "Welcome", art: "", responses: [{ id: "ask", label: "Ask", nextNodeId: "info", eventName: "" },
        { id: "alarm", label: "Alarm", nextNodeId: "", eventName: "merchant.alarmed" }] },
      { id: "info", text: "Information", art: "info.webp", responses: [{ id: "finish", label: "Done", nextNodeId: "", eventName: "" }] }
    ] }], interactions: [{ id: "lever", name: "Open", enabled: true, target: { type: "Tile", id: "chest" }, range: 5, eventName: "chest.opened" }]
  } };
  const context = (_sceneId, dialogueId) => {
    const dialogue = runtime.episode.dialogues.find((entry) => entry.id === dialogueId);
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
    lock, authority: () => true, emitEvent: async (_scene, event) => {
      assert.equal(locked, false, "event admission must be outside the Scene lock");
      if (emitFailure) throw new Error("event queue unavailable");
      events.push(structuredClone(event)); return { status: "queued" };
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
  const start = { kind: "start", sceneId: "scene", dialogueId: "talk", actorTokenId: "pc", runId: "run", schemeId: "main" };
  return { service, events, context, pc, npc, tile, scene, tags, gm, player, other, message, send, start, runtime: () => runtime, setRuntime: (state) => { runtime = state; } };
}

test("dialogue advances only on an offered answer and finishes with stable named events", async () => {
  const f = fixture();
  const { result: opened } = await f.send(f.start);
  assert.equal(opened.text, "Welcome");
  assert.equal(opened.art, "npc.webp");
  assert.equal(f.events.length, 0);
  const { result: next } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  assert.equal(next.nodeId, "info");
  assert.equal(next.art, "info.webp");
  const { result: ended } = await f.send({ kind: "answer", sceneId: "scene", sessionId: next.sessionId, responseId: "finish", nodeId: "info", step: 1 });
  assert.equal(ended.status, "finished");
  assert.deepEqual(f.events.map((event) => event.name), ["dialogue.finished"]);
  assert.equal(f.events[0].actorTokenId, "pc");
  assert.equal(f.events[0].payload.userId, f.player.id);
});

test("a terminating answer emits its selected event plus dialogue.finished exactly once", async () => {
  const f = fixture();
  const { result: opened } = await f.send(f.start);
  const command = { kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 };
  const request = f.message(command, { messageId: "same" });
  await f.service.processCommand(request, f.player.id);
  await f.service.processCommand(request, f.player.id);
  assert.deepEqual(f.events.map((event) => event.name), ["merchant.alarmed", "dialogue.finished"]);
  assert.notEqual(f.events[0].id, f.events[1].id);
});

test("leaving or closing a conversation emits no completion event", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  const { result } = await f.send({ kind: "leave", sceneId: "scene", sessionId: opened.sessionId });
  assert.equal(result.status, "left");
  assert.equal(f.events.length, 0);
  const { result: late } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 });
  assert.ok(late.failure);
});

test("reopening an active conversation resumes its node without entry or finish replay", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "ask", nodeId: "start", step: 0 });
  const { result: restored } = await f.send(f.start);
  assert.equal(restored.sessionId, opened.sessionId);
  assert.equal(restored.nodeId, "info");
  assert.equal(f.events.length, 0);
});

test("old steps, unoffered response IDs, changed episodes and another user are rejected", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  const request = { kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 };
  assert.ok((await f.send({ ...request, responseId: "invented" })).result.failure);
  assert.ok((await f.send(request, { user: f.other })).result.failure);
  await f.send({ ...request, responseId: "ask" });
  assert.ok((await f.send(request)).result.failure);
  const runtime = f.runtime(); runtime.runId = "other"; f.setRuntime(runtime);
  assert.ok((await f.send({ ...request, responseId: "finish", nodeId: "info", step: 1 })).result.failure);
  assert.equal(f.events.length, 0);
});

test("Tile interaction emits an event directly and never opens or changes dialogue state", async () => {
  const f = fixture();
  const request = f.message({ kind: "interaction", sceneId: "scene", interactionId: "lever", actorTokenId: "pc", runId: "run" });
  await f.service.processCommand(request, f.player.id);
  await f.service.processCommand(request, f.player.id);
  assert.equal(request.flags.dialogueResult.status, "completed");
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].name, "chest.opened");
  assert.deepEqual(f.events[0].payload.target, { type: "Tile", id: "chest" });
  assert.deepEqual(f.runtime().dialogueSessions, {});
});

test("Tile conversations use the same ownership, hidden, range and wall checks", async () => {
  const f = fixture();
  const runtime = f.runtime(); runtime.episode.dialogues[0].target = { type: "Tile", id: "chest" }; f.setRuntime(runtime);
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

test("event admission failure keeps saved state and diagnostics without replaying completion", async () => {
  const f = fixture({ emitFailure: true }); const { result: opened } = await f.send(f.start);
  const request = f.message({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, responseId: "alarm", nodeId: "start", step: 0 });
  await f.service.processCommand(request, f.player.id);
  assert.equal(request.flags.dialogueResult.status, "finished");
  assert.match(request.flags.dialogueResult.error, /event queue unavailable/);
  assert.match(f.runtime().error, /event queue unavailable/);
  await f.service.processCommand(request, f.player.id);
  assert.equal(request.flags.dialogueResult.status, "finished");
  assert.equal(f.events.length, 0);
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
  assert.equal(f.runtime().triggerCounts[key], 1);
  const { result: resumed } = await f.send(f.start);
  assert.equal(resumed.sessionId, opened.sessionId);
  assert.equal(f.runtime().triggerCounts[key], 1);
  const { result: next } = await f.send({ kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "ask" });
  assert.equal(next.nodeId, "info");
  assert.equal(f.runtime().triggerCounts[key], 1);
  await f.send({ kind: "leave", sceneId: "scene", sessionId: opened.sessionId });
  assert.ok((await f.send(f.start)).result.failure);
  assert.equal(f.events.length, 0);
});

test("deny tags override matching allow tags and reject dialogue/direct actions before any count or event", async () => {
  const f = fixture(); const state = f.runtime();
  state.episode.dialogues[0].trigger = { allowTags: ["trusted"], denyTags: ["wanted"] };
  state.episode.interactions[0].trigger = { allowTags: ["trusted"], denyTags: ["wanted"] };
  f.setRuntime(state); f.tags.pc = ["Trusted", "WANTED"];
  assert.ok((await f.send(f.start)).result.failure);
  await assert.rejects(f.service.requestInteraction({ sceneId: "scene", interactionId: "lever", actorTokenId: "pc" }));
  assert.equal(f.events.length, 0);
  assert.deepEqual(f.runtime().dialogueSessions, {});
  assert.equal(f.runtime().triggerCounts, undefined);
});

test("two participants racing to open a one-use dialogue produce only one admitted session", async () => {
  const f = fixture();
  f.scene.tokens.set("pc2", { ...f.pc, id: "pc2", actor: { testUserPermission: (user) => user.id === f.other.id } });
  const replies = await Promise.all([f.send(f.start), f.send({ ...f.start, actorTokenId: "pc2" }, { user: f.other })]);
  assert.equal(replies.filter(({ result }) => result.status === "active").length, 1);
  assert.equal(replies.filter(({ result }) => result.failure).length, 1);
  assert.equal(f.runtime().triggerCounts["main:calm:dialogue:talk"], 1);
});

test("scope, newly forbidden tags and emergency halt still gate an ongoing dialogue", async () => {
  const f = fixture(); const { result: opened } = await f.send(f.start);
  const request = { kind: "answer", sceneId: "scene", sessionId: opened.sessionId, nodeId: "start", step: 0, responseId: "alarm" };
  let state = f.runtime(); state.episode.dialogues[0].trigger = { denyTags: ["wanted"] }; f.setRuntime(state); f.tags.pc = ["wanted"];
  assert.ok((await f.send(request)).result.failure);
  f.tags.pc = []; state = f.runtime(); state.episode.dialogues[0].trigger = { episodeIds: ["alarm"] }; f.setRuntime(state);
  assert.ok((await f.send(request)).result.failure);
  state = f.runtime(); state.episode.dialogues[0].trigger = {}; state.halted = true; f.setRuntime(state);
  assert.ok((await f.send(request)).result.failure);
  assert.equal((await f.send({ kind: "leave", sceneId: "scene", sessionId: opened.sessionId })).result.status, "left");
  assert.equal(f.events.length, 0);
});

test("direct actions apply their count before event admission and a fresh command cannot exceed it", async () => {
  const f = fixture(); const args = { sceneId: "scene", interactionId: "lever", actorTokenId: "pc" };
  await f.service.requestInteraction(args);
  await assert.rejects(f.service.requestInteraction(args));
  assert.equal(f.events.length, 1);
  assert.equal(f.runtime().triggerCounts["main:calm:interaction:lever"], 1);
});
