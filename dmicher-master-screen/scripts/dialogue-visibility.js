import { MODULE_ID } from "./model.js";
import { generics } from "./generics.js";
import { getObjectTags } from "./store.js";
import { getSceneObject } from "./scene-objects.js";
import { objectCenter, sceneDistance } from "./scene-object-geometry.js";

const values = collection => Array.from(collection?.values?.() ?? collection ?? []);
export function currentDialogueRollMode() {
  try { return game.settings.get("core", "rollMode"); } catch { return "gmroll"; }
}

/** Foundry's roll mode is client-local. Mirror only this preference on its own
 * User, so a GM-started conversation can apply the recipient's current choice. */
export async function syncDialogueRollMode() {
  const user = globalThis.game?.user;
  if (!user?.setFlag || generics.chat.isManagedIdentityUser(user)) return;
  const mode = currentDialogueRollMode();
  if (user.getFlag(MODULE_ID, "dialogueRollMode") !== mode) await user.setFlag(MODULE_ID, "dialogueRollMode", mode);
}

export function dialogueVisibility(presentation, user) {
  if (presentation?.visibility !== "player") return presentation?.visibility === "public" ? "public" : "private";
  const mode = user?.id === globalThis.game?.user?.id ? currentDialogueRollMode() : user?.getFlag?.(MODULE_ID, "dialogueRollMode");
  return mode === "publicroll" ? "public" : "private";
}

export function publicDialogueTokenAllowed(scene, session, token) {
  const rules = session.presentation?.publicAudience ?? {}, tags = getObjectTags(scene, { type: "Token", id: token.id });
  if (rules.allowTags?.length && !rules.allowTags.some(tag => tags.includes(tag))) return false;
  if (rules.denyTags?.some(tag => tags.includes(tag))) return false;
  if (rules.range != null) {
    const target = getSceneObject(scene, session.target);
    if (!target || (token.level != null && target.level != null && token.level !== target.level)) return false;
    const distance = sceneDistance(scene, objectCenter(token, scene), objectCenter(target, scene));
    if (!Number.isFinite(distance) || distance > rules.range) return false;
  }
  return true;
}

export function dialogueAudience(scene, session, { observersOnly = false } = {}) {
  const users = values(game.users).filter(user => !generics.chat.isManagedIdentityUser(user));
  const primary = users.filter(user => user.isGM || Number(user.role) >= 3 || user.id === session.userId).map(user => user.id);
  if (dialogueVisibility(session.presentation, game.users.get(session.userId)) !== "public") return observersOnly ? [] : primary;
  const rules = session.presentation?.publicAudience ?? {};
  const filtered = rules.allowTags?.length || rules.denyTags?.length || rules.range != null;
  const observers = users.filter(user => !primary.includes(user.id) && [1, 2].includes(Number(user.role))
    && (!filtered || values(scene.tokens).some(token => token.actor?.testUserPermission?.(user, "OWNER")
      && publicDialogueTokenAllowed(scene, session, token)))).map(user => user.id);
  return observersOnly ? observers : [...primary, ...observers];
}
