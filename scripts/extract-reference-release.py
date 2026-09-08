"""Inspect public release ZIPs as reference data; never install or run them."""
import argparse
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse


ROOT = Path(__file__).absolute().parent.parent / ".resources" / "competitor-sources"
COLLECTOR = "dmicher-reference-releases"
SCHEMA = 1
MAX_BYTES = 1024 * 1024 * 1024
LICENSE_NAME = re.compile(r"^(licen[cs]e|copying|copyright|notice|unlicense)([._-].*)?$", re.I)
RESERVED = re.compile(r"^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)", re.I)


def no_links(target):
    target = Path(os.path.abspath(target))
    for current in [*reversed(target.parents), target]:
        try:
            info = current.lstat()
        except FileNotFoundError:
            return
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Refusing symlink, junction or reparse point: " + str(current))


def safe(target):
    target = Path(os.path.abspath(target))
    if os.path.commonpath([str(ROOT), str(target)]) != str(ROOT):
        raise ValueError("Path leaves reference directory")
    no_links(target)
    return target


def digest(target):
    hasher = hashlib.sha256()
    with safe(target).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def load_json(target):
    with safe(target).open("r", encoding="utf-8-sig") as stream:
        return json.load(stream)


def save_json(target, data):
    with safe(target).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(data, stream, ensure_ascii=True, indent=2)
        stream.write("\n")


def archive_path(value, directory=False):
    if directory and value.endswith("/"):
        value = value[:-1]
    if not value or "\\" in value or ":" in value or value.startswith("/"):
        raise ValueError("Unsafe archive path: " + repr(value))
    parts = value.split("/")
    for part in parts:
        if (not part or part in (".", "..") or part.casefold() == ".git"
                or part.endswith((" ", ".")) or RESERVED.match(part)
                or any(ord(char) < 32 or char in '<>"|?*' for char in part)):
            raise ValueError("Unsafe archive path: " + repr(value))
    return "/".join(parts)


def inspect_archive(archive, external, expected_version):
    entries = []
    names = {}
    explicit = set()
    total = 0
    manifests = []
    if len(archive.infolist()) > 100_000:
        raise ValueError("Archive contains too many entries")
    for info in archive.infolist():
        if info.orig_filename != info.filename:
            raise ValueError("Truncated or NUL-containing ZIP filename")
        name = archive_path(info.filename, info.is_dir())
        mode = stat.S_IFMT(info.external_attr >> 16)
        if mode not in (0, stat.S_IFREG, stat.S_IFDIR) or info.external_attr & 0x400:
            raise ValueError("Archive contains a symlink, reparse point or special file: " + name)
        if info.flag_bits & 1:
            raise ValueError("Encrypted archive entry: " + name)
        if info.file_size < 0 or info.file_size > MAX_BYTES:
            raise ValueError("Archive entry exceeds size limit")
        total += info.file_size
        if total > MAX_BYTES:
            raise ValueError("Archive exceeds the 1 GiB uncompressed size limit")
        key = name.casefold()
        if key in explicit:
            raise ValueError("Duplicate archive entry: " + name)
        explicit.add(key)
        parts = name.split("/")
        for index in range(1, len(parts) + 1):
            prefix = "/".join(parts[:index])
            prefix_key = prefix.casefold()
            is_directory = index < len(parts) or info.is_dir()
            previous = names.get(prefix_key)
            if previous is not None and previous != (prefix, is_directory):
                raise ValueError("Case collision or file/directory conflict: " + prefix)
            names[prefix_key] = (prefix, is_directory)
        entries.append((info, name))
        if not info.is_dir() and parts[-1].casefold() == "module.json":
            if info.file_size > 8 * 1024 * 1024:
                raise ValueError("Oversized embedded module manifest")
            try:
                value = json.loads(archive.read(info).decode("utf-8-sig"))
            except (ValueError, UnicodeError):
                continue
            if isinstance(value, dict) and (value.get("id") or value.get("name")) == external["id"]:
                manifests.append((name, value))
    if len(manifests) != 1:
        raise ValueError("Expected exactly one embedded manifest matching the external module ID")
    manifest_path, embedded = manifests[0]
    if str(embedded.get("version")) != expected_version:
        raise ValueError("Embedded manifest version does not match the requested version")
    module_root = str(PurePosixPath(manifest_path).parent)
    if module_root == ".":
        module_root = ""
    for field in ("scripts", "esmodules"):
        values = embedded.get(field, [])
        if not isinstance(values, list):
            raise ValueError("Manifest entrypoints must be arrays: " + field)
        for value in values:
            if not isinstance(value, str):
                raise ValueError("Non-string manifest entrypoint")
            local = archive_path(value)
            full = (module_root + "/" if module_root else "") + local
            match = names.get(full.casefold())
            if match != (full, False):
                raise ValueError("Missing or non-file manifest entrypoint: " + full)
    invalid = archive.testzip()
    if invalid is not None:
        raise ValueError("Archive CRC check failed: " + invalid)
    return entries, manifest_path, embedded, module_root


