import { message as localizedMessage, text } from "./localization.js";
import { MODULE_ID } from "./model.js";
import { requireGM } from "./store.js";
import { generics } from "./generics.js";
import { getInteractionCatalog, normalizeDialogueAsset } from "./scene-assets.js";

/** Manual projection contains presentation and local navigation only, never executable actions. */
export function manualDialogueData(source, { includeSignalIds = false } = {}) {
  // This is the active presentation DTO used by invitations, not stored scene preparation.
  // Reuse catalog validation for its page links before exposing it to another participant.
  if (!Array.isArray(source?.pages)) throw new Error(localizedMessage("У диалога пока нет страниц."));
  const dialogue = normalizeDialogueAsset(source);
  return { id: dialogue.id, name: dialogue.name, startPageId: dialogue.startPageId,
    pages: dialogue.pages.map((page) => ({ id: page.id, text: page.text, art: page.art,
      responses: page.responses.map((response) => ({ id: response.id, label: response.label,
        nextPageId: response.nextPageId, signalId: includeSignalIds ? response.signalId : "" })) })) };
}

// Invitations are stored chat documents. Their version-1 wire names stay stable;
// only this boundary maps them to the same page model used by preparation and play.
function invitationDialogue(pages) {
  return { id: pages.id, name: pages.name, startNodeId: pages.startPageId,
    nodes: pages.pages.map(({ responses, ...page }) => ({ ...page,
      responses: responses.map(({ nextPageId, ...response }) => ({ ...response, nextNodeId: nextPageId })) })) };
}
function readInvitationDialogue(wire) {
  return manualDialogueData({ id: wire?.id, name: wire?.name, startPageId: wire?.startNodeId,
    pages: wire?.nodes?.map(({ responses, ...page }) => ({ ...page,
      responses: responses?.map(({ nextNodeId, ...response }) => ({ ...response, nextPageId: nextNodeId })) })) });
}

const defaultOpen = async (data) => {
  const { ManualDialogueApplication } = await import("./apps/manual-dialogue.js");
  const application = new ManualDialogueApplication(data);
  await application.render({ force: true });
  return application;
};

/** Sending is a deliberate GM action, independent of the current automation state. */
export function createManualDialogueService({ openWindow = defaultOpen, messageService } = {}) {
  const chat = messageService ?? generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "manual-dialogues" });
  const shown = new Set();
  const getManualContext = ({ sceneId, stateId, dialogueId, pageId, groupId = "main" }) => {
    requireGM();
    const scene = game.scenes.get(sceneId);
    if (!scene) throw new Error(localizedMessage("Сцена не найдена."));
    const asset = getInteractionCatalog(scene).dialogues.find((entry) => entry.id === dialogueId);
    if (asset) {
      const source = { ...asset, startPageId: pageId ?? asset.startPageId };
      if (!source.pages.some((page) => page.id === source.startPageId)) throw new Error(localizedMessage("Страница диалога не найдена."));
      return { dialogue: manualDialogueData(source, { includeSignalIds: true }), sourceName: asset.name, sceneId, groupId, stateId };
    }
    throw new Error(localizedMessage("Диалог не найден в каталоге сцены."));
  };
  const invitePlayers = async ({ userIds, ...selection }) => {
    const source = getManualContext(selection);
    if (!Array.isArray(userIds)) throw new Error(localizedMessage("Нужно явно выбрать участников показа."));
    const recipients = [...new Set(userIds)].filter((id) => typeof id === "string" && game.users.get(id));
    if (!recipients.length) return [];
    const invitationId = foundry.utils.randomID();
    const data = { version: 1, invitationId, ...source,
      dialogue: invitationDialogue(manualDialogueData(source.dialogue)), manual: true };
    const messages = await chat.create({ author: game.user.id,
      content: `<p>${generics.utilities.escapeHTML(text(`Мастер приглашает к диалогу «${source.dialogue.name}». Сцену ведёт мастер.`, `The GM invites you to the dialogue “${source.dialogue.name}”. The GM is directing the scene.`))}</p>`,
      flags: { [MODULE_ID]: { manualDialogue: data } } },
    { audience: { type: "users", userIds: recipients }, kind: "manual-dialogue", technical: false, key: invitationId });
    return messages.map((message) => message.id);
  };
  return Object.freeze({
    getManualContext,
    openManualDialogue: (selection) => openWindow({ ...getManualContext(selection), invitationId: foundry.utils.randomID(), gmPreview: true }),
    invitePlayers,
    async processManualInvitation(message, initiatingUserId) {
      const raw = message.getFlag?.(MODULE_ID, "manualDialogue");
      if (!raw || raw.version !== 1 || raw.manual !== true || !message.id) return false;
      const authorId = typeof message.author === "string" ? message.author : message.author?.id;
      const author = game.users.get(authorId);
      if (!initiatingUserId || authorId !== initiatingUserId || !author?.isGM) return false;
      if (!Array.isArray(message.whisper) || !message.whisper.includes(game.user.id)) return false;
      if (message.visible === false || message.isContentVisible === false) return false;
      if (shown.has(message.id)) return true;
      const dialogue = readInvitationDialogue(raw.dialogue);
      shown.add(message.id);
      if (shown.size > 500) shown.delete(shown.values().next().value);
      await openWindow({ dialogue, sourceName: String(raw.sourceName ?? dialogue.name).slice(0, 200),
        invitationId: message.id, gmPreview: false });
      return true;
    }
  });
}
