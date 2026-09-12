// Content belongs to Master screen; Generics supplies the help viewer.
import { OBJECT_HELP_PAGES, OBJECT_HELP_SETTINGS } from "./object-help-content.js";
const section = (id, ru, en, bodyRu, bodyEn) => ({ id, ru, en, bodyRu, bodyEn });
const page = (id, ru, en, sections) => ({ id, ru, en, sections });
export const SCREEN_HELP_PAGES = [
  ...OBJECT_HELP_PAGES,
  page("start", "Подготовить сцену", "Prepare a scene", [
    section("prepare", "Открыть Ширму", "Open Master screen", "Создайте карту и объекты средствами Foundry. В категории 🎬 выберите «Ширма». Она открывается панелью; повторное нажатие закрывает её. Положение и размеры сохраняются. Вверху панели можно переключить Конструктор и Режиссёр или отделить Ширму в окно браузера.", "Create the map and objects in Foundry. Select Master screen in the 🎬 category to open the panel; select it again to close it. Position and size are remembered. Use the top bar to switch Constructor and Director or detach the screen into a browser window."),
    section("states", "Создать подготовку", "Create preparation", "Новая сцена не содержит групп. На вкладке «Сцена» создайте группу: в ней сразу будет одно состояние. Добавьте нужные состояния, например «Спокойствие» и «Тревога». Группы независимо управляют разными объектами. Сохранение подготовки ничего не запускает.", "New scenes have no groups. Create a group on Scene; it starts with one state. Add states such as Calm and Alarm. Groups independently control different objects. Saving preparation never starts it.")
  ]),
  page("constructor", "Организовать подготовку", "Organize preparation", [
    section("panel", "Освободить карту", "Keep the map clear", "Переключайте расположение панели справа или снизу и тяните выделенные границы панели и её двух зон. Размеры сохраняются после перезагрузки. Шестерёнка управляет видимостью вкладок. Штатные инструменты стен, освещения и тайлов остаются доступны при открытой Ширме.", "Dock the panel on the right or bottom and drag its marked outer and inner dividers. Sizes survive reloading. The gear controls visible tabs. Native wall, lighting and tile tools remain available while Master screen is open."),
    section("window", "Использовать второй монитор", "Use another monitor", "Кнопка отделения в верхней строке открывает окно браузера. Разрешите всплывающие окна для Foundry, если браузер их блокирует. Закрытие внешнего окна возвращает панель и сохраняет ввод; кнопка закрытия самой Ширмы закрывает её инструменты.", "The detach button in the top bar opens a browser window. Allow popups for Foundry if necessary. Closing that browser window returns the panel and retains edits; Master screen's own close button closes its tools."),
    section("graph", "Разделить объекты по группам", "Organize object groups", "Выберите строку группы или состояния, чтобы редактировать её в дополнительной зоне. Имена групп уникальны в сцене, имена состояний — внутри группы. Перетаскивание меняет порядок. Состояние с настройками принадлежащих группе объектов нельзя перенести в другую группу без переназначения объектов.", "Select a group or state row to edit it in the secondary area. Group names are unique within the scene; state names within their group. Drag to reorder. A state containing owned object preparation cannot move to another group without reassigning those objects."),
    section("badges", "Видеть состояние сцены", "See scene state", "Укажите группе один символ и цвета строк. Значки над кнопками сцен и в Ширме показывают текущее состояние. Наведение показывает название группы и состояния. Не запущенные и остановленные группы отмечены отдельно. Удалить все группы можно; существующей группе нужно хотя бы одно состояние входа.", "Choose a symbol and row colors for the group. Badges above scene buttons and inside Master screen show its current state. Hover to read group and state names. Unstarted and stopped groups are marked separately. All groups may be removed; an existing group needs at least one entry state."),
    section("tabs", "Выбрать инструмент", "Choose a tool", "«Инструменты» содержат магазины и диалоги. «Автоматизация» содержит сигналы и макросы. Категории только раскрывают меню. Стрелки прокручивают длинный ряд вкладок. «Иное» содержит оставшиеся настройки карты, прямых взаимодействий и рабочих окон.", "Tools contains shops and dialogues. Automation contains signals and macros. Categories only expand their menu. Arrows scroll overflowing tabs. Other contains remaining map, direct interaction and workspace settings.")
  ]),
  page("signals", "Связать действия сигналами", "Connect actions with signals", [
    section("create", "Выбрать источник", "Choose a source", "На вкладке «Сигналы» выберите категорию: «Сцена», «Группы», «Токены», «Тайлы», «Рисунки», «Стены» или «Прочие». В «Сцене» находятся сцена, боевой агент, магазины и диалоги. Раскройте эмитента и нажмите строку сигнала; техническое имя показано отдельно. При выборе объекта карта центрируется на нём и включается нужный слой Foundry.", "On Signals, choose Scene, Groups, Tokens, Tiles, Drawings, Walls or Other. Scene contains the scene, combat agent, shops and dialogues. Expand an emitter and select a signal row; its technical name has a separate column. Selecting a map object centers the canvas on it and activates its Foundry layer."),
    section("fields", "Описать данные и результат", "Describe data and results", "Параметры передают сведения о действии; возвраты собирают ответы подписчиков. Раскройте имя поля, выберите тип, допустимость null, ограничения, значение по умолчанию и описание. Тип определяет доступные настройки. Кнопка JSON открывает тот же параметр; изменения синхронизируются с таблицей. Статус поля показан текстом: системные поля защищены, собственные можно изменять. Дополнительным полям автоматических сигналов задавайте значения по умолчанию.", "Parameters describe the action; returns collect subscriber responses. Expand a field name to set its type, nullability, limits, default and description. The type controls available settings. JSON opens the same field and stays synchronized with the table. Field status is read-only: system fields are protected, custom fields can be edited. Give extra fields defaults for automatically emitted signals."),
    section("subscribers", "Подключить реакцию", "Connect a reaction", "Добавьте подписку: выберите объект-подписчик и прикреплённый к нему макрос. Нажмите «Проверить и сохранить». Неподходящий макрос не подключается; окно показывает причину и образец для исправления. Подписку можно отключить, изменить или удалить.", "Add a subscription: choose a subscriber object and one of its attached macros. Select Validate and save. An incompatible macro is rejected; the window shows the reason and a suggested correction. Subscriptions can be disabled, edited or removed."),
    section("validation", "Проверить разрешение перед действием", "Check permission before an action", "У запуска группы, перехода состояния и подтверждённой покупки есть проверка перед исполнением. Если хотя бы один подписчик запрещает действие, оно не выполняется; мастер видит причину и имя подписчика. Проверяйте эти реакции перед игрой.", "Group starts, state transitions and confirmed purchases have a check before execution. If any subscriber denies the action, it does not run; the GM sees the reason and subscriber name. Test these reactions before play.")
  ]),
  page("macros", "Подключить готовый макрос", "Attach a prepared macro", [
    section("prepare", "Назначить макрос объекту", "Assign a macro to an object", "Создайте или исправьте макрос в штатном окне Foundry. Прикрепите его к объекту через «Автоматизацию» или вкладку «Макросы». Объект сможет выбрать этот макрос в своём скрипте и подписках. В списке видно, где он используется.", "Create or edit a macro in Foundry's native window. Attach it to an object through Automation or Macros. The object can then select it in its scripts and subscriptions. The list shows where it is used."),
    section("review", "Проверить перед игрой", "Check before play", "Для подписки нажмите проверку соответствия выбранному сигналу. При ошибке откройте макрос кнопкой редактирования и исправьте его по показанной подсказке. Используйте только проверенные вами макросы. Аварийная остановка не отменяет уже совершённых изменений стороннего макроса.", "For a subscription, validate the macro against the chosen signal. If validation fails, open its editor and correct it using the displayed guidance. Use macros you have checked. Emergency stop cannot undo changes already made by an external macro.")
  ]),
  page("npc", "Оживить объекты сцены", "Bring scene objects to life", [section("behavior", "Подготовить поведение", "Prepare behavior", 'В Конструкторе кликните объект и выберите «Поведение». Задайте скрипт перехода и рутину для нужных состояний, затем добавьте доступные магазины и диалоги. Подробнее: <a data-help-page="scripts">скрипты</a> и <a data-help-page="objects">объекты</a>.', 'In Constructor, click an object and select Behavior. Prepare transition and routine scripts for its states, then attach shops and dialogues. See <a data-help-page="scripts">scripts</a> and <a data-help-page="objects">objects</a>.')]),
  page("director", "Вести сцену", "Run the scene", [
    section("start", "Запустить подготовку", "Start preparation", "Кнопка «Старт» в категории Ширмы заново запускает все группы из выбранных состояний. Для ещё не запущенной группы выбирается её состояние входа. Отдельную группу можно запустить в Режиссёре. Открытие карты и переподключение не запускают подготовку.", "Start in the Master screen category restarts all groups from their selected states. An unstarted group uses its entry state. Individual groups can be started in Director. Opening a map or reconnecting does not start preparation."),
    section("change", "Выбрать состояния групп", "Choose group states", "«Сменить состояние» показывает все группы и их текущий выбор. Выберите состояния и нажмите «Сохранить»: изменятся только затронутые группы. Работавшие группы продолжат работу; остановленные и не запущенные останутся такими. «Отмена» не меняет ничего.", "Change state lists all groups and current selections. Choose states and Save: only changed groups are updated. Running groups continue; stopped and unstarted groups keep their status. Cancel changes nothing."),
    section("manual", "Вмешаться в происходящее", "Intervene during play", "Перемещайте объекты и меняйте доступные состояния вручную. Отключение автоматизации объекта сохраняется до вашего прямого включения. При новом явном входе скрипты состояния выполняются заново; переподключение не повторяет уже выполненные действия.", "Move objects and choose states manually. Disabling an object's automation persists until you enable it explicitly. A new explicit state entry runs its state scripts again; reconnecting does not repeat completed actions.")
  ]),
  page("stop", "Остановить автоматизацию", "Stop automation", [section("halt", "Вернуть ручное управление", "Return to manual control", "Нажмите «Стоп», чтобы остановить все группы, или остановите одну группу в Режиссёре. Выполненные действия и запасы магазинов сохраняются. Для продолжения явно выберите состояние и запустите нужную группу. Диалоги можно просматривать, зачитывать и показывать игрокам вручную даже после остановки.", "Press Stop to halt all groups, or stop one group in Director. Completed actions and shop stock remain. To resume, explicitly choose a state and start the desired group. Dialogues can still be previewed, read aloud or shown manually to players while automation is stopped.")]),
  page("trade", "Провести обмен", "Trade items", [section("exchange", "Подготовить и подтвердить сделку", "Prepare and confirm a trade", "Выберите своего персонажа или поставьте таргет на него, подойдите к объекту и выберите «Торг» с нужным магазином. Перенесите товары и предметы персонажа в две стороны предложения. До подтверждения инвентарь не меняется. Один магазин обслуживает одну пару игрок–персонаж. Если требуется мастер, отправьте сделку ему; мастер подключается через «Магазины». Денежный блок появится только при поддержке системы.", "Select or target your character, approach an object and choose Trade with the desired shop. Add shop goods and character items to the two offer areas. Inventory changes only on confirmation. One shop serves one player–character pair at a time. If GM approval is required, submit the trade; the GM joins through Shops. Currency controls appear only with system support.")]),
  page("dialogues", "Поговорить с объектом", "Talk to an object", [
    section("play", "Начать или продолжить разговор", "Start or resume a conversation", "Подойдите своим персонажем к объекту и выберите нужный диалог. Можно выбрать персонажа таргетом и кликнуть объект; сохраняется и взаимодействие при перемещении к нему. Ответ открывает следующую страницу или завершает разговор. «Уйти» доступно всегда. Пока окно открыто, рутина объекта приостановлена.", "Approach an object with your character and choose a dialogue. You can target your character and click the object; approaching through movement also remains available. Replies continue or end the conversation. Leave is always available. The object's routine pauses while the interaction window is open."),
    section("interrupt", "Вернуться после прерывания", "Return after an interruption", "Если реакция на ответ прервала диалог, при следующем обращении появится «Продолжить диалог». Разговор продолжится с сохранённого места, если условия доступа всё ещё соблюдены. Прерывание имеет приоритет над командой успешного завершения и не считается закрытием диалога.", "If a response handler interrupts the dialogue, the next interaction offers Resume dialogue. It continues at the saved position if access conditions still pass. Interruption takes priority over successful completion and is not treated as dialogue closure."),
    section("manual", "Показать страницу вручную", "Show a page manually", "В Режиссёре откройте каталог диалогов, выберите страницу и покажите её игрокам либо зачитайте самостоятельно. Ручной показ доступен после остановки и не запускает автоматические реакции.", "In Director, open the dialogue catalog, choose a page and show it to players or read it aloud. Manual presentation remains available after stopping and does not trigger automation.")
  ]),
  page("conditions", "Ограничить взаимодействия", "Limit interactions", [section("access", "Допустить нужных персонажей", "Admit the intended characters", "Настройте активность, состояния, дальность и теги у привязки инструмента к объекту. Пустой разрешающий список допускает всех; любой запрещающий тег исключает персонажа. Лимит общий для привязки, по умолчанию один запуск. Продолжение той же сессии не расходует его повторно. Сброс при явном входе настраивается отдельно; мастер может сбросить счётчик вручную.", "Set activity, states, range and tags on the object's tool assignment. An empty allow list accepts all; any denied tag excludes the character. The assignment has a shared limit, one activation by default. Resuming the same session does not consume it again. Reset on explicit entry is optional; the GM may reset the counter manually.")]),
  page("workspace", "Подготовить рабочие окна", "Prepare workspace windows", [section("windows", "Показать нужные документы", "Show useful documents", "В «Иное» подготовьте наборы окон для мастера и игроков: документы, положение и размеры. При явном входе в состояние они открываются по плану; затем их можно переместить вручную. Игроку нужны права на документ. Общие темы и поведение окон меняются в Generics.", "Under Other, prepare GM and player windows with documents, positions and sizes. They open as planned on explicit state entry and may then be moved manually. Players need document permissions. Shared themes and window behavior are configured in Generics.")]),
  page("actor", "Проверить вид игрока", "Check the player's view", [section("view", "Выбрать персонажа", "Choose a character", "Откройте «Актёр» и выберите персонажа игрока. Проверьте видимость НИП и доступные действия. Это вспомогательный вид: освещение, тайлы и исследованный туман могут отличаться от клиента игрока. Финальную проверку проводите от лица игрока.", "Open Actor and select a player character. Check visible NPCs and available interactions. This is a simplified view: lighting, tiles and explored fog may differ from the player's client. Perform the final check from a player account.")]),
  page("transfer", "Перенести подготовку", "Transfer preparation", [section("export", "Сохранить JSON", "Save JSON", "Экспорт всей сцены в «Иное» сохраняет группы, объекты, инструменты, сигналы и связанные документы. Отдельную группу, состояние, магазин или диалог экспортируйте в его параметрах. Импорт сцены создаёт отдельные документы и не запускает автоматизацию. Нужна та же игровая система. Медиафайлы перенесите отдельно; после импорта проверьте права, пути и макросы.", "Whole-scene export under Other includes groups, objects, tools, signals and linked documents. Export individual groups, states, shops or dialogues from their parameters. Scene import creates separate documents without starting automation and requires the same game system. Transfer media files separately; check permissions, paths and macros after importing.")]),

  {
    "id": "author",
    "ru": "Автор",
    "en": "Author",
    "sections": [
      {
        "id": "contact",
        "ru": "dmicher abathur kubrow",
        "en": "dmicher abathur kubrow",
        "bodyRu": "Сообщить о проблеме или предложить улучшение можно на <a href=\"https://github.com/dkubrow-dev/dmicher-master-screen/issues\" target=\"_blank\" rel=\"noopener noreferrer\">странице Ширмы</a>. Опишите действие и результат, укажите версию Foundry.",
        "bodyEn": "Use the <a href=\"https://github.com/dkubrow-dev/dmicher-master-screen/issues\" target=\"_blank\" rel=\"noopener noreferrer\">Master screen issue tracker</a> to report a problem or suggest an improvement. Include the action, its result and your Foundry version."
      }
    ]
  },
  {
    "id": "thanks",
    "ru": "Благодарности",
    "en": "Thanks",
    "sections": [
      {
        "id": "community",
        "ru": "Участникам игр и проверки",
        "en": "Players and testers",
        "bodyRu": "Спасибо мастерам и игрокам, которые проверяют Ширму в своих играх и делятся конкретными примерами. Такие наблюдения помогают уменьшать рутину за столом.",
        "bodyEn": "Thank you to GMs and players who test Master screen in their games and share concrete examples. Your observations help reduce script work at the table."
      }
    ]
  },
  {
    "id": "modules",
    "ru": "Модули dmicher",
    "en": "dmicher modules",
    "sections": [
      {
        "id": "screen",
        "ru": "🎬 Master screen — Ширма мастера",
        "en": "🎬 Master screen",
        "bodyRu": "Готовьте состояния и реакции объектов, затем ведите сцену и вмешивайтесь в её события. Ширма берёт на себя подготовленную рутину, сохраняя решения за мастером.",
        "bodyEn": "Prepare states and object reactions, then run the scene and intervene in its events. Master screen handles the prepared script while decisions remain with the GM."
      },
      {
        "id": "spotlight",
        "ru": "dmicher 🎥 Spotlight Tools — внимание участников",
        "en": "dmicher 🎥 Spotlight Tools — participant attention",
        "bodyRu": "Следите за заявками, распределением внимания и временем ожидания. Опросы готовности и таймеры помогают организовать игру и перерывы.",
        "bodyEn": "Track requests, attention and waiting time. Readiness polls and timers help organize play and breaks."
      },
      {
        "id": "generics",
        "ru": "dmicher 🧰 Generics — общие инструменты",
        "en": "dmicher 🧰 Generics — shared tools",
        "bodyRu": "Выберите единую тему и удобное поведение окон dmicher в настройках Generics. Там же включается приветствие со списком активных модулей, справкой и настройками. Общий Информатор отправляет приветствие и сообщения подключённых модулей.",
        "bodyEn": "Choose a shared theme and window behavior in Generics settings. Enable the welcome with active modules, help and settings links there too. The shared Informer sends the welcome and messages from connected modules."
      },
      {
        "id": "premium",
        "ru": "Premium — дополнительные возможности",
        "en": "Premium — additional features",
        "bodyRu": "Если нужны дополнительные возможности, введите лицензию в настройках Premium и проверьте список доступных модулей. Например, доступ к Generics позволяет импортировать собственные стили. Основная работа Ширмы и Spotlight не требует Premium; сохранённые дополнительные настройки остаются после окончания доступа.",
        "bodyEn": "If you need additional features, enter your license in Premium settings and check the available modules. For example, Generics access enables custom style import. Core Master screen and Spotlight features do not require Premium; saved extra settings remain when access expires."
      },
      {
        "id": "licences",
        "ru": "Сервер лицензий",
        "en": "License server",
        "bodyRu": "Проверяет лицензию и предоставляет сведения о доступе и выпусках. Он работает вне игрового мира; устанавливать его как модуль Foundry не нужно.",
        "bodyEn": "Verifies licenses and supplies access and release information. It operates outside your game world; you do not install it as a Foundry module."
      }
    ]
  }

];

