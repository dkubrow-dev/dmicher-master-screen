import test from "node:test";
import assert from "node:assert/strict";
import { ScriptAudioService, scriptAudioIsCurrent } from "../dmicher-master-screen/scripts/script-audio.js";
import { notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";
import { sceneFixture, descriptor } from "./fixtures/scene.js";
import { getRuntime, saveRuntime } from "../dmicher-master-screen/scripts/store.js";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const hooks = new Map(), messages = new Map(), sounds = [], removed = [], scene = { id: "scene" };
  let ids = 0, current = true;
  globalThis.game = { user: { id: "gm", role: 4, isGM: true }, users: new Map([["gm", { id: "gm", role: 4 }], ["player", { id: "player", role: 1 }]]) };
  globalThis.Hooks = { on(name, listener) { if (!hooks.has(name)) hooks.set(name, new Set()); hooks.get(name).add(listener); return listener; },
    off(name, listener) { hooks.get(name)?.delete(listener); } };
  const fire = (name, ...args) => { for (const listener of [...(hooks.get(name) ?? [])]) listener(...args); };
  const chat = { createMessageService: () => ({
    async create(data, options) {
      if (!options.enabled()) return [];
      const message = { ...data, id: `message-${++ids}`, flags: { ...data.flags,
        "dmicher-generics": { chat: { apiVersion: 1, ownerId: "dmicher-master-screen", channel: "script-audio", technical: true } } } };
      messages.set(message.id, message); fire("createChatMessage", message); return [message];
    }, get: id => messages.get(id), async remove(id) { const message = messages.get(id); if (message) { removed.push(id); messages.delete(id); fire("deleteChatMessage", message); } }
  }) };
  const create = src => {
    const sound = { src, plays: [], stops: 0, volume: 1, async load() {}, async play(options) { this.plays.push(options); this.volume = options.volume; }, async stop() { this.stops++; } };
    sounds.push(sound); return sound;
  };
  const service = new ScriptAudioService(chat, { create, getScene: id => id === scene.id ? scene : null, owns: () => current });
  service.start();
  return { service, scene, chat, create, sounds, messages, removed, fire, hooks, stopOwnership: () => { current = false; },
    options: { scene, runId: "run", isCurrent: () => current } };
}

test("script audio uses authenticated technical delivery and cancels natively before async cleanup", async () => {
  const f = fixture();
  await f.service.sound("voice.ogg", 0.4, f.options); await flush();
  assert.equal(f.sounds.length, 1); assert.equal(f.sounds[0].plays.length, 1);
  assert.equal(f.messages.size, 1);
  f.service.stop(f.scene);
  assert.equal(f.sounds[0].volume, 0); assert.ok(f.sounds[0].stops > 0);
  assert.equal(f.service.records.size, 0); await flush();
  assert.equal(f.messages.size, 0); f.service.dispose();
});

test("stop during load prevents late playback; stop during native play also mutes its late result", async () => {
  for (const phase of ["load", "play"]) {
    const f = fixture(), pending = deferred(), abort = new AbortController();
    f.service.create = src => { const sound = f.create(src); sound[phase] = async options => { if (phase === "play") sound.plays.push(options); await pending.promise; }; return sound; };
    await f.service.sound("pending.ogg", 0.8, { ...f.options, signal: abort.signal }); await flush();
    abort.abort();
    assert.equal(f.sounds[0].volume, 0);
    pending.resolve(); await flush();
    assert.equal(f.sounds[0].plays.length, phase === "play" ? 1 : 0);
    assert.equal(f.sounds[0].volume, 0); assert.equal(f.service.records.size, 0); f.service.dispose();
  }
});

