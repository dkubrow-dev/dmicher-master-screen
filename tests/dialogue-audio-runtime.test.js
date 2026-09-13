import test from "node:test";
import assert from "node:assert/strict";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { DialogueAudioController } from "../dmicher-master-screen/scripts/dialogue-audio.js";
import { getDialogueAudioPickerOptions, resolveDialogueAudio } from "../dmicher-master-screen/scripts/premium-provider.js";
import { registerDialogueVolume, DIALOGUE_VOLUME_SETTING, getDialogueVolume } from "../dmicher-master-screen/scripts/dialogue-volume.js";
import { masterScreenExtension } from "../../dmicher-premium/dmicher-premium/sctipts/features/master-screen/index.js";

const message = (id, audio = `${id}.ogg`) => ({ id, role: "object", audio });
const pending = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture({ licensed = true, load, play } = {}) {
  let active = licensed, changed = 0;
  const sounds = [], saved = new Map(), definitions = new Map();
  globalThis.game = { i18n: { lang: "en" }, settings: {
    get: (_id, key) => saved.get(key) ?? definitions.get(key)?.default,
    register: (_id, key, definition) => definitions.set(key, definition),
    set: async (_id, key, value) => { saved.set(key, value); definitions.get(key)?.onChange?.(value); }
  } };
  registerDialogueVolume();
  const registration = generics.premium.registerProvider({ apiVersion: 1, hasAccess: (id) => active && id === "dmicher-master-screen", extensions: [masterScreenExtension] });
  const controller = new DialogueAudioController({ onChange: () => changed++, create: (src) => {
    const sound = { src, played: [], stopped: 0, volume: 1,
      load: async () => { if (load) await load.promise; },
      play: async (options) => { sound.played.push(options); sound.volume = options.volume; if (play) await play.promise; },
      stop: async () => { sound.stopped++; }, end: () => sound.played.at(-1)?.onended() };
    sounds.push(sound); return sound;
  } });
  return { controller, sounds, saved, definitions, get changed() { return changed; },
    grant(value) { active = value; registration.notifyChanged(); },
    finish() { controller.dispose(); registration.dispose(); } };
}

test("configured dialogue audio remains inert without a provider or module grant", async () => {
  assert.equal(resolveDialogueAudio("saved.ogg"), null);
  assert.equal(getDialogueAudioPickerOptions("saved.ogg"), null);
  const f = fixture({ licensed: false });
  try {
    await f.controller.sync([message("a")]);
    assert.equal(await f.controller.replay("a"), false); assert.equal(f.sounds.length, 0);
    assert.deepEqual(f.controller.messageState("a"), { available: false, playing: false, canReplay: false });
    f.grant(true);
    assert.equal(f.sounds.length, 0, "granting access never starts historical audio");
    assert.deepEqual(getDialogueAudioPickerOptions("saved.ogg"), { type: "audio", current: "saved.ogg" });
    assert.equal(await f.controller.replay("a"), true);
    f.grant(false);
    assert.equal(f.sounds[0].volume, 0); assert.equal(f.sounds[0].stopped, 1);
    assert.equal(resolveDialogueAudio("saved.ogg"), null);
    assert.equal(getDialogueAudioPickerOptions("saved.ogg"), null);
  } finally { f.finish(); }
});

test("new blocks autoplay once, old history can replay and silent blocks stop the prior voice", async () => {
  const f = fixture();
  try {
    await f.controller.sync([message("a"), message("b")]);
    assert.deepEqual(f.sounds.map((sound) => sound.src), ["b.ogg"]);
    await f.controller.sync([message("a"), message("b")]); assert.equal(f.sounds.length, 1);
    assert.equal(f.controller.messageState("b").canReplay, false);
    assert.equal(await f.controller.replay("b"), false);
    f.sounds[0].end(); assert.equal(f.controller.messageState("b").canReplay, true);
    assert.equal(await f.controller.replay("a"), true);
    await f.controller.sync([message("a"), message("b"), message("c", "")]);
    assert.equal(f.sounds[1].stopped, 1); assert.equal(f.controller.current, null);
    assert.ok(f.changed > 1);
  } finally { f.finish(); }
});

