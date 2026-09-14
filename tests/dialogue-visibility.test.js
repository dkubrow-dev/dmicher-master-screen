import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { currentDialogueRollMode, syncDialogueRollMode, dialogueVisibility, dialogueAudience, publicDialogueTokenAllowed }
  from "../dmicher-master-screen/scripts/dialogue-visibility.js";

function fixture() {
  let rollMode = "publicroll";
  const makeUser = (id, role = 1, flags = {}) => ({ id, role, isGM: role >= 3, flags, writes: [],
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) { this.flags[scope] ??= {}; this.flags[scope][key] = value; this.writes.push({ scope, key, value }); }
  });
  const gm = makeUser("gm", 4), assistant = makeUser("assistant", 3), speaker = makeUser("speaker"), nearby = makeUser("nearby"),
    distant = makeUser("distant", 2), spectator = makeUser("spectator"), disabled = makeUser("disabled", 0),
    informer = makeUser("informer", 1, { "dmicher-generics": { managedIdentity: { version: 1, ownerId: "dmicher-generics", key: "informer" } } });
  globalThis.game = { user: gm, users: new Map([gm, assistant, speaker, nearby, distant, spectator, disabled, informer].map(user => [user.id, user])),
    settings: { get(scope, key) { assert.equal(scope, "core"); assert.equal(key, "rollMode"); return rollMode; } }, i18n: { lang: "en" } };
  const flags = { objectBindings: { bindings: {} } };
  const scene = { id: "scene", grid: { size: 100, distance: 5 }, tokens: new Map(),
    getFlag(scope, key) { return scope === MODULE_ID ? flags[key] : undefined; } };
  const makeToken = (id, x, owner, tags = []) => {
    const token = { documentName: "Token", id, x, y: 0, width: 1, height: 1, level: 0, parent: scene,
      actor: { testUserPermission(user, permission) { return permission === "OWNER" && user.id === owner?.id; } } };
    scene.tokens.set(id, token); flags.objectBindings.bindings[`Token:${id}`] = { type: "Token", id, tags };
    return token;
  };
  const source = makeToken("source", 0, null), nearbyToken = makeToken("nearby-token", 100, nearby, ["ally"]),
    distantToken = makeToken("distant-token", 200, distant, ["ally", "excluded"]);
  const session = { userId: speaker.id, target: { type: "Token", id: source.id }, presentation: { visibility: "private" } };
  return { gm, assistant, speaker, nearby, distant, spectator, disabled, informer, flags, scene, source, nearbyToken, distantToken, session, makeToken,
    setMode: mode => { rollMode = mode; } };
}

test("dialogue visibility defaults to private and explicit visibility overrides the player's preference", () => {
  const f = fixture(); game.user = f.speaker;
  for (const presentation of [undefined, {}, { visibility: "unknown" }, { visibility: "private" }]) assert.equal(dialogueVisibility(presentation, f.speaker), "private");
  f.setMode("gmroll"); assert.equal(dialogueVisibility({ visibility: "public" }, f.speaker), "public");
  f.setMode("publicroll"); assert.equal(dialogueVisibility({ visibility: "private" }, f.speaker), "private");
});

test("player visibility uses their own local roll mode or their mirrored remote preference, never the GM's preference", () => {
  const f = fixture(), presentation = { visibility: "player" };
  assert.equal(dialogueVisibility(presentation, f.speaker), "private", "a missing remote preference is private despite the GM's public mode");
  f.speaker.flags[MODULE_ID] = { dialogueRollMode: "publicroll" };
  f.setMode("gmroll"); assert.equal(dialogueVisibility(presentation, f.speaker), "public");
  for (const mode of ["gmroll", "blindroll", "selfroll", "unknown", undefined]) {
    f.speaker.flags[MODULE_ID].dialogueRollMode = mode; assert.equal(dialogueVisibility(presentation, f.speaker), "private");
  }
  game.user = f.speaker; f.setMode("publicroll"); assert.equal(dialogueVisibility(presentation, f.speaker), "public");
  f.setMode("blindroll"); assert.equal(dialogueVisibility(presentation, f.speaker), "private");
  game.settings.get = () => { throw new Error("settings unavailable"); };
  assert.equal(currentDialogueRollMode(), "gmroll"); assert.equal(dialogueVisibility(presentation, f.speaker), "private");
});

