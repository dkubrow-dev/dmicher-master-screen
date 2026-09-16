import test from "node:test";
import assert from "node:assert/strict";
import { defaultInteractionSettings, normalizeInteractionSettings, normalizePlayerInteractionSettings, effectiveInteractionSettings, normalizeHighlightKeys, highlightChordMatches } from "../dmicher-master-screen/scripts/interaction-settings-model.js";
import { listenForHighlightChord } from "../dmicher-master-screen/scripts/interaction-keybinding.js";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { isInteractivePresentationAvailable, canExecuteScriptKind } from "../dmicher-master-screen/scripts/premium-provider.js";
import { masterScreenExtension } from "../../dmicher-premium/dmicher-premium/sctipts/features/master-screen/index.js";
import { INTERACTION_HELP_SETTINGS } from "../dmicher-master-screen/scripts/interaction-help-content.js";

test("every interaction setting has both operational help languages and a stable anchor", () => {
  const page = INTERACTION_HELP_SETTINGS[0], anchors = new Set();
  assert.equal(page.id, "settings-interactive-objects");
  for (const [selector, anchor, ru, en, bodyRu, bodyEn] of page.fields) {
    assert.ok(selector && anchor && ru && en && bodyRu && bodyEn); assert.notEqual(ru, en); assert.notEqual(bodyRu, bodyEn);
    assert.equal(anchors.has(anchor), false); anchors.add(anchor);
  }
  assert.equal(anchors.size, 14);
});

test("interaction defaults follow object-specific outlines, icons and AltLeft activation", () => {
  const settings = defaultInteractionSettings();
  assert.equal(settings.highlight.enabled, true); assert.deepEqual(settings.highlight.keys, ["AltLeft"]); assert.equal(settings.highlight.activation, "keys");
  assert.deepEqual(Object.entries(settings.highlight.frames).filter(([, value]) => value.enabled).map(([type]) => type), ["Token", "Wall", "AmbientLight", "Note"]);
  assert.equal(settings.icons.enabled, false);
  assert.deepEqual(Object.entries(settings.icons.types).filter(([, value]) => value.enabled).map(([type]) => type), ["Token", "Wall", "AmbientLight"]);
  assert.equal(settings.icons.types.AmbientLight.horizontal, "center"); assert.equal(settings.icons.types.AmbientLight.vertical, "center");
  assert.equal(settings.icons.types.Token.horizontal, "left"); assert.equal(settings.icons.types.Token.vertical, "top");
});

test("settings normalization preserves saved intent while effective settings fail closed without Premium", () => {
  const raw = { highlight: { enabled: false, keys: ["ControlLeft", "KeyH"], frames: { Token: { size: Infinity, color: "oops", enabled: false } } },
    icons: { enabled: true, types: { Token: { size: -4, symbol: "AB", color: "#00ff00" } } } };
  const normalized = normalizeInteractionSettings(raw), before = structuredClone(normalized);
  assert.equal(normalized.highlight.frames.Token.size, 2); assert.equal(normalized.highlight.frames.Token.color, "#388BFF");
  assert.equal(normalized.icons.types.Token.symbol, "A"); assert.equal(normalized.icons.types.Token.size, 8);
  const effective = effectiveInteractionSettings(normalized, { activation: "always", keys: ["AltRight"] });
  assert.equal(effective.icons.enabled, false); assert.equal(effective.highlight.enabled, false); assert.equal(effective.highlight.activation, "always");
  assert.deepEqual(normalized, before, "revocation never mutates saved values");
  assert.deepEqual(normalizePlayerInteractionSettings({}), { activation: null, keys: null });
  assert.equal(effectiveInteractionSettings(normalized, {}, { premium: true }).icons.enabled, true);
});

test("key chords retain physical sides and reject invalid input", () => {
  assert.deepEqual(normalizeHighlightKeys(["AltRight", "KeyI", "AltRight"]), ["AltRight", "KeyI"]);
  assert.deepEqual(normalizeHighlightKeys(["Escape", "Mouse1"]), ["AltLeft"]);
  assert.equal(highlightChordMatches(new Set(["AltLeft"]), ["AltLeft"]), true);
  assert.equal(highlightChordMatches(new Set(["AltRight"]), ["AltLeft"]), false);
  assert.equal(highlightChordMatches(new Set(["AltLeft", "ShiftLeft"]), ["AltLeft"]), false);
});

test("shortcut capture requires a continuous three-second chord and disposes timer and handlers", () => {
  const handlers = new Map(), timers = new Map(), confirmed = []; let serial = 0, cancelled = 0;
  const target = { addEventListener: (name, callback) => handlers.set(name, callback), removeEventListener: name => handlers.delete(name) };
  const dispose = listenForHighlightChord(target, { onChange() {}, onConfirm: keys => confirmed.push(keys), onCancel: () => cancelled++,
    setTimer: (fn, duration) => { assert.equal(duration, 3000); timers.set(++serial, fn); return serial; }, clearTimer: id => timers.delete(id) });
  const event = (code, repeat = false) => ({ code, repeat, preventDefault() {}, stopImmediatePropagation() {} });
  handlers.get("keydown")(event("AltLeft")); assert.equal(timers.size, 1); const first = serial;
  handlers.get("keydown")(event("AltLeft", true)); assert.equal(serial, first, "repeat keeps the hold timer");
  handlers.get("keydown")(event("KeyI")); assert.equal(timers.has(first), false); assert.equal(timers.size, 1);
  handlers.get("keyup")(event("KeyI")); assert.equal(timers.size, 0, "release breaks the hold");
  handlers.get("keydown")(event("KeyI")); const fired = timers.get(serial); timers.delete(serial); fired(); assert.deepEqual(confirmed, [["AltLeft", "KeyI"]]);
  handlers.get("keydown")(event("Escape")); assert.equal(cancelled, 1);
  handlers.get("keyup")(event("KeyI")); handlers.get("keydown")(event("KeyI")); assert.equal(timers.size, 1);
  dispose(); assert.equal(timers.size, 0); assert.equal(handlers.size, 0);
});

test("Screen Premium bridge authorizes optional visuals and only designated script functions", () => {
  assert.equal(isInteractivePresentationAvailable(), false); assert.equal(canExecuteScriptKind("focus"), false); assert.equal(canExecuteScriptKind("move"), true);
  let allowed = true;
  const provider = generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => allowed, extensions: [masterScreenExtension] });
  try {
    assert.equal(isInteractivePresentationAvailable(), true);
    for (const kind of ["focus", "sound", "playlist", "macro"]) assert.equal(canExecuteScriptKind(kind), true);
    allowed = false; provider.notifyChanged();
    for (const kind of ["focus", "sound", "playlist", "macro"]) assert.equal(canExecuteScriptKind(kind), false);
    assert.equal(canExecuteScriptKind("dialogue"), true); assert.equal(isInteractivePresentationAvailable(), false);
  } finally { provider.dispose(); }
});
