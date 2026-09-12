import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { languageCode, text, message } from "../dmicher-master-screen/scripts/localization.js";
import { MESSAGE_TRANSLATIONS } from "../dmicher-master-screen/scripts/message-translations.js";
import { SCRIPT_STEP_KINDS, normalizeScript, normalizeScriptStep } from "../dmicher-master-screen/scripts/script-model.js";
import { scriptActionOptions } from "../dmicher-master-screen/scripts/script-action-labels.js";
import { normalizeSignalFields } from "../dmicher-master-screen/scripts/signal-types.js";
import { DEFAULT_DESCRIPTIONS } from "../dmicher-master-screen/scripts/object-descriptions.js";
import { SCREEN_HELP_PAGES, SCREEN_HELP_SETTINGS } from "../dmicher-master-screen/scripts/help-content.js";
import { builtinSignals } from "../dmicher-master-screen/scripts/builtin-signals.js";

const cyrillic = /[\u0400-\u04ff]/u;
const placeholders = (value) => [...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
const pair = (ru, en) => {
  assert.equal(typeof ru, "string"); assert.ok(ru.trim());
  assert.equal(typeof en, "string"); assert.ok(en.trim());
  assert.ok(!cyrillic.test(en), `Russian text in English content: ${en}`);
};

test("locale selection is consistent and interpolates only explicit values", () => {
  assert.equal(languageCode("RU-ru"), "ru");
  assert.equal(languageCode("en-US"), "en");
  assert.equal(languageCode("fr"), "en");
  assert.equal(text("Да", "Yes", "en"), "Yes");
  assert.equal(message("Поле «{0}»: неизвестный тип.", ["Игрок"], "en"), "Field “Игрок”: unknown type.");
  assert.equal(message("Макрос «{0}»{1}: {2}", ["$&", "{2}", "value"], "en"), "Macro “$&”{2}: value");
  assert.equal(message("__proto__", [], "en"), "__proto__");
  assert.equal(message("{0}", Object.create({ 0: "inherited" }), "en"), "{0}");
  assert.equal(message("An external error", [], "ru"), "An external error");
});

test("every message translation preserves placeholders and every call has a translation", () => {
  for (const [ru, en] of Object.entries(MESSAGE_TRANSLATIONS)) {
    pair(ru, en);
    assert.deepEqual(placeholders(en), placeholders(ru), ru);
  }
  const root = fileURLToPath(new URL("../dmicher-master-screen/scripts/", import.meta.url));
  const files = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : entry.name.endsWith(".js") ? [path.join(directory, entry.name)] : []);
  const used = new Set();
  for (const file of files(root)) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(/localizedMessage\(("(?:[^"\\]|\\.)*")/g)) {
      const source = JSON.parse(match[1]);
      assert.ok(Object.hasOwn(MESSAGE_TRANSLATIONS, source), `${file}: ${source}`);
      used.add(source);
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(MESSAGE_TRANSLATIONS).sort(), "No unused source messages remain");
});

test("authored bilingual help, descriptions, action names and system signals are complete", () => {
  for (const description of Object.values(DEFAULT_DESCRIPTIONS)) pair(description.ru, description.en);
  for (const page of SCREEN_HELP_PAGES) {
    pair(page.ru, page.en);
    for (const section of page.sections) { pair(section.ru, section.en); pair(section.bodyRu, section.bodyEn); }
  }
  for (const page of SCREEN_HELP_SETTINGS) {
    pair(page.ru, page.en);
    for (const field of page.fields) { pair(field[2], field[3]); pair(field[4], field[5]); }
  }
  assert.deepEqual(scriptActionOptions("en").map(([kind]) => kind), SCRIPT_STEP_KINDS);
  scriptActionOptions("ru").forEach(([, ru], index) => pair(ru, scriptActionOptions("en")[index][1]));
  for (const type of ["Scene", "Combat", "Group", "Shop", "Dialogue"]) {
    for (const signal of builtinSignals({ type, key: `${type}:test` })) {
      pair(signal.label.ru, signal.label.en); pair(signal.description.ru, signal.description.en);
      for (const field of [...signal.parameters, ...signal.returns]) pair(field.description.ru, field.description.en);
    }
  }
});

test("domain validation follows English while preserving user-authored field names", () => {
  const previous = globalThis.game;
  globalThis.game = { i18n: { lang: "en" } };
  try {
    assert.throws(() => normalizeSignalFields([{ name: "Игрок", type: "unknown" }]), /Field “Игрок”: unknown type\./);
    assert.throws(() => normalizeScript({ id: "script", steps: [{ id: 0, kind: "wait" }] }), /positive integer ID/);
    for (const [kind, parameters, label] of [
      ["sound", { src: 42 }, "Audio file"],
      ["speech", { chat: { text: 42 } }, "Chat text"],
      ["speech", { bubble: { text: 42 } }, "Speech bubble text"],
      ["signal", { signalId: 42 }, "Signal"],
      ["macro", { macroUuid: 42 }, "Macro"]
    ]) assert.throws(() => normalizeScriptStep({ id: 1, kind, parameters }), new RegExp(`^Error: ${label}: expected text`));
    assert.throws(() => normalizeScript({ name: 42, steps: [] }), /^Error: Script name: expected text/);
    game.i18n.lang = "ru";
    assert.throws(() => normalizeSignalFields([{ name: "Player", type: "unknown" }]), /Поле «Player»: неизвестный тип\./);
  } finally { if (previous === undefined) delete globalThis.game; else globalThis.game = previous; }
});
