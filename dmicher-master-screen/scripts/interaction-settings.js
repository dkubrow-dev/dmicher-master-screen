import { MODULE_ID } from "./model.js";
import { text as t } from "./localization.js";
import { themedClasses } from "./ui.js";
import { ScreenFormApplication } from "./apps/screen-form.js";
import { escapeHTML as e, selectOptions } from "./apps/form-fields.js";
import { captureHighlightChord, highlightChordLabel } from "./interaction-keybinding.js";
import { INTERACTIVE_TYPES, INTERACTION_WORLD_SETTING, INTERACTION_PLAYER_SETTING, defaultInteractionSettings,
  normalizeInteractionSettings, normalizePlayerInteractionSettings } from "./interaction-settings-model.js";
import { isInteractivePresentationAvailable, subscribeInteractivePresentationAccess } from "./premium-provider.js";
import { getInteractionSettings, getPlayerInteractionSettings, interactionSettingsChanged as changed } from "./interaction-settings-store.js";
export function registerInteractionSettings() {
  game.settings.register(MODULE_ID, INTERACTION_WORLD_SETTING, { scope: "world", config: false, type: Object, default: defaultInteractionSettings(), onChange: changed });
  game.settings.register(MODULE_ID, INTERACTION_PLAYER_SETTING, { scope: "client", config: false, type: Object, default: { activation: null, keys: null }, onChange: changed });
  game.settings.registerMenu(MODULE_ID, "masterInteractionSettings", { name: t("Настройки мастера", "GM settings"), label: t("Настройки мастера", "GM settings"),
    hint: t("Обозначение интерактивных объектов для игроков.", "Interactive-object presentation for players."), icon: "fa-solid fa-sliders", type: MasterInteractionSettings, restricted: true });
  game.settings.registerMenu(MODULE_ID, "playerInteractionSettings", { name: t("Настройки игрока", "Player settings"), label: t("Настройки игрока", "Player settings"),
    hint: t("Личная активация подсветки интерактивных объектов.", "Your interactive-object highlighting shortcut."), icon: "fa-solid fa-user-gear", type: PlayerInteractionSettings, restricted: false });
}
export function interactiveTypeName(type) {
  const names = { Token: t("Токены", "Tokens"), Tile: t("Тайлы", "Tiles"), Drawing: t("Рисование", "Drawings"), Wall: t("Стены", "Walls"),
    AmbientLight: t("Освещение", "Lighting"), AmbientSound: t("Звук", "Sounds"), Region: t("Регионы", "Regions"), Note: t("Заметки", "Notes") };
  return names[type] ?? type;
}
const badge = '<span class="dmicher-premium-badge">Premium</span>';
const check = (name, checked, label = "") => `<label class="ms-setting-check"><input type="checkbox" name="${name}"${checked ? " checked" : ""}>${e(label)}</label>`;
const number = (name, value, min, max) => `<input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="any" required>`;
const options = (items, selected) => selectOptions(items.map(([id, name]) => ({ id, name })), selected);
const activation = selected => `<label>${e(t("Активация", "Activation"))}<select name="interaction-activation">${options([["keys", t("Комбинация клавиш", "Keyboard shortcut")], ["always", t("Всегда активна", "Always on")]], selected)}</select></label>`;
const shortcut = keys => `<div class="ms-setting-shortcut" data-highlight-shortcut><input name="interaction-shortcut" readonly value="${e(highlightChordLabel(keys))}" aria-label="${e(t("Текущая комбинация", "Current shortcut"))}"><button type="button" data-screen-action="shortcut" title="${e(t("Изменить комбинацию", "Change shortcut"))}" aria-label="${e(t("Изменить комбинацию", "Change shortcut"))}">⚙</button></div>`;
const colorInput = (name, value) => `<span class="ms-setting-color"><input type="color" data-color-for="${name}" value="${value}" aria-label="${e(t("Выбрать цвет", "Pick color"))}"><input name="${name}" value="${value}" pattern="#[a-fA-F0-9]{6}" maxlength="7" required></span>`;

