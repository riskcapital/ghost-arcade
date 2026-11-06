/**
 * The file on disk behind a clip, and the bookkeeping for clips whose file
 * has gone: which names to look for, and which new path each one maps to.
 */
import type { AssetRef } from '../storage/assetRegistry';

export type ClipFileSource = { src?: string; name?: string; type?: string; shaderCode?: string; _assetRef?: AssetRef } | null | undefined;

/**
 * One spelling for a Windows path. A file picked this session is named
 * "C:\Shows\a.mov" (from the file dialog), the same file reopened from a
 * project "C:/Shows/a.mov" (from its URL); anything that compares or keys
 * paths would count them as two files. Backslashes and an upper-case drive
 * letter, as Windows writes them. Other paths are returned as they are.
 */
export function canonicalLocalPath(filePath: string): string {
  if (!/^[a-zA-Z]:[\\/]/.test(filePath)) return filePath;
  return filePath[0].toUpperCase() + filePath.slice(1).replace(/\//g, '\\');
}

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
  return /^\/[a-zA-Z]:\//.test(decoded) ? canonicalLocalPath(decoded.slice(1)) : decoded;
}

/** The file a clip plays from, or null for a clip that is not a local file. */
export function clipFilePath(clip: ClipFileSource): string | null {
  if (!clip) return null;
  // A shader clip carries its code in the project; its src only names
  // where the code came from, so it never goes missing.
  if (clip.type === 'shader' && clip.shaderCode) return null;
  const fromSrc = localPathFromUrl(clip.src);
  if (fromSrc) return fromSrc;
  // A file picked in this session plays from a blob: URL; where it came from
  // is only in the asset reference.
  if (clip.src && !clip.src.startsWith('blob:')) return null;
  const original = clip._assetRef?.originalPath;
  return original ? canonicalLocalPath(original) : null;
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
