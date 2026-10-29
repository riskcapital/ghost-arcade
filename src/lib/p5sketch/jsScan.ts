/**
 * Reading a p5.js sketch's code without running it.
 *
 * A tokenizer that understands strings, template literals, comments and
 * regular expressions well enough to tell code from text, and the questions
 * the importer asks of a sketch: how it sizes its canvas, which top-level
 * values can become controls, and which p5 features it relies on.
 */

export type TokenKind = 'ident' | 'num' | 'string' | 'template' | 'regex' | 'punct';

export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
  line: number;
  /** How many (), [] and {} enclose the token. An opener and its closer share it. */
  depth: number;
}

const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '**', '<<', '>>',
];

// After these words an expression starts, so a `/` begins a regular expression.
const EXPRESSION_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else',
  'yield', 'await',
]);

const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/;
const IDENT = /^#?[A-Za-z_$\u00a0-\uffff][\w$\u00a0-\uffff]*/;

function regexAllowed(prev: Token | undefined): boolean {
  if (!prev) return true;
  if (prev.kind === 'ident') return EXPRESSION_KEYWORDS.has(prev.value);
  if (prev.kind !== 'punct') return false;
  return prev.value !== ')' && prev.value !== ']' && prev.value !== '}';
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let depth = 0;
  // Depth inside each open `${ ... }` of a template literal.
  const substitutions: number[] = [];

  const countLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (source.charCodeAt(k) === 10) line++;
  };

  // Scans template text from `from` (just after ` or }) to the closing
  // backtick or the next `${`. Returns where scanning stopped.
  const scanTemplate = (from: number): number => {
    let k = from;
    while (k < n) {
      const c = source[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '`') {
        k++;
        tokens.push({ kind: 'template', value: source.slice(from - 1, k), start: from - 1, end: k, line, depth });
        countLines(from, k);
        return k;
      }
      if (c === '$' && source[k + 1] === '{') {
        tokens.push({ kind: 'template', value: source.slice(from - 1, k), start: from - 1, end: k, line, depth });
        countLines(from, k);
        tokens.push({ kind: 'punct', value: '${', start: k, end: k + 2, line, depth });
        depth++;
        substitutions.push(depth);
        return k + 2;
      }
      k++;
    }
    countLines(from, n);
    return n;
  };

  while (i < n) {
    const c = source[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\ufeff' || c === '\u00a0') { i++; continue; }
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end < 0 ? n : end;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      countLines(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && source[k] !== c && source[k] !== '\n') k += source[k] === '\\' ? 2 : 1;
      const end = Math.min(n, k + 1);
      tokens.push({ kind: 'string', value: source.slice(i, end), start: i, end, line, depth });
      i = end;
      continue;
    }
    if (c === '`') {
      i = scanTemplate(i + 1);
      continue;
    }
    if (c === '/' && regexAllowed(tokens[tokens.length - 1])) {
      let k = i + 1;
      let inClass = false;
      while (k < n && source[k] !== '\n') {
        const ch = source[k];
        if (ch === '\\') { k += 2; continue; }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        k++;
      }
      k++;
      while (k < n && /[a-z]/i.test(source[k])) k++;
      tokens.push({ kind: 'regex', value: source.slice(i, k), start: i, end: k, line, depth });
      i = k;
      continue;
    }
    const rest = source.slice(i, i + 64);
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const m = NUMBER.exec(rest);
      const len = m ? m[0].length : 1;
      tokens.push({ kind: 'num', value: source.slice(i, i + len), start: i, end: i + len, line, depth });
      i += len;
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      // Long names run past the 64-character window; take them whole.
      let k = i + ident[0].length;
      while (k < n && /[\w$\u00a0-\uffff]/.test(source[k])) k++;
      tokens.push({ kind: 'ident', value: source.slice(i, k), start: i, end: k, line, depth });
      i = k;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      tokens.push({ kind: 'punct', value: c, start: i, end: i + 1, line, depth });
      depth++;
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      if (c === '}' && substitutions.length > 0 && substitutions[substitutions.length - 1] === depth) {
        substitutions.pop();
        depth--;
        tokens.push({ kind: 'punct', value: '}', start: i, end: i + 1, line, depth });
        i = scanTemplate(i + 1);
        continue;
      }
      depth = Math.max(0, depth - 1);
      tokens.push({ kind: 'punct', value: c, start: i, end: i + 1, line, depth });
      i++;
      continue;
    }
    const op = PUNCTUATORS.find((p) => source.startsWith(p, i)) ?? c;
    tokens.push({ kind: 'punct', value: op, start: i, end: i + op.length, line, depth });
    i += op.length;
  }
  return tokens;
}

