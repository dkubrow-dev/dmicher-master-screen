export const OBJECT_HELP_PAGES = [
  {
    "id": "commands",
    "ru": "Выдать команды объектам",
    "en": "Give objects commands",
    "sections": [
      {
        "id": "prepare",
        "ru": "Разрешить нужные команды",
        "en": "Allow the intended commands",
        "bodyRu": "Откройте «Автоматизация → Свойства → Команды». Все команды сначала выключены; список зависит от типа объекта. Включите команду и отдельно разрешите её мастеру, персонажу игрока или по поручению. Настройте теги командующего, расстояние и пары группа–состояния. Пустой список допускает любые состояния. Запрещающий тег имеет приоритет. Пункты, доступные только мастеру, игроку не показываются.",
        "bodyEn": "Open Automation → Properties → Commands. Commands start disabled and depend on the object type. Enable a command and separately allow GM use, player-character use or delegation. Set the commanding character's tags, range and group–state pairs. An empty list allows any state. Denied tags take precedence. GM-only entries are not shown to players."
      },
      {
        "id": "give",
        "ru": "Выдать команду от персонажа",
        "en": "Issue a command as a character",
        "bodyRu": "Выберите своего персонажа и откройте меню объекта → «Команды». Для «Встань там» кликните видимую точку; для «Патрулируй» — две точки. Escape отменяет выбор, затем карта возвращается к обычному управлению. Для поручения выберите исполнителя, целевой объект и доступную команду. Плашка показывает командующего и текущую работу. Отказ сопровождается понятным предупреждением игроку и мастеру.",
        "bodyEn": "Select your character and open the object's menu → Commands. For Stand there, click a visible point; for Patrol, click two points. Escape cancels selection and restores normal map controls. To delegate, choose the performer, target object and available command. A badge shows the commanding character and current work. Rejection gives the player and GM a readable warning."
      },
      {
        "id": "replacement",
        "ru": "Заменить команду после текущего скрипта",
        "en": "Replace a command after its current script",
        "bodyRu": "Если скрипт до или после команды игнорирует прерывание командой, принятые «Жди здесь» или «Отмена» дождутся его конца. Плашка покажет «Затем:». Остальные части прежней команды не выполняются. Ожидающая замена одна; новые обычные команды отклоняются. «Выключить поведение» и аварийная остановка мастера прекращают исполнение сразу.",
        "bodyEn": "If a preceding or following script ignores command interruption, an accepted Wait here or Cancel waits for that block to finish. The badge shows Next. The old command's remaining phases do not run. Only one replacement may wait; new ordinary commands are rejected. Disable behavior and the GM's emergency stop end execution immediately."
      },
      {
        "id": "admission",
        "ru": "Сохранить выполнение после начала движения",
        "en": "Keep a moving command running",
        "bodyRu": "Теги, дальность и разрешённые состояния проверяются при приёме команды. Если затем персонаж отходит дальше, уже принятую команду это не отменяет: спутник может продолжить следование. Смена состояния группы исполнителя, удаление объекта или ручная остановка по-прежнему влияют на выполнение. Ожидание предыдущего скрипта не считается началом самой команды; она начинается со своего предваряющего скрипта.",
        "bodyEn": "Tags, range and allowed states are checked when accepting a command. If the character later moves farther away, that does not cancel an accepted command: a companion can keep following. A state change in the performer's group, removal of the object or a manual stop still affects execution. Waiting for a previous script does not count as starting the command itself; it starts with its own preceding script."
      },
      {
        "id": "movement",
        "ru": "Попросить подойти, отойти или следовать",
        "en": "Ask a companion to approach, move away or follow",
        "bodyRu": "«Подойди» и «Отойди» двигают по прямой до препятствия или истечения длительности. «Встань там» после прибытия ждёт заданное время. «Следуй за мной» соблюдает минимальную и максимальную дистанции. «Патрулируй» ходит между двумя выбранными точками. «Жди здесь» заменяет движение и удерживает объект на месте. Скорость задана в единицах сцены за секунду; длительности и ожидания должны быть больше нуля.",
        "bodyEn": "Come here and Move away travel straight until an obstacle or their time limit. Stand there waits for the configured time after arrival. Follow me uses the minimum and maximum gaps. Patrol travels between two selected points. Wait here replaces movement and holds the object in place. Speed uses scene units per second; durations and waits must be greater than zero."
      },
      {
        "id": "interaction",
        "ru": "Открыть путь и включить свет",
        "en": "Open a route and turn on a light",
        "bodyRu": "Команды двери открывают или закрывают её; запертую дверь открыть нельзя. При «Поручении» спутник подходит к цели по прямой с учётом препятствий и выдаёт команду. Целевой объект должен разрешать поручения. Источники света и звука имеют свои команды включения. У токена «Зажги свет» создаёт сопровождающий свет, «Потуши свет» убирает его. «Включить/выключить сигналы» меняет публикацию, «Включить/выключить поведение» — автоматизацию.",
        "bodyEn": "Door commands open or close a door; a locked door cannot be opened. With Delegate, a companion approaches the target in a straight line, respecting obstacles, then issues the command. The target must allow delegation. Light and sound sources have their own on/off commands. A token's Light on creates a following light; Light off removes it. Enable/disable signals changes publication; Enable/disable behavior changes automation."
      },
      {
        "id": "delete",
        "ru": "Удалить объект после завершения действий",
        "en": "Delete an object after its actions finish",
        "bodyRu": "«Удалить» сначала выполняет скрипты до и после команды: объект остаётся доступным обоим. Удаление со сцены происходит только после успешного завершения последнего блока. Его прерывание, ошибка или аварийная остановка отменяют удаление.",
        "bodyEn": "Delete first runs both the preceding and following scripts, keeping the object available to them. It removes the scene object only after the final block succeeds. An interruption, error or emergency stop prevents deletion."
      },
      {
        "id": "interruptions",
        "ru": "Продолжить команду после помехи",
        "en": "Continue a command after an interruption",
        "bodyRu": "В «При прерывании команды» настройте бой, взаимодействие, ручную остановку и ошибку. По умолчанию команда прерывается. «Начать текущую фазу заново» повторяет скрипт до команды, встроенное действие или скрипт после — смотря где произошла остановка. «Перейти к следующей фазе» пропускает остаток текущей; после последней завершает команду. «Начать команду заново» возвращает к предваряющему скрипту. Продолжение ждёт окончания помехи; после ручной остановки нужен явный запуск. Совершённые действия не откатываются.",
        "bodyEn": "Under When the command is interrupted, configure combat, interaction, manual stop and error behavior. By default the command stops. Restart the current phase repeats the preceding script, built-in action or following script, depending on where it stopped. Go to the next phase skips the current remainder and completes after the last phase. Restart the command returns to the preceding script. Continuation waits for the interruption to end; a manual stop requires an explicit start. Completed actions are not rolled back."
      },
      {
        "id": "scripts",
        "ru": "Добавить подготовку и завершение",
        "en": "Add preparation and completion",
        "bodyRu": "Добавьте блоки «До команды» и «После команды» в её настройках. Команда занимает объект от начала первого блока до конца последнего. Общий редактор поддерживает JSON, переходы и прерывания. Вложенные блоки по умолчанию игнорируют новую команду: принятая замена ждёт. Бесконечный повтор может удерживать это ожидание; используйте «Отмена», «Выключить поведение» или остановку мастера.",
        "bodyEn": "Add Before command and After command blocks in its settings. The command occupies its object from the first block's start to the last block's end. The shared editor supports JSON, transitions and interruptions. Nested blocks ignore a new command by default, so an accepted replacement waits. An endless repeat can hold that wait; use Cancel, Disable behavior or a GM stop."
      }
    ]
  },
  {
    "id": "objects",
    "ru": "Подготовить объекты сцены",
    "en": "Prepare scene objects",
    "sections": [
      {
        "id": "variables",
        "ru": "Запомнить сведения об объекте",
        "en": "Remember information about an object",
        "bodyRu": "В «Свойства → Переменные» задайте уникальные имена, типы и начальные значения. Текст хранит строку; целое и дробное числа принимают только числа соответствующего типа. «Внутренний» разрешает собственным скриптам изменять значение; «Внешний просмотр» и «Внешнее изменение» отдельно допускают другие объекты и сначала выключены. Скрипты всегда могут читать собственные переменные. Изменённое в игре значение сохраняется отдельно от подготовленного начального.",
        "bodyEn": "In Properties → Variables, set unique names, types and initial values. Text stores a string; integer and number accept only matching numeric values. Internal allows the object's own scripts to change a value. External read and External write independently admit other objects and start disabled. Scripts can always read their own variables. Gameplay values are retained separately from prepared defaults."
      },
      {
        "id": "actions",
        "ru": "Добавить действие в меню",
        "en": "Add a menu action",
        "bodyRu": "В «Свойства → Действия» задайте имя, аудиторию и условия пункта меню. В «Поведение → Реакции» выберите это действие и подготовьте его скрипт. Игрок видит только допущенные ему действия; мастерские пункты выделены красным. Действие не заменяет встроенную команду: его последовательность составляет сам мастер.",
        "bodyEn": "In Properties → Actions, configure the menu entry's name, audience and conditions. In Behavior → Reactions, choose that action and prepare its script. Players see only actions available to them; GM-only entries are red. An action's sequence is prepared by the GM, separately from built-in commands."
      },
      {
        "id": "refresh",
        "ru": "Продолжить работу после изменения связанных данных",
        "en": "Continue after related data changes",
        "bodyRu": "Открытые окна обновляют названия и списки связанных объектов. Несохранённый ввод остаётся в форме. Если выбранная запись удалена, выберите доступную заново. Если те же настройки уже изменили в другом окне, сохранение предложит обновить данные: сохраните нужный текст отдельно перед повторным открытием формы.",
        "bodyEn": "Open windows refresh the names and lists of related objects. Unsaved input stays in the form. If the selected entry was deleted, choose an available one again. If the same settings were changed in another window, saving asks you to reload the data: copy any text you need before reopening the form."
      },
      {
        "id": "menu",
        "ru": "Найти и проверить объект",
        "en": "Find and inspect an object",
        "bodyRu": "В Конструкторе выберите слой Foundry и кликните токен, тайл, рисунок, стену, свет, звук, заметку, шаблон или регион. Мастер и ассистент открывают единое окно «Автоматизация». Его вкладки зависят от типа объекта. Выбор объекта в таблице Ширмы центрирует карту, включает его слой и выделяет объект.",
        "bodyEn": "In Constructor, select a Foundry layer and click a token, tile, drawing, wall, light, sound, note, template or region. The GM and assistant open the unified Automation window. Its tabs depend on the object type. Selecting an object in Master screen's table centers the map, activates its layer and selects it."
      },
      {
        "id": "owner",
        "ru": "Назначить группу и заметки",
        "en": "Assign a group and notes",
        "bodyRu": "На вкладке «Информация» выберите группу, теги и заметки мастера. Один объект принадлежит одной группе. «Настройки» открывает штатное окно Foundry; «К объекту» возвращает карту к объекту без потери ввода. Enter сохраняет форму, Shift+Enter добавляет строку заметки. Удалённую со сцены привязку можно убрать из таблицы группы.",
        "bodyEn": "On Information, choose the group, tags and GM notes. Each object belongs to one group. Settings opens its native Foundry sheet; Go to object returns the map to it without losing edits. Enter saves the form; Shift+Enter inserts a note line. A binding for a deleted scene object can be removed from the group table."
      },
      {
        "id": "player",
        "ru": "Подготовить персонажа игрока",
        "en": "Prepare a player character",
        "bodyRu": "Отметьте «Персонаж игрока»: автоматизация токена отключится, но персонаж сможет обращаться к объектам любых групп без собственной группы. Владение персонажем, дальность, видимость и теги по-прежнему проверяются.",
        "bodyEn": "Enable Player character: the token's automation is disabled, while it may interact across groups without owning a group. Character ownership, range, visibility and tags still apply."
      },
      {
        "id": "transitions",
        "ru": "Назначить поведение при смене состояния",
        "en": "Assign state-entry behavior",
        "bodyRu": "Во вкладке «Состояния» настройте «Исходное состояние» и «Переходы». В таблице переходов выберите состояние группы и создайте его скрипт. Подготовка сама ничего не запускает: переходный скрипт выполняется при явном входе в состояние. Для обычной работы после перехода используйте «Поведение → Рутина».",
        "bodyEn": "On States, configure Initial state and Transitions. Select a group state in the transition table and create its script. Preparation does not execute anything: the transition script runs on explicit state entry. Use Behavior → Routine for ordinary activity after the transition."
      },
      {
        "id": "restore",
        "ru": "Вернуть сцену к началу приключения",
        "en": "Reset the scene for a new adventure",
        "bodyRu": "Задайте «Исходное состояние» отдельным скриптом: положение, поворот, размеры, видимость и другие необходимые действия. «Восстановить исходное состояние» отменяет команду объекта и её ожидающую замену, снимает его ручное отключение поведения и выполняет исходный скрипт. Состояние всей группы эта кнопка не меняет. Для возврата группы к состоянию входа используйте её восстановление в Режиссёре. Потраченные предметы и другие факты игры автоматически не восстанавливаются.",
        "bodyEn": "Prepare Initial state as a separate script: position, rotation, size, visibility and other needed actions. Restore initial state cancels this object's command and pending replacement, clears its manual behavior disable and runs its initial script. This button does not change the whole group's state. To return a group to its entry state, use the group's restore control in Director. Spent items and other game facts are not automatically restored."
      },
      {
        "id": "properties",
        "ru": "Зарегистрировать инструменты объекта",
        "en": "Register the object's tools",
        "bodyRu": "На вкладке «Свойства» настройте подписки, сигналы, прикреплённые макросы, действия, команды и переменные. Вкладка «Поведение» связывает рутину с состоянием, события — с подписками, реакции — с действиями меню. Магазины и диалоги настраиваются на собственных вкладках для токенов, тайлов, рисунков и регионов.",
        "bodyEn": "On Properties, configure subscriptions, signals, attached macros, actions, commands and variables. Behavior connects routines to states, events to subscriptions and reactions to menu actions. Shops and dialogues have their own tabs for tokens, tiles, drawings and regions."
      },
      {
        "id": "features",
        "ru": "Разрешить действия игроков",
        "en": "Allow player actions",
        "bodyRu": "На вкладке «Магазины» или «Диалоги» добавьте инструмент из каталога и разрешите запуск для нужных состояний. Несколько диалогов могут быть доступны одновременно: задайте каждому отображаемое имя и порядок от нуля. Меню сортирует сначала по порядку, затем по имени. «Показывать в меню, если недоступен» оставляет пункт видимым, но не позволяет его запустить. Эти ограничения относятся к действиям игрока; явный вызов мастером из скрипта использует зарегистрированный инструмент независимо от них.",
        "bodyEn": "On Shops or Dialogues, add a catalog tool and allow it in the required states. Several dialogues can be available at once: give each a display name and order starting at zero. The menu sorts by order, then name. Show in menu when unavailable keeps an entry visible without allowing it to start. These restrictions govern player actions; an explicit GM script call uses a registered tool independently of them."
      },
      {
        "id": "automation",
        "ru": "Подключить сигналы и макросы",
        "en": "Connect signals and macros",
        "bodyRu": "В «Свойства → Сигналы» включите только нужные сигналы: по умолчанию публикация сигналов объекта выключена. Набор зависит от типа объекта; открытие и закрытие двери доступны только двери. Столкновение возникает после перемещения. Подписку на включённый сигнал настройте в «Подписках», затем подготовьте её скрипт в «Поведение → События». Прикреплённый макрос также может быть обработчиком подписки.",
        "bodyEn": "In Properties → Signals, enable only the signals you need: object signal publication is off by default. Available signals depend on the object type; door opening and closing apply only to doors. Collisions follow movement. Configure a subscription to an enabled signal under Subscriptions, then prepare its script in Behavior → Events. An attached macro can also handle a subscription."
      }
    ]
  },
  {
    "id": "scripts",
    "ru": "Собрать скрипт поведения",
    "en": "Build a behavior script",
    "sections": [
      {
        "id": "branches",
        "ru": "Выбрать следующий шаг по ситуации",
        "en": "Choose the next step for the situation",
        "bodyRu": "В переходе выберите «Макрос»: появится редактируемая заготовка, возвращающая список шагов. Она получает текущий шаг, состояние и значения переменных объекта. Оставьте в результате нужные номера; один номер задаёт точный переход, несколько — случайный выбор. Макрос условий доступен бесплатно. При сохранении проверяется его синтаксис, а циклы требуют подтверждения. Удаление шага удаляет и эту заготовку.",
        "bodyEn": "Choose Macro for a transition to open an editable example returning step IDs. It receives the current step, state and object variables. Return the required IDs: one gives a fixed transition, several give a random choice. Conditional macros are free. Saving checks syntax and asks for confirmation of possible cycles. Deleting the step also removes its branch source."
      },
      {
        "id": "premium",
        "ru": "Проверить скрипт без Premium",
        "en": "Check a script without Premium",
        "bodyRu": "«Фокус», «Звук», «Плейлист» и отдельный шаг «Макрос» помечены Premium и остаются видимыми. Без действующего доступа их настройки недоступны, а исполнение переходит к следующей строке, игнорируя переход пропущенного шага. Сохранённые параметры остаются. Условия меню и макросы выбора следующего шага доступны бесплатно.",
        "bodyEn": "Focus, Sound, Playlist and the separate Macro step remain visible and marked Premium. Without active access their settings are disabled and execution goes to the next row, ignoring the skipped step's transition. Saved parameters remain. Menu conditions and macros selecting the next step are free."
      },
      {
        "id": "tools",
        "ru": "Связать инструменты в последовательность",
        "en": "Combine tools into a sequence",
        "bodyRu": "«Магазин» открывает зарегистрированный магазин указанному персонажу; при необходимости дождитесь конца сделки. «Команда» обращается к другому объекту и проверяет разрешения. «Окна» и «Заметки» применяют сохранённую конфигурацию. Премиальный «Плейлист» выбирает композицию и действие: запуск, паузу, продолжение, громкость или остановку. Итоговая слышимость зависит и от громкости Foundry у участника.",
        "bodyEn": "Shop opens a registered shop for the specified character and can wait for the trade to finish. Command addresses another object and checks its permissions. Windows and Notes apply a saved configuration. Premium Playlist selects a track and action: play, pause, resume, volume or stop. Each participant's Foundry volume also affects what they hear."
      },
      {
        "id": "interruptions",
        "ru": "Продолжить скрипт после прерывания",
        "en": "Continue a script after interruption",
        "bodyRu": "В каждом блоке настройте прерывания боем, взаимодействием, командой, ручной остановкой и ошибкой. «Прервать» выбрано по умолчанию. Другие варианты повторяют текущий шаг, выбирают следующий по его переходу или возвращают к шагу 1. «Игнорировать» для команды заставляет принятую команду ждать окончания скрипта. Продолжение ждёт окончания помехи; после ручной остановки нужен запуск мастером. «Использовать в бою» сохраняет выполнение при начале боя и смене хода. Выполненные действия не откатываются.",
        "bodyEn": "In each block, configure interruptions by combat, interaction, command, manual stop and error. Stop is the default. Other modes restart the current step, follow its transition or return to step 1. Ignore for commands makes an accepted command wait until the script finishes. Continuation waits for the interruption to end; manual stop requires a GM start. Use in combat preserves execution at combat start and turn changes. Completed actions are not rolled back."
      },
      {
        "id": "error-retries",
        "ru": "Ограничить повторение ошибок",
        "en": "Limit error retries",
        "bodyRu": "Выбрав продолжение при ошибке, задайте «Повторов после ошибки» от 1 до 10 и «Таймаут повторений, с» от 0,1 до 60. По умолчанию — 3 повтора с паузой 1 секунда. Это повторные попытки после первоначальной: максимум 4 попытки при лимите 3. Лимит общий на запуск скрипта; успешные шаги, «Повторять» и ручное продолжение его не пополняют. После исчерпания скрипт останавливается. Новый вход в состояние или новое восстановление исходного состояния дают новый лимит. При «Прервать» поля не действуют, но сохраняют значения.",
        "bodyEn": "When choosing continuation on error, set Retries after an error from 1 to 10 and Retry delay, seconds from 0.1 to 60. Defaults are 3 retries with a 1-second pause. These follow the initial attempt: a limit of 3 allows at most 4 attempts. The budget is shared across one script run; successful steps, Repeat and manual continuation do not replenish it. The script stops once the budget is exhausted. A fresh state entry or initial-state restoration gets a new budget. Stop disables the fields but preserves their values."
      },
      {
        "id": "repetition",
        "ru": "Завершить переход и начать рутину",
        "en": "Finish a transition and start the routine",
        "bodyRu": "Рутина начинается после завершения скрипта перехода. Для однократного перехода снимите «Повторять»: у последней строки оставьте «Следующий» или пустой список в «Любой из». Для повторяющегося поведения с заметным интервалом добавьте «Ожидание». Редактор доступен и во время исполнения скриптов.",
        "bodyEn": "The routine starts after the transition script finishes. For a one-time transition, clear Repeat and leave the final row on Next, or use an empty Any of list. Add Wait for repeating behavior with a noticeable interval. The editor remains usable while scripts are running."
      },
      {
        "id": "warnings",
        "ru": "Сохранить мгновенный или повторяющийся скрипт",
        "en": "Save an instant or repeating script",
        "bodyRu": "При сохранении Ширма показывает незаданную длительность и возможные циклы изменённых скриптов. «Цикл без задержек (0 с)» выделен первым: он создаёт наибольший риск перегрузки. Проверьте показанные номера, выходы и «Повторять»; при необходимости добавьте «Ожидание». Эмоция или реплика «Вместе со следующим» не разрывает такой цикл даже с положительной длительностью. Задуманную настройку можно сохранить после подтверждения. Отмена сохраняет ввод и ничего не запускает. Неизменённые блоки повторно не спрашиваются, недостижимые шаги не учитываются.",
        "bodyEn": "When saving, Master screen shows unset durations and possible cycles in edited scripts. Zero-delay cycle (0 sec.) appears first because it poses the highest overload risk. Check the step IDs, exits and Repeat; add Wait if needed. An Emotion or Speech set to Alongside next step does not break such a cycle even with a positive duration. An intentional setup can be saved after confirmation. Cancel keeps your input and starts nothing. Unchanged blocks are not confirmed again; unreachable steps are ignored."
      },
      {
        "id": "transfer",
        "ru": "Перенести один блок скрипта",
        "en": "Transfer one script block",
        "bodyRu": "В раскрытом блоке нажмите «Экспорт JSON», чтобы скачать его актуальные настройки, включая несохранённые значения. «Импорт JSON» предлагает выбрать файл и подтвердить замену только этого блока. Затем нажмите «Сохранить». Привязка к состоянию берётся из текущего блока; диалоги, макросы и сигналы должны быть доступны самому объекту. Отмена сохраняет прежний ввод.",
        "bodyEn": "In an expanded block, press Export JSON to download its current settings, including unsaved values. Import JSON lets you choose a file and confirm replacement of that block only. Then press Save. The destination block determines its state; dialogues, macros and signals must belong to the current object. Cancel preserves the previous input."
      },
      {
        "id": "prepare",
        "ru": "Собрать действия для состояния",
        "en": "Build actions for a state",
        "bodyRu": "Откройте «Автоматизация». В «Состояния» подготовьте исходный и переходные скрипты. В «Поведение» создайте рутину нужного состояния, событие для подписки или реакцию для действия меню. Пустой блок не исполняет действий. Редактор и правила переходов одинаковы для всех блоков и скриптов команд.",
        "bodyEn": "Open Automation. Under States, prepare initial and transition scripts. Under Behavior, create a routine for a state, an event for a subscription or a reaction for a menu action. An empty block performs no work. All blocks and command scripts use the same editor and transition rules."
      },
      {
        "id": "steps",
        "ru": "Управлять порядком действий",
        "en": "Control action order",
        "bodyRu": "Добавьте шаг, выберите функцию и заполните параметры. Скрипт начинается с номера 1. Для перехода выберите «Следующий» — строку ниже, «Любой из» — один из указанных номеров с равной вероятностью, или «Макрос» — выбор по переменным. Перетаскивание сохраняет номера, но меняет маршрут «Следующий». Пустой список завершает скрипт; при «Повторять» он возвращается к шагу 1.",
        "bodyEn": "Add a step, choose its function and fill in parameters. Execution starts at ID 1. Choose Next row to follow the row below, Any of to select listed IDs with equal probability, or Macro to decide using variables. Dragging retains IDs but changes the Next row route. An empty target list ends the script, or returns to step 1 when Repeat is enabled."
      },
      {
        "id": "parameters",
        "ru": "Настроить действие без JSON",
        "en": "Configure an action without JSON",
        "bodyRu": "В столбце параметров меняйте значения рядом с названиями. Строка длительности 0 выделена красным: проверьте, что мгновенное действие задумано намеренно. Это подсказка, а не запрет. Вложенные разделы можно свернуть. Выбранный режим определяет видимые поля; скрытые значения сохраняются. Кнопка JSON у функции открывает все параметры этого шага и синхронизируется с таблицей. Исправьте ошибки JSON перед сохранением.",
        "bodyEn": "Edit values beside their names in the parameters column. A duration of 0 highlights its row in red: check that the instant action is intentional. This is a reminder, not a restriction. Nested sections can be collapsed. The chosen mode determines visible fields while retaining hidden values. JSON beside the function opens all parameters of that step and stays synchronized with the table. Correct JSON errors before saving."
      },
      {
        "id": "movement",
        "ru": "Подготовить движение и видимость",
        "en": "Prepare movement and visibility",
        "bodyRu": "Выберите «Перемещение» и режим «Длительность» или «Скорость». Длительность 0 выполняет действие мгновенно. В «Позиции» заполните координаты из текущего объекта либо кнопкой «Точка с карты»; в «Размере» можно взять текущие размеры. Поворот задаётся в градусах. Размеры и видимость доступны в пределах возможностей объекта; неподдерживаемые измерения не подменяются другими свойствами.",
        "bodyEn": "Choose Move and Duration or Speed mode. Duration 0 acts instantly. Under Position, use the current object coordinates or Map point; under Size, fill the object's current dimensions. Rotation uses degrees. Size and visibility respect the object's native capabilities; unsupported dimensions are not replaced with unrelated properties."
      },
      {
        "id": "presentation",
        "ru": "Добавить реплику и звук",
        "en": "Add speech and sound",
        "bodyRu": "«Реплика» выводит текст в чат, пузырь или оба места. «Режим выполнения → До следующего» по умолчанию ждёт указанную длительность перед следующим шагом; «Вместе со следующим» продолжает скрипт сразу. Длительность 0 не задерживает скрипт и сохраняет реплику до замены. Для чата задайте аудиторию тегами и расстоянием, момент отправки и удаление по завершении. В «Звуке» выбирайте файл штатным менеджером Foundry; множитель громкости учитывает громкость окружения игрока.",
        "bodyEn": "Speech can appear in chat, a bubble, or both. Execution mode → Before next step is the default: it waits for the duration before continuing; Alongside next step continues immediately. Duration 0 does not delay the script and keeps speech until replaced. For chat, set audience tags and distance, sending time and deletion after completion. Sound uses Foundry's file picker; its volume multiplier respects the player's ambient-volume setting."
      },
      {
        "id": "emotion",
        "ru": "Показать эмоцию над объектом",
        "en": "Show an emotion above an object",
        "bodyRu": "Выберите действие «Эмоция». Введите один символ или нажмите ☺ рядом с полем. Верхние значки прокручивают к четырём группам по 35 символов; выбор, клик снаружи или Escape закрывает окошко. «Размер» задаёт шрифт в пикселях карты: положительное число, включая дроби, по умолчанию 32. «Режим выполнения → Вместе со следующим» по умолчанию продолжает скрипт сразу; «До следующего» ждёт указанную длительность. Длительность 0 не задерживает скрипт и сохраняет эмоцию до замены. При одновременной реплике эмоция располагается над её пузырём, а после исчезновения пузыря возвращается к токену.",
        "bodyEn": "Choose the Emotion action. Type one symbol or press ☺ beside the field. The top icons scroll to four groups of 35 symbols; selection, an outside click or Escape dismisses the picker. Size sets the font size in map pixels: a positive number, including fractions, default 32. Execution mode → Alongside next step is the default and continues immediately; Before next step waits for the duration. Duration 0 does not delay the script and keeps the emotion until replaced. With simultaneous speech, the emotion sits above its bubble and returns to the token when the bubble disappears."
      },
      {
        "id": "state",
        "ru": "Переключить несколько групп скриптом",
        "en": "Change several groups from a script",
        "bodyRu": "Выберите функцию «Состояние» и добавьте строки «Группа → Состояние». Каждую группу можно указать один раз. Пустой список ничего не меняет. Запущенные группы продолжают работать в выбранном состоянии, остановленные остаются остановленными. Указание уже текущего состояния ничего не перезапускает. Если переключается собственная группа объекта, старый скрипт больше не продолжается. Отказ проверки перехода до переключения оставляет выбранные состояния прежними.",
        "bodyEn": "Choose the State function and add Group → State rows. Each group may appear once. An empty list changes nothing. Running groups continue in the selected state; stopped groups remain stopped. Selecting the current state does not restart it. If the object's own group changes state, its old script stops continuing. A transition validation denial before switching leaves the selected states unchanged."
      },
      {
        "id": "approach",
        "ru": "Подвести объект к цели",
        "en": "Bring an object to a target",
        "bodyRu": "Выберите «Приблизиться» сразу после «Перемещения». Вставьте UUID объекта текущей сцены из его «Информации». Расстояние 0 означает касание границ; большее число оставляет промежуток в единицах сцены. Выберите длительность или скорость. Длительность 0 перемещает мгновенно. Это действие идёт по прямой сквозь препятствия к положению цели на момент начала шага.",
        "bodyEn": "Choose Approach immediately after Move. Paste the current scene object's UUID from its Information window. Distance 0 means touching bounds; larger values leave a gap in scene units. Choose duration or speed. Duration 0 moves instantly. This action follows a straight line through obstacles to the target's position when the step starts."
      },
      {
        "id": "follow",
        "ru": "Следовать за объектом",
        "en": "Follow an object",
        "bodyRu": "В «Следовать» укажите UUID цели, минимальное и максимальное расстояния и скорость. За максимальной дистанцией объект догоняет цель до минимальной; слишком близкое положение само по себе не заставляет отходить назад. По умолчанию он повторяет траекторию цели; режим «По прямой» двигает к цели без поиска обхода и останавливает у непреодолимого препятствия. «Завершать по» выбирает переход к следующему шагу при достижении цели (по умолчанию) либо следование до смены состояния. Пауза и ручная остановка прерывают движение.",
        "bodyEn": "In Follow, enter the target UUID, minimum and maximum distances, and speed. Beyond the maximum distance, the object catches up to the minimum; being too close does not make it retreat. By default it follows the target's trajectory. Straight line moves toward the target without route finding and stops at an impassable obstacle. Finish on chooses the next step upon reaching the target (default), or continued following until a state change. Pausing and manual stopping interrupt movement."
      },
      {
        "id": "focus",
        "ru": "Привлечь внимание к объекту",
        "en": "Draw attention to an object",
        "bodyRu": "Премиальный шаг «Фокус» центрирует карту на исполнителе. Выберите «Всех», «Только игроков» или «Только мастера», включая ассистента. Масштаб и выделение не меняются; другая открытая сцена не переключается. При недоступном Premium шаг пропускается к следующей строке.",
        "bodyEn": "The Premium Focus step centers the map on its performer. Choose Everyone, Players only or GM only, including assistants. Zoom and selection stay unchanged; another open scene is not switched. Without Premium, execution skips to the next row."
      },
      {
        "id": "script-dialogue",
        "ru": "Начать разговор с персонажами",
        "en": "Start conversations with characters",
        "bodyRu": "Выберите диалог, добавленный на вкладке «Диалоги» объекта, и UUID персонажей, по одному в строке. Скрипт запускает его от имени мастера независимо от условий игрока и не расходует их кратность. Можно дождаться всех разговоров, первого завершившегося или продолжить сразу. Завершение освобождает ожидание, сохраняя переписку; «Закрыть» закрывает её окно.",
        "bodyEn": "Select a dialogue attached on the object's Dialogues tab and enter character token UUIDs, one per line. The script starts it for the GM independently of player conditions without consuming their limits. Wait for all conversations, the first completed one, or continue immediately. Completion releases the wait while retaining the transcript; Close dismisses its window."
      },
      {
        "id": "signals",
        "ru": "Вызвать реакцию других объектов",
        "en": "Request a reaction from other objects",
        "bodyRu": "«Сигнал» отправляет включённый сигнал своего объекта с заданными параметрами. Премиальный шаг «Макрос» выполняет прикреплённый макрос. Для события или реакции можно выбрать его входные параметры и открыть готовый образец кнопкой «Шаблон». Пустой выбор не требует соответствия этому образцу. Проверка выполняется при сохранении. Ожидания до и после относятся к обоим видам шага.",
        "bodyEn": "Signal sends an enabled signal belonging to its object with the configured parameters. The Premium Macro step executes an attached macro. For an event or reaction, select its input parameters and open the prepared example with Template. An empty selection does not require that interface. Saving validates the selection. Both step kinds support waits before and after execution."
      },
      {
        "id": "combat",
        "ru": "Использовать скрипт в бою",
        "en": "Use a script in combat",
        "bodyRu": "При поддержке боя включите «Использование в бою → Использовать». Задайте длительность хода и уведомления. «Подтверждать действие» позволяет продолжить, пропустить текущий ход или остановить скрипт в этом бою. Длительные действия продолжаются по ходам; после ручного вмешательства движение продолжится к подготовленной цели. «Завершать ход» изначально выключено.",
        "bodyEn": "When combat is supported, enable Combat use → Use in combat. Set turn duration and notifications. Confirm action lets you continue, skip this turn, or stop the script for this combat. Long actions continue across turns; after manual intervention, movement continues toward the prepared destination. End turn is off by default."
      },
      {
        "id": "dialogue-launch",
        "ru": "Выбрать способ запуска диалога",
        "en": "Choose how to start a dialogue",
        "bodyRu": "Диалог и магазин можно запускать скриптом работающего состояния, события или реакции. Ручное восстановление исходного состояния не открывает игровые разговоры и торговлю. Для показа без автоматизации используйте окно «Диалоги». Пауза или смена хода при открытии нескольких разговоров не создаёт повторных сессий: запуск продолжается после допуска.",
        "bodyEn": "Scripts in a running state, event or reaction can start a dialogue or shop. Manual initial restoration does not open live conversations or trades. For presentation without automation, use Dialogues. Pausing or changing turns while several conversations open does not duplicate sessions: opening continues when allowed."
      },
      {
        "id": "pause",
        "ru": "Поговорить с занятым НИП",
        "en": "Talk to a busy NPC",
        "bodyRu": "Выберите своего персонажа или поставьте таргет на нём и кликните НИП. Также можно подвести персонажа к нему. Открытый игроком магазин или диалог прерывает скрипт согласно настройке «Взаимодействием с игроком». Выбранное продолжение начнётся после завершения всех взаимодействий. Для разговоров, начатых самим скриптом, действует его настройка «Ожидание». Пропущенное время не наверстывается. «Стоп» и ручное отключение автоматизации всегда имеют приоритет.",
        "bodyEn": "Select or target your own character and click the NPC, or approach it. A player-opened shop or dialogue interrupts the script according to Player interaction. The chosen continuation starts after all interactions finish. Conversations started by the script itself follow its Waiting setting. Missed time is not caught up. Stop and manual automation disabling always take priority."
      }
    ]
  },
  {
    "id": "catalog-tools",
    "ru": "Подготовить магазины и диалоги",
    "en": "Prepare shops and dialogues",
    "sections": [
      {
        "id": "shop",
        "ru": "Создать общий ассортимент",
        "en": "Create shared stock",
        "bodyRu": "В «Инструменты → Магазины» создайте магазин, задайте имя, арт, вид ассортимента и подтверждение мастера. Перетащите предметы Foundry и укажите запас. В «Автоматизация → Магазины» добавьте его объекту и настройте доступные состояния и условия игрока. Один магазин можно открыть с нескольких объектов; все они разделяют запас и одну торговую сессию.",
        "bodyEn": "In Tools → Shops, create a shop with a name, art, stock display and GM approval. Drop Foundry items and set stock. In Automation → Shops, attach it to an object and configure available states and player conditions. Several objects can open one shop; they share its stock and single trading session."
      },
      {
        "id": "dialogue",
        "ru": "Собрать разговор",
        "en": "Prepare a conversation",
        "bodyRu": "В «Инструменты → Диалоги» создайте диалог с уникальным названием. Добавьте блоки текста, выберите начальный блок и изображения штатным менеджером Foundry. Ответ может продолжить разговор или закончить его и испустить настроенный сигнал диалога. Подписки на выбор ответа могут завершить или приостановить разговор; приостановленный разговор доступен как «Продолжить диалог».",
        "bodyEn": "In Tools → Dialogues, create a dialogue with a unique name. Add text blocks, choose the starting block and select images with Foundry's file picker. A reply may continue or end the conversation and emit a configured dialogue signal. Reply subscriptions can finish or suspend it; a suspended conversation offers Resume dialogue."
      },
      {
        "id": "preview",
        "ru": "Проверить условия без запуска",
        "en": "Check conditions without running",
        "bodyRu": "Нажмите «Предпросмотр», выберите группу, состояние, объект, персонажа, теги, дальность и видимость. При необходимости включите просмотр содержимого даже при отказе: причина останется видна. Эмуляция не меняет предметы, остатки, счётчики или состояния сцены и не отправляет сигналы.",
        "bodyEn": "Choose Preview, then select the group, state, object, character, tags, range and visibility. You may show content even when admission fails; its reason stays visible. Emulation changes no items, stock, counters or scene states and emits no signals."
      },
      {
        "id": "play",
        "ru": "Проверить от лица игрока",
        "en": "Try it as a player",
        "bodyRu": "Запустите группу в Режиссёре и проверьте меню от лица своего персонажа. Магазины, диалоги, действия и команды разделены на подменю. Недоступный пункт можно показать отключённым, если мастер это разрешил. Мастерские действия видны только мастеру и выделены красным. Один магазин обслуживает одного игрока с одним персонажем; сделки и разговоры видны мастеру в «Активности».",
        "bodyEn": "Start the group in Director and inspect the menu as your character. Shops, dialogues, actions and commands have separate submenus. An unavailable entry may remain visible but disabled when the GM allows it. GM-only actions are visible only to the GM and marked red. One shop serves one player and character at a time; the GM monitors trades and conversations in Activity."
      }
    ]
  }
];

