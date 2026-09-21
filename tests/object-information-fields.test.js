import test from "node:test";
import assert from "node:assert/strict";
import { renderObjectInformation, readObjectInformation } from "../dmicher-master-screen/scripts/apps/object-information-fields.js";

test("object information edits a separate display name and preserves it in the draft", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const draft = { type: "Token", displayName: "Merchant", groupId: null, tags: [], notes: "", playerCharacter: false };
  const html = renderObjectInformation({ id: "npc", uuid: "Scene.s.Token.npc", name: "Native name" }, [], draft, { automationEnabled: false });
  assert.match(html, /name="object-display-name"[^>]*value="Merchant"/);
  assert.match(html, /name="object-automation-enabled"/);
  assert.doesNotMatch(html, /name="object-automation-enabled"[^>]* checked/);
  const values = new Map([["object-display-name", "  Menu merchant  "], ["object-group", ""], ["object-tags", "trade"], ["object-notes", "Note"]]);
  const root = { querySelector(selector) {
    const name = /name="([^"]+)"/.exec(selector)?.[1];
    if (name === "object-player-character") return { checked: true };
    return values.has(name) ? { value: values.get(name) } : null;
  } };
  const result = readObjectInformation(root, draft);
  assert.equal(result.displayName, "Menu merchant");
  assert.equal(result.playerCharacter, true);
});

test("every object exposes current runtime automation independently from preparation", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const draft = { type: "Token", displayName: "Hero", groupId: "players", tags: [], notes: "", playerCharacter: true };
  const disabled = renderObjectInformation({ id: "pc", uuid: "Scene.s.Token.pc", name: "Hero" }, [], draft, { automationEnabled: false });
  assert.match(disabled, /name="object-automation-enabled"/);
  assert.doesNotMatch(disabled, /name="object-automation-enabled"[^>]* checked/);
  const enabled = renderObjectInformation({ id: "pc", uuid: "Scene.s.Token.pc", name: "Hero" }, [], draft, { automationEnabled: true });
  assert.match(enabled, /name="object-automation-enabled"[^>]* checked/);
  const tile = renderObjectInformation({ id: "tile", uuid: "Scene.s.Tile.tile", name: "Tile" }, [], { ...draft, type: "Tile", playerCharacter: false }, { automationEnabled: true });
  assert.match(tile, /name="object-automation-enabled"[^>]* checked/);
  assert.doesNotMatch(tile, /name="object-player-character"/);
});
