import { text as t } from "../localization.js";
import { readNavigationRows } from "./navigation-filter.js";

export const navigationOrderKey = ({ worldId, userId, sceneId, tab }) =>
  `dmicher-master-screen.navigation-order:${JSON.stringify([worldId, userId, sceneId, tab])}`;

/** A view-only order: identifiers, parentage and the preparation stay untouched. */
export function orderNavigationRows(rows, orders = {}) {
  const children = new Map();
  for (const row of rows) {
    const parent = row.parentKey ?? "root";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(row);
  }
  const result = [], visited = new Set();
  const visit = parent => {
    const ranks = new Map((Array.isArray(orders?.[parent]) ? orders[parent] : []).map((id, index) => [id, index]));
    const siblings = [...(children.get(parent) ?? [])].sort((a, b) => (ranks.get(a.key) ?? Infinity) - (ranks.get(b.key) ?? Infinity));
    for (const row of siblings) {
      if (visited.has(row.key)) continue;
      visited.add(row.key); result.push(row); visit(row.key);
    }
  };
  visit("root");
  // A missing parent must never make a surviving row disappear.
  for (const row of rows) if (!visited.has(row.key)) { visited.add(row.key); result.push(row); visit(row.key); }
  return result;
}

export function moveNavigationSibling(rows, sourceKey, targetKey, after) {
  const source = rows.find(row => row.key === sourceKey), target = rows.find(row => row.key === targetKey);
  if (!source || !target || source === target || source.parentKey !== target.parentKey) return null;
  const siblings = rows.filter(row => row.parentKey === source.parentKey && row !== source).map(row => row.key);
  siblings.splice(siblings.indexOf(target.key) + (after ? 1 : 0), 0, source.key);
  return siblings;
}

function rowKey(element) {
  const d = element.dataset;
  if (d.signalCategory) return JSON.stringify(["category", d.signalCategory]);
  if (d.emitterNode) return JSON.stringify(["emitter", d.emitterNode]);
  return JSON.stringify([d.selectKind ?? "other", d.selectId ?? d.id, d.groupId ?? "", d.pageId ?? ""]);
}
const rowLabel = element => element.tagName === "DETAILS" ? element.querySelector(":scope > summary")
  : element.tagName === "TR" ? element.cells[0] : element;

/** Shared by scene, signal, asset, macro and preset navigation. DOM reordering
 * preserves form drafts, native listeners, scroll and selected documents. */
