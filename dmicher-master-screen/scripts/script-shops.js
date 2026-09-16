import { MODULE_ID } from "./model.js";
import { text as t } from "./localization.js";
import { asArray } from "./store.js";
import { generics } from "./generics.js";
import { objectKey, validateInteractionIdentity } from "./interaction-access.js";
import { scriptDialogueRecipient } from "./script-dialogues.js";
import { shopSessionIsLive } from "./interaction-session-model.js";

const fail = message => { throw new Error(message); };
const reference = session => ({ sessionId: session.sessionId, userId: session.userId, actorTokenId: session.actorTokenId, shopId: session.shopId });
export function planScriptShop(command, { context, users = globalThis.game?.users }) {
  const current = context(command.sceneId, command.target, command.groupId, command.shopId);
  if (!current.scene || !current.registered || !current.runtime?.runId || current.runtime.runId !== command.runId) fail(t("Магазин не зарегистрирован у объекта текущего исполнения.", "The shop is not registered on the current execution's object."));
  const token = asArray(current.scene.tokens).find(token => (token.uuid ?? `Scene.${current.scene.id}.Token.${token.id}`) === command.tokenUuid);
  if (!token?.actor) fail(t("Укажите UUID персонажа текущей сцены.", "Specify a character token UUID in the current scene."));
  const user = scriptDialogueRecipient(token, users);
  if (!user) fail(t("У персонажа магазина нет подключённого владельца.", "The shop character has no connected owner."));
  validateInteractionIdentity({ scene: current.scene, runtime: current.runtime, descriptor: current.registered.config, target: current.object }, token.id, user, command.runId);
  return { user, current, command: { sceneId: command.sceneId, groupId: command.groupId, runId: command.runId,
    target: structuredClone(command.target), shopId: command.shopId, actorTokenId: token.id } };
}

/** GM preparation creates the same inventory lease used by player-initiated trading. */
export function createScriptShopService({ context, authority, chat, sessions, openWindow }) {
  const shown = new Set();
  const processScriptShopInvitation = async (message, initiatingUserId) => {
    const packet = message.getFlag?.(MODULE_ID, "scriptShop"), metadata = generics.chat.getChatMetadata(message);
    if (packet?.version !== 1 || !message.id || metadata?.ownerId !== MODULE_ID || metadata.channel !== "commerce-requests"
      || metadata.kind !== "script-shop" || metadata.technical !== true) return false;
    const author = typeof message.author === "string" ? message.author : message.author?.id;
    if (!initiatingUserId || author !== initiatingUserId || !game.users.get(author)?.isGM || packet.userId !== game.user?.id
      || !message.whisper?.includes(game.user.id) || message.visible === false || message.isContentVisible === false
      || generics.chat.isManagedIdentityUser(game.user)) return false;
    if (shown.has(message.id)) return true;
    const command = packet.command, current = context(command?.sceneId, command?.target, command?.groupId, command?.shopId);
    const session = current.runtime?.shopSessions?.[command?.shopId];
    if (!current.registered || !shopSessionIsLive(session) || session.origin !== "script" || session.sessionId !== command?.sessionId
      || session.userId !== game.user.id || session.actorTokenId !== command.actorTokenId || session.runId !== command.runId
      || objectKey(session.target) !== objectKey(command.target)) return false;
    validateInteractionIdentity({ scene: current.scene, runtime: current.runtime, descriptor: current.registered.config, target: current.object }, command.actorTokenId, game.user, command.runId);
    if (typeof openWindow !== "function") fail(t("Окно игрового магазина не подключено.", "The live shop window is not connected."));
    shown.add(message.id); if (shown.size > 200) shown.delete(shown.values().next().value);
    try { await openWindow(structuredClone(command), structuredClone(session)); }
    catch (error) { shown.delete(message.id); throw error; }
    return true;
  };
  return {
    processScriptShopInvitation,
    async startScriptShop(command, { isCurrent = () => false, waitForAdmission } = {}) {
      if (!game.user?.isGM || !authority()) fail(t("Магазин скрипта запускает исполняющий мастер.", "Only the authoritative GM can start a scripted shop."));
      const plan = planScriptShop(command, { context }), references = [];
      const admit = async () => {
        if (waitForAdmission) await waitForAdmission(references);
        if (!authority() || !isCurrent(references)) fail(t("Исполнение скрипта остановлено.", "Script execution was stopped."));
      };
      await admit();
      const session = await sessions.openScriptSession(plan.command, plan.user, { isCurrent: () => authority() && isCurrent(references) });
      references.push(reference(session));
      const delivered = { ...plan.command, sessionId: session.sessionId };
      const requireRecipient = () => {
        if (!plan.user.active || scriptDialogueRecipient(plan.current.scene.tokens.get(plan.command.actorTokenId), game.users)?.id !== plan.user.id) fail(t("Владелец персонажа магазина отключился или сменился.", "The shop character's owner disconnected or changed."));
      };
      let renewal, rejectRenewal, timer;
      const renewalFailure = new Promise((_resolve, reject) => { rejectRenewal = reject; });
      const renew = () => renewal ??= Promise.resolve().then(() => {
        requireRecipient();
        // A paused admitted window has no client heartbeat yet. Renew only the
        // exact existing lease; this never consumes another interaction use.
        return sessions.renewScriptSession(delivered, plan.user, { isCurrent: () => authority() });
      }).finally(() => { renewal = null; });
      if (waitForAdmission) {
        timer = setInterval(() => { void renew().catch(rejectRenewal); }, 30_000);
        timer.unref?.();
      }
      try {
        await Promise.race([admit(), renewalFailure]);
        if (waitForAdmission) { await renew(); await admit(); }
        requireRecipient();
        const messages = await chat.create({ author: game.user.id,
          content: `<p>${generics.utilities.escapeHTML(t("Ширма: начало торговли.", "Master screen: trading started."))}</p>`,
          flags: { [MODULE_ID]: { scriptShop: { version: 1, userId: plan.user.id, command: delivered } } } },
        { audience: { type: "users", userIds: [plan.user.id] }, technical: true, kind: "script-shop" });
        if (!messages[0]?.id) fail(t("Не удалось отправить окно магазина участнику.", "The shop window could not be sent to its participant."));
        if (!authority() || !isCurrent(references)) fail(t("Исполнение скрипта остановлено.", "Script execution was stopped."));
        if (plan.user.id === game.user.id) await processScriptShopInvitation(messages[0], game.user.id);
        return references[0];
      } catch (error) {
        // Admission happened, but no valid script result may hold this lease forever.
        await sessions.releaseSession({ ...plan.command, sessionId: session.sessionId }).catch(() => {});
        throw error;
      } finally { clearInterval(timer); }
    }
  };
}
