import test from "node:test";
import assert from "node:assert/strict";
import { getScriptCatalogEntries, getScriptMacroEntries, createAttachedScriptMacro, promptAndCreateAttachedScriptMacro,
  SCRIPT_MACRO_NONE, SCRIPT_MACRO_NEW } from "../dmicher-master-screen/scripts/apps/script-catalog-input.js";
import { registerScriptFunctions } from "../dmicher-master-screen/scripts/script-functions/index.js";

test("script catalog keeps incompatible and Premium functions visible but disabled", () => {
  globalThis.game = { i18n: { lang: "en" }, modules: new Map() };
  const entries = getScriptCatalogEntries({ scriptScope: "group", owner: { documentName: "Group" } });
  assert.equal(entries.find(entry => entry.id === "wait").disabled, false);
  assert.match(entries.find(entry => entry.id === "move").reason, /Unavailable/);
  assert.equal(entries.find(entry => entry.id === "move").disabled, true);
  assert.equal(entries.find(entry => entry.id === "macro").disabled, true);
  assert.match(entries.find(entry => entry.id === "macro").reason, /Premium/);
});

test("function providers can validate the editor's functionsOwner", () => {
  const unregister = registerScriptFunctions([{
    id: "owner-aware", label: { ru: "Владелец", en: "Owner" }, category: { ru: "внешние", en: "external" },
    description: { ru: "Проверяет владельца", en: "Checks owner" }, scopes: ["world"], premium: false, template: {}, normalize: value => value,
    acceptsOwner: owner => owner?.documentName === "Scene"
  }]);
  try {
    assert.equal(getScriptCatalogEntries({ scriptScope: "world", functionsOwner: { documentName: "Scene" } }).find(entry => entry.id === "owner-aware").disabled, false);
    assert.equal(getScriptCatalogEntries({ scriptScope: "world", functionsOwner: { documentName: "Token" } }).find(entry => entry.id === "owner-aware").disabled, true);
  } finally { unregister(); }
});

test("macro catalog contains empty, new and only registered owner macros", () => {
  globalThis.game = { i18n: { lang: "en" }, macros: new Map([
    ["own", { id: "own", uuid: "Macro.own", name: "Own Macro" }],
    ["foreign", { id: "foreign", uuid: "Macro.foreign", name: "Foreign Macro" }]
  ]) };
  const catalog = { macros: [{ ownerKey: "Token:npc", uuid: "Macro.own" }, { ownerKey: "Token:other", uuid: "Macro.foreign" }] };
  const entries = getScriptMacroEntries({ ownerKey: "Token:npc", catalog });
  assert.deepEqual(entries.map(entry => entry.id), [SCRIPT_MACRO_NONE, SCRIPT_MACRO_NEW, "Macro.own"]);
  assert.deepEqual(entries.map(entry => entry.label), ["—", "<New macro>", "Own Macro"]);
});

test("new macro is prompted, created, attached and cancellation has no side effects", async () => {
  const calls = [];
  const cancelled = await createAttachedScriptMacro({ promptName: async () => null,
    createMacro: async () => { calls.push("create"); }, attachMacro: async () => { calls.push("attach"); } });
  assert.equal(cancelled, null);
  assert.deepEqual(calls, []);

  const macro = { uuid: "Macro.created", name: "Created" };
  const result = await createAttachedScriptMacro({
    promptName: async () => "  Created  ",
    createMacro: async data => { calls.push(["create", data]); return macro; },
    attachMacro: async uuid => { calls.push(["attach", uuid]); }
  });
  assert.equal(result, macro);
  assert.deepEqual(calls, [
    ["create", { name: "Created", type: "script", scope: "global", command: "" }],
    ["attach", "Macro.created"]
  ]);
});

test("shared native macro prompt validates, creates and attaches in that order", async () => {
  const calls = [], macro = { uuid: "Macro.shared", name: "Shared" };
  const dialog = { wait: async options => {
    calls.push("prompt");
    return options.buttons[0].callback(null, null, { element: { querySelector: () => ({ value: "  Shared  " }) } });
  } };
  const macroClass = { create: async (data, options) => { calls.push(["create", data, options]); return macro; } };
  const result = await promptAndCreateAttachedScriptMacro({ dialog, macroClass,
    validate: () => calls.push("validate"), attachMacro: async uuid => calls.push(["attach", uuid]) });
  assert.equal(result, macro);
  assert.deepEqual(calls, ["prompt", "validate", ["create", { name: "Shared", type: "script", scope: "global", command: "" }, { renderSheet: true }], "validate", ["attach", "Macro.shared"]]);
});
