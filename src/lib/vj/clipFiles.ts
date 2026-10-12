/**
 * The file on disk behind a clip, and the bookkeeping for clips whose file
 * has gone: which names to look for, and which new path each one maps to.
 */
import type { AssetRef } from '../storage/assetRegistry';

export type ClipFileSource = { src?: string; name?: string; _assetRef?: AssetRef } | null | undefined;

/** The absolute path a `ghost-asset://` or `file://` URL points at. */
export function localPathFromUrl(src: string | undefined | null): string | null {
  if (!src) return null;
  const match = /^(?:ghost-asset:\/\/localhost|file:\/\/(?:localhost)?)(\/.*)$/i.exec(src);
  if (!match) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1].replace(/[?#].*$/, ''));
  } catch {
    return null;
  }
  // "/C:/shows/a.mov" is a Windows path with the URL's leading slash.
  return /^\/[a-zA-Z]:\//.test(decoded) ? decoded.slice(1) : decoded;
}

/** The file a clip plays from, or null for a clip that is not a local file. */
export function clipFilePath(clip: ClipFileSource): string | null {
  if (!clip) return null;
  const fromSrc = localPathFromUrl(clip.src);
  if (fromSrc) return fromSrc;
  // A file picked in this session plays from a blob: URL; where it came from
  // is only in the asset reference.
  if (clip.src && !clip.src.startsWith('blob:')) return null;
  return clip._assetRef?.originalPath || null;
}

export function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/** Every distinct local file used by the clips in these grids. */
export function clipFilePaths(grids: (ClipFileSource[][] | undefined)[]): string[] {
  const paths = new Set<string>();
  for (const grid of grids) {
    for (const row of grid ?? []) {
      for (const clip of row ?? []) {
        const filePath = clipFilePath(clip);
        if (filePath) paths.add(filePath);
      }
    }
  }
  return [...paths];
}

/**
 * Pair missing files with what a folder search found. `found` maps a file
 * name to where it is now; every missing path with that name moves there.
 */
export function matchFoundFiles(missing: Iterable<string>, found: Record<string, string>): Record<string, string> {
  const byName = new Map(Object.entries(found).map(([name, to]) => [name.toLowerCase(), to]));
  const moves: Record<string, string> = {};
  for (const from of missing) {
    const to = byName.get(fileNameOf(from).toLowerCase());
    if (to && to !== from) moves[from] = to;
  }
  return moves;
}