/** Index of the token that closes the bracket opened at `open`. */
export function closingIndex(tokens: Token[], open: number): number {
  const closer = { '(': ')', '[': ']', '{': '}', '${': '}' }[tokens[open]?.value ?? ''];
  if (!closer) return -1;
  const depth = tokens[open].depth;
  for (let k = open + 1; k < tokens.length; k++) {
    if (tokens[k].depth === depth && tokens[k].value === closer) return k;
    if (tokens[k].depth < depth) return -1;
  }
  return -1;
}

function isPropertyAccess(tokens: Token[], index: number): boolean {
  const prev = tokens[index - 1];
  return !!prev && (prev.value === '.' || prev.value === '?.');
}

/** True where `tokens[index]` is the variable of that name, not a property. */
function isVariable(tokens: Token[], index: number, name: string): boolean {
  const token = tokens[index];
  if (token.kind !== 'ident' || token.value !== name || isPropertyAccess(tokens, index)) return false;
  // `{ name: value }` keys are not the variable.
  const prev = tokens[index - 1]?.value;
  return !(tokens[index + 1]?.value === ':' && (prev === '{' || prev === ','));
}

/** [first, last] token indices of a function body, braces included. */
export type TokenRange = [number, number];

/** Bodies of the functions declared at the top level, by name. */
export function topLevelFunctions(tokens: Token[]): Map<string, TokenRange> {
  const out = new Map<string, TokenRange>();
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.depth !== 0 || t.kind !== 'ident' || t.value !== 'function') continue;
    let j = k + 1;
    if (tokens[j]?.value === '*') j++;
    const name = tokens[j];
    if (name?.kind !== 'ident' || tokens[j + 1]?.value !== '(') continue;
    const paramsEnd = closingIndex(tokens, j + 1);
    if (paramsEnd < 0 || tokens[paramsEnd + 1]?.value !== '{') continue;
    const bodyEnd = closingIndex(tokens, paramsEnd + 1);
    if (bodyEnd < 0) continue;
    out.set(name.value, [paramsEnd + 1, bodyEnd]);
    k = bodyEnd;
  }
  return out;
}

/** Constructor bodies of the classes declared at the top level, by class name. */
export function topLevelConstructors(tokens: Token[]): Map<string, TokenRange> {
  const out = new Map<string, TokenRange>();
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.depth !== 0 || t.kind !== 'ident' || t.value !== 'class') continue;
    const name = tokens[k + 1];
    if (name?.kind !== 'ident') continue;
    let open = k + 2;
    while (open < tokens.length && !(tokens[open].value === '{' && tokens[open].depth === 0)) open++;
    const close = closingIndex(tokens, open);
    if (close < 0) continue;
    for (let m = open + 1; m < close; m++) {
      if (tokens[m].depth !== 1 || tokens[m].value !== 'constructor' || tokens[m + 1]?.value !== '(') continue;
      const paramsEnd = closingIndex(tokens, m + 1);
      const bodyEnd = paramsEnd >= 0 && tokens[paramsEnd + 1]?.value === '{' ? closingIndex(tokens, paramsEnd + 1) : -1;
      if (bodyEnd >= 0) out.set(name.value, [paramsEnd + 1, bodyEnd]);
      break;
    }
    k = close;
  }
  return out;
}