export class NavigationOrder {
  attach(root, context, { onError = console.error } = {}) {
    this.dispose();
    const content = root?.querySelector("[data-main-content]");
    if (!content || !context.sceneId || !context.userId) return;
    this.content = content; this.key = navigationOrderKey(context); this.onError = onError;
    const view = root.ownerDocument.defaultView;
    this.events = new view.AbortController();
    this.orders = {};
    try {
      this.storage = view.localStorage;
      const saved = JSON.parse(this.storage.getItem(this.key) ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) this.orders = saved;
    } catch (error) { onError(error); }
    const rows = readNavigationRows(content), keys = new Map(rows.map(row => [row.id, rowKey(row.element)]));
    // Fixed tool buttons are navigation actions, not reorderable objects.
    this.rows = rows.filter(row => !row.element.matches(".ms-ide-block-link")).map(row => ({
      ...row, key: keys.get(row.id), parentKey: keys.get(row.parentId) ?? null
    }));
    this.apply();
    const label = t("Перетащите для личной сортировки. Alt + ↑/↓ — переместить строку.", "Drag to sort your view. Alt + Up/Down moves the row.");
    for (const row of this.rows) {
      const element = row.element, host = rowLabel(element);
      element.dataset.navigationKey = row.key;
      const handle = root.ownerDocument.createElement("button");
      handle.type = "button"; handle.className = "ms-navigation-handle";
      handle.dataset.navigationHandle = ""; handle.draggable = true;
      handle.textContent = "⠿"; handle.title = label; handle.setAttribute("aria-label", label);
      // A summary stays a native disclosure target; only its grip starts dragging.
      if (element.tagName !== "DETAILS") element.draggable = true;
      host?.prepend(handle);
    }
    const options = { signal: this.events.signal, capture: true };
    const resolve = event => this.rows.find(row => row.element === event.target.closest("[data-navigation-key]"));
    content.addEventListener("click", event => {
      if (event.target.closest("[data-navigation-handle]")) { event.preventDefault(); event.stopPropagation(); }
    }, options);
    content.addEventListener("keydown", event => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key) || !event.target.matches("[data-navigation-handle]")) return;
      const row = resolve(event), siblings = this.rows.filter(other => other.parentKey === row.parentKey && !other.element.hidden);
      const target = siblings[siblings.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
      event.preventDefault(); event.stopPropagation();
      if (target) this.move(row, target, event.key === "ArrowDown");
    }, options);
    content.addEventListener("dragstart", event => {
      const row = resolve(event);
      if (!row || event.target.closest("input,textarea,select,[contenteditable]")) return;
      this.drag = row; event.stopPropagation();
      const d = row.element.dataset;
      const payload = d.macroUuid ? { type: "Macro", uuid: d.macroUuid }
        : { type: "DmicherScreenNode", sceneId: context.sceneId, kind: d.ideKind, id: d.ideId, groupId: d.groupId };
      event.dataTransfer.setData("text/plain", JSON.stringify(payload));
      event.dataTransfer.setData("application/x-dmicher-navigation", this.key);
      event.dataTransfer.effectAllowed = "copyMove";
    }, options);
    content.addEventListener("dragover", event => {
      if (!this.drag) return;
      const target = resolve(event);
      this.clearMarker();
      if (!this.canMove(this.drag, target)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
      this.marker = rowLabel(target.element);
      this.marker.classList.add(this.after(event, target) ? "ms-sort-after" : "ms-sort-before");
    }, options);
    content.addEventListener("drop", event => {
      if (!this.drag) return;
      const source = this.drag, target = resolve(event);
      this.clearMarker(); this.drag = null;
      if (!this.canMove(source, target)) {
        // Only an explicit cross-group state transfer reaches the model editor.
        // Other view drags must not discard drafts or accidentally attach a macro.
        const from = source.element.dataset, to = target?.element.dataset;
        if (context.mode === "constructor" && from.ideKind === "state" && to?.groupId && from.groupId !== to.groupId) return;
        event.preventDefault(); event.stopPropagation(); return;
      }
      event.preventDefault(); event.stopPropagation(); this.move(source, target, this.after(event, target));
    }, options);
    content.addEventListener("dragend", () => { this.drag = null; this.clearMarker(); }, options);
    view.addEventListener("blur", () => { this.drag = null; this.clearMarker(); }, options);
  }
  canMove(source, target) {
    return target && source !== target && source.parentKey === target.parentKey
      && source.element.parentElement === target.element.parentElement;
  }
  after(event, row) { const box = rowLabel(row.element).getBoundingClientRect(); return event.clientY >= box.top + box.height / 2; }
  move(source, target, after) {
    const order = moveNavigationSibling(this.rows, source.key, target.key, after);
    if (!order) return;
    this.orders[source.parentKey ?? "root"] = order;
    try { this.storage?.setItem(this.key, JSON.stringify(this.orders)); } catch (error) { this.onError(error); }
    this.apply();
  }
  apply() {
    this.rows = orderNavigationRows(this.rows, this.orders);
    const containers = new Map();
    for (const row of this.rows) {
      const parent = row.element.parentElement;
      if (!containers.has(parent)) containers.set(parent, []);
      containers.get(parent).push(row.element);
    }
    for (const [parent, elements] of containers) {
      const managed = new Set(elements), first = [...parent.children].find(element => managed.has(element));
      const marker = parent.ownerDocument.createComment("navigation-order");
      parent.insertBefore(marker, first);
      for (const element of elements) parent.insertBefore(element, marker);
      marker.remove();
    }
  }
  clearMarker() { this.marker?.classList.remove("ms-sort-before", "ms-sort-after"); this.marker = null; }
  dispose() {
    this.events?.abort(); this.events = null; this.drag = null; this.clearMarker();
    this.content?.querySelectorAll("[data-navigation-handle]").forEach(handle => handle.remove());
    this.content = null; this.rows = [];
  }
}
