import { message as localizedMessage } from "../localization.js";
import { getDefinitions, getRuntimes } from "../store.js";
import { generics } from "../generics.js";

const esc = generics.utilities.escapeHTML;
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? "") ? value : fallback;
const renderedBadges = new WeakMap();

/** A badge reports the saved run, never the state merely selected for editing. */
export function groupBadges(definitions, runtimes) {
  const en = globalThis.game?.i18n?.lang?.startsWith("en");
  return definitions.map((definition) => {
    const runtime = runtimes.find((entry) => entry.groupId === definition.groupId);
    const state = definition.states.find((entry) => entry.id === runtime?.stateId) ?? runtime?.state;
    const status = runtime?.halted ? "halted" : state ? "running" : "unstarted";
    const statusText = status === "halted" ? (en ? "Stopped" : localizedMessage("Остановлена")) : status === "unstarted" ? (en ? "Not started" : localizedMessage("Не запущена")) : "";
    return { id: definition.groupId, symbol: definition.symbol ?? "🎬", status,
      title: [definition.groupName, state?.name, statusText].filter(Boolean).join(" · "),
      background: color(state?.background, "#444B55"), textColor: color(state?.textColor, "#FFFFFF") };
  });
}

export function renderGroupBadges(definitions, runtimes) {
  return groupBadges(definitions, runtimes).map((badge) => `<span class="ms-group-badge" data-group-badge="${esc(badge.id)}" data-status="${badge.status}" style="background:${badge.background};color:${badge.textColor}" data-tooltip="${esc(badge.title)}" aria-label="${esc(badge.title)}">${esc(badge.symbol)}${badge.status === "halted" ? '<small aria-hidden="true">Ⅱ</small>' : ""}</span>`).join("");
}

export function updateSceneNavigationBadges(controller, root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  if (!globalThis.game?.user?.isGM || !controller.editor?.rendered || !controller.mode) {
    for (const badge of root.querySelectorAll(".ms-navigation-badges")) badge.remove();
    return;
  }
  for (const row of root.querySelectorAll('#scene-navigation [data-scene-id][data-action="viewScene"]')) {
    const scene = game.scenes?.get(row.dataset.sceneId);
    if (!scene) continue;
    const html = renderGroupBadges(getDefinitions(scene), getRuntimes(scene));
    let container = row.querySelector(".ms-navigation-badges");
    if (!html) { container?.remove(); continue; }
    // Script clocks also update Scene flags. Preserve badges and their native
    // tooltip/hover state while the visible group state remains unchanged.
    if (container && renderedBadges.get(container) === html) continue;
    if (!container) {
      container = row.ownerDocument.createElement("span");
      container.className = "ms-navigation-badges";
      row.append(container);
    }
    container.innerHTML = html; renderedBadges.set(container, html);
  }
}
