import test from "node:test";
import assert from "node:assert/strict";
import { normalizeShopRestoration } from "../dmicher-master-screen/scripts/shop-restoration-policy.js";
import { normalizeObjectBinding } from "../dmicher-master-screen/scripts/object-binding-model.js";
import { generics } from "../dmicher-master-screen/scripts/generics.js";
import { masterScreenExtension } from "../../dmicher-premium/dmicher-premium/sctipts/features/master-screen/index.js";
import { renderShopRestorationFields, readShopRestorationFields } from "../dmicher-master-screen/scripts/apps/shop-restoration-fields.js";

test("shop restoration is explicit validated preparation without dialogue spillover", () => {
  assert.deepEqual(normalizeShopRestoration(), { activation: "manual", conditionMacro: "" });
  for (const raw of [null, [], {activation:"view"}, {conditionMacro:42}]) assert.throws(() => normalizeShopRestoration(raw));
  const policy = {activation:"state-entry",conditionMacro:"return variables.stock > 0;"};
  const binding = normalizeObjectBinding({type:"Token",id:"npc",groupId:"group",shops:[{shopId:"shop",restoration:policy}],dialogues:[{dialogueId:"dialogue",restoration:policy}]});
  assert.deepEqual(binding.shops[0].restoration, policy);
  assert.equal(Object.hasOwn(binding.dialogues[0],"restoration"),false);
  assert.deepEqual(normalizeObjectBinding(JSON.parse(JSON.stringify(binding))),binding);
});

test("unlicensed restoration remains visible and preserves prepared automation; manual remains free", () => {
  const prepared = {activation:"state-entry",conditionMacro:"return false;"};
  const markup = renderShopRestorationFields(prepared);
  assert.match(markup,/dmicher-premium-badge/);
  assert.match(markup,/<option value="manual">/);
  assert.match(markup,/<option value="state-entry" selected disabled>/);
  assert.match(markup,/<fieldset data-shop-restoration-condition disabled>/);
  let activation="scene-activation";
  const form={querySelector:selector=>selector.includes("activation") ? {value:activation} : {value:"return true;"}};
  assert.deepEqual(readShopRestorationFields(form,prepared),prepared);
  activation="manual";
  assert.deepEqual(readShopRestorationFields(form,prepared),{...prepared,activation:"manual"});
  const provider=generics.premium.registerProvider({apiVersion:1,hasAccess:()=>true,extensions:[masterScreenExtension]});
  try {
    activation="scene-activation";
    assert.deepEqual(readShopRestorationFields(form,prepared),{activation,conditionMacro:"return true;"});
    assert.doesNotMatch(renderShopRestorationFields(prepared),/ disabled/);
  } finally {provider.dispose();}
});