test("revocation or window closure during load never reaches native play", async () => {
  for (const cancel of ["revoke", "dispose"]) {
    const load = pending(), f = fixture({ load });
    try {
      const playback = f.controller.sync([message("a")]);
      if (cancel === "revoke") f.grant(false); else f.controller.dispose();
      load.resolve(); assert.equal(await playback, false);
      assert.equal(f.sounds[0].played.length, 0);
    } finally { f.finish(); }
  }
});

test("late native start is muted and stopped again after revocation", async () => {
  const play = pending(), f = fixture({ play });
  try {
    const playback = f.controller.sync([message("a")]);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(f.sounds[0].played.length, 1);
    f.grant(false); assert.equal(f.sounds[0].volume, 0);
    play.resolve(); assert.equal(await playback, false);
    assert.ok(f.sounds[0].stopped >= 2); assert.equal(f.sounds[0].volume, 0);
  } finally { f.finish(); }
});

test("newest block wins when preceding audio loads late", async () => {
  const load = pending(), f = fixture({ load });
  try {
    const first = f.controller.sync([message("a")]);
    const second = f.controller.sync([message("a"), message("b")]);
    load.resolve(); await Promise.all([first, second]);
    assert.equal(f.sounds[0].played.length, 0); assert.equal(f.sounds[1].played.length, 1);
  } finally { f.finish(); }
});

test("dialogue volume persists per client and updates a playing voice", async () => {
  const f = fixture();
  try {
    assert.equal(f.definitions.get(DIALOGUE_VOLUME_SETTING).scope, "client");
    await game.settings.set("dmicher-master-screen", DIALOGUE_VOLUME_SETTING, 0.4);
    await f.controller.sync([message("a")]);
    assert.equal(f.sounds[0].played[0].volume, 0.4);
    await game.settings.set("dmicher-master-screen", DIALOGUE_VOLUME_SETTING, 0);
    assert.equal(f.sounds[0].volume, 0); assert.equal(getDialogueVolume(), 0);
    f.sounds[0].end(); await game.settings.set("dmicher-master-screen", DIALOGUE_VOLUME_SETTING, 0.8);
    await f.controller.replay("a"); assert.equal(f.sounds[1].played[0].volume, 0.8);
  } finally { f.finish(); }
});

test("native playback uses an independent local Sound and never asks Foundry to autoplay", async () => {
  const f = fixture();
  let created, loading, playing;
  const sound = { load: async (options) => { loading = options; }, play: async (options) => { playing = options; }, stop: async () => {} };
  game.audio = { interface: { channel: "interface" }, create: (options) => { created = options; return sound; } };
  const native = new DialogueAudioController();
  try {
    assert.equal(await native.sync([message("native")]), true);
    assert.deepEqual(created, { src: "native.ogg", context: game.audio.interface, singleton: false, preload: false, autoplay: false });
    assert.deepEqual(loading, { autoplay: false });
    assert.equal(playing.loop, false); assert.equal(playing.volume, 1); assert.equal(typeof playing.onended, "function");
    assert.equal(Object.hasOwn(playing, "broadcast"), false);
    playing.onended(); assert.equal(native.messageState("native").canReplay, true);
  } finally { native.dispose(); f.finish(); }
});

test("audio load failure leaves conversation usable and offers explicit retry", async () => {
  const f = fixture(), originalError = console.error, warnings = [];
  globalThis.ui = { notifications: { warn: (value) => warnings.push(value) } };
  console.error = () => {};
  f.controller.create = () => ({ load: async () => { throw new Error("missing file"); }, stop: async () => {} });
  try {
    assert.equal(await f.controller.sync([message("missing")]), false);
    assert.equal(f.controller.messageState("missing").canReplay, true);
    assert.equal(warnings.length, 1);
    await f.controller.sync([message("missing")]); assert.equal(warnings.length, 1, "rerender never retries a failed source");
  } finally { console.error = originalError; delete globalThis.ui; f.finish(); }
});
