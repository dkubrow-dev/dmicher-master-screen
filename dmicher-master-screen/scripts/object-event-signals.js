import { MODULE_ID } from "./model.js";
import { isAuthority } from "./store.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { sceneObjectBounds, sceneObjectCenter } from "./scene-object-geometry.js";
import { isObjectSignalEnabled } from "./object-signal-settings.js";
import { text } from "./localization.js";

const movementFields = new Set(["x", "y", "c", "shapes"]);
const collisionTypes = new Set(["Token", "Tile", "Drawing", "Region", "Wall"]);
const typeOf = document => document?.documentName ?? document?.constructor?.documentName;
const uuid = document => document?.uuid ?? `Scene.${document?.parent?.id}.${typeOf(document)}.${document?.id}`;
const keyOf = document => `${typeOf(document)}:${document.id}`;
const array = collection => Array.from(collection?.values?.() ?? collection ?? []);
const overlap = (a, b) => a && b && a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
const centre = bounds => ({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });

function segmentTouchesRect(from, to, bounds) {
  let near = 0, far = 1;
  for (const axis of ["x", "y"]) {
    const delta = to[axis] - from[axis], size = axis === "x" ? "width" : "height";
    if (!delta) { if (from[axis] < bounds[axis] || from[axis] > bounds[axis] + bounds[size]) return false; continue; }
    const first = (bounds[axis] - from[axis]) / delta, last = (bounds[axis] + bounds[size] - from[axis]) / delta;
    near = Math.max(near, Math.min(first, last)); far = Math.min(far, Math.max(first, last));
    if (near > far) return false;
  }
  return true;
}

function touches(document, bounds, other, scene) {
  if (typeOf(other) === "Wall" && Array.isArray(other.c)) {
    return segmentTouchesRect({ x: other.c[0], y: other.c[1] }, { x: other.c[2], y: other.c[3] }, bounds);
  }
  // Foundry tests Region polygons and holes. Bounds remain only the broad phase.
  const otherBounds = sceneObjectBounds(other, scene, { useRendered: false });
  if (!overlap(bounds, otherBounds)) return false;
  const region = typeOf(other) === "Region" ? other.object : null;
  if (typeof region?.testPoint === "function") return region.testPoint(centre(bounds), document.elevation ?? 0);
  return true;
}

/** Native updates, not animation frames, drive observations. With no opted-in
 * collision emitter no scene geometry is traversed. No startup data is written. */
