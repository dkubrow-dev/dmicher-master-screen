import test from "node:test";
import assert from "node:assert/strict";
import { SpotlightAutomationBridge, normalizeSpotlightParameters, validateWorldScript } from "../dmicher-master-screen/scripts/spotlight-automation.js";
import { InvocationScriptRunner } from "../dmicher-master-screen/scripts/invocation-script-runner.js";
import { getScriptFunction, listScriptFunctions } from "../dmicher-master-screen/scripts/script-functions/index.js";

const owner = { type: "requests", id: "requests" }, source = { type: "focus", id: "focus" };
const fnId = "spotlight.requests.test";
const script = () => ({ name: "World", steps: [{ id: 1, kind: fnId, parameters: { seconds: 1, userId: "p" } }] });
function fixture({ runner, subscriptions, authority = true } = {}) {
  const values = new Map(), definitions = new Map(), callbacks = new Map(), executed = [], errors = [], sceneEvents = [];
  globalThis.game = { user: { id: "gm", role: 4, active: true, isGM: true }, users: [], paused: false, modules: new Map(), i18n: { lang: "en" },
    settings: { register(_module, key, definition) { definitions.set(key, definition); values.set(key, definition.default); },
      get: (_module, key) => values.get(key), async set(_module, key, value) { values.set(key, value); definitions.get(key)?.onChange?.(value); } } };
  globalThis.canvas = undefined;
  globalThis.Hooks = { on(name, callback) { callbacks.set(name, callback); return name; }, off(name) { callbacks.delete(name); } };
  const preparation = { revision: 0, subscriptions: subscriptions ?? [{ id: "sub", enabled: true, source, event: "focus.indicatorChanged", script: script() }], registeredMacroUuids: [] };
  let listener;
  const subscriptionsCount = { added: 0, removed: 0 };
  const host = { apiVersion: 1,
    functions(owner) { return owner.type === "requests" ? [{ id: fnId, label: { ru: "Тест", en: "Test" }, path: { ru: "спотлайт", en: "spotlight" }, description: { ru: "Тест", en: "Test" }, ownerTypes: ["requests"], premium: false, template: { seconds: 1, userId: "" } }] : []; },
    sources: () => [{ ...owner, owner, events: ["requests.submitted"] }, { ...source, owner: source, events: ["focus.indicatorChanged"] }],
    readBindings: candidate => candidate.type === owner.type ? structuredClone(preparation) : { revision: 0, subscriptions: [] },
    canExecute: () => true,
    async execute(id, params, context) { assert.equal(context.current(), true); executed.push({ id, params, context }); },
    subscribe(callback) { subscriptionsCount.added++; listener = callback; return () => { subscriptionsCount.removed++; listener = null; }; } };
  const runs = [];
  const fakeRunner = { async run(input) { runs.push(input); }, cancel() {}, dispose() {} };
  const bridge = new SpotlightAutomationBridge({ runner: runner ?? fakeRunner, authority: () => authority, onError: error => errors.push(error), onSceneEvent: event => sceneEvents.push(event) });
  bridge.registerSettings(); bridge.connect(host);
  return { bridge, host, preparation, runs, executed, errors, sceneEvents, values, callbacks, subscriptionsCount, event: (id = crypto.randomUUID(), extra = {}) => ({ id, owner: source, name: "focus.indicatorChanged", parameters: { userId: "p", zone: "doubt" }, at: Date.now(), ...extra }),
    receive: event => listener?.(event), setAuthority(value) { authority = value; } };
}

