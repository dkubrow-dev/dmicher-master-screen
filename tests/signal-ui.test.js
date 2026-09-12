import test from "node:test";
import assert from "node:assert/strict";
import { renderSignalTree, renderParameters } from "../dmicher-master-screen/scripts/apps/ide-view.js";
import { renderSignalFields, readSignalFields, renderSubscriptionFields, renderMacroValidation } from "../dmicher-master-screen/scripts/apps/signal-fields.js";
import { buildScriptFields } from "../dmicher-master-screen/scripts/apps/script-fields.js";
globalThis.game = { i18n: { lang: "en" }, macros: new Map() };
const catalog = { emitters: [{key:"Token:guard",name:"Guard <safe>",groupId:"market"},{key:"Scene:scene",name:"Scene",groupId:null}], signals:[{id:"alert",emitterKey:"Token:guard",name:"Alert <safe>",parameters:[],returns:[]}],macros:[],subscriptions:[] };

test("signal tree groups emitters and preserves an ungrouped branch without invoking anything", () => {
  const before = structuredClone(catalog), html = renderSignalTree(catalog,{kind:"signal",id:"alert"},"constructor",[{groupId:"market",groupName:"Market"}]);
  assert.ok(html.includes('data-emitter-node="Token:guard"'));
  assert.ok(html.includes('data-emitter-node="Scene:scene"'));
  assert.ok(html.indexOf("Market") < html.indexOf("Guard &lt;safe&gt;"));
  assert.ok(html.includes("Ungrouped")); assert.ok(!html.includes("<safe>")); assert.deepEqual(catalog,before);
});
test("a builtin signal permits custom fields while protecting system fields independently", () => {
  const signal={id:"builtin",emitterKey:"Scene:scene",name:"activate",description:"System",builtin:true,parameters:[{name:"sceneUuid",type:"string",nullable:false,builtin:true}],returns:[]};
  const html=renderParameters({selection:{kind:"signal",id:"builtin"},draft:signal,catalog,definitions:[],mode:"constructor"});
  assert.ok(html.includes('data-signal-field="parameters" data-index="0" disabled'));
  assert.ok(html.includes('data-screen-action="addSignalField"'));
  assert.ok(html.includes('type="submit"'));
  assert.ok(html.includes('name="signal-name" value="activate" readonly'));
});
test("custom field names remain unrestricted in the editor and defaults keep JSON types",()=>{
  const original={id:"alert",emitterKey:"Token:guard",name:"Alert",description:"",parameters:[{name:"original",type:"string"}],returns:[]};
  const vals={"field-name":"spaces and ★", "field-type":"boolean","field-default":"false","field-description":"Description"};
  const row={dataset:{index:"0"},querySelector:s=>s.includes('nullable')?{checked:false}:{value:vals[/name="([^"]+)"/.exec(s)?.[1]]??""}};
  const root={querySelector:s=>({value:s.includes('signal-name')?"Any ! signal":""}),querySelectorAll:s=>s.includes('parameters')?[row]:[]};
  const result=readSignalFields(root,original);assert.equal(result.parameters[0].name,"spaces and ★");assert.equal(result.parameters[0].default,false);
  assert.ok(!renderSignalFields(original,catalog).includes("pattern="));
});
test("script pickers offer only signals and macros belonging to their object",()=>{
  const data={...catalog,signals:[...catalog.signals,{id:"foreign-signal",name:"Foreign",emitterKey:"Token:other"}],macros:[{ownerKey:"Token:guard",uuid:"Macro.own"},{ownerKey:"Token:other",uuid:"Macro.foreign"}]};
  const script={name:"Test",steps:[{id:1,kind:"signal",parameters:{},next:[2]},{id:2,kind:"macro",parameters:{},next:[]}]};
  const html=buildScriptFields([script],{states:[]},"Token",data,{ownerKey:"Token:guard"});
  assert.ok(html.includes('value="alert"'));assert.ok(html.includes('value="Macro.own"'));assert.ok(!html.includes('value="foreign-signal"'));assert.ok(!html.includes('value="Macro.foreign"'));
  assert.ok(!html.includes('data-script-index="0" open'));assert.ok(html.includes('value="visibility"'));assert.ok(html.includes('value="sound"'));
});
test("subscription editor offers only the selected subscriber's macros and escaped validation examples",()=>{
  const data={...catalog,macros:[{ownerKey:"Token:guard",uuid:"Macro.own"},{ownerKey:"Scene:scene",uuid:"Macro.foreign"}]};
  const html=renderSubscriptionFields({ownerKey:"Token:guard",signalId:"alert",enabled:true},data,{fixedOwner:"Token:guard"});
  assert.ok(html.includes('Macro.own'));assert.ok(!html.includes('Macro.foreign'));
  const message=renderMacroValidation({valid:false,error:"<error>",snippet:"return '<script>';"});
  assert.ok(!message.includes("<script>"));assert.ok(message.includes("textarea readonly"));
});
