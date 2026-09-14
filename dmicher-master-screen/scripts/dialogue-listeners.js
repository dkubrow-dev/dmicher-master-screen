import { text } from "./localization.js";
import { getRuntimes } from "./store.js";
import { getSceneObject } from "./scene-objects.js";
import { SceneAssets } from "./scene-assets.js";
import { objectCenter, sceneDistance } from "./scene-object-geometry.js";
import { isExecutionHalted } from "./execution.js";
import { dialogueSessionIsLive } from "./interaction-session-model.js";
import { generics } from "./generics.js";
import { dialogueVisibility, publicDialogueTokenAllowed } from "./dialogue-visibility.js";

export const DIALOGUE_SYMBOL = "💬";
export const DIALOGUE_LISTENING_RANGE = 5;

/** The speaker's current conversation is discoverable, never its private transcript.
 * This policy also runs on the GM before admitting a listener. Range and sight
 * are admission checks; a registered reader's subsequent access is a session rule. */
export function validateListenerAccess({ scene, runtime, session }, actorTokenId, user, { now = Date.now() } = {}) {
  if (dialogueVisibility(session?.presentation, game.users.get(session?.userId)) !== "public") {
    throw new Error(text("Этот диалог приватный: присоединение недоступно.", "This dialogue is private: joining is unavailable."));
  }
  if (!scene || globalThis.canvas?.scene?.id !== scene.id || !runtime?.runId || session?.runId !== runtime.runId
    || !["active", "processing"].includes(session?.status) || !dialogueSessionIsLive(session, now)
    || isExecutionHalted(scene, runtime) || !getSceneObject(scene, session.target)) {
    throw new Error(text("Разговор больше недоступен для присоединения.", "This conversation is no longer open to listeners."));
  }
  const speaker = scene.tokens?.get(session.actorTokenId);
  if (!speaker?.actor || speaker.hidden || speaker.actor.id !== session.actorId) {
    throw new Error(text("Персонаж, ведущий разговор, недоступен.", "The speaking character is unavailable."));
  }
  const listener = scene.tokens?.get(actorTokenId);
  if (!user || generics.chat.isManagedIdentityUser(user) || !listener?.actor || listener.hidden || listener.id === speaker.id
    || user.id === session.userId || (!user.isGM && !listener.actor.testUserPermission?.(user, "OWNER"))) {
    throw new Error(text("Выберите своего персонажа, который не ведёт этот разговор.", "Choose your own character who is not leading this conversation."));
  }
  if (listener.level != null && speaker.level != null && listener.level !== speaker.level) {
    throw new Error(text("Персонажи находятся на разных уровнях сцены.", "The characters are on different scene levels."));
  }
  const origin = objectCenter(listener, scene), destination = objectCenter(speaker, scene);
  if (!publicDialogueTokenAllowed(scene, session, listener)) {
    throw new Error(text("Персонаж не входит в аудиторию этого диалога.", "Your character is outside this dialogue's audience."));
  }
  if (![origin.x, origin.y, destination.x, destination.y].every(Number.isFinite)
    || sceneDistance(scene, origin, destination) > DIALOGUE_LISTENING_RANGE) {
    throw new Error(text("Персонаж слишком далеко от участника разговора.", "Your character is too far from the speaking character."));
  }
  if (!listener.object?.checkCollision || listener.object.checkCollision(destination, { origin, type: "sight", mode: "any" })) {
    throw new Error(text("Участник разговора должен быть в прямой видимости персонажа.", "The speaking character must be in your character's line of sight."));
  }
  return listener;
}

/** With no actorTokenId this lists marker metadata only. Passing an actor applies
 * full admission checks and is used by interaction menus. No Scene writes. */
export function listListeningSessions(scene, { targetTokenId, actorTokenId, user = globalThis.game?.user, now = Date.now() } = {}) {
  if (!scene || globalThis.canvas?.scene?.id !== scene.id) return [];
  const names = new Map(new SceneAssets(scene).list().dialogues.map(({ id, name }) => [id, name]));
  const entries = [];
  for (const runtime of getRuntimes(scene)) {
    if (isExecutionHalted(scene, runtime)) continue;
    for (const session of Object.values(runtime.dialogueSessions ?? {})) {
      if (!session || session.runId !== runtime.runId || !["active", "processing"].includes(session.status)
        || !dialogueSessionIsLive(session, now) || (targetTokenId && session.actorTokenId !== targetTokenId)) continue;
      if (dialogueVisibility(session.presentation, game.users.get(session.userId)) !== "public") continue;
      const token = scene.tokens?.get(session.actorTokenId);
      if (!token?.actor || token.hidden || token.actor.id !== session.actorId || !getSceneObject(scene, session.target) || !names.has(session.dialogueId)) continue;
      if (actorTokenId !== undefined) {
        try { validateListenerAccess({ scene, runtime, session }, actorTokenId, user, { now }); }
        catch { continue; }
      }
      entries.push({ sessionId: session.sessionId, groupId: runtime.groupId, runId: runtime.runId, dialogueId: session.dialogueId,
        target: { ...session.target }, actorTokenId: session.actorTokenId, name: names.get(session.dialogueId) });
    }
  }
  return entries;
}