test("a received sound stops on message deletion and rejects player-authored or unknown delivery", async () => {
  const f = fixture(); await f.service.sound("remote.ogg", 1, f.options); await flush();
  const message = structuredClone([...f.messages.values()][0]); f.service.dispose();
  game.user = game.users.get("player");
  const remote = new ScriptAudioService(f.chat, { create: f.create, getScene: () => f.scene, owns: () => true }); remote.start();
  remote.receive({ ...message, id: "forged", author: "player" });
  remote.receive({ ...message, id: "bad-channel", flags: { ...message.flags, "dmicher-generics": {} } });
  assert.equal(remote.records.size, 0);
  remote.receive({ ...message, id: "remote" }); await flush();
  assert.equal(remote.records.size, 1);
  f.fire("deleteChatMessage", { id: "remote" });
  assert.equal(f.sounds.at(-1).volume, 0); assert.equal(remote.records.size, 0); remote.dispose();
});

test("execution halt cancels active playback without waiting for a scene update", async () => {
  const f = fixture(); await f.service.sound("alarm.ogg", 1, f.options); await flush();
  notifyExecutionChange(f.scene, "halt-all");
  assert.equal(f.sounds[0].volume, 0); assert.equal(f.service.records.size, 0);
  f.service.dispose();
});

test("natural completion removes only its own sound and does not replay a delivered message", async () => {
  const f = fixture(); await f.service.sound("first.ogg", 1, f.options); await f.service.sound("second.ogg", 1, { ...f.options, runId: "second" }); await flush();
  const message = [...f.messages.values()][0];
  f.sounds[0].plays[0].onended(); await flush();
  assert.equal(f.service.records.size, 1); assert.equal(f.messages.size, 1);
  f.service.receive(message); assert.equal(f.sounds.length, 2);
  f.service.stop(f.scene, { runIds: ["unrelated"] }); assert.equal(f.service.records.size, 1);
  f.service.stop(f.scene, { runIds: ["second"] }); assert.equal(f.service.records.size, 0);
  f.service.dispose(); assert.ok([...f.hooks.values()].every(listeners => listeners.size === 0));
});

test("a stop while technical delivery is pending deletes the late message without playback", async () => {
  const f = fixture(), pending = deferred(), original = f.service.messages.create;
  f.service.messages.create = async (...args) => { await pending.promise; return original(...args); };
  const sound = f.service.sound("late.ogg", 1, f.options);
  f.service.stop(f.scene); pending.resolve(); await sound; await flush();
  assert.equal(f.sounds.length, 0); assert.equal(f.messages.size, 0); assert.equal(f.service.requests.size, 0); f.service.dispose();
});

test("script stop isolates run, object type and script while retaining scene audio", async () => {
  const f = fixture(), target = { type: "Token", id: "npc" }, scriptKey = "Token:npc:routine:calm";
  const inputs = [
    { target, scriptKey, scriptGeneration: 2 },
    { target, scriptKey: "Token:npc:transition:calm", scriptGeneration: 2 },
    { target: { type: "Token", id: "other" }, scriptKey: "Token:other:routine:calm" },
    { target: { type: "Tile", id: "npc" }, scriptKey: "Tile:npc:routine:calm" },
    { target, scriptKey, runId: "other-run" },
    {}
  ];
  for (const [index, options] of inputs.entries()) await f.service.sound(`${index}.ogg`, 1, { ...f.options, ...options });
  await flush();
  f.service.stop(f.scene, { runIds: ["run"], target, scriptKey });
  assert.equal(f.sounds[0].volume, 0);
  assert.deepEqual(f.sounds.slice(1).map(sound => sound.volume), [1, 1, 1, 1, 1]);
  assert.equal(f.service.records.size, 5); await flush(); assert.equal(f.messages.size, 5);
  f.service.dispose();
});

test("scoped stop invalidates only matching deliveries that are still waiting", async () => {
  const f = fixture(), pending = deferred(), original = f.service.messages.create, target = { type: "Token", id: "npc" };
  f.service.messages.create = async (...args) => { await pending.promise; return original(...args); };
  const stopped = f.service.sound("stopped.ogg", 1, { ...f.options, target, scriptKey: "Token:npc:routine:calm" });
  const retained = f.service.sound("retained.ogg", 1, { ...f.options, target, scriptKey: "Token:npc:transition:calm" });
  f.service.stop(f.scene, { runIds: ["run"], target, scriptKey: "Token:npc:routine:calm" });
  pending.resolve(); await Promise.all([stopped, retained]); await flush();
  assert.deepEqual(f.sounds.map(sound => sound.src), ["retained.ogg"]);
  assert.equal(f.service.records.size, 1); f.service.dispose();
});

