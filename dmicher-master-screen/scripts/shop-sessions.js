import { MODULE_ID } from "./model.js";
import { asArray } from "./store.js";
import { consumeTrigger, getTriggerGate, getTriggerKey } from "./triggers.js";

const clone = (value) => structuredClone(value);
const leaseMs = 120_000;
const fail = (message) => { throw new Error(message); };
export const sessionIsLive = (session, now = Date.now()) => Boolean(session && (session.status === "pending" || session.expiresAt > now));

export function requireShopSession(current, intent, user) {
  const session = current.runtime.shopSessions?.[intent.tokenId];
  if (!sessionIsLive(session) || session.sessionId !== intent.sessionId || session.userId !== user?.id
    || session.actorTokenId !== intent.actorTokenId || session.runId !== intent.runId
    || session.schemeId !== intent.schemeId || session.runId !== current.runtime.runId) fail("Сессия магазина завершилась или принадлежит другому участнику.");
  return session;
}

/** Leases belong to a Scene + NPC + character. They never transfer Items. */
export function createShopSessions({ context, save, lock, authority, validate, validateOffer, chat, onChange }) {
  const pending = new Map();
  const process = async (command, user) => {
    if (!["open", "offer", "renew", "release"].includes(command.kind)) fail("Неизвестная команда магазина.");
    if ((command.schemeId ?? "main") !== "main") fail("Эта схема магазина не поддерживается.");
    const initial = context(command.sceneId, command.tokenId);
    if (!initial.scene) fail("Сцена магазина не найдена.");
    return lock(initial.scene, async () => {
      const current = context(command.sceneId, command.tokenId), runtime = clone(current.runtime);
      runtime.shopSessions ??= {};
      const existing = runtime.shopSessions[command.tokenId];
      let session;
      if (command.kind === "open") {
        validate(current, command, user);
        if (sessionIsLive(existing) && (existing.userId !== user.id || existing.actorTokenId !== command.actorTokenId)) fail("Этот магазин уже занят другим участником и его персонажем.");
        const reusing = sessionIsLive(existing) && existing.runId === runtime.runId;
        const triggerKey = getTriggerKey(runtime, "shop", command.tokenId);
        const policy = current.behavior.shop.trigger;
        const gate = getTriggerGate(current.scene, runtime, policy, current.scene.tokens.get(command.actorTokenId), { triggerKey, ignoreQuota: reusing });
        if (!gate.allowed) fail(gate.reason);
        session = reusing ? existing : {
          sessionId: foundry.utils.randomID(), userId: user.id, actorTokenId: command.actorTokenId,
          runId: runtime.runId, schemeId: "main", status: "editing", revision: 0, draft: { giveItemIds: [], take: [] }
        };
        if (!reusing) consumeTrigger(runtime, triggerKey, policy);
      } else if (command.kind === "release") {
        if (!existing || existing.sessionId !== command.sessionId) return null;
        if (existing.userId !== user.id && !user.isGM) fail("Нельзя завершить чужую сессию магазина.");
        delete runtime.shopSessions[command.tokenId];
        for (const receipt of Object.values(runtime.tradeRequests ?? {})) {
          if (receipt.status === "pending" && receipt.intent?.sessionId === existing.sessionId) receipt.status = "rejected";
        }
        await save(current.scene, runtime); onChange(current.scene); return null;
      } else {
        session = requireShopSession(current, { ...command, runId: existing?.runId, actorTokenId: existing?.actorTokenId, schemeId: "main" }, user);
        session = clone(session);
        validate(current, { ...command, runId: session.runId, actorTokenId: session.actorTokenId }, user);
        if (command.kind === "offer") {
          if (session.status !== "editing") fail("Предложение уже отправлено мастеру.");
          if (!Number.isInteger(command.revision) || command.revision <= session.revision) return session;
          const draft = validateOffer(current, { ...command,
            giveItemIds: command.draft?.giveItemIds, take: command.draft?.take,
            actorTokenId: session.actorTokenId, runId: session.runId, sessionId: session.sessionId,
            requestId: "draft", schemeId: "main", kind: "exchange" }, user);
          session.draft = clone(draft);
          session.revision = command.revision;
        }
      }
      session.expiresAt = Date.now() + leaseMs;
      runtime.shopSessions[command.tokenId] = session;
      await save(current.scene, runtime); onChange(current.scene); return clone(session);
    });
  };
  const send = async (command) => {
    command = { ...command, schemeId: command.schemeId ?? "main" };
    if (authority() && game.user.isGM) return process(command, game.user);
    const key = JSON.stringify(command);
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const gms = asArray(game.users).filter((user) => user.active && Number(user.role) === 4).map((user) => user.id);
      if (!gms.length) fail("Нужен подключённый мастер.");
      let messageId, timer, hookId;
      const result = new Promise((resolve, reject) => {
        const check = (message) => {
          if (!messageId || message.id !== messageId) return;
          const response = message.getFlag(MODULE_ID, "shopCommandResult");
          if (!response) return;
          clearTimeout(timer); Hooks.off("updateChatMessage", hookId);
          if (response.error) reject(new Error(response.error)); else resolve(response.session ?? null);
        };
        hookId = Hooks.on("updateChatMessage", check);
        timer = setTimeout(() => { Hooks.off("updateChatMessage", hookId); reject(new Error("Мастер не ответил на запрос магазина. Повторно откройте окно.")); }, 20_000);
        chat.create({ author: game.user.id, content: "<p>Ширма: обновление сессии магазина.</p>", flags: { [MODULE_ID]: { shopCommand: command } } },
          { audience: { type: "users", userIds: [...gms, game.user.id] }, technical: true, kind: "shop-session" })
          .then((messages) => { if (!messages[0]) throw new Error("Запрос магазина не отправлен."); messageId = messages[0].id; check(game.messages.get(messageId) ?? messages[0]); })
          .catch((error) => { clearTimeout(timer); Hooks.off("updateChatMessage", hookId); reject(error); });
      });
      return result;
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
      // Routine lease traffic is not history; the private response has reached the requesting client.
      if (!response.error) setTimeout(() => { void message.delete().catch(() => {}); }, 2000);
      return true;
    }
  });
}
