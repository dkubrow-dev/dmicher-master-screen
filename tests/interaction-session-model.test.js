import test from "node:test";
import assert from "node:assert/strict";
import { shopSessionIsLive, dialogueSessionIsLive } from "../dmicher-master-screen/scripts/interaction-session-model.js";
import { objectReferenceKey } from "../dmicher-master-screen/scripts/object-reference.js";

test("expired pending trade keeps its reservation while interrupted dialogue releases the object", () => {
  assert.equal(shopSessionIsLive({ status: "pending", expiresAt: 10 }, 20), true);
  assert.equal(shopSessionIsLive({ status: "editing", expiresAt: 10 }, 20), false);
  assert.equal(dialogueSessionIsLive({ status: "interrupted", expiresAt: 100 }, 20), false);
  assert.equal(dialogueSessionIsLive({ status: "finished", expiresAt: 100 }, 20), true);
  assert.equal(dialogueSessionIsLive({ status: "finished", expiresAt: 10 }, 20), false);
});
test("interaction references retain native type and cannot collide through token shorthand", () => {
  assert.equal(objectReferenceKey("one"), "Token:one");
  assert.equal(objectReferenceKey("Tile:one"), "Tile:one");
  assert.equal(objectReferenceKey({ document: { documentName: "Wall", id: "one" } }), "Wall:one");
  assert.equal(objectReferenceKey({ type: "Actor", id: "one" }), "");
  assert.equal(objectReferenceKey(null), "");
});
