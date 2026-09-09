import { MODULE_ID, defaultEpisode, defaultTokenBehavior, getEpisode, randomId } from "./model.js";
import { asArray, currentScene, getDefinition, getRuntime, getDefinitions, getRuntimes, requireGM, saveDefinition, getObjectTags, saveObjectTags } from "./store.js";
import { generics } from "./generics.js";
import { notifyError } from "./ui.js";
import { EpisodeRuntime } from "./runtime.js";
import { WorkspaceManager } from "./workspace.js";
import { exportBundle, importBundle } from "./transfer.js";
import { createShopService } from "./shop.js";
import { SceneEvents } from "./events.js";
import { createDialogueService } from "./dialogues.js";
import { TokenEditorApplication } from "./apps/editor.js";
import { MasterScreenApplication } from "./apps/ide.js";
import { ActorViewApplication } from "./apps/actor-view.js";
import { ShopApplication } from "./apps/shop-window.js";
import { ShopsManagerApplication } from "./apps/shops-manager.js";
import { DialogueEditorApplication } from "./apps/dialogue-editor.js";
import { DialogueApplication } from "./apps/dialogue-window.js";
import { DialogueCatalogApplication } from "./apps/dialogue-catalog.js";
import { HelpApplication, InteractionApplication } from "./apps/help.js";
import { updateSceneNavigationBadges } from "./apps/scheme-badges.js";
import { ConstructorIndicator } from "./apps/constructor-indicator.js";
import { ObjectContextMenu } from "./apps/object-context-menu.js";
import { ObjectInfoApplication, ObjectBehaviorApplication } from "./apps/object-tools.js";
import { listAvailableInteractions, objectDescriptor } from "./interaction-access.js";
import { getSceneObject, SceneObjects } from "./scene-objects.js";

