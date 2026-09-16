import { themedClasses, notifyError } from "../ui.js";

const EDGE = 4;
const OVERLAP = 3;
const BRANCH_DELAY = 250;
const clamp = (position, size, limit) => Math.max(EDGE, Math.min(position, limit - size - EDGE));

/** Each level has its own viewport position and scroll area. A fixed descendant
 * stays outside the parent's overflow clip, while DOM ancestry preserves pointer
 * containment, keyboard events and outside-click handling for the whole menu. */
function positionSubmenu(submenu, group, view, preferred = "right") {
  const anchor = group.getBoundingClientRect();
  const rect = submenu.getBoundingClientRect();
  const positions = { right: anchor.right - OVERLAP, left: anchor.left - rect.width + OVERLAP };
  let direction = preferred;
  if (positions[direction] < EDGE || positions[direction] + rect.width > view.innerWidth - EDGE) direction = direction === "right" ? "left" : "right";
  submenu.dataset.menuDirection = direction;
  submenu.style.left = `${clamp(positions[direction], rect.width, view.innerWidth)}px`;
  submenu.style.top = `${clamp(anchor.top, rect.height, view.innerHeight)}px`;
}

/** The same transient menu serves constructor tools and permitted player actions. */
export class ObjectContextMenu {
  open(items, { x = 0, y = 0 } = {}) {
    this.close();
    if (!items.length) return false;
    const document = globalThis.document, view = document.defaultView;
    this.previousFocus = document.activeElement;
    const menu = document.createElement("div");
    menu.className = themedClasses("ms-object-menu").join(" ");
    menu.setAttribute("role", "menu");
    const events = new view.AbortController(); this.events = events; this.element = menu;
    const options = { signal: events.signal };
    const branches = [];
    const cancelBranchTimer = branch => {
      if (branch.timer !== undefined) view.clearTimeout(branch.timer);
      branch.timer = undefined;
    };
    const deferBranch = (branch, callback) => {
      cancelBranchTimer(branch);
      branch.timer = view.setTimeout(() => { branch.timer = undefined; callback(); }, BRANCH_DELAY);
    };
    events.signal.addEventListener("abort", () => branches.forEach(cancelBranchTimer), { once: true });
    const hideBranch = branch => {
      for (const entry of branches) if (entry === branch || branch.submenu.contains(entry.group)) {
        cancelBranchTimer(entry);
        entry.submenu.hidden = true;
        entry.button.setAttribute("aria-expanded", "false");
      }
    };
    const closeChildren = panel => {
      for (const branch of branches) if (branch.parent === panel) hideBranch(branch);
    };
    const appendItems = (items, parent) => { for (const item of items) {
      if (item.heading) {
        const heading = document.createElement("div");
        heading.className = "ms-object-menu-heading"; heading.setAttribute("role", "presentation"); heading.textContent = item.heading;
        parent.append(heading); continue;
      }
      const button = document.createElement("button");
      button.type = "button"; button.setAttribute("role", "menuitem"); button.textContent = `${item.icon ? `${item.icon} ` : ""}${item.label}`;
      button.disabled = item.disabled === true;
      if (item.gmOnly) button.classList.add("ms-menu-gm");
      if (item.reason) button.title = item.reason;
      if (item.children?.length) {
        const group = document.createElement("div"), submenu = document.createElement("div");
        group.className = "ms-object-menu-group"; submenu.className = "ms-object-submenu"; submenu.setAttribute("role","menu"); submenu.hidden = true;
        button.setAttribute("aria-haspopup","menu"); button.setAttribute("aria-expanded","false");
        const branch = { parent, group, submenu, button };
        branches.push(branch);
        const show = () => {
          cancelBranchTimer(branch);
          if (button.disabled) return;
          for (const sibling of branches) if (sibling.parent === parent && sibling !== branch) hideBranch(sibling);
          submenu.hidden = false; button.setAttribute("aria-expanded", "true");
          positionSubmenu(submenu, group, view, parent.dataset.menuDirection);
        };
        const hide = () => hideBranch(branch);
        group.addEventListener("pointerenter", () => {
          cancelBranchTimer(branch);
          const switching = submenu.hidden && branches.some(sibling => sibling.parent === parent && sibling !== branch && !sibling.submenu.hidden);
          if (switching) deferBranch(branch, show); else show();
        }, options);
        group.addEventListener("pointerleave", () => {
          cancelBranchTimer(branch);
          // A diagonal path may briefly cross a neighbouring root row before
          // entering the flyout. Let pointerenter cancel this pending closure.
          if (!submenu.hidden) deferBranch(branch, hide);
        }, options);
        // Hover may already have opened the branch before the click arrives.
        button.addEventListener("click",show,options);
        submenu.addEventListener("scroll", () => closeChildren(submenu), options);
        button.addEventListener("keydown",event => { if(event.key === "ArrowRight") { event.preventDefault(); show(); submenu.querySelector("button:not(:disabled)")?.focus(); } },options);
        submenu.addEventListener("keydown", event => {
          if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); hide(); button.focus(); }
        }, options);
        appendItems(item.children,submenu); group.append(button,submenu); parent.append(group); continue;
      }
      button.addEventListener("click", () => {
        this.close();
        void Promise.resolve().then(item.action).catch(notifyError);
      }, options);
      parent.append(button);
    } };
    appendItems(items,menu);
    menu.addEventListener("scroll", () => closeChildren(menu), options);
    menu.addEventListener("pointerdown", (event) => event.stopPropagation(), options);
    menu.addEventListener("keydown", (event) => {
      const buttons = [...menu.querySelectorAll("button:not(:disabled)")].filter(button => !button.closest("[hidden]")), index = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[target]?.focus();
      }
      if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); this.close(); }
    }, options);
    document.addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) this.close(); }, options);
    view.addEventListener("resize", () => this.close(), options);
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${clamp(x, rect.width, view.innerWidth)}px`;
    menu.style.top = `${clamp(y, rect.height, view.innerHeight)}px`;
    menu.querySelector("button")?.focus();
    return true;
  }
  close() {
    this.events?.abort(); this.element?.remove(); this.events = this.element = null;
    this.previousFocus?.focus?.({ preventScroll: true }); this.previousFocus = null;
  }
}
