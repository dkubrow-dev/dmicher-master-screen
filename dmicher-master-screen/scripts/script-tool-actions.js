import { text as t } from "./localization.js";
import { getRuntime } from "./store.js";
import { isSceneObjectType } from "./scene-object-types.js";
import { getSceneObject } from "./scene-objects.js";
import { canExecuteScriptKind } from "./premium-provider.js";

export const SCRIPT_TOOL_KINDS = Object.freeze(["shop", "command", "playlist", "windows", "notes"]);
const fail = message => { throw new Error(message); };
function commandTarget(scene, uuid) {
  const parts = String(uuid ?? "").split(".");
  if (parts.length !== 4 || parts[0] !== "Scene" || parts[1] !== scene.id || !isSceneObjectType(parts[2])) fail(t("Команда требует UUID объекта текущей сцены.", "The command requires an object UUID in the current scene."));
  const document = getSceneObject(scene, { type: parts[2], id: parts[3] });
  if (!document) fail(t("Объект команды больше не существует.", "The command target no longer exists."));
  return document;
}
/** Uses Playlist's native replicated state; each client still applies its own volume controls. */
export async function executePlaylistAction(parameters, { current = () => true, available = canExecuteScriptKind } = {}) {
  if (!game.user?.isGM) fail(t("Управление плейлистом доступно мастеру.", "Playlist control requires a GM."));
  const allowed = () => current() && available("playlist");
  if (!allowed()) return { premiumSkipped: !available("playlist") };
  const playlist = game.playlists?.get(parameters.playlistId);
  if (!playlist) fail(t("Плейлист больше не существует.", "The playlist no longer exists."));
  let sound = playlist.sounds?.get(parameters.soundId);
  if (!sound && !parameters.soundId && parameters.action !== "play") {
    const candidates = Array.from(playlist.sounds?.values?.() ?? []).filter(item => item.playing || item.pausedTime != null);
    if (candidates.length > 1) fail(t("В плейлисте несколько текущих композиций. Выберите конкретную.", "The playlist has several current tracks. Select one explicitly."));
    sound = candidates[0];
  }
  if (!sound) fail(t("Выберите доступную композицию плейлиста.", "Select an available playlist track."));
  if (!allowed()) return {};
  switch (parameters.action) {
    case "play":
      if (sound.pausedTime != null) { await sound.update({ pausedTime: null }); if (!allowed()) return {}; }
      await playlist.playSound(sound); break;
    case "resume": if (!sound.playing) await playlist.playSound(sound); break;
    case "pause": {
      const elapsed = Number(sound.sound?.currentTime ?? 0);
      if (sound.playing) await sound.update({ playing: false, pausedTime: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0 });
      break;
    }
    case "stop": await playlist.stopSound(sound); break;
    case "volume": {
      const volume = Number(parameters.volume);
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) fail(t("Громкость должна быть от 0 до 1.", "Volume must be between 0 and 1."));
      if (sound.volume !== volume) await sound.update({ volume });
      break;
    }
    default: fail(t("Неизвестное действие плейлиста.", "Unknown playlist action."));
  }
  return {};
}

/** Called by the existing cancellable script job. This adapter does not own the tick clock. */
export async function executeScriptToolAction(job, { current, executionCurrent = current, runtime, waitUntilAdmitted, scriptKey = job.progressKey } = {}) {
  const { scene, object, target, runId, step, script } = job, parameters = step.parameters;
  if (!SCRIPT_TOOL_KINDS.includes(step.kind)) fail(t("Неизвестный инструмент скрипта.", "Unknown script tool."));
  if (!current()) return {};
  if (step.kind === "playlist") return executePlaylistAction(parameters, { current });
  if (step.kind === "windows" || step.kind === "notes") {
    if (!runtime.workspacePresets) fail(t("Управление конфигурациями не подключено.", "Configuration control is not connected."));
    await runtime.workspacePresets.activate(scene, step.kind, parameters.configurationId, { isCurrent: current }); return {};
  }
  if (step.kind === "command") {
    if (!runtime.commandService?.invokeFromScript) fail(t("Исполнение команды скрипта не подключено.", "Script command execution is not connected."));
    await runtime.commandService.invokeFromScript({ scene, target: commandTarget(scene, parameters.objectUuid), commander: object,
      commandId: parameters.commandId, parameters: structuredClone(parameters.parameters), context: { isCurrent: current } });
    return {};
  }
  if (!runtime.startScriptShop) fail(t("Исполнение магазина скрипта не подключено.", "Script shop execution is not connected."));
  const active = runtime.scriptState(scene, runId);
  if (active?.manual && !active.purpose) fail(t("Для магазина скрипта запустите состояние группы.", "Start a group state to use a scripted shop."));
  const shopRunId = active?.command ? active.parentRunId : active?.manual ? getRuntime(scene, { groupId: job.groupId }).runId : runId;
  const isCurrent = (started = []) => {
    const turn = runtime.combat?.context?.(scene, object);
    return executionCurrent() && !globalThis.game?.paused
      && runtime.currentObject(scene, runId, target, { scriptKey, excludeShopSessions: started })
      && (!turn || script.combat.enabled && turn.isTurn);
  };
  const reference = await runtime.startScriptShop({ sceneId: scene.id, groupId: job.groupId, runId: shopRunId,
    target, shopId: parameters.shopId, tokenUuid: parameters.tokenUuid },
  { isCurrent, ...(waitUntilAdmitted ? { waitForAdmission: started => waitUntilAdmitted(() => isCurrent(started)) } : {}) });
  return { shopSessions: reference ? [reference] : [] };
}
