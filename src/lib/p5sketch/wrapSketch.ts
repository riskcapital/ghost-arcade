/**
 * Playing a p5.js sketch that is kept as its own files.
 *
 * A sketch is stored exactly as its author wrote it (JSAnimationSketch).
 * This module is the one place that turns those files into a page Ghost
 * Arcade can play, each time the sketch runs:
 * - p5 and its add-ons come from Ghost Arcade's own copies, not CDN tags;
 * - the canvas follows the output, filling it or scaled to fit;
 * - top-level values the sketch only reads while it plays become controls;
 * - files that stay online are fetched from where they live.
 *
 * The wrapped index.html (wrapSketch) keeps every line of the author's
 * index.html where it was; it is what a sketch stores as its page. Layers
 * play a sketch in an iframe, as a single document with the files folded
 * into it (singleSketchDocument), which also traces each of its lines back
 * to the file and line the author wrote, so errors point at their code.
 */
import type {
  JSAnimationOrigin,
  JSAnimationParamValue,
  JSAnimationSketch,
  JSAnimationSource,
  SketchFile,
} from '../types';
import { jsAnimationFromHtml } from '../renderer/jsAnimationPage';
import {
  drawsRelativeToCanvas,
  findCanvasCall,
  findControls,
  sketchFeatures,
  tokenize,
  type CanvasSize,
  type SketchControl,
  type SketchFeatures,
} from './jsScan';
import {
  carriedSize,
  extensionOf,
  fileText,
  isExternalReference,
  mimeTypeFor,
  p5LibraryKind,
  resolveSketchReference,
  type P5SketchFile,
} from './files';

/** The p5.js Ghost Arcade plays sketches on (public/lib/p5.min.js). */
export const BUNDLED_P5_VERSION = '1.11.0';
/**
 * Stands for p5.sound in a page. The hosts that play pages swap it for the
 * bundled copy; it also lets the page run on its own in a browser.
 */
export const P5_SOUND_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.0/addons/p5.sound.min.js';

/** What a single-document page carries inside itself. */
export const MAX_CARRIED_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_CARRIED_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_CONTROLS = 8;

/**
 * 'fill': the canvas takes the output's size and the sketch draws to it.
 * 'fit': the canvas keeps the size the sketch asked for and is scaled up to
 * fit the output, sharp where the sketch allows it.
 */
export type P5CanvasMode = 'fill' | 'fit';

export interface P5Compatibility {
  level: 'ok' | 'warn' | 'blocked';
  message: string | null;
}

export interface P5CanvasPlan {
  size: CanvasSize;
  recommended: P5CanvasMode;
  mode: P5CanvasMode;
  /** Why the recommendation, in a sentence. */
  reason: string;
  /** Raises the pixel density in 'fit' so a small canvas stays sharp. */
  sharpen: boolean;
}

export interface WrapOptions {
  /** Who made the sketch and where it lives, for the page's credit line and its p5 version. */
  origin?: Pick<JSAnimationOrigin, 'sketchName' | 'author' | 'url' | 'p5Version'> | null;
}

export interface WrappedSketch {
  /** The sketch's index.html with Ghost Arcade's pieces added: what plays at /index.html. */
  html: string;
  /**
   * The other files, served at their own paths. A script holding a control
   * declared with `const` is served with `let  ` in its place, so no line or
   * column moves.
   */
  files: SketchFile[];
  params?: JSAnimationSource['params'];
  paramValues?: JSAnimationSource['paramValues'];
  /** The p5.js version the sketch was written for, when it says. */
  p5Version: string | null;
  compatibility: P5Compatibility;
  canvas: P5CanvasPlan;
  /** Names of the values that became controls. */
  controls: string[];
  /** Things worth knowing before it plays, one sentence each. */
  notes: string[];
  /** The files that travel with the sketch, besides its page. */
  carried: { files: number; bytes: number };
}

// ---------------------------------------------------------------------------
// Runtime pieces placed in the page

/**
 * Hands files to p5 by path when they are not served alongside the page:
 * the ones that stay online, or, in a single-document page, all of them.
 * p5 loads through fetch, XMLHttpRequest and media `src`, so those resolve a
 * sketch path to the file (or to where it lives) before they load.
 */
