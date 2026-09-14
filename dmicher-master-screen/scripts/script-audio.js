import { MODULE_ID } from "./model.js";
import { onExecutionChange, scriptPresentationScope, validScriptPresentationScope as validScriptScope, scriptPresentationIsCurrent as scriptAudioIsCurrent } from "./execution.js";
import { debugError } from "./debug.js";
import { message as localizedMessage } from "./localization.js";
import { objectReferenceKey } from "./object-reference.js";
import { generics } from "./generics.js";

const CHANNEL = "script-audio", FLAG = "scriptAudio";
const nativeSound = src => {
  if (!globalThis.game?.audio?.create) throw new Error(localizedMessage("Проигрывание звука Foundry недоступно."));
  return game.audio.create({ src, context: game.audio.environment, singleton: false, preload: false, autoplay: false });
};
const metadata = message => message?.getFlag?.(MODULE_ID, FLAG) ?? message?.flags?.[MODULE_ID]?.[FLAG];
const isAudioMessage = message => {
  const tag = generics.chat.getChatMetadata(message);
  return tag?.ownerId === MODULE_ID && tag?.channel === CHANNEL && tag?.technical === true;
};
export { scriptAudioIsCurrent };

/** One native sound per authenticated technical message. Generics owns delivery;
 * this adapter owns playback, cancellation and disposal. No sound history replays.
 * Deleting the message terminates the matching sound on every connected client. */
