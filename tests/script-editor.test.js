import test from "node:test";
import assert from "node:assert/strict";
import { readScriptFields, buildScriptFields, bindScriptInterruptions } from "../dmicher-master-screen/scripts/apps/script-fields.js";
import { appendScriptStep, removeScriptStep, moveScriptStep } from "../dmicher-master-screen/scripts/script-editing.js";
import { normalizeScript, scriptStepTemplate, SCRIPT_STEP_KINDS } from "../dmicher-master-screen/scripts/script-model.js";
import { completeScriptParameters, renderScriptParameters, setScriptParameter } from "../dmicher-master-screen/scripts/apps/script-parameters.js";
import { registerScriptFunctions } from "../dmicher-master-screen/scripts/script-functions/index.js";

test("delete and append cannot resurrect an incoming edge to a removed step", () => {
  const script = { stateId: "calm", repeat: false, steps: [] };
  appendScriptStep(script); appendScriptStep(script); appendScriptStep(script);
  script.steps[0].next = [3];
  removeScriptStep(script, 2); appendScriptStep(script);
  assert.deepEqual(script.steps[0].next, []);
  assert.deepEqual(script.steps[1].next, [3]);
  assert.deepEqual(normalizeScript(script).steps, script.steps);
});

test("visual row movement preserves all identities and branches even after save normalization", () => {
  const script = { stateId: "calm", repeat: false, steps: [] };
  appendScriptStep(script); appendScriptStep(script); appendScriptStep(script);
  script.steps[0].next = [2, 3]; script.steps[2].next = [1];
  const before = structuredClone(script.steps);
  assert.equal(moveScriptStep(script, 0, 2), true);
  assert.deepEqual(script.steps.map((step) => step.id), [2, 3, 1]);
  assert.deepEqual(normalizeScript(script).steps.toSorted((a, b) => a.id - b.id), before);
  assert.equal(moveScriptStep(script, 3, 0), false);
});

test("entry step remains present while there are other rows, and an empty block is allowed", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const script = { stateId: "calm", repeat: false, steps: [] };
  appendScriptStep(script); appendScriptStep(script);
  assert.throws(() => removeScriptStep(script, 0), /step 1/);
  removeScriptStep(script, 1); removeScriptStep(script, 0);
  assert.deepEqual(normalizeScript(script).steps, []);
});

test("step form preserves branching identities through normalization and rejects malformed destinations", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const fields = { "script-0-name": "Patrol", "script-0-repeat": true, "script-0-enabled": true, "script-0-step-0-kind": "wait", "script-0-step-0-parameters": '{"seconds":0.25}',
    "script-0-step-0-next": "9, 777", "script-0-step-1-kind": "emotion", "script-0-step-1-parameters": '{"emoji":""}', "script-0-step-1-next": "" };
  const root = { querySelector(selector) { const name = selector.match(/name="([^"]+)"/)[1]; return Object.hasOwn(fields,name) ? { value: fields[name], checked: fields[name] === true } : null; } };
  const scripts = [{ stateId: "calm", repeat: false, steps: [{ id: 1 }, { id: 9 }] }];
  const captured = readScriptFields(root, scripts)[0], result = normalizeScript(captured);
  assert.deepEqual(result.steps.map((step) => ({ id: step.id, next: step.next })), [{ id: 1, next: [9] }, { id: 9, next: [] }]);
  assert.equal(result.repeat, true);
  fields["script-0-step-0-next"] = "1,,2";
  assert.throws(() => readScriptFields(root, scripts), /positive step numbers/);
});

