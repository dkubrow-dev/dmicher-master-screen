import test from "node:test";
import assert from "node:assert/strict";
import { createDialogueService, validateScriptDialogueAccess } from "../dmicher-master-screen/scripts/dialogues.js";
import { planScriptDialogues, scriptDialogueRecipient, scriptDialoguesPending } from "../dmicher-master-screen/scripts/script-dialogues.js";
import { createGroupDefinition } from "../dmicher-master-screen/scripts/model.js";
import { isInteractionPaused, beginInteractionPause } from "../dmicher-master-screen/scripts/interaction-pause.js";

const MODULE_ID = "dmicher-master-screen", clone = (value) => structuredClone(value);
function fixture({ onSignal = () => {}, realContext = false, presentScriptChat } = {}) {
  let serial = 0, runtime, locked = false, queue = Promise.resolve();
  const gm = { id: "gm", isGM: true, role: 4, active: true };
  const player = { id: "player", isGM: false, role: 1, active: true, character: "actor-pc" };
  const other = { id: "other", isGM: false, role: 1, active: true };
  const pc = { id: "pc", documentName: "Token", x: 0, y: 0, width: 1, height: 1,
    actor: { id: "actor-pc", ownership: { player: 3 }, testUserPermission: (user) => user.id === player.id },
    object: { checkCollision: () => false } };
  const second = { ...pc, id: "second", actor: { id: "actor-second", ownership: { other: 3 }, testUserPermission: (user) => user.id === other.id } };
  const npc = { id: "npc", documentName: "Token", name: "Speaker", x: 100, y: 0, width: 1, height: 1 };
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: new Map([pc, second, npc].map((entry) => [entry.id, entry])),
    getFlag: (_module, key) => key === "groupDefinitions" ? { main: definition } : key === "groupRuntimes" ? { main: runtime }
      : key === "objectBindings" ? { bindings: { "Token:npc": binding } } : key === "interactionCatalog" ? { dialogues: [dialogue] } : undefined };
  for (const token of scene.tokens.values()) { token.parent = scene; token.uuid = `Scene.scene.Token.${token.id}`; }
  const definition = createGroupDefinition(); definition.states[0].id = "calm"; definition.entryStateId = "calm";
  const dialogue = { id: "talk", name: "Conversation", enabled: true, target: { type: "Token", id: "npc" }, range: 5,
    conditions: { repeat: "always" }, startPageId: "start", pages: [{ id: "start", text: "Welcome", art: "",
      responses: [{ id: "finish", label: "Done", nextPageId: "", signalId: "" }] }] };
  const binding = { type: "Token", id: "npc", groupId: "main", dialogues: [{ dialogueId: "talk", stateIds: [], conditions: { repeat: "always" } }] };
  runtime = { schemaVersion: 1, runId: "run", groupId: "main", stateId: "calm", disabledObjects: [], dialogueSessions: {}, dialogueCommands: {}, state: { ...definition.states[0], dialogues: [dialogue] } };
  globalThis.game = { user: gm, users: new Map([gm, player, other].map((user) => [user.id, user])), scenes: new Map([[scene.id, scene]]), messages: new Map() };
  globalThis.canvas = { scene };
  globalThis.foundry ??= {}; foundry.utils = { ...(foundry.utils ?? {}), randomID: () => `id-${++serial}` };
  const context = (sceneId, dialogueId, groupId, target) => ({ scene: sceneId === scene.id ? scene : null, runtime: clone(runtime),
    dialogue: sceneId === scene.id && groupId === "main" && dialogueId === dialogue.id && target?.type === "Token" && target.id === npc.id ? clone(dialogue) : null,
    target: target?.type === "Token" ? scene.tokens.get(target.id) : null });
  const messages = [], windows = [], signals = [];
  const chat = { create: async (data, options) => {
    data.flags["dmicher-generics"] = { chat: { apiVersion: 1, ownerId: MODULE_ID, channel: "scene-input", kind: options.kind, technical: options.technical } };
    const message = { id: `message-${++serial}`, author: game.user, whisper: options.audience.userIds,
      ...data, getFlag: (moduleId, key) => data.flags?.[moduleId]?.[key] };
    messages.push(message); return [message];
  } };
  const lock = (_scene, task) => {
    const result = queue.then(async () => { locked = true; try { return await task(); } finally { locked = false; } });
    queue = result.catch(() => {}); return result;
  };
  const service = createDialogueService({ ...(realContext ? {} : { context, scriptContext: context }), runtimeOf: () => clone(runtime), save: async (_scene, state) => { runtime = clone(state); }, lock,
    authority: () => game.user.id === gm.id, messageService: chat, presentScriptChat,
    openScriptWindow: async (command, view) => { windows.push({ command, view }); },
    emitSignal: async (_scene, signal) => { assert.equal(locked, false); signals.push(signal); await onSignal(signal); return { status: "done", allowed: true }; } });
  const command = { sceneId: scene.id, groupId: "main", runId: "run", target: { type: "Token", id: npc.id }, dialogueId: dialogue.id, tokenUuids: [pc.uuid] };
  const send = async (command, user = player) => {
    let result;
    const message = { id: `request-${++serial}`, author: user, whisper: [gm.id], getFlag: () => command,
      update: async (value) => { result = value[`flags.${MODULE_ID}.dialogueResult`]; }, delete: async () => {} };
    await service.processCommand(message, user.id); return result;
  };
  return { gm, player, other, pc, second, npc, scene, dialogue, binding, service, send, command, context, messages, windows, signals,
    runtime: () => runtime, setRuntime: (value) => { runtime = value; } };
}

