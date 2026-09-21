import { message as localizedMessage, text } from "../localization.js";
import { requireText, number, choice, seconds, speed } from "./parameters.js";

export default Object.freeze({
  id: "approach", label: {"ru":"Приблизиться","en":"Approach"},
  category: {"ru":"объекты.движение","en":"objects.movement"},
  description: { ru: "Приближает исполнителя к объекту до указанной дистанции за заданное время или с заданной скоростью.", en: "Moves the executor toward an object to the selected distance, using a duration or speed." },
  scopes: ["object"], premium: false,
  template: {"targetUuid":"","distance":0,"timeMode":"duration","duration":0,"speed":5},
  normalize(p) {
    return { targetUuid: requireText(p.targetUuid ?? "", 2048, text("UUID цели", "Target UUID")), distance: number(p.distance ?? 0, localizedMessage("Расстояние"), 0),
      timeMode: choice(p.timeMode, ["duration", "speed"], "duration"), duration: seconds(p.duration), speed: speed(p.speed ?? 5) };
  }
});