export const OBJECT_HELP_SETTINGS = [
  { id: "settings-commands", ru: "Настройки команд", en: "Command settings", fields: [
    ['[name="command-interruption-combat"]', "combat", "Боем", "Combat", "Прервать команду (по умолчанию), либо после боя повторить текущую фазу, перейти к следующей или начать команду заново. Фазы: скрипт до, встроенное действие, скрипт после.", "Stop the command (default), or after combat restart its current phase, go to the next phase or restart the command. Phases are the preceding script, built-in action and following script."],
    ['[name="command-interruption-interaction"]', "interaction", "Взаимодействием с игроком", "Player interaction", "Прервать команду (по умолчанию), либо после взаимодействия повторить текущую фазу, перейти к следующей или начать команду заново.", "Stop the command (default), or after the interaction restart its current phase, go to the next phase or restart the command."],
    ['[name="command-interruption-manual"]', "manual", "Ручной остановкой", "Manual stop", "Останавливает команду немедленно. Выбранное продолжение с текущей, следующей или первой фазы возможно только после явного запуска мастером. По умолчанию команда прерывается.", "Stops the command immediately. Continuing from the current, next or first phase requires an explicit GM start. By default the command is cancelled."],
    ['[name="command-interruption-error"]', "error", "Ошибкой", "Error", "Прервать команду (по умолчанию), либо после таймаута повторить текущую фазу, перейти к следующей или начать команду заново. Повторы ограничены счётчиком; выполненные действия не откатываются.", "Stop the command (default), or after the delay restart its current phase, go to the next phase or restart the command. Retries are limited; completed actions are not rolled back."],
    ['[name="command-interruption-retries"]', "retries", "Повторов после ошибки", "Retries after an error", "Лимит повторных попыток после первоначальной, от 1 до 10; по умолчанию 3. Общий для текущего запуска команды. При «Прервать» настройка сохраняется, но не действует.", "Retry budget after the initial attempt, from 1 to 10; default 3. Shared by this command run. Stop preserves the setting but disables its use."],
    ['[name="command-interruption-delay"]', "delay", "Таймаут повторений, с", "Retry delay, seconds", "Ожидание перед повторной попыткой команды после ошибки: от 0,1 до 60 секунд, по умолчанию 1. При «Прервать» настройка не действует.", "Wait before retrying the command after an error: 0.1 to 60 seconds, default 1. Unused when Stop is selected."],
    ['[data-command-enabled]', "enabled", "Включена", "Enabled", "Разрешает выдавать эту команду объекту при выполнении условий. По умолчанию выключено; настройки сохраняются при выключении.", "Allows this command when its conditions pass. Off by default; disabling preserves the configuration."],
    ['[name="command-allow"]', "allow", "Разрешающие теги", "Allowed tags", "Теги командующего персонажа через запятую. Достаточно любого совпадения; пустой список не ограничивает.", "Comma-separated tags of the commanding character. Any match is sufficient; an empty list does not restrict access."],
    ['[name="command-deny"]', "deny", "Запрещающие теги", "Denied tags", "Любой совпавший тег командующего персонажа запрещает команду, даже если есть разрешающий тег.", "Any matching commanding-character tag blocks the command, even when an allowed tag also matches."],
    ['[name="command-range"]', "range", "Расстояние, ед.", "Range, scene units", "Максимальное расстояние между командующим персонажем и исполнителем при выдаче команды. Ноль допустим, отрицательное значение — нет.", "Maximum distance between the commanding character and performer when issuing the command. Zero is allowed; negative values are not."],
    ['[name="command-group"]', "group", "Принимать в этой группе", "Accept in this group", "Команда доступна в выбранных группах и их состояниях. Если ни одна группа не отмечена, ограничения по группам нет.", "The command is available in the selected groups and their states. If no group is selected, groups do not restrict access."],
    ['[name="command-state"]', "state", "Состояние", "State", "Допустимое состояние отмеченной группы. Без отмеченных состояний допускаются все состояния этой группы.", "An allowed state of the selected group. Without selected states, all of that group's states are allowed."],
    ['[name="command-param-speed"]', "speed", "Скорость, ед./с", "Speed, units/sec.", "Положительная скорость движения в единицах сцены за секунду; по умолчанию 5. Препятствия проверяются во время движения.", "Positive movement speed in scene units per second, default 5. Obstacles are checked during movement."],
    ['[name="command-param-duration"]', "duration", "Длительность, с", "Duration, seconds", "Положительное ограничение времени движения; по умолчанию 10 секунд. Ноль не означает бесконечное движение.", "A positive movement time limit, default 10 seconds. Zero does not mean unlimited movement."],
    ['[name="command-param-seconds"]', "seconds", "Время ожидания, с", "Wait, seconds", "Команда «Жди» удерживает объект на месте указанное время, после чего завершается. Положительное число, по умолчанию 10 секунд.", "Wait holds the object in place for this time, then completes. A positive number, default 10 seconds."],
    ['[name="command-param-waitSeconds"]', "wait", "Ожидание после команды, с", "Wait after command, seconds", "После «Встань там» или «Отмена» объект ждёт это время. Положительное число, по умолчанию 1 секунда.", "After Stand there or Cancel, the object waits for this time. A positive number, default 1 second."],
    ['[name="command-param-minDistance"]', "minimum", "Минимальное расстояние", "Minimum distance", "На этой дистанции от границ командующего персонажа следование перестаёт приближать исполнителя. Ноль означает касание.", "At this gap from the commanding character's bounds, following stops bringing the performer closer. Zero means touching."],
    ['[name="command-param-maxDistance"]', "maximum", "Максимальное расстояние", "Maximum distance", "При превышении этой дистанции исполнитель догоняет командующего. Значение не меньше минимального расстояния.", "Beyond this gap the performer catches up with the commanding character. Must be at least the minimum distance."],
    ['[name="command-param-mode"]', "mode", "Режим следования", "Following mode", "По траектории повторяет путь персонажа; по прямой движется к нему до препятствия без поиска обхода.", "Along trajectory repeats the character's route; Straight line heads toward them until blocked, without route finding."],
    ['[name="command-param-bright"]', "bright", "Яркий свет, ед.", "Bright light, units", "Радиус яркого света сопровождающего источника в единицах сцены. Ноль отключает яркую часть.", "Bright radius of the following light source in scene units. Zero disables the bright area."],
    ['[name="command-param-dim"]', "dim", "Тусклый свет, ед.", "Dim light, units", "Радиус тусклого света сопровождающего источника в единицах сцены. Ноль отключает тусклую часть.", "Dim radius of the following light source in scene units. Zero disables the dim area."],
    ['[name="command-param-issuer"]', "issuer", "Кто может выдать команду", "Who may issue the command", "«Стой»: мастер или все игроки. «Отмена»: мастер, командующий игрок или все игроки. Мастер сохраняет право вмешательства; остальные условия допуска проверяются.", "Stop: GM or all players. Cancel: GM, the commanding player, or all players. The GM retains control; other admission conditions still apply."]
  ] },
  { id: "settings-preview", ru: "Предпросмотр взаимодействия", en: "Interaction preview", fields: [
    ['[class~="ms-interaction-preview"] [name="groupId"]', "group", "Группа", "Group", "Группа для проверки условий. Подготовка и работа сцены не меняются.", "The group used to check conditions. Scene preparation and execution stay unchanged."],
    ['[class~="ms-interaction-preview"] [name="stateId"]', "state", "Состояние", "State", "Состояние для проверки доступности инструмента.", "The state used to check tool availability."],
    ['[class~="ms-interaction-preview"] [name="target"]', "target", "Объект", "Object", "Точка доступа к магазину или диалогу. Проверяется назначение выбранного инструмента этому объекту.", "The access point for the shop or dialogue. Its attachment is checked."],
    ['[class~="ms-interaction-preview"] [name="actorTokenId"]', "actor", "Персонаж", "Character", "Персонаж для репетиции. Предметы используются как локальная копия, исходный инвентарь не меняется.", "The rehearsing character. Items are copied locally; the original inventory stays unchanged."],
    ['[class~="ms-interaction-preview"] [name="tags"]', "tags", "Имитируемые теги", "Emulated tags", "Теги персонажа для проверки белого и чёрного списков.", "Character tags used to check allow and deny lists."],
    ['[class~="ms-interaction-preview"] [name="distance"]', "distance", "Расстояние", "Distance", "Имитируемое расстояние в единицах сцены.", "The emulated distance in scene units."],
    ['[class~="ms-interaction-preview"] [name="used"]', "used", "Использований", "Uses", "Сколько запусков считать уже потраченными для проверки лимита.", "How many activations to consider consumed when checking the limit."],
    ['[class~="ms-interaction-preview"] [name="enabled"]', "enabled", "Допуск включён", "Admission enabled", "Имитирует ручной флаг разрешения взаимодействия.", "Emulates the manual interaction-admission flag."],
    ['[class~="ms-interaction-preview"] [name="visible"]', "visible", "Объект виден", "Object visible", "Имитирует видимость объекта для выбранного персонажа.", "Emulates visibility from the chosen character."],
    ['[class~="ms-interaction-preview"] [name="halted"]', "halted", "Группа остановлена", "Group stopped", "Проверяет ограничения взаимодействия при остановке группы.", "Checks interaction restrictions while the group is stopped."],
    ['[class~="ms-interaction-preview"] [name="showBlocked"]', "blocked", "Показать содержимое при отказе", "Show content when blocked", "Позволяет мастеру репетировать даже при отказе условий. Не открывает доступ игрокам.", "Lets the GM rehearse despite rejected conditions. It grants players no access."]
  ] },
  { id: "settings-scripts", ru: "Настройки скрипта", en: "Script settings", fields: [
    ['[name^="script-"][name$="-name"]', "name", "Название скрипта", "Script name", "Краткое имя в свёрнутом заголовке. Помогает отличать поведение состояний.", "A short name shown in the collapsed heading, helping distinguish state behaviors."],
    ['[name^="script-"][name$="-enabled"]:not([name*="-combat-"])', "enabled", "Включить", "Enable", "Разрешает выполнение скрипта. Выключение сохраняет все шаги; по умолчанию включено.", "Allows script execution. Disabling preserves all steps; enabled by default."],
    ['[name^="script-"][name$="-repeat"]', "repeat", "Повторять", "Repeat", "После завершающего шага возвращает к шагу 1. По умолчанию выключено.", "Returns to step 1 after a terminal action. Off by default."],
    ['[name^="script-"][name$="-interruption-combat"]', "interruption-combat", "Боем", "Combat", "Для скрипта без разрешения работать в бою: прервать (по умолчанию) либо после завершения боя начать текущий шаг, следующий шаг по переходам или весь скрипт заново. На разрешённый в бою скрипт эта настройка не влияет.", "For a script not allowed in combat: stop (default), or after combat ends restart the current step, follow its next graph destination, or restart the script. This setting does not affect scripts allowed in combat."],
    ['[name^="script-"][name$="-interruption-interaction"]', "interruption-interaction", "Взаимодействием с игроком", "Player interaction", "Прервать (по умолчанию) либо после завершения всех взаимодействий начать текущий шаг, следующий шаг по переходам или весь скрипт заново. Собственный вызов диалога скриптом использует настройку ожидания диалога.", "Stop (default), or after all interactions finish restart the current step, follow its next graph destination, or restart the script. A script's own dialogue call uses its dialogue waiting setting."],
    ['[name^="script-"][name$="-interruption-manual"]', "interruption-manual", "Ручной остановкой", "Manual stop", "Остановка действует немедленно при любом выборе. Продолжение с текущего шага, следующего шага по переходам или начала скрипта возможно только после явного запуска мастером. По умолчанию — прервать.", "Stopping takes effect immediately in every mode. Continuing from the current step, its next graph destination, or the beginning requires an explicit GM start. Stop is the default."],
    ['[name^="script-"][name$="-interruption-command"]', "interruption-command", "Командой", "Command", "Прервать — по умолчанию; продолжение после команды задаётся с текущего шага, следующего по переходам или начала скрипта. «Игнорировать» позволяет текущему блоку закончиться: принятая команда ждёт его, новая рутина не начинается. В скриптах до/после команды по умолчанию выбрано «Игнорировать». Ручную аварийную остановку игнорировать нельзя.", "Stop is the default; after the command, continuation can restart the current step, follow its next graph destination, or restart the script. Ignore lets the current block finish: the accepted command waits and no new routine starts. Before/after command scripts default to Ignore. An emergency manual stop cannot be ignored."],
    ['[name^="script-"][name$="-interruption-error"]', "interruption-error", "Ошибкой", "Error", "Прервать при ошибке (по умолчанию) либо после таймаута начать текущий шаг, следующий шаг по переходам или весь скрипт заново. Повторы ограничены счётчиком; уже выполненные действия не отменяются.", "Stop on error (default), or after the delay restart the current step, follow its next graph destination, or restart the script. Retries are limited; completed actions are not undone."],
    ['[name^="script-"][name$="-interruption-retries"]', "interruption-retries", "Повторов после ошибки", "Retries after an error", "Повторные попытки после первоначальной: целое число от 1 до 10, по умолчанию 3. Лимит общий на запуск: успешный шаг, «Повторять» и ручное продолжение его не пополняют. После исчерпания скрипт останавливается. При «Прервать» значение сохраняется, но не действует.", "Retries after the initial attempt: an integer from 1 to 10, default 3. The budget is shared across the run: successful steps, Repeat and manual continuation do not replenish it. The script stops once exhausted. Stop preserves the value but disables its use."],
    ['[name^="script-"][name$="-interruption-delay"]', "interruption-delay", "Таймаут повторений, с", "Retry delay, seconds", "Пауза перед каждой повторной попыткой после ошибки: от 0,1 до 60 секунд, допускаются дроби, по умолчанию 1 секунда. При выборе «Прервать» поле не действует, но сохраняет значение.", "Pause before each retry after an error: 0.1–60 seconds, including fractions; default 1 second. Stop disables this field but preserves its value."],
    ['[data-script-kind]', "function", "Функция", "Function", "Выберите действие. Его параметры заменятся подходящим шаблоном.", "Choose an action. Its parameters are replaced with the appropriate template."],
    ['[data-script-json]', "parameters", "Параметры (JSON)", "Parameters (JSON)", "Те же параметры, что в таблице; содержит и скрытые режимом поля. Изменения синхронизируются. Исправьте ошибки формата до сохранения.", "The same parameters as the table, including fields hidden by the current mode. Changes are synchronized. Correct format errors before saving."],
    ["[data-script-param='[\"emoji\"]']", "emotion", "Эмоция", "Emotion", "Один символ над объектом. Кнопка ☺ открывает выбор по группам; можно ввести свой символ или очистить поле.", "One symbol above the object. The ☺ button opens grouped choices; you may type your own symbol or clear the field."],
    ["[data-script-param='[\"size\"]']", "emotion-size", "Размер", "Size", "Размер эмоции в пикселях карты. Положительное число, допускаются дроби; по умолчанию 32. При масштабировании карты символ масштабируется вместе с ней.", "Emotion font size in map pixels. A positive number; fractions are allowed, default 32. The symbol scales with map zoom."],
    ["[data-script-param='[\"executionMode\"]']", "execution-mode", "Режим выполнения", "Execution mode", "«Вместе со следующим» сразу продолжает скрипт, пока эффект отображается; «До следующего» ждёт длительность. По умолчанию эмоция выполняется вместе со следующим шагом, реплика — до него. Длительность 0 в обоих режимах не задерживает скрипт и сохраняет эффект до замены.", "Alongside next step continues the script while the effect remains visible; Before next step waits for its duration. Emotion defaults to Alongside next step; Speech defaults to Before next step. Duration 0 in either mode does not delay the script and keeps the effect until replaced."],
    ['[data-script-state-group]', "state-group", "Группа", "Group", "Группа, которой скрипт сменит состояние. Дубли групп не допускаются; остальные группы не изменяются.", "The group whose state the script changes. Duplicate groups are not allowed; other groups are unchanged."],
    ['[data-script-state-value]', "state-target", "Состояние", "State", "Целевое состояние выбранной группы. Смена сохраняет её статус запуска автоматизации и проверяет разрешение перехода.", "The selected group's target state. Switching preserves its automation status and validates the transition."],
    ["[data-script-param='[\"targetUuid\"]']", "target-uuid", "Объект (UUID)", "Object (UUID)", "UUID объекта текущей сцены, к которому нужно приблизиться или за которым следовать. Скопируйте его на вкладке «Информация» окна «Автоматизация».", "UUID of the current scene object to approach or follow. Copy it from Information in the Automation window."],
    ["[data-script-param='[\"distance\"]']", "approach-distance", "Расстояние", "Distance", "Промежуток между границами объектов в единицах сцены. Ноль — касание, значение по умолчанию. «Приблизиться» игнорирует препятствия.", "Gap between object bounds in scene units. Zero means touching and is the default. Approach ignores obstacles."],
    ["[data-script-param='[\"minDistance\"]']", "follow-minimum", "Минимальное расстояние", "Minimum distance", "При догонянии движение прекращается на этой дистанции от границ цели. Ноль — касание.", "While catching up, movement stops at this gap from the target's bounds. Zero means touching."],
    ["[data-script-param='[\"maxDistance\"]']", "follow-maximum", "Максимальное расстояние", "Maximum distance", "За этой дистанцией объект начинает догонять цель. Не меньше минимального расстояния.", "Beyond this gap the object starts catching up. Must be at least the minimum distance."],
    ["[data-script-param='[\"speed\"]']", "movement-speed", "Скорость", "Speed", "Положительное число в единицах сцены за секунду. Длительность перемещения рассчитывается по пути и скорости.", "A positive number in scene units per second. Movement time is calculated from the route and speed."],
    ["[data-script-param='[\"mode\"]']", "follow-mode", "Режим", "Mode", "По траектории — повторять путь цели (по умолчанию). По прямой — идти к цели до препятствия без поиска обхода.", "Along trajectory repeats the target's path (default). Straight line heads toward the target until blocked, without route finding."],
    ["[data-script-param='[\"finishOn\"]']", "follow-finish", "Завершать по", "Finish on", "Достижению цели — перейти к следующему шагу (по умолчанию). Смене состояния — продолжать следование до смены состояния или остановки.", "Reaching the target advances to the next step (default). State change keeps following until the state changes or execution stops."],
    ["[data-script-param='[\"dialogueId\"]']", "script-dialogue", "Диалог", "Dialogue", "Диалог, зарегистрированный на вкладке «Диалоги» объекта. Скриптовый запуск мастером не проверяет и не расходует условия самостоятельного обращения игрока.", "A dialogue registered on the object's Dialogues tab. A GM-scripted start bypasses and does not consume player-initiated access conditions."],
    ["[data-script-param='[\"tokenUuids\"]']", "dialogue-characters", "Персонажи", "Characters", "UUID токенов текущей сцены, по одному в строке. Для каждого нужен активный владелец персонажа.", "Token UUIDs from the current scene, one per line. Each character needs an active owner."],
    ["[data-script-param='[\"waitMode\"]']", "dialogue-wait", "Ожидание", "Waiting", "Дожидаться всех диалогов — по умолчанию. Дождаться завершения первого из диалогов — любого первого завершившегося. Не дожидаться завершения диалогов — сразу продолжить этот скрипт.", "Wait for all dialogues is the default. Wait for the first dialogue to finish accepts whichever finishes first. Do not wait for dialogues continues this script immediately."],
    ['[name^="script-"][name$="-next"]', "next", "Переход", "Next", "Номер следующего шага; несколько номеров через запятую выбираются случайно. Пустое поле завершает скрипт.", "The next step ID; several comma-separated IDs choose randomly. Blank ends the script."],
    ['[name$="-combat-enabled"]', "combat", "Использовать в бою", "Use in combat", "Разрешает скрипту действовать в ход объекта без прерывания боем. Без этой настройки при начале боя действует выбранное поведение прерывания «Боем».", "Allows the script to act on the object's turn without combat interruption. Otherwise, starting combat applies the selected Combat interruption behavior."],
    ['[name$="-combat-confirm"]', "confirm", "Подтверждать действие", "Confirm action", "Перед продолжением предлагает мастеру продолжить, пропустить ход или остановить скрипт в бою. По умолчанию включено.", "Offers the GM Continue, Skip turn, or Stop script in combat. On by default."],
    ['[name$="-combat-warning"]', "warning", "Предупреждение", "Warning", "Показывает мастеру уведомление при передаче хода объекту.", "Shows the GM a notification when the object's turn starts."],
    ['[name$="-combat-chat"]', "chat", "В чате мастеру", "In GM chat", "Отправляет уведомление через Информатора только мастерам.", "Sends an Informer notification only to GMs."],
    ['[name$="-combat-end-turn"]', "end", "Завершать ход", "End turn", "Разрешает завершать ход после расчёта действий. По умолчанию выключено.", "Allows ending the turn after calculating actions. Off by default."],
    ['[name$="-combat-seconds"]', "seconds", "Длительность хода", "Turn duration", "Сколько секунд длительности действий расходуется за один ход. Положительное число, допускаются дроби.", "How many seconds of action duration a turn consumes. A positive number; fractions are allowed."]
  ] },
  { id: "settings-object-properties", ru: "Переменные и действия объекта", en: "Object variables and actions", fields: [
    ['[name^="variable-"][name$="-name"]', "variable-name", "Имя переменной", "Variable name", "Уникальное имя в пределах объекта. Используйте понятное название, чтобы выбирать нужное значение в подготовленных макросах.", "A unique name within this object. Choose a clear label so prepared macros can identify the intended value."],
    ['[name^="variable-"][name$="-type"]', "variable-type", "Тип", "Type", "Текст, целое или дробное число. Исходное значение и дальнейшие изменения должны соответствовать выбранному типу.", "Text, integer or number. The initial value and later changes must match the selected type."],
    ['[name^="variable-"][name$="-value"]', "variable-value", "Исходное значение", "Default value", "Подготовленное значение до первого игрового изменения. Редактирование подготовки не перезаписывает уже изменённое в игре значение.", "The prepared value before the first gameplay change. Editing preparation does not overwrite an already changed gameplay value."],
    ['[name^="variable-"][name$="-internal"]', "variable-internal", "Внутреннее изменение", "Internal write", "Разрешает собственным скриптам объекта менять значение. По умолчанию включено; чтение собственных переменных доступно всегда.", "Allows this object's own scripts to change the value. On by default; reading its own variables is always allowed."],
    ['[name^="variable-"][name$="-externalRead"]', "variable-read", "Внешний просмотр", "External read", "Позволяет другим объектам читать эту переменную. По умолчанию выключено.", "Allows other objects to read this variable. Off by default."],
    ['[name^="variable-"][name$="-externalWrite"]', "variable-write", "Внешнее изменение", "External write", "Позволяет другим объектам менять эту переменную. Не включает внешний просмотр автоматически. По умолчанию выключено.", "Allows other objects to change this variable. It does not automatically enable external reading. Off by default."],
    ["action-name", "action-name", "Название действия", "Action name", "Текст пункта интерактивного меню объекта. Для исполнения подготовьте соответствующий скрипт в «Поведение → Реакции».", "The label in the object's interaction menu. Prepare its corresponding script in Behavior → Reactions."],
    ["action-enabled", "action-enabled", "Включено", "Enabled", "Разрешает действие при выполнении остальных условий. Выключение сохраняет подготовку, но не позволяет запустить действие.", "Allows the action when its other conditions are met. Disabling retains preparation but prevents execution."],
    ["action-audience", "action-audience", "Кому доступно", "Available to", "Игрокам, мастеру или всем. Пункты только для мастера скрыты от игроков и выделены красным в меню мастера.", "Players, GM or everyone. GM-only entries are hidden from players and shown in red in the GM's menu."],
    ["action-range", "action-range", "Дальность", "Range", "Максимальное расстояние от действующего персонажа до объекта в единицах сцены.", "Maximum distance from the acting character to this object in scene units."],
    ["action-order", "action-order", "Порядок", "Order", "Целое число от нуля. Сначала пункты сортируются по этому числу, затем по названию.", "An integer starting at zero. Entries sort by this number, then by name."],
    ["action-unavailable", "action-unavailable", "Показывать в меню, если недоступно", "Show in menu when unavailable", "Оставляет пункт видимым, но отключённым, если условия запуска не выполнены. Не даёт права его исполнить.", "Keeps an entry visible but disabled when its launch conditions fail. It does not grant permission to execute."],
    ["action-parameters", "action-parameters", "Параметры действия", "Action parameters", "Подготовленные мастером данные, передаваемые скрипту реакции при выборе действия. Пустой объект подходит для реакции без дополнительных параметров.", "GM-prepared data passed to the reaction script when the action is chosen. An empty object suits a reaction with no extra parameters."],
    ["action-macro", "action-macro", "Макрос условия", "Condition macro", "Дополнительная проверка доступности по переменным объекта и текущему состоянию. Разрешающий результат не отменяет остальные условия. Пустое поле не добавляет ограничения; «Шаблон» помогает начать настройку.", "An additional availability check using the object's variables and current state. An allowing result does not bypass other conditions. An empty field adds no restriction; Template helps you begin preparation."]
  ] },
  { id: "settings-objects", ru: "Автоматизация объектов", en: "Object automation", fields: [
    ["register-shop", "register-shop", "Магазины", "Shops", "На вкладке «Магазины» добавьте магазин из каталога. Для самостоятельного обращения игрока настройте условия назначения.", "On Shops, add a catalog shop. Configure its assignment conditions to allow player-initiated access."],
    ["register-dialogue", "register-dialogue", "Диалоги", "Dialogues", "Выберите диалог из каталога и нажмите «Добавить». Он станет доступен скриптам объекта; условия самостоятельного запуска игроком настраиваются отдельно.", "Choose a catalog dialogue and press Add. It becomes available to the object's scripts; player-initiated access is configured separately."],
    ["object-player-character", "player", "Персонаж игрока", "Player character", "Отключает автоматизацию токена. Разрешает взаимодействия с объектами любых групп с проверкой владения и условий.", "Disables token automation. Allows interaction across groups with ownership and condition checks."],
    ["object-group", "owner", "Группа", "Group", "Единственная группа, управляющая автоматизацией объекта. Перед переназначением остановите затронутые группы.", "The single group controlling this object's automation. Stop affected groups before reassigning."],
    ["object-tags", "tags", "Теги", "Tags", "Теги объекта через запятую. Условия инструментов проверяют теги действующего персонажа.", "Comma-separated object tags. Tool conditions check the acting character's tags."],
    ["object-notes", "notes", "Заметки мастера", "GM notes", "Личные заметки подготовки. Enter сохраняет окно; Shift+Enter добавляет строку.", "Private preparation notes. Enter saves the window; Shift+Enter adds a line."],
    ["entryStateId", "entry", "Состояние входа", "Entry state", "Обязательное состояние, выбранное по умолчанию для явного запуска. Просмотр карты ничего не запускает.", "Required default state for an explicit start. Viewing the map starts nothing."],
    ["newOwnedObject", "add", "Объект группы", "Group object", "Выберите существующий объект сцены для назначения группе.", "Choose an existing scene object to assign to the group."],
    ["feature-asset", "asset", "Инструмент", "Tool", "Магазин или диалог для выбранного назначения. Каталог может использоваться несколькими объектами.", "The shop or dialogue for this attachment. Several objects may share the catalog."],
    ["feature-range", "range", "Дальность", "Range", "Максимальное расстояние до объекта в единицах сцены. Дополнительно проверяется видимость.", "Maximum distance to the object in scene units. Visibility is also checked."],
    ["feature-name", "feature-name", "Отображаемое имя", "Display name", "Название этого магазина или диалога в меню объекта. Пустое поле использует название из каталога.", "This shop or dialogue's label in the object menu. An empty field uses its catalog name."],
    ["feature-order", "feature-order", "Порядок", "Order", "Целое число от нуля. Назначения сортируются по нему, затем по отображаемому имени.", "An integer starting at zero. Attachments sort by this number, then by their display name."],
    ["feature-unavailable", "feature-unavailable", "Показывать в меню, если недоступно", "Show in menu when unavailable", "Показывает инструмент отключённым при невыполненных условиях. Не разрешает открыть его.", "Shows the tool disabled when its conditions fail. It does not allow opening it."],
    ["feature-macro", "feature-macro", "Макрос условия", "Condition macro", "Дополнительная проверка для самостоятельного запуска игроком. Может учитывать переменные объекта и состояние; пустое поле не добавляет ограничения. Явный вызов инструментов скриптом мастера от этой проверки не зависит.", "An additional check for player-initiated access. It can use the object's variables and state; an empty field adds no restriction. An explicit GM script call is independent of this check."]
  ] },
  { id: "settings-tool-catalog", ru: "Каталоги инструментов", en: "Tool catalogs", fields: [
    ["assetName", "name", "Название", "Name", "Уникальное название среди магазинов или диалогов сцены.", "A unique name among the scene's shops or dialogues."],
    ["assetDescription", "description", "Описание", "Description", "Заметка о назначении инструмента для мастера.", "A note describing the tool's purpose to the GM."],
    ["shopImg", "image", "Изображение магазина", "Shop image", "Арт, отображаемый рядом с ассортиментом.", "Art shown beside the stock list."],
    ["shopStock", "stock", "Начальный запас", "Initial stock", "Количество целых предметов при первом запуске магазина. Изменение подготовки не пополняет действующие остатки.", "Complete items stocked when the shop first runs. Editing preparation does not replenish live stock."],
    ["dialogueStartPage", "start", "Первый блок", "First page", "С этого блока начинается обычный разговор. Предпросмотр выбранного блока может начинаться с другого места.", "Normal conversations start with this page. Previewing a selected page can start elsewhere."],
    ["dialoguePageName", "block-name", "Название блока", "Page name", "Название для подготовки и выбора переходов; не заменяет произнесённый текст.", "A preparation label used to select transitions; it does not replace spoken text."],
    ["dialoguePageText", "text", "Текст блока", "Page text", "Реплика объекта или описание, которое увидит участник при появлении блока.", "The object line or description participants see when this page appears."],
    ["dialoguePageArt", "art", "Изображение блока", "Page image", "Выберите или загрузите картинку штатной кнопкой Foundry. В окне она располагается рядом с текстом, в чате — после текста на ширину карточки.", "Choose or upload an image with Foundry's file picker. In a window it appears beside the text; in chat it follows the text at the card's full width."],
    ["responseNextPage", "next", "Продолжение", "Continue to", "Следующий блок. Пустой выбор завершает разговор.", "The next block. An empty choice ends the conversation."],
    ["responseSignal", "signal", "Сигнал ответа", "Response signal", "Объявленный этим диалогом сигнал для выбранного ответа.", "A signal declared by this dialogue for the chosen reply."],
    ["responseParameters", "parameters", "Параметры сигнала (JSON)", "Signal parameters (JSON)", "Значения в формате JSON должны соответствовать полям сигнала.", "JSON values must match the signal's declared fields."]
  ] }
];