async function scopedWorld() {
  const world = sceneFixture(), group = await world.editor.createGroup();
  await world.objects.save(descriptor, { groupId: group.groupId });
  const scriptKey = "Token:npc:routine:calm", run = getRuntime(world.scene, { groupId: group.groupId });
  run.runId = "run"; run.stateId = group.entryStateId; run.halted = false;
  run.scriptStates[scriptKey] = { stepId: 1, sequence: 1, generation: 0, status: "ready" };
  await saveRuntime(world.scene, run);
  return { ...world, run, scriptKey, data: { sceneId: world.scene.id, runId: run.runId, manual: false, target: descriptor, scriptKey, scriptGeneration: 0 } };
}

test("script audio generation ignores normal step progress and rejects stale or mismatched script ownership", async () => {
  const f = await scopedWorld();
  assert.equal(scriptAudioIsCurrent(f.scene, f.data), true);
  Object.assign(f.run.scriptStates[f.scriptKey], { stepId: 2, sequence: 2, status: "done" });
  await saveRuntime(f.scene, f.run); assert.equal(scriptAudioIsCurrent(f.scene, f.data), true);
  f.run.scriptStates[f.scriptKey].generation = 1;
  await saveRuntime(f.scene, f.run); assert.equal(scriptAudioIsCurrent(f.scene, f.data), false);
  assert.equal(scriptAudioIsCurrent(f.scene, { ...f.data, scriptGeneration: 1 }), true);
  for (const changes of [{ scriptGeneration: -1 }, { scriptGeneration: 0.5 }, { scriptGeneration: "1" },
    { scriptKey: "Token:pc:routine:calm" }, { scriptKey: "Token:npc:routine:missing" }, { target: { type: "Tile", id: "npc" } }]) {
    assert.equal(scriptAudioIsCurrent(f.scene, { ...f.data, scriptGeneration: 1, ...changes }), false);
  }
  delete f.run.scriptStates[f.scriptKey].generation; await saveRuntime(f.scene, f.run);
  assert.equal(scriptAudioIsCurrent(f.scene, f.data), true);
});

test("command script audio follows command generation, interruption and its parent group run", async () => {
  const f = await scopedWorld(), key = "Token:npc", scriptKey = "Token:npc:command-before:script";
  const command = { schemaVersion: 1, command: true, runId: "command-run", parentRunId: f.run.runId,
    groupId: f.run.groupId, target: descriptor, phase: "before", scriptStates: { [scriptKey]: { generation: 2, status: "ready" } } };
  const data = { ...f.data, runId: command.runId, scriptKey, scriptGeneration: 2 };
  const save = () => f.scene.setFlag("dmicher-master-screen", "objectCommandRuns", { [key]: command });
  await save(); assert.equal(scriptAudioIsCurrent(f.scene, data), true);
  command.phase = "core"; await save(); assert.equal(scriptAudioIsCurrent(f.scene, data), true);
  command.scriptStates[scriptKey].generation = 3; await save(); assert.equal(scriptAudioIsCurrent(f.scene, data), false);
  data.scriptGeneration = 3; assert.equal(scriptAudioIsCurrent(f.scene, data), true);
  command.interruption = { source: "interaction" }; await save(); assert.equal(scriptAudioIsCurrent(f.scene, data), false);
  command.interruption = null;
  for (const phase of ["waiting", "finished", "stopped"]) {
    command.phase = phase; await save(); assert.equal(scriptAudioIsCurrent(f.scene, data), false);
  }
  command.phase = "after"; command.parentRunId = "replaced";
  await save(); assert.equal(scriptAudioIsCurrent(f.scene, data), false);
  command.parentRunId = f.run.runId; await save();
  f.run.halted = true; await saveRuntime(f.scene, f.run);
  assert.equal(scriptAudioIsCurrent(f.scene, data), false);
});

