// Minimal read-only zip reader (stored and deflate entries, zip64 sizes and offsets).
// Uses only node:zlib. It reads the central directory, so it never trusts local headers for sizes.

import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

// Hard caps so a hostile archive cannot exhaust memory.
export const MAX_ENTRIES = 20000;
export const MAX_ENTRY_SIZE = 512 * 1024 * 1024;

export class ZipError extends Error {}

function findEocd(buf) {
  // The EOCD record is 22 bytes plus a comment of up to 65535 bytes.
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new ZipError('not a zip file (no end of central directory record)');
}

function u64(buf, off) {
  const v = buf.readBigUInt64LE(off);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('zip64 value too large');
  return Number(v);
}

export function readZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  const eocd = findEocd(buf);
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== ZIP64_LOCATOR) throw new ZipError('zip64 locator missing');
    const z64 = u64(buf, loc + 8);
    if (z64 + 56 > buf.length || buf.readUInt32LE(z64) !== ZIP64_EOCD) throw new ZipError('zip64 end record missing');
    count = u64(buf, z64 + 32);
    cdSize = u64(buf, z64 + 40);
    cdOffset = u64(buf, z64 + 48);
  }
  if (count > MAX_ENTRIES) throw new ZipError(`too many entries (${count})`);
  if (cdOffset + cdSize > buf.length) throw new ZipError('central directory out of range');

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new ZipError('bad central directory entry');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? rawName.toString('utf8') : rawName.toString('latin1'));

    // zip64 extended information extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = buf.readUInt16LE(e);
      const len = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(buf, q); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(buf, q); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = u64(buf, q); q += 8; }
      }
      e += 4 + len;
    }

    entries.push({
      name,
      path: name.replace(/\\/g, '/'),
      isDirectory: name.endsWith('/') || name.endsWith('\\'),
      encrypted: (flags & 1) === 1,
      method, crc, compressedSize, size, localOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }

  function read(entry) {
    if (entry.encrypted) throw new ZipError(`${entry.path}: encrypted entries are not supported`);
    if (entry.size > MAX_ENTRY_SIZE) throw new ZipError(`${entry.path}: entry too large`);
    const h = entry.localOffset;
    if (h + 30 > buf.length || buf.readUInt32LE(h) !== LOCAL) throw new ZipError(`${entry.path}: bad local header`);
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    const data = buf.subarray(start, start + entry.compressedSize);
    if (data.length !== entry.compressedSize) throw new ZipError(`${entry.path}: truncated data`);
    let out;
    if (entry.method === 0) out = Buffer.from(data);
    else if (entry.method === 8) out = inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) });
    else throw new ZipError(`${entry.path}: unsupported compression method ${entry.method}`);
    if (out.length !== entry.size) throw new ZipError(`${entry.path}: size mismatch after inflate`);
    return out;
  }

  return { entries, read };
}