test("unlicensed premium steps expose marked disabled parameters and JSON but retain prepared values on save", () => {
  globalThis.game = { i18n: { lang: "en" }, modules: new Map() };
  for (const kind of ["focus", "sound", "playlist", "macro"]) {
    const step = { id: 1, kind, parameters: scriptStepTemplate(kind).parameters, next: [] };
    const html = buildScriptFields([{ steps: [step], name: "Prepared", repeat: false }], { states: [] }, "Token", {});
    assert.ok(html.includes(`data-script-premium="${kind}" disabled`));
    assert.ok(html.includes('class="dmicher-premium-badge">Premium</span>'));
    assert.match(html, /data-script-json[^>]* disabled/);
    assert.match(html, /data-script-json-value[^>]* disabled/);
    assert.doesNotMatch(html, /<select[^>]*data-script-kind[^>]* disabled/);
    const values = { "script-0-name": "Prepared", "script-0-step-0-kind": kind, "script-0-step-0-next": "", "script-0-step-0-parameters": "{broken input" };
    const root = { querySelector(selector) { const name = selector.match(/name="([^"]+)"/)[1]; return Object.hasOwn(values, name) ? { value: values[name] } : null; } };
    const saved = readScriptFields(root, [{ steps: [step] }])[0];
    assert.deepEqual(saved.steps[0].parameters, step.parameters);
    assert.notEqual(saved.steps[0].parameters, step.parameters);
  }
});

test("script interruption fields share the editor, localize both languages and retain disabled limits", () => {
  const previous = globalThis.game;
  try {
    for (const [lang, title, combat, interaction, manual, error, next] of [
      ["ru", "При прерывании скрипта", "Боем", "Взаимодействием с игроком", "Ручной остановкой", "Ошибкой", "Перейти к следующему шагу"],
      ["en", "When the script is interrupted", "Combat", "Player interaction", "Manual stop", "Error", "Go to the next step"]
    ]) {
      globalThis.game = { i18n: { lang } };
      for (const combatSupported of [false, true]) {
        const script = normalizeScript({ steps: [], interruptions: { error: { retries: 7, delaySeconds: 2.5 } } });
        const html = buildScriptFields([script], { states: [] }, "Token", {}, { combatSupported });
        for (const label of [title, combat, interaction, manual, error, next]) assert.ok(html.includes(label), label);
        assert.equal((html.match(/name="script-0-interruption-(combat|interaction|manual|command|error)"/g) ?? []).length, 5);
        assert.equal((html.match(/value="stop" selected/g) ?? []).length, 5);
        assert.equal((html.match(/value="ignore"/g) ?? []).length, 1);
        assert.ok(html.includes('min="1" max="10" step="1" value="7" data-script-error-setting disabled'));
        assert.ok(html.includes('min="0.1" max="60" step="any" value="2.5" data-script-error-setting disabled'));
        script.interruptions.error.mode = "restart-step";
        assert.ok(!buildScriptFields([script], { states: [] }, "Token", {}, { combatSupported }).includes("data-script-error-setting disabled"));
      }
    }
  } finally { globalThis.game = previous; }
});

test("changing error behavior toggles only its own limits without recreating controls or losing input", () => {
  let listener;
  const fields = [{ disabled: true, value: "9" }, { disabled: true, value: "0.25" }];
  const root = { addEventListener(type, callback) { assert.equal(type, "change"); listener = callback; } };
  const target = { value: "restart-script", matches: selector => selector === "[data-script-error-mode]", closest: () => ({ querySelectorAll: () => fields }) };
  bindScriptInterruptions(root);
  listener({ target });
  assert.deepEqual(fields.map(field => field.disabled), [false, false]);
  target.value = "stop"; listener({ target });
  assert.deepEqual(fields.map(field => field.disabled), [true, true]);
  assert.deepEqual(fields.map(field => field.value), ["9", "0.25"]);
});

test("saving script interruption options includes disabled limits and rejects invalid user input", () => {
  const script = normalizeScript({ steps: [] });
  const fields = {
    "script-0-name": "Watch", "script-0-enabled": true, "script-0-repeat": false,
    "script-0-interruption-combat": "restart-step", "script-0-interruption-interaction": "next-step", "script-0-interruption-manual": "restart-script",
    "script-0-interruption-error": "stop", "script-0-interruption-retries": "10", "script-0-interruption-delay": "0.1"
  };
  const root = { querySelector(selector) {
    const name = selector.match(/name="([^"]+)"/)[1];
    return Object.hasOwn(fields, name) ? { value: fields[name], checked: fields[name] === true } : null;
  } };
  const saved = normalizeScript(readScriptFields(root, [script])[0]);
  assert.deepEqual(saved.interruptions, { combat: "restart-step", interaction: "next-step", playerAction: "stop", manual: "restart-script", command: "stop", error: { mode: "stop", retries: 10, delaySeconds: 0.1 } });
  fields["script-0-interruption-retries"] = "1.5";
  assert.throws(() => normalizeScript(readScriptFields(root, [script])[0]));
});

