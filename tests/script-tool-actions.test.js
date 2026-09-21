import test from "node:test";
import assert from "node:assert/strict";
import { executePlaylistAction } from "../dmicher-master-screen/scripts/script-functions/playlist.js";
import { executeScriptFunction } from "../dmicher-master-screen/scripts/script-functions/index.js";
const executeScriptToolAction = (job, { runtime, current, executionCurrent = current }) => executeScriptFunction(job.step.kind,
  { ...job, job, p: job.step.parameters, engine: { runtime }, admitted: current, executionCurrent });

function playlistFixture() {
  const calls = [], sound = { id: "track", playing: false, pausedTime: null, volume: 1, sound: { currentTime: 23.5 },
    async update(data) { calls.push(["update", data]); Object.assign(this, data); } };
  const playlist = { id: "music", sounds: new Map([[sound.id, sound]]),
    async playSound(selected) { calls.push(["play", selected.id]); selected.playing = true; },
    async stopSound(selected) { calls.push(["stop", selected.id]); selected.playing = false; selected.pausedTime = null; } };
  globalThis.game = { user: { isGM: true }, i18n: { lang: "en" }, playlists: new Map([[playlist.id, playlist]]) };
  return { calls, sound, playlist, run: (action, extra = {}, options = {}) => executePlaylistAction({ playlistId: playlist.id, soundId: sound.id, action, volume: 1, ...extra }, { available: () => true, ...options }) };
}

test("playlist commands use native replicated playback, pause offset and volume without changing client volume settings", async () => {
  const f = playlistFixture();
  await f.run("play"); await f.run("pause");
  assert.equal(f.sound.pausedTime, 23.5); assert.equal(f.sound.playing, false);
  await f.run("resume"); await f.run("volume", { volume: 0.35 }); await f.run("stop");
  assert.deepEqual(f.calls, [["play", "track"], ["update", { playing: false, pausedTime: 23.5 }], ["play", "track"], ["update", { volume: 0.35 }], ["stop", "track"]]);
  assert.equal(f.sound.volume, 0.35); assert.equal(f.sound.pausedTime, null);
});
test("playlist premium, stale execution and invalid current-track selection cannot change playback", async () => {
  const f = playlistFixture();
  assert.deepEqual(await f.run("play", {}, { available: () => false }), { premiumSkipped: true });
  await f.run("play", {}, { current: () => false }); assert.equal(f.calls.length, 0);
  await assert.rejects(f.run("volume", { volume: 1.1 }), /between 0 and 1/);
  f.sound.playing = true; f.playlist.sounds.set("second", { id: "second", playing: true });
  await assert.rejects(f.run("pause", { soundId: "" }), /several current tracks/);
  assert.equal(f.calls.length, 0);
});
test("playlist start rechecks execution after resetting a paused track", async () => {
  const f = playlistFixture(); let current = true;
  f.sound.pausedTime = 12; f.sound.update = async data => { f.calls.push(["update", data]); current = false; };
  await f.run("play", {}, { current: () => current });
  assert.deepEqual(f.calls, [["update", { pausedTime: null }]]);
});
test("script window and note actions select a stored configuration with the current execution guard", async () => {
  playlistFixture(); const calls = [], current = () => true;
  const runtime = { workspacePresets: { async activate(...args) { calls.push(args); } } };
  const scene = { id: "scene" };
  for (const kind of ["windows", "notes"]) await executeScriptToolAction({ scene, step: { kind, parameters: { configurationId: "configuration" } } }, { runtime, current });
  assert.deepEqual(calls.map(value => value.slice(0, 3)), [[scene, "windows", "configuration"], [scene, "notes", "configuration"]]);
  assert.equal(calls[0][3].isCurrent, current);
});
test("script command resolves a native object of the same scene and forwards only its prepared parameters", async () => {
  playlistFixture(); const target = { id: "door", documentName: "Wall" }, source = { id: "source", documentName: "Token" };
  const scene = { id: "scene", walls: new Map([[target.id, target]]) }, calls = [];
  const runtime = { commandService: { async invokeFromScript(value) { calls.push(value); return { runId: "command-run" }; } } };
  const job = { scene, object: source, step: { kind: "command", parameters: { objectUuid: "Scene.scene.Wall.door", commandId: "open", parameters: {} } } };
  await executeScriptToolAction(job, { runtime, current: () => true });
  assert.equal(calls[0].target, target); assert.equal(calls[0].commander, source); assert.equal(calls[0].commandId, "open");
  job.step.parameters.objectUuid = "Scene.foreign.Wall.door";
  await assert.rejects(executeScriptToolAction(job, { runtime, current: () => true }), /current scene/); assert.equal(calls.length, 1);
});
test("a script shop excludes only its own new lease from admission and returns a wait reference", async () => {
  playlistFixture(); const source = { id: "source" }, target = { type: "Token", id: source.id }, scene = { id: "scene" };
  const reference = { sessionId: "s", userId: "player", actorTokenId: "pc", shopId: "shop" }, probes = [];
  const runtime = { scriptState: () => ({ runId: "run" }), currentObject: (_scene, _run, _target, options) => { probes.push(options); return true; },
    async startScriptShop(command, options) { assert.equal(command.runId, "run"); assert.equal(command.tokenUuid, "Scene.scene.Token.pc"); assert.equal(options.isCurrent([reference]), true); return reference; } };
  const result = await executeScriptToolAction({ scene, object: source, target, runId: "run", groupId: "main", progressKey: "source:script", script: { combat: { enabled: false } },
    step: { kind: "shop", parameters: { shopId: "shop", tokenUuid: "Scene.scene.Token.pc", wait: true } } }, { runtime, current: () => true });
  assert.deepEqual(result, { shopSessions: [reference] }); assert.deepEqual(probes[0].excludeShopSessions, [reference]);
});
