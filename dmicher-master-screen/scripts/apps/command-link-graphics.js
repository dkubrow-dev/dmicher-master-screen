import { sceneObjectCenter } from "../scene-object-geometry.js";

/** Geometry-only renderer shared by selection and prepared active links. */
export function createCommandLinkGraphics(board, color) {
  const Graphics = globalThis.PIXI?.LegacyGraphics ?? globalThis.PIXI?.Graphics;
  const parent = board?.interface ?? board?.stage;
  const graphic = Graphics && parent?.addChild ? new Graphics() : null;
  if (graphic) { graphic.eventMode = "none"; graphic.name = "dmicher-command-link"; parent.addChild(graphic); }
  const parsed = typeof color === "number" ? color : parseInt(String(color ?? "#ffffff").replace("#", ""), 16);
  const number = Number.isFinite(parsed) ? parsed : 0xffffff;
  const center = doc => {
    const object = doc?.object;
    return object?.center ?? sceneObjectCenter(doc, board?.scene);
  };
  return {
    draw(documents, cursor, visible = true) {
      if (!graphic || graphic.destroyed) return;
      graphic.visible = visible; graphic.clear();
      if (!visible) return;
      const points = documents.map(center); if (cursor) points.push(cursor);
      if (points.length < 2 || points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
      graphic.lineStyle(2 / Math.max(0.1, Number(board.stage?.scale?.x || 1)), number, 0.85).moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) graphic.lineTo(point.x, point.y);
    },
    destroy() { graphic?.parent?.removeChild?.(graphic); if (!graphic?.destroyed) graphic?.destroy?.(); }
  };
}
