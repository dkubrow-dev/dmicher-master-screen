import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Public reference material is data: never install, build, import, or run it.
const collector = "dmicher-reference-sources";
const schemaVersion = 1;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(projectRoot, ".resources", "competitor-sources");
const args = process.argv.slice(2);
const verify = args.includes("--verify");
let only = null;

function parseArguments() {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verify") continue;
    if (args[i] === "--only" && args[i + 1]) {
      only = new Set(args[++i].split(","));
      for (const id of only) validateId(id);
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
}

function validateId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) {
    throw new Error(`Invalid reference ID: ${JSON.stringify(id)}`);
  }
}

function validateRepository(repository) {
  if (repository === null) return;
  if (typeof repository !== "string"
      || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(repository)) {
    throw new Error(`Only public HTTPS GitHub repository URLs are supported: ${JSON.stringify(repository)}`);
  }
  const url = new URL(repository);
  const components = url.pathname.replace(/\/$/, "").split("/").slice(1);
  if (components.some(part => part === "." || part === ".." || part.startsWith("-"))) {
    throw new Error("Unsafe repository path");
  }
}

function within(base, target) {
  const relative = path.relative(base, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path leaves the reference directory: ${target}`);
  }
}

async function exists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function assertNoLinks(target) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink or junction: ${current}`);
  }
}

async function safeDirectory(target) {
  within(root, target);
  await assertNoLinks(target);
  await fs.mkdir(target, { recursive: true });
  await assertNoLinks(target);
}

async function readJson(target) {
  within(root, target);
  await assertNoLinks(target);
  return JSON.parse(await fs.readFile(target, "utf8"));
}

async function writeJson(target, data, exclusive = false) {
  within(root, target);
  await assertNoLinks(target);
  await fs.writeFile(target, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8", flag: exclusive ? "wx" : "w"
  });
}

function gitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase().startsWith("GIT_")) delete env[key];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(root, ".disabled-global-git-config"),
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1"
  };
}

