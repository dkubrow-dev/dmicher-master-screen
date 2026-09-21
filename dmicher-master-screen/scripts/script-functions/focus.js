import { choice } from "./parameters.js";

export async function execute({ engine, job, scene, object, runId, p, effects, admitted, executionCurrent }) {
  if (admitted()) await effects.focus(scene, object, p.audience, { runId, groupId: job.groupId,
    manual: engine.state(scene, runId)?.manual === true, scriptKey: job.progressKey, scriptGeneration: job.generation,
    isCurrent: executionCurrent });
  return {};
}

export default Object.freeze({
  id: "focus", label: {"ru":"Фокус","en":"Focus"},
  category: {"ru":"сцена.интерфейс","en":"scene.interface"},
  description: { ru: "Центрирует карту на объекте исполнителя у выбранной аудитории без смены сцены.", en: "Centers the selected audience's viewed scene on the executing object without switching scenes." },
  scopes: ["object"], premium: true,
  template: {"audience":"all"},
  normalize: p => ({ audience: choice(p.audience, ["all", "players", "gm"], "all") }),
  execute
});