test("Spotlight descriptors register world-only owner-aware functions and dispose cleanly", () => {
  const f = fixture();
  assert.equal(getScriptFunction(fnId).acceptsOwner(owner), true);
  assert.equal(getScriptFunction(fnId).acceptsOwner(source), false);
  assert.equal(listScriptFunctions({ scope: "object", owner }).find(fn => fn.id === fnId).disabled, true);
  assert.equal(listScriptFunctions({ scope: "world", owner }).find(fn => fn.id === fnId).disabled, false);
  assert.throws(() => validateWorldScript(script(), source), /unavailable/);
  assert.throws(() => normalizeSpotlightParameters({ seconds: 1 }, { seconds: NaN }), /Invalid/);
  f.bridge.dispose(); assert.equal(getScriptFunction(fnId), undefined);
});
test("world events dispatch exactly once without a scene and ignore spoofed or disabled sources", async () => {
  const f = fixture();
  const event = f.event(); await f.receive(event); await f.receive(event);
  assert.equal(f.runs.length, 1); assert.equal(f.sceneEvents.length, 1);
  assert.deepEqual(f.runs[0].context.parameters, { event: JSON.stringify(event.parameters) });
  assert.deepEqual(f.runs[0].context.causality.visited, ["requests:requests:sub"]);
  await f.receive(f.event(undefined, { name: "focus.forged" })); assert.equal(f.runs.length, 1);
  f.setAuthority(false); await f.receive(f.event()); assert.equal(f.runs.length, 1);
  f.bridge.dispose();
});
test("a repeated subscription in one causal chain, depth overflow and receipt repeats never launch work", async () => {
  const f = fixture();
  await f.receive(f.event(undefined, { causality: { rootId: "root", depth: 1, visited: ["requests:requests:sub"] } }));
  await f.receive(f.event(undefined, { causality: { rootId: "root", depth: 16, visited: [] } }));
  assert.equal(f.runs.length, 0);
  for (let index = 0; index < 70; index++) await f.receive(f.event(undefined, { causality: { rootId: "budget", depth: 1, visited: [] } }));
  assert.equal(f.runs.length, 64);
  f.bridge.dispose();
});
test("STOP cancels world runs on pause and resume does not replay past events", async () => {
  const waiting = [];
  const runner = { run: input => new Promise(resolve => waiting.push({ input, resolve })), cancel() { for (const entry of waiting) entry.resolve({}); }, dispose() {} };
  const f = fixture({ runner });
  game.paused = true;
  const work = f.receive(f.event());
  assert.equal(f.bridge.active.size, 1);
  await f.bridge.stop(); await work;
  assert.equal(f.bridge.active.size, 0); assert.equal(waiting[0].input.current(), false);
  await f.receive(f.event()); assert.equal(waiting.length, 1);
  await f.bridge.resume(); assert.equal(waiting.length, 1);
  f.bridge.dispose();
});
test("revision changes and removed sources cancel waits, and macro authority uses explicit registration", async () => {
  const waiting = [];
  const runner = { run: input => new Promise(resolve => waiting.push({ input, resolve })), cancel() { for (const entry of waiting) entry.resolve({}); }, dispose() {} };
  const f = fixture({ runner });
  f.preparation.registeredMacroUuids = ["Macro.allowed"]; f.bridge.refresh();
  const work = f.receive(f.event());
  assert.equal(waiting[0].input.adapters.isMacroAttached("Macro.allowed"), true);
  assert.equal(waiting[0].input.adapters.isMacroAttached("Macro.unattached"), false);
  f.preparation.revision++; f.bridge.refresh(); await work;
  assert.equal(waiting[0].input.current(), false);
  f.bridge.dispose();
});
test("active calls are bounded and independent of scene switches", async () => {
  const waiting = [];
  const runner = { run: input => new Promise(resolve => waiting.push({ input, resolve })), cancel() { for (const entry of waiting) entry.resolve({}); }, dispose() {} };
  const subscriptions = Array.from({ length: 120 }, (_, index) => ({ id: `sub-${index}`, enabled: true, source, event: "focus.indicatorChanged", script: script() }));
  const f = fixture({ runner, subscriptions });
  const work = f.receive(f.event());
  assert.equal(waiting.length, 100);
  globalThis.canvas = { scene: { id: "changed" } };
  assert.equal(waiting[0].input.current(), true);
  await f.bridge.stop(); await work; f.bridge.dispose();
});
test("the shared interpreter executes registered Spotlight steps and passes checked causal context", async () => {
  const runner = new InvocationScriptRunner(); runner.startClock = () => {};
  const f = fixture({ runner });
  const work = f.receive(f.event());
  for (let index = 0; index < 5; index++) await runner.tick();
  await work;
  assert.equal(f.errors.length, 0);
  assert.equal(f.executed.length, 1);
  assert.equal(f.executed[0].context.owner.type, "requests");
  assert.equal(f.executed[0].context.causality.depth, 1);
  assert.equal(f.executed[0].context.current(), false);
  f.bridge.dispose();
});

test("optional provider reconnect has one subscription and retains event deduplication", async () => {
  const f = fixture();
  const event = f.event(); await f.receive(event);
  f.bridge.connect(f.host);
  assert.equal(f.subscriptionsCount.added, 1);
  f.bridge.connect(null);
  assert.equal(getScriptFunction(fnId), undefined);
  assert.equal(f.subscriptionsCount.removed, 1);
  f.bridge.connect(f.host);
  assert.equal(f.subscriptionsCount.added, 2);
  await f.receive(event); await f.receive(f.event());
  assert.equal(f.runs.length, 2);
  f.bridge.dispose(); assert.equal(f.subscriptionsCount.removed, 2);
});

test("authority loss releases a pending world invocation even while the game is paused", async () => {
  const waiting = [];
  const runner = { run: input => new Promise(resolve => waiting.push({ input, resolve })), cancel() { for (const entry of waiting) entry.resolve({}); }, dispose() {} };
  const f = fixture({ runner });
  game.modules.set("dmicher-spotlight-tools", { active: true, api: { automation: f.host } });
  f.bridge.install(); game.paused = true;
  const work = f.receive(f.event()); assert.equal(f.bridge.active.size, 1);
  f.setAuthority(false); f.callbacks.get("updateUser")(); await work;
  assert.equal(f.bridge.active.size, 0); assert.equal(waiting[0].input.current(), false);
  f.bridge.dispose(); assert.equal(f.callbacks.size, 0);
});
