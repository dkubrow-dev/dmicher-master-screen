import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, emptyRuntime } from "../dmicher-master-screen/scripts/model.js";
import { sampleGroupDefinition } from "./fixtures/definitions.js";
import { listListeningSessions, validateListenerAccess } from "../dmicher-master-screen/scripts/dialogue-listeners.js";
import { createDialogueMarkers } from "../dmicher-master-screen/scripts/apps/dialogue-markers.js";
import { dialogueParticipant } from "../dmicher-master-screen/scripts/dialogue-participants.js";
import { createDialogueService } from "../dmicher-master-screen/scripts/dialogues.js";

function fixture() {
  const user = { id: "listener-user", isGM: false }, speakerUser = { id: "speaker-user", isGM: false };
  const scene = { id: "scene", tokens: new Map(), grid: { size: 100, distance: 5 }, flags: {},
    getFlag(scope, key) { return scope === MODULE_ID ? this.flags[key] : undefined; } };
  const make = (id, x, owner) => ({ id, name: id, documentName: "Token", parent: scene, x, y: 0, width: 1, height: 1, level: 0,
    actor: { id: `${id}-actor`, testUserPermission: (candidate) => candidate?.id === owner?.id },
    object: { checkCollision: () => false } });
  const speaker = make("speaker", 100, speakerUser), listener = make("listener", 0, user), source = make("source", 200, null);
  for (const token of [speaker, listener, source]) scene.tokens.set(token.id, token);
  const session = { sessionId: "session", userId: speakerUser.id, actorTokenId: speaker.id, actorId: speaker.actor.id,
    dialogueId: "talk", groupId: "main", runId: "run", target: { type: "Token", id: source.id }, status: "active", expiresAt: 5000,
    presentation: { visibility: "public" }, history: [{ text: "Public conversation" }] };
  const runtime = { ...emptyRuntime(), runId: "run", stateId: "calm", dialogueSessions: { own: session } };
  Object.assign(scene.flags, { groupDefinitions: { main: sampleGroupDefinition() }, groupRuntimes: { main: runtime },
    interactionCatalog: { dialogues: [{ id: "talk", name: "Greeting", pages: [{ id: "first", name: "Hello", text: "Hello" }] }] } });
  globalThis.game = { user, users: new Map([[user.id, user], [speakerUser.id, speakerUser]]), i18n: { lang: "en" } };
  globalThis.canvas = { scene };
  return { scene, runtime, session, user, speakerUser, speaker, listener, source, current: { scene, runtime, session } };
}

test("listener discovery shows metadata and admits another owned character across group boundaries", () => {
  const f = fixture(), before = structuredClone(f.scene.flags);
  const entries = listListeningSessions(f.scene, { targetTokenId: "speaker", actorTokenId: "listener", user: f.user, now: 1000 });
  assert.equal(entries.length, 1); assert.equal(entries[0].actorTokenId, "speaker"); assert.equal(entries[0].sessionId, "session");
  assert.equal(entries[0].name, "Greeting"); assert.equal(entries[0].history, undefined); assert.equal(entries[0].userId, undefined);
  assert.equal(validateListenerAccess(f.current, "listener", f.user, { now: 1000 }), f.listener);
  assert.deepEqual(f.scene.flags, before);
});

test("listener admission rejects ownership, identity, stale runs, missing actors and finished conversations", () => {
  for (const mutate of [
    (f) => { f.user.id = "stranger"; f.listener.actor.testUserPermission = () => false; },
    (f) => { f.session.userId = f.user.id; }, (f) => { f.session.actorId = "replaced"; },
    (f) => { f.session.runId = "old"; }, (f) => { f.runtime.halted = true; },
    (f) => { f.session.status = "finished"; }, (f) => { f.session.expiresAt = 999; },
    (f) => { f.scene.tokens.delete("source"); }, (f) => { canvas.scene = { id: "elsewhere" }; }
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => validateListenerAccess(f.current, "listener", f.user, { now: 1000 }));
    assert.deepEqual(listListeningSessions(f.scene, { actorTokenId: "listener", user: f.user, now: 1000 }), []);
  }
});

