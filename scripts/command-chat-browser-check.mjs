import assert from "node:assert/strict";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

// Two isolated clients, native browser timers and DOM, synthetic document relay.
// No user world, actors, tokens or ChatMessages are accessed.
const fixture=await startBrowserFixture(),browser=await launchFixtureBrowser();
try {
  for (const version of ["13.351","14.366"]) {
    const clients=await Promise.all(["gm","player"].map(async role=>{
      const context=await browser.newContext(),page=await context.newPage();
      await page.goto(`${fixture.origin}/?version=${version}&lang=en`);await page.waitForFunction(()=>globalThis.ready);
      return {context,page,role};
    }));
    const records=new Map();let sequence=0;
    const relay=async(method,data)=>Promise.all(clients.map(client=>client.page.evaluate(({method,data})=>globalThis[method](data),{method,data})));
    for(const {page} of clients) {
      await page.exposeFunction("createTransport",async data=>{
        const raw={...data,id:`message-${++sequence}`};records.set(raw.id,raw);
        await relay("receiveTransport",{raw,created:true});return raw;
      });
      await page.exposeFunction("updateTransport",async({id,changes})=>{
        const raw=records.get(id);
        for(const [key,value] of Object.entries(changes)) {
          const parts=key.split(".");let target=raw;
          for(const part of parts.slice(0,-1)) target=target[part]??={};
          target[parts.at(-1)]=value;
        }
        await relay("receiveTransport",{raw,created:false});return raw;
      });
      await page.exposeFunction("deleteTransport",async id=>{records.delete(id);await relay("removeTransport",id);});
    }
    for (const {page,role} of clients) await page.evaluate(async role=>{
      const {generics}=await import("/modules/dmicher-master-screen/scripts/generics.js");
      const {ObjectCommandService}=await import("/modules/dmicher-master-screen/scripts/object-command-service.js");
      const {ObjectInteractionService}=await import("/modules/dmicher-master-screen/scripts/object-interaction-service.js");
      const gm={id:"gm",name:"GM",isGM:true,role:4,active:true},player={id:"player",name:"Vadim",isGM:false,role:1,active:true};
      game.users=new Map([[gm.id,gm],[player.id,player]]);game.user=role==="gm"?gm:player;
      globalThis.transportErrors=[];globalThis.accepted=[];globalThis.hiddenStates=[];
      globalThis.commandService=new ObjectCommandService({executor:{accept:async(_scene,packet,user)=>{accepted.push([packet.commandId,user.id]);return {runId:"accepted"};}}});
      globalThis.interactionService=new ObjectInteractionService({});
      interactionService.execute=async(packet,user)=>{accepted.push([packet.kind,user.id]);return {ok:true};};
      const chat=document.createElement("ol");chat.id="transport-chat";document.body.append(chat);
      const hydrate=raw=>({...structuredClone(raw),getFlag(scope,key){return this.flags?.[scope]?.[key];},
        update:changes=>updateTransport({id:raw.id,changes}),delete:()=>deleteTransport(raw.id)});
      globalThis.receiveTransport=({raw,created})=>{
        const message=hydrate(raw);game.messages.set(message.id,message);
        let element=document.getElementById(raw.id);
        if(!element){element=document.createElement("li");element.id=raw.id;element.className="chat-message";chat.append(element);}
        element.innerHTML='<header>Vadim to GM and Vadim</header><div class="message-content"></div>';
        element.querySelector(".message-content").textContent=raw.content;
        generics.chat.renderChatMessageVisibility(message,element);
        hiddenStates.push(getComputedStyle(element).display==="none");
        if(created && game.user.isGM) {
          void commandService.processMessage(message,raw.author).catch(error=>transportErrors.push(error.message));
          void interactionService.processMessage(message,raw.author).catch(error=>transportErrors.push(error.message));
        } else if(!created) Hooks.callAll("updateChatMessage",message);
      };
      globalThis.removeTransport=id=>{game.messages.delete(id);document.getElementById(id)?.remove();};
      globalThis.CONFIG??={};CONFIG.ChatMessage={documentClass:{create:async data=>hydrate(await createTransport(data))}};
      globalThis.checkOldTimer=()=>{const old={schedule:globalThis.setTimeout};try {const id=old.schedule(()=>{},1);clearTimeout(id);return "no error";}catch(error){return error.message;}};
    },role);
    const gm=clients[0].page,player=clients[1].page;
    assert.match(await gm.evaluate(()=>checkOldTimer()),/Illegal invocation/);
    const result=await player.evaluate(async()=>{
      const inspect=await interactionService.request({kind:"inspect",sceneId:scene.id,target:{type:"Token",id:"guard"},actorTokenId:"waiter"});
      const command=await commandService.request({scene,target:{type:"Token",id:"guard"},actorTokenId:"waiter",commandId:"come"});
      const action=await interactionService.request({kind:"action",sceneId:scene.id,target:{type:"Token",id:"guard"},actorTokenId:"waiter",actionId:"news"});
      return [inspect,command,action];
    });
    assert.ok(result.every(reply=>reply.ok===true));
    await gm.waitForFunction(()=>game.messages.size===0,{},{timeout:5000});
    for (const {page} of clients) {
      const state=await page.evaluate(()=>({errors:transportErrors,hidden:hiddenStates,messages:game.messages.size,cards:document.querySelectorAll("#transport-chat li").length}));
      assert.deepEqual(state.errors,[]);assert.equal(state.messages,0);assert.equal(state.cards,0);
      assert.equal(state.hidden.length,6);assert.ok(state.hidden.every(Boolean));
    }
    assert.deepEqual(await gm.evaluate(()=>accepted),[["inspect","player"],["come","player"],["action","player"]]);
    // Ordinary technical cards and game speech must not disappear.
    assert.deepEqual(await player.evaluate(async()=>{
      const {generics}=await import("/modules/dmicher-master-screen/scripts/generics.js");
      return ["trade-request","dialogue","object-command","object-interaction"].map(channel=>{
        const node=document.createElement("li");node.textContent=channel;document.body.append(node);
        generics.chat.renderChatMessageVisibility({flags:{"dmicher-generics":{chat:{apiVersion:1,ownerId:"dmicher-master-screen",technical:true,channel,kind:channel}}}},node);
        return !node.hidden && getComputedStyle(node).display!=="none";
      });
    }),[true,true,true,true]);
    for(const {page,context} of clients){await page.evaluate(()=>{commandService.dispose();interactionService.dispose();});await context.close();}
    console.log(`${version}: old timer reproduced; GM/player requests acknowledged once, cards hidden at create/update and removed without errors`);
  }
} finally {await browser.close();await fixture.close();}
