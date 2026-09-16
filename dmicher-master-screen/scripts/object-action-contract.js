import { normalizeSignalFields } from "./signal-types.js";

/** A reaction's input contract is local to its declared action, not a public
 * signal. Structured author parameters are passed as explicit JSON text. */
export function objectActionContract(binding,action) {
  return { id:`Action:${binding.type}:${binding.id}:${action.id}`,emitterKey:`${binding.type}:${binding.id}`,name:action.name,
    parameters:normalizeSignalFields([
      {name:"objectUuid",type:"string"},{name:"actorTokenUuid",type:"string",nullable:true,default:null},
      {name:"actionId",type:"string"},{name:"parametersJson",type:"string",default:"{}"}]),returns:[] };
}
export const objectActionContracts = binding => (binding.actions ?? []).map(action=>objectActionContract(binding,action));