export class ScriptAudioService {
  constructor(chat, { create = nativeSound, getScene = id => game.scenes?.get(id), owns = scriptAudioIsCurrent } = {}) {
    this.messages = chat?.createMessageService({ ownerId: MODULE_ID, channel: CHANNEL });
    Object.assign(this, { create, getScene, owns });
    this.records = new Map(); this.requests = new Map(); this.handled = new Set(); this.hooks = []; this.disposed = false;
  }
  start() {
    if (this.hooks.length || !globalThis.Hooks) return;
    this.disposed = false;
    const on = (name, listener) => this.hooks.push([name, Hooks.on(name, listener)]);
    on(generics.chat.getChatMessageRenderHook(), (message, html) => {
      if (!isAudioMessage(message)) return;
      const element = generics.windows.getRenderedElement(html);
      if (element) element.hidden = true;
    });
    on("createChatMessage", message => this.receive(message));
    on("deleteChatMessage", message => this.stopRecord(this.records.get(message.id), false));
    on("updateChatMessage", message => {
      const record = this.records.get(message.id);
      if (record && JSON.stringify(metadata(message)) !== JSON.stringify(record.data)) this.stopRecord(record);
    });
    on("updateScene", scene => this.checkScene(scene));
    on("canvasTearDown", () => this.stop(globalThis.canvas?.scene));
  }
  report(error, data = {}) { debugError("script", "audio.error", error, { sceneId: data.sceneId, runId: data.runId }); }
  valid(record) {
    if (!record || this.disposed || this.records.get(record.id) !== record) return false;
    try {
      const request = this.requests.get(record.data.playbackId);
      if (request && (request.cancelled || request.signal?.aborted || !request.isCurrent())) return false;
      return Boolean(record.scene && this.owns(record.scene, record.data));
    } catch (error) { this.report(error, record.data); return false; }
  }
  receive(message) {
    const data = metadata(message);
    const author = game.users?.get(generics.chat.getMessageAuthorId(message));
    if (this.disposed || this.handled.has(message.id) || Number(author?.role) !== 4
      || !isAudioMessage(message)
      || !data || typeof data.src !== "string" || !data.src || typeof data.runId !== "string"
      || typeof data.manual !== "boolean" || data.groupId != null && !/^[a-zA-Z0-9_-]{1,64}$/.test(data.groupId)
      || !validScriptScope(data)
      || typeof data.playbackId !== "string" || !Number.isFinite(data.volume) || data.volume < 0 || data.volume > 1) return;
    this.handled.add(message.id);
    if (this.handled.size > 1024) this.handled.delete(this.handled.values().next().value);
    const scene = this.getScene(data.sceneId);
    const record = { id: message.id, data: structuredClone(data), scene, authorId: author.id, sound: null };
    this.records.set(record.id, record);
    if (!this.valid(record)) { this.stopRecord(record); return; }
    record.unsubscribe = onExecutionChange(scene, reason => {
      if (reason === "canvas-teardown" || reason === "halt-all" || !this.valid(record)) this.stopRecord(record);
    });
    void this.playRecord(record).catch(error => { if (this.valid(record)) this.report(error, data); this.stopRecord(record); });
  }
  async playRecord(record) {
    const sound = record.sound = this.create(record.data.src);
    await sound.load({ autoplay: false });
    if (!this.valid(record)) { this.mute(sound, record.data); this.stopRecord(record); return; }
    if (sound.failed) throw new Error(localizedMessage("Проигрывание звука Foundry недоступно."));
    await sound.play({ volume: record.data.volume, loop: false, onended: () => this.stopRecord(record) });
    if (!this.valid(record)) { this.mute(sound, record.data); this.stopRecord(record); }
  }
  mute(sound, data) {
    if (!sound) return;
    try { sound.volume = 0; void Promise.resolve(sound.stop()).catch(error => this.report(error, data)); }
    catch (error) { this.report(error, data); }
  }
  stopRecord(record, remove = true) {
    if (!record || this.records.get(record.id) !== record) return;
    this.records.delete(record.id); record.unsubscribe?.(); this.mute(record.sound, record.data);
    const request = this.requests.get(record.data.playbackId);
    request?.signal?.removeEventListener("abort", request.cancel);
    this.requests.delete(record.data.playbackId);
    if (remove && record.authorId === game.user?.id && this.messages?.get(record.id)) {
      void this.messages.remove(record.id).catch(error => this.report(error, record.data));
    }
  }
  checkScene(scene) {
    for (const record of this.records.values()) if (record.scene?.id === scene.id && !this.valid(record)) this.stopRecord(record);
  }
  stop(scene, { runIds, target, scriptKey } = {}) {
    if (!scene) return;
    const targetKey = target && objectReferenceKey(target);
    if (target && !targetKey) return;
    const matches = data => data.sceneId === scene.id && (!runIds || runIds.includes(data.runId))
      && (!targetKey || objectReferenceKey(data.target) === targetKey)
      && (scriptKey == null || data.scriptKey === scriptKey);
    for (const record of [...this.records.values()]) if (matches(record.data)) this.stopRecord(record);
    for (const request of this.requests.values()) if (matches(request.data)) request.cancelled = true;
  }
  async sound(src, volume = 1, { scene, runId, groupId, isCurrent = () => true, signal, manual = false, target, scriptKey, scriptGeneration = 0 } = {}) {
    if (!this.messages) throw new Error(localizedMessage("Общий сервис чата Generics недоступен."));
    if (!scene || !runId || this.disposed || signal?.aborted || !isCurrent()) return;
    this.start();
    const data = { ...scriptPresentationScope(scene, { runId, groupId, manual, target, scriptKey, scriptGeneration }), src, volume,
      playbackId: globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID() };
    if (!validScriptScope(data)) return;
    const request = { data, signal, isCurrent, cancelled: false };
    const current = () => !this.disposed && !request.cancelled && !signal?.aborted && isCurrent();
    request.cancel = () => { request.cancelled = true; for (const record of [...this.records.values()]) if (record.data.playbackId === data.playbackId) this.stopRecord(record); };
    this.requests.set(data.playbackId, request); signal?.addEventListener("abort", request.cancel, { once: true });
    try {
      const messages = await this.messages.create({ author: game.user.id, content: "", flags: { [MODULE_ID]: { [FLAG]: data } } },
        { audience: { type: "all" }, kind: CHANNEL, technical: true, key: data.playbackId, enabled: current });
      for (const message of messages ?? []) {
        if (!current()) { await this.messages.remove(message.id); continue; }
        this.receive(message);
      }
      if (![...this.records.values()].some(record => record.data.playbackId === data.playbackId)) {
        signal?.removeEventListener("abort", request.cancel); this.requests.delete(data.playbackId);
      }
    } catch (error) { request.cancel(); this.requests.delete(data.playbackId); signal?.removeEventListener("abort", request.cancel); throw error; }
  }
  dispose() {
    this.disposed = true;
    for (const record of [...this.records.values()]) this.stopRecord(record);
    for (const request of this.requests.values()) { request.cancelled = true; request.signal?.removeEventListener("abort", request.cancel); }
    this.requests.clear(); this.handled.clear();
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = [];
  }
}
