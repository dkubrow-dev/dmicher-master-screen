import { message as localizedMessage } from "../localization.js";
import { fail, requireText, speed } from "./parameters.js";

export async function execute({ engine, job, scene, object, target, runId, script, p, effects, admitted }) {
  if (admitted()) {
    await effects.sound(p.src, p.volume, {
      scene,
      runId,
      target,
      groupId: job.groupId,
      manual: engine.state(scene, runId)?.manual === true,
      scriptKey: job.progressKey,
      scriptGeneration: job.generation,
      // Sound may outlive its step. Only its script generation and ownership,
      // not the next step's sequence number, can end this presentation.
      isCurrent: () => engine.generationCurrent(scene, runId, job.progressKey, job.generation)
        && engine.current(scene, runId, target, { ignoreInteractionPause: true, scriptKey: job.progressKey })
        && !engine.interruptionSource(scene, object, script, runId)
    });
  }
  return {};
}

export default Object.freeze({
  id: "sound", label: {"ru":"Звук","en":"Sound"},
  description: {"ru":"Воспроизводит звуковой файл с заданной громкостью для текущего запуска скрипта.","en":"Plays an audio file at the configured volume for the current script run."},
  category: {"ru":"системные.звук","en":"system.audio"},
  scopes: ["object"], premium: true,
  template: {"src":"","volume":1},
  normalize(p) {
    const parameters = {
      src: requireText(p.src, 2048, localizedMessage("Файл звука")).trim(),
      volume: speed(p.volume ?? 1)
    };
    if (!parameters.src) fail(localizedMessage("Выберите файл звука."));
    return parameters;
  },
  execute
});
