import { normalizeDefinition } from "./model.js";
import { text } from "./localization.js";

export const PLAYERS_GROUP_ID = "players";
export const isPlayersGroup = id => id === PLAYERS_GROUP_ID;
/** Virtual preparation is materialized only by an explicit edit, never by reading a scene. */
export function playersGroupDefinition(stored) {
  return normalizeDefinition(stored ?? { schemaVersion: 1, groupId: PLAYERS_GROUP_ID,
    groupName: text("Игроки", "Players"), symbol: "👥", order: 10000, description: "",
    entryStateId: "default", states: [{id:"default",name:text("Обычное", "Default"),description:""}] });
}
