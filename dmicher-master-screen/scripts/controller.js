import { MODULE_ID, getState } from "./model.js";
import { asArray, currentScene, getDefinition, getRuntime, getDefinitions, getRuntimes, requireGM, saveDefinition, getObjectTags, saveObjectTags } from "./store.js";
import { generics } from "./generics.js";
import { notifyError } from "./ui.js";
import { GroupRuntime } from "./runtime.js";
import { WorkspaceManager } from "./workspace.js";
import { exportBundle, importBundle } from "./transfer.js";
import { createShopService } from "./shop.js";
import { SceneSignals } from "./signals.js";
import { createDialogueService } from "./dialogues.js";
import { MasterScreenApplication } from "./apps/ide.js";
import { ActorViewApplication } from "./apps/actor-view.js";
import { ShopApplication } from "./apps/shop-window.js";
import { ShopsManagerApplication } from "./apps/shops-manager.js";
import { DialogueApplication } from "./apps/dialogue-window.js";
import { DialogueCatalogApplication } from "./apps/dialogue-catalog.js";
import { HelpApplication, InteractionApplication } from "./apps/help.js";
import { updateSceneNavigationBadges } from "./apps/group-badges.js";
import { ConstructorIndicator } from "./apps/constructor-indicator.js";
import { ObjectContextMenu } from "./apps/object-context-menu.js";
import { ObjectInfoApplication, ObjectBehaviorApplication } from "./apps/object-tools.js";
import { listAvailableInteractions, objectDescriptor } from "./interaction-access.js";
import { getSceneObject } from "./scene-objects.js";
import { StateChooserApplication } from "./apps/state-chooser.js";