test("listener admission uses native sight, scene distance, levels and hidden states", () => {
  for (const mutate of [
    (f) => { f.speaker.x = 201; }, (f) => { f.speaker.level = 2; },
    (f) => { f.listener.object.checkCollision = () => true; }, (f) => { f.listener.object = null; },
    (f) => { f.speaker.hidden = true; }, (f) => { f.listener.hidden = true; }, (f) => { f.listener.x = NaN; }
  ]) { const f = fixture(); mutate(f); assert.throws(() => validateListenerAccess(f.current, "listener", f.user, { now: 1000 })); }
});

test("private and unspecified dialogues reveal no listening marker and cannot admit a listener", () => {
  for (const presentation of [undefined, {}, { visibility: "private" }, { visibility: "player" }]) {
    const f = fixture(); f.session.presentation = presentation;
    assert.deepEqual(listListeningSessions(f.scene, { now: 1000 }), []);
    assert.deepEqual(listListeningSessions(f.scene, { actorTokenId: "listener", user: f.user, now: 1000 }), []);
    assert.throws(() => validateListenerAccess(f.current, "listener", f.user, { now: 1000 }), /private/);
  }
});

test("public dialogue admission applies the configured tags and source distance to listeners", () => {
  const f = fixture();
  f.scene.flags.objectBindings = { bindings: { "Token:listener": { type: "Token", id: "listener", tags: ["guest"] } } };
  f.session.presentation.publicAudience = { allowTags: ["guest"], denyTags: ["excluded"], range: 10 };
  assert.equal(validateListenerAccess(f.current, "listener", f.user, { now: 1000 }), f.listener);
  f.scene.flags.objectBindings.bindings["Token:listener"].tags.push("excluded");
  assert.throws(() => validateListenerAccess(f.current, "listener", f.user, { now: 1000 }), /audience/);
  f.scene.flags.objectBindings.bindings["Token:listener"].tags = ["guest"];
  f.session.presentation.publicAudience.range = 5;
  assert.throws(() => validateListenerAccess(f.current, "listener", f.user, { now: 1000 }), /audience/);
});

test("a registered reader loses transcript refresh when player preference becomes private", () => {
  const f = fixture(); let mode = "publicroll";
  f.speakerUser.getFlag = () => mode;
  f.session.presentation = { visibility: "player" };
  f.session.participants = [{ userId: f.user.id, actorTokenId: f.listener.id, actorId: f.listener.actor.id,
    role: "listener", expiresAt: Date.now() + 60_000 }];
  const service = createDialogueService({ context: () => ({ ...f.current, dialogue: { id: "talk", pages: [] }, target: f.source }), messageService: {} });
  const command = { sceneId: f.scene.id, groupId: "main", dialogueId: "talk", sessionId: f.session.sessionId,
    target: f.session.target, listenerTokenId: f.listener.id };
  assert.equal(dialogueParticipant(f.scene, f.session, f.user, f.listener.id).role, "listener");
  assert.equal(service.refreshSession(command).role, "listener");
  mode = "gmroll";
  assert.throws(() => dialogueParticipant(f.scene, f.session, f.user, f.listener.id), /no longer have access/);
  assert.equal(service.refreshSession(command), null);
  assert.equal(dialogueParticipant(f.scene, f.session, f.speakerUser).role, "speaker", "the leading character retains their own conversation");
});

test("dialogue markers have their own labels and one lease deadline, and clean up on scene disposal", () => {
  const f = fixture(), updates = [], removed = [], scheduled = new Map(); let clock = 1000, serial = 0, clears = 0;
  const markers = createDialogueMarkers({ now: () => clock,
    decorations: { update: (...args) => updates.push(args), remove: (doc) => removed.push(doc), clear: () => { clears++; } },
    schedule: (fn, delay) => { const id = ++serial; scheduled.set(id, { fn, delay }); return id; }, cancel: (id) => scheduled.delete(id) });
  markers.sync(f.scene); markers.sync(f.scene);
  assert.equal(scheduled.size, 1); assert.equal(updates.length, 2); assert.equal(updates[0][0], f.speaker);
  assert.equal(updates[0][1].emoji, "💬"); assert.equal(updates[0][1].emojiOffset, 42);
  markers.refresh(f.listener); assert.equal(updates.length, 2); markers.refresh(f.speaker); assert.equal(updates.length, 3);
  clock = 5001; const [{ fn }] = scheduled.values(); scheduled.clear(); fn();
  assert.deepEqual(removed, [f.speaker]); assert.equal(scheduled.size, 0);
  markers.sync(null); markers.clear(); assert.equal(clears, 2);
});