test("script dialogue creates real owner sessions and delivers each only to its addressed player", async () => {
  const f = fixture();
  const sessions = await f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.pc.uuid, f.second.uuid, f.pc.uuid] });
  assert.deepEqual(sessions.map(({ userId, actorTokenId }) => ({ userId, actorTokenId })), [
    { userId: f.player.id, actorTokenId: f.pc.id }, { userId: f.other.id, actorTokenId: f.second.id }
  ]);
  assert.equal(f.windows.length, 0, "the initiating GM is not an implicit recipient");
  assert.deepEqual(f.signals.map((signal) => signal.parameters.userUuid), ["User.player", "User.other"]);
  assert.deepEqual(f.messages.map((message) => message.whisper), [[f.player.id], [f.other.id]]);
  assert.equal(isInteractionPaused(f.scene, f.command.target), true);
  game.user = f.player;
  assert.equal(await f.service.processScriptInvitation(f.messages[0], f.gm.id), true);
  assert.equal(await f.service.processScriptInvitation(f.messages[0], f.gm.id), true);
  assert.equal(await f.service.processScriptInvitation(f.messages[1], f.gm.id), false);
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].view.sessionId, sessions[0].sessionId);
  assert.equal(f.signals.length, 2, "delivery and repeat delivery never start the dialogue again");
});

test("script dialogue batch neither checks nor spends player interaction quota", async () => {
  const f = fixture(); f.dialogue.conditions = { repeat: "count", limit: 1 };
  f.runtime().conditionCounts = { "main:calm:dialogue:talk": 1 };
  const before = clone(f.runtime().conditionCounts);
  const result = await f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.pc.uuid, f.second.uuid] });
  assert.equal(result.length, 2); assert.equal(f.signals.length, 2);
  await f.service.startScriptDialogues(f.command);
  assert.equal(f.signals.length, 2, "reopening the same session does not replay its opening");
  assert.deepEqual(f.runtime().conditionCounts, before);
});

test("script dialogue requires a currently attached dialogue and exact current-scene token UUIDs", async () => {
  for (const change of [
    { dialogueId: "another" }, { target: { type: "Token", id: "second" } }, { runId: "old-run" },
    { tokenUuids: ["pc"] }, { tokenUuids: ["Actor.actor-pc"] }, { tokenUuids: ["Scene.other.Token.pc"] },
    { tokenUuids: ["Scene.scene.Token.missing"] }, { tokenUuids: [null] }
  ]) {
    const f = fixture();
    await assert.rejects(f.service.startScriptDialogues({ ...f.command, ...change }));
    assert.equal(f.messages.length, 0); assert.equal(f.signals.length, 0);
  }
});