const FILES_RUNTIME = String.raw`(function (files) {
  var cache = Object.create(null);
  var lower = Object.create(null);
  Object.keys(files).forEach(function (key) { lower[key.toLowerCase()] = key; });
  function clean(path) {
    var parts = [];
    path.split('/').forEach(function (segment) {
      if (!segment || segment === '.') return;
      if (segment === '..') parts.pop(); else parts.push(segment);
    });
    return parts.join('/');
  }
  function keyFor(value) {
    if (value == null) return null;
    var text = String(value);
    var origin = /^[a-z][a-z0-9+.-]*:\/\/[^\/?#]*/i.exec(text);
    if (origin) {
      if (origin[0] !== location.origin) return null;
      text = text.slice(origin[0].length);
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.indexOf('//') === 0) {
      return null;
    }
    text = text.split('#')[0].split('?')[0];
    try { text = decodeURIComponent(text); } catch (e) {}
    var key = clean(text);
    if (Object.prototype.hasOwnProperty.call(files, key)) return key;
    return lower[key.toLowerCase()] || null;
  }
  function resolve(value) {
    var key = keyFor(value);
    if (!key) return null;
    if (cache[key]) return cache[key];
    var file = files[key];
    var url = file.url;
    if (!url) {
      var blob;
      if (typeof file.text === 'string') {
        blob = new Blob([file.text], { type: file.type });
      } else {
        var binary = atob(file.b64 || '');
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        blob = new Blob([bytes], { type: file.type });
      }
      url = URL.createObjectURL(blob);
    }
    cache[key] = url;
    return url;
  }
  var nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var target = input && typeof input === 'object' && 'url' in input ? input.url : input;
      var url = resolve(target);
      return url ? nativeFetch.call(this, url, init) : nativeFetch.call(this, input, init);
    };
  }
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, target) {
    var url = resolve(target);
    if (!url) return open.apply(this, arguments);
    var args = Array.prototype.slice.call(arguments);
    args[1] = url;
    return open.apply(this, args);
  };
  function isMedia(element) {
    return element instanceof HTMLImageElement || element instanceof HTMLMediaElement || element instanceof HTMLSourceElement;
  }
  [HTMLImageElement, HTMLMediaElement, HTMLSourceElement].forEach(function (type) {
    var descriptor = Object.getOwnPropertyDescriptor(type.prototype, 'src');
    if (!descriptor || !descriptor.set || !descriptor.configurable) return;
    Object.defineProperty(type.prototype, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) { descriptor.set.call(this, resolve(value) || value); }
    });
  });
  var setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase() === 'src' && isMedia(this)) {
      var url = resolve(value);
      if (url) return setAttribute.call(this, name, url);
    }
    return setAttribute.apply(this, arguments);
  };
})`;

/**
 * Sizes the sketch's canvas to the page, which the host sizes to the output.
 * 'fill' hands createCanvas() and resizeCanvas() the page size whatever the
 * sketch asked for; 'fit' keeps the sketch's size, scales the canvas to fit,
 * and raises the pixel density so the scaled canvas stays sharp.
 */
const CANVAS_RUNTIME = String.raw`(function (mode, sharpen) {
  var P = window.p5;
  if (!P || !P.prototype || typeof P.prototype.createCanvas !== 'function') return;
  var proto = P.prototype;
  var create = proto.createCanvas;
  var resize = proto.resizeCanvas;
  var rule = document.createElement('style');
  (document.head || document.documentElement).appendChild(rule);
  var main = null;
  function layout() {
    var canvas = main && main.canvas;
    if (!canvas || !(main.width > 0) || !(main.height > 0)) return;
    canvas.setAttribute('data-ghost-canvas', '');
    var vw = window.innerWidth, vh = window.innerHeight;
    var scale = mode === 'fill' ? 1 : Math.min(vw / main.width, vh / main.height);
    var w = mode === 'fill' ? vw : main.width * scale;
    var h = mode === 'fill' ? vh : main.height * scale;
    rule.textContent = 'canvas[data-ghost-canvas]{position:fixed!important;margin:0!important;left:' + (vw - w) / 2 +
      'px!important;top:' + (vh - h) / 2 + 'px!important;width:' + w + 'px!important;height:' + h + 'px!important}';
  }
  proto.createCanvas = function () {
    var args = Array.prototype.slice.call(arguments);
    if (mode === 'fill') { args[0] = window.innerWidth; args[1] = window.innerHeight; }
    var result = create.apply(this, args);
    main = this;
    if (mode === 'fit' && sharpen && this.width > 0 && this.height > 0) {
      var density = Math.ceil(Math.min(window.innerWidth / this.width, window.innerHeight / this.height));
      density = Math.min(density, 4, Math.floor(4096 / Math.max(this.width, this.height)));
      if (density > 1) this.pixelDensity(density);
    }
    layout();
    return result;
  };
  proto.resizeCanvas = function () {
    var args = Array.prototype.slice.call(arguments);
    if (mode === 'fill' && this === main) { args[0] = window.innerWidth; args[1] = window.innerHeight; }
    var result = resize.apply(this, args);
    if (this === main) layout();
    return result;
  };
  window.addEventListener('resize', function () {
    if (!main) return;
    if (mode === 'fill' && (main.width !== window.innerWidth || main.height !== window.innerHeight)) {
      main.resizeCanvas(window.innerWidth, window.innerHeight);
    } else {
      layout();
    }
  });
})`;

const COUNT_NAME = /count|num|number|total|amount|rows|cols|columns|steps|segments|sides|points|particles|agents|boids|lines|levels|depth|iterations|layers|^n[A-Z_]|^n$|^res(olution)?$/i;

/**
 * Copies control values onto the sketch's variables. Runs every frame and
 * writes a variable only when its control moved, so the sketch's own
 * reading of it is never disturbed otherwise.
 */
function controlsRuntime(controls: SketchControl[]): string {
  // The helper's own names start with __ghost so none can hide a sketch variable.
  const lines = controls.map((c) => {
    const type = typeof c.value === 'boolean' ? 'boolean' : 'number';
    const whole = typeof c.value === 'number' && Number.isInteger(c.value) && COUNT_NAME.test(c.name);
    const read = `__ghostValues.${c.name}`;
    const value = whole ? `Math.round(${read})` : read;
    return `    if (${read} !== __ghostLast.${c.name}) { __ghostLast.${c.name} = ${read}; if (typeof ${read} === '${type}') { try { ${c.name} = ${value}; } catch (e) {} } }`;
  });
  return [
    '(function () {',
    '  var __ghostLast = {};',
    '  (function __ghostTick() {',
    '    var __ghostValues = window.shaderParams || {};',
    ...lines,
    '    requestAnimationFrame(__ghostTick);',
    '  })();',
    '})();',
  ].join('\n');
}

