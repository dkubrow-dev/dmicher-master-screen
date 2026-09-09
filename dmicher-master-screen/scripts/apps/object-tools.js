import { ScreenFormApplication } from "./editor.js";
import { themedClasses, notifyError } from "../ui.js";
import { generics } from "../generics.js";
import { currentScene, getDefinitions, getObjectTags } from "../store.js";
import { SceneObjects, getObjectBindings, getSceneObject } from "../scene-objects.js";
import { getInteractionCatalog } from "../scene-assets.js";
import { getEventCatalog } from "../event-catalog.js";
import { randomId, normalizeTrigger } from "../model.js";
import { buildTriggerFields, readTriggerFields, splitTags } from "./trigger-fields.js";
import { routineStepTemplate } from "../routine-model.js";
import { buildRoutineFields, readRoutineFields, appendRoutineStep, removeRoutineStep } from "./routine-fields.js";

const t = (ru, en) => game.i18n?.lang?.startsWith("ru") ? ru : en;
const e = (value) => generics.utilities.escapeHTML(String(value ?? ""));
const clone = (value) => structuredClone(value);
const value = (root, name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
const selected = (actual, expected) => actual === expected ? " selected" : "";
const input = (name, label, text = "", attributes = "") => `<label>${e(label)}<input name="${name}" value="${e(text)}" ${attributes}></label>`;
const options = (items, current, placeholder = t("Не выбрано", "Not selected")) => `<option value="">${e(placeholder)}</option>${items.map((item) => `<option value="${e(item.id)}"${selected(current, item.id)}>${e(item.name)}</option>`).join("")}`;
const footer = () => `<footer><button type="button" data-screen-action="cancel">${t("Закрыть", "Close")}</button><button type="button" data-screen-action="save">${t("Сохранить", "Save")}</button></footer>`;
const section = (title, body) => `<section class="ms-object-feature"><h3>${e(title)}</h3>${body}</section>`;
const layout = (body, navigation = "") => navigation + `<div class="ms-object-scroll">${body}</div>` + footer();

/** Edits are pinned to one scene and revision; merely opening a native object writes nothing. */
class ObjectForm extends ScreenFormApplication {
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/object-tools.hbs", scrollable: [".ms-object-scroll"] } };
  constructor(controller, descriptor, options = {}) {
    super(options); this.controller = controller; this.descriptor = { type: descriptor.type, id: descriptor.id };
    this.sceneId = currentScene()?.id; this.draft = null;
  }
  context() {
    const scene = game.scenes?.get(this.sceneId) ?? (currentScene()?.id === this.sceneId ? currentScene() : null);
    const document = scene && getSceneObject(scene, this.descriptor);
    if (!document) throw new Error(t("Объект больше не существует.", "The object no longer exists."));
    const records = getObjectBindings(scene);
    if (!this.draft) {
      this.revision = records.revision;
      this.draft = clone(new SceneObjects(scene).get(this.descriptor) ?? { ...this.descriptor, schemeId: null,
        tags: getObjectTags(scene, this.descriptor), notes: "", playerCharacter: false, routines: [], shop: null, dialogue: null, entry: { position: null, hidden: null }, episodes: {}, features: [] });
      this.original = clone(this.draft);
    }
    const definitions = getDefinitions(scene), definition = definitions.find((item) => item.schemeId === this.draft.schemeId);
    return { scene, document, definitions, definition, catalog: getInteractionCatalog(scene) };
  }
  async _onRender(context, options) { await super._onRender(context, options); this.bindEvents(); }
  refresh() { if (this.rendered && !this.dirty) { this.draft = null; return this.render({ force: true }); } }
  assertCurrentScene() {
    if (currentScene()?.id !== this.sceneId) throw new Error(t("Вернитесь к сцене редактируемого объекта.", "Return to this object's scene before saving."));
  }
  async persist({ close = false } = {}) {
    this.assertCurrentScene();
    const scene = this.context().scene;
    // Only edited fields constitute a command. Merely inspecting legacy behavior must
    // not flatten its per-episode shop/dialogue variants into one new attachment.
    const patch = Object.fromEntries(["schemeId", "tags", "notes", "playerCharacter", "entry", "episodes", "shop", "dialogue", "features", "routines"]
      .filter((key) => JSON.stringify(this.draft[key]) !== JSON.stringify(this.original[key]))
      .map((key) => [key, clone(this.draft[key])]));
    if (Object.keys(patch).length) await new SceneObjects(scene).save(this.descriptor, patch, { expectedRevision: this.revision, allowReassign: true });
    this.draft = null; this.dirty = false;
    if (close) await this.close();
    this.controller.changed(scene);
    if (!close) await this.render({ force: true });
  }
  async handleAction(action) {
    if (action === "cancel") { if (await this.mayDiscard()) return this.close(); }
    if (action === "save") { this.capture(); return this.persist(); }
  }
}

export class ObjectInfoApplication extends ObjectForm {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-object-info"), position: { width: 470, height: 540 },
    window: { title: "Информация об объекте", resizable: true } };
  async _prepareContext() {
    const { document, definitions } = this.context();
    const facts = [[t("Тип", "Type"), this.descriptor.type], ["ID", document.id], ["UUID", document.uuid],
      [t("Название", "Name"), document.name ?? document.label ?? ""], ["Actor UUID", document.actor?.uuid],
      [t("Позиция", "Position"), Number.isFinite(document.x) ? `${document.x}, ${document.y}` : null],
      [t("Размер", "Dimensions"), document.width !== undefined ? `${document.width} × ${document.height}` : null],
      [t("Изображение", "Image"), document.texture?.src ?? document.img]].filter(([, text]) => text !== undefined && text !== null && text !== "");
    return { body: layout(`<dl class="ms-object-metadata">${facts.map(([label, text]) => `<dt>${e(label)}</dt><dd>${e(text)}</dd>`).join("")}</dl>
      <label>${t("Схема", "Scheme")}<select name="object-scheme">${options(definitions.map((item) => ({ id: item.schemeId, name: item.schemeName })), this.draft.schemeId, t("Без схемы", "Unassigned"))}</select></label>
      ${this.descriptor.type === "Token" ? `<label class="ms-check"><input type="checkbox" name="object-player-character"${this.draft.playerCharacter ? " checked" : ""}>${t("Персонаж игрока", "Player character")}</label>` : ""}
      ${input("object-tags", t("Теги, через запятую", "Tags, comma separated"), this.draft.tags?.join(", ") ?? "")}
      <label>${t("Заметки мастера", "GM notes")}<textarea name="object-notes" maxlength="8000">${e(this.draft.notes)}</textarea></label>`) };
  }
  capture() {
    this.draft = { ...this.draft, schemeId: value(this.element, "object-scheme") || null,
      tags: splitTags(value(this.element, "object-tags")), notes: value(this.element, "object-notes"),
      playerCharacter: this.descriptor.type === "Token" && this.element.querySelector('[name="object-player-character"]')?.checked === true };
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    // This shortcut belongs only to this form. Native Foundry editors keep their own keys.
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing || event.repeat || event.shiftKey || !event.target.matches("input, select, textarea")) return;
      event.preventDefault(); event.stopPropagation();
      if (this.saving) return;
      this.saving = true;
      void Promise.resolve().then(() => { this.capture(); return this.persist({ close: true }); })
        .catch(notifyError).finally(() => { this.saving = false; });
    }, { signal: this.events.signal });
  }
}