test("GM script ignores every player condition while delivery, renewal and answers keep their admitted origin", async () => {
  const f = fixture();
  f.dialogue.enabled = false; f.dialogue.range = 0;
  f.dialogue.conditions = { enabled: false, groupIds: ["elsewhere"], stateIds: ["later"], allowTags: ["missing"], denyTags: ["present"], repeat: "count", limit: 1 };
  f.npc.hidden = true; f.npc.x = 100000; f.npc.level = "upstairs";
  f.pc.hidden = true; f.pc.level = "downstairs"; f.pc.object.checkCollision = () => true;
  const [reference] = await f.service.startScriptDialogues(f.command);
  const session = Object.values(f.runtime().dialogueSessions)[0];
  assert.equal(session.origin, "script");
  game.user = f.player;
  assert.equal(await f.service.processScriptInvitation(f.messages[0], f.gm.id), true);
  const current = f.service.getContext(f.scene.id, f.dialogue.id, "main", f.command.target, { sessionId: session.sessionId });
  assert.equal(current.session.origin, "script");
  game.user = f.gm;
  const renewed = await f.send({ kind: "renew", sceneId: f.scene.id, groupId: "main", sessionId: reference.sessionId });
  assert.equal(renewed.status, "active");
  const answered = await f.send({ kind: "answer", sceneId: f.scene.id, groupId: "main", sessionId: reference.sessionId, nodeId: "start", step: 0, responseId: "finish" });
  assert.equal(answered.status, "finished"); assert.deepEqual(f.runtime().conditionCounts ?? {}, {});
});

test("registration without a player action is sufficient for a script and remains unavailable to player starts", async () => {
  const f = fixture({ realContext: true });
  f.binding.dialogues = [{ dialogueId: "talk", playerAction: false, stateIds: ["later"], conditions: { enabled: false } }];
  assert.equal(f.service.getContext("scene", "talk", "main", f.command.target).dialogue, null);
  const [reference] = await f.service.startScriptDialogues(f.command);
  assert.ok(reference.sessionId);
  const current = f.service.getContext("scene", "talk", "main", f.command.target, { sessionId: reference.sessionId });
  assert.equal(current.dialogue.id, "talk"); assert.equal(current.session.origin, "script");
  const result = await f.send({ ...f.command, kind: "start", actorTokenId: "pc", origin: "script", scriptStart: true });
  assert.ok(result.failure); assert.equal(f.signals.length, 1);
  const renewed = await f.send({ kind: "renew", sceneId: "scene", groupId: "main", sessionId: reference.sessionId });
  assert.equal(renewed.status, "active");
});

test("unregistered or reassigned dialogues cannot be started or continued by a script", async () => {
  const f = fixture({ realContext: true });
  f.binding.dialogues = [];
  await assert.rejects(f.service.startScriptDialogues(f.command));
  f.binding.dialogues = [{ dialogueId: "talk", playerAction: false }];
  const [reference] = await f.service.startScriptDialogues(f.command);
  f.binding.groupId = "another";
  const result = await f.send({ kind: "renew", sceneId: "scene", groupId: "main", sessionId: reference.sessionId });
  assert.ok(result.failure);
});

test("player commands cannot forge script provenance on a new or existing player session", async () => {
  const f = fixture();
  const start = { ...f.command, kind: "start", actorTokenId: f.pc.id, origin: "script", scriptStart: true };
  f.dialogue.enabled = false;
  assert.ok((await f.send(start)).failure); assert.deepEqual(f.runtime().dialogueSessions, {});
  f.dialogue.enabled = true;
  const opened = await f.send(start);
  assert.equal(Object.values(f.runtime().dialogueSessions)[0].origin, "player");
  f.npc.hidden = true;
  assert.ok((await f.send({ kind: "renew", sceneId: "scene", groupId: "main", sessionId: opened.sessionId, origin: "script", scriptStart: true })).failure);
  assert.equal(Object.values(f.runtime().dialogueSessions)[0].origin, "player");
});

test("script sessions retain ownership, current run, emergency halt and source automation barriers", async () => {
  for (const change of [
    (f) => { f.runtime().halted = true; },
    (f) => { f.runtime().disabledObjects = ["Token:npc"]; },
    (f) => { f.binding.playerCharacter = true; },
    (f) => { f.runtime().runId = "new-run"; },
    (f) => { f.scene.tokens.delete("pc"); },
    (f) => { f.pc.actor.testUserPermission = () => false; }
  ]) {
    const f = fixture(), [reference] = await f.service.startScriptDialogues(f.command);
    change(f);
    assert.ok((await f.send({ kind: "renew", sceneId: "scene", groupId: "main", sessionId: reference.sessionId })).failure);
  }
});

