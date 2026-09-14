import test from "node:test";
import assert from "node:assert/strict";
import { dialoguePlayerMessage, dialogueSessionView } from "../dmicher-master-screen/scripts/dialogue-history.js";

test("player portraits prefer the character and fall through absent or native placeholder images", () => {
  const session = { sessionId: "session", step: 0 }, response = { label: "<script>plain reply</script>" };
  const token = { name: "Character", actor: { img: "portrait.webp" }, texture: { src: "token.webp" } }, user = { avatar: "avatar.webp" };
  assert.equal(dialoguePlayerMessage(session, response, token, user).img, "portrait.webp");
  token.actor.img = "icons/svg/mystery-man.svg";
  assert.equal(dialoguePlayerMessage(session, response, token, user).img, "token.webp");
  token.texture.src = "";
  assert.equal(dialoguePlayerMessage(session, response, token, user).img, "avatar.webp");
  assert.equal(dialoguePlayerMessage(session, response, token, {}).img, "icons/svg/mystery-man.svg");
  assert.equal(dialoguePlayerMessage(session, response, token, user).text, response.label, "presentation owns escaping; snapshots never execute text");
});

test("a missing catalogue can still present a participant's saved history without null access", () => {
  const session = { sessionId: "session", dialogueId: "dialogue", title: "Title", target: { type: "Token", id: "npc" },
    status: "finished", history: [{ id: "one", role: "object", text: "Already said", visibility: "public" }] };
  const view = dialogueSessionView(session, null, null, { role: "listener", listenerTokenId: "pc" });
  assert.deepEqual(view.history, session.history); assert.equal(view.title, "Title"); assert.deepEqual(view.responses, []);
  view.history[0].text = "Change local copy"; assert.equal(session.history[0].text, "Already said");
});

test("listener DTO excludes private and unmarked history, including all current-page fallbacks", () => {
  const session = { sessionId: "session", nodeId: "secret", status: "active", history: [
    { id: "legacy", role: "object", text: "Unmarked old text" },
    { id: "public", role: "object", text: "Public line", img: "public.webp", audio: "public.ogg", visibility: "public" },
    { id: "private", role: "object", text: "Private line", img: "private.webp", audio: "private.ogg", visibility: "private" }
  ] };
  const dialogue = { pages: [{ id: "secret", text: "Unspoken secret", art: "secret.webp", audio: "secret.ogg", responses: [{ id: "secret-choice", label: "Secret answer" }] }] };
  const view = dialogueSessionView(session, dialogue, null, { role: "listener" });
  assert.deepEqual(view.history.map(entry => entry.id), ["public"]);
  assert.equal(view.text, "Public line"); assert.equal(view.art, "public.webp"); assert.equal(view.audio, "public.ogg");
  assert.deepEqual(view.responses, []);
  const closed = dialogueSessionView({ ...session, history: session.history.filter(entry => entry.id !== "public") }, dialogue, null, { role: "listener" });
  assert.deepEqual(closed.history, []); assert.equal(closed.text, ""); assert.equal(closed.art, ""); assert.equal(closed.audio, "");
  assert.deepEqual(dialogueSessionView(session, dialogue, null).history, session.history, "the original speaker retains all accepted lines");
});
