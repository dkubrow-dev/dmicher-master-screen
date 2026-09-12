import { message as localizedMessage } from "./localization.js";
import { sceneUuid, virtualUuid } from "./builtin-signals.js";

/** Runtime interaction IDs become stable public UUID values at the signal boundary. */
export function interactionSignal(scene, type, assetId, session, name, { responseId, suffix = name, validation = false } = {}) {
  const target = session.target, actor = scene.tokens?.get(session.actorTokenId)?.actor;
  const user = globalThis.game?.users?.get(session.userId);
  const parameters = { sceneUuid: sceneUuid(scene), objectUuid: `${sceneUuid(scene)}.${target.type}.${target.id}`,
    [`${type.toLowerCase()}Uuid`]: virtualUuid(scene, type, assetId), userUuid: user?.uuid ?? `User.${session.userId}`,
    actorUuid: actor?.uuid ?? `Actor.${session.actorId ?? actor?.id}` };
  if (responseId !== undefined) parameters.responseUuid = `${virtualUuid(scene, "Dialogue", assetId)}.Page.${session.nodeId}.Response.${responseId}`;
  return { id: `${session.sessionId}.${session.step ?? 0}.${suffix}`, emitterKey: `${type}:${assetId}`, name, parameters,
    context: { runId: session.runId, groupId: session.groupId, validation } };
}
export function deniedMessage(outcome, fallback) {
  return outcome?.messages?.map((entry) => `${entry.name}: ${entry.message}`).join("; ") || fallback;
}
export async function notifyInteractionSignal(emit, scene, input) {
  try { if (typeof emit !== "function") throw new Error(localizedMessage("Исполнитель сигналов Ширмы не подключён.")); return await emit(scene, input); }
  catch (error) { globalThis.ui?.notifications?.error(error.message); console.error("dmicher-master-screen", input.name, error); return { status: "failed", allowed: false, error: error.message }; }
}
