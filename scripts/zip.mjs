import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validName(name) {
  assert.ok(name && !name.startsWith("/") && !name.includes("\\") && !name.includes(":")
    && !name.split("/").some(part => !part || part === "." || part === ".."), "Unsafe ZIP entry: " + name);
}

export function createZip(entries) {
  assert.ok(entries.length < 65535, "ZIP64 is not supported");
  const names = new Set(), local = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    validName(name);
    assert.ok(!names.has(name), "Duplicate ZIP entry: " + name); names.add(name);
    const encoded = Buffer.from(name, "utf8"), compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    assert.ok(encoded.length <= 65535 && data.length <= 0xffffffff && compressed.length <= 0xffffffff);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // Deterministic DOS date: 1980-01-01.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(encoded.length, 26);
    local.push(header, encoded, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(encoded.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, encoded);
    offset += header.length + encoded.length + compressed.length;
    assert.ok(offset <= 0xffffffff, "ZIP64 is not supported");
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function readZip(archive) {
  assert.ok(archive.length >= 22, "Truncated ZIP");
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50, "ZIP end record");
  assert.equal(archive.readUInt16LE(end + 20), 0, "Unexpected ZIP comment");
  assert.equal(archive.readUInt16LE(end + 4), 0, "Multi-volume ZIP is not supported");
  assert.equal(archive.readUInt16LE(end + 6), 0, "Multi-volume ZIP is not supported");
  const count = archive.readUInt16LE(end + 10), entries = new Map();
  assert.equal(archive.readUInt16LE(end + 8), count);
  let cursor = archive.readUInt32LE(end + 16), nextLocal = 0;
  assert.equal(cursor + archive.readUInt32LE(end + 12), end, "ZIP directory boundary");
  const directoryStart = cursor;
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50, "ZIP directory header");
    const method = archive.readUInt16LE(cursor + 10), size = archive.readUInt32LE(cursor + 20);
    const rawSize = archive.readUInt32LE(cursor + 24), nameLength = archive.readUInt16LE(cursor + 28);
    const name = archive.toString("utf8", cursor + 46, cursor + 46 + nameLength), local = archive.readUInt32LE(cursor + 42);
    validName(name); assert.ok(!entries.has(name), "Duplicate ZIP entry: " + name);
    assert.equal(local, nextLocal, "ZIP local record boundary"); assert.equal(archive.readUInt32LE(local), 0x04034b50);
    assert.equal(archive.readUInt16LE(local + 6), 0x800); assert.equal(archive.readUInt16LE(cursor + 8), 0x800);
    assert.equal(archive.readUInt16LE(local + 8), method); assert.equal(archive.readUInt32LE(local + 18), size);
    assert.equal(archive.readUInt32LE(local + 22), rawSize);
    assert.equal(archive.toString("utf8", local + 30, local + 30 + archive.readUInt16LE(local + 26)), name);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    nextLocal = start + size; assert.ok(nextLocal <= directoryStart, "ZIP payload boundary");
    assert.ok([0, 8].includes(method), "Unsupported compression");
    const compressed = archive.subarray(start, nextLocal);
    const data = method === 8 ? inflateRawSync(compressed, { maxOutputLength: Math.max(1, rawSize) }) : compressed;
    assert.equal(data.length, rawSize, "ZIP uncompressed size"); assert.equal(crc32(data), archive.readUInt32LE(cursor + 16), "ZIP CRC32");
    assert.equal(archive.readUInt32LE(local + 14), archive.readUInt32LE(cursor + 16));
    entries.set(name, data);
    cursor += 46 + nameLength + archive.readUInt16LE(cursor + 30) + archive.readUInt16LE(cursor + 32);
  }
  assert.equal(nextLocal, directoryStart, "Unexpected ZIP payload"); assert.equal(cursor, end, "Unexpected ZIP directory data");
  return entries;
}
