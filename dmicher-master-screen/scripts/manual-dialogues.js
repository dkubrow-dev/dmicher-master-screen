import { MODULE_ID } from "./model.js";
import { requireGM } from "./store.js";
import { generics } from "./generics.js";
import { getInteractionCatalog, normalizeDialogueAsset } from "./scene-assets.js";

/** Manual projection contains presentation and local navigation only, never executable actions. */
export function manualDialogueData(source, { includeSignalIds = false } = {}) {
  // This is the active presentation DTO used by invitations, not stored scene preparation.
  // Reuse catalog validation for its page links before exposing it to another participant.
  if (!Array.isArray(source?.nodes)) throw new Error("У диалога пока нет страниц.");
  const dialogue = normalizeDialogueAsset({ id: source.id, name: source.name, startPageId: source.startNodeId,
    pages: source.nodes.map((node) => ({ ...node, responses: (node.responses ?? []).map((response) => ({ ...response, nextPageId: response.nextNodeId })) })) });
  return { id: dialogue.id, name: dialogue.name, startNodeId: dialogue.startPageId,
    nodes: dialogue.pages.map((node) => ({ id: node.id, text: node.text, art: node.art,
      responses: node.responses.map((response) => ({ id: response.id, label: response.label,
        nextNodeId: response.nextPageId, signalId: includeSignalIds ? response.signalId : "" })) })) };
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
    if (!scene) throw new Error("Сцена не найдена.");
    const asset = getInteractionCatalog(scene).dialogues.find((entry) => entry.id === dialogueId);
    if (asset) {
      const source = { ...asset, startNodeId: pageId ?? asset.startPageId,
        nodes: asset.pages.map((page) => ({ ...page, responses: page.responses.map((response) => ({ ...response, nextNodeId: response.nextPageId })) })) };
      if (!source.nodes.some((node) => node.id === source.startNodeId)) throw new Error("Страница диалога не найдена.");
      return { dialogue: manualDialogueData(source, { includeSignalIds: true }), sourceName: asset.name, sceneId, groupId, stateId };
    }
    throw new Error("Диалог не найден в каталоге сцены.");
  };
  const invitePlayers = async ({ userIds, ...selection }) => {
    const source = getManualContext(selection);
    if (!Array.isArray(userIds)) throw new Error("Нужно явно выбрать участников показа.");
    const recipients = [...new Set(userIds)].filter((id) => typeof id === "string" && game.users.get(id));
    if (!recipients.length) return [];
    const invitationId = foundry.utils.randomID();
    const data = { version: 1, invitationId, ...source,
      dialogue: manualDialogueData(source.dialogue), manual: true };
    const messages = await chat.create({ author: game.user.id,
      content: `<p>Мастер приглашает к диалогу «${generics.utilities.escapeHTML(source.dialogue.name)}». Сцену ведёт мастер.</p>`,
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
      const dialogue = manualDialogueData(raw.dialogue);
      shown.add(message.id);
      if (shown.size > 500) shown.delete(shown.values().next().value);
      await openWindow({ dialogue, sourceName: String(raw.sourceName ?? dialogue.name).slice(0, 200),
        invitationId: message.id, gmPreview: false });
      return true;
    }
  });
}
