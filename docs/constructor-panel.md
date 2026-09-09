# Рабочая ширма

В категории Ширмы выберите **Ширма (панель)** для работы рядом с картой или **Ширма (окно)** для другого монитора. Выбор категории только раскрывает подменю; справка открывается своей кнопкой.

Верхняя строка переключает **Конструктор / Режиссёр**, вызывает отдельное окно **Актёра**, переносит ширму между панелью и окном, меняет расположение **справа / снизу** и закрывает ширму. Конструктор и Режиссёр используют ту же рабочую область. Актёр оставляет её открытой. Закрытие инструментов не останавливает события: для этого есть кнопка **Остановить всё** в Режиссёре.

Перетащите выделенную внешнюю границу панели, чтобы отдать больше места карте или инструментам. Внутренняя граница делит ширму на основную и дополнительную зоны. При расположении справа основная зона сверху; при расположении снизу — слева. Обе границы доступны через Tab и стрелки. Браузер сохраняет сторону, отдельные размеры справа и снизу, пропорции двух зон и состав вкладок после закрытия и перезагрузки.

Меню основной зоны: **Сцена**, **Инструменты → Магазины / Диалоги**, **Автоматизация → События / Макросы / Источники**, **Иное**. В обеих зонах первый уровень всегда остаётся одной строкой; стрелки прокручивают не поместившиеся кнопки влево и вправо. Категория раскрывает меню поверх содержимого, без второй строки. Оно закрывается после выбора, ухода курсора из раскрытой области или Escape. Раскрытие не меняет выбранный инструмент и сохраняет ввод. С клавиатуры используйте стрелки между пунктами, вниз для открытия категории, Enter для выбора и Escape для возврата к её кнопке.

Шестерёнка каждой зоны открывает диалог с деревом вкладок и галочками. Галка категории меняет всех потомков; промежуточное состояние означает, что видна только часть. Категория исчезает, когда скрыты все её вкладки. В каждой зоне остаётся хотя бы одна вкладка, а шестерёнка всегда доступна. Выбор элемента дерева возвращает **Параметры**, если они скрыты.

Каждая основная вкладка сохраняет свой выбор и несохранённый ввод отдельно для сцены и режима. Новая вкладка показывает пустую форму до выбора элемента. Переключение вкладок и режимов, изменение размера и перенос в окно сохраняют черновики, включая незавершённый ввод. Смена элемента в той же вкладке требует решения об отмене ввода. Закрытие ширмы проверяет также черновики скрытых вкладок. Клик в любой части строки выбирает её; кнопки и поля строки выполняют собственные действия.

**Сцена** показывает схемы и вложенные эпизоды. Новая карта не содержит схем: **Создать схему** добавляет одну схему с одним эпизодом. Последний эпизод схемы удалить или переместить нельзя; всю остановленную схему, включая последнюю в сцене, удалить можно. Импорт и экспорт всей сцены доступны даже без схем.

Выберите строку для изменения названия, описания и цветов. Для схемы обязателен один символ Unicode, включая составной эмоджи. Значки схем рядом с названием сцены и над штатными кнопками сцен Foundry показывают цвета текущего запущенного эпизода. Подсказка на значке содержит схему и эпизод. Пунктирный значок означает, что схема ещё не запускалась; знак паузы — что она остановлена. Выбор эпизода для редактирования не меняет эти значки, а несохранённый ввод не мешает обновлению состояния.

Выберите для схемы **Входной эпизод**: он будет предложен при запуске. Если эпизод только один, он всегда входной. Открытие карты и выбор схемы ничего не исполняют — нажмите **Запустить** в Режиссёре. Таблица **Управляемые объекты** открывает информацию объекта и позволяет привязать объект со сцены или отвязать его. Один объект принадлежит одной схеме; переназначение требует подтверждения и остановки затронутых схем.

Красная рамка стола показывает, что включён Конструктор. В Режиссёре и после закрытия Ширмы её нет; при переносе Конструктора в отдельное окно рамка остаётся у карты. Вопросы возле полей открывают справку мышью, но не перехватывают последовательный переход Tab между полями.

Кнопки под деревом добавляют, редактируют и удаляют узлы. Перетаскивание меняет порядок; перенос эпизода на другую схему предлагает копирование или перемещение. Названия уникальны среди соседних узлов. Импорт JSON добавляет объект; существующий объект не заменяется. Если имя уже занято, сначала переименуйте источник или имеющийся узел.

В параметрах эпизода добавляйте события, которые автоматически переводят схему в него. Одно событие внутри одной схемы ведёт только в один эпизод. Мастер в Режиссёре может войти в любой эпизод независимо от этих условий. Выбрав схему, её можно отдельно остановить или возобновить с выбранного эпизода.

