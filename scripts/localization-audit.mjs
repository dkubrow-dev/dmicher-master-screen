import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { MESSAGE_TRANSLATIONS } from "../dmicher-master-screen/scripts/message-translations.js";

// Read-only source audit using the parser already installed for browser checks.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const parserPath = process.env.DMICHER_BABEL_BUNDLE
  ?? "C:/Users/dscherkasov/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/lib/transform/babelBundle.js";
const { babelParse } = require(parserPath);
const cyrillic = /[\u0400-\u04ff]/u;
// These explicit bilingual data structures are checked by localization.test.js.
const bilingualData = new Set(["help-content.js", "object-help-content.js", "object-descriptions.js", "builtin-signals.js", "script-action-labels.js"]);
const files = (directory, extension) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
  ? files(path.join(directory, entry.name), extension) : entry.name.endsWith(extension) ? [path.join(directory, entry.name)] : []);
const scripts = files(path.join(root, "dmicher-master-screen/scripts"), ".js");
const results = [], usedMessages = new Set();
const report = (file, node, key, reason) => results.push({ file: path.relative(root, file).replaceAll("\\", "/"), line: node.loc?.start.line, key, reason });
for (const file of scripts) {
  if (["localization.js", "message-translations.js"].includes(path.basename(file))) continue;
  const source = fs.readFileSync(file, "utf8");
  const ast = babelParse(source, file, true);
  const translationImports = ast.program.body.filter((node) => node.type === "ImportDeclaration" && node.source.value.endsWith("/localization.js"))
    .flatMap((node) => node.specifiers.filter((specifier) => ["text", "message"].includes(specifier.imported?.name)).map((specifier) => specifier.local.name));
  function visit(node, ancestors = []) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee?.name === "localizedMessage") {
      const key = node.arguments[0]?.value;
      usedMessages.add(key);
      if (typeof key !== "string" || !Object.hasOwn(MESSAGE_TRANSLATIONS, key)) report(file, node, key, "Missing message translation");
      const placeholders = [...String(key).matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
      if (placeholders.length && (node.arguments[1]?.elements?.length ?? 0) <= Math.max(...placeholders)) report(file, node, key, "Missing message values");
    }
    if (node.type === "StringLiteral" || node.type === "TemplateLiteral") {
      const parts = node.type === "StringLiteral" ? [node.value] : node.quasis.map((entry) => entry.value.cooked ?? entry.value.raw);
      if (!bilingualData.has(path.basename(file)) && parts.some((part) => cyrillic.test(part))) {
        const pairedCall = ancestors.some((parent) => ["CallExpression", "OptionalCallExpression"].includes(parent.type)
          && translationImports.includes(parent.callee?.name));
        const objectRu = ancestors.some((parent) => parent.type === "ObjectProperty" && ["ru", "bodyRu"].includes(parent.key?.name ?? parent.key?.value));
        const menuPair = ancestors.some((parent) => parent.type === "ObjectExpression" && parent.properties?.some((property) => property.key?.name === "labelEn"));
        const conditional = ancestors.some((parent) => parent.type === "ConditionalExpression"
          && /(?:\bru\b|startsWith\(["']ru["']\))/.test(source.slice(parent.test.start, parent.test.end)));
        if (!pairedCall && !objectRu && !menuPair && !conditional) report(file, node,
          parts.map((part, index) => part + (index < parts.length - 1 ? `{${index}}` : "")).join(""), "Unpaired Russian text");
      }
      if (node.type === "TemplateLiteral") for (const expression of node.expressions) visit(expression, [...ancestors, node]);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "comments", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, [...ancestors, node]));
      else if (value?.type) visit(value, [...ancestors, node]);
    }
  }
  visit(ast);
}
for (const key of Object.keys(MESSAGE_TRANSLATIONS)) if (!usedMessages.has(key)) results.push({ file: "dmicher-master-screen/scripts/message-translations.js", key, reason: "Unused translation" });

const hbsPath = process.env.DMICHER_HANDLEBARS_PATH ?? "E:/Foundry Portable/Foundry VTT 14.366/App/resources/app/node_modules/handlebars";
const handlebars = require(hbsPath);
const templates = files(path.join(root, "dmicher-master-screen/templates"), ".hbs");
for (const file of templates) {
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "ContentStatement" && cyrillic.test(node.value)) report(file, node, node.value, "Untranslated template content");
    if (["MustacheStatement", "SubExpression"].includes(node.type) && node.path?.original === "dmicherScreenText"
      && (node.params.length !== 2 || node.params.some((parameter) => parameter.type !== "StringLiteral" || !parameter.value))) report(file, node, "dmicherScreenText", "Expected a nonempty RU/EN pair");
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  };
  visit(handlebars.parse(fs.readFileSync(file, "utf8")));
}

if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
else {
  for (const entry of results) console.log(`${entry.file}:${entry.line ?? ""} ${entry.reason}: ${entry.key}`);
  console.log(`${scripts.length} scripts, ${templates.length} templates, ${usedMessages.size} message keys; ${results.length} findings.`);
}
if (process.argv.includes("--check") && results.length) process.exitCode = 1;
