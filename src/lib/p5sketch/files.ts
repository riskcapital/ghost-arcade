/**
 * A p5.js sketch's files: the stored model (SketchFile, in ../types) and the
 * extra detail an import carries before the files are kept.
 */
import type { SketchFile } from '../types';

/** Why a file stays a link instead of being carried with the sketch. */
export type P5RemoteReason = 'host' | 'size' | 'failed' | 'library';

/** A sketch file as an import finds it. */
export interface P5SketchFile extends SketchFile {
  /**
   * Why it stays online. A p5 library file (`library`) is not kept at all;
   * its text, when present, is only its opening comment, which names the
   * p5.js version.
   */
  remote?: P5RemoteReason;
}

export type P5SketchSource = 'account' | 'link' | 'zip' | 'files';

/** A sketch on its way in: from the p5.js Web Editor, a zip, or dropped files. */
export interface P5Sketch {
  name: string;
  author?: string;
  id?: string;
  /** The sketch in the p5.js Web Editor. */
  url?: string;
  source: P5SketchSource;
  createdAt?: string | null;
  updatedAt?: string | null;
  files: P5SketchFile[];
}

/** What one file, and a whole sketch, may keep inside a project. */
export const MAX_KEPT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_KEPT_TOTAL_BYTES = 24 * 1024 * 1024;

/**
 * The files a sketch keeps, exactly as written: everything but copies of p5
 * and its add-ons, which Ghost Arcade supplies. A file too large to keep in
 * a project stays online when it has an address, and is otherwise left out;
 * `notes` says which.
 */
export function keptFiles(files: P5SketchFile[]): { files: P5SketchFile[]; notes: string[] } {
  const kept: P5SketchFile[] = [];
  const notes: string[] = [];
  let budget = MAX_KEPT_TOTAL_BYTES;
  for (const file of files) {
    if (file.remote === 'library' || p5LibraryKind(file.path)) continue;
    const size = carriedSize(file);
    const hasContent = file.text !== undefined || file.base64 !== undefined;
    if (!hasContent || (size <= MAX_KEPT_FILE_BYTES && size <= budget)) {
      if (hasContent) budget -= size;
      kept.push(file);
      continue;
    }
    const name = file.path.split('/').pop() || file.path;
    const megabytes = `${(size / (1024 * 1024)).toFixed(1)} MB`;
    if (file.url) {
      kept.push({ path: file.path, url: file.url, ...(file.mime ? { mime: file.mime } : {}), remote: 'size' });
    } else {
      notes.push(`${name} (${megabytes}) is too large to keep with the sketch, so it plays without it.`);
    }
  }
  return { files: kept, notes };
}

/** A sketch's files as they are stored: without import bookkeeping. */
export function storedFiles(files: P5SketchFile[]): SketchFile[] {
  return files.map(({ remote: _remote, ...file }) => file);
}

const MIME_TYPES: Record<string, string> = {
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  vert: 'text/plain',
  frag: 'text/plain',
  glsl: 'text/plain',
  obj: 'text/plain',
  mtl: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  stl: 'model/stl',
  wasm: 'application/wasm',
};

const TEXT_EXTENSIONS = new Set([
  'js', 'mjs', 'css', 'html', 'htm', 'json', 'txt', 'md', 'csv', 'tsv', 'xml', 'svg',
  'vert', 'frag', 'glsl', 'obj', 'mtl',
]);

/** p5 itself and its add-ons, which Ghost Arcade supplies. */
const P5_LIBRARY = /^p5(?:\.(sound|dom))?(?:\.min)?\.js$/i;

export function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function mimeTypeFor(path: string): string {
  return MIME_TYPES[extensionOf(path)] ?? 'application/octet-stream';
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

/** 'core', 'sound' or 'dom' for p5 and its add-ons, by file name. */
export function p5LibraryKind(pathOrUrl: string): 'core' | 'sound' | 'dom' | null {
  const name = pathOrUrl.split(/[?#]/)[0].split('/').pop() ?? '';
  const match = P5_LIBRARY.exec(name);
  if (!match) return null;
  return match[1] ? (match[1].toLowerCase() as 'sound' | 'dom') : 'core';
}

/**
 * A path inside the sketch with `.` and `..` resolved and no leading slash,
 * or null when it climbs out of the sketch.
 */
export function normalizeSketchPath(path: string): string | null {
  const parts: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length > 0 ? parts.join('/') : null;
}

/** True for a reference with a scheme (`https:`, `data:`) or a `//host` start. */
export function isExternalReference(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

/** The sketch path a page reference points at, relative to `baseDir`. */
export function resolveSketchReference(value: string, baseDir = ''): string | null {
  const raw = value.trim().split('#')[0].split('?')[0];
  if (!raw || isExternalReference(raw)) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep it as written */
  }
  return normalizeSketchPath(decoded.startsWith('/') ? decoded : `${baseDir}${decoded}`);
}

/** Bytes of a file's contents as the page will carry them. */
export function carriedSize(file: SketchFile): number {
  if (typeof file.text === 'string') return file.text.length;
  if (typeof file.base64 === 'string') return Math.floor((file.base64.length * 3) / 4);
  return 0;
}

const BASE64_CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A file's text, decoding carried bytes as UTF-8 when needed. */
export function fileText(file: SketchFile): string | null {
  if (typeof file.text === 'string') return file.text;
  if (typeof file.base64 === 'string') {
    try {
      return new TextDecoder('utf-8').decode(base64ToBytes(file.base64));
    } catch {
      return null;
    }
  }
  return null;
}
