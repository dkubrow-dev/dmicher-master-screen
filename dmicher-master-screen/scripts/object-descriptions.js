/** Localized authored text is presentation data. It never supplies executable behavior. */
export const DEFAULT_DESCRIPTIONS = Object.freeze({
  group: { ru: "Объединяет состояния одной группы объектов сцены. Текущее состояние и остановка этой группы не переключают остальные группы.",
    en: "Organizes states for one set of scene objects. Changing or stopping this group's state leaves other groups unchanged." },
  state: { ru: "Определяет подготовленное поведение и рабочие окна объектов при входе в это состояние. Сохранение настроек не запускает состояние.",
    en: "Defines the prepared behavior and working windows of objects when this state is entered. Saving its settings does not start it." }
});
