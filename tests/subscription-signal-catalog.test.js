import test from "node:test";
import assert from "node:assert/strict";
import * as fields from "../dmicher-master-screen/scripts/apps/signal-fields.js";
import { createDOM, dispatch } from "../../dmicher-generics/tests/helpers/dom-fixture.js";

const catalog = {
  emitters: [{ key: "Token:guard", name: "Guard" }, { key: "Tile:gate", name: "Gate" }], macros: [], subscriptions: [],
  signals: [
    { id: "guard-near", emitterKey: "Token:guard", name: "Approached", description: { ru: "Рядом", en: "A character is near" }, enabled: true },
    { id: "gate-near", emitterKey: "Tile:gate", name: "Approached", description: "At the gate", enabled: true },
    { id: "off", emitterKey: "Tile:gate", name: "Disabled", description: "Unavailable", enabled: false }
  ]
};

test("subscription signal field displays the prepared signal while storing its stable ID separately", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const html = fields.renderSubscriptionFields({ ownerKey: "Token:guard", signalId: "guard-near", handler: "script", enabled: true }, catalog, { fixedOwner: "Token:guard" });
  assert.match(html, /type="hidden"[^>]*name="subscription-signal"[^>]*value="guard-near"/);
  assert.match(html, /data-subscription-signal-input[^>]*value="Guard[^\"]*Approached"/);
  assert.match(html, /data-subscription-signal-button/);
});

test("builtin signal labels use the UI language while their technical IDs remain unchanged", () => {
  const localized = { ...catalog, signals: [{ ...catalog.signals[0], name: "native.technical-name", label: { ru: "Появление", en: "Appeared" } }] };
  for (const [lang, label] of [["ru", "Появление"], ["en", "Appeared"]]) {
    globalThis.game = { i18n: { lang } };
    const html = fields.renderSubscriptionFields({ ownerKey: "Token:guard", signalId: "guard-near", handler: "script" }, localized, { fixedOwner: "Token:guard" });
    assert.ok(html.includes(`value="Guard · ${label}"`));
    assert.match(html, /name="subscription-signal"[^>]*value="guard-near"/);
  }
});

test("search and Escape never overwrite the signal ID; confirmation picks the emitter-specific signal once", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const { document, host, input, button } = createDOM();
  input.setAttribute("data-subscription-signal-input", ""); button.setAttribute("data-subscription-signal-button", "");
  const hidden = document.createElement("input"); hidden.setAttribute("name", "subscription-signal"); hidden.value = "guard-near"; host.append(hidden);
  let changes = 0; hidden.addEventListener("change", () => changes++);
  const dispose = fields.bindSubscriptionSignalCatalog(host, () => catalog);
  input.value = "Gate"; dispatch(input, "input");
  assert.equal(hidden.value, "guard-near"); assert.equal(changes, 0);
  dispatch(input, "keydown", { key: "Escape" });
  assert.equal(hidden.value, "guard-near");
  input.value = "Gate"; dispatch(input, "input"); dispatch(input, "keydown", { key: "Enter" });
  assert.equal(hidden.value, "gate-near"); assert.equal(changes, 1);
  dispatch(button, "click");
  assert.equal(document.querySelector('[data-dmicher-catalog-entry="off"]'), null);
  dispose(); assert.equal(document.querySelector(".dmicher-catalog-dialog"), null);
});
