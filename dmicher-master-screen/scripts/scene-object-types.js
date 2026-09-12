/** Foundry embedded scene documents supported by object behavior and interactions. */
export const SCENE_OBJECT_COLLECTIONS = Object.freeze({
  Token: "tokens", Tile: "tiles", Drawing: "drawings", AmbientLight: "lights",
  AmbientSound: "sounds", Note: "notes", MeasuredTemplate: "templates", Wall: "walls", Region: "regions"
});
export const SCENE_OBJECT_TYPES = Object.freeze(Object.keys(SCENE_OBJECT_COLLECTIONS));
export const isSceneObjectType = (type) => Object.hasOwn(SCENE_OBJECT_COLLECTIONS, type);
