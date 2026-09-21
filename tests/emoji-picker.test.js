import test from "node:test";
import assert from "node:assert/strict";
import { EMOJI_GROUPS } from "../dmicher-master-screen/scripts/apps/emoji-catalog.js";
import { EMOJI_COLUMNS, emojiPickerOptions } from "../dmicher-master-screen/scripts/apps/emoji-picker.js";
import { normalizeGroupSymbol } from "../dmicher-master-screen/scripts/model.js";
import { renderScriptParameters } from "../dmicher-master-screen/scripts/apps/script-parameters.js";
import { renderParameters } from "../dmicher-master-screen/scripts/apps/ide-view.js";

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

test("Screen keeps its curated symbols while the Generics wrapper receives localized labels", () => {
  for (const language of ["ru", "en"]) {
    const options = emojiPickerOptions(language);
    assert.equal(options.groups.length, 4);
    assert.equal(options.groups.flatMap(group => group.items).length, 140);
    assert.equal(options.labels.dialog, language === "ru" ? "Выбрать эмоцию" : "Choose emotion");
    assert.equal(options.labels.groups, language === "ru" ? "Группы символов" : "Symbol groups");
    for (let index = 0; index < EMOJI_GROUPS.length; index++) {
      assert.equal(options.groups[index].label, EMOJI_GROUPS[index].label[language]);
      assert.equal(options.groups[index].items[0].label, EMOJI_GROUPS[index].items[0][language]);
    }
  }
});

test("emotion keeps the picker beside its input and exposes fractional size", () => {
  const html = renderScriptParameters({ kind: "emotion", parameters: { emoji: "!", size: 42.5, duration: 2 } });
  assert.match(html, /ms-emotion-value[^]*?<input[^]*?<button[^]*?data-script-emoji-picker/);
  assert.doesNotMatch(html, /<select[^>]*data-script-param="\[&quot;emoji&quot;\]"/);
  assert.match(html, /value="42.5"[^>]*step="any"/);
});

test("group symbol uses the same Unicode picker beside the grapheme input", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const draft = { groupId: "g", groupName: "Group", symbol: "👩‍🚀", entryStateId: "s", states: [{ id: "s", name: "State" }], description: "", background: "#26303C", textColor: "#FFFFFF" };
  const html = renderParameters({ selection: { kind: "group", groupId: "g" }, draft, catalog: {}, definitions: [draft], mode: "constructor" });
  assert.match(html, /ms-group-symbol[^]*?name="groupSymbol"[^]*?data-group-symbol-picker/);
  assert.ok(html.includes('value="👩‍🚀"'));
});
