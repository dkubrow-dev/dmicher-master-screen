import { text } from "./localization.js";
import { MODULE_ID } from "./model.js";
import { asArray } from "./store.js";
import { generics } from "./generics.js";
import { objectKey } from "./interaction-access.js";
import { dialogueSessionIsPresent } from "./interaction-session-model.js";
export { scriptDialoguesPending } from "./interaction-session-model.js";

const fail = (message) => { throw new Error(message); };
const characterId = (user) => typeof user.character === "string" ? user.character : user.character?.id;
const belongsTo = (session, userId, actorTokenId, dialogue, runtime) => session?.userId === userId
  && session.actorTokenId === actorTokenId && session.dialogueId === dialogue.id && session.runId === runtime.runId
  && objectKey(session.target) === objectKey(dialogue.target);

/** One character gets one conversational partner. An assigned character wins;
 * otherwise a stable owner is selected. GM omnipotence alone is not ownership. */
export function scriptDialogueRecipient(token, users) {
  const actor = token?.actor;
  if (!actor) return null;
  const available = asArray(users).filter((user) => user.active && !generics.chat.isManagedIdentityUser(user));
  const players = available.filter((user) => !user.isGM && actor.testUserPermission?.(user, "OWNER"));
  const candidates = players.length ? players : available.filter((user) => user.isGM
    && (characterId(user) === actor.id || Number(actor.ownership?.[user.id]) >= 3));
  return candidates.sort((a, b) => Number(characterId(b) === actor.id) - Number(characterId(a) === actor.id)
    || String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

/** Validate the complete batch before creating its first real session. The private
 * GM command path repeats ownership and execution checks under the Scene lock. */
export function planScriptDialogues(command, { context, validate, users = game.users }) {
  const current = context(command.sceneId, command.dialogueId, command.groupId, command.target);
  const { scene, runtime, dialogue, target } = current;
  if (!scene || scene.id !== command.sceneId || !runtime?.runId || runtime.runId !== command.runId) {
    fail(text("Сцена или состояние скрипта изменились.", "The script scene or state has changed."));
  }
  if (!command.dialogueId || !dialogue || dialogue.id !== command.dialogueId || !target
    || objectKey(dialogue.target) !== objectKey(command.target)) {
    fail(text("Скрипт может запускать только диалог, зарегистрированный у собственного объекта.",
      "A script can start only a dialogue registered on its own object."));
  }
  if (!Array.isArray(command.tokenUuids) || command.tokenUuids.some((uuid) => typeof uuid !== "string" || !uuid)) {
    fail(text("Укажите UUID токенов участников диалога.", "Specify the token UUIDs of the dialogue participants."));
  }
  const tokens = asArray(scene.tokens), plans = [];
  for (const uuid of new Set(command.tokenUuids)) {
    const token = tokens.find((entry) => (entry.uuid ?? `Scene.${scene.id}.Token.${entry.id}`) === uuid);
    if (!token || token.parent?.id && token.parent.id !== scene.id) {
      fail(text("Участник диалога должен быть токеном текущей сцены.", "A dialogue participant must be a token in the current scene."));
    }
    const user = scriptDialogueRecipient(token, users);
    if (!user) fail(text("У персонажа диалога нет подключённого владельца.", "The dialogue character has no connected owner."));
    validate({ scene, runtime, descriptor: dialogue, target }, token.id, user, command.runId);
    const previous = Object.values(runtime.dialogueSessions ?? {}).find((session) => belongsTo(session, user.id, token.id, dialogue, runtime));
    if (previous?.status === "processing") fail(text("Ответ участника диалога ещё обрабатывается.", "The dialogue participant's answer is still being processed."));
    if (["active", "interrupted"].includes(previous?.status) && previous.actorId !== token.actor.id) {
      fail(text("Персонаж взаимодействия изменился.", "The interaction character has changed."));
    }
    plans.push({ user, command: { kind: "start", sceneId: scene.id, groupId: runtime.groupId,
      runId: runtime.runId, dialogueId: dialogue.id, target: structuredClone(dialogue.target), actorTokenId: token.id } });
  }
  return plans;
}

/** GM script starts use real player sessions, not manual projections. Chat carries
 * a private delivery envelope; it never grants the recipient additional rights. */
export function createScriptDialogueService({ context, validate, process, authority, chat, openWindow, presentChat }) {
  const shown = new Set(), localDeliveries = new Map();
  const processScriptInvitation = async (message, initiatingUserId) => {
    const packet = message.getFlag?.(MODULE_ID, "scriptDialogue");
    if (!packet || packet.version !== 1 || !message.id) return false;
    const metadata = generics.chat.getChatMetadata(message);
    if (metadata?.ownerId !== MODULE_ID || metadata.channel !== "scene-input" || metadata.kind !== "script-dialogue" || metadata.technical !== true) return false;
    const authorId = typeof message.author === "string" ? message.author : message.author?.id;
    if (!initiatingUserId || authorId !== initiatingUserId || !game.users.get(authorId)?.isGM
      || packet.userId !== game.user?.id || !message.whisper?.includes(game.user.id)
      || generics.chat.isManagedIdentityUser(game.user) || message.visible === false || message.isContentVisible === false) return false;
    if (shown.has(message.id)) return true;
    const { command } = packet;
    let { view } = packet;
    const delivery = localDeliveries.get(view?.sessionId);
    if (delivery) { await delivery.admit(); view = delivery.view(); }
    if (shown.has(message.id)) return true;
    const current = context(command?.sceneId, command?.dialogueId, command?.groupId, command?.target);
    if (!command || !view?.sessionId || view.dialogueId !== command.dialogueId || view.actorTokenId !== command.actorTokenId
      || objectKey(view.target) !== objectKey(command.target)) return false;
    const session = Object.values(current.runtime?.dialogueSessions ?? {}).find((entry) => entry.sessionId === view.sessionId);
    if (!session || session.origin !== "script" || !current.dialogue
      || !belongsTo(session, game.user.id, command.actorTokenId, current.dialogue, current.runtime)
      || session.actorId !== current.scene?.tokens?.get(command.actorTokenId)?.actor?.id
      || !dialogueSessionIsPresent(session) || session.status === "processing" || session.step !== view.step || session.nodeId !== view.nodeId) return false;
    validate({ ...current, descriptor: current.dialogue }, command.actorTokenId, game.user, command.runId);
    if (typeof openWindow !== "function") fail(text("Окно игрового диалога не подключено.", "The live dialogue window is not connected."));
    shown.add(message.id);
    if (shown.size > 500) shown.delete(shown.values().next().value);
    try { await openWindow(structuredClone(command), structuredClone(view)); }
    catch (error) { shown.delete(message.id); throw error; }
    return true;
  };
  return {
    processScriptInvitation,
    async startScriptDialogues(command, { isCurrent = () => true, waitForAdmission } = {}) {
      if (!game.user?.isGM || !authority()) fail(text("Диалог скрипта запускает исполняющий мастер.", "Only the authoritative GM can start a scripted dialogue."));
      const plans = planScriptDialogues(command, { context, validate }), result = [];
      const cancelled = () => fail(text("Исполнение скрипта остановлено.", "Script execution was stopped."));
      const admit = async () => {
        do {
          if (!authority()) cancelled();
          if (waitForAdmission) await waitForAdmission(result);
          else if (!isCurrent(result)) cancelled();
          if (!authority()) cancelled();
        } while (!isCurrent(result));
      };
      // A caller without a waiting runtime may abandon before making any changes.
      // Once a session exists, cancellation is an error, never a completed batch.
      if (!waitForAdmission && !isCurrent(result)) return [];
      for (const plan of plans) {
        await admit();
        const requireRecipient = () => {
          if (!authority()) cancelled();
          const current = context(plan.command.sceneId, plan.command.dialogueId, plan.command.groupId, plan.command.target);
          if (!plan.user.active || scriptDialogueRecipient(current.scene?.tokens?.get(plan.command.actorTokenId), game.users)?.id !== plan.user.id) {
            fail(text("Владелец персонажа диалога отключился или сменился.", "The dialogue character's owner disconnected or changed."));
          }
        };
        requireRecipient();
        let view = await process(plan.command, plan.user, foundry.utils.randomID());
        result.push({ sessionId: view.sessionId, userId: plan.user.id, actorTokenId: plan.command.actorTokenId });
        let renewing, rejectRenewal, timer;
        const renewalFailure = new Promise((_resolve, reject) => { rejectRenewal = reject; });
        const renew = () => renewing ??= Promise.resolve().then(() => {
          requireRecipient(); return process({ ...plan.command, kind: "renew", sessionId: view.sessionId }, plan.user, foundry.utils.randomID());
        })
          .then((fresh) => { view = fresh; }).finally(() => { renewing = null; });
        // A paused, not-yet-delivered window has no client heartbeat. Keep only
        // this already-admitted lease alive; renewal never spends another use.
        if (waitForAdmission) {
          timer = setInterval(() => { void renew().catch(rejectRenewal); }, 30_000);
          timer.unref?.();
        }
        const admitDelivery = () => Promise.race([admit(), renewalFailure]);
        const sessionId = view.sessionId;
        if (plan.user.id === game.user.id) localDeliveries.set(sessionId, { admit: admitDelivery, view: () => view });
        try {
          await admitDelivery();
          if (waitForAdmission) { await renew(); await admitDelivery(); }
          if (presentChat) await presentChat(plan.command, view);
          if (view.presentation?.mode === "chat" && presentChat) continue;
          const messages = await chat.create({ author: game.user.id,
            content: `<p>${generics.utilities.escapeHTML(text("Ширма: начало диалога.", "Master screen: dialogue started."))}</p>`,
            flags: { [MODULE_ID]: { scriptDialogue: { version: 1, userId: plan.user.id, command: plan.command, view } } } },
          { audience: { type: "users", userIds: [plan.user.id] }, kind: "script-dialogue", technical: true });
          if (!messages[0]?.id) fail(text("Не удалось отправить окно диалога участнику.", "The dialogue window could not be sent to the participant."));
          if (plan.user.id === game.user.id) await processScriptInvitation(messages[0], game.user.id);
        } finally {
          clearInterval(timer); localDeliveries.delete(sessionId);
        }
      }
      return result;
    }
  };
}