const stateFields = (prefix, state = {}) => `<div class="ms-object-row">${input(`${prefix}-x`, "X", state.position?.x ?? "", 'type="number" step="any"')}${input(`${prefix}-y`, "Y", state.position?.y ?? "", 'type="number" step="any"')}
  <label>${t("Видимость", "Visibility")}<select name="${prefix}-hidden"><option value="">${t("Как есть", "Keep current")}</option><option value="false"${state.hidden === false ? " selected" : ""}>${t("Показать", "Show")}</option><option value="true"${state.hidden === true ? " selected" : ""}>${t("Скрыть", "Hide")}</option></select></label></div>
  <div class="ms-object-row"><button type="button" data-screen-action="capture-position" data-prefix="${prefix}">${t("Взять текущее положение", "Capture current position")}</button>
  ${prefix === "entry" ? `<button type="button" data-screen-action="restore-position">${t("Вернуть к указанному положению", "Return to specified position")}</button>` : ""}</div>`;
function readState(root, prefix) {
  const x = value(root, `${prefix}-x`), y = value(root, `${prefix}-y`), hidden = value(root, `${prefix}-hidden`);
  if ((x === "") !== (y === "") || x !== "" && (![Number(x), Number(y)].every(Number.isFinite))) throw new Error(t("Укажите обе координаты или оставьте обе пустыми.", "Enter both coordinates or leave both blank."));
  return { position: x === "" ? null : { x: Number(x), y: Number(y) }, hidden: hidden === "" ? null : hidden === "true" };
}

