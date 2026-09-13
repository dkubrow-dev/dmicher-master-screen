/** Transcript entries are snapshots, not references to editable catalogue pages.
 * Text and names stay plain text; the window escapes both speaker roles. */
export function dialogueObjectMessage(session, page, dialogue, target) {
  return { id: `${session.sessionId}.${session.step}.object`, role: "object", name: target?.name ?? dialogue?.name ?? "",
    text: page?.text ?? "", img: page?.art || target?.texture?.src || target?.actor?.img || "",
    audio: page?.audio ?? "", imageAlignment: page?.imageAlignment === "right" ? "right" : "left" };
}

export function dialoguePlayerMessage(session, response, token, user) {
  const fallback = "icons/svg/mystery-man.svg";
  const img = [token?.actor?.img, token?.texture?.src, user?.avatar].find((value) => typeof value === "string" && value.trim() && value !== fallback);
  return { id: `${session.sessionId}.${session.step}.player`, role: "player", name: token?.name || token?.actor?.name || user?.name || "",
    text: response.label, img: img || fallback, imageAlignment: "right" };
}

export function appendDialogueMessage(session, entry) {
  session.history ??= [];
  if (!session.history.some(({ id }) => id === entry.id)) session.history.push(entry);
}

export function dialogueSessionView(session, dialogue, target, { role = "speaker", listenerTokenId } = {}) {
  const page = dialogue?.pages?.find((entry) => entry.id === session.nodeId);
  const current = dialogueObjectMessage(session, page, dialogue, target);
  return { sessionId: session.sessionId, dialogueId: session.dialogueId, groupId: session.groupId, runId: session.runId,
    actorTokenId: session.actorTokenId, target: structuredClone(session.target), role, ...(listenerTokenId ? { listenerTokenId } : {}),
    nodeId: session.nodeId, step: session.step, status: session.status, targetName: target?.name ?? dialogue?.name ?? session.title ?? "",
    title: dialogue?.name ?? session.title ?? "", text: current.text, art: current.img, audio: current.audio, imageAlignment: current.imageAlignment,
    // An already-open session without a transcript can display its current page;
    // this never reconstructs previous answers or rewrites saved data.
    history: structuredClone(session.history?.length ? session.history : page ? [current] : []),
    responses: role === "speaker" && session.status === "active" ? (page?.responses ?? []).map(({ id, label }) => ({ id, label })) : [] };
}
