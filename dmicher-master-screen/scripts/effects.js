import { sanitizeScriptHTML } from "./script-text.js";
import { sceneObjectCenter, sceneObjectBounds, isSceneObjectHidden } from "./scene-object-geometry.js";
/** Foundry adapters. Scene rules and effect ownership remain in the runtime. */
export function tokenCenter(token, scene) {
  return token.getCenterPoint?.(token._source ?? token) ?? sceneObjectCenter(token, scene) ?? { x: NaN, y: NaN };
}

export function sceneDistance(scene, a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) * Number(scene.grid?.distance ?? 1) / Number(scene.grid?.size || 100);
}

const values = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
const escapeHTML = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Checks each player's owned token, never the GM's combined canvas visibility. */
export function speechRecipients(scene, npc, { range = 0, visibleOnly = true, allowTags = [], denyTags = [] } = {}) {
  const destination = tokenCenter(npc, scene);
  return values(game.users).filter((user) => {
    if (Number(user.role) >= 3) return true;
    if (Number(user.role) < 1 || Number(user.role) > 2 || isSceneObjectHidden(npc) || ![destination.x, destination.y].every(Number.isFinite)) return false;
    return values(scene.tokens).some((observer) => {
      if ((observer === npc || npc.documentName === "Token" && observer.id === npc.id) || !observer.actor?.testUserPermission?.(user, "OWNER")) return false;
      const tags = scene.getFlag?.("dmicher-master-screen", "objectBindings")?.bindings?.[`Token:${observer.id}`]?.tags ?? [];
      if (allowTags.length && !allowTags.some((tag) => tags.includes(tag)) || denyTags.some((tag) => tags.includes(tag))) return false;
      const origin = tokenCenter(observer, scene);
      if (Number(range) > 0 && sceneDistance(scene, origin, destination) > Number(range)) return false;
      if (!visibleOnly) return true;
      // This is wall line-of-sight, not a simulation of a remote client's lighting/detection modes.
      if (scene.tokenVision && !observer.sight?.enabled) return false;
      if (!observer.object?.checkCollision) return false;
      return !observer.object.checkCollision(destination, { origin, type: "sight", mode: "any" });
    });
  }).map((user) => user.id);
}

