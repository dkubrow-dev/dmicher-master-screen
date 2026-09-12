export const escapeScriptText = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
const FORMATTING = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "UL", "OL", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "HR", "IMG"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE"]);
const imageSource = (value) => {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try { return ["http:", "https:"].includes(new URL(value, "http://foundry.local/").protocol); } catch { return false; }
};
/** Only text formatting and safe images; no enrichment, inline rolls or executable links. */
export function sanitizeScriptHTML(value) {
  if (!globalThis.DOMParser) return escapeScriptText(value);
  const source = new DOMParser().parseFromString(String(value ?? ""), "text/html");
  const visit = (node) => {
    if (node.nodeType === 3) return source.createTextNode(node.textContent);
    if (node.nodeType !== 1 || DROP.has(node.tagName)) return source.createDocumentFragment();
    const output = FORMATTING.has(node.tagName) ? source.createElement(node.tagName.toLowerCase()) : source.createDocumentFragment();
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (imageSource(src)) output.setAttribute("src", src);
      output.setAttribute("alt", node.getAttribute("alt") ?? "");
      for (const key of ["width", "height"]) if (/^\d{1,4}$/.test(node.getAttribute(key) ?? "")) output.setAttribute(key, node.getAttribute(key));
    }
    for (const child of node.childNodes) output.append(visit(child));
    return output;
  };
  const clean = source.createElement("div");
  for (const node of source.body.childNodes) clean.append(visit(node));
  return clean.innerHTML;
}
