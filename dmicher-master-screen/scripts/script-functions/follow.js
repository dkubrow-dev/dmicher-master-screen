import { text } from "../localization.js";
import { fail, requireText, number, choice, speed } from "./parameters.js";

export default Object.freeze({
  id: "follow", label: {"ru":"Следовать","en":"Follow"},
  category: {"ru":"объекты.движение","en":"objects.movement"},
  description: { ru: "Следует за объектом в выбранном диапазоне дистанции до прибытия или смены состояния.", en: "Follows an object within the selected distance range until arrival or a state change." },
  scopes: ["object"], premium: false,
  template: {"targetUuid":"","minDistance":0,"maxDistance":5,"speed":5,"mode":"trajectory","finishOn":"arrival"},
  normalize(p) {
    const parameters = { targetUuid: requireText(p.targetUuid ?? "", 2048, text("UUID цели", "Target UUID")),
        minDistance: number(p.minDistance ?? 0, text("Минимальное расстояние", "Minimum distance"), 0),
        maxDistance: number(p.maxDistance ?? 5, text("Максимальное расстояние", "Maximum distance"), 0), speed: speed(p.speed ?? 5),
        mode: choice(p.mode, ["trajectory", "direct"], "trajectory"), finishOn: choice(p.finishOn, ["arrival", "state-change"], "arrival") };
    if (parameters.maxDistance < parameters.minDistance) fail(text("Максимальное расстояние не может быть меньше минимального.", "Maximum distance cannot be less than minimum distance."));
    return parameters;
  }
});