/**
 * The code that runs while the sketch starts: preload() and setup(), the
 * top-level functions they call, and the constructors of the classes they
 * create, followed through as far as they go.
 */
export function startupRanges(tokens: Token[]): TokenRange[] {
  const functions = topLevelFunctions(tokens);
  const constructors = topLevelConstructors(tokens);
  const ranges: TokenRange[] = [];
  const seen = new Set<string>();
  const queue: Array<[string, TokenRange]> = [];
  const enqueue = (key: string, range: TokenRange | undefined) => {
    if (!range || seen.has(key)) return;
    seen.add(key);
    queue.push([key, range]);
  };
  enqueue('fn:preload', functions.get('preload'));
  enqueue('fn:setup', functions.get('setup'));
  while (queue.length > 0) {
    const [, range] = queue.shift()!;
    ranges.push(range);
    for (let k = range[0]; k <= range[1]; k++) {
      const t = tokens[k];
      if (t.kind !== 'ident' || isPropertyAccess(tokens, k)) continue;
      if (tokens[k - 1]?.value === 'new') enqueue(`new:${t.value}`, constructors.get(t.value));
      // Called, or handed on as a callback (loadJSON(path, gotData)).
      else enqueue(`fn:${t.value}`, functions.get(t.value));
    }
  }
  return ranges;
}

export interface TopLevelValue {
  name: string;
  keyword: 'let' | 'const' | 'var';
  /** Index of the let/const/var token. */
  keywordIndex: number;
  /** Index of the name in its declaration. */
  nameIndex: number;
  value: number | boolean;
}

// Tokens that carry an expression on past a line break, so the literal
// before them is not the whole initializer.
const CONTINUES_EXPRESSION = new Set([
  '.', '?.', '(', '[', '+', '-', '*', '/', '%', '**', '?', ':', '&&', '||', '??', '&', '|', '^',
  '<', '>', '<=', '>=', '==', '!=', '===', '!==', '<<', '>>', '>>>', '=', ',', '`',
]);

function literalValue(token: Token | undefined, negative: boolean): number | boolean | null {
  if (!token) return null;
  if (token.kind === 'num') {
    if (/n$/.test(token.value)) return null;
    const value = Number(token.value.replace(/_/g, ''));
    return Number.isFinite(value) ? (negative ? -value : value) : null;
  }
  if (!negative && token.kind === 'ident' && (token.value === 'true' || token.value === 'false')) return token.value === 'true';
  return null;
}

/** `let/const/var name = <number or boolean>` declared at the top level. */
export function topLevelValues(tokens: Token[]): TopLevelValue[] {
  const out: TopLevelValue[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const keyword = tokens[k];
    if (keyword.depth !== 0 || keyword.kind !== 'ident' || isPropertyAccess(tokens, k)) continue;
    if (keyword.value !== 'let' && keyword.value !== 'const' && keyword.value !== 'var') continue;
    let j = k + 1;
    for (;;) {
      const name = tokens[j];
      if (name?.kind !== 'ident') break;
      if (tokens[j + 1]?.value !== '=') {
        if (tokens[j + 1]?.value === ',') { j += 2; continue; }
        break;
      }
      const negative = tokens[j + 2]?.value === '-';
      const literalIndex = j + 2 + (negative ? 1 : 0);
      const literal = tokens[literalIndex];
      const value = literalValue(literal, negative);
      const after = tokens[literalIndex + 1];
      const ends = !after
        || after.value === ';'
        || after.value === ','
        || after.value === '}'
        || (after.line > literal.line && !CONTINUES_EXPRESSION.has(after.value));
      if (value === null || !ends) break;
      out.push({ name: name.value, keyword: keyword.value, keywordIndex: k, nameIndex: j, value });
      if (after?.value !== ',') break;
      j = literalIndex + 2;
    }
  }
  return out;
}

const ASSIGNMENT_OPERATORS = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=',
]);

