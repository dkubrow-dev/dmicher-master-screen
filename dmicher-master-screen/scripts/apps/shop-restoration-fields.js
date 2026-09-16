import { text as t } from "../localization.js";
import { normalizeShopRestoration } from "../shop-restoration-policy.js";
import { isShopRestorationAvailable, subscribeShopRestorationAccess } from "../premium-provider.js";
import { renderConditionMacro } from "./object-property-fields.js";
import { escapeHTML as e } from "./form-fields.js";

export function renderShopRestorationFields(raw) {
  const policy = normalizeShopRestoration(raw), allowed = isShopRestorationAvailable();
  const options = [{ id: "manual", name: t("Вручную", "Manually") },
    { id: "state-entry", name: t("При входе в состояние", "On state entry") },
    { id: "scene-activation", name: t("При активации карты", "On scene activation") }];
  return `<details class="ms-details" data-shop-restoration><summary>${t("Возврат в исходное состояние", "Restore initial stock")} <span class="dmicher-premium-badge">Premium</span></summary>
    <label class="ms-field">${t("Активация", "Activation")}<select name="shop-restoration-activation">${options.map(option => `<option value="${option.id}"${option.id === policy.activation ? " selected" : ""}${option.id !== "manual" && !allowed ? " disabled" : ""}>${e(option.name)}</option>`).join("")}</select></label>
    <p class="ms-note">${t("Ручной возврат доступен бесплатно в каталоге магазинов. Автоматический возврат требует Premium. Незавершённая сделка отменяется, завершённый обмен сохраняется.", "Manual restoration is free in the shop catalog. Automatic restoration requires Premium. An unfinished trade is cancelled; completed exchanges remain.")}</p>
    <fieldset data-shop-restoration-condition${!allowed || policy.activation === "manual" ? " disabled" : ""}>${renderConditionMacro("shop-restoration-macro", policy.conditionMacro)}</fieldset>
  </details>`;
}

export function readShopRestorationFields(root, previous) {
  const policy = normalizeShopRestoration(previous), select = root.querySelector('[name="shop-restoration-activation"]');
  if (!select) return policy;
  const allowed = isShopRestorationAvailable();
  // An unlicensed GM may turn automation off, but cannot replace stored Premium preparation.
  const activation = allowed || select.value === "manual" ? select.value : policy.activation;
  const field = root.querySelector('[name="shop-restoration-macro"]');
  return normalizeShopRestoration({ activation, conditionMacro: allowed ? field?.value ?? policy.conditionMacro : policy.conditionMacro });
}

export function bindShopRestorationFields(root, { signal } = {}) {
  const block = root.querySelector("[data-shop-restoration]");
  if (!block) return;
  const select = block.querySelector('[name="shop-restoration-activation"]');
  const sync = () => {
    const allowed = isShopRestorationAvailable();
    for (const option of select.options) option.disabled = option.value !== "manual" && !allowed;
    block.querySelector("[data-shop-restoration-condition]").disabled = !allowed || select.value === "manual";
  };
  select.addEventListener("change", sync, { signal });
  sync();
  const dispose = subscribeShopRestorationAccess(sync);
  signal?.addEventListener("abort", dispose, { once: true });
  return dispose;
}