class InteractionSettings extends ScreenFormApplication {
  static DEFAULT_OPTIONS = { classes: themedClasses("ms-interaction-settings"), position: { width: 690, height: 620 }, window: { resizable: true }, tag: "form" };
  static PARTS = { main: { template: "modules/dmicher-master-screen/templates/interaction-settings.hbs", scrollable: [".ms-settings-scroll"] } };
  constructor(options = {}) { super(options); this.draft = null; this.unsubscribe = subscribeInteractivePresentationAccess(() => this.syncAvailability()); }
  async _onRender(context, options) {
    await super._onRender(context, options); const events = this.bindEvents();
    this.element.addEventListener("change", event => {
      if (event.target.dataset.colorFor) this.element.querySelector(`[name="${event.target.dataset.colorFor}"]`).value = event.target.value.toUpperCase();
      if (event.target.name?.endsWith("-color") && /^#[a-f0-9]{6}$/i.test(event.target.value)) {
        const picker = this.element.querySelector(`[data-color-for="${event.target.name}"]`); if (picker) picker.value = event.target.value;
      }
      if (event.target.name === "interaction-activation") this.syncShortcut();
    }, events);
    this.element.addEventListener("submit", event => { event.preventDefault(); if (this.element.reportValidity()) void this.runAction("save"); }, events);
    this.syncAvailability();
  }
  syncShortcut() {
    const shortcut = this.element?.querySelector("[data-highlight-shortcut]"), activation = this.element?.querySelector('[name="interaction-activation"]');
    if (shortcut) shortcut.hidden = activation?.value !== "keys";
  }
  syncAvailability() {
    if (!this.element) return;
    for (const fieldset of this.element.querySelectorAll("fieldset")) fieldset.disabled = !this.available();
    const save = this.element.querySelector('[data-screen-action="save"]'); if (save) save.disabled = !this.available();
    this.syncShortcut();
  }
  async handleAction(action) {
    if (action === "close") return this.close();
    if (!this.available()) return;
    if (action === "shortcut") {
      this.readDraft(); const keys = await captureHighlightChord(this.element.ownerDocument);
      if (!keys || !this.available() || !this.rendered) return;
      this.draft.keys = keys;
      this.element.querySelector('[name="interaction-shortcut"]').value = highlightChordLabel(keys); this.dirty = true; return;
    }
    if (action === "save" && this.element.reportValidity()) { this.readDraft(); await this.saveDraft(); this.dirty = false; return this.close(); }
  }
  async _onClose(options) { this.unsubscribe?.(); this.unsubscribe = null; return super._onClose(options); }
}

