import { text } from "./localization.js";
import { normalizeActionConditionMacro } from "./object-action-model.js";

export const SHOP_RESTORATION_MODES = Object.freeze(["manual", "state-entry", "scene-activation"]);

/** Preparation only: access and trigger identity are checked at execution time. */
export function normalizeShopRestoration(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !SHOP_RESTORATION_MODES.includes(raw.activation ?? "manual")) {
    throw new Error(text("Выберите способ возврата магазина в исходное состояние.", "Select how the shop returns to its initial stock."));
  }
  return { activation: raw.activation ?? "manual", conditionMacro: normalizeActionConditionMacro(raw.conditionMacro) };
}