test("recipient choice ignores technical and offline users and never uses implicit GM ownership", () => {
  const f = fixture();
  const managed = { id: "bot", active: true, isGM: false, character: f.pc.actor.id,
    flags: { "dmicher-generics": { managedIdentity: { version: 1, ownerId: "dmicher-generics", key: "informer" } } } };
  f.pc.actor.testUserPermission = () => true;
  assert.equal(scriptDialogueRecipient(f.pc, [managed, f.other, f.player]), f.player);
  f.player.active = false; f.other.active = false;
  assert.equal(scriptDialogueRecipient(f.pc, [managed, f.player, f.other, f.gm]), null);
  f.pc.actor.ownership.gm = 3;
  assert.equal(scriptDialogueRecipient(f.pc, [managed, f.gm]), f.gm);
  delete f.pc.actor.ownership.gm; f.gm.character = f.pc.actor;
  assert.equal(scriptDialogueRecipient(f.pc, [f.gm]), f.gm);
});

test("script invitation authenticates author, addressed user and live session before showing content", async () => {
  const f = fixture(); await f.service.startScriptDialogues(f.command);
  const original = f.messages[0]; game.user = f.player;
  assert.equal(await f.service.processScriptInvitation(original, f.other.id), false);
  assert.equal(await f.service.processScriptInvitation({ ...original, author: f.other }, f.other.id), false);
  assert.equal(await f.service.processScriptInvitation({ ...original, whisper: [f.gm.id] }, f.gm.id), false);
  assert.equal(await f.service.processScriptInvitation({ ...original, visible: false }, f.gm.id), false);
  const missingMetadata = { ...original, getFlag: (moduleId, key) => moduleId === MODULE_ID ? original.getFlag(moduleId, key) : undefined, flags: {} };
  assert.equal(await f.service.processScriptInvitation(missingMetadata, f.gm.id), false);
  const state = f.runtime(); Object.values(state.dialogueSessions)[0].status = "left";
  assert.equal(await f.service.processScriptInvitation(original, f.gm.id), false);
  assert.equal(f.windows.length, 0);
});

test("script start is authority-only and stale execution cannot open a session", async () => {
  const f = fixture(); game.user = f.player;
  await assert.rejects(f.service.startScriptDialogues(f.command));
  game.user = f.gm;
  assert.deepEqual(await f.service.startScriptDialogues(f.command, { isCurrent: () => false }), []);
  assert.deepEqual(f.runtime().dialogueSessions, {});
});

test("a script admission callback receives its already-opened sessions without exempting other sessions", async () => {
  const f = fixture(), seen = [];
  const refs = await f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.pc.uuid, f.second.uuid] }, {
    isCurrent: (opened) => { seen.push(opened.length); return !isInteractionPaused(f.scene, f.command.target, Date.now(), { excludeDialogueSessions: opened }); }
  });
  assert.equal(refs.length, 2); assert.deepEqual([...new Set(seen)], [0, 1, 2]);
  assert.equal(f.messages.length, 2);
});

test("default scripted dialogue presents in chat and preserves its own admitted script session", async () => {
  const presented = [], seen = [];
  const f = fixture({ presentScriptChat: async (command, view) => presented.push({ command, view }) });
  const refs = await f.service.startScriptDialogues(f.command, { isCurrent: opened => {
    seen.push(opened.length); return !isInteractionPaused(f.scene, f.command.target, Date.now(), { excludeDialogueSessions: opened });
  } });
  assert.equal(presented.length, 1); assert.equal(presented[0].view.presentation.mode, "chat");
  assert.equal(presented[0].view.sessionId, refs[0].sessionId); assert.deepEqual([...new Set(seen)], [0, 1]);
  assert.equal(f.messages.length, 0); assert.equal(f.windows.length, 0);
  assert.equal(isInteractionPaused(f.scene, f.command.target, Date.now(), { excludeDialogueSessions: refs }), false);
  assert.equal(scriptDialoguesPending(f.runtime(), refs), true);
});

