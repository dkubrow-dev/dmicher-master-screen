import { MODULE_ID } from "./model.js";
import { text } from "./localization.js";
import { generics } from "./generics.js";
import { isAuthority } from "./store.js";
import { getSceneObject } from "./scene-objects.js";
import { requestGMReply } from "./gm-request.js";
import { commandTrace } from "./debug.js";
import { commandDocument, commandObjectUuid, rejectCommand } from "./object-command-access.js";
import { defaultObjectCommand } from "./object-command-model.js";
import { commandParent, isCommandParentHalted } from "./object-command-state.js";
import { TechnicalMessageCleanup } from "./technical-message-cleanup.js";

const CHANNEL = "object-command", REQUEST = "objectCommandRequest", RESULT = "objectCommandResult", NOTE = "objectCommandNote";
const clone = structuredClone;
const randomId = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID();
const objectUuid = (scene, document, fallbackType, fallbackId) => document?.uuid
  ?? `Scene.${scene?.id}.${document?.documentName ?? fallbackType}.${document?.id ?? fallbackId ?? ""}`;
const isRecord = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
const packetKeys = new Set(["version", "requestId", "sceneId", "actorTokenUuid", "targetUuid", "commandId", "parameters", "method", "delegateTokenUuid"]);
function validPacket(packet) {
  return isRecord(packet) && packet.version === 1 && Object.keys(packet).every(key => packetKeys.has(key))
    && ["requestId", "sceneId", "targetUuid", "commandId"].every(key => typeof packet[key] === "string" && packet[key].length > 0 && packet[key].length <= 2048)
    && typeof packet.actorTokenUuid === "string" && packet.actorTokenUuid.length <= 2048
    && (packet.method === undefined || ["gm", "player", "delegated"].includes(packet.method))
    && (packet.delegateTokenUuid === undefined || typeof packet.delegateTokenUuid === "string" && packet.delegateTokenUuid.length <= 2048)
    && isRecord(packet.parameters) && JSON.stringify(packet).length <= 16_384;
}

/** Players submit intent through their own private technical message. Only the
 * elected GM accepts it, reading all permissions and configuration afresh. */
