import test from "node:test";
import assert from "node:assert/strict";
import { renderObjectCommandList, renderObjectCommandFields, readObjectCommandFields } from "../dmicher-master-screen/scripts/apps/object-command-fields.js";
import { defaultObjectCommand, normalizeObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";
import { changedScriptWarnings } from "../dmicher-master-screen/scripts/script-warnings.js";

test("fixed command catalog is localized and leaves an empty binding empty", () => {
  for (const lang of ["ru", "en"]) {
    globalThis.game = { i18n: { lang } };
    const commands = [], html = renderObjectCommandList(commands);
    assert.equal((html.match(/data-command-enabled=/g) ?? []).length, 12);
    assert.equal((html.match(/ checked/g) ?? []).length, 0);
    assert.match(html, new RegExp(lang === "ru" ? "Команды движения" : "Movement commands"));
    assert.match(html, new RegExp(lang === "ru" ? "Команды взаимодействия" : "Interaction commands"));
    assert.deepEqual(commands, []);
    assert.deepEqual(readObjectCommandFields({ querySelectorAll: () => [], querySelector: () => null }, commands), []);
  }
});

test("command options share interruption controls and support every builtin without leaking raw markup", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const command = defaultObjectCommand("follow"); command.conditions.allowTags = ['<evil "tag">'];
  const html = renderObjectCommandFields(command, [{ groupId: "hall", groupName: "<Hall>", states: [{ id: "calm", name: "<Calm>" }] }]);
  assert.ok(html.includes('&lt;Hall&gt;')); assert.equal(html.includes('<evil'), false);
  assert.doesNotMatch(html, /name="command-interruption-command"/);
  assert.match(html, /name="command-interruption-manual"/);
  assert.match(html, /Restart the current phase/);
  assert.match(html, /name="command-param-minDistance"/);
  assert.match(html, /name="command-param-maxDistance"/);
  assert.match(renderObjectCommandFields(defaultObjectCommand("stop")), /value="players"/);
  assert.equal(renderObjectCommandFields(defaultObjectCommand("stop")).includes('value="commander"'), false);
  assert.match(renderObjectCommandFields(defaultObjectCommand("cancel")), /value="commander"/);
});

test("capturing selected command keeps other configs and script blocks while preserving missing references", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const command = defaultObjectCommand("come"), untouched = defaultObjectCommand("away");
  command.conditions.groups = [{ groupId: "missing", stateIds: ["old"] }, { groupId: "hall", stateIds: ["removed"] }];
  command.beforeScript = { name: "Before", steps: [] };
  const fields = { "command-range": "7", "command-allow": "Hero, Hero, trusted", "command-deny": "enemy", "command-param-speed": "3.5", "command-param-duration": "0.25" };
  const root = {
    querySelector(selector) {
      if (selector === "[data-command-fields]") return {};
      const key = selector.match(/name="([^"]+)"/)?.[1];
      return Object.hasOwn(fields, key) ? { value: fields[key] } : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-command-enabled]") return [{ dataset: { commandEnabled: "come" }, checked: true }];
      if (selector === '[name="command-group"]:checked') return [{ value: "hall" }];
      if (selector === '[name="command-state"]:checked') return [{ dataset: { groupId: "hall" }, value: "calm" }];
      return [];
    }
  };
  const result = readObjectCommandFields(root, [command, untouched], "come", [{ groupId: "hall", states: [{ id: "calm" }] }]);
  assert.equal(result[0].enabled, true); assert.deepEqual(result[1], untouched); assert.deepEqual(result[0].beforeScript, command.beforeScript);
  assert.deepEqual(result[0].conditions.groups, [{ groupId: "missing", stateIds: ["old"] }, { groupId: "hall", stateIds: ["removed", "calm"] }]);
  assert.equal(result[0].parameters.duration, 0.25); assert.equal(command.parameters.duration, 10);
  assert.equal(normalizeObjectCommand(result[0]).parameters.speed, 3.5);
  fields["command-param-duration"] = "0";
  assert.throws(() => normalizeObjectCommand(readObjectCommandFields(root, [command], "come")[0]), /greater than zero/);
});

test("command script graph warnings apply independently to before and after blocks", () => {
  const command = defaultObjectCommand("come");
  const instant = { name: "Signal", steps: [{ id: 1, kind: "emotion", parameters: {}, next: [1] }] };
  command.beforeScript = instant; command.afterScript = instant;
  const draft = { commands: [command] };
  assert.deepEqual(changedScriptWarnings({}, draft).map(warning => warning.kind), ["command-before", "command-after"]);
  assert.deepEqual(changedScriptWarnings(structuredClone(draft), draft), []);
  draft.commands[0].afterScript = { ...instant, name: "Changed" };
  assert.deepEqual(changedScriptWarnings({ commands: [{ ...command, afterScript: instant }] }, draft).map(warning => warning.kind), ["command-after"]);
});
