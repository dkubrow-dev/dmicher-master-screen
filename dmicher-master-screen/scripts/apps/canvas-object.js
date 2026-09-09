const supported = new Set(["Token", "Tile", "Drawing", "AmbientLight", "AmbientSound", "Note", "MeasuredTemplate", "Wall", "Region"]);

/** Prefer the active edit layer; hidden documents remain editable by the GM. */
export function findCanvasObject(board, event, { constructorMode = false } = {}) {
  const point = event.getLocalPosition(board.stage), layers = constructorMode
    ? [board.activeLayer, board.tokens, board.tiles, board.drawings, board.lighting, board.sounds, board.notes, board.templates, board.walls, board.regions]
    : [board.tokens, board.tiles];
  const seen = new Set();
  for (const layer of layers) {
    if (!layer || seen.has(layer)) continue;
    seen.add(layer);
    for (const object of [...(layer.placeables ?? [])].reverse()) {
      const document = object.document, type = document?.documentName ?? document?.constructor?.documentName;
      if (!supported.has(type)) continue;
      if (!constructorMode && (object.isVisible === false || document.hidden)) continue;
      // A native hit area preserves rotations and shaped regions. Its coordinates are local.
      let hit;
      if (object.hitArea?.contains && typeof object.toLocal === "function" && event.global) {
        const local = object.toLocal(event.global); hit = object.hitArea.contains(local.x, local.y);
      } else {
        const width = object.w ?? document.width ?? 24, height = object.h ?? document.height ?? 24;
        const x = object.x ?? document.x, y = object.y ?? document.y;
        hit = Number.isFinite(x) && Number.isFinite(y) && point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
      }
      if (hit) return { type, id: document.id };
    }
  }
  return null;
}

export function canvasPointerPosition(board, event) {
  const native = event.nativeEvent ?? event.originalEvent;
  if (Number.isFinite(native?.clientX) && Number.isFinite(native?.clientY)) return { x: native.clientX, y: native.clientY };
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) return { x: event.clientX, y: event.clientY };
  const rect = globalThis.document?.getElementById?.("board")?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
  return { x: rect.left + (event.global?.x ?? 0), y: rect.top + (event.global?.y ?? 0) };
}
