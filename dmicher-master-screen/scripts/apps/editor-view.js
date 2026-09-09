export function requireNumber(value, label, { min = 0, max = Infinity } = {}) {
  const result = Number(value);
  if (String(value ?? "").trim() === "" || !Number.isFinite(result) || result < min || result > max) {
    throw new Error(`${label}: введите число от ${min}${Number.isFinite(max) ? ` до ${max}` : ""}.`);
  }
  return result;
}

export function buildTriggerRows({ runtime, definition, tokens }) {
  const labels = { shop: "Магазин", dialogue: "Диалог", interaction: "Действие", zone: "Зона" };
  const rows = new Map(), episode = runtime.episode;
  const add = (type, id, name, policy) => {
    const key = `${runtime.schemeId ?? "main"}:${runtime.episodeId}:${type}:${id}`;
    rows.set(key, { key, count: runtime.triggerCounts?.[key] ?? 0, episodeName: episode.name, name, typeLabel: labels[type],
      canToggle: true, enabled: runtime.triggerEnabledOverrides?.[key] ?? policy?.enabled !== false });
  };
  if (episode) {
    for (const shop of episode.shops ?? []) add("shop", `${shop.target.type}:${shop.target.id}`, shop.name, shop.trigger);
    for (const zone of episode.zones ?? []) add("zone", zone.id, zone.label || zone.id, zone.trigger);
    for (const dialogue of episode.dialogues ?? []) add("dialogue", `${dialogue.target.type}:${dialogue.target.id}`, dialogue.name, dialogue.trigger);
    for (const action of episode.interactions ?? []) add("interaction", action.id, action.name, action.trigger);
  }
  for (const [key, count] of Object.entries(runtime.triggerCounts ?? {})) {
    if (rows.has(key)) continue;
    const [, episodeId, type, id] = key.split(":");
    const owner = definition.episodes.find((entry) => entry.id === episodeId);
    rows.set(key, { key, count, episodeName: owner?.name ?? episodeId, name: id, typeLabel: labels[type] ?? type, canToggle: false });
  }
  return [...rows.values()];
}