/** Script text on one line, so adding it to a page moves no line of the author's. */
function oneLine(code: string): string {
  return code.replace(/\s*\n\s*/g, ' ');
}

function formatNumber(value: number): string {
  // Plain decimals: the controls reader does not take exponents.
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

// ---------------------------------------------------------------------------
// Reading the page

/**
 * Code that is safe inside a <script> element: `</script` would end it, and
 * `<!--` followed by `<script` would stop `</script>` from ending it. Both
 * spellings mean the same in a JavaScript string or regular expression.
 */
function escapeScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function escapeStyle(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

const LINE_SEPARATORS = new RegExp('[\\u2028\\u2029]', 'g');

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

function commentText(text: string): string {
  return text.replace(/[<>]/g, '').replace(/-{2,}/g, '-');
}

function attribute(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
}

type HtmlPart =
  | { kind: 'text'; text: string; start: number }
  | { kind: 'comment'; text: string; start: number }
  | { kind: 'script'; attrs: string; body: string; start: number; end: number };

/** The page as markup, comments and <script> elements, with their offsets. */
function splitHtml(html: string): HtmlPart[] {
  const parts: HtmlPart[] = [];
  const scriptOpen = /<script\b/gi;
  const scriptClose = /<\/script\s*>/gi;
  let i = 0;
  while (i < html.length) {
    const comment = html.indexOf('<!--', i);
    scriptOpen.lastIndex = i;
    const open = scriptOpen.exec(html);
    const script = open ? open.index : -1;
    const next = comment >= 0 && (script < 0 || comment < script) ? comment : script;
    if (next < 0) {
      parts.push({ kind: 'text', text: html.slice(i), start: i });
      break;
    }
    if (next > i) parts.push({ kind: 'text', text: html.slice(i, next), start: i });
    if (next === comment) {
      const end = html.indexOf('-->', comment + 4);
      const stop = end < 0 ? html.length : end + 3;
      parts.push({ kind: 'comment', text: html.slice(comment, stop), start: comment });
      i = stop;
      continue;
    }
    const openEnd = html.indexOf('>', script);
    if (openEnd < 0) {
      parts.push({ kind: 'text', text: html.slice(script), start: script });
      break;
    }
    scriptClose.lastIndex = openEnd + 1;
    const close = scriptClose.exec(html);
    const end = close ? close.index + close[0].length : html.length;
    parts.push({
      kind: 'script',
      attrs: html.slice(script + 7, openEnd).replace(/\/\s*$/, ''),
      body: html.slice(openEnd + 1, close ? close.index : html.length),
      start: script,
      end,
    });
    i = end;
  }
  return parts;
}

/**
 * The sketch path of a <link rel="stylesheet"> to one of the sketch's own
 * files; null when it points inside the sketch but cannot be resolved;
 * undefined for any other link, which stays as it is.
 */
function stylesheetPath(tag: string, baseDir: string): string | null | undefined {
  const attrs = tag.slice(5);
  const rel = (attribute(attrs, 'rel') ?? '').toLowerCase();
  const href = attribute(attrs, 'href');
  if (!rel.split(/\s+/).includes('stylesheet') || !href || isExternalReference(href)) return undefined;
  return resolveSketchReference(href, baseDir);
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash + 1) : '';
}

/** The sketch's page: index.html, else its shallowest .html file. */
export function findIndexHtml<T extends SketchFile>(files: T[]): T | null {
  const pages = files.filter((f) => /\.html?$/i.test(f.path) && fileText(f) !== null);
  return pages.find((f) => f.path.toLowerCase() === 'index.html')
    ?? [...pages].sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0]
    ?? null;
}

/** A page for a sketch that came without one: its style sheets and scripts, sketch.js last. */
function defaultIndexHtml(files: SketchFile[]): string {
  const css = files.filter((f) => extensionOf(f.path) === 'css');
  const scripts = files
    .filter((f) => extensionOf(f.path) === 'js' && !p5LibraryKind(f.path))
    .sort((a, b) => Number(/(^|\/)sketch\.js$/i.test(a.path)) - Number(/(^|\/)sketch\.js$/i.test(b.path)) || a.path.localeCompare(b.path));
  const attr = (path: string) => path.replace(/"/g, '&quot;');
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    ...css.map((f) => `<link rel="stylesheet" href="${attr(f.path)}">`),
    '</head>',
    '<body>',
    '<main></main>',
    ...scripts.map((f) => `<script src="${attr(f.path)}"></script>`),
    '</body>',
    '</html>',
  ].join('\n');
}

