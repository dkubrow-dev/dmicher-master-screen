import { text as t } from "../localization.js";
import { fail, requireText, number, choice } from "./parameters.js";

/** Uses Playlist's native replicated state; each client still applies its own volume controls. */
export async function executePlaylistAction(parameters, { current = () => true, available } = {}) {
  available ??= (await import("../premium-provider.js")).canExecuteScriptKind;
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


export function execute({ p, admitted }) {
  return executePlaylistAction(p, { current: admitted });
}

export default Object.freeze({
  id: "playlist", label: {"ru":"Плейлист","en":"Playlist"},
  description: {"ru":"Управляет воспроизведением, паузой, остановкой или громкостью композиции плейлиста.","en":"Controls playback, pause, stop, or volume for a playlist track."},
  category: {"ru":"системные.звук","en":"system.audio"},
  scopes: ["object"], premium: true,
  template: {"playlistId":"","soundId":"","action":"play","volume":1},
  normalize(p) {
    const parameters = {
      playlistId: requireText(p.playlistId ?? "", 64, t("Плейлист", "Playlist")),
      soundId: requireText(p.soundId ?? "", 64, t("Композиция", "Track")),
      action: choice(p.action, ["play", "pause", "resume", "volume", "stop"], "play"),
      volume: number(p.volume ?? 1, t("Громкость", "Volume"), 0)
    };
    if (parameters.volume > 1) fail(t("Громкость должна быть от 0 до 1.", "Volume must be between 0 and 1."));
    return parameters;
  },
  execute
});
