/**
 * The sketch editor's view of a sketch: its own files, as in the p5.js Web
 * Editor (sketch.js, index.html, style.css, and any assets).
 *
 * The editor reads and writes files only. A sketch kept as files
 * (`JSAnimationSource.sketch`) goes back through the one wrapper
 * (src/lib/p5sketch/wrapSketch.ts), which builds the page that plays.
 * An older item that holds its sketch inline in a page (the shipped
 * sketches, AI pages) is shown as the same files, and saved back as the
 * page it was, so the controls it declares in that page stay as they are.
 */
import type { JSAnimationSource, SketchFile } from '../types';
import { sketchSource, wrapSketch } from '../p5sketch/wrapSketch';
import { sketchWithCode } from './sketchLayer';
import { readSketch } from './sketchSource';
import type { SketchRuntime } from './sketchTips';

export type EditorFile = SketchFile;

const TEXT_FILE = /\.(m?js|html?|css|json|txt|md|csv|tsv|xml|svg|vert|frag|glsl)$/i;

export function isTextFile(file: EditorFile): boolean {
  return typeof file.text === 'string' && TEXT_FILE.test(file.path);
}

/** Tab order the p5.js Web Editor uses: the sketch first, then the page and its style. */
export function fileOrder(a: EditorFile, b: EditorFile): number {
  const rank = (f: EditorFile) => (f.path === 'sketch.js' ? 0 : /\.m?js$/i.test(f.path) ? 1 : f.path === 'index.html' ? 2 : /\.css$/i.test(f.path) ? 3 : 4);
  return rank(a) - rank(b) || a.path.localeCompare(b.path);
}

/** Line breaks as the code editor keeps them, so positions in a file's text are positions in the editor. */
const plainBreaks = (text: string) => text.replace(/\r\n?/g, '\n');

/** Remove the indentation every line of a block shares, and blank lines around it. */
function dedent(code: string): string {
  const lines = code.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return `${lines.map((l) => l.slice(cut)).join('\n')}\n`;
}

/**
 * Files for a page that holds its sketch inline: each inline script becomes
 * its own file, sketch.js first, and the page loads them by name. Null when
 * a page has no inline script to take out.
 */
export function filesFromPage(html: string): EditorFile[] | null {
  const scripts = readSketch(html).scripts.filter((s) => s.code.trim());
  if (scripts.length === 0) return null;
  const files: EditorFile[] = [];
  let page = '';
  let at = 0;
  scripts.forEach((script, i) => {
    const path = i === 0 ? 'sketch.js' : `sketch${i + 1}.js`;
    files.push({ path, text: dedent(script.code), mime: 'text/javascript' });
    // From the start of the <script> tag to the end of </script>.
    const open = html.lastIndexOf('<script', script.from);
    const close = html.indexOf('>', html.indexOf('</script', script.to)) + 1;
    const attrs = html.slice(open + '<script'.length, html.indexOf('>', open));
    page += `${html.slice(at, open)}<script${attrs.replace(/\s+$/, '')} src="${path}"></script>`;
    at = close;
  });
  page += html.slice(at);
  return [...files, { path: 'index.html', text: page, mime: 'text/html' }].sort(fileOrder);
}

/** The files the editor shows for a source. */
export function editorFiles(source: JSAnimationSource): EditorFile[] {
  if (source.sketch) {
    return source.sketch.files.map((f) => (typeof f.text === 'string' ? { ...f, text: plainBreaks(f.text) } : f));
  }
  const html = plainBreaks(source.htmlCode);
  return filesFromPage(html) ?? [{ path: 'index.html', text: html, mime: 'text/html' }];
}

// ─── Older pages: the files put back into the page they came from ──────────

interface Segment {
  file: string;
  /** First line of the segment in the page. */
  pageLine: number;
  /** The same line in its file. */
  fileLine: number;
}

interface BuiltPage {
  html: string;
  /** The file and line a line of the page came from. */
  place(line: number): { file: string; line: number };
}

