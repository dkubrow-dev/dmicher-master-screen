/** Foundry adapters. Scene rules and effect ownership remain in the runtime. */
export function tokenCenter(token, scene) {
  return token.getCenterPoint?.(token._source ?? token) ?? {
    x: Number(token.x ?? 0) + Number(token.width ?? 1) * Number(scene.grid?.size ?? 100) / 2,
    y: Number(token.y ?? 0) + Number(token.height ?? 1) * Number(scene.grid?.size ?? 100) / 2
  };
}

export function sceneDistance(scene, a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y) * Number(scene.grid?.distance ?? 1) / Number(scene.grid?.size || 100);
}

const values = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
const escapeHTML = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Checks each player's owned token, never the GM's combined canvas visibility. */
export function speechRecipients(scene, npc, { range = 30, visibleOnly = true } = {}) {
  const destination = tokenCenter(npc, scene);
  return values(game.users).filter((user) => {
    if (Number(user.role) >= 3) return true;
    if (Number(user.role) < 1 || Number(user.role) > 2 || npc.hidden) return false;
    return values(scene.tokens).some((observer) => {
      if (observer.id === npc.id || !observer.actor?.testUserPermission?.(user, "OWNER")) return false;
      const origin = tokenCenter(observer, scene);
      if (sceneDistance(scene, origin, destination) > Number(range)) return false;
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
  label.position.set(Number(object.w ?? 100) / 2, -4);
}

export function clearTokenEmojis() {
  for (const label of emojiObjects.values()) label.destroy?.();
  emojiObjects.clear();
}

export function createFoundryEffects(chat) {
  const messages = chat?.createMessageService({ ownerId: "dmicher-master-screen", channel: "npc-speech" });
  return {
    async speak(scene, npc, phrase, options, key, enabled) {
      if (!messages) throw new Error("Общий сервис чата Generics недоступен.");
      const ids = speechRecipients(scene, npc, options);
      return messages.create({
        author: game.user.id,
        speaker: chat.buildChatSpeaker({ actor: npc.actor?.id, token: npc.id, scene: scene.id, alias: npc.name }),
        content: `<p>${escapeHTML(phrase)}</p>`
      }, { audience: { type: "users", userIds: ids }, key, kind: "npc-speech", technical: false, enabled });
    },
    async sound(src) {
      const helper = globalThis.foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
      if (!helper?.play) throw new Error("Проигрывание звука Foundry недоступно.");
      return helper.play({ src, volume: 0.8, loop: false }, true);
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
    async macro(uuid, { scene, token, episode, runId, isCurrent = () => true }) {
      const macro = await fromUuid(uuid);
      if (!isCurrent()) return;
      if (!macro || macro.documentName !== "Macro" || macro.type !== "script" || !macro.canExecute) throw new Error("Проверка требует доступный скриптовый макрос Foundry.");
      return macro.execute({ actor: token.actor, token: token.object, scene, episode, runId });
    }
  };
}
