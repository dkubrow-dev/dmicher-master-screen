import test from "node:test";
import assert from "node:assert/strict";
import { renderSignalTree, renderParameters, signalTreeCategories } from "../dmicher-master-screen/scripts/apps/ide-view.js";
import { renderSignalFields, readSignalFields, renderSubscriptionFields, renderMacroValidation } from "../dmicher-master-screen/scripts/apps/signal-fields.js";
import { buildScriptFields } from "../dmicher-master-screen/scripts/apps/script-fields.js";
import { readSignalSchemaField } from "../dmicher-master-screen/scripts/apps/signal-schema-fields.js";
globalThis.game = { i18n: { lang: "en" }, macros: new Map() };
const catalog = { emitters: [{key:"Token:guard",name:"Guard <safe>",groupId:"market"},{key:"Scene:scene",name:"Scene",groupId:null},{key:"Group:market",name:"Market",groupId:"market"}], signals:[{id:"alert",emitterKey:"Token:guard",name:"Alert <safe>",parameters:[],returns:[]}],macros:[],subscriptions:[] };

test("signal tree categorizes native objects independently from group ownership without invoking anything", () => {
  const before = structuredClone(catalog), html = renderSignalTree(catalog,{kind:"signal",id:"alert"},"constructor",[{groupId:"market",groupName:"Market"}]);
  assert.ok(html.includes('data-emitter-node="Token:guard"'));
  assert.ok(html.includes('data-emitter-node="Scene:scene"'));
  assert.ok(html.indexOf("Market") < html.indexOf("Guard &lt;safe&gt;"));
  assert.ok(html.includes('data-signal-category="tokens"')); assert.ok(html.includes('data-signal-category="groups"'));
  assert.ok(html.includes('class="ms-signal-technical"')); assert.ok(!html.includes('data-screen-action="selectNode"'));
  assert.ok(!html.includes("<safe>")); assert.deepEqual(catalog,before);
});
test("a builtin signal permits custom fields while protecting system fields independently", () => {
  const signal={id:"builtin",emitterKey:"Scene:scene",name:"activate",description:"System",builtin:true,parameters:[{name:"sceneUuid",type:"string",nullable:false,builtin:true}],returns:[]};
  const html=renderParameters({selection:{kind:"signal",id:"builtin"},draft:signal,catalog,definitions:[],mode:"constructor"});
  assert.ok(html.includes('data-signal-field="parameters" data-index="0"'));
  assert.ok(html.includes('name="field-type" disabled'));
  assert.ok(html.includes('name="field-name" value="sceneUuid" required aria-label="Name" disabled'));
  assert.ok(html.includes('Field JSON" readonly'));
  assert.ok(html.includes('data-screen-action="addSignalField"'));
  assert.ok(html.includes('type="submit"'));
  assert.ok(html.includes('name="signal-name" value="activate" readonly'));
});
test("custom field names remain unrestricted in the editor and defaults keep JSON types",()=>{
  const original={id:"alert",emitterKey:"Token:guard",name:"Alert",description:"",parameters:[{name:"original",type:"string"}],returns:[]};
  const vals={"field-name":"spaces and ★", "field-type":"boolean","field-default-mode":"value","field-default-value":"false","field-description":"Description"};
  const row={dataset:{index:"0"},querySelector:s=>s.includes('nullable')?{checked:false}:{value:vals[/name="([^"]+)"/.exec(s)?.[1]]??""}};
  const root={querySelector:s=>({value:s.includes('signal-name')?"Any ! signal":""}),querySelectorAll:s=>s.includes('parameters')?[row]:[]};
  const result=readSignalFields(root,original);assert.equal(result.parameters[0].name,"spaces and ★");assert.equal(result.parameters[0].default,false);
  assert.ok(!renderSignalFields(original,catalog).includes("pattern="));
});

test("stable Shops and Dialogues branches retain independent emitter and signal identities", () => {
  const data={...catalog,emitters:[...catalog.emitters,{key:"Shop:first",type:"Shop",name:"Tavern"},{key:"Shop:second",type:"Shop",name:"Market"},{key:"Dialogue:calm",type:"Dialogue",name:"Guard. Calm"},{key:"Wall:w",type:"Wall",name:"Wall"},{key:"AmbientLight:l",type:"AmbientLight",name:"Light"}]};
  const categories=signalTreeCategories(data), scene=categories.find((item)=>item.id==="scene");
  assert.deepEqual(categories.map((item)=>item.id),["scene","groups","tokens","tiles","drawings","walls","other"]);
  assert.deepEqual(scene.children.map((item)=>item.name),["Shops","Dialogues"]);
  assert.deepEqual(scene.children[0].emitters.map((item)=>item.key),["Shop:first","Shop:second"]);
  assert.equal(categories.find((item)=>item.id==="other").emitters[0].key,"AmbientLight:l");
  const html=renderSignalTree(data,{},"constructor");
  assert.ok(html.indexOf('data-signal-category="shops"')<html.indexOf('data-emitter-node="Shop:first"'));
  assert.ok(html.includes('data-emitter-node="Shop:second"'));
});

test("field editor exposes typed defaults and only restrictions that apply to the selected type",()=>{
  const signal={name:"typed",emitterKey:"Scene:scene",parameters:[{name:"text",type:"string",nullable:true,default:null},{name:"count",type:"integer",default:0},{name:"decimal",type:"number",decimals:2},{name:"flag",type:"boolean",default:false}],returns:[]};
  const html=renderSignalFields(signal,catalog);
  assert.equal((html.match(/name="field-minLength"/g)??[]).length,1);
  assert.equal((html.match(/name="field-min"/g)??[]).length,2);
  assert.equal((html.match(/name="field-decimals"/g)??[]).length,1);
  assert.equal((html.match(/data-signal-json-toggle/g)??[]).length,4);
  assert.ok(html.includes('value="null" selected'));
  assert.ok(html.includes('name="field-default-value" value="0" type="number" step="1"'));
  assert.ok(!html.includes('data-index="0" open'));
});

test("saving a field reads unblurred JSON and rejects invalid JSON without using stale table values",()=>{
  const original={name:"before",type:"string",nullable:false,description:""};
  const editor={dataset:{dirty:"true"},value:'{"name":"changed","type":"boolean","default":false}'};
  const row={querySelector:selector=>selector==='[data-signal-field-json]'?editor:null};
  assert.equal(readSignalSchemaField(row,original).name,"changed");
  assert.equal(readSignalSchemaField(row,original).default,false);
  editor.value='{"name":';
  assert.throws(()=>readSignalSchemaField(row,original),SyntaxError);
  assert.equal(original.name,"before");
  editor.value='{"name":"changed","type":"boolean","default":"false"}';
  assert.throws(()=>readSignalSchemaField(row,original));
});

test("an emptied numeric default cannot silently become zero",()=>{
  const values={"field-name":"count","field-type":"integer","field-default-mode":"value","field-default-value":"","field-description":""};
  const row={querySelector:selector=>{const name=/name="([^"]+)"/.exec(selector)?.[1];return Object.hasOwn(values,name)?{value:values[name]}:null;}};
  assert.throws(()=>readSignalSchemaField(row,{name:"count",type:"integer",default:12}));
  values["field-default-value"]="0";
  assert.equal(readSignalSchemaField(row,{name:"count",type:"integer",default:12}).default,0);
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
