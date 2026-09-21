import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { workspace, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/object-automation-review");
await fs.mkdir(output, { recursive:true });
try {
  for (const version of ["13.351", "14.366"]) for (const lang of ["ru", "en"]) {
    const context = await browser.newContext({viewport:{width:1440,height:1000}}), page = await context.newPage(), errors=[];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${fixture.origin}/?version=${version}&lang=${lang}`); await page.waitForFunction(()=>globalThis.ready);
    await page.evaluate(()=>controller.openObjectAutomation({type:"Token",id:"guard"}));
    const app=page.locator(".ms-object-behavior");
    assert.equal(await app.locator('[data-screen-action="tab"]').count(),6);
    assert.equal(await app.locator('[data-screen-action="tab"][aria-pressed="true"]').getAttribute("data-tab"),"information");
    assert.equal(await app.locator('[name="object-automation-enabled"]').isChecked(),true);
    await app.locator('[name="object-display-name"]').fill("Menu guard");
    await app.locator('[data-screen-action="tab"][data-tab="properties"]').click();
    await app.locator('[data-screen-action="property-tab"][data-tab="variables"]').click();
    await app.locator('[data-screen-action="add-variable"]').click();
    await app.locator('[name="variable-0-name"]').fill("mood");
    await app.locator('[name="variable-0-value"]').fill("calm");
    await app.locator('[data-screen-action="property-tab"][data-tab="actions"]').click();
    await app.locator('[data-screen-action="add-action"]').click();
    await app.locator('[name="action-name"]').fill("Greet");
    await app.locator('[name="action-enabled"]').check();
    await app.locator('[data-screen-action="tab"][data-tab="behavior"]').click();
    await app.locator('[data-screen-action="behavior-tab"][data-tab="reaction"]').click();
    await app.locator('[data-screen-action="edit-script"]').click();
    await app.locator('[data-screen-action="add-script-step"]').click();
    const step=app.locator('[data-script-step="0"]');
    assert.equal(await step.locator('[data-script-kind]').inputValue(),"wait");
    await step.locator('[data-script-kind-button]').click();
    const catalog=page.locator('.dmicher-catalog-dialog'); await catalog.waitFor();
    const functionIds=await catalog.locator('[data-dmicher-catalog-entry]').evaluateAll(nodes=>nodes.map(node=>node.dataset.dmicherCatalogEntry));
    for(const id of ["wait","pause","automation","visibility","focus","macro"]) assert.ok(functionIds.includes(id));
    assert.equal(await catalog.locator('[data-dmicher-catalog-entry="focus"] button').isDisabled(),true);
    assert.ok(await catalog.locator('[data-dmicher-catalog-entry="focus"] .dmicher-premium-badge').count());
    await catalog.locator('[data-dmicher-catalog-entry="visibility"] button').click();
    await page.waitForFunction(()=>document.querySelector('.ms-object-behavior [data-script-kind]')?.value==="visibility");
    await step.locator('[data-script-transition-mode]').selectOption("macro");
    assert.ok((await step.locator('[data-transition-source]').inputValue()).includes("return"));
    await step.locator('[data-script-transition-mode]').selectOption("next");
    assert.equal(await step.locator('[data-transition-source]').isVisible(),false);
    await step.locator('[data-script-kind-button]').click();
    await page.locator('.dmicher-catalog-dialog [data-dmicher-catalog-entry="wait"] button').click();
    await page.waitForFunction(()=>document.querySelector('.ms-object-behavior [data-script-kind]')?.value==="wait");
    await step.locator('[data-script-param]').fill("1.5");
    await app.screenshot({path:path.join(output,`${version}-${lang}-reaction.png`)});
    await app.locator('footer [data-screen-action="save"]').click();
    const saved=await page.evaluate(()=>scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"]);
    assert.equal(saved.variables[0].name,"mood"); assert.equal(saved.variables[0].value,"calm");
    assert.equal(saved.displayName,"Menu guard");
    assert.equal(saved.actions[0].name,"Greet"); assert.equal(saved.reactionScripts[0].actionId,saved.actions[0].id);
    assert.equal(saved.reactionScripts[0].script.steps[0].parameters.seconds,1.5);
    for(const tab of ["information","states","shops","dialogues"]){
      await app.locator(`[data-screen-action="tab"][data-tab="${tab}"]`).click();
      assert.ok(await app.locator('footer [data-screen-action="save"]').isVisible());
    }
    await app.locator('[data-screen-action="tab"][data-tab="information"]').click();
    await app.locator('[name="object-player-character"]').check();
    await app.locator('footer [data-screen-action="save"]').click();
    await page.waitForFunction(()=>scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"].playerCharacter===true);
    assert.equal(await app.locator('[name="object-automation-enabled"]').isChecked(),true);
    await app.locator('[data-screen-action="tab"][data-tab="behavior"]').click();
    assert.equal(await app.locator('[data-screen-action="behavior-tab"][data-tab="routine"]').count(),0);
    assert.equal(await app.locator('[data-screen-action="behavior-tab"][data-tab="event"]').count(),1);
    assert.equal(await app.locator('[data-screen-action="behavior-tab"][data-tab="reaction"]').count(),1);
    await app.locator('[data-screen-action="tab"][data-tab="information"]').click();
    await app.locator('[name="object-automation-enabled"]').uncheck();
    await app.locator('footer [data-screen-action="save"]').click();
    await page.waitForFunction(()=>scene.flags["dmicher-master-screen"].groupRuntimes?.players?.disabledObjects?.includes("Token:guard"));
    await app.screenshot({path:path.join(output,`${version}-${lang}-dialogues.png`)});
    assert.deepEqual(errors,[]); await context.close(); console.log(`${version} ${lang}: unified tabs, variables, reactions, free transitions and Premium gating passed`);
  }
} finally { await browser.close(); await fixture.close(); }