async function git(cwd, command) {
  within(root, cwd);
  await assertNoLinks(cwd);
  const hooks = path.join(root, ".disabled-git-hooks");
  const globalConfig = path.join(root, ".disabled-global-git-config");
  if (await exists(hooks) || await exists(globalConfig)) {
    throw new Error("Reserved disabled Git configuration paths must not exist");
  }
  const config = [
    "-c", "http.sslBackend=openssl", "-c", "http.sslVerify=true",
    "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
    "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never",
    "-c", `core.hooksPath=${hooks}`, "-c", "core.symlinks=false",
    "-c", "credential.helper=", "-c", "submodule.recurse=false",
    "-c", "core.fsmonitor=false"
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...config, ...command], {
      cwd, env: gitEnvironment(), shell: false, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300_000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-12_000); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(timedOut ? "Git exceeded the five minute limit" : `Git exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function sha256File(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

function fingerprint(files) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

async function inspectSource(source) {
  const files = [];
  const manifests = [];
  async function visit(directory, relative = "") {
    await assertNoLinks(directory);
    const children = await fs.readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const child of children) {
      if (relative === "" && child.name === ".git") continue;
      const file = path.join(directory, child.name);
      const local = relative ? `${relative}/${child.name}` : child.name;
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error(`Refusing source symlink or junction: ${local}`);
      if (stat.isDirectory()) { await visit(file, local); continue; }
      if (!stat.isFile()) throw new Error(`Refusing special source file: ${local}`);
      files.push({ path: local, bytes: stat.size, sha256: await sha256File(file) });
      if (child.name.toLowerCase() === "module.json") {
        try {
          if (stat.size > 8 * 1024 * 1024) throw new Error("Manifest exceeds 8 MiB");
          const manifest = JSON.parse(await fs.readFile(file, "utf8"));
          manifests.push({ path: local, id: manifest.id ?? manifest.name ?? null,
            version: manifest.version ?? null, title: manifest.title ?? null,
            compatibility: manifest.compatibility ?? null });
        } catch (error) { manifests.push({ path: local, parseError: error.message }); }
      }
    }
  }
  await visit(source);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const licenseFiles = files.filter(file => /^(licen[cs]e|copying|copyright|notice|unlicense)([._-].*)?$/i.test(path.posix.basename(file.path)));
  const readmes = files.filter(file => /^readme([._-].*)?$/i.test(path.posix.basename(file.path)));
  const licenses = (licenseFiles.length ? licenseFiles : readmes).map(file => ({
    ...file, kind: licenseFiles.length ? "license-or-notice" : "readme-fallback"
  }));
  const counts = {
    files: files.length,
    codeFiles: files.filter(file => /\.(?:[cm]?js|[cm]?ts|tsx|jsx|css|scss|sass|less|html?|hbs|handlebars|vue|svelte|py|cs|m?java|go|rs|lua|php|rb)$/i.test(file.path)).length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0)
  };
  return { files, fingerprint: fingerprint(files), manifests, licenses, counts };
}

async function gitIdentity(source) {
  await assertNoLinks(path.join(source, ".git"));
  const [commit, tree, branch, origin, shallow] = await Promise.all([
    git(source, ["rev-parse", "HEAD"]), git(source, ["rev-parse", "HEAD^{tree}"]),
    git(source, ["symbolic-ref", "--short", "HEAD"]),
    git(source, ["remote", "get-url", "origin"]),
    git(source, ["rev-parse", "--is-shallow-repository"])
  ]);
  if (!/^[a-f0-9]{40,64}$/.test(commit) || !/^[a-f0-9]{40,64}$/.test(tree)) {
    throw new Error("Unexpected Git object ID");
  }
  return { commit, tree, branch, origin, shallow: shallow === "true" };
}

function assertOwned(metadata, entry) {
  if (metadata.collector !== collector || metadata.schemaVersion !== schemaVersion
      || metadata.id !== entry.id || metadata.repository !== entry.repository) {
    throw new Error("Existing snapshot is not owned by this collector or belongs to another repository");
  }
}

async function collect(entry) {
  const directory = path.join(root, entry.id);
  const source = path.join(directory, "source");
  const referencePath = path.join(directory, "reference.json");
  const filesPath = path.join(directory, "files-sha256.json");
  await assertNoLinks(directory);
  const hasSource = await exists(source);
  const hasReference = await exists(referencePath);
  const base = { collector, schemaVersion, ...entry };
  if (entry.repository === null) {
    if (hasSource) throw new Error("A documentation-only entry unexpectedly has a source directory");
    if (hasReference) {
      const previous = await readJson(referencePath);
      assertOwned(previous, entry);
      if (previous.status !== "public-docs-only") throw new Error("Unexpected documentation-only status");
      return { ...previous, verification: "verified", checkedAt: new Date().toISOString() };
    }
    if (verify) throw new Error("Documentation-only metadata has not been collected yet");
    await safeDirectory(directory);
    const metadata = { ...base, status: "public-docs-only", downloadedAt: null,
      recordedAt: new Date().toISOString(), reason: entry.availabilityNote || "No public repository was identified" };
    await writeJson(referencePath, metadata, true);
    return metadata;
  }
  if (hasSource !== hasReference) {
    throw new Error("Incomplete or unowned snapshot; preserve it and inspect manually (no overwrite or deletion)");
  }
  if (hasSource) {
    const metadata = await readJson(referencePath);
    assertOwned(metadata, entry);
    const savedInventory = await readJson(filesPath);
    if (savedInventory.collector !== collector || savedInventory.schemaVersion !== schemaVersion
        || savedInventory.id !== entry.id || !Array.isArray(savedInventory.files)) {
      throw new Error("Missing or unowned file inventory");
    }
    const [current, identity] = await Promise.all([inspectSource(source), gitIdentity(source)]);
    if (fingerprint(savedInventory.files) !== metadata.fingerprint
        || current.fingerprint !== metadata.fingerprint
        || ["commit", "tree", "branch", "origin"].some(key => identity[key] !== metadata.git[key])) {
      throw new Error("Snapshot or Git identity changed; preserve it for manual inspection");
    }
    return { ...metadata, verification: "verified", checkedAt: new Date().toISOString() };
  }
  if (verify) throw new Error("Source snapshot has not been downloaded yet");
  await safeDirectory(directory);
  if (await exists(filesPath)) throw new Error("Orphaned file inventory must be inspected manually");
  within(root, source);
  await assertNoLinks(source);
  await git(directory, ["clone", "--depth", "1", "--single-branch", "--no-recurse-submodules",
    "--", entry.repository, source]);
  const [snapshot, identity] = await Promise.all([inspectSource(source), gitIdentity(source)]);
  if (identity.origin !== entry.repository) throw new Error("Cloned repository origin does not match the catalog");
  const metadata = { ...base, status: "source-collected", downloadedAt: new Date().toISOString(),
    git: identity, fingerprint: snapshot.fingerprint, manifests: snapshot.manifests,
    licenses: snapshot.licenses, counts: snapshot.counts,
    submodules: "not downloaded", lfs: "pointer files only; no LFS fetch",
    usage: "Reference study only. Do not execute, vendor, or copy into dmicher modules." };
  await writeJson(filesPath, { collector, schemaVersion, id: entry.id,
    fingerprint: snapshot.fingerprint, files: snapshot.files }, true);
  await writeJson(referencePath, metadata, true);
  return metadata;
}

async function main() {
  parseArguments();
  await assertNoLinks(root);
  const catalog = await readJson(path.join(root, "catalog.json"));
  if (!Array.isArray(catalog.entries) || !catalog.entries.length) throw new Error("Catalog has no entries");
  const ids = new Set();
  for (const entry of catalog.entries) {
    validateId(entry.id);
    validateRepository(entry.repository);
    if (ids.has(entry.id)) throw new Error(`Duplicate reference ID: ${entry.id}`);
    ids.add(entry.id);
  }
  if (only) for (const id of only) if (!ids.has(id)) throw new Error(`Unknown reference ID: ${id}`);
  const inventoryPath = path.join(root, "inventory.json");
  let previous = { entries: [] };
  if (await exists(inventoryPath)) {
    previous = await readJson(inventoryPath);
    if (previous.collector !== collector || previous.schemaVersion !== schemaVersion || !Array.isArray(previous.entries)) {
      throw new Error("Refusing to overwrite an inventory owned by another tool");
    }
  }
  const results = new Map(previous.entries.map(entry => [entry.id, entry]));
  const entries = catalog.entries.filter(entry => !only || only.has(entry.id));
  let next = 0;
  let failures = 0;
  async function worker() {
    while (next < entries.length) {
      const entry = entries[next++];
      try {
        const result = await collect(entry);
        results.set(entry.id, result);
        console.log(`${entry.id}: ${result.verification || result.status}${result.counts ? ` (${result.counts.files} files, ${result.counts.bytes} bytes)` : ""}`);
      } catch (error) {
        failures++;
        results.set(entry.id, { id: entry.id, name: entry.name, repository: entry.repository,
          status: "error", error: error.message, checkedAt: new Date().toISOString() });
        console.error(`${entry.id}: ERROR ${JSON.stringify(error.message)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));
  const ordered = catalog.entries.map(entry => results.get(entry.id) || {
    id: entry.id, name: entry.name, repository: entry.repository, status: "not-collected"
  });
  await writeJson(inventoryPath, { collector, schemaVersion, checkedAt: new Date().toISOString(),
    mode: verify ? "offline-verify" : "collect-or-verify", selection: only ? [...only] : "all",
    errors: ordered.filter(entry => entry.status === "error").length, entries: ordered });
  console.log(`Completed: ${entries.length - failures}/${entries.length}; inventory: ${inventoryPath}`);
  if (failures) process.exitCode = 1;
}

if (args.includes("--help")) {
  console.log("Usage: node scripts/collect-reference-sources.mjs [--only id1,id2] [--verify]");
  console.log("Reads .resources/competitor-sources/catalog.json; preserves existing snapshots.");
  console.log("--verify: offline verification only; updates the aggregate inventory report.");
} else {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