const token = { documentName: "Token", x: 325, y: 210, rotation: 45, width: 2, height: 3, depth: 4, parent: { grid: { size: 100 } } };
const param = (path) => `data-script-param="${JSON.stringify(path).replaceAll('"', '&quot;')}"`;

test("move editor uses native current geometry and retains fields of both time modes", () => {
  const duration = completeScriptParameters("move", undefined, token);
  assert.deepEqual(duration.position, { x: 325, y: 210, speed: 5 });
  assert.deepEqual(duration.rotation, { mode: "absolute", angle: 45, speed: 90 });
  assert.deepEqual(duration.size, { x: 2, y: 3, z: 4, speed: 1 });
  const html = renderScriptParameters({ kind: "move", parameters: duration }, { document: token });
  assert.ok(html.includes(param(["duration"])));
  assert.ok(!html.includes(param(["position", "speed"])));
  assert.ok(html.includes('data-screen-action="script-point"'));
  const speed = completeScriptParameters("move", { ...duration, timeMode: "speed", duration: 7 }, token);
  const speedHTML = renderScriptParameters({ kind: "move", parameters: speed }, { document: token });
  assert.ok(!speedHTML.includes(param(["duration"])));
  assert.ok(speedHTML.includes(param(["position", "speed"])));
  assert.ok(speedHTML.includes(param(["rotation", "speed"])));
  assert.ok(speedHTML.includes(param(["size", "speed"])));
  assert.equal(speed.duration, 7);
  assert.deepEqual(normalizeScript({ steps: [{ id: 1, kind: "move", parameters: speed, next: [] }] }).steps[0].parameters, speed);
});

test("unsupported dimensions stay null and native pixel sizes are converted once", () => {
  const tile = { documentName: "Tile", x: 20, y: 30, rotation: 0, width: 250, height: 300, parent: { grid: { size: 100 } } };
  assert.deepEqual(completeScriptParameters("move", undefined, tile).size, { x: 2.5, y: 3, z: null, speed: 1 });
  const light = { documentName: "AmbientLight", x: 20, y: 30, rotation: 0 };
  assert.equal(completeScriptParameters("move", undefined, light).size, null);
  const explicit = completeScriptParameters("move", { position: null, rotation: null, size: null }, token);
  assert.equal(explicit.position, null);
  assert.equal(explicit.rotation, null);
  assert.equal(explicit.size, null);
});

test("all built-in action kinds expose compact tables and a collapsed synchronized JSON editor", () => {
  globalThis.game = { i18n: { lang: "en" } };
  const steps = SCRIPT_STEP_KINDS.map((kind, index) => ({ id: index + 1, ...scriptStepTemplate(kind) }));
  const html = buildScriptFields([{ name: "A", steps }], { states: [] }, "Token", { signals: [], macros: [] }, { document: token, ownerKey: "Token:t" });
  assert.equal((html.match(/data-script-json aria-expanded="false"/g) ?? []).length, SCRIPT_STEP_KINDS.length);
  assert.equal((html.match(/data-script-json-value hidden/g) ?? []).length, SCRIPT_STEP_KINDS.length);
  assert.equal((html.match(/data-script-parameter-fields/g) ?? []).length, SCRIPT_STEP_KINDS.length);
  assert.ok(html.includes('data-param-group="chat"'));
  assert.ok(html.includes('data-param-group="bubble"'));
  assert.ok(html.includes(param(["volume"])));
  assert.ok(html.includes(param(["visible"])));
  assert.ok(html.includes(param(["before"])));
});

test("script rows use service, function-with-parameters and transition columns", () => {
  globalThis.game = { i18n: { lang: "en" }, modules: new Map() };
  const step = { id: 1, ...scriptStepTemplate("wait") };
  const html = buildScriptFields([{ name: "A", enabled: true, steps: [step] }], { states: [] }, "Token", {}, { scriptScope: "object", owner: token });
  const header = html.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] ?? "";
  assert.equal((header.match(/<th\b/g) ?? []).length, 3);
  assert.match(html, /<input type="hidden"[^>]*data-script-kind[^>]*value="wait"/);
  assert.match(html, /class="ms-script-kind-storage" hidden><input type="hidden"/);
  assert.match(html, /<td class="ms-script-main-cell">[\s\S]*data-script-kind-input[\s\S]*data-script-json[\s\S]*data-script-parameter-fields/);
  assert.match(html, /<td data-script-transition>[\s\S]*data-screen-action="remove-script-step"/);
  assert.match(html, /class="ms-script-kind-row"/);
  assert.match(html, /class="ms-script-json-action"/);
  assert.match(html, /data-script-kind-input[^>]*value="system\.general\.Wait"/);
  assert.match(html, /data-script-kind-button/);
  assert.doesNotMatch(html, /<select[^>]*data-script-kind/);
});

