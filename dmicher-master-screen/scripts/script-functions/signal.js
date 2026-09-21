import { message as localizedMessage } from "../localization.js";
import { fail, requireText, seconds, json } from "./parameters.js";

export async function execute({ engine, job, scene, target, runId, p, admitted, executionCurrent }) {
  const state = engine.state(scene, runId);
  if (admitted()) {
    await engine.runtime.emitObjectSignal(scene, target, p.signalId, structuredClone(p.parameters), {
      originSceneId: scene.id,
      originRunId: state?.command ? state.parentRunId : runId,
      originGroupId: job.groupId,
      chainId: `${job.key}:${job.sequence}`,
      depth: 0,
      ...(state?.command ? { current: executionCurrent } : {})
    });
  }
  return {};
}

export default Object.freeze({
  id: "signal", label: {"ru":"Сигнал","en":"Signal"},
  description: {"ru":"Отправляет объявленный сигнал объекта с проверенными JSON-параметрами.","en":"Emits a declared object signal with validated JSON parameters."},
  category: {"ru":"системные.общие","en":"system.general"},
  scopes: ["object","group"], premium: false,
  template: {"signalId":"","parameters":{},"before":0,"after":0},
  normalize(p) {
    const parameters = {
      signalId: requireText(p.signalId, 256, localizedMessage("Сигнал")),
      parameters: json(p.parameters),
      before: seconds(p.before),
      after: seconds(p.after)
    };
    if (!parameters.signalId) fail(localizedMessage("Выберите сигнал."));
    return parameters;
  },
  execute
});
