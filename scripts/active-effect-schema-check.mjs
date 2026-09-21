import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {babelParse}=require("C:/Users/dscherkasov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/lib/transform/babelBundle.js");
const data="C:/Users/dscherkasov/AppData/Local/FoundryVTT/Data";
const app="E:/Foundry Portable/Foundry VTT 14.366/App/resources/app";
function schemaMethod(path,name){
  const source=fs.readFileSync(path,"utf8"),ast=babelParse(source,path,true);let method;
  function visit(node){
    if(!node||typeof node!=="object")return;
    if(node.type==="ClassDeclaration"&&node.id?.name===name)method=node.body.body.find(row=>row.static&&row.key?.name==="defineSchema");
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value?.type)visit(value);
  }
  visit(ast);assert.ok(method,name);return source.slice(method.start,method.end);
}
const base=schemaMethod(`${data}/modules/warhammer-lib/warhammer-lib.js`,"WarhammerActiveEffectModel");
const system=schemaMethod(`${data}/systems/impmal/impmal.js`,"ImpMalActiveEffectModel");
// Isolate the actual schema-building methods, not the whole third-party module.
// Field shells retain the declared keys; no dmicher code or world data is loaded.
const context=vm.createContext({});
const result=vm.runInContext(`
  class Field {constructor(fields){this.fields=fields;}}
  const fields$1=new Proxy({}, {get:()=>Field});
  const foundry={data:{fields:fields$1}};
  class ImpMalZoneTraitsModel {}
  class WarhammerActiveEffectModel {${base}}
  class ImpMalActiveEffectModel extends WarhammerActiveEffectModel {${system}}
  Object.keys(ImpMalActiveEffectModel.defineSchema());
`,context,{timeout:1000});
const core=fs.readFileSync(`${app}/public/scripts/foundry.mjs`,"utf8");
assert.ok(core.includes("if ( !ModelClass.schema.fields.changes )"));
assert.ok(core.includes("must define a changes field in its schema"));
assert.equal(result.includes("changes"),false);
console.log(JSON.stringify({foundry:JSON.parse(fs.readFileSync(`${app}/package.json`)).version,
  system:JSON.parse(fs.readFileSync(`${data}/systems/impmal/system.json`)).version,
  library:JSON.parse(fs.readFileSync(`${data}/modules/warhammer-lib/module.json`)).version,
  schemaKeys:result,hasChanges:false,dmicherLoaded:false,
  scope:"Isolated installed defineSchema methods with field shells, checked against installed Foundry warning predicate; not a live-world load."},null,2));