test("chat presentation waits for delivery admission without recreating the paused session", async () => {
  const gate = admissionGate(), presented = [];
  const f = fixture({ onSignal: signal => { if (signal.name === "opened") gate.pause(); },
    presentScriptChat: async (command, view) => presented.push({ command, view }) });
  const task = f.service.startScriptDialogues(f.command, gate); await flush();
  const original = Object.values(f.runtime().dialogueSessions)[0]; assert.ok(original);
  assert.equal(presented.length, 0); assert.equal(f.messages.length, 0); assert.equal(f.windows.length, 0);
  gate.resume(); const refs = await task;
  assert.equal(presented.length, 1); assert.equal(presented[0].view.sessionId, original.sessionId);
  assert.equal(refs[0].sessionId, original.sessionId); assert.equal(f.signals.filter(signal => signal.name === "opened").length, 1);
  assert.equal(f.messages.length, 0); assert.equal(f.windows.length, 0);
});

test("script dialogue waits for completion and scoped pause excludes only its exact sessions", async () => {
  const f = fixture(), sessions = await f.service.startScriptDialogues(f.command), now = Date.now();
  assert.equal(scriptDialoguesPending(f.runtime(), sessions, now), true);
  assert.equal(isInteractionPaused(f.scene, f.command.target, now, { excludeDialogueSessions: sessions }), false);
  const release = beginInteractionPause(f.scene, f.command.target);
  assert.equal(isInteractionPaused(f.scene, f.command.target, now, { excludeDialogueSessions: sessions }), true);
  release();
  assert.equal(isInteractionPaused(f.scene, f.command.target, now, { excludeDialogueSessions: [{ ...sessions[0], userId: "stranger" }] }), true);
  const session = Object.values(f.runtime().dialogueSessions)[0];
  session.status = "interrupted";
  assert.equal(scriptDialoguesPending(f.runtime(), sessions, now), true);
  assert.equal(isInteractionPaused(f.scene, f.command.target, now), false);
  session.status = "finished";
  assert.equal(scriptDialoguesPending(f.runtime(), sessions, now), false);
  assert.equal(isInteractionPaused(f.scene, f.command.target, now), false);
  session.status = "left";
  assert.equal(scriptDialoguesPending(f.runtime(), sessions, now), false);
  session.status = "active"; session.expiresAt = now - 1;
  assert.equal(scriptDialoguesPending(f.runtime(), sessions, now), false);
});

test("another character's session and a shop keep the source paused despite script exclusions", async () => {
  const f = fixture();
  const own = await f.service.startScriptDialogues(f.command);
  await f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.second.uuid] });
  assert.equal(isInteractionPaused(f.scene, f.command.target, Date.now(), { excludeDialogueSessions: own }), true);
  f.runtime().dialogueSessions = {};
  f.runtime().shopSessions = { trade: { sessionId: "shop", status: "pending", runId: "run", target: f.command.target } };
  assert.equal(isInteractionPaused(f.scene, f.command.target, Date.now(), { excludeDialogueSessions: own }), true);
});

test("script wait modes leave other participants open after any first completion", async () => {
  const f = fixture(), refs = await f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.pc.uuid, f.second.uuid] });
  const now = Date.now(), sessions = Object.values(f.runtime().dialogueSessions);
  assert.equal(scriptDialoguesPending(f.runtime(), refs, now, "all"), true);
  assert.equal(scriptDialoguesPending(f.runtime(), refs, now, "first"), true);
  assert.equal(scriptDialoguesPending(f.runtime(), refs, now, "none"), false);
  sessions[1].status = "finished";
  assert.equal(scriptDialoguesPending(f.runtime(), refs, now, "first"), false);
  assert.equal(scriptDialoguesPending(f.runtime(), refs, now, "all"), true);
  assert.equal(sessions[0].status, "active");
  sessions[0].expiresAt = now - 1;
  assert.equal(scriptDialoguesPending(f.runtime(), refs, now, "all"), false);
  assert.equal(scriptDialoguesPending(f.runtime(), [], now, "first"), false);
});

test("read-only script planning never mutates saved quota or sessions", () => {
  const f = fixture(), before = clone(f.runtime());
  const plan = planScriptDialogues(f.command, { context: f.context, validate: validateScriptDialogueAccess });
  assert.equal(plan.length, 1); assert.deepEqual(f.runtime(), before);
});