test("automation has explicit fields, pause has no parameters and provider templates use generic fields", () => {
  const automation = renderScriptParameters({ kind: "automation", parameters: { objectUuid: "Token.target", enabled: false } });
  assert.ok(automation.includes(param(["objectUuid"])));
  assert.ok(automation.includes(param(["enabled"])));
  const pause = renderScriptParameters({ kind: "pause", parameters: {} });
  assert.doesNotMatch(pause, /data-script-param=/);

  const unregister = registerScriptFunctions([{
    id: "provider-example", label: { ru: "Пример", en: "Example" }, category: { ru: "внешние", en: "external" },
    description: { ru: "Поля провайдера", en: "Provider fields" }, scopes: ["object"], premium: false,
    template: { title: "Keep", count: 2, enabled: true, nested: { flag: false }, values: [1, 2] }, normalize: value => value
  }]);
  try {
    const html = renderScriptParameters({ kind: "provider-example", parameters: { title: "Keep", count: 2, enabled: true, nested: { flag: false }, values: [1, 2] } });
    for (const path of [["title"], ["count"], ["enabled"], ["nested", "flag"], ["values"]]) assert.ok(html.includes(param(path)), JSON.stringify(path));
  } finally { unregister(); }
});

test("provider field metadata localizes labels and keeps stale enum values visible", () => {
  globalThis.game = { i18n: { lang: "en" } }; let received;
  const unregister = registerScriptFunctions([{
    id: "provider-metadata", label: { ru: "Метаданные", en: "Metadata" }, category: { ru: "внешние", en: "external" },
    description: { ru: "Поля", en: "Fields" }, scopes: ["world"], premium: false,
    template: { urgency: "legacy", userId: "User.old", minutes: 5 }, normalize: value => value,
    fields: context => { received = context.ownerKey; return {
      urgency: { label: { ru: "Срочность", en: "Urgency" }, options: [{ value: "common", label: { ru: "Обычно", en: "Common" } }] },
      userId: { label: { ru: "Пользователь", en: "User" }, options: [] }, minutes: { label: { ru: "Минуты", en: "Minutes" } }
    }; }
  }]);
  try {
    const html = renderScriptParameters({ kind: "provider-metadata", parameters: { urgency: "legacy", userId: "User.old", minutes: 5 } }, { ownerKey: "Scene:test" });
    assert.equal(received, "Scene:test");
    for (const label of ["Urgency", "User", "Minutes"]) assert.ok(html.includes(label));
    assert.match(html, /value="legacy" selected disabled/); assert.match(html, /value="User.old" selected disabled/);
    assert.match(html, /value="common">Common/);
  } finally { unregister(); }
});

test("player character scripts replace interaction with a Premium player-action policy", () => {
  globalThis.game = { i18n: { lang: "en" }, modules: new Map() };
  const script = normalizeScript({ steps: [], interruptions: { playerAction: "forbid" } });
  const html = buildScriptFields([script], { states: [] }, "Token", {}, { playerCharacter: true });
  assert.ok(html.includes("Player action"));
  assert.ok(html.includes('name="script-0-interruption-playerAction"'));
  assert.ok(html.includes('value="forbid" selected disabled'));
  assert.ok(html.includes('class="dmicher-premium-badge">Premium</span>'));
  assert.ok(!html.includes('name="script-0-interruption-interaction"'));
});

test("disabling chat hides dependent rows without discarding their JSON values", () => {
  const parameters = completeScriptParameters("speech", { chat: { enabled: false, text: "Keep this text", allowTags: ["hero"] } });
  const html = renderScriptParameters({ kind: "speech", parameters });
  assert.ok(html.includes(param(["chat", "enabled"])));
  assert.ok(!html.includes(param(["chat", "text"])));
  assert.equal(parameters.chat.text, "Keep this text");
  assert.deepEqual(parameters.chat.allowTags, ["hero"]);
  assert.equal(parameters.chat.timing, "before");
});

