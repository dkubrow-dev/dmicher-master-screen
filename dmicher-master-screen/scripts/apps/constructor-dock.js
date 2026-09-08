const STORAGE_KEY = "dmicher-master-screen.constructor-dock";
const DEFAULTS = Object.freeze({ side: "right", right: 480, bottom: 380 });

export function dockLayout({ width, height, side = "right", size } = {}) {
  width = Math.max(1, Math.round(Number(width) || 1));
  height = Math.max(1, Math.round(Number(height) || 1));
  side = side === "bottom" ? "bottom" : "right";
  const extent = side === "right" ? width : height;
  const tableMinimum = Math.min(side === "right" ? 480 : 260, extent * 0.5);
  const maximum = Math.max(1, extent - tableMinimum);
  const minimum = Math.min(side === "right" ? 360 : 240, maximum);
  size = Math.round(Math.min(maximum, Math.max(minimum, Number(size) || DEFAULTS[side])));
  return { side, size, minimum, maximum,
    tableWidth: side === "right" ? width - size : width,
    tableHeight: side === "bottom" ? height - size : height };
}

/** Resize the real renderer without scaling its DOM pixels or changing the viewed world point. */
export function resizeTableCanvas(canvas, width, height) {
  const renderer = canvas?.app?.renderer;
  if (!canvas?.ready || !renderer || !canvas.stage) return false;
  if (renderer.screen.width === width && renderer.screen.height === height
    && canvas.screenDimensions?.[0] === width && canvas.screenDimensions?.[1] === height
    && canvas.stage.position.x === width / 2 && canvas.stage.position.y === height / 2) return false;
  const { x, y } = canvas.stage.pivot;
  renderer.resize(width, height);
  canvas.screenDimensions[0] = renderer.screen.width;
  canvas.screenDimensions[1] = renderer.screen.height;
  canvas.stage.position.set(renderer.screen.width / 2, renderer.screen.height / 2);
  canvas.pan({ x, y });
  return true;
}

/** The constructor owns this temporary layout; it never changes Foundry methods or world data. */
export class ConstructorDock {
  constructor({ view = globalThis.window, hooks = globalThis.Hooks, getCanvas = () => globalThis.canvas } = {}) {
    this.view = view;
    this.hooks = hooks;
    this.getCanvas = getCanvas;
    this.preferences = { ...DEFAULTS };
    try {
      const saved = JSON.parse(view?.localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved && typeof saved === "object") this.preferences = { ...DEFAULTS, ...saved };
    } catch { /* A blocked browser store does not prevent editing. */ }
    this.preferences.side = this.preferences.side === "bottom" ? "bottom" : "right";
    this.events = null;
    this.frame = null;
    this.changedStyles = new Map();
    this.readyHook = null;
  }

  attach(element) {
    if (this.element === element && this.events) return;
    this.detach();
    this.element = element;
    this.events = new this.view.AbortController();
    element.classList.add("ms-docked-editor");
    element.dataset.dmicherDocked = "true";
    this.view.addEventListener("resize", () => this.schedule(), { signal: this.events.signal });
    this.view.addEventListener("pagehide", () => this.detach(), { signal: this.events.signal });
    this.readyHook = this.hooks?.on("canvasReady", () => this.schedule());
    this.apply();
  }

  bindControls() {
    if (!this.element || !this.events) return;
    const options = { signal: this.events.signal };
    for (const button of this.element.querySelectorAll("[data-dock-side]")) {
      button.onclick = () => this.setSide(button.dataset.dockSide);
    }
    const divider = this.element.querySelector("[data-dock-divider]");
    if (divider && divider !== this.divider) {
      this.divider = divider;
      divider.addEventListener("pointerdown", (event) => this.startDrag(event), options);
      divider.addEventListener("keydown", (event) => {
        const side = this.preferences.side;
        const delta = { ArrowLeft: 24, ArrowRight: -24, ArrowUp: 24, ArrowDown: -24 }[event.key];
        if (!delta || (side === "right" && ["ArrowUp", "ArrowDown"].includes(event.key))
          || (side === "bottom" && ["ArrowLeft", "ArrowRight"].includes(event.key))) return;
        event.preventDefault();
        this.preferences[side] = this.layout.size + delta;
        this.apply(); this.preferences[side] = this.layout.size; this.save();
      }, options);
    }
    this.updateControls();
  }

  setSide(side) {
    if (!["right", "bottom"].includes(side)) return;
    this.preferences.side = side;
    this.apply();
    this.save();
  }

