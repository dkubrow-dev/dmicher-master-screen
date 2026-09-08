import { ConstructorDock } from "./constructor-dock.js";

const STORAGE_KEY = "dmicher-master-screen.ide-layout";
const DEFAULTS = Object.freeze({ vertical: 0.43, horizontal: 0.36, hiddenMain: [], hiddenDetail: [], mainTab: "scene", detailTab: "parameters" });
export const MAIN_TABS = Object.freeze(["scene", "events", "macros", "other"]);
export const DETAIL_TABS = Object.freeze(["parameters", "reference"]);
export const clampRatio = (value) => Math.max(0.2, Math.min(0.8, Number(value) || 0.43));

export function normalizeIDEPreferences(raw = {}) {
  const hidden = (values, tabs) => {
    const result = tabs.filter((tab) => Array.isArray(values) && values.includes(tab));
    return result.length === tabs.length ? result.slice(1) : result;
  };
  const hiddenMain = hidden(raw.hiddenMain, MAIN_TABS), hiddenDetail = hidden(raw.hiddenDetail, DETAIL_TABS);
  return { vertical: clampRatio(raw.vertical), horizontal: clampRatio(raw.horizontal ?? DEFAULTS.horizontal), hiddenMain, hiddenDetail,
    mainTab: MAIN_TABS.includes(raw.mainTab) && !hiddenMain.includes(raw.mainTab) ? raw.mainTab : MAIN_TABS.find((tab) => !hiddenMain.includes(tab)),
    detailTab: DETAIL_TABS.includes(raw.detailTab) && !hiddenDetail.includes(raw.detailTab) ? raw.detailTab : DETAIL_TABS.find((tab) => !hiddenDetail.includes(tab)) };
}

/** One application element moves between two browser documents; no second game session is started. */
export class ScreenLayout {
  constructor({ view = globalThis.window, dock = new ConstructorDock({ view }), onPopupClose = () => {} } = {}) {
    this.view = view; this.dock = dock; this.onPopupClose = onPopupClose;
    this.presentation = "panel"; this.popup = null; this.preferences = normalizeIDEPreferences();
    try { this.preferences = normalizeIDEPreferences(JSON.parse(view.localStorage.getItem(STORAGE_KEY)) ?? {}); } catch { /* Optional local preferences. */ }
  }

