import { isDialogueAudioAvailable, resolveDialogueAudio, subscribeDialogueAudioAccess } from "./premium-provider.js";
import { getDialogueVolume, subscribeDialogueVolume } from "./dialogue-volume.js";
import { debugError, debugTrace } from "./debug.js";
import { text } from "./localization.js";

function createSound(src) {
  const audio = globalThis.game?.audio;
  if (typeof audio?.create !== "function") throw new Error("Foundry audio is unavailable.");
  return audio.create({ src, context: audio.interface, singleton: false, preload: false, autoplay: false });
}

/** Local presentation only: neither transcripts nor scene commands store playback state. */
export class DialogueAudioController {
  constructor({ onChange = () => {}, create = createSound, volume = getDialogueVolume } = {}) {
    this.onChange = onChange; this.create = create; this.volume = volume;
    this.messages = new Map(); this.seen = new Set(); this.current = null; this.disposed = false;
    this.unsubscribeAccess = subscribeDialogueAudioAccess(() => {
      if (!isDialogueAudioAvailable()) this.stop();
      this.changed();
    });
    this.unsubscribeVolume = subscribeDialogueVolume(() => {
      if (this.current?.sound) this.current.sound.volume = this.volume();
    });
  }

  sync(history = []) {
    if (this.disposed) return;
    this.messages = new Map(history.filter((entry) => entry?.id && entry.role === "object" && entry.audio)
      .map((entry) => [String(entry.id), { id: String(entry.id), audio: entry.audio }]));
    const latest = history.findLast((entry) => entry?.role === "object" && entry.id);
    const fresh = latest && !this.seen.has(String(latest.id));
    for (const entry of history) if (entry?.id) this.seen.add(String(entry.id));
    if (!isDialogueAudioAvailable()) { this.stop(); return; }
    if (this.current && !this.messages.has(this.current.id)) this.stop();
    if (!fresh) return;
    // A new silent block also ends the preceding voice. Old transcript entries
    // remain available for deliberate replay, never a burst of historical audio.
    this.stop();
    if (latest.audio) return this.play(String(latest.id));
  }

  messageState(id) {
    const available = !this.disposed && this.messages.has(String(id)) && isDialogueAudioAvailable();
    const playing = available && this.current?.id === String(id);
    return { available, playing: Boolean(playing), canReplay: available && !playing };
  }

  replay(id) {
    if (!this.messageState(id).canReplay) return Promise.resolve(false);
    return this.play(String(id));
  }

  changed() { if (!this.disposed) this.onChange(); }

  stop() {
    const prior = this.current;
    this.current = null;
    if (!prior?.sound) return;
    // Mute synchronously, even if a native asynchronous start is still pending.
    prior.sound.volume = 0;
    void Promise.resolve(prior.sound.stop()).catch((error) => debugError("dialogue", "audio.stop.error", error, { messageId: prior.id }));
  }

  async play(id) {
    const entry = this.messages.get(id);
    const options = entry && resolveDialogueAudio(entry.audio, this.volume());
    if (this.disposed || !options) return false;
    this.stop();
    const playback = { id, sound: null };
    this.current = playback; this.changed();
    const permitted = () => !this.disposed && this.current === playback
      && Boolean(resolveDialogueAudio(entry.audio, this.volume()));
    try {
      const sound = playback.sound = this.create(options.src);
      await sound.load({ autoplay: false });
      // Loading can wait for a gesture/network. Never queue autoplay in Foundry:
      // permission, window lifetime and current block are checked after the wait.
      if (!permitted()) return false;
      if (sound.failed) throw new Error(text("Не удалось загрузить звук диалога.", "Could not load dialogue audio."));
      const finish = () => {
        if (this.current !== playback) return;
        this.current = null; this.changed();
        debugTrace("dialogue", "audio.ended", { messageId: id });
      };
      await sound.play({ volume: this.volume(), loop: false, onended: finish });
      if (!permitted()) { sound.volume = 0; await sound.stop(); return false; }
      debugTrace("dialogue", "audio.started", { messageId: id, src: options.src });
      return true;
    } catch (error) {
      if (this.current === playback) {
        this.stop();
        debugError("dialogue", "audio.error", error, { messageId: id, src: options.src });
        console.error("dmicher-master-screen | dialogue audio", error);
        globalThis.ui?.notifications?.warn?.(text("Звук диалога недоступен. Разговор можно продолжить.", "Dialogue audio is unavailable. You can continue the conversation."));
      }
      return false;
    } finally {
      if (!permitted() && this.current === playback) this.stop();
      this.changed();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.stop();
    this.unsubscribeAccess?.(); this.unsubscribeVolume?.();
    this.messages.clear(); this.seen.clear();
  }
}
