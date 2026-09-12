import { MODULE_ID } from "../model.js";
import { themedClasses } from "../ui.js";
import { tokenCenter } from "../effects.js";
import { listAvailableInteractions } from "../interaction-access.js";
import { getRuntimes } from "../store.js";
import { getObjectBindings } from "../scene-objects.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const values = (collection) => Array.from(collection?.values?.() ?? collection ?? []);
const documentOf = (token) => token?.document ?? token;

/** Native detection for one source: never uses the GM-wide canvas visibility result. */
export function isTokenVisibleFrom(observerToken, targetToken, { canvas: view = globalThis.canvas, config = globalThis.CONFIG } = {}) {
  const observer = documentOf(observerToken), target = documentOf(targetToken);
  if (!observer || !target || target.hidden) return false;
  if (observer.level != null && target.level != null && observer.level !== target.level) return false;
  if (observer.id === target.id) return true;
  const invisible = config?.specialStatusEffects?.INVISIBLE;
  if (!view?.scene?.tokenVision) return !invisible || !target.hasStatusEffect?.(invisible);
  const source = observer.object?.vision ?? observerToken.vision;
  if (!source?.active || source.isBlinded || !observer.sight?.enabled) return false;
  const targetObject = target.object ?? targetToken;
  const points = target.getVisibilityTestPoints?.() ?? [tokenCenter(target, view.scene)];
  const level = view.scene.levels?.get(target.level) ?? view.level;
  const tests = points.map((point) => ({ point: { ...point, elevation: point.elevation ?? target.elevation ?? 0 },
    elevation: point.elevation ?? target.elevation ?? 0, level, los: new Map() }));
  const modes = Array.isArray(observer.detectionModes)
    ? observer.detectionModes : Object.entries(observer.detectionModes ?? {}).map(([modeId, mode]) => ({ id: modeId, ...mode }));
  try {
    // Special senses are intentionally omitted: their token silhouettes are not ordinary visible NPCs.
    return modes.filter((mode) => ["basicSight", "lightPerception"].includes(mode.id))
      .some((mode) => config?.Canvas?.detectionModes?.[mode.id]?.testVisibility(source, mode,
        { object: targetObject, level, tests }) === true);
  } catch { return false; }
}

function tracePolygon(context, polygon) {
  const points = polygon?.points;
  if (!Array.isArray(points) || points.length < 6) return false;
  context.beginPath();
  context.moveTo(points[0], points[1]);
  for (let index = 2; index < points.length; index += 2) context.lineTo(points[index], points[index + 1]);
  context.closePath();
  return true;
}

function drawTexture(context, mesh, x, y, width, height) {
  const source = mesh?.texture?.baseTexture?.resource?.source ?? mesh?.sourceElement;
  if (!source) return false;
  try { context.drawImage(source, x, y, width, height); return true; } catch { return false; }
}

