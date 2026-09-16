import { MODULE_ID } from "./model.js";
import { INTERACTION_WORLD_SETTING, INTERACTION_PLAYER_SETTING, normalizeInteractionSettings, normalizePlayerInteractionSettings } from "./interaction-settings-model.js";
const listeners = new Set();
export const subscribeInteractionSettings = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export const interactionSettingsChanged = () => { for (const listener of listeners) listener(); };
function setting(key) { try { return game.settings.get(MODULE_ID, key); } catch { return undefined; } }
export const getInteractionSettings = () => normalizeInteractionSettings(setting(INTERACTION_WORLD_SETTING));
export const getPlayerInteractionSettings = () => normalizePlayerInteractionSettings(setting(INTERACTION_PLAYER_SETTING));
