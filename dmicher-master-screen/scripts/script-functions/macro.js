import { message as localizedMessage, text } from "../localization.js";
import { fail, requireText, seconds } from "./parameters.js";

export async function execute({ engine, scene, object, target, runId, step, p, effects, admitted }) {
  const { executeSignalMacro } = await import("../signal-macros.js");
  if (!engine.runtime.isObjectMacroAttached(scene, target, p.macroUuid)) {
    throw new Error(localizedMessage("Этот макрос не прикреплён к объекту скрипта."));
  }
  const active = () => admitted() && engine.canExecute(step.kind);
  const state = engine.state(scene, runId);
  const context = engine.variableContext(scene, object, active, {
    ...state?.executionContext,
    scene,
    token: object,
    state: state?.state,
    runId,
    stepId: step.id,
    isCurrent: active
  });
  if (p.signalId) {
    // The authority captured this input contract when invoking an event or
    // reaction. Reactions are local action contracts, not global emitters.
    const signal = state?.executionContext?.signal;
    if (!signal || signal.id !== p.signalId) {
      throw new Error(text("Выбранный интерфейс не совпадает с сигналом этого события.", "The selected interface does not match this event's signal."));
    }
    const macro = await globalThis.fromUuid(p.macroUuid);
    const macroReturns = await executeSignalMacro(macro, signal, context.parameters ?? {}, context, { isCurrent: active });
    return { macroReturns };
  }
  await effects.macro(p.macroUuid, context);
  return {};
}

export default Object.freeze({
  id: "macro", label: {"ru":"Макрос","en":"Macro"},
  description: {"ru":"Выполняет прикреплённый макрос в контексте скрипта или обработчика сигнала.","en":"Runs an attached macro in the script or signal-handler context."},
  category: {"ru":"системные.общие","en":"system.general"},
  scopes: ["object","group","world"], premium: true,
  template: {"macroUuid":"","signalId":"","before":0,"after":0},
  normalize(p) {
    const parameters = {
      macroUuid: requireText(p.macroUuid, 256, localizedMessage("Макрос")),
      signalId: requireText(p.signalId ?? "", 256, localizedMessage("Сигнал")),
      before: seconds(p.before),
      after: seconds(p.after)
    };
    if (!parameters.macroUuid) fail(localizedMessage("Выберите макрос."));
    return parameters;
  },
  execute
});