test("remote scoped audio checks its saved generation after loading and during playback", async () => {
  for (const duringLoad of [true, false]) {
    const f = fixture(), world = await scopedWorld(), pending = deferred(); f.service.dispose();
    const service = new ScriptAudioService(f.chat, { getScene: () => world.scene, create: src => {
      const sound = f.create(src); if (duringLoad) sound.load = () => pending.promise; return sound;
    } });
    service.start();
    const message = { id: "remote", author: "gm", flags: {
      "dmicher-generics": { chat: { apiVersion: 1, ownerId: "dmicher-master-screen", channel: "script-audio", technical: true } },
      "dmicher-master-screen": { scriptAudio: { ...world.data, src: "remote.ogg", volume: 0.7, playbackId: "remote-playback" } }
    } };
    service.receive(message); await flush();
    Object.assign(world.run.scriptStates[world.scriptKey], { stepId: 2, sequence: 2 });
    await saveRuntime(world.scene, world.run); notifyExecutionChange(world.scene);
    assert.equal(service.records.size, 1);
    world.run.scriptStates[world.scriptKey].generation = 1; await saveRuntime(world.scene, world.run);
    if (duringLoad) pending.resolve(); else notifyExecutionChange(world.scene);
    await flush();
    assert.equal(f.sounds[0].plays.length, duringLoad ? 0 : 1);
    assert.equal(f.sounds[0].volume, 0); assert.equal(service.records.size, 0);
    service.dispose();
  }
});

test("manual audio cannot survive a later full stop, even for an object outside groups", async () => {
  const f = sceneFixture(); await f.objects.save(descriptor, {});
  const data = { manual: true, runId: "manual", target: descriptor, manualHaltId: null, manualGroupStamp: null, groupId: null };
  assert.equal(scriptAudioIsCurrent(f.scene, data), true);
  await f.scene.setFlag("dmicher-master-screen", "automationHaltId", "next-stop");
  assert.equal(scriptAudioIsCurrent(f.scene, data), false);
  data.manualHaltId = "next-stop"; assert.equal(scriptAudioIsCurrent(f.scene, data), true);
  f.scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:npc"].playerCharacter = true;
  assert.equal(scriptAudioIsCurrent(f.scene, data), false);
});

test("ordinary audio follows object ownership and disabled state, and manual audio follows the group's stop revision", async () => {
  const f = sceneFixture(), group = await f.editor.createGroup();
  await f.objects.save(descriptor, { groupId: group.groupId });
  const run = getRuntime(f.scene, { groupId: group.groupId });
  run.runId = "run"; run.stateId = group.entryStateId; run.halted = false; await saveRuntime(f.scene, run);
  const data = { runId: "run", target: descriptor, manual: false };
  assert.equal(scriptAudioIsCurrent(f.scene, data), true);
  run.disabledObjects = ["Token:npc"]; await saveRuntime(f.scene, run); assert.equal(scriptAudioIsCurrent(f.scene, data), false);
  const stored = getRuntime(f.scene, { groupId: group.groupId });
  const manual = { ...data, manual: true, manualHaltId: null, groupId: group.groupId,
    manualGroupStamp: JSON.stringify([stored.runId, stored.stateId, stored.halted, stored.haltedAt]) };
  assert.equal(scriptAudioIsCurrent(f.scene, manual), true);
  run.halted = true; run.haltedAt = 1234; await saveRuntime(f.scene, run);
  assert.equal(scriptAudioIsCurrent(f.scene, manual), false);
});

test("native script audio uses an independent Sound in each client's environment channel without autoplay", async () => {
  const f = fixture(), context = {}, calls = [];
  game.audio = { environment: context, create: options => { calls.push(options); return f.create(options.src); } };
  f.service.dispose();
  const service = new ScriptAudioService(f.chat, { getScene: () => f.scene, owns: () => true });
  await service.sound("ambient.ogg", 0.5, f.options); await flush();
  assert.deepEqual(calls, [{ src: "ambient.ogg", context, singleton: false, preload: false, autoplay: false }]);
  assert.equal(f.sounds[0].volume, 0.5); assert.equal(f.sounds[0].plays[0].loop, false);
  service.dispose();
});