function isAssignedAt(tokens: Token[], index: number): boolean {
  const next = tokens[index + 1]?.value;
  const prev = tokens[index - 1]?.value;
  return (next !== undefined && ASSIGNMENT_OPERATORS.has(next)) || next === '++' || next === '--' || prev === '++' || prev === '--';
}

const EQUALITY = new Set(['==', '===', '!=', '!==']);

/** A value tested for equality (`axis === Y_AXIS`, `case MODE:`) names a choice, not an amount. */
function isComparedAt(tokens: Token[], index: number): boolean {
  const next = tokens[index + 1]?.value;
  const prev = tokens[index - 1]?.value;
  return (next !== undefined && EQUALITY.has(next)) || (prev !== undefined && (EQUALITY.has(prev) || prev === 'case'));
}

// p5's own globals: a sketch that declares one shadows p5, and a control for
// it would fight the library.
const P5_GLOBALS = new Set([
  'width', 'height', 'frameCount', 'deltaTime', 'mouseX', 'mouseY', 'pmouseX', 'pmouseY', 'windowWidth',
  'windowHeight', 'displayWidth', 'displayHeight', 'focused', 'key', 'keyCode', 'pixels', 'touches',
]);

export interface SketchControl {
  name: string;
  value: number | boolean;
  /** Index of the let/const/var token, so a `const` can become `let`. */
  keywordIndex: number;
  keyword: 'let' | 'const' | 'var';
}

/**
 * Top-level numbers and switches that can be turned while the sketch plays:
 * read somewhere, never changed by the sketch itself, not used while it
 * starts up (a value that sized an array in setup() would break it), and
 * not a named choice compared for equality.
 */
export function findControls(tokens: Token[], limit = 8): SketchControl[] {
  const startup = startupRanges(tokens);
  const inStartup = (k: number) => startup.some(([a, b]) => k >= a && k <= b);
  const declared = topLevelValues(tokens);
  const names = new Map<string, number>();
  for (const d of declared) names.set(d.name, (names.get(d.name) ?? 0) + 1);
  const out: SketchControl[] = [];
  for (const d of declared) {
    if (out.length >= limit) break;
    if (names.get(d.name) !== 1 || P5_GLOBALS.has(d.name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(d.name)) continue;
    if (typeof d.value === 'number' && (d.value < 0 || (d.value !== 0 && (Math.abs(d.value) < 1e-6 || Math.abs(d.value) > 1e9)))) continue;
    let read = false;
    let disqualified = false;
    for (let k = 0; k < tokens.length && !disqualified; k++) {
      if (k === d.nameIndex || !isVariable(tokens, k, d.name)) continue;
      if (isAssignedAt(tokens, k) || isComparedAt(tokens, k) || inStartup(k)) disqualified = true;
      else read = true;
    }
    if (read && !disqualified) out.push({ name: d.name, value: d.value, keywordIndex: d.keywordIndex, keyword: d.keyword });
  }
  return out;
}

export type CanvasSize =
  | { kind: 'fixed'; width: number; height: number }
  /** createCanvas(windowWidth, windowHeight): already fills its window. */
  | { kind: 'window' }
  /** Sized by an expression the sketch works out itself. */
  | { kind: 'computed' }
  /** Never calls createCanvas, so p5 makes its default 100 × 100 canvas. */
  | { kind: 'none' };

export interface CanvasCall {
  size: CanvasSize;
  /** Token index ranges of the call's arguments, and of declarations it used. */
  ownTokens: TokenRange[];
  /** Names of top-level values the size came from. */
  sizeNames: string[];
}

function splitArguments(tokens: Token[], open: number, close: number): TokenRange[] {
  const args: TokenRange[] = [];
  const depth = tokens[open].depth + 1;
  let start = open + 1;
  for (let k = open + 1; k <= close; k++) {
    if (k === close || (tokens[k].value === ',' && tokens[k].depth === depth)) {
      if (k > start) args.push([start, k - 1]);
      start = k + 1;
    }
  }
  return args;
}

/** How the sketch sizes its canvas, from its createCanvas() call. */
export function findCanvasCall(tokens: Token[]): CanvasCall {
  const setup = topLevelFunctions(tokens).get('setup');
  const calls: number[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].kind === 'ident' && tokens[k].value === 'createCanvas' && tokens[k + 1]?.value === '(') calls.push(k);
  }
  if (calls.length === 0) return { size: { kind: 'none' }, ownTokens: [], sizeNames: [] };
  const call = calls.find((k) => setup && k > setup[0] && k < setup[1]) ?? calls[0];
  const close = closingIndex(tokens, call + 1);
  if (close < 0) return { size: { kind: 'computed' }, ownTokens: [], sizeNames: [] };
  const args = splitArguments(tokens, call + 1, close);
  const ownTokens: TokenRange[] = [[call + 1, close]];
  const values = topLevelValues(tokens);
  const sizeNames: string[] = [];
  const dimension = (range: TokenRange | undefined): number | 'window-w' | 'window-h' | null => {
    if (!range || range[0] !== range[1]) return null;
    const t = tokens[range[0]];
    if (t.kind === 'num') return Number(t.value);
    if (t.kind !== 'ident') return null;
    if (t.value === 'windowWidth') return 'window-w';
    if (t.value === 'windowHeight') return 'window-h';
    const declared = values.find((v) => v.name === t.value && typeof v.value === 'number');
    if (!declared) return null;
    sizeNames.push(declared.name);
    ownTokens.push([declared.keywordIndex, declared.nameIndex + 3]);
    return declared.value as number;
  };
  const w = dimension(args[0]);
  const h = dimension(args[1]);
  if (w === 'window-w' && h === 'window-h') return { size: { kind: 'window' }, ownTokens, sizeNames: [] };
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
    return { size: { kind: 'fixed', width: Math.round(w), height: Math.round(h) }, ownTokens, sizeNames };
  }
  return { size: { kind: 'computed' }, ownTokens, sizeNames: [] };
}