export const SCREEN_HELP_SETTINGS = [
  ...OBJECT_HELP_SETTINGS,

  {
    "id": "settings-group",
    "ru": "Группа и оформление строк",
    "en": "Groups and row appearance",
    "fields": [
      [
        "[data-ide-parameters] [name=\"groupName\"]",
        "name",
        "Название группы",
        "Group name",
        "Уникальное в сцене название независимой группы состояний. Переименование не запускает группу.",
        "A scene-wide unique name for an independent group of states. Renaming does not start the group."
      ],
      [
        "groupSymbol",
        "symbol",
        "Символ группы",
        "Group symbol",
        "Один видимый символ, в том числе составной эмоджи. Он обозначает группу в заголовке Ширмы и на кнопке сцены; цвет значка определяется текущим состоянием.",
        "One visible symbol, including a compound emoji. It identifies the group in Master screen and on the scene button; its color follows the current state."
      ],
      [
        "[data-ide-parameters] [name=\"description\"]",
        "description",
        "Описание",
        "Description",
        "Поясните назначение выбранной группы или состояния. Описание сохраняется вместе с объектом и переносится при экспорте JSON.",
        "Explain the selected group or state's purpose. Descriptions are saved with the object and included in JSON exports."
      ],
      [
        "[data-ide-parameters] [name=\"background\"]",
        "background",
        "Цвет фона",
        "Background color",
        "Фон выбранной группы или состояния в списках и Режиссёре. Введите #RRGGBB или выберите цвет в палитре.",
        "The selected group or state's background in lists and Director. Enter #RRGGBB or choose a color from the palette."
      ],
      [
        "[data-ide-parameters] [name=\"textColor\"]",
        "text",
        "Цвет текста",
        "Text color",
        "Цвет названия группы или состояния. Подберите заметное сочетание с фоном; поле и палитра показывают один цвет.",
        "The group or state name color. Choose a readable contrast with its background; the field and palette show the same color."
      ]
    ]
  },
  {
    "id": "settings-state",
    "ru": "Настройки состояния",
    "en": "State settings",
    "fields": [
      [
        "name",
        "name",
        "Название",
        "Name",
        "Уникальное внутри группы имя состояния в дереве сцены и Режиссёре.",
        "The state's name in the Scene tree and Director, unique within its group."
      ],
      [
        "newStateEvent",
        "event",
        "Событие перехода",
        "Transition event",
        "Добавьте событие, которое автоматически переводит группу в выбранный состояние. Одно событие не может вести в два состояния одной группы. Ручной выбор мастера не ограничивается.",
        "Add an event that automatically moves the group to this state. One event cannot target two states in the same group. Manual GM selection is unrestricted."
      ],
      [
        "stop",
        "stop",
        "Остановка автоматизации",
        "Stop automation",
        "Состояние оставляет игру под ручным управлением без реплик, движения и входных действий. Состояние мира сохраняется.",
        "This state leaves play under manual control without speech, movement or entry actions. The world's state is preserved."
      ],
      [
        "pause",
        "pause",
        "Поставить Foundry на паузу",
        "Pause Foundry",
        "Ставит игру на паузу при входе; следующая смена состояния сама паузу не снимает.",
        "Pauses play on entry; another state does not automatically unpause it."
      ],
      [
        "sound",
        "sound",
        "Звук при входе",
        "Entry sound",
        "Путь к звуковому файлу, проигрываемому один раз при входе. Пустое поле — без звука.",
        "Audio file to play once on entry. Leave empty for no sound."
      ]
    ]
  },
  {
    "id": "settings-shop",
    "ru": "Настройки магазина",
    "en": "Shop settings",
    "fields": [
      [
        "shopEnabled",
        "enabled",
        "Предложить игроку обмен предметами",
        "Offer item trading to players",
        "Показывает магазин при взаимодействии с НИП в этом состоянии.",
        "Makes the shop available when interacting with this NPC in the state."
      ],
      [
        "shopRange",
        "range",
        "Дальность взаимодействия, единицы сцены",
        "Interaction range, scene units",
        "Персонаж должен находиться не дальше этого расстояния от НИП.",
        "The character must be within this distance of the NPC."
      ],
      [
        "shopApproval",
        "approval",
        "Обмен требует подтверждения мастера",
        "Trade requires GM approval",
        "Включено: игрок отправляет подготовленную сделку мастеру. Выключено: подтверждает самостоятельно.",
        "On: the player submits the prepared trade to the GM. Off: the player confirms it independently."
      ],
      [
        "shopDisplay",
        "display",
        "Вид ассортимента",
        "Catalog display",
        "Список группирует товары по типу; плитки показывают миниатюры.",
        "List groups items by type; tiles display thumbnails."
      ],
      [
        "[name^=\"stock-\"]",
        "stock",
        "Запас",
        "Stock",
        "Количество доступных целых предметов данного образца. Это не число единиц внутри системного предмета; потраченный запас не восстанавливается сменой состояния.",
        "Number of complete items available from this entry. This is not the quantity inside a system item; changing states does not restore spent stock."
      ]
    ]
  },
  {
    "id": "settings-conditions",
    "ru": "Условия запуска",
    "en": "Condition conditions",
    "fields": [
      [
        "[data-conditions-fields] [name$=\"-enabled\"]",
        "enabled",
        "Разрешать запуск",
        "Allow activation",
        "Разрешает проверять допуск к действию. Ручное отключение в Режиссёре действует до вашего включения.",
        "Enables the condition's condition checks. A manual disable in Director persists until you enable it."
      ],
      [
        "[data-conditions-fields] [name$=\"-group\"]",
        "group",
        "Группа",
        "Group",
        "Ограничивает запуск отмеченными группами. Пустой выбор не вводит ограничения.",
        "Restricts activation to selected groups. An empty selection adds no restriction."
      ],
      [
        "[data-conditions-fields] [name$=\"-state\"]",
        "states",
        "Состояния",
        "States",
        "Ограничивает запуск отмеченными состояниями. Пустой выбор не вводит ограничения; само взаимодействие остаётся в своём состоянии.",
        "Restricts activation to selected states. An empty selection adds no restriction; the interaction still belongs to its own state."
      ],
      [
        "[data-conditions-fields] [name$=\"-allow\"]",
        "allow",
        "Разрешающие теги, через запятую",
        "Allowed tags, comma-separated",
        "Достаточно любого совпадения с тегами действующего персонажа. Пусто — без ограничения.",
        "Any match with the acting character's tags is sufficient. Empty means unrestricted."
      ],
      [
        "[data-conditions-fields] [name$=\"-deny\"]",
        "deny",
        "Запрещающие теги, через запятую",
        "Denied tags, comma-separated",
        "Любое совпадение исключает персонажа даже при наличии разрешающего тега.",
        "Any match excludes the character, even if an allowed tag also matches."
      ],
      [
        "[data-conditions-fields] [name$=\"-repeat\"]",
        "repeat",
        "Повторение",
        "Repetition",
        "«Ограниченное число запусков» использует лимит; «Каждый раз» снимает предел.",
        "Limited activations uses the limit; Every time removes the cap."
      ],
      [
        "[data-conditions-fields] [name$=\"-limit\"]",
        "limit",
        "Лимит запусков",
        "Activation limit",
        "Общее число успешных запусков этой привязки, по умолчанию один. Не является отдельным лимитом для каждого игрока.",
        "The condition's total successful activations, one by default. This is not a separate allowance per player."
      ],
      [
        "[data-conditions-fields] [name$=\"-reset\"]",
        "reset",
        "Сбрасывать счётчик при новом входе в состояние",
        "Reset the counter on state entry",
        "Включено: явный вход возвращает допуск. Выключено: сброс только вручную. Переподключение не сбрасывает счётчик.",
        "On: explicit entry restores the allowance. Off: reset manually. Reconnecting never resets the counter."
      ]
    ]
  },
  {
    "id": "settings-dialogue",
    "ru": "Настройки диалога",
    "en": "Dialogue settings",
    "fields": [
      [
        "dialogueName",
        "name",
        "Название",
        "Name",
        "Название диалога в списках мастера и взаимодействиях.",
        "The dialogue's name in GM lists and interactions."
      ],
      [
        "dialogueStart",
        "start",
        "Начальная страница",
        "Starting page",
        "С этой страницы начинается новый разговор.",
        "A new conversation starts at this page."
      ],
      [
        "nodeText",
        "text",
        "Реплика",
        "Line",
        "Текст НИП или описание предмета на текущей странице; вводите обычный текст.",
        "The NPC's line or object description on this page; enter plain text."
      ],
      [
        "nodeArt",
        "art",
        "Иллюстрация страницы",
        "Page illustration",
        "Путь к изображению; пустое поле использует изображение объекта.",
        "Image path; an empty field uses the object's image."
      ],
      [
        "responseLabel",
        "reply",
        "Текст ответа",
        "Reply text",
        "Название кнопки, которую выбирает игрок.",
        "The label of the reply button the player chooses."
      ],
      [
        "responseNext",
        "next",
        "Следующая страница",
        "Next page",
        "Открывает выбранную страницу или завершает диалог.",
        "Opens the selected page or ends the conversation."
      ]
    ]
  },
  {
    "id": "settings-actions",
    "ru": "Настройки взаимодействия",
    "en": "Interaction settings",
    "fields": [
      [
        "objectTags",
        "tags",
        "Теги объекта",
        "Object tags",
        "Введите теги через запятую и сохраните. Они описывают объект этой сцены; регистр не учитывается.",
        "Enter comma-separated tags and save. They describe this scene's object; matching is case-insensitive."
      ],
      [
        "actionName",
        "name",
        "Название действия",
        "Action name",
        "Название выбора, который увидит игрок при взаимодействии.",
        "The choice displayed to a player during interaction."
      ],
      [
        "actionEnabled",
        "enabled",
        "Доступно",
        "Available",
        "Показывает прямое действие в выбранном состоянии, если остальные условия соблюдены.",
        "Shows the direct action in the selected state when other conditions pass."
      ],
      [
        "actionTarget",
        "target",
        "Объект",
        "Object",
        "НИП или тайл, на котором доступно действие.",
        "The NPC or tile that offers the action."
      ],
      [
        "actionRange",
        "range",
        "Дальность, единицы сцены",
        "Range, scene units",
        "Персонаж должен подойти к объекту на эту дистанцию.",
        "The character must approach the object within this distance."
      ]
    ]
  },
  {
    "id": "settings-map",
    "ru": "Подкрепление и зоны",
    "en": "Reinforcements and zones",
    "fields": [
      [
        "spawnActor",
        "actor",
        "UUID персонажа",
        "Actor UUID",
        "Персонаж, из которого создаются токены подкрепления. Его можно перетащить из боковой панели.",
        "The Actor used for reinforcement tokens. Drag it from the sidebar to select it."
      ],
      [
        "spawnX",
        "spawn-x",
        "X, пикс.",
        "X, pixels",
        "Горизонтальная координата первого токена подкрепления; можно указать на карте.",
        "Horizontal coordinate of the first reinforcement token; select it on the map if preferred."
      ],
      [
        "spawnY",
        "spawn-y",
        "Y, пикс.",
        "Y, pixels",
        "Вертикальная координата первого токена подкрепления.",
        "Vertical coordinate of the first reinforcement token."
      ],
      [
        "spawnCount",
        "count",
        "Количество",
        "Count",
        "Сколько токенов появится при входе, от 1 до 50. Новый вход может добавить подкрепление снова.",
        "Number of tokens spawned on entry, from 1 to 50. Another entry may add reinforcements again."
      ],
      [
        "spawnSpacing",
        "spacing",
        "Шаг, пикс.",
        "Spacing, pixels",
        "Шаг размещения токенов подкрепления от выбранной точки.",
        "Spacing between reinforcement tokens from the selected position."
      ],
      [
        "zoneLabel",
        "label",
        "Название зоны",
        "Zone name",
        "Понятное мастеру название зоны в списке.",
        "A recognizable name for zone and condition lists."
      ],
      [
        "zoneX",
        "zone-x",
        "X, пикс.",
        "X, pixels",
        "Левый край прямоугольной зоны на карте.",
        "The rectangular zone's left edge on the map."
      ],
      [
        "zoneY",
        "zone-y",
        "Y, пикс.",
        "Y, pixels",
        "Верхний край прямоугольной зоны на карте.",
        "The rectangular zone's top edge on the map."
      ],
      [
        "zoneWidth",
        "width",
        "Ширина",
        "Width",
        "Ширина зоны в пикселях карты.",
        "Zone width in map pixels."
      ],
      [
        "zoneHeight",
        "height",
        "Высота",
        "Height",
        "Высота зоны в пикселях карты.",
        "Zone height in map pixels."
      ]
    ]
  },
  {
    "id": "settings-windows",
    "ru": "План рабочих окон",
    "en": "Workspace window plan",
    "fields": [
      [
        "windowUuid",
        "document",
        "UUID документа",
        "Document UUID",
        "Документ для показа при входе в состояние. Проще перетащить лист в блок окон; игроку нужны права на документ.",
        "Document to show on entry. Drag a sheet into the window group for convenience; players need permission to view it."
      ],
      [
        "windowX",
        "x",
        "X",
        "X",
        "Положение окна слева в пикселях экрана.",
        "The window's left position in screen pixels."
      ],
      [
        "windowY",
        "y",
        "Y",
        "Y",
        "Положение окна сверху в пикселях экрана.",
        "The window's top position in screen pixels."
      ],
      [
        "windowWidth",
        "width",
        "Ширина",
        "Width",
        "Подготовленная ширина окна в пикселях, от 100.",
        "Prepared window width in pixels, at least 100."
      ],
      [
        "windowHeight",
        "height",
        "Высота",
        "Height",
        "Подготовленная высота окна в пикселях, от 100.",
        "Prepared window height in pixels, at least 100."
      ]
    ]
  }
,
  { id: "settings-signals", ru: "Сигналы и подписки", en: "Signals and subscriptions", fields: [
    ["signal-name", "name", "Название", "Name", "Уникальное имя сигнала у выбранного эмитента. Пользовательские имена допускают Unicode.", "A unique signal name for this emitter. Custom names accept Unicode."],
    ["signal-description", "description", "Описание", "Description", "Напомните, когда возникает сигнал и для чего его использовать.", "Record when the signal occurs and how to use it."],
    ["field-name", "field", "Имя поля", "Field name", "Уникальное имя параметра или возврата; после сохранения подписанные макросы должны соответствовать ему.", "A unique parameter or return name; subscribed macros must match it."],
    ["field-type", "type", "Тип", "Type", "Текст, целое, дробное число или логическое значение. Значение другого типа отклоняется.", "Text, integer, number or boolean. Values of another type are rejected."],
    ["field-nullable", "nullable", "Может быть null", "May be null", "Разрешает явное отсутствие значения. Это не снимает требование описать поле возврата.", "Allows an explicitly absent value. The return field must still be declared."],
    ["field-default-mode", "default-mode", "Значение по умолчанию", "Default value", "Выберите отсутствие значения, значение выбранного типа или null, если он разрешён. Значение подставляется, когда поле не передано.", "Choose no default, a value of the selected type, or null when allowed. The default is used when the field is omitted."],
    ["field-default-value", "default", "Значение", "Value", "Значение по умолчанию вводится согласно типу поля: текст, число или логическое значение.", "Enter the default using the field's type: text, a number, or a boolean."],
    ["field-minLength", "min-length", "Минимальная длина", "Minimum length", "Минимальное число символов текста; пусто — без нижней границы.", "Minimum text length; blank means no lower bound."],
    ["field-maxLength", "max-length", "Максимальная длина", "Maximum length", "Максимальное число символов текста; пусто — без верхней границы.", "Maximum text length; blank means no upper bound."],
    ["field-min", "minimum", "Минимум", "Minimum", "Наименьшее допустимое число, включительно.", "The smallest permitted number, inclusive."],
    ["field-max", "maximum", "Максимум", "Maximum", "Наибольшее допустимое число, включительно.", "The largest permitted number, inclusive."],
    ["field-decimals", "decimals", "Точность", "Decimals", "Максимальное число десятичных знаков дробного значения.", "Maximum decimal places for a numeric value."],
    ["field-description", "field-description", "Описание поля", "Field description", "Поясните смысл передаваемого значения и единицы измерения.", "Explain the value's meaning and units."],
    ["subscription-owner", "owner", "Подписчик", "Subscriber", "Объект, чей прикреплённый макрос обработает сигнал.", "The object whose attached macro handles the signal."],
    ["subscription-macro", "macro", "Макрос объекта", "Object macro", "Выберите прикреплённый макрос с подходящими параметрами и возвратами.", "Choose an attached macro with compatible inputs and returns."],
    ["subscription-signal", "signal", "Сигнал эмитента", "Emitter signal", "Сигнал своего или другого объекта, на который должна реагировать подписка.", "A signal from this or another object to react to."],
    ["subscription-enabled", "enabled", "Включена", "Enabled", "Выключение сохраняет подготовленную подписку, но прекращает её выполнение.", "Disabling preserves the subscription but prevents its execution."]
  ] }
];