export function p5VersionFromUrl(src: string): string | null {
  const m = /\/p5@(\d+(?:\.\d+){0,2})(?=[/?#]|$)/.exec(src)
    ?? /\/p5\.js\/(\d+\.\d+\.\d+)\//.exec(src)
    ?? /\/p5\/(\d+\.\d+\.\d+)\//.exec(src);
  return m ? m[1] : null;
}

export function p5VersionFromHeader(text: string): string | null {
  const m = /p5\.js v(\d+\.\d+\.\d+)/.exec(text);
  return m ? m[1] : null;
}

function majorOf(version: string | null): number | null {
  if (!version) return null;
  const major = Number.parseInt(version, 10);
  return Number.isFinite(major) ? major : null;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function p5Compatibility(version: string | null, features: Pick<SketchFeatures, 'v2Features'>): P5Compatibility {
  const major = majorOf(version);
  const v2 = features.v2Features.slice(0, 3);
  if (major !== null && major >= 2) {
    if (v2.length > 0) {
      return {
        level: 'blocked',
        message: `Can't run: it is written for p5.js ${version} and uses ${listWords(v2)}, which p5.js 1.11, the version Ghost Arcade plays, doesn't have.`,
      };
    }
    return {
      level: 'warn',
      message: `Written for p5.js ${version}. Ghost Arcade plays it on p5.js 1.11: most sketches look the same, but anything that depends on what 2.0 changed may not.`,
    };
  }
  if (major === null && v2.length > 0) {
    return {
      level: 'warn',
      message: `Uses ${listWords(v2)} from p5.js 2, which p5.js 1.11, the version Ghost Arcade plays, doesn't have, so parts of it may not run.`,
    };
  }
  return { level: 'ok', message: null };
}

function canvasPlan(size: CanvasSize, relative: boolean, features: SketchFeatures, chosen?: P5CanvasMode): P5CanvasPlan {
  let recommended: P5CanvasMode = 'fit';
  let reason: string;
  if (features.usesPixelArray) {
    reason = 'It works on its pixels one by one, so it keeps its own resolution and is scaled to fit.';
  } else if (size.kind === 'window') {
    recommended = 'fill';
    reason = 'It already sizes its canvas to the window, so it fills the output.';
  } else if (size.kind === 'fixed' && relative) {
    recommended = 'fill';
    reason = `It draws from width and height, so its ${size.width} × ${size.height} canvas can grow to fill the output.`;
  } else if (size.kind === 'fixed') {
    reason = `It draws at fixed positions on its ${size.width} × ${size.height} canvas, so it keeps that shape and is scaled to fit.`;
  } else if (size.kind === 'computed') {
    reason = 'It works out its own canvas size, which is kept and scaled to fit.';
  } else {
    reason = "It uses p5's default 100 × 100 canvas, which is scaled to fit.";
  }
  const mode = chosen ?? recommended;
  return {
    size,
    recommended,
    mode,
    reason,
    sharpen: mode === 'fit' && !features.usesPixelArray && !features.setsPixelDensity,
  };
}

function dataUrl(file: SketchFile): string | null {
  const type = file.mime || mimeTypeFor(file.path);
  if (typeof file.base64 === 'string') return `data:${type};base64,${file.base64}`;
  if (typeof file.text === 'string') return `data:${type};charset=utf-8,${encodeURIComponent(file.text)}`;
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the internet';
  }
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Changes whenever any file, or the canvas choice, changes. */
function fingerprint(sketch: JSAnimationSketch): string {
  let hash = fnv1a(sketch.canvas ?? '');
  for (const file of sketch.files) {
    hash = fnv1a(file.path, hash);
    hash = fnv1a(file.text ?? file.base64 ?? file.url ?? '', hash);
  }
  return hash.toString(36);
}

// ---------------------------------------------------------------------------
// Reading the sketch

interface ScriptPlan {
  part: Extract<HtmlPart, { kind: 'script' }>;
  /** drop: p5 or an add-on. keep: another library, or code written in the page. local: one of the sketch's files. */
  action: 'drop' | 'keep' | 'local';
  path?: string;
  module: boolean;
  /** The code as it plays, once controls are wired. */
  code?: string;
}

interface SketchReading {
  indexPath: string | null;
  indexText: string;
  parts: HtmlPart[];
  scripts: ScriptPlan[];
  stylesheets: Set<string>;
  version: string | null;
  features: SketchFeatures;
  compatibility: P5Compatibility;
  canvas: P5CanvasPlan;
  controls: SketchControl[];
  notes: string[];
  fingerprint: string;
}

/** The p5.js version a sketch's files say they were written for. */
export function sketchP5Version(files: P5SketchFile[]): string | null {
  const index = findIndexHtml(files);
  const baseDir = index ? dirOf(index.path) : '';
  let localCore: string | null = null;
  for (const part of splitHtml(index ? fileText(index) ?? '' : '')) {
    if (part.kind !== 'script') continue;
    const src = attribute(part.attrs, 'src');
    if (!src || p5LibraryKind(src) !== 'core') continue;
    const version = p5VersionFromUrl(src);
    if (version) return version;
    if (!isExternalReference(src)) localCore ??= resolveSketchReference(src, baseDir);
  }
  const core = files.find((f) => f.path === localCore) ?? files.find((f) => p5LibraryKind(f.path) === 'core');
  return core?.text ? p5VersionFromHeader(core.text) : null;
}

function readSketch(sketch: JSAnimationSketch, versionHint: string | null): SketchReading {
  const files = sketch.files as P5SketchFile[];
  const notes: string[] = [];
  const byPath = new Map<string, SketchFile>();
  for (const file of files) byPath.set(file.path, file);

  const index = findIndexHtml(files);
  const indexText = index ? fileText(index) ?? '' : defaultIndexHtml(files);
  const baseDir = index ? dirOf(index.path) : '';
  const parts = splitHtml(indexText);

  // Scripts: p5 and its add-ons go (Ghost Arcade brings its own); the
  // sketch's own files and other libraries load as the page says.
  const remoteLibraries: string[] = [];
  const scripts: ScriptPlan[] = [];
  for (const part of parts) {
    if (part.kind !== 'script') continue;
    const src = attribute(part.attrs, 'src');
    const module = (attribute(part.attrs, 'type') ?? '').toLowerCase() === 'module';
    if (src === null) {
      scripts.push({ part, action: 'keep', module, code: part.body });
    } else if (p5LibraryKind(src)) {
      scripts.push({ part, action: 'drop', module });
    } else if (isExternalReference(src)) {
      remoteLibraries.push(src);
      scripts.push({ part, action: 'keep', module });
    } else {
      const path = resolveSketchReference(src, baseDir);
      const file = path ? byPath.get(path) : undefined;
      const code = file ? fileText(file) : null;
      if (!path || code === null) {
        notes.push(`index.html loads ${src}, which isn't in the sketch.`);
        scripts.push({ part, action: 'keep', module });
      } else {
        scripts.push({ part, action: 'local', path, module, code });
      }
    }
  }

  const stylesheets = new Set<string>();
  for (const part of parts) {
    if (part.kind !== 'text') continue;
    for (const tag of part.text.match(/<link\b[^>]*>/gi) ?? []) {
      const path = stylesheetPath(tag, baseDir);
      if (path && byPath.has(path)) stylesheets.add(path);
    }
  }

  // Everything for features and the canvas; classic scripts, which share one
  // global scope, for controls.
  const allCode = scripts.map((s) => s.code ?? '').join('\n;\n');
  const allTokens = tokenize(allCode);
  const features = sketchFeatures(allCode, allTokens);
  const version = sketchP5Version(files) ?? versionHint;
  const compatibility = p5Compatibility(version, features);
  const canvasCall = findCanvasCall(allTokens);
  const canvas = canvasPlan(canvasCall.size, drawsRelativeToCanvas(allTokens, canvasCall), features, sketch.canvas);

  const classic = scripts.filter((s) => s.action === 'local' && !s.module);
  const offsets: number[] = [];
  let classicCode = '';
  for (const s of classic) {
    offsets.push(classicCode.length);
    classicCode += `${s.code}\n;\n`;
  }
  const classicTokens = tokenize(classicCode);
  const controls = findControls(classicTokens, MAX_CONTROLS);
  // A control writes to its variable, so its `const` plays as `let  `: same
  // length, so every position in the file stays where the author put it.
  const rewrites = new Set(controls.filter((c) => c.keyword === 'const').map((c) => classicTokens[c.keywordIndex].start));
  for (const start of rewrites) {
    let fileIndex = offsets.length - 1;
    while (fileIndex > 0 && offsets[fileIndex] > start) fileIndex--;
    const s = classic[fileIndex];
    const at = start - offsets[fileIndex];
    s.code = `${s.code!.slice(0, at)}let  ${s.code!.slice(at + 5)}`;
  }

  for (const src of remoteLibraries) {
    notes.push(`Loads ${fileName(src.split(/[?#]/)[0])} from ${hostOf(src.startsWith('//') ? `https:${src}` : src)} each time it plays, so it needs the internet.`);
  }
  for (const file of files) {
    if (file.url && file.text === undefined && file.base64 === undefined) {
      notes.push(file.remote === 'failed'
        ? `${fileName(file.path)} couldn't be downloaded, so it loads from ${hostOf(file.url)} each time it plays.`
        : `${fileName(file.path)} loads from ${hostOf(file.url)} each time it plays.`);
    }
  }
  if (features.importsLocalModules) notes.push("Its modules import other files of the sketch, which a single page can't resolve.");
  if (features.usesMicrophone) notes.push("Listens to the microphone through p5.AudioIn, which pages in Ghost Arcade can't open.");
  else if (features.usesSound) notes.push('Uses p5.sound. It plays muted: a layer is a picture, and the show keeps its own sound.');
  if (features.usesCamera) notes.push("Opens a camera with createCapture(), which pages in Ghost Arcade can't do.");
  if (features.usesInput) notes.push("Reacts to the mouse or keyboard, which a layer doesn't receive.");

  return {
    indexPath: index?.path ?? null,
    indexText,
    parts,
    scripts,
    stylesheets,
    version,
    features,
    compatibility,
    canvas,
    controls,
    notes,
    fingerprint: fingerprint(sketch),
  };
}

const readings = new WeakMap<JSAnimationSketch, { key: string; reading: SketchReading }>();

function cachedReading(sketch: JSAnimationSketch, versionHint: string | null): SketchReading {
  const key = `${sketch.canvas ?? ''}|${versionHint ?? ''}|${sketch.files.length}`;
  const cached = readings.get(sketch);
  if (cached && cached.key === key) return cached.reading;
  const reading = readSketch(sketch, versionHint);
  readings.set(sketch, { key, reading });
  return reading;
}

// ---------------------------------------------------------------------------
// The pieces Ghost Arcade adds

function creditComment(options: WrapOptions): string {
  const origin = options.origin;
  const name = origin?.sketchName || 'Untitled sketch';
  const credit = origin?.author
    ? `p5.js sketch "${name}" by ${origin.author}${origin.url ? `, from the p5.js Web Editor: ${origin.url}` : ''}`
    : `p5.js sketch "${name}"`;
  return `<!-- ${commentText(credit)} -->`;
}

function controlsLiteral(controls: SketchControl[]): string {
  const values = controls.map((c) => `${c.name}: ${typeof c.value === 'boolean' ? String(c.value) : formatNumber(c.value)}`);
  return `window.shaderParams = { ${values.join(', ')} };`;
}

function headPieces(reading: SketchReading, options: WrapOptions, filesTable: Record<string, unknown> | null): string[] {
  const pieces = [creditComment(options), `<meta name="ghost-arcade-sketch" content="${reading.fingerprint}">`];
  if (filesTable && Object.keys(filesTable).length > 0) pieces.push(`<script>${oneLine(FILES_RUNTIME)}(${scriptJson(filesTable)});</script>`);
  if (reading.controls.length > 0) pieces.push(`<script>${controlsLiteral(reading.controls)}</script>`);
  pieces.push(`<script>${oneLine(CANVAS_RUNTIME)}(${scriptJson(reading.canvas.mode)}, ${reading.canvas.sharpen});</script>`);
  if (reading.features.usesSound) pieces.push(`<script src="${P5_SOUND_CDN}"></script>`);
  return pieces;
}

function controlsPiece(reading: SketchReading): string {
  return reading.controls.length > 0 ? `<script>${oneLine(controlsRuntime(reading.controls))}</script>` : '';
}

interface Edit {
  at: number;
  remove: number;
  insert: string;
}

function applyEdits(text: string, edits: Edit[]): string {
  let out = text;
  // From the end, so earlier offsets hold; at the same offset a removal goes
  // first, so text inserted there is not removed with it.
  for (const edit of [...edits].sort((a, b) => b.at - a.at || b.remove - a.remove)) {
    out = out.slice(0, edit.at) + edit.insert + out.slice(edit.at + edit.remove);
  }
  return out;
}

/** Where the added head goes: after <head>, else in a new head after <html>, else at the top. */
function headEdit(parts: HtmlPart[], insert: string): Edit {
  for (const part of parts) {
    if (part.kind !== 'text') continue;
    const head = /<head\b[^>]*>/i.exec(part.text);
    if (head) return { at: part.start + head.index + head[0].length, remove: 0, insert };
  }
  for (const part of parts) {
    if (part.kind !== 'text') continue;
    const html = /<html\b[^>]*>/i.exec(part.text);
    if (html) return { at: part.start + html.index + html[0].length, remove: 0, insert: `<head>${insert}</head>` };
  }
  const first = parts[0];
  const doctype = first?.kind === 'text' ? /^\s*<!doctype[^>]*>/i.exec(first.text) : null;
  return { at: doctype ? doctype[0].length : 0, remove: 0, insert: `<head>${insert}</head>` };
}

/** Before the last </body>, else at the end. */
function bodyEndEdit(parts: HtmlPart[], textLength: number, insert: string): Edit {
  for (let k = parts.length - 1; k >= 0; k--) {
    const part = parts[k];
    if (part.kind !== 'text') continue;
    const at = part.text.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    if (at >= 0) return { at: part.start + at, remove: 0, insert };
  }
  return { at: textLength, remove: 0, insert };
}

// ---------------------------------------------------------------------------
// The two forms of the page

function carriedOf(reading: SketchReading, files: SketchFile[]): { files: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const file of files) {
    if (file.path === reading.indexPath || reading.stylesheets.has(file.path)) continue;
    if (reading.scripts.some((s) => s.action === 'local' && s.path === file.path)) continue;
    const size = carriedSize(file);
    if (size === 0 && !file.text && !file.base64) continue;
    count++;
    bytes += size;
  }
  return { files: count, bytes };
}

/**
 * The sketch's own index.html with Ghost Arcade's pieces added on lines that
 * already exist, and its other files as they play beside it. The page is
 * what a sketch keeps as its htmlCode: it carries a fingerprint of every
 * file, so it changes whenever any of them does.
 */
export function wrapSketch(sketch: JSAnimationSketch, options: WrapOptions = {}): WrappedSketch {
  // The runtime asks every frame; the answer changes only with the sketch.
  const origin = options.origin;
  const key = `${sketch.canvas ?? ''}|${sketch.files.length}|${origin?.sketchName ?? ''}|${origin?.author ?? ''}|${origin?.url ?? ''}|${origin?.p5Version ?? ''}`;
  const cached = wrapped.get(sketch);
  if (cached && cached.key === key) return cached.result;
  const result = buildWrapped(sketch, options);
  wrapped.set(sketch, { key, result });
  return result;
}

const wrapped = new WeakMap<JSAnimationSketch, { key: string; result: WrappedSketch }>();

function buildWrapped(sketch: JSAnimationSketch, options: WrapOptions): WrappedSketch {
  const reading = cachedReading(sketch, options.origin?.p5Version ?? null);
  const remoteTable: Record<string, { type: string; url: string }> = {};
  for (const file of sketch.files) {
    if (file.url && file.text === undefined && file.base64 === undefined) {
      remoteTable[file.path] = { type: file.mime || mimeTypeFor(file.path), url: file.url };
    }
  }
  const edits: Edit[] = [headEdit(reading.parts, headPieces(reading, options, remoteTable).join(''))];
  // p5 and its add-on tags give way to the bundled copies; their line breaks
  // stay so every later line keeps its number.
  for (const s of reading.scripts) {
    if (s.action !== 'drop') continue;
    const tag = reading.indexText.slice(s.part.start, s.part.end);
    edits.push({ at: s.part.start, remove: tag.length, insert: tag.replace(/[^\n]/g, '') });
  }
  const controls = controlsPiece(reading);
  if (controls) edits.push(bodyEndEdit(reading.parts, reading.indexText.length, controls));
  const html = applyEdits(reading.indexText, edits);

  const rewritten = new Map(reading.scripts.filter((s) => s.action === 'local').map((s) => [s.path!, s.code!]));
  const files: SketchFile[] = [];
  for (const file of sketch.files) {
    if (file.path === reading.indexPath) continue;
    if (file.text === undefined && file.base64 === undefined) continue;
    const code = rewritten.get(file.path);
    const { remote: _remote, ...served } = file as P5SketchFile;
    files.push(code !== undefined && code !== fileText(file) ? { path: file.path, text: code, mime: served.mime } : served);
  }

  const parsed = jsAnimationFromHtml(html);
  return {
    html,
    files,
    params: parsed.params,
    paramValues: parsed.paramValues,
    p5Version: reading.version,
    compatibility: reading.compatibility,
    canvas: reading.canvas,
    controls: reading.controls.map((c) => c.name),
    notes: reading.notes,
    carried: carriedOf(reading, sketch.files),
  };
}

/** A line of a single-document page, as the author wrote it. */
export interface SketchPlace {
  file: string;
  line: number;
}

export interface SingleDocument {
  html: string;
  /**
   * The sketch file and line that line `line` of `html` came from, or null
   * for a line Ghost Arcade added.
   */
  place(line: number): SketchPlace | null;
}

/** Where a stretch of the folded page starts, and the file line it starts on. */
interface Anchor {
  at: number;
  file: string | null;
  line: number;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** Line numbers of offsets in `text`, counted once. */
function lineCounter(text: string): (offset: number) => number {
  const starts = lineStarts(text);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Traces lines of `html`, which is `applyEdits(before, edits)`, back through
 * the edits to the anchors laid down while `before` was built.
 */
function tracePlaces(before: string, html: string, edits: Edit[], anchors: Anchor[]): (line: number) => SketchPlace | null {
  const sorted = [...edits].sort((a, b) => a.at - b.at);
  const beforeLine = lineCounter(before);
  let starts: number[] | null = null;
  return (line) => {
    starts ??= lineStarts(html);
    if (!(line >= 1) || line > starts.length) return null;
    const final = starts[line - 1];
    let delta = 0;
    for (const edit of sorted) {
      const start = edit.at + delta;
      if (final < start) break;
      // A line that starts inside an added piece is Ghost Arcade's.
      if (final < start + edit.insert.length) return null;
      delta += edit.insert.length - edit.remove;
    }
    const offset = final - delta;
    let anchor: Anchor | null = null;
    for (const a of anchors) {
      if (a.at > offset) break;
      anchor = a;
    }
    if (!anchor?.file) return null;
    return { file: anchor.file, line: anchor.line + beforeLine(offset) - beforeLine(anchor.at) };
  };
}

/**
 * The sketch as one document: its scripts and style sheets folded in, and
 * its files carried inside the page (up to MAX_CARRIED_TOTAL_BYTES) where a
 * small loader hands them to p5 by path. This is how a sketch plays in an
 * iframe. Each folded script keeps its lines, starting on a line of its
 * own, so `place` can name the file and line behind any line of the page.
 */
export function singleSketchDocument(sketch: JSAnimationSketch, options: WrapOptions = {}): SingleDocument {
  const reading = cachedReading(sketch, options.origin?.p5Version ?? null);
  const byPath = new Map<string, SketchFile>();
  for (const file of sketch.files) byPath.set(file.path, file);
  const baseDir = reading.indexPath ? dirOf(reading.indexPath) : '';
  const inlined = new Set<string>([...reading.stylesheets]);
  if (reading.indexPath) inlined.add(reading.indexPath);
  for (const s of reading.scripts) if (s.action === 'local' && s.path) inlined.add(s.path);

  const table: Record<string, { type: string; text?: string; b64?: string; url?: string }> = {};
  const carriedByPath = new Map<string, SketchFile>();
  let budget = MAX_CARRIED_TOTAL_BYTES;
  for (const file of sketch.files) {
    if (inlined.has(file.path)) continue;
    const type = file.mime || mimeTypeFor(file.path);
    const size = carriedSize(file);
    if ((file.text !== undefined || file.base64 !== undefined) && size <= MAX_CARRIED_FILE_BYTES && size <= budget) {
      table[file.path] = file.text !== undefined ? { type, text: file.text } : { type, b64: file.base64 };
      carriedByPath.set(file.path, file);
      budget -= size;
    } else if (file.url) {
      table[file.path] = { type, url: file.url };
    }
  }

  /** A <link> to one of the sketch's style sheets as the sheet itself; '' drops the tag; null keeps it. */
  const foldStylesheet = (tag: string): { path: string; css: string } | '' | null => {
    const path = stylesheetPath(tag, baseDir);
    if (path === undefined) return null;
    const file = path ? byPath.get(path) : undefined;
    const css = file ? fileText(file) : null;
    if (!path || css === null) return '';
    const cssDir = dirOf(path);
    const folded = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote: string, ref: string) => {
      const target = resolveSketchReference(ref, cssDir);
      const carried = target ? carriedByPath.get(target) : undefined;
      const url = carried ? dataUrl(carried) : null;
      return url ? `url("${url}")` : match;
    });
    return { path, css: escapeStyle(folded) };
  };
  const rewriteMedia = (text: string): string => text.replace(/<(img|video|audio|source)\b[^>]*>/gi, (tag) => tag.replace(
    /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)')/i,
    (match, lead: string, dq?: string, sq?: string) => {
      const target = resolveSketchReference(dq ?? sq ?? '', baseDir);
      const carried = target ? carriedByPath.get(target) : undefined;
      const url = carried ? dataUrl(carried) : null;
      return url ? `${lead}"${url}"` : match;
    },
  ));

  const indexLine = lineCounter(reading.indexText);
  const indexFile = reading.indexPath;
  const anchors: Anchor[] = [];
  let out = '';
  const appendMarkup = (text: string, start: number) => {
    const linkTag = /<link\b[^>]*>/gi;
    let at = 0;
    for (let m = linkTag.exec(text); m; m = linkTag.exec(text)) {
      const folded = foldStylesheet(m[0]);
      if (folded === null) continue;
      anchors.push({ at: out.length, file: indexFile, line: indexLine(start + at) });
      out += rewriteMedia(text.slice(at, m.index));
      if (folded) {
        out += '<style>\n';
        anchors.push({ at: out.length, file: folded.path, line: 1 });
        out += `${folded.css}\n</style>`;
      }
      at = m.index + m[0].length;
    }
    anchors.push({ at: out.length, file: indexFile, line: indexLine(start + at) });
    out += rewriteMedia(text.slice(at));
  };

  const plans = new Map(reading.scripts.map((s) => [s.part, s]));
  for (const part of reading.parts) {
    if (part.kind === 'comment') continue;
    if (part.kind === 'text') {
      appendMarkup(part.text, part.start);
      continue;
    }
    const plan = plans.get(part)!;
    if (plan.action === 'drop') continue;
    if (plan.action === 'keep') {
      anchors.push({ at: out.length, file: indexFile, line: indexLine(part.start) });
      out += `<script${part.attrs}>`;
      anchors.push({ at: out.length, file: indexFile, line: indexLine(reading.indexText.indexOf('>', part.start) + 1) });
      out += `${part.body}</script>`;
      continue;
    }
    out += `<script${plan.module ? ' type="module"' : ''}>\n`;
    anchors.push({ at: out.length, file: plan.path!, line: 1 });
    out += `${escapeScript(plan.code ?? '')}\n</script>`;
  }
  const parts = splitHtml(out);
  const edits = [headEdit(parts, `\n${headPieces(reading, options, table).join('\n')}\n`)];
  const controls = controlsPiece(reading);
  if (controls) edits.push(bodyEndEdit(parts, out.length, `${controls}\n`));
  const html = applyEdits(out, edits);
  return { html, place: tracePlaces(out, html, edits, anchors) };
}

/** The sketch as one document, without the line tracing. */
export function singleSketchPage(sketch: JSAnimationSketch, options: WrapOptions = {}): string {
  return singleSketchDocument(sketch, options).html;
}

// ---------------------------------------------------------------------------
// Sources and playback

function sameValue(a: JSAnimationParamValue | undefined, b: JSAnimationParamValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/**
 * The media source for a sketch's files, new or edited. Its controls are
 * read again from the code, so one the code adds appears at once and one it
 * removes goes away. A slider the user moved keeps its value unless the edit
 * changed the value the code itself starts it at: then the code wins,
 * because that is the change the user just made.
 */
export function sketchSource(
  sketch: JSAnimationSketch,
  options: { previous?: JSAnimationSource | null; origin?: JSAnimationOrigin | null } = {},
): JSAnimationSource {
  const previous = options.previous ?? null;
  const origin = options.origin ?? previous?.origin;
  const wrapped = wrapSketch(sketch, { origin });
  const paramValues: Record<string, JSAnimationParamValue> = {};
  for (const param of wrapped.params ?? []) {
    const fromCode = wrapped.paramValues?.[param.name] ?? param.default;
    const set = previous?.paramValues?.[param.name];
    const before = previous?.params?.find((p) => p.name === param.name)?.default;
    paramValues[param.name] = set !== undefined && before !== undefined && sameValue(before, fromCode) ? set : fromCode;
  }
  const source: JSAnimationSource = {
    ...(previous ?? {}),
    animationType: 'p5js',
    htmlCode: wrapped.html,
    sketch,
    params: wrapped.params,
    paramValues: wrapped.params ? paramValues : undefined,
  };
  if (origin) source.origin = origin;
  return source;
}

/**
 * What plays for a JavaScript source: for a sketch kept as files, the page
 * the wrapper builds from them now; for any other page, its HTML as stored.
 */
export function playablePage(source: Pick<JSAnimationSource, 'htmlCode' | 'sketch' | 'origin'>): { html: string; files?: SketchFile[] } {
  if (!source.sketch) return { html: source.htmlCode };
  const wrapped = wrapSketch(source.sketch, { origin: source.origin });
  return { html: wrapped.html, files: wrapped.files };
}

/**
 * The same page as one document, for an iframe, with where its lines came
 * from. A page that is not kept as files is its own index.html.
 */
export function singlePlayableDocument(source: Pick<JSAnimationSource, 'htmlCode' | 'sketch' | 'origin'>): SingleDocument {
  if (source.sketch) return singleSketchDocument(source.sketch, { origin: source.origin });
  return { html: source.htmlCode, place: (line) => (line >= 1 ? { file: 'index.html', line } : null) };
}

/** The same page as one document, for an iframe. */
export function singlePlayablePage(source: Pick<JSAnimationSource, 'htmlCode' | 'sketch' | 'origin'>): string {
  return source.sketch ? singleSketchPage(source.sketch, { origin: source.origin }) : source.htmlCode;
}
