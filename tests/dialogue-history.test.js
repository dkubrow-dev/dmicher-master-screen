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
    status: "finished", history: [{ id: "one", role: "object", text: "Already said" }] };
  const view = dialogueSessionView(session, null, null, { role: "listener", listenerTokenId: "pc" });
  assert.deepEqual(view.history, session.history); assert.equal(view.title, "Title"); assert.deepEqual(view.responses, []);
  view.history[0].text = "Change local copy"; assert.equal(session.history[0].text, "Already said");
});
