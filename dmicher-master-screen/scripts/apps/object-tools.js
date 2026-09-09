import { ScreenFormApplication } from "./editor.js";
import { themedClasses, notifyError } from "../ui.js";
import { generics } from "../generics.js";
import { currentScene, getDefinitions, getObjectTags } from "../store.js";
import { SceneObjects, getObjectBindings, getSceneObject } from "../scene-objects.js";
import { getInteractionCatalog } from "../scene-assets.js";
import { getEventCatalog } from "../event-catalog.js";
import { randomId, normalizeTrigger } from "../model.js";
import { buildTriggerFields, readTriggerFields, splitTags } from "./trigger-fields.js";

const t = (ru, en) => game.i18n?.lang?.startsWith("ru") ? ru : en;
const e = (value) => generics.utilities.escapeHTML(String(value ?? ""));
const clone = (value) => structuredClone(value);
const value = (root, name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
const selected = (actual, expected) => actual === expected ? " selected" : "";
const input = (name, label, text = "", attributes = "") => `<label>${e(label)}<input name="${name}" value="${e(text)}" ${attributes}></label>`;
const options = (items, current, placeholder = t("Не выбрано", "Not selected")) => `<option value="">${e(placeholder)}</option>${items.map((item) => `<option value="${e(item.id)}"${selected(current, item.id)}>${e(item.name)}</option>`).join("")}`;
const footer = () => `<footer><button type="button" data-screen-action="cancel">${t("Закрыть", "Close")}</button><button type="button" data-screen-action="save">${t("Сохранить", "Save")}</button></footer>`;
const section = (title, body) => `<section class="ms-object-feature"><h3>${e(title)}</h3>${body}</section>`;

/** Edits are pinned to one scene and revision; merely opening a native object writes nothing. */
class ObjectForm extends ScreenFormApplication {
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/object-tools.hbs", scrollable: [".ms-object-form"] } };
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
        tags: getObjectTags(scene, this.descriptor), notes: "", shop: null, dialogue: null, entry: { position: null, hidden: null }, episodes: {}, features: [] });
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
  async persist() {
    this.assertCurrentScene();
    const scene = this.context().scene;
    // Only edited fields constitute a command. Merely inspecting legacy behavior must
    // not flatten its per-episode shop/dialogue variants into one new attachment.
    const patch = Object.fromEntries(["schemeId", "tags", "notes", "entry", "episodes", "shop", "dialogue", "features"]
      .filter((key) => JSON.stringify(this.draft[key]) !== JSON.stringify(this.original[key]))
      .map((key) => [key, clone(this.draft[key])]));
    if (Object.keys(patch).length) await new SceneObjects(scene).save(this.descriptor, patch, { expectedRevision: this.revision, allowReassign: true });
    this.draft = null; this.dirty = false; this.controller.changed(scene); await this.render({ force: true });
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
    return { body: `<dl class="ms-object-metadata">${facts.map(([label, text]) => `<dt>${e(label)}</dt><dd>${e(text)}</dd>`).join("")}</dl>
      <label>${t("Схема", "Scheme")}<select name="object-scheme">${options(definitions.map((item) => ({ id: item.schemeId, name: item.schemeName })), this.draft.schemeId, t("Без схемы", "Unassigned"))}</select></label>
      <p class="ms-note">${t("Объект управляется одной схемой. Перед сменой остановите затронутые схемы. Переназначение очищает прежние магазины, диалоги, особенности и размещение по эпизодам; теги и заметки сохраняются. «Без схемы» отключает особенности.", "One scheme controls this object. Stop the affected schemes before reassigning. Reassignment clears former shop/dialogue attachments, features and episode placement; tags and notes remain. Unassigned disables features.")}</p>
      ${input("object-tags", t("Теги, через запятую", "Tags, comma separated"), this.draft.tags?.join(", ") ?? "")}
      <label>${t("Заметки мастера", "GM notes")}<textarea name="object-notes" maxlength="8000">${e(this.draft.notes)}</textarea></label>${footer()}` };
  }
  capture() {
    this.draft = { ...this.draft, schemeId: value(this.element, "object-scheme") || null,
      tags: splitTags(value(this.element, "object-tags")), notes: value(this.element, "object-notes") };
  }
}

