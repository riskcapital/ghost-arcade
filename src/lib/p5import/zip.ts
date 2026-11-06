/**
 * Reading a sketch zip from the p5.js Web Editor's File → Download.
 *
 * A small reader for plain zip archives (stored or deflated entries), which is
 * all the editor writes. Limits on entry count and unpacked size keep a hostile
 * archive from filling memory: sizes are the bytes actually unpacked, never the
 * sizes an archive declares, and unpacking stops as soon as an entry passes its
 * limit.
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
 * Unpacks raw deflate data. Returns null as soon as the output passes
 * `maxBytes`, without unpacking the rest.
 */
export type InflateRaw = (data: Uint8Array, maxBytes: number) => Promise<Uint8Array | null>;

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

/** Raw deflate through the platform's DecompressionStream, read chunk by chunk. */
export const inflateRawWithStreams: InflateRaw = async (data, maxBytes) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
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
 * One entry's contents, at most `maxBytes` of them (ZIP_MAX_ENTRY_BYTES unless
 * less is left of the archive's budget).
 */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  inflateRaw: InflateRaw = inflateRawWithStreams,
  maxBytes = ZIP_MAX_ENTRY_BYTES,
): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localHeaderOffset;
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== LOCAL_SIGNATURE) {
    throw new ZipError('This zip archive is damaged.');
  }
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) throw new ZipError('This zip archive is damaged.');
  const data = bytes.subarray(start, end);
  const limit = Math.min(maxBytes, ZIP_MAX_ENTRY_BYTES);
  const tooLarge = () => new ZipError(
    limit < ZIP_MAX_ENTRY_BYTES ? 'This zip unpacks to more than a sketch should hold.' : `${entry.path} is too large.`,
  );
  if (entry.method === 0) {
    if (data.byteLength > limit) throw tooLarge();
    return data;
  }
  if (entry.method !== 8) throw new ZipError(`${entry.path} is packed in a way this reader does not support.`);
  const out = await inflateRaw(data, limit);
  if (!out || out.byteLength > limit) throw tooLarge();
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
    // The real bytes unpacked so far count, not the sizes the archive declares.
    const data = await readZipEntry(bytes, entry, inflateRaw, ZIP_MAX_TOTAL_BYTES - total);
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