const normal = (path: string) => path.replace(/^\.?\//, '');
const newlines = (text: string) => text.split('\n').length - 1;
const LOADED = /<script\b([^>]*?)\s+src\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>|<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** The inline page for a set of files: their scripts and style sheets back in place. */
function buildPage(files: EditorFile[]): BuiltPage {
  const byPath = new Map(files.map((f) => [normal(f.path), f]));
  const index = byPath.get('index.html')?.text ?? '';
  const segments: Segment[] = [];
  let html = '';
  let at = 0;
  let pageLine = 1;
  let indexLine = 1;
  const addIndex = (text: string) => {
    segments.push({ file: 'index.html', pageLine, fileLine: indexLine });
    html += text;
    pageLine += newlines(text);
    indexLine += newlines(text);
  };
  LOADED.lastIndex = 0;
  for (let m = LOADED.exec(index); m; m = LOADED.exec(index)) {
    const isScript = m[2] !== undefined;
    const path = normal(isScript ? m[2] : m[4]);
    const file = byPath.get(path);
    if (file?.text === undefined) continue;
    addIndex(index.slice(at, m.index));
    html += isScript ? `<script${m[1]}${m[3]}>\n` : '<style>\n';
    pageLine += 1;
    segments.push({ file: path, pageLine, fileLine: 1 });
    html += `${file.text}${isScript ? '</script>' : '</style>'}`;
    pageLine += newlines(file.text);
    indexLine += newlines(m[0]);
    at = m.index + m[0].length;
  }
  addIndex(index.slice(at));
  return {
    html,
    place(line) {
      let segment = segments[0];
      for (const s of segments) if (s.pageLine <= line) segment = s;
      return { file: segment.file, line: segment.fileLine + (line - segment.pageLine) };
    },
  };
}

let lastBuild: { key: string; page: BuiltPage } | null = null;

function built(files: EditorFile[]): BuiltPage {
  const key = JSON.stringify(files.map((f) => [f.path, f.text ?? null]));
  if (lastBuild?.key !== key) lastBuild = { key, page: buildPage(files) };
  return lastBuild.page;
}

// ─── Handing files back ────────────────────────────────────────────────────

/**
 * The source with edited files: what the layer plays and the project keeps.
 * A file the editor did not change goes back exactly as it was stored.
 */
export function sketchWithFiles(source: JSAnimationSource, files: EditorFile[]): JSAnimationSource {
  if (source.sketch) {
    const stored = new Map(source.sketch.files.map((f) => [f.path, f]));
    const next = files.map((f) => {
      const before = stored.get(f.path);
      return before && typeof before.text === 'string' && plainBreaks(before.text) === f.text ? before : f;
    });
    const unchanged = next.length === source.sketch.files.length && next.every((f, i) => f === source.sketch!.files[i]);
    return unchanged ? source : sketchSource({ ...source.sketch, files: next }, { previous: source });
  }
  return sketchWithCode(source, built(files).html);
}

/**
 * Where an error is in the sketch's files. A sketch kept as files is played
 * from its own files, so errors already name theirs; an older page plays as
 * one page, whose lines are traced back to the files it was built from.
 */
export function errorInFiles(
  source: JSAnimationSource,
  files: EditorFile[],
  error: { file: string | null; line: number | null },
): { file: string | null; line: number | null } {
  if (source.sketch || error.file !== 'index.html' || error.line === null) return error;
  return built(files).place(error.line);
}

/** What Ghost Arcade adds to a sketch when it plays: how the canvas meets the output, and the controls it makes. */
export interface SketchWrapping {
  runtime: SketchRuntime;
  controls: string[];
  notes: string[];
}

export function sketchWrapping(source: JSAnimationSource): SketchWrapping | null {
  if (!source.sketch) return null;
  const wrapped = wrapSketch(source.sketch, { origin: source.origin });
  return {
    runtime: { canvas: { mode: wrapped.canvas.mode, reason: wrapped.canvas.reason } },
    controls: wrapped.controls,
    notes: wrapped.notes,
  };
}
