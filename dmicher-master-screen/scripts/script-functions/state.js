import { normalizeStateTransitions } from "./parameters.js";

export async function execute({ engine, job, scene, runId, p, admitted }) {
  await engine.runtime.changeStates(scene, p.transitions, { originRunId: runId, admitted,
    signalContext: { originSceneId: scene.id, originRunId: runId, originGroupId: job.groupId, chainId: `${job.key}:${job.sequence}`, depth: 0 } });
  return {};
}

export default Object.freeze({
  id: "state", label: {"ru":"Состояние","en":"State"},
  category: {"ru":"системные.общие","en":"system.general"},
  description: { ru: "Переводит одну или несколько групп в явно выбранные состояния.", en: "Moves one or more groups into explicitly selected states." },
  scopes: ["object","group"], premium: false,
  template: {"transitions":[]},
  normalize: p => ({ transitions: normalizeStateTransitions(p.transitions) }),
  execute
});
