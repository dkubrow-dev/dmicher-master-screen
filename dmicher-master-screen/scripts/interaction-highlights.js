import { INTERACTIVE_TYPES, effectiveInteractionSettings, highlightChordMatches } from "./interaction-settings-model.js";
import { getInteractionSettings, getPlayerInteractionSettings, subscribeInteractionSettings } from "./interaction-settings-store.js";
import { isInteractivePresentationAvailable, subscribeInteractivePresentationAccess } from "./premium-provider.js";
import { isTypingTarget } from "./interaction-keybinding.js";
import { sceneObjectBounds, isSceneObjectHidden } from "./scene-object-geometry.js";

const typeOf = document => document.documentName ?? document.constructor?.documentName;
const nativeFilters = () => globalThis.foundry?.canvas?.rendering?.filters ?? globalThis;
const colorNumber = color => parseInt(color.slice(1), 16);
const destroy = item => { if (item && !item.destroyed) item.destroy({ children: true }); };

/** Native detection is evaluated only after sight/source updates, never by the
 * animation refresh path. The overlay also uses Foundry's vision texture mask:
 * seeing one edge never reveals the remainder behind walls or unexplored fog. */
export function visibleInteractiveDocument(document, board = globalThis.canvas, user = globalThis.game?.user) {
  const object = document?.object;
  if (!object || object.destroyed || isSceneObjectHidden(document) || object.isPreview) return false;
  if (!user?.isGM && document.door === 2) return false;
  if (object.isVisible === false) return false;
  if (user?.isGM) return true;
  const bounds = sceneObjectBounds(document, document.parent);
  if (!bounds || typeof board?.visibility?.testVisibility !== "function") return false;
  const points = [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }];
  if (bounds.width || bounds.height) points.push({ x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y }, { x: bounds.x, y: bounds.y + bounds.height });
  return points.some(point => board.visibility.testVisibility(point, { tolerance: 2, object }));
}

function newContainer() {
  const container = new PIXI.Container(); container.eventMode = "none"; container.interactiveChildren = false; return container;
}
function graphics() { const Graphics = PIXI.LegacyGraphics ?? PIXI.Graphics; return new Graphics(); }

/** getInteractiveDocuments is the menu's prepared eligibility projection. This
 * adapter never reads group definitions, normalizes behavior, or runs conditions.
 * Foundry refresh hooks update transforms only for already prepared entries. */