export class MasterInteractionSettings extends InteractionSettings {
  get title() { return t("Ширма · Настройки мастера", "Master screen · GM settings"); }
  available() { return game.user?.isGM === true && isInteractivePresentationAvailable(); }
  async _prepareContext() {
    const config = getInteractionSettings();
    if (!this.draft) this.draft = { ...config, keys: config.highlight.keys };
    const d = this.draft;
    const frames = INTERACTIVE_TYPES.map(type => { const f = d.highlight.frames[type]; return `<tr><th>${e(interactiveTypeName(type))}</th><td>${check(`frame-${type}-enabled`, f.enabled)}</td><td>${colorInput(`frame-${type}-color`, f.color)}</td><td>${number(`frame-${type}-size`, f.size, 0.5, 30)}</td></tr>`; }).join("");
    const icons = INTERACTIVE_TYPES.map(type => { const i = d.icons.types[type]; return `<tr><th>${e(interactiveTypeName(type))}</th><td>${check(`icon-${type}-enabled`, i.enabled)}</td><td><input name="icon-${type}-symbol" value="${e(i.symbol)}" class="ms-setting-symbol" required></td><td>${colorInput(`icon-${type}-color`, i.color)}</td><td>${colorInput(`icon-${type}-background`, i.background)}</td><td>${number(`icon-${type}-size`, i.size, 8, 96)}</td><td><select name="icon-${type}-horizontal">${options([["left", t("Слева", "Left")], ["center", t("По центру", "Center")], ["right", t("Справа", "Right")]], i.horizontal)}</select><select name="icon-${type}-vertical">${options([["top", t("Сверху", "Top")], ["center", t("По центру", "Center")], ["bottom", t("Снизу", "Bottom")]], i.vertical)}</select></td></tr>`; }).join("");
    return { body: `<h2>${e(t("Интерактивные объекты", "Interactive objects"))} ${badge}</h2><fieldset><legend>${e(t("Подсветка", "Highlighting"))} ${badge}</legend>${check("interaction-highlight-enabled", d.highlight.enabled, t("Включена", "Enabled"))}<div class="ms-setting-activation">${activation(d.highlight.activation)}${shortcut(d.keys)}</div><h4>${e(t("Рамки", "Outlines"))}</h4><table><thead><tr><th>${e(t("Тип", "Type"))}</th><th>${e(t("Подсветка", "Highlight"))}</th><th>${e(t("Цвет", "Color"))}</th><th>${e(t("Размер, пикс.", "Size, px"))}</th></tr></thead><tbody>${frames}</tbody></table></fieldset><fieldset><legend>${e(t("Иконки", "Icons"))} ${badge}</legend>${check("interaction-icons-enabled", d.icons.enabled, t("Включена", "Enabled"))}<div class="ms-setting-table-scroll"><table><thead><tr><th>${e(t("Тип", "Type"))}</th><th>${e(t("Показ", "Show"))}</th><th>${e(t("Символ", "Symbol"))}</th><th>${e(t("Цвет", "Color"))}</th><th>${e(t("Фон", "Background"))}</th><th>${e(t("Размер", "Size"))}</th><th>${e(t("Выравнивание", "Alignment"))}</th></tr></thead><tbody>${icons}</tbody></table></div></fieldset>` };
  }
  readDraft() {
    const form = this.element, value = name => form.querySelector(`[name="${name}"]`).value, checked = name => form.querySelector(`[name="${name}"]`).checked;
    const d = this.draft; d.highlight.enabled = checked("interaction-highlight-enabled"); d.highlight.activation = value("interaction-activation"); d.icons.enabled = checked("interaction-icons-enabled");
    for (const type of INTERACTIVE_TYPES) {
      d.highlight.frames[type] = { enabled: checked(`frame-${type}-enabled`), color: value(`frame-${type}-color`), size: Number(value(`frame-${type}-size`)) };
      d.icons.types[type] = { enabled: checked(`icon-${type}-enabled`), symbol: value(`icon-${type}-symbol`), color: value(`icon-${type}-color`), background: value(`icon-${type}-background`), size: Number(value(`icon-${type}-size`)), horizontal: value(`icon-${type}-horizontal`), vertical: value(`icon-${type}-vertical`) };
    }
  }
  saveDraft() { return game.settings.set(MODULE_ID, INTERACTION_WORLD_SETTING, normalizeInteractionSettings({ ...this.draft, highlight: { ...this.draft.highlight, keys: this.draft.keys } })); }
}

export class PlayerInteractionSettings extends InteractionSettings {
  static DEFAULT_OPTIONS = { position: { width: 540, height: "auto" } };
  get title() { return t("Ширма · Настройки игрока", "Master screen · Player settings"); }
  available() { return isInteractivePresentationAvailable() && getInteractionSettings().highlight.enabled; }
  async _prepareContext() {
    const world = getInteractionSettings(), personal = getPlayerInteractionSettings();
    if (!this.draft) this.draft = { activation: personal.activation ?? world.highlight.activation, keys: personal.keys ?? world.highlight.keys };
    return { body: `<h2>${e(t("Интерактивные объекты", "Interactive objects"))} ${badge}</h2><p>${e(t("Личная настройка работает, если мастер включил подсветку. Обозначаются только видимые вам интерактивные объекты.", "Your preferences apply when the GM enables highlighting. Only interactive objects visible to you are marked."))}</p><fieldset><legend>${e(t("Подсветка", "Highlighting"))} ${badge}</legend><div class="ms-setting-activation">${activation(this.draft.activation)}${shortcut(this.draft.keys)}</div></fieldset>` };
  }
  readDraft() { this.draft.activation = this.element.querySelector('[name="interaction-activation"]').value; }
  saveDraft() { return game.settings.set(MODULE_ID, INTERACTION_PLAYER_SETTING, normalizePlayerInteractionSettings(this.draft)); }
}