  save() {
    try { this.view.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch { /* Optional persistence. */ }
  }

  schedule() {
    if (!this.element || this.frame !== null) return;
    this.frame = this.view.requestAnimationFrame(() => { this.frame = null; this.apply(); });
  }

  writeStyle(element, property, value) {
    if (!element) return;
    let changes = this.changedStyles.get(element);
    if (!changes) { changes = new Map(); this.changedStyles.set(element, changes); }
    if (!changes.has(property)) changes.set(property, { value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
    element.style.setProperty(property, value, "important");
    changes.get(property).applied = element.style.getPropertyValue(property);
  }

  apply() {
    if (!this.element) return;
    const { side } = this.preferences;
    this.layout = dockLayout({ width: this.view.innerWidth, height: this.view.innerHeight, side, size: this.preferences[side] });
    const { size, tableWidth, tableHeight } = this.layout;
    this.element.dataset.dockSide = side;
    this.element.style.setProperty("--ms-dock-size", `${size}px`);
    const doc = this.element.ownerDocument;
    const shell = doc.getElementById("interface");
    // Preserve the native relative stacking context: fixed would bury its controls under #board.
    this.writeStyle(shell, "position", "relative");
    this.writeStyle(shell, "flex", "none");
    this.writeStyle(shell, "width", `${tableWidth}px`);
    this.writeStyle(shell, "height", `${tableHeight}px`);
    const board = doc.getElementById("board");
    this.writeStyle(board, "width", `${tableWidth}px`);
    this.writeStyle(board, "height", `${tableHeight}px`);
    // Pause is a viewport overlay outside #interface in Foundry 13 and 14.
    const pause = doc.getElementById("pause");
    this.writeStyle(pause, "width", `${tableWidth}px`);
    this.writeStyle(pause, "top", `${tableHeight / 2 - 100}px`);
    resizeTableCanvas(this.getCanvas(), tableWidth, tableHeight);
    globalThis.ui?.hotbar?._onResize?.();
    this.updateControls();
  }

  updateControls() {
    if (!this.element || !this.layout) return;
    for (const button of this.element.querySelectorAll("[data-dock-side]")) {
      button.setAttribute("aria-pressed", String(button.dataset.dockSide === this.preferences.side));
    }
    const divider = this.element.querySelector("[data-dock-divider]");
    if (divider) {
      divider.setAttribute("aria-orientation", this.preferences.side === "right" ? "vertical" : "horizontal");
      divider.setAttribute("aria-valuemin", String(this.layout.minimum));
      divider.setAttribute("aria-valuemax", String(this.layout.maximum));
      divider.setAttribute("aria-valuenow", String(this.layout.size));
    }
  }

  startDrag(event) {
    if (event.button !== 0 || !this.events) return;
    event.preventDefault();
    this.dragEvents?.abort();
    this.dragEvents = new this.view.AbortController();
    const options = { signal: this.dragEvents.signal };
    const side = this.preferences.side;
    const start = side === "right" ? event.clientX : event.clientY;
    const initial = this.layout.size;
    const finish = () => {
      this.dragEvents?.abort(); this.dragEvents = null;
      this.apply(); this.preferences[side] = this.layout.size; this.save();
    };
    this.view.addEventListener("pointermove", (move) => {
      this.preferences[side] = initial + start - (side === "right" ? move.clientX : move.clientY);
      this.schedule();
    }, options);
    this.view.addEventListener("pointerup", finish, options);
    this.view.addEventListener("pointercancel", finish, options);
    this.view.addEventListener("blur", finish, options);
  }

  detach() {
    const attached = Boolean(this.element);
    this.events?.abort(); this.events = null;
    this.dragEvents?.abort(); this.dragEvents = null;
    if (this.frame !== null) this.view.cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.readyHook !== null) this.hooks?.off("canvasReady", this.readyHook);
    this.readyHook = null;
    for (const [element, changes] of this.changedStyles) {
      for (const [property, previous] of changes) {
        // Do not undo a later layout decision made by another owner.
        if (element.style.getPropertyValue(property) !== previous.applied) continue;
        if (previous.value) element.style.setProperty(property, previous.value, previous.priority);
        else element.style.removeProperty(property);
      }
    }
    this.changedStyles.clear();
    this.element = null; this.divider = null;
    if (attached) {
      resizeTableCanvas(this.getCanvas(), this.view.innerWidth, this.view.innerHeight);
      globalThis.ui?.hotbar?._onResize?.();
    }
  }
}
