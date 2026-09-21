import { message as localizedMessage, text } from "../localization.js";
import { fail, requireText, choice } from "./parameters.js";

export async function execute({ engine, job, scene, object, target, runId, script, p, executionCurrent }) {
  if (engine.state(scene, runId)?.manual && !engine.state(scene, runId)?.purpose) {
    throw new Error(text(
      "Диалог скрипта доступен в переходах и рутине запущенной группы. Для ручного показа используйте окно диалогов.",
      "Scripted dialogue is available in the transitions and routines of a running group. Use the Dialogues window for manual presentation."
    ));
  }
  if (!engine.runtime.startScriptDialogues) throw new Error(localizedMessage("Неизвестное действие скрипта."));
  // Opening our first window pauses the object before the result references
  // can be saved. Exclude only our confirmed windows while admitting the rest.
  const isCurrent = (started = []) => {
    const turn = engine.combat.context(scene, object);
    return executionCurrent() && !globalThis.game?.paused
      && engine.current(scene, runId, target, { scriptKey: job.progressKey, excludeDialogueSessions: started })
      && (!turn || script.combat.enabled && turn.isTurn);
  };
  const dialogueRunId = engine.interactionState(scene, engine.state(scene, runId))?.runId ?? runId;
  const sessions = await engine.runtime.startScriptDialogues({
    sceneId: scene.id,
    groupId: job.groupId,
    runId: dialogueRunId,
    target,
    dialogueId: p.dialogueId,
    tokenUuids: structuredClone(p.tokenUuids)
  }, {
    isCurrent,
    waitForAdmission: (started = []) => engine.waitUntilAdmitted(job, () => isCurrent(started), executionCurrent)
  });
  return { sessions };
}

export default Object.freeze({
  id: "dialogue", label: {"ru":"Диалог","en":"Dialogue"},
  description: {"ru":"Запускает выбранный диалог для указанных персонажей и ожидает его по заданной политике.","en":"Starts the selected dialogue for specified characters and waits according to its policy."},
  category: {"ru":"объекты.взаимодействие","en":"objects.interaction"},
  scopes: ["object"], premium: false,
  objectTypes: ["Token", "Tile", "Drawing", "Region"],
  template: {"dialogueId":"","tokenUuids":[],"waitMode":"all"},
  normalize(p) {
    if (!Array.isArray(p.tokenUuids ?? []) || (p.tokenUuids?.length ?? 0) > 100) {
      fail(text("Выберите до 100 персонажей для диалога.", "Select up to 100 characters for the dialogue."));
    }
    return {
      dialogueId: requireText(p.dialogueId ?? "", 64, text("Диалог", "Dialogue")),
      tokenUuids: [...new Set((p.tokenUuids ?? []).map(value => requireText(value, 2048, text("UUID персонажа", "Character UUID"))))],
      waitMode: choice(p.waitMode, ["all", "first", "none"], "all")
    };
  },
  execute
});