// Their numbers are colours, not positions or sizes.
const COLOR_CALLS = new Set(['fill', 'stroke', 'background', 'color', 'tint', 'colorMode', 'lerpColor', 'ambientLight', 'directionalLight', 'pointLight', 'specularMaterial', 'ambientMaterial', 'emissiveMaterial']);

/** The function a token is an argument of, when it sits directly in a call's parentheses. */
function enclosingCall(tokens: Token[], index: number): string | null {
  const depth = tokens[index].depth - 1;
  for (let k = index - 1; k >= 0; k--) {
    const t = tokens[k];
    if (t.depth < depth) return null;
    if (t.depth === depth && t.value === '(') return tokens[k - 1]?.kind === 'ident' ? tokens[k - 1].value : null;
  }
  return null;
}

/**
 * True when a fixed-size sketch draws from `width` and `height` rather than
 * from its canvas numbers, so it still composes on a canvas of another size.
 */
export function drawsRelativeToCanvas(tokens: Token[], call: CanvasCall): boolean {
  if (call.size.kind !== 'fixed') return false;
  const { width, height } = call.size;
  const hardCoded = new Set([width, height, width / 2, height / 2].filter((v) => Number.isInteger(v) && v >= 16));
  const own = (k: number) => call.ownTokens.some(([a, b]) => k >= a && k <= b);
  let relative = 0;
  for (let k = 0; k < tokens.length; k++) {
    if (own(k)) continue;
    const t = tokens[k];
    if (t.kind === 'num' && hardCoded.has(Number(t.value)) && !COLOR_CALLS.has(enclosingCall(tokens, k) ?? '')) return false;
    if (t.kind !== 'ident' || isPropertyAccess(tokens, k)) continue;
    if (call.sizeNames.includes(t.value)) return false;
    if (t.value === 'width' || t.value === 'height') relative++;
  }
  return relative > 0;
}

