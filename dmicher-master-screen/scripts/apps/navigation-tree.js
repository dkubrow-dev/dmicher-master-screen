export const MAIN_MENU = Object.freeze([
  { id: "scene", label: "Сцена" },
  { id: "tools", label: "Инструменты", children: [{ id: "shops", label: "Магазины" }, { id: "dialogues", label: "Диалоги" }] },
  { id: "automation", label: "Автоматизация", children: [{ id: "events", label: "События" }, { id: "macros", label: "Макросы" }, { id: "sources", label: "Источники" }] },
  { id: "other", label: "Иное" }
]);
export const DETAIL_MENU = Object.freeze([{ id: "parameters", label: "Параметры" }, { id: "reference", label: "Подсказка" }]);
export const leaves = (nodes) => nodes.flatMap((node) => node.children ? leaves(node.children) : [node.id]);
export function menuPath(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return [node];
    const child = node.children && menuPath(node.children, id);
    if (child?.length) return [node, ...child];
  }
  return [];
}
export const menuNode = (nodes, id) => menuPath(nodes, id).at(-1);
export const menuParent = (id, nodes = MAIN_MENU) => menuPath(nodes, id).at(-2)?.id ?? null;
export function menuRows(nodes, hidden = [], depth = 0) {
  return nodes.flatMap((node) => {
    const ids = leaves([node]), count = ids.filter((id) => !hidden.includes(id)).length;
    return [{ ...node, depth, category: Boolean(node.children), checked: count === ids.length, partial: count > 0 && count < ids.length, visible: count > 0 }, ...(node.children ? menuRows(node.children, hidden, depth + 1) : [])];
  });
}
export function toggleMenuNode(nodes, hidden, id, visible) {
  const node = menuNode(nodes, id); if (!node) return null;
  const result = new Set(hidden);
  for (const leaf of leaves([node])) if (visible) result.delete(leaf); else result.add(leaf);
  if (leaves(nodes).every((leaf) => result.has(leaf))) return null;
  return [...result];
}
