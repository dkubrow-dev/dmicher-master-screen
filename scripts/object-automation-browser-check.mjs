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
    assert.deepEqual(await step.locator('[data-script-kind] option').evaluateAll(nodes=>nodes.map(node=>node.value)),[
      "wait","move","approach","follow","speech","emotion","dialogue","shop","command","visibility","focus","sound","playlist","state","windows","notes","signal","macro"]);
    await step.locator('[data-script-transition-mode]').selectOption("macro");
    assert.ok((await step.locator('[data-transition-source]').inputValue()).includes("return"));
    await step.locator('[data-script-transition-mode]').selectOption("next");
    assert.equal(await step.locator('[data-transition-source]').isVisible(),false);
    await step.locator('[data-script-kind]').selectOption("focus");
    assert.ok(await step.locator('.dmicher-premium-badge').count());
    assert.equal(await step.locator('[data-script-parameter-fields] select').first().isDisabled(),true);
    await step.locator('[data-script-kind]').selectOption("wait");
    await step.locator('[data-script-param]').fill("1.5");
    await app.screenshot({path:path.join(output,`${version}-${lang}-reaction.png`)});
    await app.locator('footer [data-screen-action="save"]').click();
    const saved=await page.evaluate(()=>scene.flags["dmicher-master-screen"].objectBindings.bindings["Token:guard"]);
    assert.equal(saved.variables[0].name,"mood"); assert.equal(saved.variables[0].value,"calm");
    assert.equal(saved.actions[0].name,"Greet"); assert.equal(saved.reactionScripts[0].actionId,saved.actions[0].id);
    assert.equal(saved.reactionScripts[0].script.steps[0].parameters.seconds,1.5);
    for(const tab of ["information","states","shops","dialogues"]){
      await app.locator(`[data-screen-action="tab"][data-tab="${tab}"]`).click();
      assert.ok(await app.locator('footer [data-screen-action="save"]').isVisible());
    }
    await app.screenshot({path:path.join(output,`${version}-${lang}-dialogues.png`)});
    assert.deepEqual(errors,[]); await context.close(); console.log(`${version} ${lang}: unified tabs, variables, reactions, free transitions and Premium gating passed`);
  }
} finally { await browser.close(); await fixture.close(); }
