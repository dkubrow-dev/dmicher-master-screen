import { text } from "./localization.js";
import { generics } from "./generics.js";
import { dialogueVisibility, publicDialogueTokenAllowed } from "./dialogue-visibility.js";

/** A role is granted by the stored session, never by the command or window.
 * The original user/token pair remains the only speaker in this version. */
export function dialogueParticipant(scene, session, user, listenerTokenId) {
  const speaker = session.userId === user?.id && !listenerTokenId;
  const participant = speaker ? session : session.participants?.find((entry) => entry.role === "listener"
    && entry.userId === user?.id && entry.actorTokenId === listenerTokenId && entry.expiresAt > Date.now());
  const token = participant && scene.tokens?.get(participant.actorTokenId);
  if (!participant || !token?.actor || token.actor.id !== participant.actorId || generics.chat.isManagedIdentityUser(user)
    || (!speaker && (dialogueVisibility(session.presentation, game.users.get(session.userId)) !== "public"
      || !publicDialogueTokenAllowed(scene, session, token)))
    || (!user.isGM && !token.actor.testUserPermission?.(user, "OWNER"))) {
    throw new Error(text("У вас больше нет доступа к этому разговору.", "You no longer have access to this conversation."));
  }
  return { role: speaker ? "speaker" : "listener", participant, token };
}
