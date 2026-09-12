import { MODULE_ID } from "./model.js";
import { getRuntimes } from "./store.js";
import { consumeCondition, getConditionGate, getConditionKey } from "./interaction-conditions.js";
import { objectKey, interactionConditionId } from "./interaction-access.js";
import { beginInteractionPause, freezeInteractionClock } from "./interaction-pause.js";
import { requestGMReply } from "./gm-request.js";
import { interactionSignal, notifyInteractionSignal } from "./interaction-signals.js";

const clone = (value) => structuredClone(value);
const leaseMs = 120_000;
const fail = (message) => { throw new Error(message); };
export const sessionIsLive = (session, now = Date.now()) => Boolean(session && (session.status === "pending" || session.expiresAt > now));
export const shopKey = (current) => current.shopId;
const keyOf = shopKey;

export function requireShopSession(current, intent, user) {
  const session = current.runtime.shopSessions?.[keyOf(current)];
  if (!sessionIsLive(session) || session.sessionId !== intent.sessionId || session.userId !== user?.id
    || session.actorTokenId !== intent.actorTokenId || session.runId !== intent.runId
    || session.actorId !== current.scene.tokens?.get(session.actorTokenId)?.actor?.id
    || objectKey(session.target) !== objectKey(intent.target ?? intent.tokenId)
    || session.shopId !== keyOf(current) || intent.shopId !== session.shopId
    || session.groupId !== intent.groupId || session.runId !== current.runtime.runId) fail("Сессия магазина завершилась или принадлежит другому участнику.");
  return session;
}

