import test from "node:test";
import assert from "node:assert/strict";
import { PlayerCommandConsent, commandConsentRequirement } from "../dmicher-master-screen/scripts/player-command-consent.js";
import { MODULE_ID } from "../dmicher-master-screen/scripts/model.js";
import { notifyExecutionChange, requestSceneHalt } from "../dmicher-master-screen/scripts/execution.js";
import { commandFixture } from "./fixtures/object-commands.js";
import { ObjectCommandService } from "../dmicher-master-screen/scripts/object-command-service.js";
import { defaultObjectCommand } from "../dmicher-master-screen/scripts/object-command-model.js";

function fixture() {
  const gm={id:"gm",isGM:true,role:4,active:true}, issuer={id:"issuer",role:1,active:true,viewedScene:"scene"}, owner={id:"owner",role:1,active:true}, other={id:"other",role:1,active:true};
  let valid=true, current=true, sequence=0, executions=0; const sent=[], hooks=new Map();
  const scene={id:"scene",uuid:"Scene.scene",tokens:new Map(),getFlag:()=>({bindings:{"Token:executor":{playerCharacter:true}}})};
  const token=(id,owns)=>({id,name:id,uuid:`Scene.scene.Token.${id}`,documentName:"Token",parent:scene,actor:{testUserPermission:user=>user.isGM||owns.includes(user.id)}});
  const actor=token("actor",[issuer.id]),executor=token("executor",[owner.id]);scene.tokens.set(actor.id,actor);scene.tokens.set(executor.id,executor);
  globalThis.canvas={scene};globalThis.game={user:gm,users:new Map([gm,issuer,owner,other].map(user=>[user.id,user])),scenes:new Map([[scene.id,scene]]),modules:new Map(),i18n:{lang:"en"},settings:{get:()=>false}};
  globalThis.foundry={utils:{randomID:()=>`id-${++sequence}`}};
  globalThis.Hooks={on(name,fn){hooks.set(name,fn);return fn;},off(name){hooks.delete(name);}};
  const chat={async create(data,options){const message={...data,id:`message-${++sequence}`,whisper:options.audience.userIds,
    getFlag(scope,key){return this.flags?.[scope]?.[key];},async update(changes){for(const [key,value]of Object.entries(changes)){if(key.startsWith(`flags.${MODULE_ID}.`))this.flags[MODULE_ID][key.slice(`flags.${MODULE_ID}.`.length)]=value;else this[key]=value;}}};sent.push({message,options});return [message];}};
  const consent=new PlayerCommandConsent({chat,authority:()=>current,onError:error=>{throw error;}});consent.install();
  const packet={version:1,requestId:"original",sceneId:scene.id,actorTokenUuid:actor.uuid,targetUuid:executor.uuid,commandId:"wait",parameters:{}};
  const request=()=>consent.request({scene,packet,user:issuer,validate:()=>{if(!valid)throw Error("changed");return "snapshot";},execute:async isCurrent=>{assert.equal(isCurrent(),true);executions++;return {runId:"run"};}});
  return {consent,gm,issuer,owner,other,scene,actor,executor,packet,request,sent,hooks,executions:()=>executions,
    invalidate:()=>{valid=false;},loseAuthority:()=>{current=false;}};
}
test("only another player's marked character requires consent; GM and direct owner do not",()=>{
  const f=fixture();assert.equal(commandConsentRequirement(f.scene,f.packet,f.issuer).executor,f.executor);
  assert.equal(commandConsentRequirement(f.scene,f.packet,f.owner),null);assert.equal(commandConsentRequirement(f.scene,f.packet,f.gm),null);
  f.scene.getFlag=()=>({bindings:{}});assert.equal(commandConsentRequirement(f.scene,f.packet,f.issuer),null);f.consent.dispose();
});
test("two private cards do not execute silently; first valid owner or GM answer wins",async()=>{
  const f=fixture(),result=await f.request();assert.equal(result.pendingConsent,true);assert.equal(f.sent.length,2);assert.equal(f.executions(),0);
  assert.deepEqual(f.sent[0].options.audience.userIds,["owner"]);assert.deepEqual(f.sent[1].options.audience.userIds,["gm"]);
  assert.equal(await f.consent.answer(result.consentId,true,f.other),false);assert.equal(f.executions(),0);
  const yes=f.consent.answer(result.consentId,true,f.owner),no=f.consent.answer(result.consentId,false,f.gm);
  assert.equal(await yes,true);assert.equal(await no,false);assert.equal(f.executions(),1);assert.equal(f.consent.pending.size,0);
  assert.ok(f.sent.every(entry=>entry.message.getFlag(MODULE_ID,"playerCommandConsent").status==="accepted"));f.consent.dispose();
});
test("decline, changed access, scene exit, deletion and world halt cancel without execution",async()=>{
  for(const reason of ["no","access","scene","delete","halt","dispose"]){
    const f=fixture(),result=await f.request();
    if(reason==="no")await f.consent.answer(result.consentId,false,f.owner);
    if(reason==="access"){f.invalidate();await f.consent.answer(result.consentId,true,f.owner);}
    if(reason==="scene"){f.issuer.viewedScene="elsewhere";f.hooks.get("updateUser")(f.issuer);}
    if(reason==="delete")f.hooks.get("deleteToken")(f.executor);
    if(reason==="halt")notifyExecutionChange(f.scene,"halt-all");
    if(reason==="dispose")f.consent.dispose();
    assert.equal(f.executions(),0,reason);assert.equal(f.consent.pending.size,0,reason);f.consent.dispose();
  }
});
test("loss of ownership or authority cannot approve a stale card",async()=>{
  const f=fixture(),result=await f.request();f.executor.actor.testUserPermission=()=>false;
  assert.equal(await f.consent.answer(result.consentId,true,f.owner),false);assert.equal(f.executions(),0);
  f.loseAuthority();assert.equal(await f.consent.answer(result.consentId,true,f.gm),false);f.consent.dispose();
});
test("untrusted or public consent answers cannot execute commands",async()=>{
  const f=fixture(),result=await f.request();
  const reply=(author=f.owner.id)=>({id:"reply",author,whisper:[f.gm.id,author],flags:{[MODULE_ID]:{playerCommandConsentReply:{id:result.consentId,yes:true}},"dmicher-generics":{chat:{apiVersion:1,ownerId:MODULE_ID,channel:"object-command",kind:"player-command-consent-reply",technical:true,display:"hidden"}}},getFlag(scope,key){return this.flags[scope]?.[key];}});
  const publicReply=reply();publicReply.whisper=[];assert.equal(await f.consent.processMessage(publicReply,f.owner.id),false);
  const forged=reply();forged.flags["dmicher-generics"].chat.ownerId="another";assert.equal(await f.consent.processMessage(forged,f.owner.id),false);
  assert.equal(await f.consent.processMessage(reply(),f.other.id),false);
  assert.equal(await f.consent.processMessage(reply(f.other.id),f.other.id),false);assert.equal(f.executions(),0);
  assert.equal(await f.consent.processMessage(reply(),f.owner.id),true);assert.equal(f.executions(),1);f.consent.dispose();
});
test("real command service admits a foreign player command only after consent and preserves executor validation",async()=>{
  const f=await commandFixture({commands:["wait"]}), owner={id:"owner",name:"Owner",role:1,active:true,isGM:false};
  game.users.set(owner.id,owner);f.npc.actor.testUserPermission=user=>user.isGM||user.id===owner.id;
  f.binding.playerCharacter=true;f.binding.groupId="players";
  await f.runtime.enter(f.scene,"default",{groupId:"players"});
  const messages=[];
  const chat={async create(data,options){const message={...data,id:`consent-${messages.length}`,whisper:options.audience.userIds,async update(){}};messages.push(message);return[message];}};
  const service=new ObjectCommandService({executor:f.executor,chat,authority:()=>true});
  const result=await service.execute({...f.packet("wait"),method:"player"},f.player);
  assert.equal(result.pendingConsent,true);assert.equal(f.active(),null);assert.equal(messages.length,2);
  assert.equal(await service.consent.answer(result.consentId,true,owner),true);
  assert.equal(f.active()?.config.id,"wait");assert.equal(f.active()?.request.userId,f.player.id);
  service.dispose();
});
test("world stop during the approved command's async validation revokes the late result",async()=>{
  let release;
  const f=await commandFixture({commands:["wait"],emit:async(_scene,signal)=>signal.name==="commandRequested"?new Promise(resolve=>{release=resolve;}):{allowed:true}});
  const owner={id:"owner",role:1,active:true,isGM:false};game.users.set(owner.id,owner);
  f.npc.actor.testUserPermission=user=>user.isGM||user.id===owner.id;f.binding.playerCharacter=true;f.binding.groupId="players";
  await f.runtime.enter(f.scene,"default",{groupId:"players"});
  const chat={async create(data){return[{...data,id:Math.random().toString(),async update(){}}];}};
  const service=new ObjectCommandService({executor:f.executor,chat,authority:()=>true});
  const result=await service.execute({...f.packet("wait"),method:"player"},f.player);
  const answer=service.consent.answer(result.consentId,true,owner);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  requestSceneHalt(f.scene);release({allowed:true});
  assert.equal(await answer,false);assert.equal(f.active(),null);assert.equal(service.consent.pending.size,0);service.dispose();
});
test("delegated endpoint player also needs consent outside the scene queue, revoked by cancelling its parent",async()=>{
  for(const cancel of [false,true]){
    const f=await commandFixture({commands:["delegate"]}),owner={id:"owner",role:1,isGM:false,active:true};game.users.set(owner.id,owner);
    const endpoint={...f.npc,id:"endpoint",uuid:"Scene.scene.Token.endpoint",name:"Endpoint",x:150,actor:{testUserPermission:user=>user.isGM||user.id===owner.id}};
    f.scene.tokens.set(endpoint.id,endpoint);
    f.flags.objectBindings.bindings["Token:endpoint"]={type:"Token",id:endpoint.id,groupId:"players",playerCharacter:true,commands:[{...defaultObjectCommand("wait"),enabled:true}]};
    await f.runtime.enter(f.scene,"default",{groupId:"players"});
    const chat={async create(data){return[{...data,id:Math.random().toString(),async update(){}}];}};
    const service=new ObjectCommandService({executor:f.executor,chat,authority:()=>true});
    const result=await service.execute({...f.packet("wait"),method:"delegated",targetUuid:endpoint.uuid,delegateTokenUuid:f.npc.uuid},f.player);
    assert.equal(result.ok,true);assert.equal(result.pendingConsent,undefined);
    for(let n=0;n<40 && !service.consent.pending.size;n++)await f.tick(100);
    assert.equal(service.consent.pending.size,1);assert.equal(f.executor.activeForObject(f.scene,{type:"Token",id:endpoint.id}),null);
    const entry=[...service.consent.pending.values()][0];
    if(cancel){f.executor.stopPresentation(f.scene,f.active());assert.equal(service.consent.pending.size,0);assert.equal(await service.consent.answer(entry.id,true,owner),false);}
    else {assert.equal(await service.consent.answer(entry.id,true,owner),true);assert.equal(f.executor.activeForObject(f.scene,{type:"Token",id:endpoint.id})?.config.id,"wait");}
    service.dispose();f.runtime.dispose();
  }
});
