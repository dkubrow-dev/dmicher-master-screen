import { isSceneObjectType } from "./scene-object-types.js";

/** Resolve public interaction references without accessing a Scene. Bare strings
 * remain token IDs in the interaction API; persisted bindings use strict validation. */
export function objectReference(value) {
  if (typeof value === "string") {
    const separator = value.indexOf(":");
    value = separator < 0 ? { type: "Token", id: value } : { type: value.slice(0, separator), id: value.slice(separator + 1) };
  }
  const document = value?.document ?? value;
  const type = document?.documentName ?? document?.type;
  return isSceneObjectType(type) && typeof document.id === "string" && document.id.length
    ? { type, id: document.id } : null;
}

export function objectReferenceKey(value) {
  const reference = objectReference(value);
  return reference ? `${reference.type}:${reference.id}` : "";
}
