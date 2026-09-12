import test from "node:test";
import assert from "node:assert/strict";
import { appendScriptStep, removeScriptStep, moveScriptStep, readScriptFields, buildScriptFields } from "../dmicher-master-screen/scripts/apps/script-fields.js";
import { normalizeScript, scriptStepTemplate, SCRIPT_STEP_KINDS } from "../dmicher-master-screen/scripts/script-model.js";
import { completeScriptParameters, renderScriptParameters, setScriptParameter } from "../dmicher-master-screen/scripts/apps/script-parameters.js";

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
  assert.equal((html.match(/data-script-json aria-expanded="false"/g) ?? []).length, 8);
  assert.equal((html.match(/data-script-json-value hidden/g) ?? []).length, 8);
  assert.equal((html.match(/data-script-parameter-fields/g) ?? []).length, 8);
  assert.ok(html.includes('data-param-group="chat"'));
  assert.ok(html.includes('data-param-group="bubble"'));
  assert.ok(html.includes(param(["volume"])));
  assert.ok(html.includes(param(["visible"])));
  assert.ok(html.includes(param(["before"])));
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