export function getScreenHelpContent(language = globalThis.game?.i18n?.lang) {
  const ru = String(language ?? "en").toLowerCase().startsWith("ru"), title = value => value[ru ? "ru" : "en"];
  const pages = SCREEN_HELP_PAGES.map(value => ({ id: value.id, title: title(value), html: value.sections.map(s => `<section><h3 id="${s.id}">${title(s)}</h3><p>${s[ru ? "bodyRu" : "bodyEn"]}</p></section>`).join("") }));
  pages.push(...SCREEN_HELP_SETTINGS.map(value => ({ id: value.id, title: title(value), html: value.fields.map(f => `<section><h3 id="${f[1]}">${f[ru ? 2 : 3]}</h3><p>${f[ru ? 4 : 5]}</p></section>`).join("") })));
  const entry = id => ({ id, pageId: id, title: pages.find(p => p.id === id).title });
  return { pages, footer: ["author", "thanks", "modules"], labels: { contents: ru ? "Содержание" : "Contents", resizeNavigation: ru ? "Изменить ширину меню" : "Resize navigation" }, tree: [
    { id: "prepare", title: ru ? "Подготовка" : "Preparation", children: ["start", "constructor", "objects", "catalog-tools", "scripts", "signals", "macros", "npc", "dialogues", "conditions", "workspace", "transfer"].map(entry) },
    { id: "play", title: ru ? "Проведение игры" : "Running the game", children: ["director", "stop", "trade", "actor"].map(entry) },
    { id: "settings", title: ru ? "Настройки" : "Settings", children: SCREEN_HELP_SETTINGS.map(p => entry(p.id)) }
  ] };
}
export function getScreenSettingHelp(language = globalThis.game?.i18n?.lang) {
  const ru = String(language ?? "en").toLowerCase().startsWith("ru");
  return SCREEN_HELP_SETTINGS.flatMap(p => p.fields.map(f => ({ selector: f[0].startsWith("[") ? f[0] : `[name="${f[0]}"]`, pageId: p.id, anchor: f[1], hint: f[ru ? 4 : 5], label: ru ? `Справка: ${f[2]}` : `Help: ${f[3]}` })));
}
