import test from "node:test";
import assert from "node:assert/strict";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { ChatDialogueAudio } from "../dmicher-master-screen/scripts/apps/dialogue-chat-audio.js";
import { notifyExecutionChange } from "../dmicher-master-screen/scripts/execution.js";

const flush = () => new Promise(resolve => setImmediate(resolve));
const entry = (id, audio = `${id}.ogg`) => ({ id, role: "object", name: "NPC", text: id, audio });
function fixture() {
  const sounds = [], hooks = new Map(); let serial = 0, licensed = true, delay;
  const scene = { id: "scene", getFlag: () => false }, contexts = new Map();
  globalThis.Hooks = { on(name, fn) { const id = ++serial; hooks.set(id, { name, fn }); return id; }, off(_name, id) { hooks.delete(id); } };
  globalThis.game = { i18n: { lang: "en" }, settings: { get: () => 1 }, audio: { interface: {}, create: ({ src }) => {
    const pending = delay;
    const sound = { src, stopped: 0, played: 0, volume: 1, load: async () => pending && await pending,
      play: async options => { sound.played++; sound.volume = options.volume; }, stop: async () => { sound.stopped++; } };
    sounds.push(sound); return sound;
  } } };
  const provider = generics.premium.registerProvider({ apiVersion: 1, hasAccess: () => licensed, extensions: [{ moduleId: "dmicher-master-screen", apiVersion: 1,
    methods: { resolveDialogueAudioPickerOptions: (_base, current) => ({ type: "audio", current }),
      resolveDialogueAudio: (_base, src, volume) => ({ src, volume, loop: false }) } }] });
  const presenter = new ChatDialogueAudio({ context: packet => contexts.get(packet.sessionId) });
  function conversation(id = "one", mode = "chat") {
    const session = { sessionId: id, runId: "run", history: [], presentation: { mode } }, runtime = { runId: "run", halted: false };
    const current = { scene, session, runtime }; contexts.set(id, current); return current;
  }
  function card(current, messageEntry, { created = true, save = true } = {}) {
    if (save) current.session.history.push(messageEntry);
    const packet = { sceneId: scene.id, sessionId: current.session.sessionId, runId: current.session.runId, entry: messageEntry };
    const message = { id: `${packet.sessionId}-${messageEntry.id}` };
    const button = { dataset: { messageId: messageEntry.id } }, root = { isConnected: true, querySelectorAll: () => [button] };
    if (created) presenter.created(message, packet);
    presenter.render(message, packet, root, current);
    return { packet, message, root, button, render: () => presenter.render(message, packet, root, current),
      replay: () => button.onclick({ preventDefault() {}, stopPropagation() {} }) };
  }
  return { presenter, sounds, hooks, conversation, card, scene,
    delay(value) { delay = value; }, revoke() { licensed = false; provider.notifyChanged(); },
    dispose() { presenter.dispose(); provider.dispose(); } };
}

test("chat cards share one conversation voice: next and silent blocks stop the old sound, replay retains prior snapshots", async () => {
  const f = fixture();
  try {
    const current = f.conversation(), first = f.card(current, entry("first")); await flush();
    const firstController = f.presenter.sessions.get("scene:one").dialogueAudio;
    const second = f.card(current, entry("second")); await flush();
    assert.equal(f.sounds[0].stopped, 1); assert.equal(f.sounds[0].volume, 0);
    assert.equal(f.presenter.sessions.get("scene:one").dialogueAudio, firstController);
    assert.equal(f.hooks.size, 1, "one native execution watcher covers every card in a session");
    f.card(current, entry("silent", "")); await flush();
    assert.equal(f.sounds[1].stopped, 1); assert.equal(f.sounds.length, 2);
    first.replay(); await flush(); assert.equal(f.sounds.at(-1).src, "first.ogg");
    second.replay(); await flush(); assert.equal(f.sounds.at(-2).stopped, 1); assert.equal(f.sounds.at(-1).src, "second.ogg");
    first.render(); await flush(); assert.equal(f.sounds.length, 4, "rendering an older card cannot restart or replace replay");
    f.revoke(); assert.equal(f.sounds.at(-1).stopped, 1); assert.equal(f.sounds.at(-1).volume, 0);
  } finally { f.dispose(); }
});

test("archive cards and window publications are silent; create hooks before or after render autoplay only once", async () => {
  const f = fixture();
  try {
    const current = f.conversation(), archived = f.card(current, entry("archive"), { created: false });
    await flush(); assert.equal(f.sounds.length, 0); archived.replay(); await flush(); assert.equal(f.sounds.length, 1);
    const newCard = f.card(current, entry("new"), { created: false }); await flush();
    assert.equal(f.sounds.length, 1);
    f.presenter.created(newCard.message, newCard.packet); await flush(); assert.equal(f.sounds.length, 2);
    f.presenter.created(newCard.message, newCard.packet); newCard.render(); await flush(); assert.equal(f.sounds.length, 2);
    archived.root.isConnected = false; newCard.root.isConnected = false; f.presenter.prune();
    assert.equal(f.presenter.sessions.size, 0); assert.equal(f.hooks.size, 0);
    newCard.root.isConnected = true; newCard.render(); await flush(); assert.equal(f.sounds.length, 2, "recreating DOM is not a fresh message");
    const window = f.conversation("window", "window"); f.card(window, entry("published")); await flush();
    assert.equal(f.sounds.length, 2, "window playback must not be duplicated by chat publication");
  } finally { f.dispose(); }
});

test("cancellation rejects late audio loading, refuses stopped-session replay and does not stop another session", async () => {
  const f = fixture();
  try {
    const one = f.conversation("one"), first = f.card(one, entry("one")); await flush();
    const two = f.conversation("two"); f.card(two, entry("two")); await flush();
    first.replay(); await flush(); assert.equal(f.sounds[1].stopped, 0, "separate conversations have independent voices");
    let release; f.delay(new Promise(resolve => { release = resolve; }));
    const delayed = f.card(one, entry("delayed")); await flush();
    one.runtime.halted = true; notifyExecutionChange(f.scene, "group-stopped");
    release(); await flush();
    assert.equal(f.sounds.at(-1).played, 0); assert.equal(f.sounds.at(-1).volume, 0);
    delayed.replay(); await flush(); assert.equal(f.sounds.length, 3);
    assert.equal(f.sounds[1].stopped, 0);
  } finally { f.dispose(); }
});

test("the execution hot path uses the supplied cheap predicate without rebuilding dialogue context", async () => {
  const f = fixture();
  try {
    const current = f.conversation();
    f.presenter.isCurrent = () => !current.runtime.halted;
    f.card(current, entry("voice")); await flush();
    f.presenter.context = () => assert.fail("execution notifications must not prepare dialogue context");
    for (const hook of f.hooks.values()) if (hook.name === "updateScene") hook.fn(f.scene);
    assert.equal(f.sounds[0].stopped, 0);
    current.runtime.halted = true; notifyExecutionChange(f.scene, "halt");
    assert.equal(f.sounds[0].stopped, 1);
  } finally { f.dispose(); }
});