const stateFields = (prefix, state = {}) => `<div class="ms-object-row">${input(`${prefix}-x`, "X", state.position?.x ?? "", 'type="number" step="any"')}${input(`${prefix}-y`, "Y", state.position?.y ?? "", 'type="number" step="any"')}
  <label>${t("Видимость", "Visibility")}<select name="${prefix}-hidden"><option value="">${t("Как есть", "Keep current")}</option><option value="false"${state.hidden === false ? " selected" : ""}>${t("Показать", "Show")}</option><option value="true"${state.hidden === true ? " selected" : ""}>${t("Скрыть", "Hide")}</option></select></label></div>
  <button type="button" data-screen-action="capture-position" data-prefix="${prefix}">${t("Взять текущее положение", "Capture current position")}</button>`;
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
    const navigation = `<nav class="ms-object-tabs"><button type="button" data-screen-action="tab" data-tab="transitions" aria-pressed="${this.tab === "transitions"}">${t("Переходы", "Transitions")}</button><button type="button" data-screen-action="tab" data-tab="features" aria-pressed="${this.tab === "features"}">${t("Особенности", "Features")}</button></nav>`;
    const body = this.tab === "features" ? this.featureFields(context) : section(t("При входе", "On location entry"), `<p class="ms-note">${t("Выполняется при первом явном запуске схемы. Переподключение не повторяет вход.", "Applied on the scheme's first explicit start. Reconnecting does not repeat entry.")}</p>${stateFields("entry", this.draft.entry)}`)
      + section(t("Смена эпизодов", "Episode changes"), `<label>${t("Эпизод", "Episode")}<select name="behavior-episode">${definition.episodes.map((item) => `<option value="${e(item.id)}"${selected(this.editEpisodeId, item.id)}>${e(item.name)}</option>`).join("")}</select></label>${stateFields("episode", this.draft.episodes?.[this.editEpisodeId])}`);
    return { body: navigation + body + footer() };
  }
  featureFields({ definition, catalog, scene }) {
    const attachment = (kind, title, assets) => {
      const binding = this.draft[kind], policy = binding?.trigger ?? normalizeTrigger({ repeat: "always" });
      return section(title, `<label>${e(title)}<select name="${kind}-asset">${options(assets, binding?.[`${kind}Id`], t("Не добавлен", "Not attached"))}</select></label>
        ${input(`${kind}-range`, t("Дальность", "Range"), binding?.range ?? 5, 'type="number" min="0" step="any"')}
        ${binding ? buildTriggerFields({ ...policy, episodeIds: binding.episodeIds ?? policy.episodeIds }, definition.episodes, { prefix: `${kind}-gate`, schemeId: definition.schemeId, schemeName: definition.schemeName }) : ""}
        <button type="button" data-screen-action="open-asset" data-kind="${kind}">${t("Открыть в каталоге", "Open in catalog")}</button>`);
    };
    const events = getEventCatalog(scene), eventOptions = events.events.map((item) => ({ id: item.name, name: item.name }));
    const macros = events.macros.map((item) => ({ id: item.uuid, name: game.macros?.get?.(item.uuid.split(".").at(-1))?.name ?? item.name ?? item.uuid }));
    const features = (this.draft.features ?? []).map((feature) => {
      const fieldPrefix = `feature-${feature.id}`;
      const details = feature.kind === "patrol" ? `${input(`${fieldPrefix}-speed`, t("Скорость, ед./с", "Speed, units/s"), feature.patrol?.speed ?? 5, 'type="number" min="0.01" step="any"')}
        <label>${t("Опорные точки: X, Y на каждой строке", "Waypoints: X, Y on each line")}<textarea name="${fieldPrefix}-points">${e((feature.patrol?.points ?? []).map((point) => `${point.x}, ${point.y}`).join("\n"))}</textarea></label><button type="button" data-screen-action="pick-point" data-id="${e(feature.id)}">${t("Добавить точку с карты", "Add map waypoint")}</button>`
        : `<label>${t("При событии", "On event")}<select name="${fieldPrefix}-event">${options(eventOptions, feature.eventName)}</select></label>`
          + (feature.kind === "macro" ? `<label>${t("Макрос", "Macro")}<select name="${fieldPrefix}-macro">${options(macros, feature.macroUuid)}</select></label>` : `<label>${t("Вызвать триггер", "Invoke trigger")}<select name="${fieldPrefix}-trigger">${options(events.triggers, feature.triggerId)}</select></label><label>${t("Параметры триггера (JSON)", "Trigger parameters (JSON)")}<textarea name="${fieldPrefix}-parameters">${e(JSON.stringify(feature.parameters ?? {}, null, 2))}</textarea></label>`);
      return section(feature.kind === "patrol" ? t("Патрулирование", "Patrol") : feature.kind === "macro" ? t("Макрос по событию", "Event macro") : t("Триггер по событию", "Event trigger"), `<div data-object-feature="${e(feature.id)}">${details}<div>${definition.episodes.map((episode) => `<label class="ms-check"><input type="checkbox" name="${fieldPrefix}-episode" value="${e(episode.id)}"${feature.episodeIds?.includes(episode.id) ? " checked" : ""}>${e(episode.name)}</label>`).join("")}</div><small>${t("Пустой список эпизодов — во всех эпизодах схемы.", "No episodes selected means all episodes in the scheme.")}</small><button type="button" data-screen-action="remove-feature" data-id="${e(feature.id)}">${t("Удалить особенность", "Remove feature")}</button></div>`);
    }).join("");
    return attachment("shop", t("Магазин", "Shop"), catalog.shops) + attachment("dialogue", t("Диалог", "Dialogue"), catalog.dialogues) + features
      + `<div class="ms-object-row">${this.descriptor.type === "Token" ? `<button type="button" data-screen-action="add-feature" data-kind="patrol">+ ${t("Патруль", "Patrol")}</button>` : ""}<button type="button" data-screen-action="add-feature" data-kind="macro">+ ${t("Макрос", "Macro")}</button><button type="button" data-screen-action="add-feature" data-kind="trigger">+ ${t("Триггер", "Trigger")}</button></div>`;
  }
  capture() {
    if (!this.context().definition) return;
    const root = this.element;
    if (this.tab === "transitions") {
      this.draft.entry = readState(root, "entry"); this.draft.episodes ??= {};
      this.draft.episodes[this.editEpisodeId] = { ...this.draft.episodes[this.editEpisodeId], ...readState(root, "episode") }; return;
    }
    for (const kind of ["shop", "dialogue"]) {
      const id = value(root, `${kind}-asset`), previous = this.draft[kind];
      const trigger = root.querySelector(`[name="${kind}-gate-enabled"]`) ? readTriggerFields(root, `${kind}-gate`) : previous?.trigger ?? normalizeTrigger({ repeat: "always" });
      this.draft[kind] = id ? { ...previous, [`${kind}Id`]: id, episodeIds: trigger.episodeIds, range: Number(value(root, `${kind}-range`)), trigger } : null;
    }
    this.draft.features = (this.draft.features ?? []).map((feature) => {
      const prefix = `feature-${feature.id}`, next = { ...feature,
        episodeIds: [...root.querySelectorAll(`[name="${prefix}-episode"]:checked`)].map((item) => item.value) };
      if (feature.kind === "patrol") {
        const points = value(root, `${prefix}-points`).split("\n").filter((line) => line.trim()).map((line, index) => {
          const coordinates = line.split(",").map((part) => part.trim());
          if (coordinates.length !== 2 || coordinates.some((part) => part === "" || !Number.isFinite(Number(part)))) throw new Error(t("Каждая точка задаётся двумя числами X, Y.", "Each waypoint must contain two numbers: X, Y."));
          // This compact editor changes waypoint coordinates; existing checkpoint
          // actions belong to their numbered waypoint and must survive the edit.
          return { ...feature.patrol?.points?.[index], x: Number(coordinates[0]), y: Number(coordinates[1]) };
        });
        next.patrol = { enabled: true, speed: Number(value(root, `${prefix}-speed`)), points };
      } else {
        next.eventName = value(root, `${prefix}-event`);
        if (feature.kind === "macro") next.macroUuid = value(root, `${prefix}-macro`);
        else { next.triggerId = value(root, `${prefix}-trigger`); next.parameters = JSON.parse(value(root, `${prefix}-parameters`) || "{}"); }
      }
      return next;
    });
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.addEventListener("change", (event) => {
      if (!["behavior-episode", "shop-asset", "dialogue-asset"].includes(event.target.name)) return;
      try { this.capture(); if (event.target.name === "behavior-episode") this.editEpisodeId = event.target.value; void this.render({ force: true }); }
      catch (error) { notifyError(error); }
    }, { signal: this.events.signal });
  }
  async handleAction(action, button) {
    if (action === "information") return this.controller.openObjectInfo(this.descriptor);
    if (["tab", "add-feature", "remove-feature", "pick-point", "open-asset", "capture-position"].includes(action)) {
      this.capture();
      if (action === "tab") this.tab = button.dataset.tab;
      if (action === "add-feature") { this.draft.features ??= []; this.draft.features.push({ id: randomId(), kind: button.dataset.kind, enabled: true, episodeIds: [], eventName: "", parameters: {}, patrol: { enabled: true, speed: 5, points: [] } }); this.dirty = true; }
      if (action === "remove-feature") { this.draft.features = this.draft.features.filter((item) => item.id !== button.dataset.id); this.dirty = true; }
      if (action === "pick-point") { const point = await this.controller.pickPoint(); if (point) { this.draft.features.find((item) => item.id === button.dataset.id).patrol.points.push(point); this.dirty = true; } }
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
