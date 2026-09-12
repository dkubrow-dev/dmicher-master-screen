/** Localized authored text is presentation data. It never supplies executable behavior. */
export const DEFAULT_DESCRIPTIONS = Object.freeze({
  group: { ru: "Объединяет состояния одной группы объектов сцены. Текущее состояние и остановка этой группы не переключают остальные группы.",
    en: "Groups states for one set of scene objects. Its active state and stop state do not switch the other groups." },
  state: { ru: "Определяет подготовленное поведение и рабочие окна объектов при входе в это состояние. Сохранение настроек не запускает состояние.",
    en: "Defines the prepared behavior and working windows of objects when this state is entered. Saving its settings does not start it." },
  calm: { ru: "Спокойная обстановка: подготовьте обычные реплики и доступные взаимодействия, например торговлю. Поведения включаются только после их настройки и запуска состояния.",
    en: "A calm situation: prepare ambient lines and available interactions, such as trading. Behaviors run only after they are configured and the state is started." },
  tension: { ru: "Нарастание напряжения: подготовьте эмоции, разовую реплику и маршрут патруля. Состояние заменяет настроенные поведения предыдущего состояния этой группы.",
    en: "Rising tension: prepare emotions, an entry line and a patrol route. This state replaces the configured behaviors of the previous state in this group." },
  alarm: { ru: "Тревога: при необходимости подготовьте паузу, звук и подкрепление. Эти действия выполняются при явном входе, а не при переподключении.",
    en: "An alarm: configure a pause, sound and reinforcements if needed. Entry actions run on an explicit entry, not on reconnection." },
  stop: { ru: "Пустое состояние для подготовки ручного управления. Аварийная остановка доступна отдельно кнопкой Стоп.",
    en: "An empty state for preparing manual control. Emergency stop remains a separate Stop command." }
});
