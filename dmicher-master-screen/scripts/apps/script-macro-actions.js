import { signalMacroSnippet } from "../signal-macros.js";
import { objectVariableMacroSnippet } from "../object-variables.js";
import { text as t } from "../localization.js";
import { escapeHTML as e } from "./form-fields.js";

export async function handleScriptMacroAction(action, step, { signals = [], variables = [], objectUuid } = {}) {
  if (!["script-macro-open", "script-macro-template"].includes(action)) return false;
  if (step?.kind !== "macro") return true;
  if (action === "script-macro-open") {
    if (step.parameters.macroUuid) (await globalThis.fromUuid(step.parameters.macroUuid))?.sheet?.render(true);
    return true;
  }
  const signal = signals.find(entry => entry.id === step.parameters.signalId);
  const snippet = signal ? signalMacroSnippet(signal, { variables, objectUuid })
    : `${objectUuid ? objectVariableMacroSnippet(variables, {objectUuid}) : ""}\nreturn {};`;
  new foundry.applications.api.DialogV2({ window: {title:t("Шаблон макроса", "Macro template")},
    content: `<textarea readonly rows="18" style="width:100%;font-family:monospace">${e(snippet)}</textarea>`,
    buttons: [{action:"close", label:t("Закрыть", "Close"), default:true}]
  }).render({force:true});
  return true;
}
