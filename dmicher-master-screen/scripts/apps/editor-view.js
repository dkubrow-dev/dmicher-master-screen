import { text as t } from "../localization.js";
export function requireNumber(value, label, { min = 0, max = Infinity } = {}) {
  const result = Number(value);
  if (String(value ?? "").trim() === "" || !Number.isFinite(result) || result < min || result > max) {
    throw new Error(`${label}${t(": введите число от ", ": enter a number from ")}${min}${Number.isFinite(max) ? `${t(" до ", " to ")}${max}` : ""}.`);
  }
  return result;
}

export function buildConditionRows({ runtime, definition, tokens }) {
  const labels = { shop: t("Магазин", "Shop"), dialogue: t("Диалог", "Dialogue"), interaction: t("Действие", "Action"), zone: t("Зона", "Zone") };
  const rows = new Map(), state = runtime.state;
  const add = (type, id, name, policy) => {
    const key = `${runtime.groupId ?? "main"}:${runtime.stateId}:${type}:${id}`;
    rows.set(key, { key, count: runtime.conditionCounts?.[key] ?? 0, stateName: state.name, name, typeLabel: labels[type],
      canToggle: true, enabled: runtime.conditionEnabledOverrides?.[key] ?? policy?.enabled !== false });
  };
  if (state) {
    for (const shop of state.shops ?? []) add("shop", `${shop.target.type}:${shop.target.id}:${shop.shopId}`, shop.name, shop.conditions);
    for (const zone of state.zones ?? []) add("zone", zone.id, zone.label || zone.id, zone.conditions);
    for (const dialogue of state.dialogues ?? []) add("dialogue", `${dialogue.target.type}:${dialogue.target.id}:${dialogue.dialogueId}`, dialogue.name, dialogue.conditions);
    for (const action of state.interactions ?? []) add("interaction", action.id, action.name, action.conditions);
  }
  for (const [key, count] of Object.entries(runtime.conditionCounts ?? {})) {
    if (rows.has(key)) continue;
    const [, stateId, type, id] = key.split(":");
    const owner = definition.states.find((entry) => entry.id === stateId);
    rows.set(key, { key, count, stateName: owner?.name ?? stateId, name: id, typeLabel: labels[type] ?? type, canToggle: false });
  }
  return [...rows.values()];
}
