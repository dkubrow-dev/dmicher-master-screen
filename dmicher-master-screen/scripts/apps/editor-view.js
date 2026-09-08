/** Pure presentation data. The graph is rendered as escaped SVG attributes and text. */
export function buildGraphView(episodes, selectedId, { columns: preferredColumns = 3 } = {}) {
  const columns = Math.min(Math.max(1, Math.floor(preferredColumns)), Math.max(1, episodes.length));
  const nodes = episodes.map((episode, index) => ({
    id: episode.id,
    name: episode.name,
    label: [...episode.name].length > 23 ? `${[...episode.name].slice(0, 22).join("")}…` : episode.name,
    selected: episode.id === selectedId,
    x: 20 + (index % columns) * 210,
    y: 25 + Math.floor(index / columns) * 100,
    labelX: 110 + (index % columns) * 210,
    labelY: 49 + Math.floor(index / columns) * 100,
    all: episode.allowFromAll !== false
  }));
  const edges = [];
  for (const target of episodes) {
    if (target.allowFromAll !== false) continue;
    const end = nodes.find((node) => node.id === target.id);
    for (const sourceId of target.from ?? []) {
      const start = nodes.find((node) => node.id === sourceId);
      if (!start || start.id === end.id) continue;
      const x1 = start.labelX;
      const y1 = start.y + 56;
      const x2 = end.labelX;
      const y2 = end.y;
      edges.push({ sourceId, targetId: target.id, path: `M ${x1} ${y1} C ${x1} ${y1 + 25}, ${x2} ${y2 - 25}, ${x2} ${y2}` });
    }
  }
  return { nodes, edges, width: columns * 210 + 20, height: Math.max(120, Math.ceil(episodes.length / columns) * 100 + 20) };
}

export function splitLines(value) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Coordinates are explicit canvas pixels; an invalid row must not silently move a token. */
export function parsePointRows(value) {
  return splitLines(value).filter((line) => !line.startsWith("#")).map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    const coordinates = parts[0].split(/[\s,;]+/);
    const [x, y] = coordinates.map(Number);
    if (coordinates.length !== 2 || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || parts.length > 3) {
      throw new Error(`Точка ${index + 1}: укажите x, y | UUID макроса | ID эпизода.`);
    }
    return { x, y, macroUuid: parts[1] ?? "", onTrue: parts[2] ?? "" };
  });
}

export function formatPointRows(points) {
  return (points ?? []).map((point) => {
    const line = `${point.x}, ${point.y}`;
    return point.macroUuid || point.onTrue ? `${line} | ${point.macroUuid ?? ""} | ${point.onTrue ?? ""}` : line;
  }).join("\n");
}

export function parseJsonArray(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error(`${label}: некорректный JSON.`); }
  if (!Array.isArray(result)) throw new Error(`${label}: требуется список в квадратных скобках.`);
  return result;
}

export function requireNumber(value, label, { min = 0, max = Infinity } = {}) {
  const result = Number(value);
  if (String(value ?? "").trim() === "" || !Number.isFinite(result) || result < min || result > max) {
    throw new Error(`${label}: введите число от ${min}${Number.isFinite(max) ? ` до ${max}` : ""}.`);
  }
  return result;
}

export function buildTriggerRows({ runtime, definition, tokens }) {
  const labels = { shop: "Магазин", dialogue: "Диалог", interaction: "Действие", zone: "Зона", "npc-interaction": "Действие НИП" };
  const rows = new Map(), episode = runtime.episode;
  const add = (type, id, name, policy) => {
    const key = `${runtime.schemeId ?? "main"}:${runtime.episodeId}:${type}:${id}`;
    rows.set(key, { key, count: runtime.triggerCounts?.[key] ?? 0, episodeName: episode.name, name, typeLabel: labels[type],
      canToggle: true, enabled: runtime.triggerEnabledOverrides?.[key] ?? policy?.enabled !== false });
  };
  if (episode) {
    for (const [id, behavior] of Object.entries(episode.tokens ?? {})) {
      const name = tokens.find((token) => token.id === id)?.name ?? id;
      if (behavior.shop?.enabled) add("shop", id, name, behavior.shop.trigger);
      if (behavior.interaction?.targetEpisodeId || behavior.interaction?.eventName) add("npc-interaction", id, name, behavior.interaction.trigger);
    }
    for (const zone of episode.zones ?? []) add("zone", zone.id, zone.label || zone.id, zone.trigger);
    for (const dialogue of episode.dialogues ?? []) add("dialogue", dialogue.id, dialogue.name, dialogue.trigger);
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
