# Рабочая ширма

В категории Ширмы выберите **Ширма (панель)** для работы рядом с картой или **Ширма (окно)** для другого монитора. Выбор категории только раскрывает подменю; справка открывается своей кнопкой.

Верхняя строка переключает **Конструктор / Режиссёр**, вызывает отдельное окно **Актёра**, переносит ширму между панелью и окном, меняет расположение **справа / снизу** и закрывает ширму. Конструктор и Режиссёр используют ту же рабочую область. Актёр оставляет её открытой. Закрытие инструментов не останавливает события: для этого есть кнопка **Остановить всё** в Режиссёре.

Перетащите выделенную внешнюю границу панели, чтобы отдать больше места карте или инструментам. Внутренняя граница делит ширму на основную и дополнительную зоны. При расположении справа основная зона сверху; при расположении снизу — слева. Обе границы доступны через Tab и стрелки. Браузер сохраняет сторону, отдельные размеры справа и снизу, пропорции двух зон и состав вкладок после закрытия и перезагрузки.

Шестерёнка каждой зоны показывает предусмотренные вкладки. Можно скрыть ненужные, оставив хотя бы одну. Выбор элемента дерева автоматически возвращает вкладку **Параметры**, если она была скрыта. Несохранённый ввод требует решения перед сменой элемента или режима; изменение размера панели и её перенос в окно сохраняют ввод.

**Сцена** показывает схемы и вложенные эпизоды. Выберите строку для изменения названия и цветов. Кнопки под деревом добавляют, редактируют и удаляют узлы. Перетаскивание меняет порядок; перенос эпизода на другую схему предлагает копирование или перемещение. Названия уникальны среди соседних узлов. Импорт JSON добавляет объект; существующий объект не заменяется. Если имя уже занято, сначала переименуйте источник или имеющийся узел.

В параметрах эпизода добавляйте события, которые автоматически переводят схему в него. Одно событие внутри одной схемы ведёт только в один эпизод. Мастер в Режиссёре может войти в любой эпизод независимо от этих условий. Выбрав схему, её можно отдельно остановить или возобновить с выбранного эпизода.

**События** перечисляет события сцены и их типы триггеров. У события настройте порядок подписантов кнопками вверх/вниз: встроенное действие, макрос или вызов другого триггера. У триггера задайте поля и ограничения текста, целых и дробных чисел, логических значений. Встроенные определения доступны для просмотра и вызова. JSON кнопки переносят выбранное пользовательское событие или триггер.

**Макросы** принимает перетаскивание из каталога Foundry. Новый макрос и кнопка **Править** используют штатный редактор. В дополнительной зоне отметьте принимаемые им типы триггеров. Макрос можно перетащить прямо на строку подписанта события.

**Иное** временно собирает остальные инструменты. Основная зона содержит названия блоков; дополнительная показывает только выбранный блок. Здесь остаются НИП и магазины, теги, диалоги, зоны, пауза, звук, подкрепление, рабочие столы и перенос всей сцены. В Режиссёре доступны управление НИП, счётчики, журнал, магазины и ручные диалоги. Сохранение отдельного блока не удаляет настройки остальных блоков.

Отдельное окно использует ту же сессию мастера. Разрешите всплывающие окна для адреса Foundry, если браузер блокирует открытие. Кнопка переноса возвращает ширму к карте. Закрытие внешнего окна крестиком браузера возвращает ширму в панель и сохраняет ввод; внутренний крестик ширмы закрывает инструменты.

# Master screen workspace

Choose **Master screen (panel)** to work beside the map, or **Master screen (window)** for another monitor. Opening the category only expands its submenu; Help has its own button.

The top bar switches **Constructor / Director**, opens **Actor** separately, moves the workspace between a panel and a browser window, selects **right / bottom**, and closes the screen. Constructor and Director share the workspace. Actor keeps it visible. Closing tools does not stop automation: use **Stop all** in Director.

Drag the marked outside divider to resize the panel and tabletop. The inner divider separates the main list area from the details area: top/bottom when docked right, left/right when docked below. Both dividers support Tab and arrow keys. This browser remembers the side, separate panel sizes, inner proportions and visible tabs after closing or reloading.

Each zone's gear controls its predefined tabs; at least one remains visible. Selecting a tree node restores **Parameters** if hidden. Changing a node or mode asks about unsaved edits; resizing or moving the workspace preserves them.

**Scene** lists schemes and their episodes. Select a row to edit its name and colours. Buttons below the tree add, edit and delete nodes. Drag to reorder, or drag an episode to another scheme and choose copy or move. Sibling names must be unique. JSON import adds an object and does not replace an existing object; rename conflicting names before importing.

An episode's event list determines automated entry. Within a scheme, an event may target only one episode. Director allows the GM to enter any episode manually. Select a scheme to stop it independently or resume it from a chosen episode.

**Events** lists scene events and their named trigger types. Order subscribers with up/down buttons: a built-in action, macro or another trigger. Configure trigger fields and limits for text, integers, decimals and booleans. Built-in definitions can be inspected and invoked. JSON controls transfer the selected custom event or trigger.

**Macros** accepts drops from the Foundry directory. Create and edit with Foundry's native editor; select accepted trigger types in the details area. A macro can also be dropped onto an event's subscriber row.

**Other** temporarily groups the remaining tools. Select a block in the main zone to show only its settings in the details zone: NPCs and shops, tags, dialogues, zones, pause, sound, reinforcements, workspaces and full-scene transfer. Director also provides NPC controls, counters, history, shops and manual dialogues. Saving a block preserves the other blocks.

The separate window uses the same GM session. Allow popups for the Foundry address if opening is blocked. Closing the browser popup returns the screen to the panel and keeps edits; the screen's own close button closes its tools.
