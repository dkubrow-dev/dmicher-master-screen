# Рабочая ширма

В категории Ширмы выберите **Ширма (панель)** для работы рядом с картой или **Ширма (окно)** для другого монитора. Выбор категории только раскрывает подменю; справка открывается своей кнопкой.

Верхняя строка переключает **Конструктор / Режиссёр**, вызывает отдельное окно **Актёра**, переносит ширму между панелью и окном, меняет расположение **справа / снизу** и закрывает ширму. Конструктор и Режиссёр используют ту же рабочую область. Актёр оставляет её открытой. Закрытие инструментов не останавливает события: для этого есть кнопка **Остановить всё** в Режиссёре.

Перетащите выделенную внешнюю границу панели, чтобы отдать больше места карте или инструментам. Внутренняя граница делит ширму на основную и дополнительную зоны. При расположении справа основная зона сверху; при расположении снизу — слева. Обе границы доступны через Tab и стрелки. Браузер сохраняет сторону, отдельные размеры справа и снизу, пропорции двух зон и состав вкладок после закрытия и перезагрузки.

Меню основной зоны: **Сцена**, **Инструменты → Магазины / Диалоги**, **Автоматизация → События / Макросы / Источники**, **Иное**. Категория только раскрывает следующий уровень; её нажатие не меняет выбранный инструмент. Когда строка не помещается, стрелки прокручивают её влево и вправо.

Шестерёнка каждой зоны открывает диалог с деревом вкладок и галочками. Галка категории меняет всех потомков; промежуточное состояние означает, что видна только часть. Категория исчезает, когда скрыты все её вкладки. В каждой зоне остаётся хотя бы одна вкладка, а шестерёнка всегда доступна. Выбор элемента дерева возвращает **Параметры**, если они скрыты.

Каждая основная вкладка сохраняет свой выбор и несохранённый ввод отдельно для сцены и режима. Новая вкладка показывает пустую форму до выбора элемента. Переключение вкладок и режимов, изменение размера и перенос в окно сохраняют черновики, включая незавершённый ввод. Смена элемента в той же вкладке требует решения об отмене ввода. Закрытие ширмы проверяет также черновики скрытых вкладок. Клик в любой части строки выбирает её; кнопки и поля строки выполняют собственные действия.

**Сцена** показывает схемы и вложенные эпизоды. Новая карта не содержит схем: **Создать схему** добавляет одну схему с одним эпизодом. Последний эпизод схемы удалить или переместить нельзя; всю остановленную схему, включая последнюю в сцене, удалить можно. Импорт и экспорт всей сцены доступны даже без схем.

Выберите строку для изменения названия, описания и цветов. Для схемы обязателен один символ Unicode, включая составной эмоджи. Значки схем рядом с названием сцены и над штатными кнопками сцен Foundry показывают цвета текущего запущенного эпизода. Подсказка на значке содержит схему и эпизод. Пунктирный значок означает, что схема ещё не запускалась; знак паузы — что она остановлена. Выбор эпизода для редактирования не меняет эти значки, а несохранённый ввод не мешает обновлению состояния.

Кнопки под деревом добавляют, редактируют и удаляют узлы. Перетаскивание меняет порядок; перенос эпизода на другую схему предлагает копирование или перемещение. Названия уникальны среди соседних узлов. Импорт JSON добавляет объект; существующий объект не заменяется. Если имя уже занято, сначала переименуйте источник или имеющийся узел.

В параметрах эпизода добавляйте события, которые автоматически переводят схему в него. Одно событие внутри одной схемы ведёт только в один эпизод. Мастер в Режиссёре может войти в любой эпизод независимо от этих условий. Выбрав схему, её можно отдельно остановить или возобновить с выбранного эпизода.

**События** перечисляет события сцены и их типы триггеров. У события настройте порядок подписантов кнопками вверх/вниз: встроенное действие, макрос или вызов другого триггера. У триггера задайте поля и ограничения текста, целых и дробных чисел, логических значений. Встроенные определения доступны для просмотра и вызова. JSON кнопки переносят выбранное пользовательское событие или триггер.

**Макросы** принимает перетаскивание из каталога Foundry. Новый макрос и кнопка **Править** используют штатный редактор. В дополнительной зоне отметьте принимаемые им типы триггеров. Макрос можно перетащить прямо на строку подписанта события.

**Магазины** показывает НИП по схемам и эпизодам, открывает настройку каталога и предоставляет доступ к состояниям торговых сессий. **Диалоги** показывает эпизоды с их диалогами и прямыми взаимодействиями: выберите эпизод, затем настройте его содержимое в дополнительной зоне. Просмотр и ручной показ доступны отдельной кнопкой, в том числе после остановки автоматизации.

