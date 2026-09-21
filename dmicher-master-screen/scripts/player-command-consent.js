import { MODULE_ID } from "./model.js";
import { generics } from "./generics.js";
import { commandDocument } from "./object-command-access.js";
import { objectCommandName } from "./object-command-model.js";
import { onExecutionChange } from "./execution.js";
import { SCENE_OBJECT_TYPES } from "./scene-object-types.js";
import { text as t } from "./localization.js";

const CARD = "playerCommandConsent", REPLY = "playerCommandConsentReply", KIND = "player-command-consent";
const users = () => Array.from(globalThis.game?.users?.values?.() ?? []);
const realUser = user => user && !generics.chat.isManagedIdentityUser(user);
const owns = (document, user) => document?.actor?.testUserPermission?.(user, "OWNER") === true;
const owners = document => users().filter(user => realUser(user) && !user.isGM && owns(document, user));
const esc = value => String(value ?? "").replace(/[&<>"']/g, value => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[value]);

/** Consent is about the executor's owner, not ownership of the endpoint of a
 * delegated task. It is an additional prerequisite, never command permission. */
export function commandConsentRequirement(scene, packet, user, { executorUuid = packet.method === "delegated" ? packet.delegateTokenUuid : packet.targetUuid } = {}) {
  if (!scene || user?.isGM) return null;
  const executor = commandDocument(scene, executorUuid);
  if (executor?.documentName !== "Token" || owns(executor, user)) return null;
  const binding = scene.getFlag?.(MODULE_ID, "objectBindings")?.bindings?.[`Token:${executor.id}`];
  return binding?.playerCharacter === true || binding?.groupId === "players" ? { executor, owners:owners(executor) } : null;
}

/** Elected-GM memory only; no scene write lock is held while somebody decides.
 * A restart never replays consent cards, and silence never grants permission. */
export class PlayerCommandConsent {
  constructor({ chat, authority, onError = error => console.warn(MODULE_ID, error) } = {}) {
    Object.assign(this, { chat, authority, onError }); this.pending = new Map(); this.hooks = []; this.disposed = false;
  }
  install() {
    if (this.hooks.length || this.disposed || !globalThis.Hooks?.on) return;
    const on = (name, fn) => this.hooks.push([name, Hooks.on(name, fn)]);
    on("canvasTearDown", () => this.cancelAll());
    on("updateUser", () => this.checkAll()); on("updateScene", scene => this.checkAll(scene));
    on("updateActor", () => this.checkAll());
    for (const name of ["renderSceneNavigation","canvasReady","userConnected"]) on(name,()=>this.checkAll());
    for (const type of SCENE_OBJECT_TYPES) on(`delete${type}`, document => {
      for (const entry of [...this.pending.values()]) if (entry.documents.includes(document)) this.cancel(entry);
    });
  }
  current(entry) {
    if (this.disposed || !this.authority() || entry.cancelled || !this.pending.has(entry.id)
      || globalThis.canvas?.scene?.id !== entry.scene.id) return false;
    const issuer = game.users?.get(entry.user.id);
    if (!realUser(issuer) || issuer.active === false || entry.trackPresence && issuer.viewedScene !== entry.scene.id) return false;
    if (entry.documents.some(document => commandDocument(entry.scene, document.uuid) !== document)) return false;
    if (JSON.stringify(owners(entry.executor).map(user=>user.id).sort()) !== JSON.stringify([...entry.ownerIds].sort())) return false;
    try { return entry.validate({ executing:entry.executing === true }) === entry.stamp; } catch { return false; }
  }
  checkAll(scene) {
    for (const entry of [...this.pending.values()]) if ((!scene || scene.id === entry.scene.id) && !this.current(entry)) this.cancel(entry);
  }
  data(entry, status = entry.status) {
    return { id:entry.id, sceneId:entry.scene.id, issuerId:entry.user.id, actorTokenUuid:entry.packet.actorTokenUuid,
      executorUuid:entry.executor.uuid, targetUuid:entry.endpoint?.uuid ?? entry.executor.uuid,
      commandId:entry.packet.commandId === "delegate" ? entry.packet.parameters?.commandId : entry.packet.commandId,
      ownerIds:entry.ownerIds, authorityId:entry.authorityId, status };
  }
  content(entry) {
    const status = { pending:t("Разрешить команду?", "Allow this command?"), accepted:t("Команда разрешена и принята.", "Command approved and accepted."),
      declined:t("Команда отклонена.", "Command declined."), cancelled:t("Запрос отменён.", "Request cancelled."), failed:t("Команда больше недоступна.", "Command is no longer available.") }[entry.status];
    const buttons = entry.status === "pending" ? `<div class="dmicher-actions"><button type="button" data-command-consent="yes">${t("Да","Yes")}</button><button type="button" data-command-consent="no">${t("Нет","No")}</button></div>` : "";
    return `<section class="dmicher-master-screen"><h3>${t("Поручение персонажу", "Character command")}</h3><p>${esc(entry.actorName)} → ${esc(entry.executorName)}</p><p>${esc(entry.commandName)}${entry.targetName ? ` · ${esc(entry.targetName)}` : ""}</p><p>${t("Владелец", "Owner")}: ${esc(entry.ownerNames)}</p><p>${status}</p>${buttons}</section>`;
  }
  async publishStatus(entry) {
    if (!this.authority()) return;
    const content = this.content(entry), data = this.data(entry);
    for (const message of entry.messages) await message.update?.({ content, [`flags.${MODULE_ID}.${CARD}`]:data });
  }
  release(entry, result = null) { this.pending.delete(entry.id); entry.unsubscribe?.(); entry.unsubscribe = null; entry.resolve?.(result); }
  cancel(entry) {
    if (!this.pending.has(entry.id)) return;
    entry.cancelled = true; entry.status = "cancelled"; this.release(entry);
    void this.publishStatus(entry).catch(this.onError);
  }
  cancelAll() { for (const entry of [...this.pending.values()]) this.cancel(entry); }
  async request({ scene, packet, user, validate, execute, executorUuid, waitForDecision = false }) {
    this.install();
    const requirement = commandConsentRequirement(scene, packet, user, executorUuid ? {executorUuid} : {});
    if (!requirement) return null;
    if (this.disposed || !this.authority() || this.pending.size >= 100) throw new Error("Consent queue unavailable");
    const actor = commandDocument(scene, packet.actorTokenUuid), endpoint = commandDocument(scene, packet.commandId === "delegate" ? packet.parameters?.targetUuid : packet.targetUuid);
    const stamp = validate(), id = globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID();
    const entry = { id, scene, packet:structuredClone(packet), user, executor:requirement.executor, endpoint,
      ownerIds:requirement.owners.map(owner => owner.id), authorityId:game.user.id, validate, execute, stamp, trackPresence:user.viewedScene !== undefined,
      documents:[actor,requirement.executor,endpoint,commandDocument(scene,packet.delegateTokenUuid)].filter(Boolean), messages:[], status:"pending", deciding:false, cancelled:false,
      actorName:actor?.name ?? user.name, executorName:requirement.executor.name, ownerNames:requirement.owners.map(owner => owner.name ?? owner.id).join(", "),
      commandName:objectCommandName(packet.commandId === "delegate" ? packet.parameters.commandId : packet.commandId, endpoint?.documentName), targetName:endpoint?.name ?? endpoint?.text ?? endpoint?.label ?? "" };
    if (!entry.ownerIds.length) throw new Error("Player character has no current owner");
    this.pending.set(id, entry);
    entry.completed = new Promise(resolve=>{entry.resolve=resolve;});
    entry.unsubscribe = onExecutionChange(scene, reason => {
      if (["halt-all","canvas-teardown","runtime-disposed","object-restoration-requested","initial-restoration-replaced"].includes(reason) || !this.current(entry)) this.cancel(entry);
    });
    entry.ready = Promise.all([entry.ownerIds,users().filter(user => realUser(user) && user.isGM).map(user => user.id)].map(async (userIds,index) => {
      const messages = await this.chat.create({ author:game.user.id, content:this.content(entry), flags:{[MODULE_ID]:{[CARD]:this.data(entry)}} },
        { audience:{type:"users",userIds}, key:`consent:${id}:${index}`, kind:KIND, technical:false, display:"visible",
          enabled:()=>!this.disposed && this.authority() && !entry.cancelled });
      entry.messages.push(...(messages ?? []));
      if (entry.status !== "pending") await this.publishStatus(entry);
      return messages;
    }));
    try {
      const results = await entry.ready;
      if (!results.every(messages => messages?.length)) { this.cancel(entry); throw new Error("Consent cards were not delivered"); }
    } catch(error) { this.cancel(entry); throw error; }
    return waitForDecision ? entry.completed : { ok:true, pendingConsent:true, consentId:id, commandId:packet.commandId };
  }
  async answer(id, yes, user) {
    const entry = this.pending.get(id);
    if (!entry || entry.deciding || typeof yes !== "boolean" || !realUser(user) || !this.authority() || this.disposed) return false;
    if (!user.isGM && (!entry.ownerIds.includes(user.id) || !owns(entry.executor,user))) return false;
    entry.deciding = true;
    try { await entry.ready; } catch { this.cancel(entry); return false; }
    if (!this.current(entry)) { this.cancel(entry); return false; }
    if (!yes) { entry.status = "declined"; this.release(entry); await this.publishStatus(entry); return true; }
    let result;
    try {
      entry.executing = true;
      result = await entry.execute(() => this.current(entry));
      if (entry.cancelled) return false;
      entry.status = "accepted";
    } catch(error) { if (entry.cancelled) return false; entry.status = "failed"; this.onError(error); }
    this.release(entry,result); await this.publishStatus(entry); return true;
  }
  async processMessage(message, initiatingUserId) {
    const reply = message?.getFlag?.(MODULE_ID,REPLY);
    if (!reply || !this.authority() || this.disposed) return false;
    const metadata = generics.chat.getChatMetadata(message), authorId = generics.chat.getMessageAuthorId(message);
    if (metadata?.ownerId !== MODULE_ID || metadata.channel !== "object-command" || metadata.kind !== `${KIND}-reply` || metadata.technical !== true || metadata.display !== "hidden"
      || !message.id || authorId !== initiatingUserId || !message.whisper?.includes(game.user.id) || !message.whisper.includes(authorId)
      || typeof reply.id !== "string" || typeof reply.yes !== "boolean" || Object.keys(reply).some(key => !["id","yes"].includes(key))) return false;
    return this.answer(reply.id,reply.yes,game.users?.get(authorId));
  }
  render(message, html) {
    const data = message?.getFlag?.(MODULE_ID,CARD), metadata = generics.chat.getChatMetadata(message), authorId = generics.chat.getMessageAuthorId(message), user = game.user;
    if (this.disposed || !data || metadata?.ownerId !== MODULE_ID || metadata.channel !== "object-command" || metadata.kind !== KIND
      || !game.users?.get(authorId)?.isGM || authorId !== data.authorityId || !message.whisper?.includes(user.id)) return;
    const root = html?.[0] ?? html, scene = game.scenes?.get(data.sceneId), executor = commandDocument(scene,data.executorUuid);
    for (const button of root?.querySelectorAll?.("[data-command-consent]") ?? []) {
      button.disabled = data.status !== "pending" || !user.isGM && (!data.ownerIds?.includes(user.id) || !owns(executor,user));
      button.addEventListener("click", () => {
        for (const control of root.querySelectorAll("[data-command-consent]")) control.disabled = true;
        void this.chat.create({author:user.id,content:"",flags:{[MODULE_ID]:{[REPLY]:{id:data.id,yes:button.dataset.commandConsent === "yes"}}}},
          {audience:{type:"users",userIds:[...new Set([user.id,...users().filter(user=>user.isGM && user.active).map(user=>user.id)])]},kind:`${KIND}-reply`,technical:true,display:"hidden"})
          .catch(error => { button.disabled = false; this.onError(error); });
      }, {once:true});
    }
  }
  dispose() { this.cancelAll(); this.disposed = true; for (const [name,id] of this.hooks) Hooks.off(name,id); this.hooks.length = 0; }
}