export class ScreenController {
  constructor() {
    this.mode = null;
    this.selected = new Map();
    this.selectedSchemes = new Map();
    this.tokenWindows = new Map();
    this.shopWindows = new Map();
    this.dialogueEditors = new Map();
    this.dialogueWindows = new Map();
    this.objectInfoWindows = new Map();
    this.objectBehaviorWindows = new Map();
    this.objectMenu = new ObjectContextMenu();
    this.constructorIndicator = new ConstructorIndicator();
    this.workspace = new WorkspaceManager();
    this.runtime = new EpisodeRuntime({ chat: generics.chat, onChange: (scene) => this.changed(scene),
      onEvent: (scene, event) => this.events.emit(scene, event),
      onTypedEvent: (scene, name, trigger, options) => this.events.invoke(scene, name, trigger, options),
      onWorkspace: async (scene, _workspace, { schemeId = "main" } = {}) => { void this.workspace.apply(scene, getRuntime(scene, { schemeId })).catch(notifyError); } });
    this.events = new SceneEvents({ runtime: this.runtime, chat: generics.chat, onChange: (scene) => this.changed(scene) });
    this.dialogues = createDialogueService({ emitEvent: (scene, event) => this.events.emit(scene, event), onChange: (scene) => this.changed(scene) });
    this.shop = createShopService({ onChange: (scene) => this.changed(scene) });
    this.interactionMessages = generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "interaction" });
    this.hooks = [];
  }
  getContext({ schemeId } = {}) {
    const scene = currentScene();
    const definitions = getDefinitions(scene);
    const explicitScheme = schemeId !== undefined;
    schemeId ??= this.selectedSchemes.get(scene?.id) ?? definitions[0]?.schemeId ?? null;
    if (!definitions.some((definition) => definition.schemeId === schemeId)) schemeId = explicitScheme ? null : definitions[0]?.schemeId ?? null;
    const definition = schemeId ? getDefinition(scene, { schemeId }) : null, runtime = definition ? getRuntime(scene, { schemeId }) : null;
    const candidateEpisodeId = this.selected.get(`${scene?.id}:${schemeId}`) ?? this.selected.get(scene?.id);
    const selectedEpisodeId = definition?.episodes.some((episode) => episode.id === candidateEpisodeId) ? candidateEpisodeId : definition?.entryEpisodeId ?? definition?.episodes[0]?.id;
    const objects = [
      ...asArray(scene?.tokens).map((token) => ({ type: "Token", id: token.id, name: token.name })),
      ...asArray(scene?.tiles).map((tile) => ({ type: "Tile", id: tile.id, name: tile.name || tile.texture?.src?.split("/").pop() || tile.id }))
    ].map((object) => ({ ...object, tags: getObjectTags(scene, object) }));
    return { scene, definition, runtime, definitions, objects, mode: this.mode, schemeId, selectedEpisodeId,
      episode: definition ? getEpisode(definition, selectedEpisodeId) : null, tokens: asArray(scene?.tokens), isGM: game.user?.isGM === true };
  }
  getPlayerTokens() {
    const users = asArray(game.users).filter((user) => [1, 2].includes(Number(user.role)) && !generics.chat.isManagedIdentityUser(user));
    return asArray(currentScene()?.tokens).filter((token) => token.actor && !token.hidden
      && users.some((user) => token.actor.testUserPermission(user, "OWNER")));
  }
  async setMode(mode) {
    requireGM();
    if (!["constructor", "director", "actor"].includes(mode)) throw new Error("Неизвестный режим ширмы");
    if (!currentScene()) throw new Error("Откройте карту сцены");
    canvas.tokens.activate();
    if (mode === "actor") {
      this.actor = generics.windows.openSingletonApplication(this.actor, () => new ActorViewApplication(this), { moduleId: MODULE_ID });
      if (!this.mode) this.mode = "actor";
    } else {
      if (!this.editor?.rendered) { this.openScreen("panel", { mode }); await this.editorOpening; }
      else if (await this.editor.changeMode(mode) === false) return;
      this.mode = mode;
    }
    this.refreshConstructorFrame();
    return this.mode;
  }
  refreshConstructorFrame() {
    this.constructorIndicator.sync(game.user?.isGM === true && this.mode === "constructor" && this.editor?.rendered === true);
  }
  openObjectInfo(descriptor) { return this.openObjectForm(descriptor, this.objectInfoWindows, ObjectInfoApplication); }
  openObjectBehavior(descriptor) { return this.openObjectForm(descriptor, this.objectBehaviorWindows, ObjectBehaviorApplication); }
  openObjectForm(descriptor, windows, Application) {
    requireGM();
    const scene = currentScene();
    if (!getSceneObject(scene, descriptor)) throw new Error("Объект больше не существует.");
    const key = `${scene.id}:${descriptor.type}:${descriptor.id}`;
    const app = generics.windows.openSingletonApplication(windows.get(key), () => new Application(this, descriptor), { moduleId: MODULE_ID });
    windows.set(key, app); return app;
  }
  openObjectMenu(descriptor, position = {}) {
    const scene = currentScene(), ru = game.i18n?.lang?.startsWith("ru");
    if (!getSceneObject(scene, descriptor)) return false;
    let items;
    if (game.user.isGM && this.mode === "constructor") {
      items = [
        { label: ru ? "Информация" : "Information", action: () => this.openObjectInfo(descriptor) },
        { label: ru ? "Поведение" : "Behavior", action: () => this.openObjectBehavior(descriptor) }
      ];
      if (descriptor.type === "Token") items.push({ label: ru ? "Поведение токена (техдолг)" : "Token behavior (legacy)", action: () => {
        const binding = new SceneObjects(scene).get(descriptor);
        return this.openToken(descriptor.id, { schemeId: binding?.schemeId ?? undefined });
      } });
    } else {
      const actorTokenId = this.getActingTokenId(undefined, descriptor.type === "Token" ? descriptor.id : undefined);
      const actorToken = scene.tokens?.get(actorTokenId);
      items = listAvailableInteractions(scene, descriptor, actorToken, game.user).map((entry) => ({
        label: entry.kind === "shop" ? (ru ? "Торг" : "Trade") : entry.kind === "dialogue" ? (ru ? "Диалог" : "Dialogue") : entry.name,
        action: () => entry.kind === "shop" ? this.openShop(descriptor, { actorTokenId, schemeId: entry.schemeId })
          : entry.kind === "dialogue" ? this.openDialogue(entry.id, actorTokenId, { schemeId: entry.schemeId, target: descriptor })
            : entry.kind === "transition" ? this.triggerInteraction(descriptor.id, actorTokenId, { schemeId: entry.schemeId })
              : this.requestNamedInteraction(entry.id, actorTokenId, { schemeId: entry.schemeId })
      }));
    }
    if (!items.length) { this.objectMenu.close(); return false; }
    this.objectMenu.open(items, position); return true;
  }
  async openAsset(kind, id) {
    requireGM();
    if (!this.editor?.rendered) { this.openScreen("panel", { mode: "constructor" }); await this.editorOpening; }
    else if (this.mode !== "constructor" && await this.editor.changeMode("constructor") === false) return;
    this.mode = "constructor"; this.refreshConstructorFrame();
    return this.editor.openAsset(kind, id);
  }
  async previewAsset(kind, id, options = {}) {
    requireGM();
    const sceneId = currentScene()?.id;
    const { InteractionPreviewApplication } = await import("./apps/interaction-preview.js");
    if (currentScene()?.id !== sceneId) throw new Error("Сцена предпросмотра изменилась.");
    if (this.preview?.rendered) await this.preview.close();
    this.preview = generics.windows.openSingletonApplication(null,
      () => new InteractionPreviewApplication(this, { kind, assetId: id, sceneId, ...options }), { moduleId: MODULE_ID });
    return this.preview;
  }
  previewDialogueAsset(id, pageId) { requireGM(); return this.dialogues.openManualDialogue({ sceneId: currentScene()?.id, dialogueId: id, pageId }); }
  openScreen(presentation = "panel", { mode = this.mode === "director" ? "director" : "constructor" } = {}) {
    requireGM();
    if (!currentScene()) throw new Error("Откройте карту сцены");
    if (!this.editor?.rendered) {
      this.editor = new MasterScreenApplication(this, { mode, presentation });
      if (presentation === "window") this.editor.reservePopup();
      this.mode = mode;
      this.editorOpening = Promise.resolve(this.editor.render({ force: true }));
      void this.editorOpening.catch(notifyError);
    } else {
      if (presentation === "window") this.editor.reservePopup();
      void this.editor.setPresentation(presentation).catch(notifyError);
    }
    canvas.tokens.activate();
    return this.editor;
  }
  selectScheme(schemeId, { render = true } = {}) {
    const scene = currentScene();
    if (!getDefinitions(scene).some((definition) => definition.schemeId === schemeId)) throw new Error("Схема не найдена");
    this.selectedSchemes.set(scene.id, schemeId);
    if (render) return this.editor?.refresh();
  }
  openHelp() {
    this.help = generics.windows.openSingletonApplication(this.help, () => new HelpApplication(), { moduleId: MODULE_ID });
    return this.help;
  }
  openShops() {
    requireGM();
    this.shops = generics.windows.openSingletonApplication(this.shops, () => new ShopsManagerApplication(this), { moduleId: MODULE_ID });
    return this.shops;
  }
  openDialogues() {
    requireGM();
    this.dialogueCatalog = generics.windows.openSingletonApplication(this.dialogueCatalog, () => new DialogueCatalogApplication(this), { moduleId: MODULE_ID });
    return this.dialogueCatalog;
  }
  selectEpisode(id, { render = true, resetDraft = true } = {}) {
    const { scene, definition } = this.getContext();
    if (!getEpisode(definition, id)) throw new Error("Эпизод не найден");
    this.selected.set(`${scene.id}:${definition.schemeId}`, id);
    if (resetDraft) this.editor?.resetDraft();
    if (render) return this.editor?.refresh();
  }
  async saveDefinition(definition, expectedRevision = definition.revision, { sceneId } = {}) {
    const scene = currentScene();
    if (sceneId && scene?.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к сцене редактируемого черновика.");
    await saveDefinition(scene, definition, { expectedRevision });
    this.changed(scene);
  }
  async saveEpisode(episode, { expectedRevision, sceneId, schemeId } = {}) {
    const { scene, definition } = this.getContext({ schemeId });
    if (sceneId && scene?.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к сцене редактируемого черновика.");
    if (!getEpisode(definition, episode.id)) throw new Error("Редактируемый эпизод больше не существует.");
    definition.episodes = definition.episodes.map((entry) => entry.id === episode.id ? episode : entry);
    await this.saveDefinition(definition, expectedRevision ?? definition.revision, { sceneId });
  }
  async saveToken(tokenId, behavior, episodeId, { expectedRevision, sceneId, schemeId } = {}) {
    const { scene, definition, selectedEpisodeId } = this.getContext({ schemeId });
    if (sceneId && scene?.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к сцене редактируемого токена.");
    if (!scene?.tokens.has(tokenId)) throw new Error("Токен больше не существует");
    const episode = getEpisode(definition, episodeId ?? selectedEpisodeId);
    if (!episode) throw new Error("Эпизод больше не существует");
    episode.tokens[tokenId] = behavior;
    await this.saveDefinition(definition, expectedRevision ?? definition.revision, { sceneId });
  }
  async addEpisode(name) {
    const { definition } = this.getContext();
    const episode = defaultEpisode(name);
    definition.episodes.push(episode);
    await this.saveDefinition(definition);
    return this.selectEpisode(episode.id);
  }
  async deleteEpisode(id) {
    const { definition, runtime } = this.getContext();
    if (runtime.episodeId === id) throw new Error("Сначала перейдите из удаляемого эпизода в другой");
    definition.episodes = definition.episodes.filter((entry) => entry.id !== id);
    for (const episode of definition.episodes) {
      episode.from = episode.from.filter((entry) => entry !== id);
      episode.zones = episode.zones.filter((zone) => zone.targetEpisodeId !== id);
      episode.subscriptions = (episode.subscriptions ?? []).filter((entry) => entry.kind !== "transition" || entry.episodeId !== id);
      for (const behavior of Object.values(episode.tokens)) {
        if (behavior.interaction.targetEpisodeId === id) behavior.interaction.targetEpisodeId = "";
        for (const point of behavior.patrol.points) if (point.onTrue === id) point.onTrue = "";
      }
    }
    await this.saveDefinition(definition);
    if (definition.episodes.length) this.selectEpisode(definition.episodes[0].id);
  }
  openToken(tokenId, { schemeId, episodeId } = {}) {
    requireGM();
    const { scene, selectedEpisodeId, definition } = this.getContext({ schemeId });
    if (!scene?.tokens.get(tokenId)) return;
    if (!definition) { ui.notifications.warn("Сначала создайте схему и выберите эпизод."); return; }
    episodeId ??= selectedEpisodeId;
    const key = `${scene.id}:${definition.schemeId}:${episodeId}:${tokenId}`;
    const app = generics.windows.openSingletonApplication(this.tokenWindows.get(key),
      () => new TokenEditorApplication(this, tokenId, { episodeId, schemeId: definition.schemeId }), { moduleId: MODULE_ID });
    this.tokenWindows.set(key, app);
    return app;
  }
  captureToken(tokenId) {
    const token = currentScene()?.tokens.get(tokenId);
    if (!token) throw new Error("Токен не найден");
    return { x: token.x, y: token.y, hidden: token.hidden };
  }
  captureWorkspace() { return this.workspace.capture(); }
  async saveObjectTags(type, id, tags, sceneId = currentScene()?.id) {
    const scene = currentScene();
    if (!scene || scene.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к объекту, теги которого редактируете.");
    await saveObjectTags(scene, { type, id }, tags);
    this.changed(scene);
  }
  resetTriggers(triggerKey) { return this.runtime.resetTriggers(currentScene(), { triggerKey, schemeId: this.getContext().schemeId }); }
  setTriggerEnabled(triggerKey, enabled) { return this.runtime.setTriggerEnabled(currentScene(), triggerKey, enabled); }
  haltScene() { return this.runtime.haltAll(currentScene()); }
  haltScheme(schemeId = this.getContext().schemeId) { return this.runtime.halt(currentScene(), { schemeId }); }
  resumeScheme(episodeId, schemeId = this.getContext().schemeId) { return this.runtime.enter(currentScene(), episodeId, { force: true, schemeId }); }
  openDialogueEditor(dialogueId, { schemeId } = {}) {
    requireGM();
    const { scene, episode, selectedEpisodeId, definition } = this.getContext({ schemeId });
    if (!scene || !episode?.dialogues?.some((entry) => entry.id === dialogueId)) throw new Error("Диалог не найден в выбранном эпизоде.");
    const key = `${scene.id}:${definition.schemeId}:${selectedEpisodeId}:${dialogueId}`;
    const app = generics.windows.openSingletonApplication(this.dialogueEditors.get(key),
      () => new DialogueEditorApplication(this, dialogueId, { episodeId: selectedEpisodeId, schemeId: definition.schemeId }), { moduleId: MODULE_ID });
    this.dialogueEditors.set(key, app);
    return app;
  }
  async addDialogue() {
    const { scene, definition, episode } = this.getContext();
    if (!scene || !episode) throw new Error("Выберите эпизод сцены.");
    const token = asArray(scene.tokens)[0], tile = asArray(scene.tiles)[0];
    if (!token && !tile) throw new Error("Сначала добавьте на сцену НИП или тайл.");
    const dialogue = { id: randomId(), name: "Новый диалог", enabled: true, target: { type: token ? "Token" : "Tile", id: token?.id ?? tile.id },
      range: 5, startNodeId: "start", nodes: [{ id: "start", text: "", art: "", responses: [] }] };
    episode.dialogues ??= [];
    episode.dialogues.push(dialogue);
    await this.saveDefinition(definition);
    return this.openDialogueEditor(dialogue.id);
  }
  async saveDialogue(dialogue, episodeId, { sceneId, expectedRevision, schemeId } = {}) {
    const { scene, definition } = this.getContext({ schemeId });
    if (sceneId && scene?.id !== sceneId) throw new Error("Вернитесь к сцене редактируемого диалога.");
    const episode = getEpisode(definition, episodeId);
    if (!episode?.dialogues?.some((entry) => entry.id === dialogue.id)) throw new Error("Диалог больше не существует.");
    episode.dialogues = episode.dialogues.map((entry) => entry.id === dialogue.id ? dialogue : entry);
    await this.saveDefinition(definition, expectedRevision ?? definition.revision, { sceneId });
  }
  async deleteDialogue(dialogueId) {
    const { definition, episode } = this.getContext();
    episode.dialogues = (episode.dialogues ?? []).filter((entry) => entry.id !== dialogueId);
    await this.saveDefinition(definition);
  }
  emitEvent(name, { payload = {}, actorTokenId, id, runId, source = "manual", schemeId = this.getContext().schemeId } = {}) {
    requireGM();
    return this.events.emit(currentScene(), { name, source, actorTokenId, id, runId, schemeId, payload: { userId: game.user.id, ...payload } });
  }
  transition(id, { schemeId = this.getContext().schemeId } = {}) { return this.runtime.enter(currentScene(), id, { force: true, schemeId }); }
  setAutomation(tokenId, enabled, { schemeId = this.getContext().schemeId } = {}) { return this.runtime.setAutomation(currentScene(), tokenId, enabled, { schemeId }); }
  startCombat() { return this.runtime.startCombat(currentScene(), { rollInitiative: true }); }
  async exportScene() {
    const bundle = await exportBundle(currentScene());
    const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
    save(JSON.stringify(bundle, null, 2), "application/json", `master-screen-${currentScene().id}.json`);
  }
  async importScene(file) {
    requireGM();
    if (!file || file.size > 20 * 1024 * 1024) throw new Error("JSON должен быть не больше 20 МБ");
    const result = await importBundle(JSON.parse(await file.text()));
    ui.notifications.info(`Создана сцена «${result.scene.name}». ${result.warnings.join(" ")}`);
    await result.scene.view();
    return this.setMode("constructor");
  }
  async openShop(rawTarget, { actorTokenId, sessionId, join = false, schemeId = this.getContext().schemeId } = {}) {
    const scene = currentScene();
    const target = objectDescriptor(rawTarget);
    actorTokenId ??= this.getActingTokenId(undefined, target.type === "Token" ? target.id : undefined);
    if (!actorTokenId) throw new Error("Выберите своего персонажа на карте");
    const key = `${scene.id}:${schemeId}:${getRuntime(scene, { schemeId }).runId}:${target.type}:${target.id}:${actorTokenId}:${sessionId ?? "own"}`;
    const app = generics.windows.openSingletonApplication(this.shopWindows.get(key),
      () => new ShopApplication(this, { sceneId: scene.id, schemeId, target, actorTokenId, sessionId, join }), { moduleId: MODULE_ID });
    this.shopWindows.set(key, app);
    return app;
  }
  getInteractions(targetType, targetId, { schemeId } = {}) {
    const scene = currentScene();
    const candidates = schemeId ? [getRuntime(scene, { schemeId })] : getRuntimes(scene);
    const matches = (entry) => entry.enabled && entry.target.type === targetType && entry.target.id === targetId;
    for (const runtime of candidates) {
      if (runtime.halted || !runtime.episode || runtime.episode.stop || (targetType === "Token" && runtime.disabledTokens.includes(targetId))) continue;
      const behavior = targetType === "Token" ? runtime.episode.tokens?.[targetId] : null;
      const result = { dialogues: (runtime.episode.dialogues ?? []).filter(matches), actions: (runtime.episode.interactions ?? []).filter(matches),
        behavior: behavior?.enabled ? behavior : null, schemeId: runtime.schemeId };
      if (result.dialogues.length || result.actions.length || result.behavior?.shop?.enabled || result.behavior?.interaction?.targetEpisodeId) return result;
    }
    return { dialogues: [], actions: [], behavior: null, schemeId };
  }
  async interact(tokenId, sourceTokenId, { targetType = "Token", schemeId } = {}) {
    const { scene } = this.getContext();
    const interaction = this.getInteractions(targetType, tokenId, { schemeId });
    const { behavior, dialogues, actions } = interaction;
    schemeId = interaction.schemeId;
    if (!behavior?.shop.enabled && !behavior?.interaction.targetEpisodeId && !dialogues.length && !actions.length) throw new Error("Взаимодействие сейчас отключено");
    if (behavior?.shop.enabled && !behavior.interaction.targetEpisodeId && !dialogues.length && !actions.length) return this.openShop(tokenId, { actorTokenId: sourceTokenId, schemeId });
    this.interaction = new InteractionApplication(this, { sceneId: scene.id, tokenId, sourceTokenId, targetType, schemeId });
    return this.interaction.render({ force: true });
  }
  getActingTokenId(actorTokenId, targetTokenId) {
    const allowed = (token) => token?.id !== targetTokenId && token?.actor && !token.hidden
      && (game.user.isGM || token.actor.testUserPermission(game.user, "OWNER"));
    if (actorTokenId) return allowed(currentScene()?.tokens.get(actorTokenId)) ? actorTokenId : undefined;
    const controlled = asArray(canvas.tokens?.controlled).map((token) => token.document ?? token).filter(allowed);
    if (controlled.length === 1) return controlled[0].id;
    const candidates = this.getPlayerTokens().filter(allowed);
    return candidates.length === 1 ? candidates[0].id : undefined;
  }
  openDialogue(dialogueId, actorTokenId, { schemeId, target } = {}) {
    const { scene, runtime } = this.getContext({ schemeId });
    actorTokenId = this.getActingTokenId(actorTokenId);
    if (!actorTokenId) throw new Error("Выберите персонажа игрока для разговора.");
    const key = `${scene.id}:${runtime.runId}:${dialogueId}:${target?.type}:${target?.id}:${actorTokenId}`;
    const app = generics.windows.openSingletonApplication(this.dialogueWindows.get(key),
      () => new DialogueApplication(this.dialogues, { sceneId: scene.id, schemeId: runtime.schemeId, dialogueId, target, actorTokenId }), { moduleId: MODULE_ID });
    this.dialogueWindows.set(key, app);
    return app;
  }
  requestNamedInteraction(interactionId, actorTokenId, { schemeId = this.getContext().schemeId } = {}) {
    const scene = currentScene();
    actorTokenId = this.getActingTokenId(actorTokenId);
    if (!actorTokenId) throw new Error("Выберите персонажа игрока для взаимодействия.");
    return this.dialogues.requestInteraction({ sceneId: scene.id, schemeId, interactionId, actorTokenId });
  }
  async triggerInteraction(tokenId, sourceTokenId, { schemeId = this.getContext().schemeId } = {}) {
    const scene = currentScene();
    sourceTokenId ??= asArray(canvas.tokens.controlled).find((token) => token.id !== tokenId)?.id;
    if (!sourceTokenId) throw new Error("Сначала выберите своего персонажа");
    if (game.user.isGM) return this.runtime.interact(scene, tokenId, { sourceTokenId, user: game.user, schemeId });
    const actor = scene.tokens.get(sourceTokenId)?.actor;
    if (!actor?.testUserPermission(game.user, "OWNER")) throw new Error("Нужен принадлежащий вам персонаж");
    return this.interactionMessages.create({
      content: "<p>Ширма: взаимодействие с персонажем.</p>",
      flags: { [MODULE_ID]: { interaction: { sceneId: scene.id, tokenId, sourceTokenId, runId: getRuntime(scene, { schemeId }).runId, schemeId } } }
    }, { audience: { type: "gms" }, kind: "interaction", technical: true });
  }
  async moveActorToken(tokenId, position) {
    requireGM();
    if (game.paused) throw new Error("Игра на паузе");
    const token = this.getPlayerTokens().find((entry) => entry.id === tokenId);
    if (!token) throw new Error("Выберите персонажа игрока");
    const center = { x: position.x + token.object.w / 2, y: position.y + token.object.h / 2 };
    if (token.object.checkCollision(center, { type: "move", mode: "any" })) throw new Error("Путь пересекает стену");
    return token.update(position);
  }
  pickPoint() {
    this.objectMenu.close();
    this.cancelPick?.();
    const stage = canvas.stage;
    const sceneId = currentScene()?.id;
    ui.notifications.info("Укажите точку на карте. Escape — отмена.");
    return new Promise((resolve) => {
      const finish = (point) => {
        stage.off("pointertap", click); document.removeEventListener("keydown", key);
        this.cancelPick = null; resolve(point);
      };
      const click = (event) => {
        if (sceneId !== currentScene()?.id) return finish(null);
        if (event.button > 0) return;
        event.stopPropagation();
        const point = event.getLocalPosition(stage);
        finish({ x: Math.round(point.x), y: Math.round(point.y) });
      };
      const key = (event) => { if (event.key === "Escape") finish(null); };
      this.cancelPick = () => finish(null);
      stage.on("pointertap", click); document.addEventListener("keydown", key);
    });
  }
  changed(scene) {
    updateSceneNavigationBadges(this);
    this.refreshConstructorFrame();
    if (scene?.id !== currentScene()?.id) return;
    for (const app of [this.editor, this.actor, this.shops, this.dialogueCatalog, ...this.objectInfoWindows.values(), ...this.objectBehaviorWindows.values(), ...this.tokenWindows.values(), ...this.shopWindows.values(), ...this.dialogueEditors.values(), ...this.dialogueWindows.values()]) {
      if (app?.rendered) void Promise.resolve(app.refresh?.()).catch(notifyError);
    }
    for (const runtime of getRuntimes(scene)) void this.workspace.apply(scene, runtime).catch(notifyError);
  }
  async closeScreen() {
    this.cancelPick?.();
    if (this.editor?.rendered && !(await this.editor.mayClose())) return;
    const dirty = [...this.objectInfoWindows.values(), ...this.objectBehaviorWindows.values(), ...this.tokenWindows.values(), ...this.dialogueEditors.values()]
      .find((app) => app?.rendered && app.dirty);
    if (dirty && !(await dirty.mayDiscard())) return;
    this.mode = null;
    this.objectMenu.close(); this.constructorIndicator.dispose();
    for (const app of [this.editor, this.actor, this.shops, this.interaction, this.preview, this.dialogueCatalog, ...this.objectInfoWindows.values(), ...this.objectBehaviorWindows.values(), ...this.tokenWindows.values(), ...this.shopWindows.values(), ...this.dialogueEditors.values(), ...this.dialogueWindows.values()]) {
      if (app?.rendered) await app.close();
    }
    await this.workspace.close();
    updateSceneNavigationBadges(this);
  }
  async dispose() { this.runtime.dispose(); this.events.dispose(); this.dialogues.dispose?.(); this.cancelPick?.(); await this.closeScreen(); }
}
