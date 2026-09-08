import { MODULE_ID, defaultEpisode, defaultTokenBehavior, getEpisode, randomId } from "./model.js";
import { asArray, currentScene, getDefinition, getRuntime, requireGM, saveDefinition, getObjectTags, saveObjectTags } from "./store.js";
import { generics } from "./generics.js";
import { notifyError } from "./ui.js";
import { EpisodeRuntime } from "./runtime.js";
import { WorkspaceManager } from "./workspace.js";
import { exportBundle, importBundle } from "./transfer.js";
import { createShopService } from "./shop.js";
import { SceneEvents } from "./events.js";
import { createDialogueService } from "./dialogues.js";
import { EditorApplication, TokenEditorApplication } from "./apps/editor.js";
import { ActorViewApplication } from "./apps/actor-view.js";
import { ShopApplication } from "./apps/shop-window.js";
import { ShopsManagerApplication } from "./apps/shops-manager.js";
import { DialogueEditorApplication } from "./apps/dialogue-editor.js";
import { DialogueApplication } from "./apps/dialogue-window.js";
import { DialogueCatalogApplication } from "./apps/dialogue-catalog.js";
import { HelpApplication, InteractionApplication } from "./apps/help.js";

export class ScreenController {
  constructor() {
    this.mode = null;
    this.selected = new Map();
    this.tokenWindows = new Map();
    this.shopWindows = new Map();
    this.dialogueEditors = new Map();
    this.dialogueWindows = new Map();
    this.workspace = new WorkspaceManager();
    this.runtime = new EpisodeRuntime({ chat: generics.chat, onChange: (scene) => this.changed(scene),
      onEvent: (scene, event) => this.events.emit(scene, event),
      onWorkspace: async (scene) => { void this.workspace.apply(scene).catch(notifyError); } });
    this.events = new SceneEvents({ runtime: this.runtime, chat: generics.chat, onChange: (scene) => this.changed(scene) });
    this.dialogues = createDialogueService({ emitEvent: (scene, event) => this.events.emit(scene, event), onChange: (scene) => this.changed(scene) });
    this.shop = createShopService({ onChange: (scene) => this.changed(scene) });
    this.interactionMessages = generics.chat.createMessageService({ ownerId: MODULE_ID, channel: "interaction" });
    this.hooks = [];
  }
  getContext() {
    const scene = currentScene(), definition = getDefinition(scene), runtime = getRuntime(scene);
    const selectedEpisodeId = this.selected.get(scene?.id) ?? definition.episodes[0]?.id;
    const objects = [
      ...asArray(scene?.tokens).map((token) => ({ type: "Token", id: token.id, name: token.name })),
      ...asArray(scene?.tiles).map((tile) => ({ type: "Tile", id: tile.id, name: tile.name || tile.texture?.src?.split("/").pop() || tile.id }))
    ].map((object) => ({ ...object, tags: getObjectTags(scene, object) }));
    return { scene, definition, runtime, objects, mode: this.mode, selectedEpisodeId,
      episode: getEpisode(definition, selectedEpisodeId), tokens: asArray(scene?.tokens), isGM: game.user?.isGM === true };
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
    if (mode !== "actor" && this.editor?.dirty && this.editor.mode !== mode && !(await this.editor.mayDiscard())) return;
    this.mode = mode;
    canvas.tokens.activate();
    if (mode === "actor") {
      this.actor = generics.windows.openSingletonApplication(this.actor, () => new ActorViewApplication(this), { moduleId: MODULE_ID });
    } else {
      if (this.editor && this.editor.mode !== mode) { await this.editor.close(); this.editor = null; }
      this.editor = generics.windows.openSingletonApplication(this.editor, () => new EditorApplication(this, { mode }), { moduleId: MODULE_ID });
      if (this.editor.rendered) await this.editor.refresh();
    }
    return this.mode;
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
  selectEpisode(id) {
    const { scene, definition } = this.getContext();
    if (!getEpisode(definition, id)) throw new Error("Эпизод не найден");
    this.selected.set(scene.id, id);
    this.editor?.resetDraft();
    return this.editor?.refresh();
  }
  async saveDefinition(definition, expectedRevision = definition.revision, { sceneId } = {}) {
    const scene = currentScene();
    if (sceneId && scene?.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к сцене редактируемого черновика.");
    await saveDefinition(scene, definition, { expectedRevision });
    this.changed(scene);
  }
  async saveEpisode(episode, { expectedRevision, sceneId } = {}) {
    const { scene, definition } = this.getContext();
    if (sceneId && scene?.id !== sceneId) throw new Error("Сцена изменилась. Вернитесь к сцене редактируемого черновика.");
    if (!getEpisode(definition, episode.id)) throw new Error("Редактируемый эпизод больше не существует.");
    definition.episodes = definition.episodes.map((entry) => entry.id === episode.id ? episode : entry);
    await this.saveDefinition(definition, expectedRevision ?? definition.revision, { sceneId });
  }
  async saveToken(tokenId, behavior, episodeId, { expectedRevision, sceneId } = {}) {
    const { scene, definition, selectedEpisodeId } = this.getContext();
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
  openToken(tokenId) {
    requireGM();
    const { scene, selectedEpisodeId } = this.getContext();
    if (!scene?.tokens.get(tokenId)) return;
    const key = `${scene.id}:${selectedEpisodeId}:${tokenId}`;
    const app = generics.windows.openSingletonApplication(this.tokenWindows.get(key),
      () => new TokenEditorApplication(this, tokenId, { episodeId: selectedEpisodeId }), { moduleId: MODULE_ID });
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
  resetTriggers(triggerKey) { return this.runtime.resetTriggers(currentScene(), { triggerKey }); }
  setTriggerEnabled(triggerKey, enabled) { return this.runtime.setTriggerEnabled(currentScene(), triggerKey, enabled); }
  haltScene() { return this.runtime.haltAll(currentScene()); }
  haltScheme() { return this.runtime.halt(currentScene(), { schemeId: "main" }); }
  resumeScheme(episodeId) { return this.runtime.enter(currentScene(), episodeId, { force: true, schemeId: "main" }); }
  openDialogueEditor(dialogueId) {
    requireGM();
    const { scene, episode, selectedEpisodeId } = this.getContext();
    if (!scene || !episode?.dialogues?.some((entry) => entry.id === dialogueId)) throw new Error("Диалог не найден в выбранном эпизоде.");
    const key = `${scene.id}:${selectedEpisodeId}:${dialogueId}`;
    const app = generics.windows.openSingletonApplication(this.dialogueEditors.get(key),
      () => new DialogueEditorApplication(this, dialogueId, { episodeId: selectedEpisodeId }), { moduleId: MODULE_ID });
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
  async saveDialogue(dialogue, episodeId, { sceneId, expectedRevision } = {}) {
    const { scene, definition } = this.getContext();
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
  emitEvent(name, { payload = {}, actorTokenId, id, runId, source = "manual" } = {}) {
    requireGM();
    return this.events.emit(currentScene(), { name, source, actorTokenId, id, runId, payload: { userId: game.user.id, ...payload } });
  }
  transition(id) { return this.runtime.enter(currentScene(), id, { force: true }); }
  setAutomation(tokenId, enabled) { return this.runtime.setAutomation(currentScene(), tokenId, enabled); }
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
  async openShop(tokenId, { actorTokenId, sessionId, join = false } = {}) {
    const scene = currentScene();
    actorTokenId ??= asArray(canvas.tokens.controlled).find((token) => token.id !== tokenId)?.id
      ?? this.getPlayerTokens().find((token) => game.user.isGM || token.actor.testUserPermission(game.user, "OWNER"))?.id;
    if (!actorTokenId) throw new Error("Выберите своего персонажа на карте");
    const key = `${scene.id}:${getRuntime(scene).runId}:${tokenId}:${actorTokenId}:${sessionId ?? "own"}`;
    const app = generics.windows.openSingletonApplication(this.shopWindows.get(key),
      () => new ShopApplication(this, { sceneId: scene.id, tokenId, actorTokenId, sessionId, join }), { moduleId: MODULE_ID });
    this.shopWindows.set(key, app);
    return app;
  }
  getInteractions(targetType, targetId) {
    const { runtime } = this.getContext();
    if (runtime.halted || !runtime.episode || runtime.episode.stop || (targetType === "Token" && runtime.disabledTokens.includes(targetId))) return { dialogues: [], actions: [], behavior: null };
    const matches = (entry) => entry.enabled && entry.target.type === targetType && entry.target.id === targetId;
    const behavior = targetType === "Token" ? runtime.episode.tokens?.[targetId] : null;
    return { dialogues: (runtime.episode.dialogues ?? []).filter(matches), actions: (runtime.episode.interactions ?? []).filter(matches),
      behavior: behavior?.enabled ? behavior : null };
  }
  async interact(tokenId, sourceTokenId, { targetType = "Token" } = {}) {
    const { scene, runtime } = this.getContext();
    const { behavior, dialogues, actions } = this.getInteractions(targetType, tokenId);
    if (!behavior?.shop.enabled && !behavior?.interaction.targetEpisodeId && !dialogues.length && !actions.length) throw new Error("Взаимодействие сейчас отключено");
    if (behavior?.shop.enabled && !behavior.interaction.targetEpisodeId && !dialogues.length && !actions.length) return this.openShop(tokenId, { actorTokenId: sourceTokenId });
    this.interaction = new InteractionApplication(this, { sceneId: scene.id, tokenId, sourceTokenId, targetType });
    return this.interaction.render({ force: true });
  }
  getActingTokenId(actorTokenId, targetTokenId) {
    return actorTokenId ?? asArray(canvas.tokens.controlled).find((token) => token.id !== targetTokenId)?.id
      ?? this.getPlayerTokens().find((token) => game.user.isGM || token.actor.testUserPermission(game.user, "OWNER"))?.id;
  }
  openDialogue(dialogueId, actorTokenId) {
    const { scene, runtime } = this.getContext();
    actorTokenId = this.getActingTokenId(actorTokenId);
    if (!actorTokenId) throw new Error("Выберите персонажа игрока для разговора.");
    const key = `${scene.id}:${runtime.runId}:${dialogueId}:${actorTokenId}`;
    const app = generics.windows.openSingletonApplication(this.dialogueWindows.get(key),
      () => new DialogueApplication(this.dialogues, { sceneId: scene.id, dialogueId, actorTokenId }), { moduleId: MODULE_ID });
    this.dialogueWindows.set(key, app);
    return app;
  }
  requestNamedInteraction(interactionId, actorTokenId) {
    const scene = currentScene();
    actorTokenId = this.getActingTokenId(actorTokenId);
    if (!actorTokenId) throw new Error("Выберите персонажа игрока для взаимодействия.");
    return this.dialogues.requestInteraction({ sceneId: scene.id, interactionId, actorTokenId });
  }
  async triggerInteraction(tokenId, sourceTokenId) {
    const scene = currentScene();
    sourceTokenId ??= asArray(canvas.tokens.controlled).find((token) => token.id !== tokenId)?.id;
    if (!sourceTokenId) throw new Error("Сначала выберите своего персонажа");
    if (game.user.isGM) return this.runtime.interact(scene, tokenId, { sourceTokenId, user: game.user });
    const actor = scene.tokens.get(sourceTokenId)?.actor;
    if (!actor?.testUserPermission(game.user, "OWNER")) throw new Error("Нужен принадлежащий вам персонаж");
    return this.interactionMessages.create({
      content: "<p>Ширма: взаимодействие с персонажем.</p>",
      flags: { [MODULE_ID]: { interaction: { sceneId: scene.id, tokenId, sourceTokenId, runId: getRuntime(scene).runId, schemeId: "main" } } }
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
    if (scene?.id !== currentScene()?.id) return;
    for (const app of [this.editor, this.actor, this.shops, this.dialogueCatalog, ...this.tokenWindows.values(), ...this.shopWindows.values(), ...this.dialogueEditors.values(), ...this.dialogueWindows.values()]) {
      if (app?.rendered) void Promise.resolve(app.refresh?.()).catch(notifyError);
    }
    void this.workspace.apply(scene).catch(notifyError);
  }
  async closeScreen() {
    this.cancelPick?.();
    const dirty = [this.editor, ...this.tokenWindows.values(), ...this.dialogueEditors.values()]
      .find((app) => app?.rendered && app.dirty);
    if (dirty && !(await dirty.mayDiscard())) return;
    this.mode = null;
    for (const app of [this.editor, this.actor, this.shops, this.interaction, this.dialogueCatalog, ...this.tokenWindows.values(), ...this.shopWindows.values(), ...this.dialogueEditors.values(), ...this.dialogueWindows.values()]) {
      if (app?.rendered) await app.close();
    }
    await this.workspace.close();
  }
  async dispose() { this.runtime.dispose(); this.events.dispose(); this.dialogues.dispose?.(); this.cancelPick?.(); await this.closeScreen(); }
}