**События** перечисляет события сцены и их типы триггеров. У события настройте порядок подписантов кнопками вверх/вниз: встроенное действие, макрос или вызов другого триггера. У триггера задайте поля и ограничения текста, целых и дробных чисел, логических значений. Встроенные определения доступны для просмотра и вызова. JSON кнопки переносят выбранное пользовательское событие или триггер.

**Макросы** принимает перетаскивание из каталога Foundry. Новый макрос и кнопка **Править** используют штатный редактор. В дополнительной зоне отметьте принимаемые им типы триггеров. Макрос можно перетащить прямо на строку подписанта события.

**Магазины** содержит самостоятельные каталоги сцены. Создайте магазин, задайте название, изображение, отображение по категориям или плитками и подтверждение мастера. Перетаскивайте Item из каталога Foundry или листа персонажа; копия товара и остаток сохраняются в магазине, инвентарь источника не меняется. Состояния торговых сессий доступны отдельной кнопкой. Назначьте магазин нескольким объектам через **Поведение → Особенности**; их условия и эпизоды задаются на каждом объекте. Общий магазин имеет один общий остаток и обслуживает одного участника одновременно.

**Диалоги** содержит самостоятельные диалоги сцены с уникальными названиями. Создайте первый блок, текст, необязательный арт через штатный выбор файла и ответы. Ответ либо продолжает разговор с выбранного блока, либо завершает его и может вызвать событие. **Уйти** всегда завершает без события. Раздел переходов показывает простой граф связей блоков. Один диалог можно назначить нескольким объектам. Внизу параметров видны обратные связи: объекты, схемы, эпизоды, белые и чёрные теги, а также подходящие по тегам токены с персонажами. Дальность и текущее состояние проверяются отдельно при взаимодействии. Просмотр и ручной показ игрокам доступны даже после остановки автоматизации.

**Предпросмотр с условиями** открывает отдельную репетицию текущего черновика магазина или диалога. Выберите схему, эпизод, объект и персонажа; измените имитируемые теги, расстояние, видимость и счётчик. Панель объяснит допуск или отказ. Галка **Показать содержимое при отказе** позволяет проверить само содержимое ещё не привязанного инструмента. Пробный обмен меняет только копии в окне, ответ показывает предполагаемое событие: документы, остатки мира и автоматизация не затрагиваются. **Применить условия и начать заново** сбрасывает репетицию. JSON импорт/экспорт доступен для каждого магазина и диалога.

В **Поведении → Рутина** добавьте блок эпизода и шаги. Перетащите строку за значок возле номера или используйте Alt+↑/↓ на этом значке. Порядок строк служит для удобства редактирования: номера и переходы сохраняются, выполнение начинается с шага 1. Этот шаг нельзя удалить, пока в блоке есть другие шаги. Перетаскивание сохраняет введённый текст параметров, включая ещё не законченный JSON.

**Источники** перечисляет существующие входы в эпизод, зоны, рутины, диалоги и прямые действия с их событиями. Выбор строки показывает контекст и открывает соответствующую настройку. Просмотр списка ничего не запускает и не добавляет источники.

**Иное** временно собирает остальные инструменты. Основная зона содержит названия блоков; дополнительная показывает только выбранный блок. Здесь остаются теги, зоны, прямые действия, пауза, звук, подкрепление, рабочие столы и перенос всей сцены. Поведение объекта открывается через контекстное меню карты и использует переходы, привязки инструментов, распорядки и подписки на события. В Режиссёре доступны управление НИП, счётчики и журнал. Сохранение отдельного блока не удаляет настройки остальных блоков.

Отдельное окно использует ту же сессию мастера. Разрешите всплывающие окна для адреса Foundry, если браузер блокирует открытие. Кнопка переноса возвращает ширму к карте. Закрытие внешнего окна крестиком браузера возвращает ширму в панель и сохраняет ввод; внутренний крестик ширмы закрывает инструменты.

# Master screen workspace

Choose **Master screen (panel)** to work beside the map, or **Master screen (window)** for another monitor. Opening the category only expands its submenu; Help has its own button.

The top bar switches **Constructor / Director**, opens **Actor** separately, moves the workspace between a panel and a browser window, selects **right / bottom**, and closes the screen. Constructor and Director share the workspace. Actor keeps it visible. Closing tools does not stop automation: use **Stop all** in Director.

Drag the marked outside divider to resize the panel and tabletop. The inner divider separates the main list area from the details area: top/bottom when docked right, left/right when docked below. Both dividers support Tab and arrow keys. This browser remembers the side, separate panel sizes, inner proportions and visible tabs after closing or reloading.

