import { inflateRawSync } from "node:zlib";

export const BACKUP_LIMITS = {
  compressedBytes: 128 * 1024 * 1024,
  uncompressedBytes: 512 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  entries: 2_000,
  records: 2_000_000,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface ArchiveEntry {
  name: string;
  bytes: Uint8Array;
}

// A small STORE-only ZIP writer. JSONL remains stream-friendly to consumers and
// avoiding deflate also makes compressed/uncompressed bomb accounting exact.
const CRC_TABLE = (() => Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }))();
function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function stableNegativeId(value: string): number { return -((crc32(encoder.encode(value)) % 2_000_000_000) + 1); }
function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value >>> 0, true); }
export function createZip(entries: ArchiveEntry[]): Uint8Array {
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length + entry.bytes.length), lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0); u32(lv, 14, crc); u32(lv, 18, entry.bytes.length); u32(lv, 22, entry.bytes.length); u16(lv, 26, name.length); local.set(name, 30); local.set(entry.bytes, 30 + name.length); locals.push(local);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0x0800); u16(cv, 10, 0); u32(cv, 16, crc); u32(cv, 20, entry.bytes.length); u32(cv, 24, entry.bytes.length); u16(cv, 28, name.length); u32(cv, 42, offset); central.set(name, 46); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((n, part) => n + part.length, 0), eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, entries.length); u16(ev, 10, entries.length); u32(ev, 12, centralSize); u32(ev, 16, offset);
  const out = new Uint8Array(offset + centralSize + eocd.length); let ptr = 0; for (const part of [...locals, ...centrals, eocd]) { out.set(part, ptr); ptr += part.length; } return out;
}

export function safePath(name: string) {
  if (!name || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name) || name.includes("\\") || name.split("/").includes("..") || name.includes("\0")) throw new Error(`unsafe archive path: ${name}`);
}
export function validAvatar(bytes: Uint8Array, ext: string): boolean {
  if (bytes.length < 12 || bytes.length > 5 * 1024 * 1024) return false;
  const kind = ext.toLowerCase();
  if (kind === "png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (kind === "jpg" || kind === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (kind === "webp") return decoder.decode(bytes.subarray(0, 4)) === "RIFF" && decoder.decode(bytes.subarray(8, 12)) === "WEBP";
  return false;
}
export function readPortableZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > BACKUP_LIMITS.compressedBytes) throw new Error("archive exceeds compressed size limit");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("invalid ZIP archive");
  const count = view.getUint16(eocd + 10, true); if (count > BACKUP_LIMITS.entries) throw new Error("archive has too many entries");
  let ptr = view.getUint32(eocd + 16, true), total = 0; const entries = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) throw new Error("invalid ZIP central directory");
    const flags = view.getUint16(ptr + 8, true), method = view.getUint16(ptr + 10, true), crc = view.getUint32(ptr + 16, true), compressed = view.getUint32(ptr + 20, true), size = view.getUint32(ptr + 24, true), nameLen = view.getUint16(ptr + 28, true), extraLen = view.getUint16(ptr + 30, true), commentLen = view.getUint16(ptr + 32, true), external = view.getUint32(ptr + 38, true), localOffset = view.getUint32(ptr + 42, true);
    if ((external >>> 16 & 0xf000) === 0xa000) throw new Error("symlink entries are not allowed");
    if (!(flags & 0x0800) || (flags & 1)) throw new Error("archive names must be UTF-8 and entries must not be encrypted");
    if (![0, 8].includes(method)) throw new Error("unsupported ZIP compression");
    if (size > BACKUP_LIMITS.entryBytes) throw new Error("archive entry exceeds size limit"); total += size; if (total > BACKUP_LIMITS.uncompressedBytes) throw new Error("archive exceeds uncompressed size limit");
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen)); safePath(name); if (entries.has(name)) throw new Error(`duplicate archive entry: ${name}`);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("invalid ZIP local header");
    const localNameLen = view.getUint16(localOffset + 26, true), localExtraLen = view.getUint16(localOffset + 28, true), start = localOffset + 30 + localNameLen + localExtraLen;
    if (start + compressed > bytes.length) throw new Error("truncated ZIP entry");
    const raw = bytes.subarray(start, start + compressed), content = method === 0 ? raw.slice() : new Uint8Array(inflateRawSync(raw, { maxOutputLength: BACKUP_LIMITS.entryBytes }));
    if (content.length !== size || crc32(content) !== crc) throw new Error(`corrupt ZIP entry: ${name}`);
    entries.set(name, content); ptr += 46 + nameLen + extraLen + commentLen;
  }
  if ([...entries.keys()][0] !== "manifest.json") throw new Error("manifest.json must be the first entry");
  return entries;
}

