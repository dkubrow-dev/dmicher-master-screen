import test from "node:test";
import assert from "node:assert/strict";
import { directorExecutionRows, directorInteractionRows } from "../dmicher-master-screen/scripts/director-activity-model.js";
import { readDirectorActivity } from "../dmicher-master-screen/scripts/director-activity.js";
import { scriptProgressKey } from "../dmicher-master-screen/scripts/script-model.js";
import { renderMenu } from "../dmicher-master-screen/scripts/apps/ide-view.js";

globalThis.game = { i18n: { lang: "en" } };
const target = { type: "Token", id: "npc" };
const binding = { ...target, groupId: "hall" };
const script = (id, extra = {}) => ({ id, enabled: true, name: id, target, steps: [{ id: 1, kind: "wait" }, { id: 7, kind: "move" }], ...extra });
const progress = (block, slot, extra = {}) => ({ [scriptProgressKey(target, block, slot)]: { status: "ready", stepId: 7, ...extra } });
const run = (extra = {}) => ({ groupId: "hall", runId: "current", stateId: "calm", state: { transitions: [], scripts: [] }, scriptStates: {}, ...extra });
const executionRows = extra => directorExecutionRows({ groupId: "hall", bindings: [binding], objectName: () => "Guard", ...extra });
const session = (kind, extra = {}) => ({ sessionId: `${kind}-1`, groupId: "hall", runId: "current", target,
  actorTokenId: "hero", userId: "player", dialogueId: "greeting", shopId: "inn", status: "active", expiresAt: 500, ...extra });
const interactionRows = extra => directorInteractionRows({ sceneId: "scene", now: 100,
  dialogueNames: new Map([["greeting", "Greeting"]]), shopNames: new Map([["inn", "Inn"]]),
  objectName: () => "Guard", tokenName: id => ({ hero: "Hero", listener: "Listener" })[id], userName: () => "Player", ...extra });

test("Director activity navigation is unavailable in Constructor", () => {
  assert.match(renderMenu("detail", [], "activity", { mode: "director" }), /data-id="activity"/);
  assert.doesNotMatch(renderMenu("detail", [], "parameters", { mode: "constructor" }), /data-id="activity"/);
});

test("Activity reads all live scene interactions, private sessions and listeners, without reading transcripts", () => {
  const dialogue = session("dialogue", { presentation: { visibility: "private" },
    participants: [{ role: "listener", actorTokenId: "listener", expiresAt: 300 }, { role: "listener", actorTokenId: "old", expiresAt: 80 }] });
  Object.defineProperty(dialogue, "history", { get() { throw new Error("Transcript must not be read"); } });
  const view = interactionRows({ runtimes: [run({ dialogueSessions: { a: dialogue } }), run({ groupId: "other", shopSessions: { b: session("shop", { status: "editing" }) } })] });
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].name, "Greeting"); assert.equal(view.rows[0].actor, "Hero");
  assert.equal(view.rows[0].listeners, "Listener"); assert.equal(view.rows[1].name, "Inn");
  assert.equal(view.expiresAt, 300);
  assert.deepEqual(view.rows[0].packet.target, target); assert.equal(view.rows[0].packet.runId, "current");
});

test("Finished, expired and former-run dialogues are omitted; interrupted conversations and pending stock stay visible", () => {
  const view = interactionRows({ runtimes: [run({ dialogueSessions: {
    finished: session("dialogue", { status: "finished" }), expired: session("dialogue", { expiresAt: 99 }),
    former: session("dialogue", { runId: "old" }), interrupted: session("dialogue", { status: "interrupted", sessionId: "interrupted" })
  }, shopSessions: { expired: session("shop", { status: "editing", expiresAt: 99 }),
    pending: session("shop", { status: "pending", expiresAt: 99, runId: "old" }) } })] });
  assert.equal(view.rows.length, 2); assert.equal(view.rows[0].status, "Interrupted");
  assert.equal(view.rows[1].status, "Awaiting GM approval"); assert.equal(view.expiresAt, 500);
});

test("Activity signature excludes lease renewal, transcript growth and dialogue step counters", () => {
  const conversation = session("dialogue");
  const runtimes = [run({ dialogueSessions: { a: conversation } })];
  const before = interactionRows({ runtimes }).rows;
  conversation.expiresAt += 100; conversation.step = 300; conversation.history = Array(1000).fill({ text: "history" });
  assert.deepEqual(interactionRows({ runtimes }).rows, before);
});

test("Pending shop sessions distinguish approval, processing and uncertain outcomes without reading offers", () => {
  const shop = session("shop", { status: "pending" }), receipt = { status: "processing", intent: { sessionId: shop.sessionId } };
  Object.defineProperty(receipt.intent, "giveItemIds", { get() { throw new Error("Inventory must not be read"); } });
  const current = run({ shopSessions: { inn: shop }, tradeRequests: { request: receipt } });
  assert.equal(interactionRows({ runtimes: [current] }).rows[0].status, "Trade in progress");
  receipt.status = "uncertain";
  assert.equal(interactionRows({ runtimes: [current] }).rows[0].status, "Trade reconciliation required");
});

