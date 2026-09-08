import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createZip, readZip } from "./zip.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const moduleId = "dmicher-master-screen";
const source = path.join(repo, moduleId);
const manifestBytes = fs.readFileSync(path.join(source, "module.json"));
const manifest = JSON.parse(manifestBytes);
const version = manifest.version;
assert.equal(manifest.id, moduleId);
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.compatibility.minimum, "13");
assert.equal(manifest.compatibility.verified, "14");
const releaseRoot = "https://github.com/dkubrow-dev/" + moduleId + "/releases/";
assert.equal(manifest.manifest, releaseRoot + "download/" + version + "/module.json", "Manifest URL must identify this exact release");
assert.equal(manifest.download, releaseRoot + "download/" + version + "/" + moduleId + "-" + version + ".zip", "Download URL must identify this exact release");
assert.equal(manifest.changelog, releaseRoot + "tag/" + version);
const dependency = JSON.parse(fs.readFileSync(path.resolve(repo, "..", "dmicher-generics", "dmicher-generics", "module.json")));
assert.deepEqual(manifest.relationships?.requires, [{
  id: dependency.id, type: "module",
  compatibility: { minimum: dependency.version, verified: dependency.version }, manifest: dependency.manifest
}], "The only required module must be the exact tested Generics release");
assert.equal(dependency.id, "dmicher-generics");
const output = path.resolve(repo, "..", "artifacts", moduleId, version);
const archiveName = moduleId + "-" + version + ".zip";
const targets = [
  "C:/Users/dscherkasov/AppData/Local/FoundryVTT/Data/modules/dmicher-master-screen",
  "E:/Foundry Portable/Foundry VTT 13.351/Data/modules/dmicher-master-screen",
  "E:/Foundry Portable/Foundry VTT 14.366/Data/modules/dmicher-master-screen"
].map(target => path.resolve(target));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  try { fs.writeFileSync(temporary, bytes, { flag: "wx" }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function json(file, value) { writeAtomic(file, JSON.stringify(value, null, 2) + "\n"); }
function files(directory, prefix = "") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name, absolute = path.join(directory, entry.name);
    assert.ok(!fs.lstatSync(absolute).isSymbolicLink(), "Links are not allowed: " + absolute);
    return entry.isDirectory() ? files(absolute, name + "/") : [name];
  }).sort();
}
function snapshot(directory) {
  return files(directory).map(name => ({ name, sha256: digest(fs.readFileSync(path.join(directory, name))) }));
}
function sourceSnapshot() {
  const result = snapshot(source);
  for (const file of result) {
    assert.ok(!file.name.split("/").some(part => part.startsWith(".") || ["node_modules", "tests"].includes(part)),
      "Development or hidden file in module: " + file.name);
    assert.ok(!/\.(sqlite3?|db|wal|shm|key|pfx|pem)$/i.test(file.name), "Private data in module: " + file.name);
  }
  const names = new Set(result.map(file => file.name));
  for (const entry of [...manifest.esmodules, ...manifest.styles]) assert.ok(names.has(entry), "Missing manifest entry point: " + entry);
  assert.match(fs.readFileSync(path.join(source, "scripts/model.js"), "utf8"),
    new RegExp('export const VERSION = "' + version.replaceAll(".", "\\.") + '"'), "Runtime version differs from manifest");
  return result;
}
function samePath(left, right) {
  const normalize = value => path.resolve(value).replaceAll("\\", "/").toLowerCase();
  return normalize(left) === normalize(right);
}
function checkedTarget(target) {
  assert.ok(targets.some(allowed => samePath(allowed, target)), "Unapproved deployment target");
  assert.equal(path.basename(target), moduleId);
  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    assert.notEqual(parent, ancestor, "No deployment parent exists");
    ancestor = parent;
  }
  assert.ok(samePath(fs.realpathSync(ancestor), ancestor), "Deployment path uses a link or junction: " + ancestor);
  if (fs.existsSync(target)) files(target); // Reject nested links before applying any mutations.
  return target;
}
function deploymentPlan() {
  const sourceFiles = sourceSnapshot();
  return {
    moduleId, version, source: path.resolve(source), sourceFiles,
    targets: targets.map(target => {
      checkedTarget(target);
      const existing = snapshot(target), current = new Map(existing.map(file => [file.name, file.sha256]));
      const wanted = new Set(sourceFiles.map(file => file.name));
      return {
        path: target, existing,
        copy: sourceFiles.filter(file => current.get(file.name) !== file.sha256).map(file => file.name),
        remove: existing.filter(file => !wanted.has(file.name)).map(file => file.name)
      };
    })
  };
}
function verifyInstalled(expected) {
  for (const target of targets) {
    checkedTarget(target);
    assert.deepEqual(snapshot(target), expected, "Installed file list/content mismatch: " + target);
    console.log("Verified " + expected.length + " files: " + target);
  }
}
function verifyArchive() {
  const archive = fs.readFileSync(path.join(output, archiveName));
  const entries = readZip(archive), expected = sourceSnapshot();
  assert.deepEqual(entries.get("module.json"), manifestBytes, "ZIP manifest differs from source manifest");
  assert.deepEqual([...entries.keys()].sort(), expected.map(file => file.name), "ZIP must contain only module files at its root");
  for (const file of expected) assert.equal(digest(entries.get(file.name)), file.sha256, "ZIP content mismatch: " + file.name);
  assert.deepEqual(fs.readFileSync(path.join(output, "module.json")), manifestBytes, "Published manifest mismatch");
  const notesName = "RELEASE-NOTES-" + version + ".md";
  assert.deepEqual(fs.readFileSync(path.join(output, notesName)), fs.readFileSync(path.join(repo, notesName)), "Release notes mismatch");
  return { expected, moduleId, version, archive: archiveName, bytes: archive.length, sha256: digest(archive) };
}
function build() {
  const expected = sourceSnapshot();
  const archive = createZip(expected.map(file => [file.name, fs.readFileSync(path.join(source, file.name))]));
  const entries = readZip(archive);
  for (const file of expected) assert.equal(digest(entries.get(file.name)), file.sha256);
  const notesName = "RELEASE-NOTES-" + version + ".md", notes = fs.readFileSync(path.join(repo, notesName));
  writeAtomic(path.join(output, archiveName), archive);
  writeAtomic(path.join(output, "module.json"), manifestBytes);
  writeAtomic(path.join(output, notesName), notes);
  const verified = verifyArchive();
  json(path.join(output, "release-report.json"), { createdUtc: new Date().toISOString(), ...verified });
  console.log(JSON.stringify({ output, files: expected.length, bytes: verified.bytes, sha256: verified.sha256 }, null, 2));
}