export function createInteractiveHighlights({ getInteractiveDocuments = () => [],
  readWorld = getInteractionSettings, readPlayer = getPlayerInteractionSettings,
  hasAccess = isInteractivePresentationAvailable } = {}) {
  const entries = new Map(), hooks = [], pressed = new Set();
  let root = null, settings = effectiveInteractionSettings({}, {}), sceneId = null, window = null, disposed = false, visibilityTimer = null;
  let unsubscribeSettings, unsubscribePremium;
  const highlightActive = () => settings.highlight.enabled && (settings.highlight.activation === "always" || highlightChordMatches(pressed, settings.highlight.keys));
  const visible = entry => entry.container.visible = entry.visible && (settings.icons.enabled && entry.iconSettings.enabled || highlightActive() && entry.frameSettings.enabled);
  const setActivation = () => { for (const entry of entries.values()) { if (entry.outline) entry.outline.visible = highlightActive() && entry.frameSettings.enabled; visible(entry); } };
  const keydown = event => {
    if (event.repeat || isTypingTarget(event.target)) return;
    pressed.add(event.code);
    if (highlightActive() && settings.highlight.activation === "keys") { event.preventDefault(); refreshVisibility(); }
    setActivation();
  };
  const keyup = event => { pressed.delete(event.code); setActivation(); };
  const blur = () => { pressed.clear(); setActivation(); };
  function remove(document) { const entry = entries.get(document); destroy(entry?.container); entry?.outlineFilter?.destroy?.(); entries.delete(document); }
  function clear() {
    if (visibilityTimer !== null) clearTimeout(visibilityTimer); visibilityTimer = null;
    for (const document of entries.keys()) remove(document);
    for (const filter of root?.filters ?? []) filter.destroy?.();
    destroy(root); root = null; sceneId = null; pressed.clear();
  }
  function ensureRoot() {
    const board = globalThis.canvas;
    if (root && !root.destroyed) return root;
    if (!board?.interface?.addChild || !globalThis.PIXI?.Container) return null;
    root = newContainer(); root.name = "dmicher-interactive-objects"; board.interface.addChild(root);
    if (!globalThis.game?.user?.isGM) {
      const Filter = nativeFilters().VisionMaskFilter;
      // No unmasked fallback for players: unsupported canvas adapters fail closed.
      if (!Filter?.create || !board.masks?.vision?.renderTexture) { destroy(root); root = null; return null; }
      root.filters = [Filter.create()];
    }
    return root;
  }
  function createEntry(document) {
    const type = typeOf(document), frameSettings = settings.highlight.frames[type], iconSettings = settings.icons.types[type];
    const entry = { container: newContainer(), frameSettings, iconSettings, visible: false, geometryKey: null };
    root.addChild(entry.container);
    if (settings.highlight.enabled && frameSettings.enabled) {
      const mesh = document.object?.mesh, Outline = nativeFilters().OutlineOverlayFilter;
      if (["Token", "Tile"].includes(type) && mesh?.texture && PIXI.Sprite && Outline?.create) {
        entry.outline = new PIXI.Sprite(mesh.texture); entry.outline.anchor.copyFrom(mesh.anchor);
        const c = frameSettings.color;
        entry.outlineFilter = Outline.create({ outlineColor: [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255, 1], knockout: true, wave: false });
        entry.outlineFilter.animated = false; entry.outlineFilter.thickness = frameSettings.size; entry.outline.filters = [entry.outlineFilter]; entry.meshOutline = true;
      } else entry.outline = graphics();
      entry.outline.eventMode = "none"; entry.container.addChild(entry.outline);
    }
    if (settings.icons.enabled && iconSettings.enabled) {
      entry.icon = newContainer(); entry.background = graphics(); entry.label = new PIXI.Text(iconSettings.symbol, { fontSize: iconSettings.size, fontFamily: "Arial, sans-serif", fill: colorNumber(iconSettings.color), padding: 2 });
      entry.label.anchor.set(0.5, 0.5); entry.label.eventMode = "none";
      const size = Math.max(iconSettings.size, entry.label.width, entry.label.height) + 6;
      entry.background.beginFill(colorNumber(iconSettings.background), 0.9).drawRoundedRect(-size / 2, -size / 2, size, size, 4).endFill();
      entry.icon.addChild(entry.background, entry.label); entry.container.addChild(entry.icon);
    }
    return entry;
  }
  function drawContour(document, entry, bounds) {
    const object = document.object, outline = entry.outline, type = typeOf(document);
    if (!outline) return;
    outline.visible = highlightActive();
    if (entry.meshOutline) {
      const mesh = object.mesh;
      if (!mesh?.worldTransform || !root.parent?.worldTransform) return;
      if (outline.texture !== mesh.texture) outline.texture = mesh.texture;
      outline.anchor.copyFrom(mesh.anchor);
      outline.transform.setFromMatrix(root.parent.worldTransform.clone().invert().append(mesh.worldTransform));
      return;
    }
    // Geometry construction is document-driven; native refresh changes only the
    // translation of the token/drawing, with no JSON/stringify work each frame.
    if (type === "Wall") {
      const c = document.c;
      if (entry.wallCoordinates?.every((n, index) => n === c[index])) return;
      entry.wallCoordinates = [...c]; outline.clear().lineStyle(entry.frameSettings.size, colorNumber(entry.frameSettings.color), 1).moveTo(c[0], c[1]).lineTo(c[2], c[3]); return;
    }
    const width = bounds.width || 24, height = bounds.height || 24;
    if (entry.width !== width || entry.height !== height || entry.shape !== document.shape || entry.shapes !== document.shapes) {
      entry.width = width; entry.height = height; entry.shape = document.shape; entry.shapes = document.shapes;
      outline.clear().lineStyle(entry.frameSettings.size, colorNumber(entry.frameSettings.color), 1);
      if (type === "Region" && object.polygons?.length) {
        for (const polygon of object.polygons) outline.drawShape(polygon);
      } else if (type === "Drawing" && document.shape?.type === "e") outline.drawEllipse(width / 2, height / 2, width / 2, height / 2);
      else if (type === "Drawing" && document.shape?.points?.length) outline.drawPolygon(document.shape.points);
      else if (["AmbientLight", "AmbientSound", "Note"].includes(type)) outline.drawCircle(0, 0, Math.max(12, Number(document.iconSize || 24) / 2));
      else outline.drawRect(0, 0, width, height);
    }
    if (["Token", "Tile", "Drawing"].includes(type)) {
      outline.pivot.set(width / 2, height / 2); outline.position.set(bounds.x + width / 2, bounds.y + height / 2);
      outline.rotation = Number(document.rotation || 0) * Math.PI / 180;
    } else if (type !== "Region") outline.position.set(bounds.x, bounds.y);
  }
  function refresh(document) {
    const entry = entries.get(document);
    if (!entry || !document.object || document.object.destroyed || !root || root.destroyed) return;
    const bounds = sceneObjectBounds(document, document.parent); if (!bounds) { entry.container.visible = false; return; }
    // For moving token/drawing visuals, prefer the placeable's interpolated origin.
    const object = document.object, type = typeOf(document);
    if (["Token", "Tile", "Drawing"].includes(type) && object.position) { bounds.x = object.position.x; bounds.y = object.position.y; }
    drawContour(document, entry, bounds);
    if (entry.icon) {
      const fraction = value => ["left", "top"].includes(value) ? 0 : ["right", "bottom"].includes(value) ? 1 : 0.5;
      entry.icon.position.set(bounds.x + bounds.width * fraction(entry.iconSettings.horizontal), bounds.y + bounds.height * fraction(entry.iconSettings.vertical));
    }
    visible(entry);
  }
  function refreshVisibility() {
    if (!highlightActive() && !settings.icons.enabled) return;
    for (const [document, entry] of entries) { entry.visible = visibleInteractiveDocument(document); visible(entry); }
  }
  function scheduleVisibility() {
    if (visibilityTimer !== null || !entries.size || !highlightActive() && !settings.icons.enabled) return;
    // The native vision mask clips immediately; semantic visibility can lag by
    // a tenth of a second without revealing hidden content or following FPS.
    visibilityTimer = setTimeout(() => { visibilityTimer = null; refreshVisibility(); }, 100);
  }
  function sync(scene = globalThis.canvas?.scene) {
    if (disposed) return;
    const nextSettings = effectiveInteractionSettings(readWorld(), readPlayer(), { premium: hasAccess() });
    const changed = JSON.stringify(settings) !== JSON.stringify(nextSettings);
    if (changed || sceneId !== scene?.id) { clear(); settings = nextSettings; }
    if (!scene || scene.id !== globalThis.canvas?.scene?.id || !settings.highlight.enabled && !settings.icons.enabled) { clear(); return; }
    sceneId = scene.id;
    if (!ensureRoot()) return;
    const candidates = new Set();
    for (const document of getInteractiveDocuments(scene) ?? []) {
      if (!document || document.parent?.id !== scene.id || !INTERACTIVE_TYPES.includes(typeOf(document))) continue;
      const type = typeOf(document);
      if (!(settings.highlight.enabled && settings.highlight.frames[type].enabled || settings.icons.enabled && settings.icons.types[type].enabled)) continue;
      candidates.add(document);
      if (!entries.has(document)) entries.set(document, createEntry(document));
    }
    for (const document of entries.keys()) if (!candidates.has(document)) remove(document);
    for (const document of entries.keys()) refresh(document);
    refreshVisibility();
  }
  function install() {
    if (window || disposed) return api;
    window = globalThis.window ?? globalThis;
    window.addEventListener?.("keydown", keydown); window.addEventListener?.("keyup", keyup); window.addEventListener?.("blur", blur);
    const on = (name, callback) => hooks.push([name, Hooks.on(name, callback)]);
    on("canvasReady", scene => sync(globalThis.canvas?.scene)); on("canvasTearDown", clear);
    // The domain owner calls sync when menu eligibility changes. A raw updateScene
    // hook would also rebuild eligibility on every runtime clock write.
    on("sightRefresh", scheduleVisibility); on("updateUser", () => sync());
    for (const type of INTERACTIVE_TYPES) {
      on(`refresh${type}`, object => refresh(object.document ?? object));
      on(`create${type}`, document => { if (document.parent?.id === globalThis.canvas?.scene?.id) sync(); });
      on(`update${type}`, document => { if (entries.has(document)) { const entry = entries.get(document); entry.geometryKey = null; entry.shape = null; entry.shapes = null; refresh(document); entry.visible = visibleInteractiveDocument(document); visible(entry); } });
      on(`delete${type}`, remove);
    }
    unsubscribeSettings = subscribeInteractionSettings(() => sync()); unsubscribePremium = subscribeInteractivePresentationAccess(() => sync()); sync(); return api;
  }
  function dispose() {
    if (disposed) return; disposed = true; clear();
    for (const [name, id] of hooks) Hooks.off(name, id); hooks.length = 0;
    window?.removeEventListener?.("keydown", keydown); window?.removeEventListener?.("keyup", keyup); window?.removeEventListener?.("blur", blur); window = null;
    unsubscribeSettings?.(); unsubscribePremium?.();
  }
  const api = Object.freeze({ install, sync, refresh, remove, refreshVisibility, clear, dispose }); return api;
}
