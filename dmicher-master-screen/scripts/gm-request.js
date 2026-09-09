import { MODULE_ID } from "./model.js";
import { asArray } from "./store.js";

/** Private request/reply transport shared by dialogue and shop sessions.
 * This correlates messages only; each receiving service authenticates and validates its command. */
export async function requestGMReply(chat, { command, commandFlag, responseFlag, content, kind, timeoutMessage, timeoutMs = 20_000 }) {
  const gms = asArray(game.users).filter((user) => user.active && Number(user.role) === 4).map((user) => user.id);
  if (!gms.length) throw new Error("Для взаимодействия нужен подключённый мастер.");
  return new Promise((resolve, reject) => {
    let messageId, timer, hookId, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); Hooks.off("updateChatMessage", hookId);
      if (error) reject(error); else resolve(result);
    };
    const check = (message) => {
      if (!messageId || message?.id !== messageId) return;
      const result = message.getFlag?.(MODULE_ID, responseFlag);
      if (result !== undefined && result !== null) finish(null, result);
    };
    hookId = Hooks.on("updateChatMessage", check);
    timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
    Promise.resolve().then(() => chat.create({ author: game.user.id, content, flags: { [MODULE_ID]: { [commandFlag]: command } } },
      { audience: { type: "users", userIds: [...gms, game.user.id] }, kind, technical: true }))
      .then((messages) => {
        if (!messages[0]?.id) throw new Error("Запрос не отправлен.");
        messageId = messages[0].id;
        check(game.messages.get(messageId) ?? messages[0]);
      }).catch((error) => finish(error));
  });
}
