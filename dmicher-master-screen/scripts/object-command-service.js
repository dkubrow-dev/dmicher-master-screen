import { MODULE_ID } from "./model.js";
import { text } from "./localization.js";
import { generics } from "./generics.js";
import { isAuthority } from "./store.js";
import { getSceneObject } from "./scene-objects.js";
import { requestGMReply } from "./gm-request.js";
import { commandTrace } from "./debug.js";

const CHANNEL = "object-command", REQUEST = "objectCommandRequest", RESULT = "objectCommandResult";
const clone = structuredClone;
const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID();
const objectUuid = (scene, document, fallbackType, fallbackId) => document?.uuid
  ?? `Scene.${scene?.id}.${document?.documentName ?? fallbackType}.${document?.id ?? fallbackId ?? ""}`;
const isRecord = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const packetKeys = new Set(["version", "requestId", "sceneId", "actorTokenUuid", "targetUuid", "commandId", "parameters"]);
function validPacket(packet) {
  return isRecord(packet) && packet.version === 1 && Object.keys(packet).every(key => packetKeys.has(key))
    && ["requestId", "sceneId", "actorTokenUuid", "targetUuid", "commandId"].every(key => typeof packet[key] === "string" && packet[key].length > 0 && packet[key].length <= 2048)
    && isRecord(packet.parameters) && JSON.stringify(packet).length <= 16_384;
}

/** Players submit intent through their own private technical message. Only the
 * elected GM accepts it, reading all permissions and configuration afresh. */
export class ObjectCommandService {
  constructor({ executor, signals, chat, authority = isAuthority } = {}) {
    Object.assign(this, { executor, signals, authority });
    this.chat = chat ?? generics.chat.createMessageService({ ownerId: MODULE_ID, channel: CHANNEL });
    this.receipts = new Map(); this.inFlight = new Map(); this.deletions = new Map(); this.disposed = false;
  }
  warning(error, packet = {}, userId) {
    const message = error?.name === "CommandRejection" ? error.message
      : text("Команда не выполнена. Мастер может проверить причину в консоли.", "The command was not carried out. The GM can check the console for details.");
    const context = { sceneId: packet.sceneId, userId, requestId: packet.requestId, commandId: packet.commandId,
      actorTokenUuid: packet.actorTokenUuid, targetUuid: packet.targetUuid, parameters: packet.parameters, code: error?.code };
    try { globalThis.console?.warn?.(`${MODULE_ID} | object-command`, context, error); } catch { /* Diagnostics cannot fail a reply. */ }
    commandTrace("object-command.rejected", context, error);
    globalThis.ui?.notifications?.warn?.(message);
    return { ok: false, message };
  }
  async execute(packet, user) {
    if (!this.authority() || this.disposed || !user || generics.chat.isManagedIdentityUser(user)) return null;
    if (!validPacket(packet)) return this.warning(new Error("Invalid object command envelope"), {}, user.id);
    const key = `${user.id}:${packet.requestId}`, signature = JSON.stringify(packet);
    const previous = this.receipts.get(key);
    if (previous) {
      if (previous.signature !== signature) return this.warning(new Error("Command request identity reused with different input"), packet, user.id);
      return previous.promise;
    }
    while (this.receipts.size >= 200) {
      const removable = [...this.receipts].find(([, entry]) => entry.done);
      if (!removable) return this.warning(new Error("Too many pending command requests"), packet, user.id);
      this.receipts.delete(removable[0]);
    }
    const receipt = { signature, done: false };
    receipt.promise = Promise.resolve().then(async () => {
      if (this.disposed || !this.authority()) throw new Error("Command authority changed before acceptance");
      const scene = game.scenes?.get(packet.sceneId);
      const result = await this.executor.accept(scene, clone(packet), user);
      return { ok: true, commandId: packet.commandId, ...(result?.runId ? { runId: result.runId } : {}) };
    }).catch(error => this.warning(error, packet, user.id)).finally(() => { receipt.done = true; });
    this.receipts.set(key, receipt);
    return receipt.promise;
  }
  request({ scene, target, actorTokenId, commandId, parameters = {} }) {
    const object = getSceneObject(scene, target), actor = scene?.tokens?.get(actorTokenId);
    const raw = { version: 1, sceneId: scene?.id ?? "", actorTokenUuid: objectUuid(scene, actor, "Token", actorTokenId),
      targetUuid: objectUuid(scene, object, target?.type, target?.id), commandId, parameters: clone(parameters) };
    const key = JSON.stringify(raw);
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const local = this.authority() && game.user?.isGM;
    const task = Promise.resolve().then(async () => {
      const packet = { ...raw, requestId: randomId() };
      if (local) return this.execute(packet, game.user);
      const response = await requestGMReply(this.chat, { command: packet, commandFlag: REQUEST, responseFlag: RESULT,
        content: text("Ширма: команда объекту.", "Master screen: object command."), kind: CHANNEL,
        timeoutMessage: text("Мастер не подтвердил приём команды. Проверьте состояние объекта перед повтором.", "The GM did not confirm the command. Check the object's state before trying again.") });
      if (response?.ok !== true) {
        globalThis.console?.warn?.(`${MODULE_ID} | object-command`, { ...packet, result: response });
        globalThis.ui?.notifications?.warn?.(response?.message ?? text("Команда не выполнена.", "The command was not carried out."));
      }
      return response;
    }).catch(error => this.warning(error, raw, game.user?.id)).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }
  async processMessage(message, initiatingUserId) {
    const packet = message?.getFlag?.(MODULE_ID, REQUEST);
    if (!packet || !this.authority() || this.disposed) return false;
    const metadata = generics.chat.getChatMetadata(message), authorId = generics.chat.getMessageAuthorId(message);
    if (metadata?.ownerId !== MODULE_ID || metadata.channel !== CHANNEL || metadata.kind !== CHANNEL || metadata.technical !== true
      || !message.id || authorId !== initiatingUserId || !message.whisper?.includes(game.user?.id) || !message.whisper?.includes(authorId)) return false;
    const user = game.users?.get(authorId);
    if (!user || generics.chat.isManagedIdentityUser(user)) return false;
    // A processed technical message is a receipt, never a new command after reload.
    if (message.getFlag(MODULE_ID, RESULT) != null) return true;
    const result = await this.execute(packet, user);
    if (!result || !this.authority() || this.disposed) return true;
    await message.update({ [`flags.${MODULE_ID}.${RESULT}`]: result, content: "" });
    this.queueCleanup(message);
    return true;
  }
  queueCleanup(message) {
    if (typeof message.delete !== "function") return;
    this.deletions.set(message.id, { message, at: Date.now() + 2000 });
    this.scheduleCleanup();
  }
  scheduleCleanup() {
    if (this.cleanupTimer || !this.deletions.size || this.disposed) return;
    const delay = Math.max(0, Math.min(...[...this.deletions.values()].map(entry => entry.at)) - Date.now());
    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      for (const [id, entry] of this.deletions) if (entry.at <= Date.now()) {
        this.deletions.delete(id);
        if (this.authority()) void entry.message.delete().catch(error => commandTrace("object-command.receipt-cleanup", { messageId: id }, error));
      }
      this.scheduleCleanup();
    }, delay);
    this.cleanupTimer.unref?.();
  }
  dispose() {
    this.disposed = true; clearTimeout(this.cleanupTimer); this.cleanupTimer = null;
    this.inFlight.clear(); this.receipts.clear(); this.deletions.clear();
  }
}