const command = process.argv[2] ?? "--help";
switch (command) {
  case "build": build(); break;
  case "dry-run": {
    const plan = deploymentPlan();
    json(path.join(output, "deploy-plan.json"), { createdUtc: new Date().toISOString(), plan, sha256: digest(JSON.stringify(plan)) });
    for (const target of plan.targets) console.log(JSON.stringify({ target: target.path, copy: target.copy, remove: target.remove }, null, 2));
    console.log("Dry run saved. Inspect the exact targets and removals before running npm run deploy.");
    break;
  }
  case "deploy": {
    const saved = JSON.parse(fs.readFileSync(path.join(output, "deploy-plan.json"), "utf8"));
    const plan = deploymentPlan();
    assert.equal(saved.sha256, digest(JSON.stringify(saved.plan)), "Deployment plan was modified");
    assert.deepEqual(plan, saved.plan, "Deployment plan is stale; run and inspect deploy:dry-run again");
    for (const target of plan.targets) {
      checkedTarget(target.path);
      fs.mkdirSync(target.path, { recursive: true });
      for (const name of target.copy) {
        const destination = path.resolve(target.path, name);
        assert.ok(destination.startsWith(target.path + path.sep), "Deployment path escaped target");
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(source, name), destination);
      }
      for (const name of target.remove) {
        const destination = path.resolve(target.path, name);
        assert.ok(destination.startsWith(target.path + path.sep), "Removal path escaped target");
        fs.unlinkSync(destination); // Remove checked files only; never delete a target tree.
      }
    }
    verifyInstalled(plan.sourceFiles);
    json(path.join(output, "deployment-report.json"), { completedUtc: new Date().toISOString(), moduleId, version, targets, files: plan.sourceFiles });
    break;
  }
  case "verify": {
    const result = verifyArchive();
    verifyInstalled(result.expected);
    json(path.join(output, "verification-report.json"), { verifiedUtc: new Date().toISOString(), ...result, targets });
    console.log("Release " + version + ": " + result.expected.length + " files, SHA256 " + result.sha256);
    break;
  }
  case "--help": console.log("Usage: node scripts/release.mjs build|dry-run|deploy|verify\nArtifacts: " + output); break;
  default: throw new Error("Unknown release command: " + command);
}