export class ActorViewApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dmicher-master-screen-actor", classes: themedClasses("ms-actor-view"),
    window: { title: "Ширма мастера · Актёр", icon: "fa-solid fa-masks-theater", resizable: true },
    position: { width: 880, height: 720 },
    actions: {
      selectToken: ActorViewApplication.selectToken,
      interact: ActorViewApplication.interact,
      separateWindow: ActorViewApplication.separateWindow,
      move: ActorViewApplication.move
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/actor-view.hbs` } };

  constructor(controller, options = {}) {
    super(options);
    this.controller = controller;
    this.actorTokenId = null;
    this.timer = null;
    this.listeners = null;
    this.lastSceneId = null;
    this.interactionSignature = "";
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = this.controller.getContext();
    const tokens = this.controller.getPlayerTokens().map(documentOf);
    if (state.scene?.id !== this.lastSceneId || !tokens.some((token) => token.id === this.actorTokenId)) {
      this.lastSceneId = state.scene?.id;
      this.actorTokenId = tokens.find((token) => token.object?.controlled)?.id ?? tokens[0]?.id ?? null;
    }
    return { ...context, sceneName: state.scene?.name ?? "Нет сцены", missing: !state.scene,
      tokens: tokens.map((token) => ({ id: token.id, name: token.name, selected: token.id === this.actorTokenId })),
      hasTokens: tokens.length > 0, detachable: typeof this.detachWindow === "function" };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.interactionSignature = "";
    this.listeners?.abort();
    const owner = this.element.ownerDocument.defaultView;
    this.listeners = new owner.AbortController();
    this.element.querySelector("[name=actorTokenId]")?.addEventListener("change", (event) => {
      this.actorTokenId = event.target.value;
      this.selectObserver();
      this.drawPreview();
    }, { signal: this.listeners.signal });
    this.element.querySelector("canvas")?.addEventListener("dblclick", (event) => {
      if (!event.shiftKey) return;
      const state = this.controller.getContext();
      const token = state.scene?.tokens?.get(this.actorTokenId);
      if (!token || !this.viewTransform) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) * event.currentTarget.width / rect.width;
      const y = (event.clientY - rect.top) * event.currentTarget.height / rect.height;
      const transform = this.viewTransform;
      this.act(() => this.controller.moveActorToken(token.id, {
        x: (x - transform.x) / transform.scale - Number(token.width ?? 1) * state.scene.grid.size / 2,
        y: (y - transform.y) / transform.scale - Number(token.height ?? 1) * state.scene.grid.size / 2
      }));
    }, { signal: this.listeners.signal });
    this.selectObserver();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.drawPreview(), 350);
    this.drawPreview();
  }

  selectObserver() {
    const token = this.controller.getContext().scene?.tokens?.get(this.actorTokenId)?.object;
    if (token && !token.controlled) token.control({ releaseOthers: true });
  }

  async act(action) {
    try { return await action(); }
    catch (error) { ui.notifications.error(error.message); return null; }
  }

  static selectToken() { this.selectObserver(); this.drawPreview(); }
  refresh() { if (this.rendered) return this.render({ force: true }); }
  static interact(_event, button) { return this.act(() => this.controller.interact(button.dataset.tokenId, this.actorTokenId)); }
  static separateWindow() { return this.detachWindow?.(); }
  static move(_event, button) {
    const state = this.controller.getContext();
    const token = state.scene?.tokens?.get(this.actorTokenId);
    if (!token) return;
    const size = Number(state.scene.grid?.size ?? 100);
    const delta = { left: [-size, 0], right: [size, 0], up: [0, -size], down: [0, size] }[button.dataset.direction];
    if (delta) return this.act(() => this.controller.moveActorToken(token.id, { x: token.x + delta[0], y: token.y + delta[1] }));
  }

  drawPreview() {
    if (!this.rendered || !this.element?.isConnected) return;
    const target = this.element.querySelector("canvas");
    const state = this.controller.getContext();
    if (!target) return;
    const context = target.getContext("2d");
    if (!context) return;
    target.width = Math.max(480, Math.min(1400, Math.round(target.clientWidth || 800)));
    target.height = Math.round(target.width * 0.625);
    context.fillStyle = "#080a0d";
    context.fillRect(0, 0, target.width, target.height);
    const scene = state.scene;
    const observer = scene?.tokens?.get(this.actorTokenId);
    const status = this.element.querySelector("[data-preview-status]");
    const setStatus = (text) => { if (status) status.textContent = text; };
    if (!scene || canvas.scene?.id !== scene.id || !observer) { setStatus("Выберите персонажа текущей карты."); this.updateInteractions([]); return; }
    const source = observer.object?.vision;
    if (scene.tokenVision && (!source?.active || !observer.sight?.enabled)) {
      setStatus("Для предпросмотра включите зрение выбранного токена и выберите его на карте. Без источника зрения карта скрыта.");
      this.updateInteractions([]);
      return;
    }
    const rect = canvas.dimensions.sceneRect;
    const scale = Math.min(target.width / rect.width, target.height / rect.height);
    const x = (target.width - rect.width * scale) / 2 - rect.x * scale;
    const y = (target.height - rect.height * scale) / 2 - rect.y * scale;
    this.viewTransform = { x, y, scale };
    context.save();
    context.setTransform(scale, 0, 0, scale, x, y);
    const paintMap = () => {
      context.fillStyle = "#252a34";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      drawTexture(context, canvas.primary.background, rect.x, rect.y, rect.width, rect.height);
    };
    if (!scene.tokenVision) paintMap();
    else if (!source.isBlinded) {
      context.save();
      if (tracePolygon(context, source.fov)) { context.clip(); paintMap(); }
      context.restore();
      if (source.visionMode?.perceivesLight !== false) {
        for (const light of values(canvas.effects?.lightSources)) {
          if (!light.active || light.data?.negative) continue;
          context.save();
          if (tracePolygon(context, source.light ?? source.los)) {
            context.clip();
            if (tracePolygon(context, light.shape)) { context.clip(); paintMap(); }
          }
          context.restore();
        }
      }
    }
    const visible = values(scene.tokens).filter((token) => isTokenVisibleFrom(observer, token));
    const bindings = getObjectBindings(scene).bindings, runtimes = getRuntimes(scene);
    for (const token of visible) {
      const width = Number(token.width ?? 1) * scene.grid.size;
      const height = Number(token.height ?? 1) * scene.grid.size;
      if (!drawTexture(context, token.object, token.x, token.y, width, height)) {
        context.fillStyle = token.id === observer.id ? "#b4d8f3" : "#c6b394";
        context.beginPath(); context.arc(token.x + width / 2, token.y + height / 2, Math.min(width, height) / 3, 0, Math.PI * 2); context.fill();
      }
      const binding = bindings[`Token:${token.id}`], runtime = runtimes.find((entry) => entry.groupId === binding?.groupId);
      const visuals = Object.entries(runtime?.scriptStates ?? {}).filter(([key, value]) => key.startsWith(`Token:${token.id}:`) && value);
      const emoji = visuals.toSorted((a, b) => Number(b[1].emojiAt ?? 0) - Number(a[1].emojiAt ?? 0))[0]?.[1]?.emoji;
      if (emoji && !binding.playerCharacter && !runtime.halted && !runtime.disabledObjects?.includes(`Token:${token.id}`)) {
        context.font = `${Math.max(20, width / 3)}px sans-serif`;
        context.textAlign = "center";
        context.fillText(emoji, token.x + width / 2, token.y);
      }
    }
    context.restore();
    this.updateInteractions(visible.filter((token) => token.id !== observer.id).flatMap((token) => {
      const choices = listAvailableInteractions(scene, { type: "Token", id: token.id }, observer, game.user);
      return choices.length ? [{ id: token.id, label: `${token.name} · Взаимодействовать` }] : [];
    }));
    setStatus(scene.tokenVision ? "Предпросмотр выбранного персонажа: базовое зрение и прямая видимость." : "В сцене отключено зрение токенов: карта открыта, скрытые токены исключены.");
  }

  updateInteractions(items) {
    const signature = JSON.stringify(items);
    if (signature === this.interactionSignature) return;
    this.interactionSignature = signature;
    const container = this.element.querySelector("[data-interactions]");
    if (!container) return;
    container.replaceChildren(...items.map((item) => {
      const button = container.ownerDocument.createElement("button");
      button.type = "button";
      button.dataset.action = "interact";
      button.dataset.tokenId = item.id;
      button.textContent = item.label;
      return button;
    }));
  }

  async close(options = {}) {
    clearInterval(this.timer);
    this.timer = null;
    this.listeners?.abort();
    return super.close(options);
  }
}
