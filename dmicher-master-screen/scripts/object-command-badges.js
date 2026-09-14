import { MODULE_ID } from "./model.js";
import { text as t } from "./localization.js";
import { getSceneObject } from "./scene-objects.js";
import { sceneObjectBounds } from "./scene-object-geometry.js";
import { commandDocument } from "./object-command-access.js";
import { objectCommandName } from "./object-command-model.js";

/** Read command snapshots only when their source changes. Native animation
 * refreshes use cached text and update local presentation, never normalize runs. */
export function createObjectCommandBadges() {
  const entries = new Map();
  let sceneId = null;
  const remove = document => {
    const entry = entries.get(document);
    if (entry?.container && !entry.container.destroyed) entry.container.destroy({ children: true });
    entries.delete(document);
  };
  const clear = () => { for (const document of entries.keys()) remove(document); sceneId = null; };
  function render(document, entry) {
    const object = document.object, PIXI = globalThis.PIXI;
    if (!object?.addChild || object.destroyed || !PIXI?.Text || !PIXI?.Container || !PIXI?.Graphics) return;
    if (!entry.container || entry.container.destroyed) {
      entry.container = new PIXI.Container(); entry.container.eventMode = "none";
      entry.background = new PIXI.Graphics(); entry.background.eventMode = "none";
      entry.label = new PIXI.Text("", { fontSize: 16, fill: 0xffffff, align: "center", wordWrap: true, wordWrapWidth: 240,
        fontFamily: "Arial, sans-serif", padding: 2 });
      entry.label.anchor.set(0.5, 0); entry.label.eventMode = "none";
      entry.container.addChild(entry.background, entry.label); entry.renderedText = null;
    }
    if (entry.container.parent !== object) object.addChild(entry.container);
    if (entry.renderedText !== entry.text) {
      entry.label.text = entry.text;
      const bounds = entry.label.getLocalBounds(), width = bounds.width + 10, height = bounds.height + 6;
      entry.background.clear().beginFill(0x17212b, 0.9).lineStyle(1, 0xb1b9c1, 0.6)
        .drawRoundedRect(-width / 2, -3, width, height, 4).endFill();
      entry.renderedText = entry.text;
    }
    // Tokens and tiles have their own moving origin. Wall/Region containers use
    // scene coordinates; convert only their current geometry for the badge.
    let x, y;
    if (["Token", "Tile"].includes(document.documentName) && Number.isFinite(object.w) && Number.isFinite(object.h)) {
      x = object.w / 2; y = object.h + 24;
    } else {
      const bounds = sceneObjectBounds(document, document.parent), stage = globalThis.canvas?.stage;
      const local = bounds && stage && object.toLocal?.({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height }, stage);
      x = local?.x ?? Number(object.w ?? 0) / 2; y = (local?.y ?? Number(object.h ?? 0)) + 24;
    }
    entry.container.position.set(x, y);
    entry.container.visible = (!document.hidden || globalThis.game?.user?.isGM === true) && object.visible !== false;
  }
  function refresh(document) {
    const entry = entries.get(document);
    if (entry) render(document, entry);
  }
  function sync(scene) {
    if (!scene || globalThis.canvas?.scene?.id !== scene.id) { clear(); return; }
    if (sceneId !== scene.id) { clear(); sceneId = scene.id; }
    const visible = new Set(), runs = scene.getFlag(MODULE_ID, "objectCommandRuns") ?? {};
    for (const run of Object.values(runs)) {
      if (!run?.command || !run.target || !run.request || !run.config) continue;
      const document = getSceneObject(scene, run.target);
      if (!document) continue;
      visible.add(document);
      const actor = run.request.actorName ?? commandDocument(scene, run.request.actorTokenUuid)?.name ?? t("Персонаж", "Character");
      const state = run.phase === "waiting" ? ` · ${t("Ожидает скрипт", "Waiting for script")}` : run.interruption ? ` · ${t("Прервано", "Interrupted")}` : "";
      const pendingId = run.pendingReplacement?.config?.id;
      const next = pendingId ? `\n${t("Затем", "Next")}: ${objectCommandName(pendingId)}` : "";
      const text = `${actor}\n${objectCommandName(run.config.id)} ⚙${state}${next}`;
      let entry = entries.get(document);
      if (!entry) { entry = { text }; entries.set(document, entry); }
      else entry.text = text;
      render(document, entry);
    }
    for (const document of entries.keys()) if (!visible.has(document)) remove(document);
  }
  return Object.freeze({ sync, refresh, remove, clear });
}
