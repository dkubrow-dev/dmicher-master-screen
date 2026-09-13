import test from "node:test";
import assert from "node:assert/strict";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { ScriptAudioService } from "../dmicher-master-screen/scripts/script-audio.js";

// Only Foundry's document/network boundary is simulated. Message delivery,
// addressing, tracking, authority, queues and removal use the real Generics API.
function fixture(generation) {
  const hooks = new Map(), scene = { id: "scene" }, sounds = [], created = [], deleted = [], rows = new Map();
  let sequence = 0;
  const gm = { id: "gm", role: 4, isGM: true }, player = { id: "player", role: 1 };
  const informer = { id: "informer", role: 1, flags: { "dmicher-generics": {
    managedIdentity: { version: 1, ownerId: "dmicher-generics", key: "informer" }
  } } };
  globalThis.game = { user: gm, release: { generation }, users: new Map([gm, player, informer].map(user => [user.id, user])), messages: new Map() };
  globalThis.Hooks = {
    on(name, listener) { if (!hooks.has(name)) hooks.set(name, new Set()); hooks.get(name).add(listener); return listener; },
    off(name, listener) { hooks.get(name)?.delete(listener); }
  };
  const fire = (name, ...args) => { for (const listener of [...(hooks.get(name) ?? [])]) listener(...args); };
  const element = () => ({ nodeType: 1, hidden: false, querySelector() {} });
  globalThis.foundry = { utils: { randomID: () => `key-${++sequence}` } };
  game.audio = { environment: {}, create(options) {
    const sound = { options, volume: 1, plays: [], stopped: 0,
      async load(options) { assert.deepEqual(options, { autoplay: false }); },
      async play(options) { this.plays.push(options); this.volume = options.volume; },
      async stop() { this.stopped++; }
    }; sounds.push(sound); return sound;
  } };
  globalThis.CONFIG = { ChatMessage: { documentClass: { async create(data) {
    created.push(structuredClone(data));
    const message = { ...structuredClone(data), id: `message-${++sequence}`, author: game.users.get(data.author),
      getFlag(namespace, key) { return this.flags[namespace]?.[key]; },
      canUserModify(user, operation) { return operation === "delete" && (user.id === this.author.id || user.role === 4); },
      async delete() { deleted.push(this.id); game.messages.delete(this.id); fire("deleteChatMessage", this); return this; }
    };
    game.messages.set(message.id, message);
    fire("createChatMessage", message);
    const row = element(); rows.set(message.id, row);
    fire(generics.chat.getChatMessageRenderHook(), message, row);
    return message;
  } } } };
  const service = new ScriptAudioService(generics.chat, { getScene: () => scene, owns: () => true }); service.start();
  return { service, scene, sounds, created, deleted, rows, hooks, fire, element,
    options: { scene, runId: "run", isCurrent: () => true } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

for (const generation of [13, 14]) test(`Foundry ${generation}: real Generics delivers one hidden authenticated audio document and removes it at native completion`, async () => {
  const f = fixture(generation);
  await f.service.sound("worlds/test/alarm.ogg", 0.35, f.options); await settle();
  assert.equal(f.created.length, 1); assert.equal(game.messages.size, 1); assert.equal(f.sounds.length, 1);
  const message = [...game.messages.values()][0], data = f.created[0];
  assert.equal(generics.chat.getMessageAuthorId(message), "gm");
  assert.deepEqual(data.whisper, ["gm", "player"]); // Technical identities are excluded by Generics.
  assert.deepEqual(generics.chat.getChatMetadata(message), {
    apiVersion: 1, ownerId: "dmicher-master-screen", channel: "script-audio", key: data.flags["dmicher-master-screen"].scriptAudio.playbackId,
    kind: "script-audio", technical: true, recipientId: null
  });
  assert.equal(f.rows.get(message.id).hidden, true);
  assert.equal(f.sounds[0].options.context, game.audio.environment);
  assert.equal(f.sounds[0].plays.length, 1); assert.equal(f.sounds[0].volume, 0.35);
  const wrapped = f.element(); f.fire("renderChatMessageHTML", message, [wrapped]); assert.equal(wrapped.hidden, true);
  for (const change of [{ ownerId: "dmicher-other" }, { channel: "npc-speech" }, { technical: false }, { apiVersion: 2 }]) {
    const unrelated = { ...message, getFlag: undefined, flags: structuredClone(message.flags) };
    Object.assign(unrelated.flags["dmicher-generics"].chat, change);
    const row = f.element(); f.fire("renderChatMessageHTML", unrelated, row); assert.equal(row.hidden, false);
  }
  f.sounds[0].plays[0].onended(); await settle();
  assert.deepEqual(f.deleted, [message.id]); assert.equal(game.messages.size, 0); assert.equal(f.service.records.size, 0);
  f.service.dispose(); assert.ok([...f.hooks.values()].every(listeners => listeners.size === 0));
});

test("real Generics deletion after Stop closes playback without waiting for a subsequent native completion", async () => {
  const f = fixture(14); await f.service.sound("alarm.ogg", 1, f.options); await settle();
  f.service.stop(f.scene); assert.equal(f.sounds[0].volume, 0); assert.ok(f.sounds[0].stopped > 0);
  await settle(); assert.equal(f.deleted.length, 1); assert.equal(game.messages.size, 0);
  f.sounds[0].plays[0].onended(); await settle(); assert.equal(f.deleted.length, 1);
  f.service.dispose();
});