test("zero action durations are highlighted without flagging speed, offsets or signal payload values", () => {
  for (const kind of ["wait", "move", "approach", "emotion", "speech"]) {
    const key = kind === "wait" ? "seconds" : "duration";
    const parameters = { [key]: 0 };
    const zero = renderScriptParameters({ kind, parameters });
    assert.equal((zero.match(/class="ms-script-zero-duration"/g) ?? []).length, 1, kind);
    assert.ok(zero.includes("data-script-duration"));
    assert.ok(!zero.includes("aria-invalid"));
    parameters[key] = 0.25;
    assert.ok(!renderScriptParameters({ kind, parameters }).includes('class="ms-script-zero-duration"'), kind);
    if (["move", "approach"].includes(kind)) {
      parameters[key] = 0; parameters.timeMode = "speed"; parameters.speed = 0;
      assert.ok(!renderScriptParameters({ kind, parameters }).includes("data-script-duration"), kind);
    }
  }
  for (const kind of ["signal", "macro", "follow", "sound"]) {
    const html = renderScriptParameters({ kind, parameters: { before: 0, after: 0, speed: 0, volume: 0, parameters: { duration: 0 } } });
    assert.ok(!html.includes("data-script-duration"), kind);
    assert.ok(!html.includes('class="ms-script-zero-duration"'), kind);
  }
});

test("emotion and speech expose localized execution modes directly before duration and keep JSON values", () => {
  const previous = globalThis.game;
  try {
    for (const [lang, label, parallel, wait] of [["ru", "Режим выполнения", "Вместе со следующим", "До следующего"], ["en", "Execution mode", "Alongside next step", "Before next step"]]) {
      globalThis.game = { i18n: { lang } };
      for (const kind of ["emotion", "speech"]) {
        const parameters = completeScriptParameters(kind, { duration: 3.25, ...(kind === "speech" ? { chat: { text: "Keep this text" }, bubble: { text: "Bubble" } } : { emoji: "!", size: 18.5 }) });
        const html = renderScriptParameters({ kind, parameters });
        assert.ok(html.includes(`aria-label="${label}"`));
        assert.ok(html.includes(parallel) && html.includes(wait));
        const modeIndex = html.indexOf(param(["executionMode"]));
        const durationIndex = html.indexOf(param(["duration"]));
        assert.ok(modeIndex >= 0 && durationIndex > modeIndex);
        assert.equal((html.slice(modeIndex, durationIndex).match(/<tr>/g) ?? []).length, 1);
        for (const executionMode of ["parallel", "wait"]) {
          setScriptParameter(parameters, ["executionMode"], executionMode);
          const fromJSON = JSON.parse(JSON.stringify(parameters));
          assert.deepEqual(normalizeScript({ steps: [{ id: 1, kind, parameters: fromJSON }] }).steps[0].parameters, fromJSON);
          assert.equal(fromJSON.duration, 3.25);
          if (kind === "speech") { assert.equal(fromJSON.chat.text, "Keep this text"); assert.equal(fromJSON.bubble.text, "Bubble"); }
          else { assert.equal(fromJSON.emoji, "!"); assert.equal(fromJSON.size, 18.5); }
        }
      }
    }
  } finally { globalThis.game = previous; }
});

test("signal parameter paths treat Unicode, punctuation and prototype names as data", () => {
  const parameters = JSON.parse('{"parameters":{"__proto__":{"x":1},"a.b":2}}');
  setScriptParameter(parameters, ["parameters", "__proto__", "x"], 7);
  setScriptParameter(parameters, ["parameters", "a.b"], 5);
  setScriptParameter(parameters, ["parameters", "оценка"], 3);
  assert.equal(parameters.parameters.__proto__.x, 7);
  assert.equal(parameters.parameters["a.b"], 5);
  assert.equal(parameters.parameters["оценка"], 3);
  assert.equal(Object.prototype.x, undefined);
  const html = renderScriptParameters({ kind: "signal", parameters: { signalId: "s", ...parameters } }, { ownerKey: "Token:t", catalog: { signals: [{ id: "s", name: "<Signal>", emitterKey: "Token:t", parameters: [] }], macros: [] } });
  assert.ok(!html.includes("<Signal>"));
  assert.ok(html.includes("&lt;Signal&gt;"));
  assert.ok(html.includes(param(["parameters", "a.b"])));
});
