import { getDefinitions, getRuntimes } from "../store.js";
import { generics } from "../generics.js";

const esc = generics.utilities.escapeHTML;
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;

/** A badge reports the saved run, never the episode merely selected for editing. */
export function schemeBadges(definitions, runtimes) {
  const en = globalThis.game?.i18n?.lang?.startsWith("en");
  return definitions.map((definition) => {
    const runtime = runtimes.find((entry) => entry.schemeId === definition.schemeId);
    const episode = definition.episodes.find((entry) => entry.id === runtime?.episodeId) ?? runtime?.episode;
    const status = runtime?.halted ? "halted" : episode ? "running" : "unstarted";
    const statusText = status === "halted" ? (en ? "Stopped" : "Остановлена") : status === "unstarted" ? (en ? "Not started" : "Не запущена") : "";
    return { id: definition.schemeId, symbol: definition.symbol ?? "🎬", status,
      title: [definition.schemeName, episode?.name, statusText].filter(Boolean).join(" · "),
      background: color(episode?.background, "#444B55"), textColor: color(episode?.textColor, "#FFFFFF") };
  });
}

export function renderSchemeBadges(definitions, runtimes) {
  return schemeBadges(definitions, runtimes).map((badge) => `<span class="ms-scheme-badge" data-scheme-badge="${esc(badge.id)}" data-status="${badge.status}" style="background:${badge.background};color:${badge.textColor}" data-tooltip="${esc(badge.title)}" aria-label="${esc(badge.title)}">${esc(badge.symbol)}${badge.status === "halted" ? '<small aria-hidden="true">Ⅱ</small>' : ""}</span>`).join("");
}

export function updateSceneNavigationBadges(controller, root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const badge of root.querySelectorAll(".ms-navigation-badges")) badge.remove();
  if (!globalThis.game?.user?.isGM || !controller.editor?.rendered || !controller.mode) return;
  for (const row of root.querySelectorAll('#scene-navigation [data-scene-id][data-action="viewScene"]')) {
    const scene = game.scenes?.get(row.dataset.sceneId);
    if (!scene) continue;
    const html = renderSchemeBadges(getDefinitions(scene), getRuntimes(scene));
    if (!html) continue;
    const container = row.ownerDocument.createElement("span");
    container.className = "ms-navigation-badges"; container.innerHTML = html;
    row.append(container);
  }
}
