import assert from "node:assert/strict";
import { startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const lang of ["ru", "en"]) {
    const page = await browser.newPage({ viewport:{width:1100,height:800} });
    page.setDefaultTimeout(7000);
    const errors=[]; page.on("pageerror", error=>errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${lang}`); await page.waitForFunction(()=>globalThis.ready);
    await page.evaluate(async () => {
      await controller.closeScreen();
      const { pickCommandTarget } = await import("/modules/dmicher-master-screen/scripts/command-target-session.js");
      const { ObjectContextMenu } = await import("/modules/dmicher-master-screen/scripts/apps/object-context-menu.js");
      const view = document.getElementById("board"), hooks = new Map();
      const scene = {id:"task-map",tokens:new Map(),walls:new Map(),grid:{size:100}};
      const make = (id,x)=>({id,documentName:"Token",parent:scene,x,y:350,width:1,height:1});
      const actor=make("hero",100), executor=make("executor",250), wall={id:"door",documentName:"Wall",parent:scene,c:[500,300,500,600],door:1};
      for(const doc of [actor,executor,wall]) doc.object={document:doc,x:doc.x,y:doc.y,w:100,h:100};
      scene.tokens.set(actor.id,actor);scene.tokens.set(executor.id,executor);scene.walls.set(wall.id,wall);
      const stage={toLocal:point=>point,scale:{x:1}},board={scene,stage,app:{view},tokens:{placeables:[actor.object,executor.object]},walls:{placeables:[wall.object]},activeLayer:{placeables:[]}};
      globalThis.canvas=board;globalThis.testNativePresses=0;
      view.addEventListener("pointerdown",()=>globalThis.testNativePresses++);
      globalThis.testMenu = new ObjectContextMenu();
      globalThis.startTarget = () => {
        globalThis.testResult="pending";
        globalThis.testPicking=pickCommandTarget({scene,actor,executor,board,document,menu:testMenu,visible:()=>true,
          commands:target=>target.type==="Wall"?[{id:"open"}]:[],
          header:()=>({actor:"Hero",target:"Influence Gate"}),
          hooks:{on(name,fn){hooks.set(name,fn);return fn;},off(name){hooks.delete(name);}}});
        testPicking.then(result=>globalThis.testResult=result);
      };
      globalThis.tearDownTarget=()=>hooks.get("canvasTearDown")?.();
      globalThis.remainingTargetHooks=()=>hooks.size;
    });
    await page.evaluate(()=>startTarget());
    await page.mouse.click(500,450);
    await page.locator(".ms-object-menu").waitFor();
    assert.equal(await page.evaluate(()=>testNativePresses),0,"native door/drag press is blocked before dispatch");
    assert.equal(await page.locator(".ms-object-menu-heading strong").textContent(),"Hero");
    await page.locator('.ms-object-menu button[role="menuitem"]').click();
    await page.waitForFunction(()=>testResult!=="pending");
    assert.deepEqual(await page.evaluate(()=>testResult),{target:{type:"Wall",id:"door"},commandId:"open",delegateTokenId:"executor"});
    assert.equal(await page.evaluate(()=>remainingTargetHooks()),0);
    await page.mouse.click(700,600);assert.equal(await page.evaluate(()=>testNativePresses),1,"ordinary clicks resume");
    for(const cancel of ["escape","teardown","outside"]){
      await page.evaluate(()=>startTarget());
      if(cancel==="escape") await page.keyboard.press("Escape");
      if(cancel==="teardown") await page.evaluate(()=>tearDownTarget());
      if(cancel==="outside"){await page.mouse.click(500,450);await page.mouse.click(800,650);}
      await page.waitForFunction(()=>testResult===null);
      assert.equal(await page.evaluate(()=>remainingTargetHooks()),0,cancel);
    }
    assert.deepEqual(errors,[]);reports.push({version,lang,passed:true});await page.close();
  }
  process.stdout.write(`${JSON.stringify(reports,null,2)}\n`);
} finally { await browser.close();await fixture.close(); }
