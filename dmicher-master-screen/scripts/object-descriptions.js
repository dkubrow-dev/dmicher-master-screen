/** Localized authored text is presentation data. It never supplies executable behavior. */
export const DEFAULT_DESCRIPTIONS = Object.freeze({
  scheme: { ru: "Объединяет эпизоды одной группы объектов сцены. Активный эпизод и остановка этой схемы не переключают остальные схемы.",
    en: "Groups episodes for one set of scene objects. Its active episode and stop state do not switch the other schemes." },
  episode: { ru: "Определяет подготовленное поведение и рабочие окна объектов при входе в этот эпизод. Сохранение настроек не запускает эпизод.",
    en: "Defines the prepared behavior and working windows of objects when this episode is entered. Saving its settings does not start it." },
  calm: { ru: "Спокойная обстановка: подготовьте обычные реплики и доступные взаимодействия, например торговлю. Поведения включаются только после их настройки и запуска эпизода.",
    en: "A calm situation: prepare ambient lines and available interactions, such as trading. Behaviors run only after they are configured and the episode is started." },
  tension: { ru: "Нарастание напряжения: подготовьте эмоции, разовую реплику и маршрут патруля. Эпизод заменяет настроенные поведения предыдущего эпизода этой схемы.",
    en: "Rising tension: prepare emotions, an entry line and a patrol route. This episode replaces the configured behaviors of the previous episode in this scheme." },
  alarm: { ru: "Тревога: при необходимости подготовьте паузу, звук и подкрепление. Эти действия выполняются при явном входе, а не при переподключении.",
    en: "An alarm: configure a pause, sound and reinforcements if needed. Entry actions run on an explicit entry, not on reconnection." },
  stop: { ru: "Передаёт объекты схемы под ручное управление мастера: длительные поведения отключены, игровые факты сохраняются. Возврат к автоматизации требует явного входа в другой эпизод.",
    en: "Returns this scheme's objects to manual GM control: ongoing behaviors stop and world facts remain. Restarting automation requires explicitly entering another episode." }
});

/** Built-in names are stable machine contracts; descriptions explain when they are raised. */
export const BUILTIN_EVENT_DESCRIPTIONS = Object.freeze({
  "episode.entered": { ru: "Сообщает о завершённом явном входе в эпизод. Подготовленное состояние уже установлено; восстановление подключения это событие не повторяет.",
    en: "Reports a completed explicit episode entry. The prepared state has been applied; restoring a connection does not repeat this event." },
  "automation.changed": { ru: "Сообщает, что мастер явно включил или отключил автоматизацию отдельного токена в текущей схеме.",
    en: "Reports that the GM explicitly enabled or disabled an individual token's automation in its current scheme." },
  "zone.entered": { ru: "Возникает при допустимом пересечении настроенной зоны персонажем. Ограничения тегов, области действия и кратности проверены до регистрации события.",
    en: "Occurs when a character crosses a configured zone and is admitted. Tag, scope and repetition restrictions are checked before the event is recorded." },
  "npc.interacted": { ru: "Сообщает о разрешённом взаимодействии персонажа с настроенным НПС. Перед событием проверяются права, дистанция и допуск взаимодействия.",
    en: "Reports an admitted character interaction with a configured NPC. Permissions, range and interaction eligibility are checked before the event." },
  "patrol.arrived": { ru: "Сообщает, что патрулирующий НПС достиг опорной точки маршрута. Макрос проверки этой точки, если задан, исполняется после прибытия.",
    en: "Reports that a patrolling NPC reached a route waypoint. A waypoint check macro, when configured, runs after arrival." },
  "patrol.check": { ru: "Сообщает о завершении макроса проверки в опорной точке патруля. Положительным считается только результат true; остальные результаты передаются как false.",
    en: "Reports completion of a patrol waypoint check macro. Only a strict true result is positive; other results are reported as false." },
  "dialogue.finished": { ru: "Сообщает о завершении диалога выбранным ответом или страницей без продолжения. Закрытие окна и действие «Уйти» не считаются таким завершением.",
    en: "Reports a dialogue ending through an answer or a page without continuation. Closing the window or choosing Leave does not count as this completion." }
});

// Fields describe document identity and meaning, not guessed game-system attributes.
export const BUILTIN_FIELD_DESCRIPTIONS = Object.freeze({
  episodeId: { ru: "Постоянный ID эпизода, в который вошла схема.", en: "The stable ID of the episode the scheme entered." },
  previousEpisodeId: { ru: "ID предыдущего эпизода этой схемы; отсутствует при первом запуске.", en: "The previous episode ID in this scheme; omitted on its first start." },
  schemeId: { ru: "Постоянный ID схемы внутри сцены, к которой относится событие.", en: "The stable ID of the scheme within the scene to which this event belongs." },
  tokenId: { ru: "ID токена НПС или другого управляемого объекта на этой сцене; это не ID его актора.", en: "The scene token ID of the NPC or controlled object; this is not its actor ID." },
  enabled: { ru: "true — мастер включил автоматизацию токена; false — отключил до явного повторного включения.", en: "true means the GM enabled token automation; false means it is disabled until explicitly enabled again." },
  zoneId: { ru: "ID настроенной зоны, пересечение которой прошло проверку допуска.", en: "The configured zone ID whose crossing passed its eligibility checks." },
  label: { ru: "Подпись зоны, заданная мастером; полезна для читаемого сообщения или журнала.", en: "The GM's zone label, useful for a readable message or log entry." },
  userId: { ru: "ID участника Foundry, выполнившего взаимодействие. Права берутся из текущего пользователя Foundry, а не из этой строки.", en: "The Foundry user ID of the participant who interacted. Permissions come from the current Foundry user, not from this string." },
  pointIndex: { ru: "Номер достигнутой опорной точки в маршруте, начиная с нуля.", en: "The reached waypoint's index in the route, starting at zero." },
  x: { ru: "Горизонтальная координата опорной точки в пикселях сцены.", en: "The waypoint's horizontal coordinate in scene pixels." },
  y: { ru: "Вертикальная координата опорной точки в пикселях сцены.", en: "The waypoint's vertical coordinate in scene pixels." },
  result: { ru: "Логический результат проверки: true только когда макрос вернул строго true.", en: "The boolean check result: true only when the macro returned a strict true." },
  macroUuid: { ru: "UUID выполненного макроса Foundry, позволяющий найти его документ.", en: "The executed Foundry macro's UUID, identifying its document." },
  dialogueId: { ru: "ID завершённого диалога в текущем эпизоде.", en: "The ID of the completed dialogue in the current episode." },
  responseId: { ru: "ID ответа, которым завершён диалог; отсутствует при завершении страницы без ответа.", en: "The answer ID that ended the dialogue; omitted when a page ends without an answer." },
  interactionId: { ru: "ID настроенного интерактивного действия, которое породило событие.", en: "The configured interactive action ID which produced this event." }
});