The main menu contains **Scene**, **Tools → Shops / Dialogues**, **Automation → Events / Macros / Sources**, and **Other**. Both zones keep the first level in one permanent row; carousel arrows reveal buttons that do not fit. Categories open dropdowns over the content without adding a row or rebuilding drafts. A dropdown closes on selection, pointer leave or Escape. Use arrow keys between entries, Down to open a category, Enter to choose and Escape to return to its button. Each zone's gear opens a checkbox tree dialog. Category checkboxes toggle all descendants and display a partial state when needed; at least one leaf remains visible. Selecting a tree node restores **Parameters** if hidden.

Every main tab retains its own selection and draft for each scene and mode. A new tab shows an empty details area until selection. Switching tabs or modes preserves incomplete input. Changing the selected object asks before discarding; closing the screen checks hidden drafts too. Clicking anywhere in a row selects it, except its buttons and other controls.

**Scene** lists schemes and their episodes. A new scene contains none; **Create scheme** adds a scheme with one episode. The last episode cannot be deleted or moved away, but the last stopped scheme can be deleted. Full-scene import/export also works without schemes.

Select a row to edit its name, description and colours. Schemes require one Unicode symbol, including composed emoji. Badges beside the scene title and above Foundry's scene buttons use the running episode's colours; tooltips name the scheme and episode. Dashed badges mean not started, and a pause mark means stopped. Editing selection does not change them, and live badge updates preserve drafts. Buttons below the tree add, edit and delete nodes. Drag to reorder, or drag an episode to another scheme and choose copy or move. Sibling names must be unique. JSON import adds an object and does not replace an existing object; rename conflicting names before importing.

An episode's event list determines automated entry. Within a scheme, an event may target only one episode. Director allows the GM to enter any episode manually. Select a scheme to stop it independently or resume it from a chosen episode.

Choose a scheme's **Entry episode** as its proposed starting state. Opening a map never starts it; explicitly press **Start** in Director. **Controlled objects** links to each object's Information and allows attaching or detaching native scene objects. An object belongs to one scheme; reassigning requires stopping affected schemes and confirmation. The red tabletop outline appears only in Constructor, remains on the main map when using a popup, and disappears in Director or after closing. Help question buttons do not interrupt Tab navigation between fields.

**Events** lists scene events and their named trigger types. Order subscribers with up/down buttons: a built-in action, macro or another trigger. Configure trigger fields and limits for text, integers, decimals and booleans. Built-in definitions can be inspected and invoked. JSON controls transfer the selected custom event or trigger.

**Macros** accepts drops from the Foundry directory. Create and edit with Foundry's native editor; select accepted trigger types in the details area. A macro can also be dropped onto an event's subscriber row.

**Shops** contains independent scene catalogs. Set a name, image, category/tile layout and GM approval; drop Foundry Items into stock without changing the source inventory. Attach one shop to multiple objects in **Behavior → Features**, where each object controls episodes, tags and range. Stock and the exclusive trading session are shared across attachments.

**Dialogues** contains independent, uniquely named conversations. Add blocks, text, optional art with Foundry's file picker and responses. A response either continues to a block or ends the conversation, optionally emitting an event. **Leave** always ends without an event. The simple graph lists block connections. Reverse references show attached objects, schemes, episodes, allow/deny tags and matching Actor tokens; distance and live state are checked during interaction. Manual viewing and invitations remain available after automation stops.

**Preview with conditions** rehearses the current shop/dialogue draft in a separate window. Select a scheme, episode, target and Actor token; simulate tags, distance, visibility and usage count. The result explains admission or refusal. **Show content when blocked** also lets you inspect an unattached draft. Trades change only local copies; dialogue responses describe the event they would emit. World documents, stock and automation remain unchanged. Applying conditions resets the rehearsal. Each catalog item supports JSON import/export.

In **Behavior → Routine**, add an episode block and steps. Drag a row by its handle beside the number, or use Alt+Up/Down on that handle. Row order is for editing convenience: IDs and transitions remain unchanged, and execution starts at step 1. That step cannot be removed while other steps remain. Dragging preserves parameter text, including unfinished JSON.

**Sources** lists existing episode entries, zones, routines, dialogues and direct actions, their events and links to setup. Opening the list starts nothing.

**Other** temporarily groups the remaining tools. Select a block in the main zone to show only its settings in the details zone: NPC behavior, tags, zones, pause, sound, reinforcements, workspaces and full-scene transfer. Director provides NPC controls, counters and history. Saving a block preserves the other blocks.

The separate window uses the same GM session. Allow popups for the Foundry address if opening is blocked. Closing the browser popup returns the screen to the panel and keeps edits; the screen's own close button closes its tools.