export class ScreenController {
  constructor() {
    this.mode = null;
    this.selected = new Map();
    this.selectedGroups = new Map();
    this.shopWindows = new Map();
    this.dialogueWindows = new Map();
    this.objectInfoWindows = new Map();
    this.objectBehaviorWindows = new Map();
    this.objectMenu = new ObjectContextMenu();
    this.constructorIndicator = new ConstructorIndicator();
    this.workspace = new WorkspaceManager();
    this.runtime = new GroupRuntime({ chat: generics.chat, onChange: (scene) => this.changed(scene),
      isConstructor: () => this.mode === "constructor",
      emitSignal: (scene, signal) => this.signals.emit(scene, signal),
      onWorkspace: async (scene, _workspace, { groupId = "main" } = {}) => { void this.workspace.apply(scene, getRuntime(scene, { groupId })).catch(notifyError); } });
    this.signals = new SceneSignals({ runtime: this.runtime, isConstructor: () => this.mode === "constructor" });
    this.dialogues = createDialogueService({ emitSignal: (scene, signal) => this.signals.emit(scene, signal), onChange: (scene) => this.changed(scene) });
    this.shop = createShopService({ emitSignal: (scene, signal) => this.signals.emit(scene, signal), onChange: (scene) => this.changed(scene) });
    this.hooks = [];
  }
  getContext({ groupId } = {}) {
    const scene = currentScene();
    const definitions = getDefinitions(scene);
    const explicitGroup = groupId !== undefined;
    groupId ??= this.selectedGroups.get(scene?.id) ?? definitions[0]?.groupId ?? null;
    if (!definitions.some((definition) => definition.groupId === groupId)) groupId = explicitGroup ? null : definitions[0]?.groupId ?? null;
    const definition = groupId ? getDefinition(scene, { groupId }) : null, runtime = definition ? getRuntime(scene, { groupId }) : null;
    const candidateStateId = this.selected.get(`${scene?.id}:${groupId}`) ?? this.selected.get(scene?.id);
    const selectedStateId = definition?.states.some((state) => state.id === candidateStateId) ? candidateStateId : definition?.entryStateId ?? definition?.states[0]?.id;
    const objects = [
      ...asArray(scene?.tokens).map((token) => ({ type: "Token", id: token.id, name: token.name })),
      ...asArray(scene?.tiles).map((tile) => ({ type: "Tile", id: tile.id, name: tile.name || tile.texture?.src?.split("/").pop() || tile.id }))
    ].map((object) => ({ ...object, tags: getObjectTags(scene, object) }));
    return { scene, definition, runtime, definitions, objects, mode: this.mode, groupId, selectedStateId,
      state: definition ? getState(definition, selectedStateId) : null, tokens: asArray(scene?.tokens), isGM: game.user?.isGM === true };
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
    } else {
      const actorTokenId = this.getActingTokenId(undefined, descriptor.type === "Token" ? descriptor.id : undefined);
      const actorToken = scene.tokens?.get(actorTokenId);
      items = listAvailableInteractions(scene, descriptor, actorToken, game.user).map((entry) => ({
        label: entry.kind === "shop" ? `${ru ? "Торг" : "Trade"}: ${entry.name}` : entry.kind === "dialogue" ? `${entry.paused ? (ru ? "Продолжить диалог" : "Resume dialogue") : (ru ? "Диалог" : "Dialogue")}: ${entry.name}` : entry.name,
        action: () => entry.kind === "shop" ? this.openShop(descriptor, { actorTokenId, groupId: entry.groupId, shopId: entry.id })
          : entry.kind === "dialogue" ? this.openDialogue(entry.id, actorTokenId, { groupId: entry.groupId, target: descriptor })
            : this.requestNamedInteraction(entry.id, actorTokenId, { groupId: entry.groupId })
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
    void Promise.resolve(this.editorOpening).then(() => globalThis.ui?.controls?.render()).catch(notifyError);
    return this.editor;
  }
  isScreenOpen() { return this.editor?.rendered === true; }
  toggleScreen() { return this.isScreenOpen() ? this.closeScreen() : this.openScreen("panel"); }
  openStateChooser() {
    requireGM();
    this.stateChooser = generics.windows.openSingletonApplication(this.stateChooser, () => new StateChooserApplication(this), { moduleId: MODULE_ID });
    return this.stateChooser;
  }
  async changeStates(changes) {
    requireGM(); const scene = currentScene();
    for (const { groupId, stateId } of changes) {
      const definition = getDefinition(scene, { groupId });
      if (!getState(definition, stateId)) throw new Error("Состояние больше не существует.");
    }
    for (const { groupId, stateId } of changes) {
      if (getRuntime(scene, { groupId }).stateId !== stateId) await this.runtime.enter(scene, stateId, { groupId, force: true, preserveStatus: true });
    }
  }
  startAll() { return this.runtime.startAll(currentScene()); }
  haltAll() { return this.runtime.haltAll(currentScene()); }
  restoreObjectInitial(descriptor) { return this.runtime.restoreInitial(currentScene(), descriptor); }
  selectGroup(groupId, { render = true } = {}) {
    const scene = currentScene();
    if (!getDefinitions(scene).some((definition) => definition.groupId === groupId)) throw new Error("Группа не найдена");
    this.selectedGroups.set(scene.id, groupId);
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
  selectState(id, { render = true, resetDraft = true } = {}) {
    const { scene, definition } = this.getContext();
    if (!getState(definition, id)) throw new Error("Состояние не найдено");
    this.selected.set(`${scene.id}:${definition.groupId}`, id);
    if (resetDraft) this.editor?.resetDraft();
    if (render) return this.editor?.refresh();
  }
  async saveDefinition(definition, expectedRevision = definition.revision, { sceneId } = {}) {
    const scene = currentScene();
    if (sceneId && scene?.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к сцене редактируемого черновика.");
    await saveDefinition(scene, definition, { expectedRevision });
    this.changed(scene);
  }
  async saveState(state, { expectedRevision, sceneId, groupId } = {}) {
    const { scene, definition } = this.getContext({ groupId });
    if (sceneId && scene?.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к сцене редактируемого черновика.");
    if (!getState(definition, state.id)) throw new Error("Редактируемое состояние больше не существует.");
    definition.states = definition.states.map((entry) => entry.id === state.id ? state : entry);
    await this.saveDefinition(definition, expectedRevision ?? definition.revision, { sceneId });
  }
  captureWorkspace() { return this.workspace.capture(); }
  async saveObjectTags(type, id, tags, sceneId = currentScene()?.id) {
    const scene = currentScene();
    if (!scene || scene.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к объекту, теги которого редактируете.");
    await saveObjectTags(scene, { type, id }, tags);
    this.changed(scene);
  }
  resetConditions(conditionKey) { return this.runtime.resetConditions(currentScene(), { conditionKey, groupId: this.getContext().groupId }); }
  setConditionEnabled(conditionKey, enabled) { return this.runtime.setConditionEnabled(currentScene(), conditionKey, enabled); }
  haltScene() { return this.runtime.haltAll(currentScene()); }
  haltGroup(groupId = this.getContext().groupId) { return this.runtime.halt(currentScene(), { groupId }); }
  resumeGroup(stateId, groupId = this.getContext().groupId) { return this.runtime.enter(currentScene(), stateId, { force: true, groupId }); }
  emitSignal(emitterKey, name, parameters = {}) {
    requireGM();
    return this.signals.emit(currentScene(), { emitterKey, name, parameters });
  }
  transition(id, { groupId = this.getContext().groupId } = {}) { return this.runtime.enter(currentScene(), id, { force: true, groupId }); }
  setAutomation(tokenId, enabled, { groupId = this.getContext().groupId } = {}) { return this.runtime.setAutomation(currentScene(), tokenId, enabled, { groupId }); }
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
  async openShop(rawTarget, { actorTokenId, sessionId, shopId, join = false, groupId = this.getContext().groupId } = {}) {
    const scene = currentScene();
    const target = objectDescriptor(rawTarget);
    actorTokenId ??= this.getActingTokenId(undefined, target.type === "Token" ? target.id : undefined);
    if (!actorTokenId) throw new Error("Выберите своего персонажа на карте");
    const key = `${scene.id}:${groupId}:${getRuntime(scene, { groupId }).runId}:${target.type}:${target.id}:${shopId}:${actorTokenId}:${sessionId ?? "own"}`;
    const app = generics.windows.openSingletonApplication(this.shopWindows.get(key),
      () => new ShopApplication(this, { sceneId: scene.id, groupId, target, actorTokenId, sessionId, shopId, join }), { moduleId: MODULE_ID });
    this.shopWindows.set(key, app);
    return app;
  }
  async interact(tokenId, sourceTokenId, { targetType = "Token", groupId } = {}) {
    const scene = currentScene(), target = { type: targetType, id: tokenId };
    sourceTokenId = this.getActingTokenId(sourceTokenId, targetType === "Token" ? tokenId : undefined);
    const choices = listAvailableInteractions(scene, target, scene?.tokens.get(sourceTokenId), game.user).filter((entry) => !groupId || entry.groupId === groupId);
    if (!choices.length) throw new Error("Interaction is unavailable for this character.");
    this.interaction = new InteractionApplication(this, { sceneId: scene.id, tokenId, sourceTokenId, targetType, groupId });
    return this.interaction.render({ force: true });
  }
  getActingTokenId(actorTokenId, targetTokenId) {
    const allowed = (token) => token?.id !== targetTokenId && token?.actor && !token.hidden
      && (game.user.isGM || token.actor.testUserPermission(game.user, "OWNER"));
    if (actorTokenId) return allowed(currentScene()?.tokens.get(actorTokenId)) ? actorTokenId : undefined;
    // A self-target is explicit intent and survives clicking the NPC, which may change
    // the controlled-token set. Targeting never grants ownership or cross-scene access.
    const targeted = asArray(game.user.targets).map((token) => currentScene()?.tokens.get((token.document ?? token).id)).filter(allowed);
    if (targeted.length === 1) return targeted[0].id;
    if (targeted.length > 1) return undefined;
    const controlled = asArray(canvas.tokens?.controlled).map((token) => token.document ?? token).filter(allowed);
    if (controlled.length === 1) return controlled[0].id;
    const candidates = this.getPlayerTokens().filter(allowed);
    return candidates.length === 1 ? candidates[0].id : undefined;
  }
  openDialogue(dialogueId, actorTokenId, { groupId, target } = {}) {
    const { scene, runtime } = this.getContext({ groupId });
    actorTokenId = this.getActingTokenId(actorTokenId);
    if (!actorTokenId) throw new Error("Выберите персонажа игрока для разговора.");
    const key = `${scene.id}:${runtime.runId}:${dialogueId}:${target?.type}:${target?.id}:${actorTokenId}`;
    const app = generics.windows.openSingletonApplication(this.dialogueWindows.get(key),
      () => new DialogueApplication(this.dialogues, { sceneId: scene.id, groupId: runtime.groupId, dialogueId, target, actorTokenId }), { moduleId: MODULE_ID });
    this.dialogueWindows.set(key, app);
    return app;
  }
  requestNamedInteraction(interactionId, actorTokenId, { groupId = this.getContext().groupId } = {}) {
    const scene = currentScene();
    actorTokenId = this.getActingTokenId(actorTokenId);
    if (!actorTokenId) throw new Error("Выберите персонажа игрока для взаимодействия.");
    return this.dialogues.requestInteraction({ sceneId: scene.id, groupId, interactionId, actorTokenId });
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
    for (const app of [this.editor, this.actor, this.shops, this.dialogueCatalog, ...this.objectInfoWindows.values(), ...this.objectBehaviorWindows.values(), ...this.shopWindows.values(), ...this.dialogueWindows.values()]) {
      if (app?.rendered) void Promise.resolve(app.refresh?.()).catch(notifyError);
    }
    for (const runtime of getRuntimes(scene)) void this.workspace.apply(scene, runtime).catch(notifyError);
  }
  async closeScreen() {
    this.cancelPick?.();
    if (this.editor?.rendered && !(await this.editor.mayClose())) return;
    const dirty = [...this.objectInfoWindows.values(), ...this.objectBehaviorWindows.values()]
      .find((app) => app?.rendered && app.dirty);
    if (dirty && !(await dirty.mayDiscard())) return;
    this.mode = null;
    this.objectMenu.close(); this.constructorIndicator.dispose();
    for (const app of [this.editor, this.actor, this.shops, this.interaction, this.preview, this.dialogueCatalog, ...this.objectInfoWindows.values(), ...this.objectBehaviorWindows.values(), ...this.shopWindows.values(), ...this.dialogueWindows.values()]) {
      if (app?.rendered) await app.close();
    }
    await this.workspace.close();
    updateSceneNavigationBadges(this);
    globalThis.ui?.controls?.render();
  }
  async dispose() { this.runtime.dispose(); this.signals.dispose(); this.dialogues.dispose?.(); this.cancelPick?.(); await this.closeScreen(); }
}
