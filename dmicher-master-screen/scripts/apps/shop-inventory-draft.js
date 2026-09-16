/** Editing stock is a two-revision draft: preparation and the live inventory.
 * These helpers only handle form state; saving and trade cancellation belong to
 * SceneAssets and the inventory service. UI metadata never enters the catalog. */
const clone = value => structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function shopInventoryEdited(draft) {
  const inventory = draft?._inventory;
  return Boolean(inventory && (inventory.reset || !equal(inventory.items, inventory.baseItems)));
}

export function refreshShopInventoryDraft(draft, snapshot, { preserveInputs = false } = {}) {
  if (!draft) return false;
  if (draft._inventory && (shopInventoryEdited(draft) || draft._inventory.adopt || preserveInputs)) {
    draft._inventory.conflicted = draft._inventory.revision !== snapshot.revision;
    return false;
  }
  draft._inventory = { items: clone(snapshot.items), baseItems: clone(snapshot.items), revision: snapshot.revision, reset: false, adopt: false, conflicted: false };
  return true;
}

export function copyShopInventory(draft, destination) {
  if (!draft?._inventory) return;
  if (destination === "current") {
    draft._inventory.items = clone(draft.items);
    draft._inventory.reset = true;
  } else if (destination === "initial") {
    draft.items = clone(draft._inventory.items);
    draft._inventory.adopt = true;
  }
}

export function shopInventorySaveOptions(draft) {
  if (!shopInventoryEdited(draft)) return draft?._inventory?.adopt ? { expectedInventoryRevision: draft._inventory.revision } : {};
  return { currentItems: clone(draft._inventory.items), expectedInventoryRevision: draft._inventory.revision, resetInventory: draft._inventory.reset };
}

export function shopDraftItems(draft, zone) {
  return zone === "current" ? draft._inventory?.items ?? [] : draft.items;
}
