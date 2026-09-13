import test from "node:test";
import assert from "node:assert/strict";
import { EMOJI_GROUPS } from "../dmicher-master-screen/scripts/apps/emoji-catalog.js";
import { EMOJI_COLUMNS, renderEmojiPicker } from "../dmicher-master-screen/scripts/apps/emoji-picker.js";
import { normalizeGroupSymbol } from "../dmicher-master-screen/scripts/model.js";
import { renderScriptParameters } from "../dmicher-master-screen/scripts/apps/script-parameters.js";

test("four compact palettes contain unique single-grapheme symbols and bilingual names", () => {
  assert.equal(EMOJI_COLUMNS, 5);
  assert.equal(EMOJI_GROUPS.length, 4);
  const symbols = new Set();
  for (const group of EMOJI_GROUPS) {
    assert.equal(group.items.length, 35);
    for (const label of [group.label, ...group.items]) {
      assert.ok(label.ru.trim()); assert.ok(label.en.trim()); assert.doesNotMatch(label.en, /[\u0400-\u04ff]/u);
    }
    for (const item of group.items) {
      assert.equal(normalizeGroupSymbol(item.symbol), item.symbol);
      assert.ok(!symbols.has(item.symbol), item.symbol); symbols.add(item.symbol);
    }
  }
});

test("palette groups are anchor destinations, with five columns and seven rows", () => {
  for (const language of ["ru", "en"]) {
    const html = renderEmojiPicker("palette-test", language);
    assert.equal((html.match(/data-emoji-value=/g) ?? []).length, 140);
    assert.equal((html.match(/<tr>/g) ?? []).length, 28);
    assert.equal((html.match(/<td>/g) ?? []).length, 140);
    for (const group of EMOJI_GROUPS) {
      assert.ok(html.includes(`href="#palette-test-${group.id}"`));
      assert.ok(html.includes(`id="palette-test-${group.id}"`));
      assert.ok(html.includes(group.label[language]));
    }
  }
});

test("emotion keeps the picker beside its input and exposes fractional size", () => {
  const html = renderScriptParameters({ kind: "emotion", parameters: { emoji: "!", size: 42.5, duration: 2 } });
  assert.match(html, /ms-emotion-value[^]*?<input[^]*?<button[^]*?data-script-emoji-picker/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /value="42.5"[^>]*step="any"/);
});