export class ObjectEventSignals {
  constructor(signals, { onError = console.error, onNoteOpened } = {}) {
    this.signals = signals; this.onError = onError; this.onNoteOpened = onNoteOpened;
    this.hooks = []; this.before = new WeakMap(); this.positions = new WeakMap(); this.initiators = new WeakMap(); this.disposed = false;
  }
  enabled(document, name) {
    if (!document?.parent || !isAuthority() || this.disposed) return false;
    const key = keyOf(document);
    return isObjectSignalEnabled(document.parent, key, { id: `builtin:${key}:${name}`, returns: [] });
  }
  emit(document, name, parameters) {
    if (!this.enabled(document, name)) return;
    void Promise.resolve().then(() => this.signals.emit(document.parent, { emitterKey: keyOf(document), name, parameters })).catch(this.onError);
  }
  async withInitiator(document, { userId, patronUuid = null }, operation) {
    if (!isAuthority()) throw new Error(text("Происхождение события определяет исполняющий мастер.", "Only the authority may establish native event provenance."));
    const stack = this.initiators.get(document) ?? [], context = { userId, patronUuid };
    stack.push(context); this.initiators.set(document, stack);
    try { return await operation(); }
    finally {
      const index = stack.indexOf(context); if (index >= 0) stack.splice(index, 1);
      if (!stack.length) this.initiators.delete(document);
    }
  }
  parameters(document, userId) {
    const origin = this.initiators.get(document)?.at(-1), point = sceneObjectCenter(document) ?? { x: 0, y: 0 };
    return { objectUuid: uuid(document), userUuid: `User.${origin?.userId ?? userId ?? globalThis.game?.user?.id ?? ""}`,
      x: point.x, y: point.y, patronUuid: origin?.patronUuid ?? null };
  }
  observeBefore(document, changes) {
    if (!isAuthority() || !Object.keys(changes).some(key => movementFields.has(key) || key.startsWith("shapes."))) return;
    this.before.set(document, sceneObjectBounds(document, document.parent, { useRendered: false }));
  }
  observeUpdate(document, changes, _options, userId) {
    if (!isAuthority() || this.disposed) return;
    const type = typeOf(document), scene = document.parent;
    if (!scene) return;
    if (type === "Wall" && Number(document.door) > 0 && Object.hasOwn(changes, "ds")) {
      const closed = globalThis.CONST?.WALL_DOOR_STATES?.CLOSED ?? 0, open = globalThis.CONST?.WALL_DOOR_STATES?.OPEN ?? 1;
      if (changes.ds === open || changes.ds === closed) this.emit(document, changes.ds === open ? "doorOpened" : "doorClosed", this.parameters(document, userId));
    }
    if (type === "AmbientLight" && Object.hasOwn(changes, "hidden")) this.emit(document, document.hidden ? "lightOff" : "lightOn", this.parameters(document, userId));
    if (!collisionTypes.has(type) || !Object.keys(changes).some(key => movementFields.has(key) || key.startsWith("shapes."))) return;
    const bindings = scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings ?? {};
    const emitters = Object.keys(bindings).filter(key => isObjectSignalEnabled(scene, key, { id: `builtin:${key}:collision`, returns: [] }));
    if (!emitters.length) { this.before.delete(document); return; }
    const next = sceneObjectBounds(document, scene, { useRendered: false }), previous = this.before.get(document) ?? this.positions.get(document);
    this.before.delete(document);
    // preUpdate belongs to the requesting client; remote updates use our last
    // confirmed position instead. This cache is populated only for consumers.
    if (next) this.positions.set(document, next);
    if (!next || previous && JSON.stringify(next) === JSON.stringify(previous)) return;
    const ownEnabled = emitters.includes(keyOf(document));
    for (const [otherType, collection] of Object.entries(SCENE_OBJECT_COLLECTIONS)) {
      if (!collisionTypes.has(otherType)) continue;
      for (const other of array(scene[collection])) {
        if (other === document || !ownEnabled && !emitters.includes(keyOf(other))) continue;
        const now = touches(document, next, other, scene), already = previous && touches(document, previous, other, scene);
        if (!now || already) continue;
        const parameters = this.parameters(document, userId);
        if (ownEnabled) this.emit(document, "collision", { ...parameters, otherObjectUuid: uuid(other) });
        if (emitters.includes(keyOf(other))) this.emit(other, "collision", { ...parameters, objectUuid: uuid(other), otherObjectUuid: uuid(document) });
      }
    }
  }
  observeMessage(message, _options, userId) {
    if (!isAuthority() || !message.speaker?.token) return;
    const scene = globalThis.game?.scenes?.get?.(message.speaker.scene) ?? globalThis.canvas?.scene;
    if (message.speaker.scene && scene?.id !== message.speaker.scene) return;
    const document = scene?.tokens?.get?.(message.speaker.token);
    if (!document || message.visible === false) return;
    this.emit(document, "message", { objectUuid: uuid(document), userUuid: `User.${userId ?? message.author?.id ?? ""}`,
      text: String(message.content ?? ""), recipients: JSON.stringify(array(message.whisper).map(user => typeof user === "string" ? user : user.id)),
      mode: message.blind ? "blind" : message.whisper?.length ? "private" : "public" });
  }
  noteOpened(note, userId = globalThis.game?.user?.id) {
    const document = note.document ?? note;
    this.emit(document, "noteOpened", { objectUuid: uuid(document), userUuid: `User.${userId}`, noteUuid: uuid(document) });
  }
  install(hooks = globalThis.Hooks) {
    const on = (name, callback) => this.hooks.push([name, hooks.on(name, (...args) => {
      try { const result = callback(...args); if (result?.catch) void result.catch(this.onError); }
      catch (error) { this.onError(error); }
    })]);
    for (const type of Object.keys(SCENE_OBJECT_COLLECTIONS)) {
      on(`preUpdate${type}`, (...args) => this.observeBefore(...args));
      on(`update${type}`, (...args) => this.observeUpdate(...args));
    }
    on("createChatMessage", (...args) => this.observeMessage(...args));
    on("activateNote", note => { if (isAuthority()) this.noteOpened(note); else return this.onNoteOpened?.(note.document ?? note); });
    return () => { this.disposed = true; for (const [name, id] of this.hooks) hooks.off(name, id); this.hooks = []; this.before = new WeakMap(); this.positions = new WeakMap(); };
  }
}
