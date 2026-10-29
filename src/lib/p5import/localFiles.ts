/**
 * A p5.js sketch from files on this computer: a folder, or loose files such
 * as sketch.js and index.html dropped or picked together.
 */
import { bytesToBase64, extensionOf, isTextPath, mimeTypeFor, normalizeSketchPath, p5LibraryKind, type P5Sketch, type P5SketchFile } from '../p5sketch/files';

/** A dropped or picked file with its path inside what was dropped. */
export interface LocalFile {
  path: string;
  file: File;
}

export const LOCAL_MAX_FILES = 2000;
export const LOCAL_MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const LIBRARY_HEADER_CHARS = 256;

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (resolve: (file: File) => void, reject: (err: unknown) => void) => void;
  createReader?: () => { readEntries: (resolve: (entries: FileSystemEntryLike[]) => void, reject: (err: unknown) => void) => void };
}

async function readEntry(entry: FileSystemEntryLike, out: LocalFile[]): Promise<void> {
  if (out.length >= LOCAL_MAX_FILES) return;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push({ path: entry.fullPath.replace(/^\/+/, ''), file });
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  // A directory reader hands entries over in batches until it returns none.
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return;
    for (const child of batch) await readEntry(child, out);
  }
}

/**
 * Takes hold of what a drop carries. Must be called while the drop event is
 * being handled: the browser empties its list afterwards. The folders are
 * read afterwards, from the promise.
 */
export function takeDroppedFiles(data: DataTransfer | null | undefined): Promise<LocalFile[]> {
  if (!data) return Promise.resolve([]);
  const entries: FileSystemEntryLike[] = [];
  for (const item of Array.from(data.items ?? [])) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntryLike | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  const files = Array.from(data.files ?? []);
  if (entries.length === 0) return Promise.resolve(files.map((file) => ({ path: file.name, file })));
  return (async () => {
    const out: LocalFile[] = [];
    for (const entry of entries) await readEntry(entry, out);
    return out;
  })();
}

export function localFilesFromList(list: FileList | File[] | null | undefined): LocalFile[] {
  return Array.from(list ?? []).map((file) => ({ path: file.name, file }));
}

/**
 * True when the files make a sketch: some JavaScript of its own (a copy of
 * p5 alone does not count). A lone .html page stays an HTML animation.
 */
export function looksLikeSketch(paths: string[]): boolean {
  return paths.some((path) => extensionOf(path) === 'js' && !p5LibraryKind(path));
}

function commonFolder(paths: string[]): string {
  const first = paths[0]?.split('/');
  if (!first || first.length < 2) return '';
  const folder = `${first[0]}/`;
  return paths.every((p) => p.startsWith(folder)) ? folder : '';
}

function pageTitle(html: string | undefined): string | null {
  const title = html ? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() : '';
  return title ? title : null;
}

/** A sketch from local files, read as they are. */
export async function sketchFromLocalFiles(files: LocalFile[]): Promise<P5Sketch> {
  if (files.length > LOCAL_MAX_FILES) throw new Error(`That is more than ${LOCAL_MAX_FILES} files for one sketch.`);
  const total = files.reduce((sum, f) => sum + f.file.size, 0);
  if (total > LOCAL_MAX_TOTAL_BYTES) throw new Error('Those files are larger than a sketch should be.');
  const usable = files.filter((f) => !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(f.path) && !f.path.includes('__MACOSX/'));
  const prefix = commonFolder(usable.map((f) => f.path));
  const out: P5SketchFile[] = [];
  for (const { path: rawPath, file } of usable) {
    const path = normalizeSketchPath(rawPath.slice(prefix.length));
    if (!path) continue;
    if (p5LibraryKind(path)) {
      out.push({ path, text: (await file.slice(0, LIBRARY_HEADER_CHARS).text()), remote: 'library' });
    } else if (isTextPath(path)) {
      out.push({ path, text: await file.text() });
    } else {
      out.push({ path, base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())), mime: file.type || mimeTypeFor(path) });
    }
  }
  if (!looksLikeSketch(out.map((f) => f.path))) {
    throw new Error('No p5.js sketch here: there is no .js file of its own.');
  }
  const index = out.find((f) => f.path.toLowerCase() === 'index.html');
  const name = pageTitle(index?.text) ?? (prefix ? prefix.slice(0, -1) : 'p5.js sketch');
  return { name, source: 'files', files: out };
}
