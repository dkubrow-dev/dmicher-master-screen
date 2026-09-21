import { ScriptBlockEditor } from "./script-block-editor.js";
import { SignalCatalog } from "../signal-catalog.js";
import { getDefinition, getDefinitions } from "../store.js";
import { normalizeGroupScript } from "../group-subscriptions.js";
import { normalizeScript, scriptStepTemplate } from "../script-model.js";
import { selectOptions, formValue, escapeHTML as e } from "./form-fields.js";
import { text as t } from "../localization.js";
import { promptAndCreateAttachedScriptMacro } from "./script-catalog-input.js";
import { assertAutomationAddition, renderAutomationCount, renderAutomationUnavailable } from "./automation-limit-fields.js";

export function openGroupSubscription(scene, groupId, id, onSaved) {
  const catalog = new SignalCatalog(scene), ownerKey = `Group:${groupId}`, initial = catalog.list();
  let revision = initial.revision;
  const original = id && initial.subscriptions.find(entry => entry.id === id && entry.ownerKey === ownerKey);
  if (id && !original) throw new Error(t("Подписка больше не существует.", "The subscription no longer exists."));
  if (!original) assertAutomationAddition("subscriptions", initial.subscriptions.filter(entry => entry.ownerKey === ownerKey).length);
  const draft = original ? structuredClone(original) : {ownerKey,handler:"script",macroUuid:"",enabled:true,signalId:"",emitterKey:""};
  const context = () => ({scriptScope:"group", ownerKey, definitions:getDefinitions(scene), catalog:catalog.list(),
    signalOptions: catalog.list().signals.filter(signal => signal.id === draft.signalId)});
  const editor = new ScriptBlockEditor({ title:t("Подписка группы", "Group subscription"),
    script: draft.script ?? normalizeScript({name:"",steps:[{id:1,...scriptStepTemplate("wait")}]}), context, validate:normalizeGroupScript,
    onCreateMacro: () => promptAndCreateAttachedScriptMacro({ validate: () => getDefinition(scene,{groupId}),
      attachMacro: async uuid => { await catalog.attachMacro(ownerKey, uuid, {expectedRevision:revision}); revision = catalog.list().revision; } }),
    renderHeader: () => { const data=catalog.list(), rows = data.subscriptions.filter(entry => entry.ownerKey === ownerKey); return `<p>${e(getDefinition(scene,{groupId}).groupName)}</p>${renderAutomationCount("subscriptions", rows.length)}${renderAutomationUnavailable("subscriptions", rows.findIndex(entry => entry.id === id))}<label>${t("Сигнал", "Signal")}<select name="group-subscription-signal" data-script-context-refresh>${selectOptions(data.signals.filter(signal=>signal.enabled !== false || signal.id===draft.signalId).map(signal=>({id:signal.id,name:`${data.emitters.find(emitter=>emitter.key===signal.emitterKey)?.name ?? signal.emitterKey} · ${signal.label?.[game.i18n.lang] ?? signal.name}`})),draft.signalId,"—")}</select></label><label><input type="checkbox" name="group-subscription-enabled"${draft.enabled?" checked":""}>${t("Включена", "Enabled")}</label>`; },
    captureHeader: element => { draft.signalId=formValue(element,"group-subscription-signal"); draft.emitterKey=catalog.list().signals.find(signal=>signal.id===draft.signalId)?.emitterKey; draft.enabled=element.querySelector('[name="group-subscription-enabled"]').checked; },
    save: async script => { getDefinition(scene,{groupId}); if (!original) assertAutomationAddition("subscriptions", catalog.list().subscriptions.filter(entry => entry.ownerKey === ownerKey).length); await catalog.saveSubscription({...draft,handler:"script",macroUuid:"",script},{expectedRevision:revision}); onSaved?.(); }
  });
  void editor.render({force:true}); return editor;
}
