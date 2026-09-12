import { message as localizedMessage } from "./localization.js";
import { sanitizeScriptHTML, escapeScriptText as escapeHTML } from "./script-text.js";
import { objectCenter, sceneDistance, isSceneObjectHidden } from "./scene-object-geometry.js";
/** Foundry adapters. Scene rules and effect ownership remain in the runtime. */
const values = (collection) => Array.from(collection?.values?.() ?? collection ?? []);

/** Checks each player's owned token, never the GM's combined canvas visibility. */
export function speechRecipients(scene, speaker, { range = 0, visibleOnly = true, allowTags = [], denyTags = [] } = {}) {
  const destination = objectCenter(speaker, scene);
  return values(game.users).filter((user) => {
    if (Number(user.role) >= 3) return true;
    if (Number(user.role) < 1 || Number(user.role) > 2 || isSceneObjectHidden(speaker) || ![destination.x, destination.y].every(Number.isFinite)) return false;
    return values(scene.tokens).some((observer) => {
      if ((observer === speaker || speaker.documentName === "Token" && observer.id === speaker.id) || !observer.actor?.testUserPermission?.(user, "OWNER")) return false;
      const tags = scene.getFlag?.("dmicher-master-screen", "objectBindings")?.bindings?.[`Token:${observer.id}`]?.tags ?? [];
      if (allowTags.length && !allowTags.some((tag) => tags.includes(tag)) || denyTags.some((tag) => tags.includes(tag))) return false;
      const origin = objectCenter(observer, scene);
      if (Number(range) > 0 && sceneDistance(scene, origin, destination) > Number(range)) return false;
      if (!visibleOnly) return true;
      // This is wall line-of-sight, not a simulation of a remote client's lighting/detection modes.
      if (scene.tokenVision && !observer.sight?.enabled) return false;
      if (!observer.object?.checkCollision) return false;
      return !observer.object.checkCollision(destination, { origin, type: "sight", mode: "any" });
    });
  }).map((user) => user.id);
}

export function createFoundryEffects(chat) {
  const messages = chat?.createMessageService({ ownerId: "dmicher-master-screen", channel: "npc-speech" });
  const speechMetadata = (message) => message.getFlag?.("dmicher-master-screen", "scriptSpeech") ?? message.flags?.["dmicher-master-screen"]?.scriptSpeech;
  return {
    async speak(scene, speaker, phrase, options, key, enabled) {
      if (!messages) throw new Error(localizedMessage("Общий сервис чата Generics недоступен."));
      const ids = speechRecipients(scene, speaker, options);
      return messages.create({
        author: game.user.id,
        speaker: chat.buildChatSpeaker({ actor: speaker.actor?.id, token: speaker.documentName === "Token" ? speaker.id : undefined, scene: scene.id, alias: speaker.name }),
        content: options?.rich ? sanitizeScriptHTML(phrase) : `<p>${escapeHTML(phrase)}</p>`,
        flags: { "dmicher-master-screen": { scriptSpeech: { objectKey: `${scene.id}:${speaker.documentName}:${speaker.id}`, removeOnNext: options?.deleteAfter === true,
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
      if (!helper?.play) throw new Error(localizedMessage("Проигрывание звука Foundry недоступно."));
      return helper.play({ src, volume, channel: "environment", loop: false }, true);
    },
    async spawn(scene, spawn, runId, isCurrent) {
      const actor = await fromUuid(spawn.actorUuid);
      if (!actor || actor.documentName !== "Actor" || !actor.getTokenDocument) throw new Error(localizedMessage("Актор подкрепления не найден."));
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
      if (!macro || macro.documentName !== "Macro" || macro.type !== "script" || !macro.canExecute) throw new Error(localizedMessage("Проверка требует доступный скриптовый макрос Foundry."));
      await macro.execute();
    }
  };
}
