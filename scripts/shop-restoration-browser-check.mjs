import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/shop-restoration-review");
await fs.mkdir(output, { recursive: true });
try {
  for (const version of ["13.351", "14.366"]) for (const lang of ["ru", "en"]) {
    const context = await browser.newContext({viewport:{width:1440,height:1000}}), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${lang}`); await page.waitForFunction(()=>globalThis.ready);
    await page.evaluate(async () => {
      const {normalizeShopAsset} = await import("/modules/dmicher-master-screen/scripts/interaction-model.js");
      const {normalizeObjectBinding} = await import("/modules/dmicher-master-screen/scripts/object-binding-model.js");
      const {generics} = await import("/modules/dmicher-master-screen/scripts/generics.js");
      const {masterScreenExtension} = await import("/modules/dmicher-premium/sctipts/features/master-screen/index.js");
      const flags=scene.flags["dmicher-master-screen"];
      flags.interactionCatalog={schemaVersion:1,revision:0,shops:[normalizeShopAsset({id:"shop",name:"Market",items:[]})],dialogues:[]};
      flags.objectBindings.bindings["Token:guard"]=normalizeObjectBinding({...flags.objectBindings.bindings["Token:guard"],shops:[{shopId:"shop",stateIds:["calm"],restoration:{activation:"state-entry",conditionMacro:"return false;"}}]});
      globalThis.shopPremium=false;
      globalThis.shopProvider=generics.premium.registerProvider({apiVersion:1,hasAccess:()=>globalThis.shopPremium,extensions:[masterScreenExtension]});
      controller.openObjectAutomation({type:"Token",id:"guard"});
    });
    const app=page.locator(".ms-object-behavior");
    await app.locator('[data-screen-action="tab"][data-tab="shops"]').click();
    await app.locator('[data-screen-action="edit-feature"]').first().click();
    const block=app.locator("[data-shop-restoration]"), activation=block.locator('[name="shop-restoration-activation"]'), macro=block.locator('[name="shop-restoration-macro"]');
    await block.locator(":scope > summary").click();
    assert.equal(await activation.inputValue(),"state-entry");
    assert.equal(await activation.isDisabled(),false,"manual remains available without Premium");
    assert.equal(await activation.locator('[value="scene-activation"]').evaluate(node=>node.disabled),true);
    assert.equal(await macro.isDisabled(),true);
    assert.equal(await app.locator('[data-conditions-fields="feature-conditions"] [name="feature-macro"]').count(),1,"launch macro is inside launch conditions");
    await app.screenshot({path:path.join(output,`${version}-${lang}-free.png`)});
    await app.locator('footer [data-screen-action="save"]').click();
    assert.deepEqual(await page.evaluate(()=>scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"].shops[0].restoration),{activation:"state-entry",conditionMacro:"return false;"});
    await page.evaluate(()=>{globalThis.shopPremium=true;shopProvider.notifyChanged();});
    await activation.selectOption("scene-activation");
    await block.locator(".ms-condition-macro > summary").click();
    await macro.fill("return variables.stock !== 0;");
    await app.screenshot({path:path.join(output,`${version}-${lang}-premium.png`)});
    await app.locator('footer [data-screen-action="save"]').click();
    assert.deepEqual(await page.evaluate(()=>scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"].shops[0].restoration),{activation:"scene-activation",conditionMacro:"return variables.stock !== 0;"});
    await page.evaluate(()=>{globalThis.shopPremium=false;shopProvider.notifyChanged();});
    assert.equal(await macro.isDisabled(),true);
    await activation.selectOption("manual");
    await app.locator('footer [data-screen-action="save"]').click();
    assert.deepEqual(await page.evaluate(()=>scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"].shops[0].restoration),{activation:"manual",conditionMacro:"return variables.stock !== 0;"});
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`${version} ${lang}: shop restoration, live Premium changes, preservation and free manual mode passed`);
  }
} finally {await browser.close();await fixture.close();}
