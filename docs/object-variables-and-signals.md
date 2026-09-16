# Переменные и сигналы объектов / Object variables and signals

## Работа мастера

В автоматизации объекта задайте переменные: уникальное имя, текстовый, целочисленный или дробный тип, начальное значение. Текущее значение изменяется во время игры независимо от начального. Чтение настроек не создаёт записи в сцене.

Объект всегда может прочитать собственную переменную. Флаг «Внутренний» разрешает его исполнению изменить её. «Внешний просмотр» и «Внешнее изменение» отдельно разрешают обращения других объектов; по умолчанию они выключены. Изменение допуска применяется к следующему обращению сразу. Имена допускают Unicode; обращаться к ним следует как к именам данных, а не фрагментам кода.

Сигналы объектов нужно включить явно. Публикация столкновений происходит по подтверждённому изменению положения, без покадровой проверки всей сцены. Повторное движение внутри прежнего соприкосновения не создаёт новое столкновение, если предыдущее положение известно. Системные проверки допуска команд продолжают работать независимо от включения наблюдаемых сигналов.

Подписка может вызвать прикреплённый макрос или скрипт события объекта. Полученные параметры проверяются по объявленному интерфейсу сигнала. Остановка исполнения запрещает поздним продолжениям изменять переменные.

## GM workflow

Define each object variable with a unique name, text/integer/number type and initial value. Gameplay changes the current value independently of its default. Reading preparation does not initialize scene records.

An object can always read its own variable. Internal access allows its execution to write it. External read and external write independently allow other objects to access it; both are off by default. Access changes apply immediately to the next request. Names support Unicode and are treated as data, never executable source.

Enable object signals explicitly. Collision publication follows confirmed position changes without scanning the scene every frame. Continued contact does not publish another collision when the previous position is known. Mandatory command validation remains independent of observable signal activation.

A subscription can invoke an attached macro or the object's event script. Incoming parameters follow the declared signal interface. Once execution is stopped, late continuations cannot update variables.

## Runtime contract

`binding.variables`: `[{name, type: "text" | "integer" | "number", value, access: {internal: true, externalRead: false, externalWrite: false}}]`.

`binding.signals`: `{enabled: true, enabledIds: []}`. The empty selection means publication is off for every object signal. Runtime switch `objectSignalState[objectKey] === false` temporarily disables publication independently of preparation.

`ObjectVariableService.scope(scene, {object, current})` requires the executing GM and a validity callback. `object` is the executor's native document UUID or `{type,id}`. The returned immutable capability captures that identity; callers cannot supply another origin in a request. It exposes asynchronous `GetValue(objectUuid, name)`, `SetValue(objectUuid, name, value)`, `getVariables()` and equivalent special requests `request("GetValue", {objectUuid,name})` / `request("SetValue", {objectUuid,name,value})`.

Values are persisted under the separate scene flag `objectVariableValues: {schemaVersion: 1, values: {[objectKey]: {[name]: value}}}`. Access and types are checked again inside the serialized write. Pending document writes cannot be physically cancelled; after cancellation the capability refuses further operations. No schema migration or implicit type conversion is performed.

Script subscriptions use `handler: "script"` instead of `macroUuid`. `SceneSignals.runObjectEvent(scene, {owner, subscription, signal, parameters, current, variables, context})` returns the signal's typed return values; the existing delivery cancellation scope governs it. `signalMacroSnippet(signal,{variables,objectUuid})` supplies the factory contract and safe variable reads.

`ObjectEventSignals.install()` registers native update and activation observers and returns its disposer. `withInitiator(document,{userId,patronUuid},operation)` records an authority-established command origin only for that operation. Client update options never establish trusted provenance. Note activation is local to the opening client: player notifications use the host's authenticated request transport and call `noteOpened(document,userId)` on the authority after validation.

## Переходы шагов / Step transitions

«Следующий» выбирает строку непосредственно ниже текущей: перетаскивание меняет такой маршрут. «Любой из» сохраняет маршрут по номерам независимо от расположения строк. «Макрос» выбирает массив номеров по текущим переменным объекта; выбор из возвращённого массива равновероятный. Несуществующие номера не исполняются. Пустой результат завершает блок либо возвращает его к шагу 1 при включённом повторе. Скрытый текст макроса и список номеров сохраняются при переключении режима.

Макрос перехода доступен бесплатно. Его исходник хранится в самом шаге и удаляется вместе с ним, не создавая отдельного документа Foundry. При сохранении проверяется синтаксис, но исходник не исполняется. Проверка циклов рассматривает неизвестные переходы макроса консервативно — как возможные переходы ко всем шагам. Переменные предоставлены через `context.getVariables()`, `context.GetValue(objectUuid, name)` и `context.SetValue(objectUuid, name, value)`; доступны также `context.stepId` и `context.stateId`.

Premium-шаги «Фокус», «Звук», «Плейлист», «Макрос» остаются в списке. Без доступа исполнитель пропускает их на следующую строку, не исполняя их макрос перехода и не выбирая указанный ими маршрут. Прерывание с политикой «Следующий шаг» сохраняет выбранный тип перехода; макрос выбора вычисляется только после возобновления.

Next row follows the immediately following displayed row, so dragging changes that route. Any of follows stable step IDs independently of row order. Macro returns an array of IDs using the object's current variables; selection from the returned array is uniform. Missing IDs are never executed. An empty result completes the block, or returns to step 1 when Repeat is enabled. Switching modes preserves the hidden source and explicit target list.

Transition macros are free. Source belongs to the step and disappears with it without creating a separate Foundry Macro document. Saving checks syntax without executing authored code. Cycle diagnostics conservatively treat dynamic macro edges as potentially targeting every step. Use `context.getVariables()`, `context.GetValue(objectUuid, name)`, `context.SetValue(objectUuid, name, value)`, `context.stepId` and `context.stateId`.

Focus, Sound, Playlist and Macro steps remain listed as Premium. Without access the executor skips them to the next physical row without evaluating their transition macro or authored branch. A Next step interruption respects the chosen transition type; branch macros are evaluated only after resuming.

Runtime shape: `step.transition = {mode: "next" | "any" | "macro", macro: string}`; `step.next` retains the explicit Any of IDs. A newly added step uses Next row. An existing saved step without this optional field retains its explicit graph; reads never write or migrate it. Branches are cancellable jobs outside the scene write queue, and compiled source is cached with a bounded 128-entry limit. An in-flight stopped branch cannot advance a replacement execution.

An optional Macro-step `parameters.signalId` selects its event/reaction contract. Save-time validation reads the declared interface without executing the factory. Runtime compares it with the authority-captured input contract and validates incoming values and returned fields. Typed returns are retained in script progress for the event's result; an empty contract selection keeps the ordinary attached-macro call. Standalone macros receive `context` and `scriptContext` scope aliases; signal factories use their existing `execute(context)` method.
