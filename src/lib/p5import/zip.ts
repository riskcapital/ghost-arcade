/**
 * Reading a sketch zip from the p5.js Web Editor's File → Download.
 *
 * A small reader for plain zip archives (stored or deflated entries), which is
 * all the editor writes. Limits on entry count and unpacked size keep a hostile
 * archive from filling memory.
 */
import {
  bytesToBase64,
  isTextPath,
  mimeTypeFor,
  normalizeSketchPath,
  p5LibraryKind,
  type P5Sketch,
  type P5SketchFile,
} from '../p5sketch/files';

/**
 * Inflates raw deflate data, giving up (with a ZipError) as soon as the
 * output would pass `limit` bytes: an archive's sizes are only what it
 * claims, so the real output is what counts.
 */
export type InflateRaw = (data: Uint8Array, limit: number) => Promise<Uint8Array>;

export interface ZipEntry {
  path: string;
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export const ZIP_MAX_ENTRIES = 2000;
export const ZIP_MAX_TOTAL_BYTES = 96 * 1024 * 1024;
export const ZIP_MAX_ENTRY_BYTES = 32 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export class ZipError extends Error {}

/** Raw deflate through the platform's DecompressionStream, read a chunk at a time and stopped past `limit`. */
export const inflateRawWithStreams: InflateRaw = async (data, limit) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel().catch(() => {});
      throw new ZipError('unpacks to more than it says');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
};

function findEndOfCentralDirectory(view: DataView): number {
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new ZipError('This file is not a zip archive.');
}

/** The file entries of an archive, from its central directory. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    throw new ZipError('This zip uses the large-archive format, which sketch zips never need.');
  }
  if (count > ZIP_MAX_ENTRIES) throw new ZipError(`This zip holds more than ${ZIP_MAX_ENTRIES} files.`);
  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('This zip archive is damaged.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || flags & 0x1) continue; // folders; encrypted files
    entries.push({ path: name, method, compressedSize, size, localHeaderOffset });
  }
  return entries;
}

/**
 * One entry's contents, at most `limit` bytes (and never more than the
 * entry says it holds, nor ZIP_MAX_ENTRY_BYTES).
 */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  inflateRaw: InflateRaw = inflateRawWithStreams,
  limit = ZIP_MAX_ENTRY_BYTES,
): Promise<Uint8Array> {
  const cap = Math.min(limit, ZIP_MAX_ENTRY_BYTES);
  if (entry.size > ZIP_MAX_ENTRY_BYTES) throw new ZipError(`${entry.path} is too large.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localHeaderOffset;
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_SIGNATURE) {
    throw new ZipError('This zip archive is damaged.');
  }
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) throw new ZipError('This zip archive is damaged.');
  const data = bytes.subarray(start, end);
  if (entry.method === 0) {
    if (data.byteLength > cap) throw new ZipError(`${entry.path} is too large.`);
    return data;
  }
  if (entry.method !== 8) throw new ZipError(`${entry.path} is packed in a way this reader does not support.`);
  // A deflated entry stops where it says it ends; one that unpacks to more is
  // damaged or hostile, and is not unpacked any further.
  const allowed = Math.min(cap, entry.size);
  let out: Uint8Array;
  try {
    out = await inflateRaw(data, allowed);
  } catch (err) {
    if (err instanceof ZipError) {
      throw new ZipError(entry.size > cap ? `${entry.path} is too large.` : `${entry.path} unpacks to more than the zip says: the archive is damaged.`);
    }
    throw err;
  }
  if (out.byteLength > allowed) throw new ZipError(`${entry.path} unpacks to more than the zip says: the archive is damaged.`);
  return out;
}

/** The p5.js Web Editor names downloads "<sketch name>_YYYY_MM_DD_HH_MM_SS.zip". */
export function sketchNameFromZipName(fileName: string): string {
  const base = fileName.replace(/\.zip$/i, '').replace(/_\d{4}(?:_\d{2}){5}$/, '').trim();
  return base || 'Untitled sketch';
}

function isJunk(path: string): boolean {
  return path.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(path);
}

/**
 * Folder every entry sits in when the archive was zipped from its parent
 * folder (e.g. "My Sketch/index.html"), so paths match the sketch's own.
 */
function commonFolder(paths: string[]): string {
  if (paths.length === 0) return '';
  const first = paths[0].split('/');
  if (first.length < 2) return '';
  const folder = `${first[0]}/`;
  return paths.every((p) => p.startsWith(folder)) ? folder : '';
}

/** The opening comment of a p5 library file, which names its version. */
const LIBRARY_HEADER_CHARS = 256;

/** A sketch from the bytes of an editor zip. */
export async function sketchFromZip(
  fileName: string,
  bytes: Uint8Array,
  inflateRaw: InflateRaw = inflateRawWithStreams,
): Promise<P5Sketch> {
  const entries = listZipEntries(bytes).filter((entry) => !isJunk(entry.path));
  const prefix = commonFolder(entries.map((entry) => entry.path));
  const decoder = new TextDecoder('utf-8');
  const files: P5SketchFile[] = [];
  let total = 0;
  for (const entry of entries) {
    const path = normalizeSketchPath(entry.path.slice(prefix.length));
    if (!path) continue;
    const room = ZIP_MAX_TOTAL_BYTES - total;
    if (entry.size > room) throw new ZipError('This zip unpacks to more than a sketch should hold.');
    // What an entry really unpacks to counts, not what the archive claims.
    const data = await readZipEntry(bytes, entry, inflateRaw, room);
    total += data.byteLength;
    if (p5LibraryKind(path)) {
      // Not carried; the opening comment says which p5 the sketch was made with.
      const header = decoder.decode(data.subarray(0, LIBRARY_HEADER_CHARS));
      files.push({ path, text: header, remote: 'library' });
    } else if (isTextPath(path)) {
      files.push({ path, text: decoder.decode(data) });
    } else {
      files.push({ path, base64: bytesToBase64(data), mime: mimeTypeFor(path) });
    }
  }
  const hasCode = files.some((f) => /\.(m?js|html?)$/i.test(f.path) && f.remote !== 'library');
  if (!hasCode) throw new ZipError('No p5.js sketch in this zip: it has no index.html or .js files.');
  return {
    name: sketchNameFromZipName(fileName),
    source: 'zip',
    files,
  };
}