export function crossesRectangle(from, to, zone) {
  const left = Number(zone.x), top = Number(zone.y);
  const right = left + Number(zone.width), bottom = top + Number(zone.height);
  const inside = (point) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  if (inside(from)) return false;
  if (inside(to)) return true;
  let start = 0, end = 1;
  const dx = to.x - from.x, dy = to.y - from.y;
  for (const [p, q] of [[-dx, from.x - left], [dx, right - from.x], [-dy, from.y - top], [dy, bottom - from.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const ratio = q / p;
    if (p < 0) start = Math.max(start, ratio); else end = Math.min(end, ratio);
    if (start > end) return false;
  }
  return true;
}

const emojiObjects = new Map();
const speechObjects = new Map();
function positionDecoration(label, document, object, offset) {
  const bounds = sceneObjectBounds(document, document.parent);
  const stage = globalThis.canvas?.stage;
  // Wall and Region containers use scene coordinates, unlike a token's local origin.
  const anchor = bounds && stage && object.toLocal?.({ x: bounds.x + bounds.width / 2, y: bounds.y }, stage);
  label.position.set(anchor?.x ?? Number(object.w ?? 100) / 2, (anchor?.y ?? 0) - offset);
  label.visible = !isSceneObjectHidden(document) || globalThis.game?.user?.isGM === true;
}
export function setObjectSpeech(document, bubble) {
  const object = document?.object ?? document;
  if (!object?.addChild) return;
  let label = speechObjects.get(object);
  if (!bubble?.text) { label?.destroy?.(); speechObjects.delete(object); return; }
  if (!globalThis.PIXI?.Text) return;
  if (!label || label.destroyed) {
    label = new PIXI.Text(String(bubble.text), { fontSize: Number(bubble.fontSize || 24), fill: 0xffffff, stroke: 0x111111, strokeThickness: 4, wordWrap: true, wordWrapWidth: 400, align: "center" });
    label.anchor.set(0.5, 1); label.eventMode = "none"; object.addChild(label); speechObjects.set(object, label);
  }
  label.text = String(bubble.text); label.style.fontSize = Number(bubble.fontSize || 24);
  positionDecoration(label, document, object, 42);
}
export function setTokenEmoji(token, text) {
  const object = token?.object ?? token;
  if (!object?.addChild) return;
  let label = emojiObjects.get(object);
  if (!text) {
    label?.destroy?.();
    emojiObjects.delete(object);
    return;
  }
  if (!globalThis.PIXI?.Text) return;
  if (!label || label.destroyed) {
    label = new PIXI.Text(String(text), { fontSize: 32, fill: 0xffffff, dropShadow: true, dropShadowDistance: 2 });
    label.anchor.set(0.5, 1);
    label.eventMode = "none";
    object.addChild(label);
    emojiObjects.set(object, label);
  }
  label.text = String(text);
  positionDecoration(label, token, object, 4);
}

export function clearTokenEmojis() {
  for (const label of emojiObjects.values()) label.destroy?.();
  emojiObjects.clear();
  for (const label of speechObjects.values()) label.destroy?.();
  speechObjects.clear();
}

export function createFoundryEffects(chat) {
  const messages = chat?.createMessageService({ ownerId: "dmicher-master-screen", channel: "npc-speech" });
  const speechMetadata = (message) => message.getFlag?.("dmicher-master-screen", "scriptSpeech") ?? message.flags?.["dmicher-master-screen"]?.scriptSpeech;
  return {
    async speak(scene, npc, phrase, options, key, enabled) {
      if (!messages) throw new Error("Общий сервис чата Generics недоступен.");
      const ids = speechRecipients(scene, npc, options);
      return messages.create({
        author: game.user.id,
        speaker: chat.buildChatSpeaker({ actor: npc.actor?.id, token: npc.documentName === "Token" ? npc.id : undefined, scene: scene.id, alias: npc.name }),
        content: options?.rich ? sanitizeScriptHTML(phrase) : `<p>${escapeHTML(phrase)}</p>`,
        flags: { "dmicher-master-screen": { scriptSpeech: { objectKey: `${scene.id}:${npc.documentName}:${npc.id}`, removeOnNext: options?.deleteAfter === true,
          expiresAt: Number(options?.expiresAfter) > 0 ? Date.now() + options.expiresAfter * 1000 : null } } }
      }, { audience: { type: "users", userIds: ids }, delivery: "per-recipient", key, kind: "npc-speech", technical: false, enabled });
    },
    async clearPreviousSpeech(scene, object) {
      const objectKey = `${scene.id}:${object.documentName}:${object.id}`;
      for (const message of messages?.find() ?? []) { const meta = speechMetadata(message); if (meta?.objectKey === objectKey && meta.removeOnNext) await messages.remove(message.id); }
    },
    async cleanupSpeech(now = Date.now()) {
      for (const message of messages?.find() ?? []) { const meta = speechMetadata(message); if (Number(meta?.expiresAt) > 0 && meta.expiresAt <= now) await messages.remove(message.id); }
    },
    async removeSpeech(ids) {
      for (const id of ids ?? []) if (messages?.get(id)) await messages.remove(id);
    },
    async sound(src, volume = 1) {
      const helper = globalThis.foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
      if (!helper?.play) throw new Error("Проигрывание звука Foundry недоступно.");
      return helper.play({ src, volume, channel: "environment", loop: false }, true);
    },
    async bubble(token, phrase, enabled = () => true) {
      if (!enabled()) return;
      const bubbles = globalThis.canvas?.hud?.bubbles;
      if (!bubbles?.broadcast) throw new Error("Реплики над токеном Foundry недоступны.");
      return bubbles.broadcast(token, escapeHTML(phrase), { requireVisible: true, pan: false });
    },
    async spawn(scene, spawn, runId, isCurrent) {
      const actor = await fromUuid(spawn.actorUuid);
      if (!actor || actor.documentName !== "Actor" || !actor.getTokenDocument) throw new Error("Актор подкрепления не найден.");
      const created = [];
      for (let index = 0; index < Number(spawn.count); index++) {
        if (!isCurrent()) break;
        const token = await actor.getTokenDocument({
          x: Number(spawn.x) + index * Number(spawn.spacing ?? scene.grid?.size ?? 100), y: Number(spawn.y),
          flags: { "dmicher-master-screen": { spawned: { runId, spawnId: spawn.id, index } } }
        });
        if (!isCurrent()) break;
        const records = await scene.createEmbeddedDocuments("Token", [token.toObject()]);
        created.push(...records.map((record) => record.id));
      }
      return created;
    },
    async macro(uuid, { isCurrent = () => true } = {}) {
      const macro = await fromUuid(uuid);
      if (!isCurrent()) return;
      if (!macro || macro.documentName !== "Macro" || macro.type !== "script" || !macro.canExecute) throw new Error("Проверка требует доступный скриптовый макрос Foundry.");
      await macro.execute();
    }
  };
}