/** A Scene shop asset owns one lease; a waiter only identifies its admission point. */
export function createShopSessions({ context, save, lock, authority, validate, validateOffer, chat, onChange, emitSignal }) {
  const pending = new Map();
  const process = async (command, user) => {
    if (!["open", "offer", "renew", "release"].includes(command.kind)) fail("Неизвестная команда магазина.");
    if (!command.shopId) fail("Нужно выбрать конкретный магазин.");
    const initial = context(command.sceneId, command.target ?? command.tokenId, command.groupId ?? "main", command.shopId);
    if (!initial.scene) fail("Сцена магазина не найдена.");
    const target = initial.target;
    const releasePause = command.kind === "open" ? beginInteractionPause(initial.scene, target) : () => {};
    let signal;
    const result = await lock(initial.scene, async () => {
      if (!authority()) fail("Исполняющий мастер изменился.");
      const current = context(command.sceneId, command.target ?? command.tokenId, command.groupId ?? "main", command.shopId), runtime = clone(current.runtime);
      // Cancelling a persisted lease remains possible after a GM unbinds its source.
      // This path cannot move Items or acquire another lease.
      const shopId = keyOf(current) ?? (command.kind === "release" && user.isGM ? command.shopId : undefined);
      runtime.shopSessions ??= {};
      const existing = runtime.shopSessions[shopId];
      let session;
      if (command.kind === "open") {
        const actor = validate(current, command, user);
        const allStates = current.scene.getFlag ? getRuntimes(current.scene) : [];
        if (allStates.some((state) => state.groupId !== runtime.groupId && sessionIsLive(state.shopSessions?.[shopId]))) fail("Этот магазин уже обслуживается в другой группе. Завершите ту сессию.");
        if (allStates.some((state) => Object.values(state.tradeRequests ?? {}).some((receipt) => ["processing", "uncertain"].includes(receipt.status) && receipt.intent?.shopId === shopId))) fail("Обмен этого магазина требует сверки мастером. Новый обмен пока недоступен.");
        if (sessionIsLive(existing) && (existing.userId !== user.id || existing.actorTokenId !== command.actorTokenId
          || existing.actorId !== actor.id || existing.shopId !== shopId || objectKey(existing.target) !== objectKey(command.target ?? command.tokenId))) fail("Этот магазин уже занят другим участником или взаимодействием через другой объект.");
        if (existing?.status === "pending" && existing.runId !== runtime.runId) fail("Предыдущее предложение магазина ещё не завершено мастером.");
        const reusing = sessionIsLive(existing) && existing.runId === runtime.runId;
        const conditionKey = getConditionKey(runtime, "shop", interactionConditionId({ ...current.behavior.shop, id: current.token.id }));
        const policy = current.behavior.shop.conditions;
        const gate = getConditionGate(current.scene, runtime, policy, current.scene.tokens.get(command.actorTokenId), { conditionKey, ignoreQuota: reusing });
        if (!gate.allowed) fail(gate.reason);
        session = reusing ? existing : {
          sessionId: foundry.utils.randomID(), userId: user.id, actorTokenId: command.actorTokenId,
          shopId, actorId: actor.id, target: clone(current.target),
          runId: runtime.runId, groupId: runtime.groupId ?? "main", status: "editing", revision: 0, draft: { giveItemIds: [], take: [] }
        };
        if (!reusing) { consumeCondition(runtime, conditionKey, policy); signal = interactionSignal(current.scene, "Shop", shopId, session, "opened"); }
        runtime.shops ??= {};
        runtime.shops[shopId] ??= { items: clone(current.behavior.shop.items ?? []) };
        freezeInteractionClock(runtime, target);
      } else if (command.kind === "release") {
        if (!existing || existing.sessionId !== command.sessionId) return null;
        if (existing.userId !== user.id && !user.isGM) fail("Нельзя завершить чужую сессию магазина.");
        if (objectKey(existing.target) !== objectKey(command.target ?? command.tokenId)) fail("Сессия относится к другому объекту магазина.");
        delete runtime.shopSessions[shopId];
        signal = interactionSignal(current.scene, "Shop", shopId, existing, "closed");
        for (const receipt of Object.values(runtime.tradeRequests ?? {})) {
          if (receipt.status === "pending" && receipt.intent?.sessionId === existing.sessionId) receipt.status = "rejected";
        }
        await save(current.scene, runtime); onChange(current.scene); return null;
      } else {
        session = requireShopSession(current, { ...command, runId: existing?.runId, actorTokenId: existing?.actorTokenId, groupId: runtime.groupId ?? "main" }, user);
        session = clone(session);
        validate(current, { ...command, runId: session.runId, actorTokenId: session.actorTokenId }, user);
        if (command.kind === "offer") {
          if (session.status !== "editing") fail("Предложение уже отправлено мастеру.");
          if (!Number.isInteger(command.revision) || command.revision <= session.revision) return session;
          const draft = validateOffer(current, { ...command,
            giveItemIds: command.draft?.giveItemIds, take: command.draft?.take,
            actorTokenId: session.actorTokenId, runId: session.runId, sessionId: session.sessionId,
            requestId: "draft", groupId: runtime.groupId ?? "main", kind: "exchange" }, user);
          session.draft = clone(draft);
          session.revision = command.revision;
        }
      }
      session.expiresAt = Date.now() + leaseMs;
      runtime.shopSessions[shopId] = session;
      await save(current.scene, runtime); onChange(current.scene); return clone(session);
    }).finally(releasePause);
    if (signal) await notifyInteractionSignal(emitSignal, initial.scene, signal);
    return result;
  };
  const send = async (command) => {
    command = { ...command, groupId: command.groupId ?? "main" };
    if (authority() && game.user.isGM) return process(command, game.user);
    const key = JSON.stringify(command);
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const response = await requestGMReply(chat, { command, commandFlag: "shopCommand", responseFlag: "shopCommandResult",
        content: "<p>Ширма: обновление сессии магазина.</p>", kind: "shop-session",
        timeoutMessage: "Мастер не ответил на запрос магазина. Повторно откройте окно." });
      if (response.error) throw new Error(response.error);
      return response.session ?? null;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
  return Object.freeze({
    requestSession: (command) => send({ ...command, kind: "open" }),
    updateOffer: (command) => send({ ...command, kind: "offer" }),
    renewSession: (command) => send({ ...command, kind: "renew" }),
    releaseSession: (command) => send({ ...command, kind: "release" }),
    async processCommand(message, initiatingUserId) {
      const command = message.getFlag?.(MODULE_ID, "shopCommand");
      if (!command || !authority()) return false;
      const authorId = typeof message.author === "string" ? message.author : message.author?.id;
      if (authorId !== initiatingUserId || !message.whisper?.includes(game.user.id)) return true;
      const user = game.users.get(authorId);
      if (!user) return true;
      let response;
      try { response = { session: await process(clone(command), user) }; }
      catch (error) { response = { error: error.message }; }
      await message.update({ [`flags.${MODULE_ID}.shopCommandResult`]: response, content: "<p>Ширма: состояние сессии магазина обновлено.</p>" });
      // Script lease traffic is not history; the private response has reached the requesting client.
      if (!response.error) setTimeout(() => { void message.delete().catch(() => {}); }, 2000);
      return true;
    }
  });
}