test("a replaced Actor on an already talking token rejects the whole next batch before other participants start", async () => {
  const f = fixture(); await f.service.startScriptDialogues(f.command);
  f.pc.actor.id = "replacement";
  await assert.rejects(f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.second.uuid, f.pc.uuid] }));
  assert.equal(f.signals.length, 1); assert.equal(f.messages.length, 1);
  assert.equal(Object.values(f.runtime().dialogueSessions).length, 1);
});

function admissionGate() {
  let paused = false, stopped = false;
  const waiters = new Set();
  return {
    pause() { paused = true; },
    resume() { paused = false; for (const waiter of waiters) waiter.resolve(); waiters.clear(); },
    stop() { stopped = true; for (const waiter of waiters) waiter.reject(new Error("Stopped")); waiters.clear(); },
    isCurrent: () => !paused && !stopped,
    waitForAdmission: () => stopped ? Promise.reject(new Error("Stopped")) : paused
      ? new Promise((resolve, reject) => waiters.add({ resolve, reject })) : Promise.resolve()
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a pause after session creation holds the exact view and remaining batch until resume", async () => {
  const gate = admissionGate();
  const f = fixture({ onSignal: (signal) => { if (signal.name === "opened" && signal.parameters.userUuid === "User.player") gate.pause(); } });
  let settled = false;
  const task = f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.pc.uuid, f.second.uuid] }, gate).finally(() => { settled = true; });
  await flush();
  const first = Object.values(f.runtime().dialogueSessions)[0];
  assert.ok(first); assert.equal(settled, false); assert.equal(f.messages.length, 0); assert.equal(f.signals.length, 1);
  gate.resume(); const refs = await task;
  assert.equal(refs.length, 2); assert.equal(refs[0].sessionId, first.sessionId);
  assert.equal(f.messages.length, 2); assert.equal(f.signals.filter((signal) => signal.name === "opened").length, 2);
  assert.equal(f.messages[0].getFlag(MODULE_ID, "scriptDialogue").view.sessionId, first.sessionId);
});

test("a long delivery pause renews only the admitted lease without replaying quota or startup", async () => {
  const originalNow = Date.now, originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let now = originalNow(), nextTimer = 0; const timers = new Map();
  Date.now = () => now;
  globalThis.setInterval = (callback, ms) => { assert.equal(ms, 30000); const id = ++nextTimer; timers.set(id, callback); return id; };
  globalThis.clearInterval = (id) => timers.delete(id);
  const gate = admissionGate();
  try {
    const f = fixture({ onSignal: (signal) => { if (signal.name === "opened") gate.pause(); } });
    const task = f.service.startScriptDialogues(f.command, gate);
    await flush();
    const originalId = Object.values(f.runtime().dialogueSessions)[0].sessionId;
    for (let index = 0; index < 6; index++) {
      now += 30000; for (const callback of timers.values()) callback(); await flush();
      assert.ok(Object.values(f.runtime().dialogueSessions)[0].expiresAt > now);
    }
    assert.equal(f.messages.length, 0); assert.equal(f.signals.length, 1);
    assert.deepEqual(f.runtime().conditionCounts ?? {}, {});
    gate.resume(); const refs = await task;
    assert.equal(refs[0].sessionId, originalId); assert.equal(f.messages.length, 1); assert.equal(timers.size, 0);
  } finally { gate.stop(); Date.now = originalNow; globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});

test("halt while delivery waits rejects the partial batch and stops its private heartbeat", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  const timers = new Map(); let nextTimer = 0;
  globalThis.setInterval = (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; };
  globalThis.clearInterval = (id) => timers.delete(id);
  const gate = admissionGate();
  try {
    const f = fixture({ onSignal: (signal) => { if (signal.name === "opened") gate.pause(); } });
    const task = f.service.startScriptDialogues({ ...f.command, tokenUuids: [f.pc.uuid, f.second.uuid] }, gate);
    await flush(); assert.equal(timers.size, 1); assert.equal(f.messages.length, 0);
    const rejected = assert.rejects(task, /Stopped/); gate.stop(); await rejected;
    assert.equal(timers.size, 0); assert.equal(f.messages.length, 0); assert.equal(f.windows.length, 0);
    assert.equal(f.signals.length, 1); assert.equal(Object.values(f.runtime().dialogueSessions).length, 1);
  } finally { gate.stop(); globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
