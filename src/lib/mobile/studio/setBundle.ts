// A set and the photos and videos it uses, in one file.
//
// A plain .ghostset is the set as JSON; its imported media stays behind on the device. A bundle
// is still one .ghostset file, but it starts with a short marker and carries the media after the
// set, so it can be sent to another device and opened there complete:
//
//   "GASETPK1" | header length (uint32, little-endian) | header JSON (UTF-8) | media bytes…
//
// The header holds the set and one entry per media file (id, type, size) in the order the bytes
// follow. Media is copied as it is stored, never re-encoded.
import type { Show } from './model';

export const BUNDLE_MAGIC = 'GASETPK1';
/** Largest media payload one bundle may carry. The file crosses the native bridge in memory. */
export const BUNDLE_MAX_BYTES = 150 * 1000 * 1000;
const HEADER_MAX_BYTES = 32 * 1000 * 1000;

export type BundleEntry = { id: string; type: string; bytes: number };
type BundleHeader = { format: 'ghost-arcade-set-bundle'; version: 1; show: unknown; media: BundleEntry[]; missing?: string[] };
export type PackedSet = { blob: Blob; files: number; mediaBytes: number; missing: string[] };
export type UnpackedSet = { show: unknown; media: { id: string; blob: Blob }[]; missing: string[]; bundled: boolean };

const DAMAGED = 'This set file is damaged or incomplete.';

/** Ids of the imported files this one set uses, each once, in clip order. */
export function setAssetIds(show: Pick<Show, 'clips'>): string[] {
  return [...new Set(show.clips.flatMap((c) => (c.assetId ? [c.assetId] : [])))];
}

export class BundleTooLarge extends Error {
  constructor(readonly bytes: number) { super('This set has too much media for one file.'); }
}

/**
 * Packs `show` with its media. `read` returns a stored file by id (undefined when the device no
 * longer has it; those ids are listed in `missing` and the set still exports).
 * Throws BundleTooLarge before reading everything when the media is over the limit.
 */
export async function packSet(show: Show, read: (id: string) => Promise<Blob | undefined>, limit = BUNDLE_MAX_BYTES): Promise<PackedSet> {
  const media: BundleEntry[] = [], parts: Blob[] = [], missing: string[] = [];
  let mediaBytes = 0;
  for (const id of setAssetIds(show)) {
    const blob = await read(id).catch(() => undefined);
    if (!blob) { missing.push(id); continue; }
    mediaBytes += blob.size;
    if (mediaBytes > limit) throw new BundleTooLarge(mediaBytes);
    media.push({ id, type: blob.type || 'application/octet-stream', bytes: blob.size });
    parts.push(blob);
  }
  const header: BundleHeader = { format: 'ghost-arcade-set-bundle', version: 1, show, media, ...(missing.length ? { missing } : {}) };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, headerBytes.length, true);
  const blob = new Blob([new TextEncoder().encode(BUNDLE_MAGIC), length, headerBytes, ...parts], { type: 'application/octet-stream' });
  return { blob, files: media.length, mediaBytes, missing };
}

/** Total size of a set's media without reading the files: for the label on the export button. */
export function setMediaSize(show: Pick<Show, 'clips'>, assets: { id: string; bytes: number }[]): { files: number; bytes: number } {
  const ids = new Set(setAssetIds(show));
  const found = assets.filter((a) => ids.has(a.id));
  return { files: found.length, bytes: found.reduce((sum, a) => sum + a.bytes, 0) };
}

/**
 * Opens either kind of .ghostset. A plain set comes back with no media. The set itself is
 * returned raw: the caller validates it the same way as any saved set.
 */
export async function unpackSet(file: Blob): Promise<UnpackedSet> {
  const magic = new TextDecoder().decode(await file.slice(0, BUNDLE_MAGIC.length).arrayBuffer());
  if (magic !== BUNDLE_MAGIC) {
    let show: unknown;
    try { show = JSON.parse(await file.text()); } catch { throw new Error('This is not a Ghost Arcade mobile set.'); }
    return { show, media: [], missing: [], bundled: false };
  }
  const start = BUNDLE_MAGIC.length + 4;
  if (file.size < start) throw new Error(DAMAGED);
  const headerLength = new DataView(await file.slice(BUNDLE_MAGIC.length, start).arrayBuffer()).getUint32(0, true);
  if (!headerLength || headerLength > HEADER_MAX_BYTES || start + headerLength > file.size) throw new Error(DAMAGED);
  let header: BundleHeader;
  try { header = JSON.parse(new TextDecoder().decode(await file.slice(start, start + headerLength).arrayBuffer())); } catch { throw new Error(DAMAGED); }
  if (!header || header.format !== 'ghost-arcade-set-bundle' || !Array.isArray(header.media)) throw new Error(DAMAGED);
  if (header.version !== 1) throw new Error('This set was made by a newer version of Ghost Arcade. Update the app to open it.');
  let offset = start + headerLength;
  const media: UnpackedSet['media'] = [];
  for (const entry of header.media) {
    if (!entry || typeof entry.id !== 'string' || !Number.isInteger(entry.bytes) || entry.bytes < 0 || offset + entry.bytes > file.size) throw new Error(DAMAGED);
    media.push({ id: entry.id, blob: file.slice(offset, offset + entry.bytes, typeof entry.type === 'string' ? entry.type : '') });
    offset += entry.bytes;
  }
  const missing = Array.isArray(header.missing) ? header.missing.filter((id): id is string => typeof id === 'string') : [];
  return { show: header.show, media, missing, bundled: true };
}