function callsAny(tokens: Token[], names: Set<string>): string[] {
  const found = new Set<string>();
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === 'ident' && names.has(t.value) && tokens[k + 1]?.value === '(' && !isPropertyAccess(tokens, k)) found.add(t.value);
  }
  return [...found];
}

function mentionsAny(tokens: Token[], names: Set<string>): boolean {
  return tokens.some((t, k) => t.kind === 'ident' && names.has(t.value) && !isPropertyAccess(tokens, k));
}

const PIXEL_ARRAY = new Set(['pixels', 'loadPixels', 'updatePixels']);
const INPUT_HANDLERS = new Set([
  'mousePressed', 'mouseReleased', 'mouseClicked', 'mouseDragged', 'mouseMoved', 'mouseWheel', 'doubleClicked',
  'keyPressed', 'keyReleased', 'keyTyped', 'touchStarted', 'touchMoved', 'touchEnded',
]);
const INPUT_STATE = new Set(['mouseX', 'mouseY', 'pmouseX', 'pmouseY', 'mouseIsPressed', 'keyIsPressed', 'keyIsDown', 'touches']);

// Added in p5.js 2.0; p5.js 1.11 has none of them.
const P5_V2_FUNCTIONS = new Set([
  'splineVertex', 'splineProperty', 'splineProperties', 'bezierOrder', 'textWeight', 'textToContours',
  'textToModel', 'fontBounds', 'fontWidth', 'loadFilterShader', 'baseFilterShader', 'buildFilterShader',
  'buildMaterialShader', 'buildNormalShader', 'buildColorShader', 'buildStrokeShader',
]);
// p5.js 2.0 loaders return promises; in 1.x they return an object that fills in later.
const AWAITED_LOADER = /\bawait\s+(?:[\w$]+\.)?(load(?:Image|Font|JSON|Strings|Table|XML|Bytes|Blob|Model|Shader|Sound))\s*\(/;
const P5_SOUND = /\b(?:loadSound|soundFormats|getAudioContext|userStartAudio|outputVolume|masterVolume)\s*\(|\bp5\.(?:SoundFile|Amplitude|FFT|AudioIn|Oscillator|SinOsc|TriOsc|SawOsc|SqrOsc|Pulse|Noise|Envelope|Env|Delay|Reverb|Convolver|Filter|LowPass|HighPass|BandPass|EQ|Panner3D|Compressor|Distortion|Gain|PeakDetect|SoundRecorder|MonoSynth|PolySynth|Phrase|Part|Score|SoundLoop)\b/;
const LOCAL_MODULE_IMPORT = /\bimport\s*(?:[\w$*{}\s,]+from\s*)?\(?\s*["']\.{0,2}\//;

export interface SketchFeatures {
  usesPixelArray: boolean;
  setsPixelDensity: boolean;
  usesInput: boolean;
  usesCamera: boolean;
  usesMicrophone: boolean;
  usesSound: boolean;
  importsLocalModules: boolean;
  /** p5.js 2.x features the sketch relies on, by name. */
  v2Features: string[];
}

export function sketchFeatures(source: string, tokens = tokenize(source)): SketchFeatures {
  const declared = topLevelFunctions(tokens);
  const v2 = callsAny(tokens, P5_V2_FUNCTIONS);
  const awaited = AWAITED_LOADER.exec(source);
  if (awaited) v2.unshift(`await ${awaited[1]}()`);
  return {
    usesPixelArray: mentionsAny(tokens, PIXEL_ARRAY),
    setsPixelDensity: callsAny(tokens, new Set(['pixelDensity'])).length > 0,
    usesInput: [...INPUT_HANDLERS].some((name) => declared.has(name)) || mentionsAny(tokens, INPUT_STATE),
    usesCamera: callsAny(tokens, new Set(['createCapture'])).length > 0,
    usesMicrophone: /\bp5\.AudioIn\b/.test(source),
    usesSound: P5_SOUND.test(source),
    importsLocalModules: LOCAL_MODULE_IMPORT.test(source),
    v2Features: v2,
  };
}