export class ObjectCommandService {
  constructor({ executor, signals, chat, authority = isAuthority } = {}) {
    Object.assign(this, { executor, signals, authority });
    this.chat = chat ?? generics.chat.createMessageService({ ownerId: MODULE_ID, channel: CHANNEL });
    this.receipts = new Map(); this.inFlight = new Map(); this.disposed = false;
    this.cleanup = new TechnicalMessageCleanup({ current: () => !this.disposed && this.authority(),
      onError: (error, messageId) => commandTrace("object-command.receipt-cleanup", { messageId }, error) });
    this.seenNotes = new Set();
    if (executor) executor.openNote = (document, run) => this.publishNote(document, run);
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
      let input = clone(packet);
      if (input.method === "delegated") {
        const delegate = commandDocument(scene, input.delegateTokenUuid);
        if (delegate?.documentName !== "Token") rejectCommand("delegation", text("Выберите персонажа, которому поручаете команду.", "Choose the character to delegate the command to."));
        input = { ...input, method: "player", targetUuid: input.delegateTokenUuid, commandId: "delegate",
          parameters: { targetUuid: input.targetUuid, commandId: input.commandId, parameters: input.parameters } };
        delete input.delegateTokenUuid;
      }
      const result = await this.executor.accept(scene, input, user);
      return { ok: true, commandId: packet.commandId, ...(result?.runId ? { runId: result.runId } : {}) };
    }).catch(error => this.warning(error, packet, user.id)).finally(() => { receipt.done = true; });
    this.receipts.set(key, receipt);
    return receipt.promise;
  }
  request({ scene, target, actorTokenId, commandId, parameters = {}, method, delegateTokenId }) {
    const object = getSceneObject(scene, target), actor = scene?.tokens?.get(actorTokenId), delegate = scene?.tokens?.get(delegateTokenId);
    const raw = { version: 1, sceneId: scene?.id ?? "", actorTokenUuid: actorTokenId ? objectUuid(scene, actor, "Token", actorTokenId) : "",
      targetUuid: objectUuid(scene, object, target?.type, target?.id), commandId, parameters: clone(parameters),
      ...(method ? { method } : {}), ...(delegateTokenId ? { delegateTokenUuid: objectUuid(scene, delegate, "Token", delegateTokenId) } : {}) };
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
    if (message?.getFlag?.(MODULE_ID, NOTE)) return this.receiveNote(message);
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
  async invokeFromScript({ scene, target, commandId, parameters = {}, commander, context } = {}) {
    if (!this.authority() || this.disposed || game.user?.isGM !== true || typeof context?.isCurrent !== "function" || !context.isCurrent()) return null;
    const document = target?.documentName ? target : target && getSceneObject(scene, target), source = commander?.documentName ? commander : commander && getSceneObject(scene, commander);
    if (!document || document.parent?.id !== scene?.id || source && source.parent?.id !== scene.id) throw new Error(text("Объекты команды должны находиться в текущей сцене.", "Command objects must belong to the current scene."));
    const configured = defaultObjectCommand(commandId).parameters, configurationParameters = {}, input = {};
    for (const [key, value] of Object.entries(parameters)) (Object.hasOwn(configured, key) ? configurationParameters : input)[key] = clone(value);
    return this.executor.accept(scene, { version: 1, requestId: randomId(), sceneId: scene.id, method: "gm",
      actorTokenUuid: source ? commandObjectUuid(source) : "", targetUuid: commandObjectUuid(document), commandId,
      parameters: input, configurationParameters }, game.user, { trusted: true, isCurrent: context.isCurrent });
  }
  async publishNote(document, run) {
    if (!this.authority() || this.disposed || !this.executor.owns(document.parent, run.runId)) return;
    const data = { sceneId: document.parent.id, targetUuid: commandObjectUuid(document), runId: run.runId, userId: run.request.userId, deliveryId: randomId() };
    const messages = await this.chat.create({ author: game.user.id, content: "", flags: { [MODULE_ID]: { [NOTE]: data } } }, {
      audience: { type: "users", userIds: [data.userId] }, key: data.deliveryId, kind: CHANNEL, technical: true,
      enabled: () => this.executor.owns(document.parent, run.runId)
    });
    for (const message of messages ?? []) { this.receiveNote(message); this.queueCleanup(message); }
  }
  receiveNote(message) {
    const data = message?.getFlag?.(MODULE_ID, NOTE), author = game.users?.get(generics.chat.getMessageAuthorId(message)), metadata = generics.chat.getChatMetadata(message);
    if (this.disposed || Number(author?.role) !== 4 || metadata?.ownerId !== MODULE_ID || metadata.channel !== CHANNEL || metadata.technical !== true
      || !data || data.userId !== game.user?.id || !message.whisper?.includes(data.userId) || typeof data.deliveryId !== "string" || this.seenNotes.has(data.deliveryId)) return false;
    const scene = game.scenes?.get(data.sceneId), document = commandDocument(scene, data.targetUuid),
      run = scene?.getFlag?.(MODULE_ID, "objectCommandRuns")?.[`Note:${document?.id}`], parent = run && commandParent(scene, run);
    if (globalThis.canvas?.scene?.id !== scene?.id || !document || !run || run.runId !== data.runId || run.interruption || run.parentRunId !== parent?.runId || isCommandParentHalted(scene, parent)) return false;
    const journal = document.page ?? document.entry;
    if (!journal || !journal.testUserPermission?.(game.user, "LIMITED")) return false;
    this.seenNotes.add(data.deliveryId); if (this.seenNotes.size > 200) this.seenNotes.delete(this.seenNotes.values().next().value);
    void journal.sheet?.render(true); return true;
  }
  queueCleanup(message) {
    this.cleanup.queue(message);
  }
  dispose() {
    this.disposed = true; this.cleanup.dispose();
    this.inFlight.clear(); this.receipts.clear();
    this.seenNotes.clear();
  }
}
