import { MODULE_ID } from "./model.js";
import { text } from "./localization.js";
import { isDialogueAudioAvailable, subscribeDialogueAudioAccess } from "./premium-provider.js";

export const DIALOGUE_VOLUME_SETTING = "dialogueVolume";
const listeners = new Set();
const clamp = (value) => Number.isFinite(Number(value)) ? Math.min(1, Math.max(0, Number(value))) : 1;
const label = () => text("Диалоги", "Dialogues");
const hint = () => text("Громкость озвучки диалогов для вас. Учитывает громкость интерфейса Foundry.", "Dialogue audio volume for you. Also respects Foundry interface volume.");
const helper = () => globalThis.foundry?.audio?.AudioHelper;
const toInput = (value) => helper()?.volumeToInput?.(value) ?? value;
const fromInput = (value) => clamp(helper()?.inputToVolume?.(Number(value)) ?? value);
const percentage = (value) => helper()?.volumeToPercentage?.(Number(value)) ?? `${Math.round(fromInput(value) * 100)}%`;
export const subscribeDialogueVolume = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export function getDialogueVolume() {
  try { return clamp(globalThis.game?.settings?.get(MODULE_ID, DIALOGUE_VOLUME_SETTING) ?? 1); }
  catch { return 1; }
}

export function registerDialogueVolume() {
  game.settings.register(MODULE_ID, DIALOGUE_VOLUME_SETTING, {
    name: label(), hint: hint(), scope: "client", config: false, type: Number, default: 1,
    onChange: (value) => { for (const listener of listeners) listener(clamp(value)); }
  });
}

export class DialogueVolumeController {
  constructor() { this.hooks = []; this.roots = new Set(); this.render = this.render.bind(this); }
  install() {
    for (const name of ["renderPlaylistDirectory", "renderPlaylistDirectoryHTML"]) this.hooks.push([name, Hooks.on(name, this.render)]);
    this.unsubscribe = subscribeDialogueAudioAccess(() => {
      for (const root of this.roots) { if (root.isConnected === false) this.roots.delete(root); else this.render(null, root); }
    });
    this.render(globalThis.ui?.playlists);
    return () => this.dispose();
  }
  render(application, html) {
    for (const oldRoot of this.roots) if (oldRoot.isConnected === false) this.roots.delete(oldRoot);
    const element = html ?? application?.element;
    const root = element?.querySelector ? element : element?.[0];
    if (!root) return;
    this.roots.add(root);
    const old = root.querySelector("[data-dmicher-dialogue-volume]");
    if (!isDialogueAudioAvailable()) { old?.remove(); return; }
    const list = root.querySelector("#global-volume .playlist-sounds") ?? root.querySelector(".global-volume .wrapper ol") ?? root.querySelector(".global-volume ol");
    if (!list || old) return;
    list.append(this.createRow());
  }
  createRow() {
    const row = document.createElement("li");
    row.className = "flexrow";
    row.dataset.dmicherDialogueVolume = ""; row.dataset.tooltip = hint();
    const title = document.createElement("label"), icon = document.createElement("i");
    title.textContent = label(); title.setAttribute("for", "dmicher-dialogue-volume-slider");
    icon.className = "volume-icon fa-fw fa-solid fa-volume-low";
    const RangePicker = globalThis.foundry?.applications?.elements?.HTMLRangePickerElement;
    const value = toInput(getDialogueVolume());
    const slider = typeof RangePicker?.create === "function" ? RangePicker.create({
      name: `${MODULE_ID}.${DIALOGUE_VOLUME_SETTING}`, value, min: 0, max: 1, step: 0.05,
      aria: { label: label(), valuetext: percentage(value) }
    }) : document.createElement("input");
    slider.id = "dmicher-dialogue-volume-slider";
    if (slider.tagName?.toLowerCase() === "input") Object.assign(slider, { type: "range", min: "0", max: "1", step: "0.05", value: String(value) });
    const tooltip = () => { slider.dataset.tooltip = percentage(slider.value); slider.setAttribute("aria-valuetext", percentage(slider.value)); };
    slider.setAttribute("aria-label", label()); tooltip();
    slider.addEventListener("input", tooltip);
    slider.addEventListener("change", () => {
      tooltip();
      if (isDialogueAudioAvailable()) void game.settings.set(MODULE_ID, DIALOGUE_VOLUME_SETTING, fromInput(slider.value));
    });
    row.append(title, icon, slider); return row;
  }
  dispose() {
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = []; this.unsubscribe?.();
    for (const root of this.roots) root.querySelector("[data-dmicher-dialogue-volume]")?.remove();
    this.roots.clear();
  }
}
