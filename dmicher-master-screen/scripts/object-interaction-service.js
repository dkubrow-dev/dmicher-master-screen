import { MODULE_ID } from "./model.js";
import { isAuthority, getRuntime, withSceneLock, saveRuntime } from "./store.js";
import { getSceneObject, getObjectBindings, objectKey } from "./scene-objects.js";
import { listAvailableInteractions, validateObjectActionAccess } from "./interaction-access.js";
import { evaluateInteractionMacro } from "./interaction-macro.js";
import { getConditionKey, consumeCondition } from "./interaction-conditions.js";
import { generics } from "./generics.js";
import { requestGMReply } from "./gm-request.js";
import { debugError, commandTrace } from "./debug.js";
import { text } from "./localization.js";
import { objectActionContract } from "./object-action-contract.js";
import { TechnicalMessageCleanup } from "./technical-message-cleanup.js";
import { isSceneObjectHidden } from "./scene-object-geometry.js";
import { SCENE_OBJECT_TYPES } from "./scene-object-types.js";
import { isExecutionHalted } from "./execution.js";
import { collectionEntryAllowed } from "./automation-limits.js";

const CHANNEL="object-interaction", REQUEST="objectInteractionRequest", RESULT="objectInteractionResult";
const reject = () => { throw new Error(text("Это действие сейчас недоступно вашему персонажу.","This action is currently unavailable to your character.")); };
const string = value => typeof value === "string" && value.length > 0 && value.length <= 256;
function validPacket(packet) {
  return packet && !Array.isArray(packet) && ["inspect","action","note-opened"].includes(packet.kind)
    && string(packet.requestId) && string(packet.sceneId) && string(packet.target?.id) && SCENE_OBJECT_TYPES.includes(packet.target?.type)
    && (packet.actorTokenId == null || string(packet.actorTokenId)) && (packet.kind !== "action" || string(packet.actionId));
}
export class ObjectInteractionService {
  constructor(runtime,{noteOpened}={}) {
    this.runtime=runtime; this.noteOpened=noteOpened; this.pending=new Map(); this.receipts=new Map(); this.disposed=false;
    this.chat=generics.chat.createMessageService({ownerId:MODULE_ID,channel:CHANNEL});
    this.cleanup=new TechnicalMessageCleanup({current:()=>!this.disposed && isAuthority(),
      onError:(error,messageId)=>debugError("interaction","receipt-cleanup",error,{messageId})});
  }
  async inspect(scene,target,actor,user) {
    const choices=listAvailableInteractions(scene,target,actor,user), result=[];
    for(const choice of choices) {
      if(choice.disabled || !choice.conditionMacro) { result.push(choice); continue; }
      try {
        const allowed=await evaluateInteractionMacro(scene,{target,conditionMacro:choice.conditionMacro,runtime:getRuntime(scene,{groupId:choice.groupId}),actorToken:actor,user,current:()=> !this.disposed && isAuthority()});
        if(allowed) result.push(choice); else if(choice.showWhenUnavailable) result.push({...choice,disabled:true});
      } catch(error) { debugError("interaction","condition.failed",error,{sceneId:scene.id,target}); if(choice.showWhenUnavailable) result.push({...choice,disabled:true}); }
    }
    return result.map(({conditionMacro,showWhenUnavailable,...choice})=>choice);
  }
  async execute(packet,user) {
    if(this.disposed || !isAuthority() || !user || generics.chat.isManagedIdentityUser(user)) reject();
    if(!validPacket(packet)) reject();
    const key=`${user.id}:${packet.requestId}`,signature=JSON.stringify(packet),previous=this.receipts.get(key);
    if(previous) { if(previous.signature !== signature) reject(); return previous.promise; }
    while(this.receipts.size >= 200) {
      const removable=[...this.receipts].find(([,receipt])=>receipt.done);
      if(!removable) reject(); this.receipts.delete(removable[0]);
    }
    const receipt={signature,done:false};
    receipt.promise=Promise.resolve().then(()=>this.executeNew(packet,user)).finally(()=>{receipt.done=true;});
    this.receipts.set(key,receipt); return receipt.promise;
  }
  async executeNew(packet,user) {
    if(this.disposed || !isAuthority()) reject();
    const scene=game.scenes?.get(packet.sceneId), target=packet.target;
    if(!scene || canvas.scene?.id !== scene.id || !getSceneObject(scene,target)) reject();
    const actor=scene.tokens?.get(packet.actorTokenId);
    if(packet.kind === "inspect") return {choices:await this.inspect(scene,target,actor,user)};
    if(packet.kind === "note-opened") {
      const note=getSceneObject(scene,target), entry=note?.entry;
      if(target.type !== "Note" || !entry || !user.isGM && (!entry.testUserPermission?.(user,"OBSERVER") || isSceneObjectHidden(note))) reject();
      await this.noteOpened?.(note,user.id); return {ok:true};
    }
    if(packet.kind !== "action") reject();
    const preparation=getObjectBindings(scene).revision;
    const choices=await this.inspect(scene,target,actor,user), choice=choices.find(entry => entry.kind === "action" && entry.id === packet.actionId && !entry.disabled);
    if(!choice) reject();
    await withSceneLock(scene,async()=>{
      if(this.disposed || !isAuthority() || canvas.scene?.id !== scene.id || getObjectBindings(scene).revision !== preparation) reject();
      const binding=getObjectBindings(scene).bindings[objectKey(target)], action=binding?.actions.find(entry=>entry.id===packet.actionId);
      const actionCurrent=()=>{
        const actions=getObjectBindings(scene).bindings[objectKey(target)]?.actions ?? [];
        return !this.disposed && isAuthority() && actions.some(entry=>entry.id === action?.id && entry.enabled)
          && collectionEntryAllowed("actions",actions,action);
      };
      const run=getRuntime(scene,{groupId:binding?.groupId});
      if(!action || !action.enabled || run.runId !== choice.runId) reject();
      validateObjectActionAccess({scene,runtime:run,descriptor:{...action,actionId:action.id,target},target:getSceneObject(scene,target),conditionType:"action"},packet.actorTokenId,user,choice.runId);
      if(this.runtime.commandExecutor?.activeForObject(scene,target) || [...this.runtime.manualRuns.values()].some(active=>active.sceneId===scene.id && objectKey(active.target)===objectKey(target))) reject();
      consumeCondition(run,getConditionKey(run,"action",`${objectKey(target)}:${action.id}`),action.conditions); await saveRuntime(scene,run);
      // Storage is not physically cancellable. Recheck the execution after its
      // acknowledgement, before giving the accepted action any side effects.
      const live=getRuntime(scene,{groupId:binding.groupId});
      if(!actionCurrent() || canvas.scene?.id !== scene.id || getObjectBindings(scene).revision !== preparation
        || live.runId !== run.runId || isExecutionHalted(scene,live) || !getSceneObject(scene,target)
        || live.disabledObjects.includes(objectKey(target)) || scene.getFlag(MODULE_ID,"objectBehaviorState")?.[objectKey(target)] === false) reject();
      const signal=objectActionContract(target,action),script=binding.reactionScripts.find(entry=>entry.actionId===action.id)?.script;
      commandTrace("object-action.started",{sceneId:scene.id,target,userId:user.id,actionId:packet.actionId});
      // Claim the object before releasing the admission queue. Do not await the
      // script: its ordinary interpreter needs that same queue on later ticks.
      void this.runtime.invocations.run(scene,{target,script,purpose:"reaction",action,signal,parentRunId:run.runId,
        parameters:{objectUuid:getSceneObject(scene,target).uuid,actorTokenUuid:actor?.uuid ?? null,actionId:action.id,parametersJson:JSON.stringify(action.parameters)},
        current:actionCurrent}).catch(error=>this.runtime.report(error,{category:"interaction",event:"reaction.failed",context:{sceneId:scene.id,target}}));
    });
    return {ok:true};
  }
  request(packet) {
    const command={...packet,requestId:foundry.utils.randomID()};
    if(isAuthority()) return this.execute(command,game.user);
    return requestGMReply(this.chat,{command,commandFlag:REQUEST,responseFlag:RESULT,content:text("Ширма: взаимодействие с объектом.","Master screen: object interaction."),kind:CHANNEL,
      timeoutMessage:text("Мастер не ответил на запрос взаимодействия.","The GM did not respond to the interaction request.")}).then(result=>{if(result.error) throw new Error(result.error); return result;});
  }
  async processMessage(message,userId) {
    const packet=message.getFlag?.(MODULE_ID,REQUEST); if(!packet || !isAuthority() || this.disposed) return false;
    const metadata=generics.chat.getChatMetadata(message),author=generics.chat.getMessageAuthorId(message);
    if(metadata?.ownerId !== MODULE_ID || metadata.channel !== CHANNEL || metadata.kind !== CHANNEL || !metadata.technical || author !== userId || !message.whisper?.includes(game.user.id) || !message.whisper.includes(author)) return false;
    if(message.getFlag(MODULE_ID,RESULT) != null || this.pending.has(message.id)) return true;
    const task=Promise.resolve().then(()=>this.execute(packet,game.users.get(author))).catch(error=>{
      debugError("interaction","request.failed",error,{sceneId:packet.sceneId,userId:author});
      return {error:text("Взаимодействие сейчас недоступно. Проверьте персонажа и условия действия.","Interaction is unavailable. Check your character and the action conditions.")};
    }).then(async result=>{
      if(!isAuthority() || this.disposed) return;
      await message.update({[`flags.${MODULE_ID}.${RESULT}`]:result,content:""}); this.cleanup.queue(message);
    }).finally(()=>this.pending.delete(message.id));
    this.pending.set(message.id,task); await task; return true;
  }
  dispose(){this.disposed=true;this.pending.clear();this.receipts.clear();this.cleanup.dispose();this.runtime.invocations?.reconcile(globalThis.canvas?.scene);}
}