test("private chat recipients are only the leading user and human GMs", () => {
  const f = fixture();
  assert.deepEqual(dialogueAudience(f.scene, f.session), [f.gm.id, f.assistant.id, f.speaker.id]);
  assert.deepEqual(dialogueAudience(f.scene, f.session, { observersOnly: true }), []);
  f.session.userId = f.gm.id;
  assert.deepEqual(dialogueAudience(f.scene, f.session), [f.gm.id, f.assistant.id], "a leading GM is not duplicated");
  f.informer.isGM = true; f.informer.role = 4;
  assert.deepEqual(dialogueAudience(f.scene, f.session), [f.gm.id, f.assistant.id], "managed users remain excluded even if their role changes");
});

test("unrestricted public chat has a separate observer audience and excludes technical or disabled users", () => {
  const f = fixture(); f.session.presentation.visibility = "public";
  assert.deepEqual(dialogueAudience(f.scene, f.session, { observersOnly: true }), [f.nearby.id, f.distant.id, f.spectator.id]);
  assert.deepEqual(dialogueAudience(f.scene, f.session), [f.gm.id, f.assistant.id, f.speaker.id, f.nearby.id, f.distant.id, f.spectator.id]);
});

test("public audience combines per-character tag filters and distance using actual ownership", () => {
  const f = fixture();
  f.session.presentation = { visibility: "public", publicAudience: { allowTags: ["ally"], denyTags: ["excluded"], range: 5 } };
  assert.deepEqual(dialogueAudience(f.scene, f.session, { observersOnly: true }), [f.nearby.id]);
  assert.deepEqual(dialogueAudience(f.scene, f.session), [f.gm.id, f.assistant.id, f.speaker.id, f.nearby.id], "primary participants are not filtered by observer conditions");
  f.makeToken("eligible-unowned", 0, null, ["ally"]);
  assert.deepEqual(dialogueAudience(f.scene, f.session, { observersOnly: true }), [f.nearby.id]);
  f.makeToken("distant-users-other-character", 80, f.distant, ["ally"]);
  assert.deepEqual(dialogueAudience(f.scene, f.session, { observersOnly: true }), [f.nearby.id, f.distant.id], "any eligible owned character grants observation");
  f.flags.objectBindings.bindings["Token:nearby-token"].tags.push("excluded");
  assert.deepEqual(dialogueAudience(f.scene, f.session, { observersOnly: true }), [f.distant.id]);
});

test("finite public range rejects missing targets, invalid positions and different native levels", () => {
  const f = fixture(); f.session.presentation = { visibility: "public", publicAudience: { range: 5 } };
  assert.equal(publicDialogueTokenAllowed(f.scene, f.session, f.nearbyToken), true);
  f.nearbyToken.x += 1; assert.equal(publicDialogueTokenAllowed(f.scene, f.session, f.nearbyToken), false);
  f.nearbyToken.x = 100; f.nearbyToken.level = 1; assert.equal(publicDialogueTokenAllowed(f.scene, f.session, f.nearbyToken), false);
  f.nearbyToken.level = 0; f.nearbyToken.x = NaN; assert.equal(publicDialogueTokenAllowed(f.scene, f.session, f.nearbyToken), false);
  f.nearbyToken.x = 0; f.scene.tokens.delete(f.source.id); assert.equal(publicDialogueTokenAllowed(f.scene, f.session, f.nearbyToken), false);
});

test("roll-mode synchronization writes only the current human user's changed preference", async () => {
  const f = fixture(); game.user = f.speaker;
  await syncDialogueRollMode(); await syncDialogueRollMode();
  assert.deepEqual(f.speaker.writes, [{ scope: MODULE_ID, key: "dialogueRollMode", value: "publicroll" }]);
  assert.deepEqual(f.gm.writes, []); assert.deepEqual(f.nearby.writes, []);
  f.setMode("selfroll"); await syncDialogueRollMode(); await syncDialogueRollMode();
  assert.equal(f.speaker.writes.length, 2); assert.equal(f.speaker.writes[1].value, "selfroll");
  game.user = f.informer; await syncDialogueRollMode(); assert.deepEqual(f.informer.writes, []);
  game.user = { id: "without-write-api" }; await assert.doesNotReject(syncDialogueRollMode());
});