  save() { try { this.view.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch { /* Optional local preferences. */ } }

  reservePopup() {
    if (this.popup && !this.popup.closed) { this.popup.focus(); return this.popup; }
    const popup = this.view.open("about:blank", "dmicher-master-screen", "popup,width=1080,height=780,resizable=yes,scrollbars=no");
    if (!popup) throw new Error("Браузер заблокировал окно. Разрешите всплывающие окна для Foundry и повторите «Ширма (окно)».");
    this.popup = popup;
    const doc = popup.document;
    doc.title = "dmicher ▥ Ширма мастера";
    doc.documentElement.lang = this.view.document.documentElement.lang;
    doc.documentElement.className = this.view.document.documentElement.className;
    doc.body.className = this.view.document.body.className;
    const base = doc.createElement("base"); base.href = this.view.document.baseURI; doc.head.append(base);
    for (const source of this.view.document.querySelectorAll('link[rel="stylesheet"], style')) {
      const copy = source.cloneNode(true);
      if (copy.tagName === "LINK") copy.href = source.href;
      doc.head.append(copy);
    }
    const style = doc.createElement("style");
    style.textContent = "html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:block}.ms-screen-popup{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0!important;transform:none!important}.ms-screen-popup>.window-content{height:100%;padding:0}.ms-screen-popup [data-dock-divider]{display:none}";
    doc.head.append(style);
    this.popupClose = () => {
      if (this.popup !== popup || this.closing) return;
      this.returnToMain(); this.popup = null;
      this.onPopupClose();
    };
    popup.addEventListener("pagehide", this.popupClose, { once: true });
    return popup;
  }

  attach(element, presentation = this.presentation) {
    this.element = element;
    return this.setPresentation(presentation);
  }

  setPresentation(presentation) {
    if (!["panel", "window"].includes(presentation)) return;
    const popup = presentation === "window" ? this.reservePopup() : null;
    this.dock.detach();
    this.presentation = presentation;
    if (this.element) {
      if (popup) {
        popup.document.body.append(popup.document.adoptNode(this.element));
        this.element.classList.add("ms-screen-popup");
        this.element.classList.remove("ms-docked-editor");
        this.element.dataset.dmicherDocked = "true";
      } else {
        this.returnToMain(); this.dock.attach(this.element);
      }
      this.element.dataset.presentation = presentation;
      this.element.dataset.dockSide = this.dock.preferences.side;
      this.bind();
    }
    if (!popup && this.popup) { this.closing = true; this.popup.close(); this.popup = null; this.closing = false; }
    return presentation;
  }

  returnToMain() {
    if (!this.element) return;
    if (this.element.ownerDocument !== this.view.document) this.view.document.body.append(this.view.document.adoptNode(this.element));
    this.element.classList.remove("ms-screen-popup");
  }

  setSide(side) {
    if (!["right", "bottom"].includes(side)) return;
    this.dock.preferences.side = side; this.dock.save();
    if (this.presentation === "panel") this.dock.setSide(side);
    if (this.element) this.element.dataset.dockSide = side;
    this.applyRatio();
  }

  applyRatio() {
    if (!this.element) return;
    const orientation = this.dock.preferences.side === "bottom" ? "horizontal" : "vertical";
    this.element.style.setProperty("--ms-ide-main", `${this.preferences[orientation] * 100}%`);
    const divider = this.element.querySelector("[data-ide-divider]");
    if (divider) {
      divider.setAttribute("aria-orientation", orientation === "horizontal" ? "vertical" : "horizontal");
      divider.setAttribute("aria-valuenow", String(Math.round(this.preferences[orientation] * 100)));
    }
  }

  bind() {
    this.events?.abort(); this.dragEvents?.abort();
    if (!this.element) return;
    const view = this.element.ownerDocument.defaultView;
    this.events = new view.AbortController();
    const options = { signal: this.events.signal };
    this.dock.bindControls(); this.applyRatio();
    const divider = this.element.querySelector("[data-ide-divider]");
    divider?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.dragEvents?.abort(); this.dragEvents = new view.AbortController();
      const drag = { signal: this.dragEvents.signal };
      const box = this.element.querySelector(".ms-ide-zones").getBoundingClientRect();
      const horizontal = this.dock.preferences.side === "bottom";
      const key = horizontal ? "horizontal" : "vertical";
      view.addEventListener("pointermove", (move) => {
        this.preferences[key] = clampRatio(horizontal ? (move.clientX - box.left) / box.width : (move.clientY - box.top) / box.height);
        this.applyRatio();
      }, drag);
      const finish = () => { this.dragEvents?.abort(); this.dragEvents = null; this.save(); };
      view.addEventListener("pointerup", finish, drag); view.addEventListener("pointercancel", finish, drag); view.addEventListener("blur", finish, drag);
    }, options);
    divider?.addEventListener("keydown", (event) => {
      const horizontal = this.dock.preferences.side === "bottom";
      const delta = horizontal ? { ArrowLeft: -0.03, ArrowRight: 0.03 }[event.key] : { ArrowUp: -0.03, ArrowDown: 0.03 }[event.key];
      if (!delta) return;
      event.preventDefault(); const key = horizontal ? "horizontal" : "vertical";
      this.preferences[key] = clampRatio(this.preferences[key] + delta); this.applyRatio(); this.save();
    }, options);
  }

  toggleTab(zone, tab, visible) {
    const tabs = zone === "main" ? MAIN_TABS : DETAIL_TABS, key = zone === "main" ? "hiddenMain" : "hiddenDetail";
    if (!tabs.includes(tab)) return false;
    const next = new Set(this.preferences[key]);
    if (visible) next.delete(tab); else next.add(tab);
    if (next.size === tabs.length) return false;
    this.preferences = normalizeIDEPreferences({ ...this.preferences, [key]: [...next] }); this.save(); return true;
  }

  dispose() {
    this.events?.abort(); this.dragEvents?.abort(); this.dock.detach();
    this.returnToMain();
    if (this.popup) { this.closing = true; this.popup.close(); this.popup = null; this.closing = false; }
    this.element = null;
  }
}
