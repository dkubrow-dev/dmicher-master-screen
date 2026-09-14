import { MODULE_ID } from "./model.js";
import { getSceneObject } from "./scene-objects.js";
import { directorExecutionRows, directorInteractionRows } from "./director-activity-model.js";

const values = record => Object.values(record ?? {});
const nameOf = document => String(document?.name || document?.text || document?.label || document?.id || "");

/** This adapter reads delivered state, without normalizing entire runtimes (which
 * include histories) or requesting session renewals. Only the visible panel calls it. */
export function readDirectorActivity(scene, { groupId, manualRuns = [], now = Date.now(), isGM = globalThis.game?.user?.isGM,
  userName = id => globalThis.game?.users?.get(id)?.name ?? "", paused = globalThis.game?.paused } = {}) {
  if (!isGM || !scene) return { interactions: [], executions: [], expiresAt: null, groupName: "" };
  const flags = key => scene.getFlag(MODULE_ID, key);
  const definitions = flags("groupDefinitions") ?? {}, runtimes = flags("groupRuntimes") ?? {};
  const catalog = flags("interactionCatalog") ?? {}, bindings = values(flags("objectBindings")?.bindings);
  const objectName = target => nameOf(getSceneObject(scene, target));
  const interactions = directorInteractionRows({ sceneId: scene.id, runtimes: values(runtimes),
    dialogueNames: new Map((catalog.dialogues ?? []).map(entry => [entry.id, entry.name])),
    shopNames: new Map((catalog.shops ?? []).map(entry => [entry.id, entry.name])),
    objectName, tokenName: id => nameOf(scene.tokens?.get(id)), userName,
    groupName: id => definitions[id]?.groupName ?? "", now });
  return { interactions: interactions.rows, expiresAt: interactions.expiresAt, groupName: definitions[groupId]?.groupName ?? "",
    executions: directorExecutionRows({ groupId, run: runtimes[groupId], bindings, objectName, paused,
      sceneHalted: flags("automationHalted") === true,
      manualRuns: [...manualRuns].filter(run => run.sceneId === scene.id),
      commandRuns: values(flags("objectCommandRuns")).filter(run => run?.schemaVersion === 1 && run.command === true && run.runId) }) };
}