export class ObjectBehaviorApplication extends ObjectForm {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-object-behavior"), position: { width: 610, height: 680 },
    window: { title: "Поведение объекта", resizable: true } };
  tab = "transitions";
  editEpisodeId = null;
  async _prepareContext() {
    const context = this.context(), { definition } = context;
    if (!definition) return { body: `<p>${t("Назначьте объекту схему в разделе «Информация».", "Assign the object to a scheme in Information first.")}</p><button type="button" data-screen-action="information">${t("Информация", "Information")}</button>` };
    if (!definition.episodes.some((item) => item.id === this.editEpisodeId)) this.editEpisodeId = definition.entryEpisodeId;
    const navigation = `<nav class="ms-object-tabs">${[["transitions", t("Переходы", "Transitions")], ["features", t("Особенности", "Features")], ["routine", t("Рутина", "Routine")], ["automation", t("Автоматизация", "Automation")]]
      .map(([tab, name]) => `<button type="button" data-screen-action="tab" data-tab="${tab}" aria-pressed="${this.tab === tab}">${name}</button>`).join("")}</nav>`;
    const body = this.tab === "routine" ? buildRoutineFields(this.draft.routines ?? [], definition, this.descriptor.type, getEventCatalog(context.scene))
      : this.tab === "automation" ? this.automationFields(context)
      : this.tab === "features" ? this.featureFields(context) : section(t("При входе", "On location entry"), `<p class="ms-note">${t("Выполняется при первом явном запуске схемы. Переподключение не повторяет вход.", "Applied on the scheme's first explicit start. Reconnecting does not repeat entry.")}</p>${stateFields("entry", this.draft.entry)}`)
      + section(t("Смена эпизодов", "Episode changes"), `<label>${t("Эпизод", "Episode")}<select name="behavior-episode">${definition.episodes.map((item) => `<option value="${e(item.id)}"${selected(this.editEpisodeId, item.id)}>${e(item.name)}</option>`).join("")}</select></label>${stateFields("episode", this.draft.episodes?.[this.editEpisodeId])}`);
    return { body: layout(`${this.draft.playerCharacter ? `<p class="ms-note">${t("Персонаж игрока: автоматизация этого объекта отключена.", "Player character: automation for this object is disabled.")}</p>` : ""}${body}`, navigation) };
  }
  featureFields({ definition, catalog, scene }) {
    const attachment = (kind, title, assets) => {
      const binding = this.draft[kind], policy = binding?.trigger ?? normalizeTrigger({ repeat: "always" });
      return section(title, `<label>${e(title)}<select name="${kind}-asset">${options(assets, binding?.[`${kind}Id`], t("Не добавлен", "Not attached"))}</select></label>
        ${input(`${kind}-range`, t("Дальность", "Range"), binding?.range ?? 5, 'type="number" min="0" step="any"')}
        ${binding ? buildTriggerFields({ ...policy, episodeIds: binding.episodeIds ?? policy.episodeIds }, definition.episodes, { prefix: `${kind}-gate`, schemeId: definition.schemeId, schemeName: definition.schemeName }) : ""}
        <button type="button" data-screen-action="open-asset" data-kind="${kind}">${t("Открыть в каталоге", "Open in catalog")}</button>`);
    };
    return attachment("shop", t("Магазин", "Shop"), catalog.shops) + attachment("dialogue", t("Диалог", "Dialogue"), catalog.dialogues);
  }
  automationFields({ definition, scene }) {
    const events = getEventCatalog(scene), eventOptions = events.events.map((item) => ({ id: item.name, name: item.name }));
    const macros = events.macros.map((item) => ({ id: item.uuid, name: game.macros?.get?.(item.uuid.split(".").at(-1))?.name ?? item.name ?? item.uuid }));
    const features = (this.draft.features ?? []).filter((feature) => feature.kind !== "patrol").map((feature) => {
      const fieldPrefix = `feature-${feature.id}`;
      const details = `<label>${t("При событии", "On event")}<select name="${fieldPrefix}-event">${options(eventOptions, feature.eventName)}</select></label>`
          + (feature.kind === "macro" ? `<label>${t("Макрос", "Macro")}<select name="${fieldPrefix}-macro">${options(macros, feature.macroUuid)}</select></label>` : `<label>${t("Вызвать триггер", "Invoke trigger")}<select name="${fieldPrefix}-trigger">${options(events.triggers, feature.triggerId)}</select></label><label>${t("Параметры триггера (JSON)", "Trigger parameters (JSON)")}<textarea name="${fieldPrefix}-parameters">${e(JSON.stringify(feature.parameters ?? {}, null, 2))}</textarea></label>`);
      return `<tr data-object-feature="${e(feature.id)}"><td>${feature.kind === "macro" ? t("Макрос", "Macro") : t("Триггер", "Trigger")}
        <label class="ms-check"><input type="checkbox" name="${fieldPrefix}-enabled"${feature.enabled !== false ? " checked" : ""}>${t("Включён", "Enabled")}</label></td><td>${details}<div>${definition.episodes.map((episode) => `<label class="ms-check"><input type="checkbox" name="${fieldPrefix}-episode" value="${e(episode.id)}"${feature.episodeIds?.includes(episode.id) ? " checked" : ""}>${e(episode.name)}</label>`).join("")}</div><small>${t("Пустой список эпизодов — во всех эпизодах схемы.", "No episodes selected means all episodes in the scheme.")}</small></td><td><button type="button" data-screen-action="remove-feature" data-id="${e(feature.id)}">${t("Удалить", "Remove")}</button></td></tr>`;
    }).join("");
    return `<table class="ms-automation-table"><thead><tr><th>${t("Действие", "Action")}</th><th>${t("Настройки", "Settings")}</th><th></th></tr></thead><tbody>${features}</tbody></table>`
      + `<div class="ms-object-row"><button type="button" data-screen-action="add-feature" data-kind="macro">+ ${t("Макрос", "Macro")}</button><button type="button" data-screen-action="add-feature" data-kind="trigger">+ ${t("Триггер", "Trigger")}</button></div>`;
  }
  capture() {
    if (!this.context().definition) return;
    const root = this.element;
    if (this.tab === "transitions") {
      this.draft.entry = readState(root, "entry"); this.draft.episodes ??= {};
      this.draft.episodes[this.editEpisodeId] = { ...this.draft.episodes[this.editEpisodeId], ...readState(root, "episode") }; return;
    }
    if (this.tab === "routine") { this.draft.routines = readRoutineFields(root, this.draft.routines ?? []); return; }
    if (this.tab === "features") {
      for (const kind of ["shop", "dialogue"]) {
        const id = value(root, `${kind}-asset`), previous = this.draft[kind];
        const trigger = root.querySelector(`[name="${kind}-gate-enabled"]`) ? readTriggerFields(root, `${kind}-gate`) : previous?.trigger ?? normalizeTrigger({ repeat: "always" });
        this.draft[kind] = id ? { ...previous, [`${kind}Id`]: id, episodeIds: trigger.episodeIds, range: Number(value(root, `${kind}-range`)), trigger } : null;
      }
      return;
    }
    this.draft.features = (this.draft.features ?? []).map((feature) => {
      if (feature.kind === "patrol") return feature;
      const prefix = `feature-${feature.id}`, next = { ...feature,
        enabled: root.querySelector(`[name="${prefix}-enabled"]`)?.checked === true,
        episodeIds: [...root.querySelectorAll(`[name="${prefix}-episode"]:checked`)].map((item) => item.value) };
      next.eventName = value(root, `${prefix}-event`);
      if (feature.kind === "macro") next.macroUuid = value(root, `${prefix}-macro`);
      else { next.triggerId = value(root, `${prefix}-trigger`); next.parameters = JSON.parse(value(root, `${prefix}-parameters`) || "{}"); }
      return next;
    });
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("change", (event) => {
      if (event.target.matches("[data-routine-definition]")) {
        try {
          this.capture();
          const step = this.draft.routines[Number(event.target.dataset.index)].steps[Number(event.target.dataset.step)], catalog = getEventCatalog(this.context().scene);
          if (step.kind === "macro") step.parameters.macroUuid = event.target.value;
          else {
            const trigger = catalog.triggers.find((item) => item.id === event.target.value), targetEvent = catalog.events.find((item) => item.id === trigger?.eventId);
            if (trigger && targetEvent) step.parameters = { eventName: targetEvent.name, triggerId: trigger.id,
              parameters: Object.fromEntries(trigger.parameters.map((parameter) => [parameter.name, parameter.type === "boolean" ? false : parameter.type === "string" ? "".padEnd(parameter.minLength ?? 0, " ") : Math.min(parameter.max ?? Infinity, Math.max(0, parameter.min ?? 0))])) };
          }
          this.dirty = true; void this.render({ force: true });
        } catch (error) { notifyError(error); }
        return;
      }
      if (event.target.matches("[data-routine-kind]")) {
        try {
          this.capture();
          const routine = this.draft.routines[Number(event.target.dataset.index)], step = routine.steps[Number(event.target.dataset.step)];
          step.parameters = routineStepTemplate(step.kind).parameters; this.dirty = true; void this.render({ force: true });
        } catch (error) { notifyError(error); }
        return;
      }
      if (event.target.name?.match(/^routine-\d+-episode$/)) {
        try { this.capture(); void this.render({ force: true }); } catch (error) { notifyError(error); }
        return;
      }
      if (!["behavior-episode", "shop-asset", "dialogue-asset"].includes(event.target.name)) return;
      try { this.capture(); if (event.target.name === "behavior-episode") this.editEpisodeId = event.target.value; void this.render({ force: true }); }
      catch (error) { notifyError(error); }
    }, { signal: this.events.signal });
  }
  async handleAction(action, button) {
    if (action === "information") return this.controller.openObjectInfo(this.descriptor);
    if (["add-routine", "remove-routine", "clear-routine", "convert-routine", "add-routine-step", "remove-routine-step", "routine-point"].includes(action)) {
      this.capture();
      this.draft.routines ??= [];
      const routines = this.draft.routines, index = Number(button.dataset.index), routine = routines[index], stepIndex = Number(button.dataset.step);
      if (action === "add-routine") {
        const episode = this.context().definition.episodes.find((episode) => !routines.some((item) => item.episodeId === episode.id));
        if (episode) routines.push({ episodeId: episode.id, repeat: false, steps: [] });
      }
      if (action === "remove-routine") routines.splice(index, 1);
      if (action === "clear-routine") routines[index] = { episodeId: routine.episodeId, repeat: false, steps: [] };
      if (action === "convert-routine") {
        const conditional = routine.legacyPatrol?.points?.some((point) => point.macroUuid || point.onTrue || point.eventName);
        if (conditional && !await foundry.applications.api.DialogV2.confirm({ window: { title: t("Преобразовать патруль", "Convert patrol") },
          content: `<p>${t("Таблица сохранит маршрут. Условные проверки прежних точек не переносятся; исходные настройки останутся в техдолге. Продолжить?", "The table preserves the route. Former waypoint conditions are not transferred; the original setup remains in legacy behavior. Continue?")}</p>`, rejectClose: false })) return;
        delete routine.legacy; delete routine.legacyPatrol;
      }
      if (action === "add-routine-step") appendRoutineStep(routine);
      if (action === "remove-routine-step") removeRoutineStep(routine, stepIndex);
      if (action === "routine-point") {
        const point = await this.controller.pickPoint();
        if (point) Object.assign(routine.steps[stepIndex].parameters, { x: point.x, y: point.y });
      }
      this.dirty = true; return this.render({ force: true });
    }
    if (action === "restore-position") {
      this.assertCurrentScene(); this.capture();
      if (!game.user?.isGM) throw new Error(t("Требуются права мастера.", "GM permission is required."));
      const position = this.draft.entry.position, document = this.context().document;
      if (!position || !Number.isFinite(document.x) || !Number.isFinite(document.y)) throw new Error(t("Сначала укажите координаты X и Y.", "Specify X and Y coordinates first."));
      // An explicit GM action moves this document only; it does not start a scheme or save preparation.
      await document.update({ x: position.x, y: position.y }); return;
    }
    if (["tab", "add-feature", "remove-feature", "open-asset", "capture-position"].includes(action)) {
      this.capture();
      if (action === "tab") this.tab = button.dataset.tab;
      if (action === "add-feature") { this.draft.features ??= []; this.draft.features.push({ id: randomId(), kind: button.dataset.kind, enabled: true, episodeIds: [], eventName: "", parameters: {} }); this.dirty = true; }
      if (action === "remove-feature") { this.draft.features = this.draft.features.filter((item) => item.id !== button.dataset.id); this.dirty = true; }
      if (action === "capture-position") {
        const document = this.context().document;
        if (!Number.isFinite(document.x) || !Number.isFinite(document.y)) throw new Error(t("У объекта нет координат X/Y.", "This object has no X/Y position."));
        const destination = button.dataset.prefix === "entry" ? this.draft.entry : this.draft.episodes[this.editEpisodeId];
        destination.position = { x: document.x, y: document.y }; destination.hidden = typeof document.hidden === "boolean" ? document.hidden : null; this.dirty = true;
      }
      if (action === "open-asset") return this.controller.openAsset(button.dataset.kind, this.draft[button.dataset.kind]?.[`${button.dataset.kind}Id`]);
      return this.render({ force: true });
    }
    return super.handleAction(action, button);
  }
}