test("The active saved transition owns execution until completed; display order never substitutes a step ID", () => {
  const transition = script("Entering", { steps: [{ id: 7, kind: "move" }, { id: 1, kind: "wait" }] }), routine = script("Patrolling");
  const current = run({ state: { transitions: [transition], scripts: [routine] }, scriptStates: { ...progress(transition, "transition"), ...progress(routine, "routine", { stepId: 1 }) } });
  let row = executionRows({ run: current })[0];
  assert.equal(row.script, "Entering"); assert.equal(row.step, "7 · Move");
  current.scriptStates[scriptProgressKey(target, transition, "transition")].status = "done";
  row = executionRows({ run: current })[0]; assert.equal(row.script, "Patrolling"); assert.equal(row.step, "1 · Wait");
});

test("Clock, native coordinates, visual timers and large step parameter JSON do not affect execution rows", () => {
  const routine = script("Patrolling"), current = run({ state: { scripts: [routine] }, scriptStates: progress(routine, "routine") });
  const before = executionRows({ run: current });
  const state = current.scriptStates[scriptProgressKey(target, routine, "routine")];
  state.action = { remainingMs: 7000, movement: { x: 103.5 } }; state.emojiAt = 1000;
  Object.defineProperty(routine.steps[1], "parameters", { get() { throw new Error("Parameters must not be read"); } });
  assert.deepEqual(executionRows({ run: current }), before);
});

test("Initial restoration is visible while its group remains stopped", () => {
  const initial = script("Placement"), manual = run({ manual: true, target, script: initial, scriptStates: progress(initial, "initial") });
  const row = executionRows({ run: run({ halted: true }), manualRuns: [manual], sceneHalted: true })[0];
  assert.equal(row.script, "Placement"); assert.equal(row.phase, "Initial state"); assert.equal(row.status, "Running");
});

test("Commands expose before/core/after phases, waiting ignored steps and a queued replacement", () => {
  const routine = script("Patrolling"), before = script("Before"), after = script("After");
  const current = run({ state: { scripts: [routine] }, scriptStates: progress(routine, "routine") });
  const command = { groupId: "hall", target, config: { id: "follow" }, phase: "waiting", pendingReplacement: { config: { id: "wait" } } };
  let row = executionRows({ run: current, commandRuns: [command] })[0];
  assert.equal(row.script, "Patrolling"); assert.equal(row.step, "7 · Move"); assert.match(row.command, /Then: Wait/);
  assert.equal(row.phase, "Command waiting for script");
  for (const [phase, block] of [["before", before], ["after", after]]) {
    Object.assign(command, { phase, script: block, scriptSlot: `command-${phase}`, scriptStates: progress(block, `command-${phase}`) });
    row = executionRows({ run: current, commandRuns: [command] })[0];
    assert.equal(row.script, block.name); assert.equal(row.step, "7 · Move");
  }
  Object.assign(command, { phase: "core", script: null });
  row = executionRows({ run: current, commandRuns: [command] })[0]; assert.equal(row.phase, "Command"); assert.equal(row.step, "—");
  command.interruption = { source: "interaction" };
  assert.equal(executionRows({ run: current, commandRuns: [command] })[0].status, "Interaction · Waiting to resume");
});

test("Every selected group's object has a row including idle, disabled and missing objects", () => {
  assert.equal(executionRows({ run: null })[0].status, "Not started");
  assert.equal(executionRows({ run: run({ disabledObjects: ["Token:npc"] }) })[0].status, "Automation disabled");
  assert.equal(executionRows({ objectName: () => "" })[0].status, "Unavailable");
  assert.equal(executionRows({ bindings: [{ ...binding, groupId: "other" }] }).length, 0);
});

test("Raw adapter forbids player reads and reads no normalized catalog/history or mutable world documents", () => {
  const scene = { id: "scene", getFlag() { throw new Error("Players must not read GM activity"); } };
  assert.deepEqual(readDirectorActivity(scene, { isGM: false }), { interactions: [], executions: [], expiresAt: null, groupName: "" });
  const flags = { groupDefinitions: { hall: { groupName: "Hall" } }, groupRuntimes: { hall: run() }, objectBindings: { bindings: { "Token:npc": binding } } };
  scene.getFlag = (_module, key) => flags[key]; scene.tokens = new Map([["npc", { name: "Guard" }]]);
  const before = JSON.stringify(flags), view = readDirectorActivity(scene, { isGM: true, groupId: "hall" });
  assert.equal(view.groupName, "Hall"); assert.equal(view.executions[0].object, "Guard"); assert.equal(JSON.stringify(flags), before);
});

test("Activity state descriptions stay aligned in RU and EN", () => {
  for (const [lang, expected] of [["ru", "Не запущен"], ["en", "Not started"]]) {
    game.i18n.lang = lang; assert.equal(executionRows({ run: null })[0].status, expected);
  }
});

test("Native walls and lights without names remain available by document ID", () => {
  const flags = { objectBindings: { bindings: { "Wall:wall": { type: "Wall", id: "wall", groupId: "hall" }, "AmbientLight:light": { type: "AmbientLight", id: "light", groupId: "hall" } } } };
  const scene = { id: "scene", walls: new Map([["wall", { id: "wall" }]]), lights: new Map([["light", { id: "light" }]]), getFlag: (_scope, key) => flags[key] };
  const view = readDirectorActivity(scene, { groupId: "hall", isGM: true });
  assert.deepEqual(view.executions.map(row => [row.object, row.status]), [["wall", "Not started"], ["light", "Not started"]]);
});
