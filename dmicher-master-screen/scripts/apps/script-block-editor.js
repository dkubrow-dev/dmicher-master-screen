import { ScreenFormApplication } from "./screen-form.js";
import { buildScriptFields, readScriptFields, bindScriptInterruptions, bindScriptSorting } from "./script-fields.js";
import { bindScriptParameters, completeScriptParameters } from "./script-parameters.js";
import { bindScriptCatalogs } from "./script-catalog-input.js";
import { handleScriptMacroAction } from "./script-macro-actions.js";
import { appendScriptStep, removeScriptStep } from "../script-editing.js";
import { normalizeScript } from "../script-model.js";
import { analyzeScriptWarnings } from "../script-warnings.js";
import { generics } from "../generics.js";
import { themedClasses, notifyError } from "../ui.js";
import { text as t } from "../localization.js";
import { escapeHTML as e } from "./form-fields.js";
import { assertAutomationAddition } from "./automation-limit-fields.js";

/** A single script form can belong to an object-independent event source.
 * Its owner supplies preparation, references and the explicit save transaction. */
export class ScriptBlockEditor extends ScreenFormApplication {
  static DEFAULT_OPTIONS = { classes: themedClasses("dmicher-object-tools"), position: { width: 980, height: 750 },
    window: { title: "Script", resizable: true } };
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/object-tools.hbs", scrollable: [".ms-object-form"] } };
  constructor({ script, title, context, renderHeader = () => "", captureHeader = () => {}, save, validate = normalizeScript, onCreateMacro, ...options }) {
    super(options); Object.assign(this, { script: structuredClone(script), heading: title, context, renderHeader, captureHeader, save, validate, onCreateMacro });
  }
  get title() { return this.heading; }
  capture() {
    if (!this.element?.querySelector("[data-script-index]")) return;
    this.captureHeader(this.element); this.script = readScriptFields(this.element, [this.script], this.context())[0];
  }
  async _prepareContext() {
    const context = this.context();
    return { body: this.renderHeader() + buildScriptFields([this.script], null, null, context.catalog, { ...context, open: true })
      + `<footer class="dmicher-actions"><button type="button" data-screen-action="cancel">${e(t("Отмена", "Cancel"))}</button></footer>` };
  }
  async _onRender(context, options) {
    await super._onRender(context, options); const listeners = this.bindEvents();
    bindScriptInterruptions(this.element, listeners);
    bindScriptParameters(this.element, this.context, () => { this.dirty = true; }, listeners);
    bindScriptCatalogs(this.element, this.context, { ...listeners, onCreateMacro: this.onCreateMacro, onError: notifyError });
    bindScriptSorting(this.element, [this.script], () => { this.dirty = true; }, listeners, this.context());
    this.element.addEventListener("change", event => {
      if (event.target.matches("[data-script-context-refresh]")) {
        this.capture(); this.dirty = true; void this.render({force:true}); return;
      }
      if (!event.target.matches("[data-script-kind]")) return;
      this.capture(); const step = this.script.steps[Number(event.target.dataset.step)];
      step.parameters = completeScriptParameters(step.kind); this.dirty = true; void this.render({ force: true });
    }, listeners);
    const transfer = generics.components.createJSONTransfer({ filename: () => "master-screen-script.json",
      exportValue: () => { this.capture(); return {format:"dmicher-master-screen",kind:"script",version:1,data:this.validate(this.script)}; },
      validate: value => { if (value?.format !== "dmicher-master-screen" || value.kind !== "script" || value.version !== 1) throw new Error(t("Ожидается JSON скрипта.", "Expected script JSON.")); this.validate(value.data); return value; },
      importValue: async value => { this.capture(); this.script = this.validate(value.data); this.dirty = true; await this.render({force:true}); }, onError:notifyError });
    this.events.signal.addEventListener("abort", transfer.bind(this.element, "script-block-0"), {once:true});
  }
  async handleAction(action, button) {
    if (action === "cancel") { await this.close(); return; }
    this.capture();
    if (await handleScriptMacroAction(action, this.script.steps[Number(button?.dataset.step)], {
      signals: this.context().signalOptions ?? this.context().catalog?.signals ?? []
    })) return;
    if (action === "add-script-step") { assertAutomationAddition("scriptSteps", this.script.steps.length, this.context().automationLimits); appendScriptStep(this.script); }
    else if (action === "remove-script-step") removeScriptStep(this.script, Number(button.dataset.step));
    else if (action === "save") {
      const script = this.validate(this.script), warnings = analyzeScriptWarnings(script);
      if (warnings.durationUnset || warnings.cycle) {
        const messages = [warnings.durationUnset && t("Длительность не установлена.", "Duration is not set."),
          warnings.cycle && t(`Возможен бесконечный цикл: ${warnings.cycle.join(" → ")}.`, `A possible infinite cycle: ${warnings.cycle.join(" → ")}.`),
          warnings.zeroDelayCycle && t(`Цикл без задержек: ${warnings.zeroDelayCycle.join(" → ")}. Добавьте ожидание или проверьте выход.`, `Zero-delay cycle: ${warnings.zeroDelayCycle.join(" → ")}. Add a wait or check the exit.`)].filter(Boolean);
        if (!await foundry.applications.api.DialogV2.confirm({ window:{title:t("Проверка скрипта", "Script check")},content:`<p>${messages.map(e).join("<br>")}</p>`,rejectClose:false })) return;
      }
      await this.save(script); this.dirty = false; await this.close(); return;
    } else return;
    this.dirty = true; await this.render({force:true});
  }
}
