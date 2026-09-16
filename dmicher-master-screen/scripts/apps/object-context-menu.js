import { themedClasses, notifyError } from "../ui.js";

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
        const show = () => {
          submenu.hidden = false; button.setAttribute("aria-expanded", "true");
          submenu.style.left = ""; submenu.style.right = ""; submenu.style.top = "0px";
          let rect = submenu.getBoundingClientRect();
          if (rect.right > view.innerWidth - 4) {
            submenu.style.left = "auto"; submenu.style.right = "calc(100% - 3px)";
            rect = submenu.getBoundingClientRect();
          }
          if (rect.bottom > view.innerHeight - 4) submenu.style.top = `${Math.max(4 - rect.top, view.innerHeight - 4 - rect.bottom)}px`;
        };
        const hide = () => { submenu.hidden=true; button.setAttribute("aria-expanded","false"); };
        group.addEventListener("pointerenter",show,options); group.addEventListener("pointerleave",hide,options);
        button.addEventListener("click",() => { if (submenu.hidden) show(); else hide(); },options);
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
    menu.style.left = `${Math.max(4, Math.min(x, view.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, view.innerHeight - rect.height - 4))}px`;
    menu.querySelector("button")?.focus();
    return true;
  }
  close() {
    this.events?.abort(); this.element?.remove(); this.events = this.element = null;
    this.previousFocus?.focus?.({ preventScroll: true }); this.previousFocus = null;
  }
}
