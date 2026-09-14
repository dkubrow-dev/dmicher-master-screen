/** Select matching navigation rows and their ancestors, never unrelated siblings. */
export function filterNavigationRows(rows, query) {
  const needle = String(query ?? "").normalize("NFC").toLowerCase();
  if (!needle) return new Set(rows.map(row => row.id));
  const byId = new Map(rows.map(row => [row.id, row])), visible = new Set();
  for (const row of rows) {
    if (!String(row.text ?? "").normalize("NFC").toLowerCase().includes(needle)) continue;
    let current = row;
    while (current && !visible.has(current.id)) {
      visible.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  return visible;
}

const rowSelector = '.ms-ide-tree tbody > tr[data-select-kind], .ms-signal-tree details, .ms-ide-list-row[data-select-kind], .ms-ide-block-link';
const foldSelector = '[data-screen-action="foldGroup"], [data-screen-action="foldDialogue"], [data-screen-action="toggleSignalBranch"]';

/** Read only navigation labels, not the forms or all descendants of a branch. */
export function readNavigationRows(root) {
  const elements = [...root.querySelectorAll(rowSelector)], ids = new Map(elements.map((element, index) => [element, index]));
  const tableParents = new Map();
  return elements.map(element => {
    const branch = element.parentElement?.closest("details"), table = element.closest("table");
    let parentId = ids.get(branch);
    if (element.tagName === "TR" && table) {
      const depth = Math.max(1, Number(element.getAttribute("aria-level")) || 1);
      const parents = tableParents.get(table) ?? [];
      parents.length = depth - 1;
      parentId = parents.at(-1) ?? parentId;
      parents[depth - 1] = ids.get(element);
      tableParents.set(table, parents);
    }
    const label = element.tagName === "DETAILS" ? element.querySelector(":scope > summary") : element;
    return { id: ids.get(element), parentId, text: label?.textContent ?? "", element, hidden: element.hidden,
      open: element.tagName === "DETAILS" ? element.open : null };
  });
}

/** Local presentation state: filtering changes no documents and replaces no forms. */
export class NavigationFilter {
  constructor() { this.queries = new Map(); }

  attach(root, key) {
    this.dispose();
    const input = root?.querySelector("[data-main-filter]"), content = root?.querySelector("[data-main-content]");
    if (!input || !content) return;
    const Abort = root.ownerDocument.defaultView.AbortController;
    this.events = new Abort();
    this.input = input; this.content = content; this.key = key;
    this.empty = root.querySelector("[data-main-filter-empty]");
    this.rows = readNavigationRows(content);
    this.folds = [...content.querySelectorAll(foldSelector)].map(button => ({ button, disabled: button.disabled }));
    this.related = [...content.querySelectorAll("[data-filter-related]")].map(element => ({ element, hidden: element.hidden,
      owner: this.rows.find(row => row.element.dataset.selectId === element.dataset.filterRelated)?.id }));
    input.value = this.queries.get(key) ?? "";
    input.addEventListener("input", () => {
      this.queries.set(key, input.value);
      this.apply();
    }, { signal: this.events.signal });
    content.addEventListener("toggle", event => {
      if (input.value && event.target.dataset.mainFilterExpanded && !event.target.open) event.target.open = true;
    }, { signal: this.events.signal, capture: true });
    this.apply();
  }

  apply() {
    const active = Boolean(this.input.value), visible = filterNavigationRows(this.rows, this.input.value);
    if (!this.active) {
      for (const row of this.rows) { row.hidden = row.element.hidden; if (row.open !== null) row.open = row.element.open; }
      for (const entry of this.folds) entry.disabled = entry.button.disabled;
    }
    for (const row of this.rows) {
      const show = visible.has(row.id);
      row.element.dataset.mainFilterRow = "";
      row.element.hidden = active ? !show : row.hidden;
      if (row.open !== null) {
        // Mark forced expansion so it never overwrites the user's fold preference.
        if (active) row.element.dataset.mainFilterExpanded = "true";
        else delete row.element.dataset.mainFilterExpanded;
        row.element.open = active && show ? true : row.open;
      }
    }
    for (const { button, disabled } of this.folds) button.disabled = active || disabled;
    for (const { element, hidden, owner } of this.related) element.hidden = active ? !visible.has(owner) : hidden;
    if (this.empty) this.empty.hidden = !active || !this.rows.length || visible.size > 0;
    this.active = active;
  }

  dispose() {
    this.events?.abort(); this.events = null;
    this.input = null; this.content = null; this.rows = []; this.folds = []; this.related = [];
    this.active = false;
  }
}