def inventory(source):
    result = []

    def visit(directory):
        for child in sorted(safe(directory).iterdir(), key=lambda item: item.name):
            no_links(child)
            info = child.lstat()
            relative = child.relative_to(source).as_posix()
            archive_path(relative)
            if stat.S_ISDIR(info.st_mode):
                visit(child)
            elif stat.S_ISREG(info.st_mode):
                result.append({"path": relative, "bytes": info.st_size, "sha256": digest(child)})
            else:
                raise ValueError("Unexpected special source file: " + relative)

    visit(source)
    return sorted(result, key=lambda item: item["path"])


def fingerprint(files):
    return hashlib.sha256(json.dumps(files, ensure_ascii=True, separators=(",", ":")).encode("ascii")).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", args.id):
        raise ValueError("Invalid catalog ID")
    if not re.fullmatch(r"[0-9][0-9A-Za-z.+_-]{0,79}", args.version):
        raise ValueError("Invalid release version")
    release = safe(ROOT / args.id / ("release-" + args.version))
    source = safe(release / "source")
    zip_path = safe(release / "module.zip")
    manifest_file = safe(release / "module.json")
    origin_file = safe(release / "origin.json")
    reference_file = safe(release / "release-reference.json")
    files_file = safe(release / "files-sha256.json")
    external = load_json(manifest_file)
    module_id = external.get("id") or external.get("name")
    if not isinstance(module_id, str) or not module_id:
        raise ValueError("External manifest has no module ID")
    external["id"] = module_id
    if str(external.get("version")) != args.version:
        raise ValueError("External manifest version does not match --version")
    origin = load_json(origin_file)
    for field in ("manifestUrl", "downloadUrl"):
        url = urlparse(origin.get(field, ""))
        if url.scheme != "https" or not url.netloc or url.username or url.password:
            raise ValueError("Origin requires a public HTTPS URL: " + field)
    if zip_path.stat().st_size > MAX_BYTES:
        raise ValueError("Archive exceeds 1 GiB")
    hashes = {"archiveSha256": digest(zip_path), "manifestSha256": digest(manifest_file),
              "originSha256": digest(origin_file)}
    with zipfile.ZipFile(zip_path, "r") as archive:
        entries, manifest_path, embedded, module_root = inspect_archive(archive, external, args.version)
        if args.verify:
            reference = load_json(reference_file)
            saved = load_json(files_file)
            if (reference.get("collector") != COLLECTOR or reference.get("schemaVersion") != SCHEMA
                    or reference.get("id") != args.id or reference.get("version") != args.version
                    or saved.get("collector") != COLLECTOR or saved.get("schemaVersion") != SCHEMA
                    or saved.get("id") != args.id or saved.get("version") != args.version):
                raise ValueError("Snapshot metadata is not owned by this helper")
            files = inventory(source)
            if (any(reference.get(key) != value for key, value in hashes.items())
                    or files != saved.get("files") or fingerprint(files) != reference.get("fingerprint")
                    or reference.get("manifestPath") != manifest_path):
                raise ValueError("Archive, manifest, provenance, or extracted snapshot changed")
            print(args.id + ": verified (" + str(len(files)) + " files)")
            return
        if source.exists() or reference_file.exists() or files_file.exists():
            raise ValueError("Snapshot already exists; use --verify. No files were overwritten or deleted.")
        safe(source).mkdir()
        for info, name in entries:
            target = safe(source.joinpath(*name.split("/")))
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            safe(target.parent).mkdir(parents=True, exist_ok=True)
            with archive.open(info, "r") as incoming, safe(target).open("xb") as output:
                for chunk in iter(lambda: incoming.read(1024 * 1024), b""):
                    output.write(chunk)
    files = inventory(source)
    license_files = [item for item in files if LICENSE_NAME.fullmatch(PurePosixPath(item["path"]).name)]
    root_licenses = [item for item in license_files
                     if ("" if str(PurePosixPath(item["path"]).parent) == "."
                         else str(PurePosixPath(item["path"]).parent)) == module_root]
    other_licenses = [item for item in license_files if item not in root_licenses]
    reference = {"collector": COLLECTOR, "schemaVersion": SCHEMA, "id": args.id,
                 "moduleId": module_id, "version": args.version, "origin": origin,
                 "extractedAt": datetime.now(timezone.utc).isoformat(), **hashes,
                 "manifestPath": manifest_path, "moduleRoot": module_root,
                 "compatibility": embedded.get("compatibility"),
                 "entrypoints": {key: embedded.get(key, []) for key in ("scripts", "esmodules")},
                 "fingerprint": fingerprint(files),
                 "counts": {"files": len(files), "bytes": sum(item["bytes"] for item in files)},
                 "licenses": {"root": root_licenses, "other": other_licenses},
                 "readmeFallback": [] if license_files else [item for item in files
                    if re.fullmatch(r"readme([._-].*)?", PurePosixPath(item["path"]).name, re.I)],
                 "usage": "Reference study only. Do not execute, install, vendor, or copy into dmicher modules."}
    save_json(files_file, {"collector": COLLECTOR, "schemaVersion": SCHEMA, "id": args.id,
                         "version": args.version, "fingerprint": fingerprint(files), "files": files})
    save_json(reference_file, reference)
    print(args.id + ": extracted (" + str(len(files)) + " files; CRC and entrypoints verified)")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