**Источники** перечисляет существующие входы в эпизод, зоны, взаимодействия НИП, патрули, диалоги и прямые действия с их событиями. Выбор строки показывает контекст и открывает соответствующую настройку. Просмотр списка ничего не запускает и не добавляет источники.

**Иное** временно собирает остальные инструменты. Основная зона содержит названия блоков; дополнительная показывает только выбранный блок. Здесь остаются поведение НИП, теги, зоны, пауза, звук, подкрепление, рабочие столы и перенос всей сцены. В Режиссёре доступны управление НИП, счётчики и журнал. Сохранение отдельного блока не удаляет настройки остальных блоков.

Отдельное окно использует ту же сессию мастера. Разрешите всплывающие окна для адреса Foundry, если браузер блокирует открытие. Кнопка переноса возвращает ширму к карте. Закрытие внешнего окна крестиком браузера возвращает ширму в панель и сохраняет ввод; внутренний крестик ширмы закрывает инструменты.

# Master screen workspace

Choose **Master screen (panel)** to work beside the map, or **Master screen (window)** for another monitor. Opening the category only expands its submenu; Help has its own button.

The top bar switches **Constructor / Director**, opens **Actor** separately, moves the workspace between a panel and a browser window, selects **right / bottom**, and closes the screen. Constructor and Director share the workspace. Actor keeps it visible. Closing tools does not stop automation: use **Stop all** in Director.

Drag the marked outside divider to resize the panel and tabletop. The inner divider separates the main list area from the details area: top/bottom when docked right, left/right when docked below. Both dividers support Tab and arrow keys. This browser remembers the side, separate panel sizes, inner proportions and visible tabs after closing or reloading.

The main menu contains **Scene**, **Tools → Shops / Dialogues**, **Automation → Events / Macros / Sources**, and **Other**. Categories only reveal navigation; arrows scroll overflowing menu rows. Each zone's gear opens a checkbox tree dialog. Category checkboxes toggle all descendants and display a partial state when needed; at least one leaf remains visible. Selecting a tree node restores **Parameters** if hidden.

Every main tab retains its own selection and draft for each scene and mode. A new tab shows an empty details area until selection. Switching tabs or modes preserves incomplete input. Changing the selected object asks before discarding; closing the screen checks hidden drafts too. Clicking anywhere in a row selects it, except its buttons and other controls.

**Scene** lists schemes and their episodes. A new scene contains none; **Create scheme** adds a scheme with one episode. The last episode cannot be deleted or moved away, but the last stopped scheme can be deleted. Full-scene import/export also works without schemes.

Select a row to edit its name, description and colours. Schemes require one Unicode symbol, including composed emoji. Badges beside the scene title and above Foundry's scene buttons use the running episode's colours; tooltips name the scheme and episode. Dashed badges mean not started, and a pause mark means stopped. Editing selection does not change them, and live badge updates preserve drafts. Buttons below the tree add, edit and delete nodes. Drag to reorder, or drag an episode to another scheme and choose copy or move. Sibling names must be unique. JSON import adds an object and does not replace an existing object; rename conflicting names before importing.

An episode's event list determines automated entry. Within a scheme, an event may target only one episode. Director allows the GM to enter any episode manually. Select a scheme to stop it independently or resume it from a chosen episode.

**Events** lists scene events and their named trigger types. Order subscribers with up/down buttons: a built-in action, macro or another trigger. Configure trigger fields and limits for text, integers, decimals and booleans. Built-in definitions can be inspected and invoked. JSON controls transfer the selected custom event or trigger.

**Macros** accepts drops from the Foundry directory. Create and edit with Foundry's native editor; select accepted trigger types in the details area. A macro can also be dropped onto an event's subscriber row.

**Shops** lists NPCs by scheme and episode, opens their shop setup and gives access to trading sessions. **Dialogues** lists episode scopes; select one to edit its dialogues and direct interactions. The manual catalog remains available after automation stops. **Sources** lists existing episode entries, zones, NPC interactions, patrols, dialogues and direct actions, their events and links to setup. Opening the list starts nothing.

**Other** temporarily groups the remaining tools. Select a block in the main zone to show only its settings in the details zone: NPC behavior, tags, zones, pause, sound, reinforcements, workspaces and full-scene transfer. Director provides NPC controls, counters and history. Saving a block preserves the other blocks.

The separate window uses the same GM session. Allow popups for the Foundry address if opening is blocked. Closing the browser popup returns the screen to the panel and keeps edits; the screen's own close button closes its tools.
