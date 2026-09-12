import { SCENE_OBJECT_TYPES, SCENE_OBJECT_COLLECTIONS } from "../scene-object-types.js";
import { sceneObjectBounds, sceneObjectCenter } from "../scene-object-geometry.js";

const supported = new Set(SCENE_OBJECT_TYPES);
const nativeLayers = Object.freeze({ Token: "tokens", Tile: "tiles", Drawing: "drawings", AmbientLight: "lighting", AmbientSound: "sounds", Note: "notes", MeasuredTemplate: "templates", Wall: "walls", Region: "regions" });
const descriptorOf = (object) => {
  const document = object?.document, type = document?.documentName ?? document?.constructor?.documentName;
  return supported.has(type) && document.id ? { type, id: document.id } : null;
};
function constructorCanSelect(board) {
  const controls = globalThis.ui?.controls, control = controls?.control;
  const nativeLayer = board?.[control?.layer ?? control?.name];
  // A native drawing tool owns the click. Lighting/sound/template tools in v13
  // combine creation and editing and have no separate selection tool.
  return nativeLayer !== board.activeLayer || !control?.tools?.select || !controls.tool?.name || controls.tool.name === "select";
}
function belongsToActiveLayer(board, object, descriptor) {
  return !board.activeLayer || object.layer === board.activeLayer || (board.activeLayer.placeables ?? []).some((entry) => entry === object || entry.document?.id === descriptor.id && descriptorOf(entry)?.type === descriptor.type);
}
function containsNative(object, point, event, type) {
  // Foundry puts Wall hit areas on its line and other control hit areas on
  // children; checking only PlaceableObject.hitArea misses these native tools.
  for (const area of [object, object.line, object.controlIcon]) {
    if (!area?.hitArea?.contains || !area.toLocal || !event.global) continue;
    const local = area.toLocal(event.global);
    return area.hitArea.contains(local.x, local.y);
  }
  if (type === "Region" && object.document?.testPoint) return object.document.testPoint({ ...point, elevation: object.document.elevation?.bottom ?? 0 });
  const bounds = object.bounds ?? sceneObjectBounds(object.document, object.document?.parent);
  if (type === "Wall" && object.document.c?.length === 4) {
    const [x1, y1, x2, y2] = object.document.c, dx = x2 - x1, dy = y2 - y1;
    const fraction = Math.max(0, Math.min(1, ((point.x - x1) * dx + (point.y - y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point.x - x1 - fraction * dx, point.y - y1 - fraction * dy) <= 8;
  }
  const width = object.w ?? bounds?.width ?? object.document?.width ?? 24, height = object.h ?? bounds?.height ?? object.document?.height ?? 24;
  const x = object.x ?? bounds?.x ?? object.document?.x, y = object.y ?? bounds?.y ?? object.document?.y;
  const padding = width === 0 && height === 0 ? 12 : 0;
  return Number.isFinite(x) && Number.isFinite(y) && point.x >= x - padding && point.x <= x + width + padding && point.y >= y - padding && point.y <= y + height + padding;
}

/** Prefer the active edit layer; hidden documents remain editable by the GM. */
export function findCanvasObject(board, event, { constructorMode = false } = {}) {
  if (constructorMode && !constructorCanSelect(board)) return null;
  // The actual PIXI event target is more precise than an overlapping bounding box.
  for (let object = event.target; object && object !== board.stage; object = object.parent) {
    const descriptor = descriptorOf(object);
    if (!descriptor) continue;
    if (constructorMode ? belongsToActiveLayer(board, object, descriptor) : object.isVisible !== false && !object.document.hidden) return descriptor;
  }
  const point = event.getLocalPosition(board.stage), layers = constructorMode
    ? board.activeLayer ? [board.activeLayer] : [board.tokens, board.tiles, board.drawings, board.lighting, board.sounds, board.notes, board.templates, board.walls, board.regions]
    : [board.tokens, board.tiles, board.drawings, board.lighting, board.sounds, board.notes, board.templates, board.walls, board.regions];
  const seen = new Set();
  for (const layer of layers) {
    if (!layer || seen.has(layer)) continue;
    seen.add(layer);
    for (const object of [...(layer.placeables ?? [])].reverse()) {
      const document = object.document, type = document?.documentName ?? document?.constructor?.documentName;
      if (!supported.has(type)) continue;
      if (!constructorMode && (object.isVisible === false || document.hidden)) continue;
      if (containsNative(object, point, event, type)) return { type, id: document.id };
    }
  }
  return null;
}

const focused = new WeakMap();
export function clearCanvasObjectFocus(board) {
  if (!board) return;
  const previous = focused.get(board);
  if (!previous) return;
  board.app?.ticker?.remove?.(previous.draw);
  previous.frame?.parent?.removeChild?.(previous.frame);
  previous.frame?.destroy?.(); focused.delete(board);
}
/** Activate the real native layer. No scene document is changed to focus it. */
export async function focusCanvasObject(board, descriptor) {
  if (!supported.has(descriptor?.type)) return false;
  const collection = SCENE_OBJECT_COLLECTIONS[descriptor?.type], document = board?.scene?.[collection]?.get?.(descriptor?.id);
  if (!document || !board.stage) return false;
  const layer = board[nativeLayers[descriptor.type]], object = document.object ?? layer?.placeables?.find((entry) => entry.document?.id === descriptor.id);
  const center = sceneObjectCenter(document, board.scene);
  if (!object || !layer || !center || ![center.x, center.y].every(Number.isFinite)) return false;
  clearCanvasObjectFocus(board);
  const controlName = layer.constructor?.layerOptions?.name ?? nativeLayers[descriptor.type];
  const control = globalThis.ui?.controls?.controls?.[controlName], tools = control?.tools;
  const tool = !tools || tools.select ? "select" : tools[control.activeTool] && !tools[control.activeTool].button && !tools[control.activeTool].toggle ? control.activeTool
    : Object.values(tools).find((entry) => !entry.button && !entry.toggle)?.name;
  layer.activate?.(tool ? { tool } : {});
  // Foundry 14's deprecated template layer redirects activation to Regions.
  const activeLayer = board.activeLayer ?? layer;
  if (activeLayer !== layer) {
    const activeControl = globalThis.ui?.controls?.controls?.[activeLayer.constructor?.layerOptions?.name];
    if (activeControl?.tools?.select) activeLayer.activate?.({ tool: "select" });
  }
  activeLayer.releaseAll?.(); object.control?.({ releaseOthers: true });
  const Graphics = globalThis.PIXI?.Graphics;
  if (Graphics) {
    const frame = new Graphics(); frame.eventMode = "none";
    board.stage.addChild(frame);
    const sceneId = board.scene.id;
    const draw = () => {
      if (board.scene?.id !== sceneId || object.destroyed) { clearCanvasObjectFocus(board); return; }
      const bounds = object.bounds ?? sceneObjectBounds(document, board.scene);
      if (!bounds) return;
      const padding = 5 / Number(board.stage.scale?.x || 1), width = Math.max(bounds.width, 16), height = Math.max(bounds.height, 16);
      frame.clear().lineStyle(2 / Number(board.stage.scale?.x || 1), 0xffc857, 1).drawRect(bounds.x - padding, bounds.y - padding, width + padding * 2, height + padding * 2);
    };
    focused.set(board, { frame, draw }); draw(); board.app?.ticker?.add?.(draw);
  }
  await board.animatePan?.({ ...center, duration: 250 });
  return true;
}

export function canvasPointerPosition(board, event) {
  const native = event.nativeEvent ?? event.originalEvent;
  if (Number.isFinite(native?.clientX) && Number.isFinite(native?.clientY)) return { x: native.clientX, y: native.clientY };
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) return { x: event.clientX, y: event.clientY };
  const rect = globalThis.document?.getElementById?.("board")?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  return { x: rect.left + (event.global?.x ?? 0), y: rect.top + (event.global?.y ?? 0) };
}

/** Capture observes clicks even when native controls stop bubbling. It never
 * prevents Foundry selection/dragging, and a drag does not open a menu on release. */
export function listenCanvasObjectClicks(board, callback) {
  const stage = board?.stage, starts = new Map();
  if (!stage) return () => {};
  const down = (event) => starts.set(event.pointerId ?? 0, event.global ? { x: event.global.x, y: event.global.y } : null);
  const tap = (event) => {
    const key = event.pointerId ?? 0, start = starts.get(key); starts.delete(key);
    if (start && event.global && Math.hypot(event.global.x - start.x, event.global.y - start.y) > 5) return;
    callback(event);
  };
  stage.on("pointerdowncapture", down); stage.on("pointertapcapture", tap);
  return () => { stage.off("pointerdowncapture", down); stage.off("pointertapcapture", tap); starts.clear(); };
}
