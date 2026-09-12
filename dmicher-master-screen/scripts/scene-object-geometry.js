/** Geometry is read from native documents, so it also works without rendered placeables.
 * Wall.c contains segment endpoints; Drawing.shape dimensions are pixels. */
const finite = (n) => typeof n === "number" && Number.isFinite(n);
const rect = (x, y, width = 0, height = 0) => ({ x, y, width, height });
const pointBounds = (points) => {
  if (!points.length) return null;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  return rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};
const pairs = (values = []) => Array.from({ length: Math.floor(values.length / 2) }, (_, i) => ({ x: values[i * 2], y: values[i * 2 + 1] })).filter((p) => finite(p.x) && finite(p.y));
function shapeBounds(shape) {
  if (shape.base) { const b = shapeBounds(shape.base); return b ? rect(b.x - shape.radius, b.y - shape.radius, b.width + 2 * shape.radius, b.height + 2 * shape.radius) : null; }
  if (shape.points?.length) return pointBounds(pairs(shape.points));
  if (!finite(shape.x) || !finite(shape.y)) return null;
  if (finite(shape.radius)) return rect(shape.x - shape.radius, shape.y - shape.radius, shape.radius * 2, shape.radius * 2);
  if (finite(shape.radiusX) && finite(shape.radiusY)) return rect(shape.x - shape.radiusX, shape.y - shape.radiusY, shape.radiusX * 2, shape.radiusY * 2);
  return rect(shape.x, shape.y, Number(shape.width ?? 0), Number(shape.height ?? 0));
}
export function sceneObjectBounds(document, scene = document?.parent, { useRendered = true } = {}) {
  if (!document) return null;
  const type = document.documentName ?? document.constructor?.documentName;
  if (type === "Wall") return pointBounds(pairs(document.c));
  if (type === "Region") {
    const native = useRendered && document.object?.bounds;
    if (native && [native.x, native.y, native.width, native.height].every(finite)) return rect(native.x, native.y, native.width, native.height);
    const bounds = Array.from(document.shapes ?? []).map(shapeBounds).filter(Boolean);
    return pointBounds(bounds.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y + b.height }]));
  }
  if (!finite(document.x) || !finite(document.y)) return null;
  const grid = Number(scene?.grid?.size || 100);
  if (type === "Token" || (!type && finite(document.width) && finite(document.height))) return rect(document.x, document.y, Number(document.width ?? 1) * grid, Number(document.height ?? 1) * grid);
  if (type === "Tile") return rect(document.x, document.y, Number(document.width ?? 0), Number(document.height ?? 0));
  if (type === "Drawing") return rect(document.x, document.y, Number(document.shape?.width ?? 0), Number(document.shape?.height ?? 0));
  // Lights, sounds, notes and templates are positioned at their origin, not at
  // the centre of their potentially scene-wide area of influence.
  return rect(document.x, document.y);
}
export function sceneObjectCenter(document, scene = document?.parent) {
  const bounds = sceneObjectBounds(document, scene);
  return bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : null;
}
export const isSceneObjectHidden = (document) => document?.hidden === true;

/** Return translated native Region shapes, retaining holes and all other fields. */
export function translateRegionShapes(document, dx, dy) {
  const translate = (shape) => {
    const result = structuredClone(shape.toObject?.() ?? shape);
    if (result.base) { result.base = translate(result.base); return result; }
    if (Array.isArray(result.points)) result.points = result.points.map((n, i) => n + (i % 2 ? dy : dx));
    if (finite(result.x) && finite(result.y)) { result.x += dx; result.y += dy; }
    // Foundry 14 polygons may retain an explicit absolute origin.
    if (result.origin) result.origin = { x: result.origin.x + dx, y: result.origin.y + dy };
    return result;
  };
  return Array.from(document.shapes ?? []).map(translate);
}
