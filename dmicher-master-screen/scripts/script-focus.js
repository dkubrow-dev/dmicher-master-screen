import { MODULE_ID, randomId } from "./model.js";
import { generics } from "./generics.js";
import { text } from "./localization.js";
import { debugError } from "./debug.js";
import { objectReferenceKey } from "./object-reference.js";
import { SCENE_OBJECT_COLLECTIONS } from "./scene-object-types.js";
import { scriptObjectBounds } from "./script-movement.js";
import { createExecutionScope, scriptPresentationScope, scriptPresentationIsCurrent } from "./execution.js";

const CHANNEL = "script-focus", FLAG = "scriptFocus";
const dataOf = message => message?.getFlag?.(MODULE_ID, FLAG) ?? message?.flags?.[MODULE_ID]?.[FLAG];
const isFocusMessage = message => {
  const metadata = generics.chat.getChatMetadata(message);
  return metadata?.ownerId === MODULE_ID && metadata.channel === CHANNEL && metadata.technical === true;
};

/** Assistants share the GM audience; technical and disconnected users do not pan. */
export function focusRecipients(users, audience, excludeUser = generics.chat.isManagedIdentityUser) {
  if (!["all", "players", "gm"].includes(audience)) return [];
  return [...users.values()].filter(user => user.active === true && !excludeUser(user)
    && (audience === "gm" ? [3, 4].includes(Number(user.role)) : audience === "players" ? [1, 2].includes(Number(user.role)) : [1, 2, 3, 4].includes(Number(user.role))))
    .map(user => user.id);
}

/** A focus is a one-shot camera change, never a scene switch or an animation. */
export class ScriptFocusService {
  constructor(chat, { owns = scriptPresentationIsCurrent, view = () => globalThis.canvas } = {}) {
    this.messages = chat?.createMessageService({ ownerId: MODULE_ID, channel: CHANNEL });
    this.owns = owns; this.view = view; this.pending = new Map(); this.handled = new Set(); this.cancelled = new Set(); this.hooks = []; this.disposed = false;
  }
  start() {
    if (this.hooks.length || !globalThis.Hooks) return;
    const on = (name, handler) => this.hooks.push([name, Hooks.on(name, handler)]);
    on("createChatMessage", message => this.receive(message));
    on(generics.chat.getChatMessageRenderHook(), (message, html) => {
      if (isFocusMessage(message)) { const element = generics.windows.getRenderedElement(html); if (element) element.hidden = true; }
    });
  }
  receive(message) {
    try { return this.applyDelivery(message); }
    catch (error) { debugError("script", "focus.failed", error, { messageId: message?.id }); return false; }
  }
  applyDelivery(message) {
    const data = dataOf(message), user = globalThis.game?.user, author = game.users?.get(generics.chat.getMessageAuthorId(message));
    if (this.disposed || Number(author?.role) !== 4 || !isFocusMessage(message)
      || !data || typeof data.deliveryId !== "string" || !data.deliveryId || typeof data.runId !== "string"
      || this.handled.has(data.deliveryId) || this.cancelled.has(data.deliveryId)
      || typeof data.manual !== "boolean" || !objectReferenceKey(data.target)
      || data.groupId != null && (typeof data.groupId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.groupId))
      || !focusRecipients(game.users, data.audience).includes(user?.id)) return false;
    this.handled.add(data.deliveryId);
    if (this.handled.size > 1024) this.handled.delete(this.handled.values().next().value);
    const canvas = this.view(), scene = canvas?.scene, request = this.pending.get(data.deliveryId);
    // No startup replay, deferred pan, or navigation to another user's scene.
    if (!scene || scene.id !== data.sceneId || canvas.ready === false || typeof canvas.pan !== "function"
      || request && !request.scope.current() || !this.owns(scene, data)) return false;
    const object = scene[SCENE_OBJECT_COLLECTIONS[data.target.type]]?.get(data.target.id), bounds = scriptObjectBounds(object, scene);
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return false;
    canvas.pan({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    return true;
  }
  async focus(scene, object, audience, options = {}) {
    if (!this.messages) throw new Error(text("Общий сервис чата Generics недоступен.", "The shared Generics chat service is unavailable."));
    if (this.disposed || !scene || !options.runId || !options.isCurrent?.()) return;
    const recipients = focusRecipients(game.users, audience);
    if (!recipients.length) return;
    const target = { type: object.documentName ?? object.constructor?.documentName, id: object.id };
    if (!objectReferenceKey(target) || !scriptObjectBounds(object, scene)) throw new Error(text("Для этого объекта нельзя определить точку фокуса.", "A focus position cannot be determined for this object."));
    const scope = createExecutionScope(scene, { isCurrent: () => !this.disposed && options.isCurrent() });
    const data = { ...scriptPresentationScope(scene, { ...options, target }), audience, deliveryId: randomId() };
    this.pending.set(data.deliveryId, { data, scope }); this.start();
    try {
      await scope.run(async () => {
        const messages = await this.messages.create({ author: game.user.id, content: "", flags: { [MODULE_ID]: { [FLAG]: data } } },
          { audience: { type: "users", userIds: recipients }, key: data.deliveryId, kind: CHANNEL, technical: true, enabled: scope.current });
        for (const message of messages ?? []) {
          if (scope.current()) this.receive(message);
          // Delivery has finished. Keep neither visible chat noise nor history to replay.
          try { await this.messages.remove(message.id); }
          catch (error) { debugError("script", "focus.cleanup", error, { sceneId: scene.id, runId: data.runId }); }
        }
      });
    } finally {
      if (!scope.current()) {
        this.cancelled.add(data.deliveryId);
        if (this.cancelled.size > 1024) this.cancelled.delete(this.cancelled.values().next().value);
      }
      scope.dispose(); this.pending.delete(data.deliveryId);
    }
  }
  stop(scene, { runIds, target, scriptKey } = {}) {
    const key = target && objectReferenceKey(target);
    for (const { data, scope } of this.pending.values()) if (data.sceneId === scene?.id && (!runIds || runIds.includes(data.runId))
      && (!key || objectReferenceKey(data.target) === key) && (scriptKey == null || scriptKey === data.scriptKey)) scope.cancel();
  }
  dispose() {
    this.disposed = true;
    for (const { scope } of this.pending.values()) scope.cancel();
    this.pending.clear(); this.handled.clear(); this.cancelled.clear();
    for (const [name, id] of this.hooks) Hooks.off(name, id);
    this.hooks = [];
  }
}
