/**
 * Ghost Arcade tips: what helps a p5.js sketch on a projector, in a stack of
 * layers, at a show.
 *
 * Tips are about the user's own code, in plain p5.js: the sketch stays the
 * same sketch that runs in the p5.js Web Editor. Whatever Ghost Arcade does by
 * itself when the sketch plays (sizing the canvas to the output, making
 * controls of its top-level values, its audio) is said as such, so nobody
 * changes code for something already handled. Where a change to the code
 * helps and can be made safely without understanding the whole sketch, the
 * tip carries a one-click fix; otherwise it explains.
 */
import type { SyntaxNode } from '@lezer/common';
import type { SketchLink } from './sketchConcepts';
import { p5Reference } from './sketchConcepts';
import { SketchEdit, formatNumber } from './sketchEdit';
import {
  callArgs,
  callee,
  enclosingFunctionName,
  findFunction,
  isInside,
  lineAt,
  numberValue,
  readSketchFile,
  sameNode,
  stringValue,
  textOf,
  walkCode,
  type CodeNode,
  type ScriptBlock,
  type SketchLanguage,
  type SketchSource,
  type TextChange,
} from './sketchSource';

export type TipKind = 'canvas' | 'mouse' | 'sound' | 'files' | 'colour' | 'performance' | 'timing' | 'audio';

export interface SketchFix {
  id: string;
  label: string;
  changes: TextChange[];
}

export interface SketchTip {
  id: string;
  kind: TipKind;
  severity: 'warning' | 'suggestion' | 'info';
  title: string;
  body: string;
  /** Every place the tip is about, as offsets in the file. */
  ranges: Array<{ from: number; to: number }>;
  line: number;
  fixes: SketchFix[];
  links: SketchLink[];
}

/** What Ghost Arcade does for a sketch when it plays, as far as the tips need to know. */
export interface SketchRuntime {
  /** How the canvas meets the output: 'fill' grows it to the output, 'fit' keeps its size and scales it. */
  canvas?: { mode: 'fill' | 'fit'; reason?: string };
  /** p5.AudioIn, p5.Amplitude and p5.FFT hear the show's audio. */
  soundFromShow?: boolean;
  /** Top-level colour values become colour controls. */
  colourControls?: boolean;
}

/** How the canvas meets the output, in a sentence about this sketch. */
export function canvasSentence(canvas: NonNullable<SketchRuntime['canvas']>): string {
  if (canvas.reason) return canvas.reason.replace(/^It /, 'The sketch ');
  return canvas.mode === 'fit'
    ? 'The sketch keeps its canvas size, scaled to fit the output.'
    : "The sketch's canvas grows to fill the output.";
}

export interface SketchTipOptions {
  language?: SketchLanguage;
  /** Paths of the sketch's own files, to tell the files it loads from ones it lacks. */
  files?: string[];
  runtime?: SketchRuntime;
}

const KIND_ORDER: TipKind[] = ['mouse', 'sound', 'files', 'canvas', 'colour', 'performance', 'timing', 'audio'];
const MAX_COLOUR_TIPS = 6;

// ─── Shared reading ────────────────────────────────────────────────────────

interface Call {
  n: CodeNode;
  name: string;
  /** The instance-mode object (`p` in `p.fill()`), or null in global mode. */
  object: string | null;
  args: SyntaxNode[];
}

function p5Calls(source: SketchSource, names: Set<string>): Call[] {
  const calls: Call[] = [];
  walkCode(source, (n) => {
    if (n.node.name !== 'CallExpression') return;
    const target = callee(n.block, n.node);
    if (!target || !names.has(target.name)) return;
    if (target.object !== null && !/^[A-Za-z_$][\w$]*$/.test(target.object)) return;
    if (target.object === 'Math' || target.object === 'drawingContext') return;
    calls.push({ n, name: target.name, object: target.object, args: callArgs(n.node) });
  });
  return calls;
}

/** Reads of a global name (`mouseX`), not declarations or property names. */
function nameReads(source: SketchSource, names: Set<string>): CodeNode[] {
  const out: CodeNode[] = [];
  walkCode(source, (n) => {
    if (n.node.name === 'VariableName' && names.has(textOf(n.block, n.node))) out.push(n);
  });
  return out;
}

function isGlobalMode(source: SketchSource): boolean {
  return !!(findFunction(source, 'draw') || findFunction(source, 'setup'));
}

function rangeOf(n: { from: number; to: number }) {
  return { from: n.from, to: n.to };
}

function codeNodeOf(block: ScriptBlock, node: SyntaxNode): CodeNode {
  return { node, block, from: block.from + node.from, to: block.from + node.to };
}

/** Wrap a replacement in brackets unless it already stands alone where it goes. */
function inPlace(node: SyntaxNode, text: string): string {
  const parent = node.parent?.name ?? '';
  const standalone = ['ArgList', 'ArrayExpression', 'ParenthesizedExpression', 'ExpressionStatement', 'ReturnStatement', 'Property', 'TemplateString'];
  if (standalone.includes(parent)) return text;
  if ((parent === 'VariableDeclaration' || parent === 'AssignmentExpression') && !sameNode(node.parent?.firstChild, node)) return text;
  return `(${text})`;
}

function tip(source: SketchSource, t: Omit<SketchTip, 'line'>): SketchTip {
  return { ...t, line: lineAt(source.text, t.ranges[0]?.from ?? 0) };
}

// ─── Canvas size ───────────────────────────────────────────────────────────

const POSITION_CALLS: Record<string, number> = {
  // Name → index of the first coordinate argument.
  ellipse: 0, circle: 0, rect: 0, square: 0, line: 0, point: 0, triangle: 0, quad: 0, arc: 0,
  translate: 0, vertex: 0, text: 1, image: 1,
};

function canvasTips(source: SketchSource, runtime: SketchRuntime): SketchTip[] {
  const created = p5Calls(source, new Set(['createCanvas'])).filter((c) => {
    const w = c.args[0] ? numberValue(c.n.block, c.args[0]) : null;
    const h = c.args[1] ? numberValue(c.n.block, c.args[1]) : null;
    return w !== null && h !== null;
  });
  if (created.length === 0) return [];
  const call = created[0];
  const w = numberValue(call.n.block, call.args[0])!;
  const h = numberValue(call.n.block, call.args[1])!;

  // Positions written as the canvas's own numbers: 400 is the right edge of a
  // 400 wide canvas and 200 its middle. They stay put when the canvas grows.
  const positions = new SketchEdit(source);
  let positionCount = 0;
  if (!call.object) {
    for (const shape of p5Calls(source, new Set(Object.keys(POSITION_CALLS)))) {
      if (shape.object) continue;
      const first = POSITION_CALLS[shape.name];
      shape.args.forEach((arg, index) => {
        if (index < first) return;
        const value = numberValue(shape.n.block, arg);
        if (value === null || value === 0) return;
        const horizontal = (index - first) % 2 === 0;
        const size = horizontal ? w : h;
        const word = horizontal ? 'width' : 'height';
        const replacement = value === size ? word : value === size / 2 ? `${word} / 2` : null;
        if (!replacement) return;
        positions.replace(shape.n.block.from + arg.from, shape.n.block.from + arg.to, replacement);
        positionCount++;
      });
    }
  }

  const size = `${formatNumber(w)} × ${formatNumber(h)}`;
  const positionFix = positionCount > 0
    ? { id: 'canvas-positions', label: `Use width and height for ${positionCount} position${positionCount === 1 ? '' : 's'}`, changes: positions.build() }
    : null;
  const advice = positionCount > 0
    ? ` ${positionCount} position${positionCount === 1 ? ' is' : 's are'} written as numbers, though (200 for the middle of 400), and ${positionCount === 1 ? 'stays' : 'stay'} where ${positionCount === 1 ? 'it is' : 'they are'} when the canvas grows. Written as width / 2 they follow the canvas, here and in the p5.js editor alike.`
    : '';
  const links = [p5Reference('width'), p5Reference('createCanvas')];

  if (runtime.canvas) {
    // Ghost Arcade sizes the canvas when the sketch plays: nothing to change
    // for that, only positions that would not follow a bigger canvas.
    const handled = `${canvasSentence(runtime.canvas)} Ghost Arcade does this when it plays, so the code can stay as it is.`;
    return [tip(source, {
      id: 'canvas-size',
      kind: 'canvas',
      severity: positionCount > 0 && runtime.canvas.mode === 'fill' ? 'suggestion' : 'info',
      title: positionCount > 0 && runtime.canvas.mode === 'fill' ? 'Positions written for one canvas size' : 'The canvas is sized for you',
      body: `${handled}${runtime.canvas.mode === 'fill' ? advice : ''}`,
      ranges: [rangeOf(call.n)],
      fixes: positionFix ? [positionFix] : [],
      links,
    })];
  }

  // The sketch plays at the size it asks for, so it fills the window in
  // plain p5 terms: windowWidth and windowHeight, kept up to date when the
  // window changes size. This also fills the browser in the p5.js editor.
  const fill = new SketchEdit(source);
  const prefix = call.object ? `${call.object}.` : '';
  fill.replace(call.n.block.from + call.args[0].from, call.n.block.from + call.args[0].to, `${prefix}windowWidth`);
  fill.replace(call.n.block.from + call.args[1].from, call.n.block.from + call.args[1].to, `${prefix}windowHeight`);
  if (!call.object && !findFunction(source, 'windowResized')) {
    fill.afterFunction(enclosingFunctionName(call.n.block, call.n.node) ?? 'setup', [
      'function windowResized() {',
      `${fill.unit}resizeCanvas(windowWidth, windowHeight);`,
      '}',
    ]);
  }
  const fixes: SketchFix[] = [{ id: 'canvas-fill', label: 'Fill the window', changes: fill.build() }];
  if (positionFix) {
    const both = new SketchEdit(source);
    for (const c of [...fill.build(), ...positionFix.changes]) both.replace(c.from, c.to, c.insert);
    fixes.push({ id: 'canvas-fill-positions', label: `Fill the window and use width and height for ${positionCount} position${positionCount === 1 ? '' : 's'}`, changes: both.build() });
  }
  return [tip(source, {
    id: 'canvas-size',
    kind: 'canvas',
    severity: 'warning',
    title: 'The canvas has a fixed size',
    body: `createCanvas(${formatNumber(w)}, ${formatNumber(h)}) makes a ${size} canvas whatever screen the sketch plays on, so on a 1920 × 1080 output most of the layer stays empty. createCanvas(windowWidth, windowHeight) fills the window instead, in Ghost Arcade and in the p5.js editor alike, and windowResized() keeps it filled when the window changes size.${advice}`,
    ranges: [rangeOf(call.n)],
    fixes,
    links: [p5Reference('windowWidth'), ...links],
  })];
}

// ─── The mouse ─────────────────────────────────────────────────────────────

const MOUSE_VALUES = new Set(['mouseX', 'mouseY', 'pmouseX', 'pmouseY', 'mouseIsPressed']);
const MOUSE_EVENTS = ['mousePressed', 'mouseReleased', 'mouseClicked', 'mouseMoved', 'mouseDragged', 'mouseWheel', 'doubleClicked'];

/** Plain p5 that moves on its own where the mouse would have: a slow wander through noise. */
const WANDER: Record<string, string> = {
  mouseX: 'noise(millis() / 4000) * width',
  mouseY: 'noise(100 + millis() / 4000) * height',
  pmouseX: 'noise((millis() - deltaTime) / 4000) * width',
  pmouseY: 'noise(100 + (millis() - deltaTime) / 4000) * height',
  // A short press every two seconds.
  mouseIsPressed: 'millis() % 2000 < 150',
};

function mouseTips(source: SketchSource): SketchTip[] {
  const reads = nameReads(source, MOUSE_VALUES);
  const instanceReads: CodeNode[] = [];
  walkCode(source, (n) => {
    if (n.node.name !== 'MemberExpression') return;
    const property = n.node.lastChild;
    if (property?.name === 'PropertyName' && MOUSE_VALUES.has(textOf(n.block, property)) && n.node.firstChild?.name === 'VariableName') {
      if (textOf(n.block, n.node.firstChild) !== 'window') instanceReads.push(n);
    }
  });
  const events = MOUSE_EVENTS.map((name) => findFunction(source, name)).filter((f): f is CodeNode => !!f);
  if (reads.length === 0 && instanceReads.length === 0 && events.length === 0) return [];

  const used = [...new Set([...reads, ...instanceReads].map((n) => textOf(n.block, n.node.lastChild ?? n.node)))].sort();
  const fixes: SketchFix[] = [];
  if (isGlobalMode(source) && reads.length > 0) {
    const wander = new SketchEdit(source);
    for (const n of reads) wander.replace(n.from, n.to, inPlace(n.node, WANDER[textOf(n.block, n.node)]));
    fixes.push({ id: 'mouse-wander', label: 'Let it move on its own', changes: wander.build() });
  }

  const eventNames = events.map((e) => `${textOf(e.block, e.node.getChild('VariableDefinition'))}()`);
  const what = [used.join(', '), eventNames.join(', ')].filter(Boolean).join(' and ');
  const definitions = events.map((e) => {
    const name = e.node.getChild('VariableDefinition')!;
    return { from: e.block.from + name.from, to: e.block.from + name.to };
  });
  return [tip(source, {
    id: 'mouse',
    kind: 'mouse',
    severity: 'warning',
    title: 'Nobody holds a mouse at a show',
    body: `This sketch follows the mouse (${what}). On a projector nothing moves a mouse over the picture, so ${used.length ? 'this part stays still' : 'these never run'}.${fixes.length
      ? ' "Let it move on its own" swaps the mouse for noise(), which wanders smoothly across the canvas, so the sketch keeps its motion anywhere.'
      : ''}${eventNames.length ? ` ${eventNames.join(', ')} ${eventNames.length === 1 ? 'is' : 'are'} never called: a timer with millis(), or a beat in the music, can do the same job.` : ''}`,
    ranges: [...reads, ...instanceReads].map(rangeOf).concat(definitions).sort((a, b) => a.from - b.from),
    fixes,
    links: [p5Reference('noise'), p5Reference('mouseX')],
  })];
}

// ─── Sound in ──────────────────────────────────────────────────────────────

const SOUND_CLASSES = new Set(['p5.AudioIn', 'p5.FFT', 'p5.Amplitude']);

function soundTips(source: SketchSource, runtime: SketchRuntime): SketchTip[] {
  const creations: CodeNode[] = [];
  walkCode(source, (n) => {
    if (n.node.name !== 'NewExpression') return;
    const target = n.node.firstChild?.nextSibling;
    if (target && SOUND_CLASSES.has(textOf(n.block, target))) creations.push(n);
  });
  if (creations.length === 0) return [];
  const kinds = [...new Set(creations.map((c) => textOf(c.block, c.node.firstChild!.nextSibling!)))];
  const microphone = kinds.includes('p5.AudioIn');
  if (runtime.soundFromShow) {
    return [tip(source, {
      id: 'sound',
      kind: 'sound',
      severity: 'info',
      title: microphone ? 'The microphone hears the show' : 'It listens to the show',
      body: `Ghost Arcade plays the music of the show into ${kinds.join(', ')}, so ${microphone ? 'getLevel() and the analysis follow the music instead of a microphone' : 'the analysis follows the music'}, with no change to the code.`,
      ranges: creations.map(rangeOf),
      fixes: [],
      links: [{ label: 'p5.sound reference', url: 'https://p5js.org/reference/p5.sound/' }],
    })];
  }
  return [tip(source, {
    id: 'sound',
    kind: 'sound',
    severity: microphone ? 'warning' : 'info',
    title: microphone ? 'No microphone in Ghost Arcade' : 'Sound analysis hears only the sketch',
    body: microphone
      ? 'p5.AudioIn listens to a microphone, which a sketch playing in Ghost Arcade cannot open, so getLevel() stays at 0. Ghost Arcade sends the music of the show to sketches as window.ghostAudio (level, bass, mid, treble, beat, from 0 to 1).'
      : `${kinds.join(' and ')} hear${kinds.length === 1 ? 's' : ''} the sketch's own sounds. To follow the show's music, Ghost Arcade sends it to sketches as window.ghostAudio (level, bass, mid, treble, beat, from 0 to 1).`,
    ranges: creations.map(rangeOf),
    fixes: [],
    links: [{ label: 'p5.sound reference: p5.AudioIn', url: 'https://p5js.org/reference/p5.sound/p5.AudioIn/' }],
  })];
}

// ─── Files ─────────────────────────────────────────────────────────────────

const LOADERS = new Set(['loadImage', 'loadFont', 'loadJSON', 'loadStrings', 'loadTable', 'loadSound', 'loadModel', 'loadShader', 'loadXML', 'loadBytes', 'createVideo', 'createCapture']);

const normalPath = (path: string) => path.replace(/^\.?\//, '').replace(/\\/g, '/');

function fileTips(source: SketchSource, files: string[] | undefined): SketchTip[] {
  const loads = p5Calls(source, LOADERS);
  const capture = loads.filter((l) => l.name === 'createCapture');
  const have = files ? new Set(files.map(normalPath)) : null;
  const missing = loads.filter((l) => {
    if (l.name === 'createCapture') return false;
    const path = l.args[0] ? stringValue(l.n.block, l.args[0]) : null;
    if (path === null) return false;
    if (/^(https?:|data:|blob:)/i.test(path)) return false;
    return !have || !have.has(normalPath(path));
  });
  const tips: SketchTip[] = [];
  if (missing.length > 0) {
    const names = [...new Set(missing.map((l) => stringValue(l.n.block, l.args[0])!))];
    tips.push(tip(source, {
      id: 'files',
      kind: 'files',
      severity: 'warning',
      title: names.length === 1 ? `"${names[0]}" is not in the sketch` : 'Files the sketch does not have',
      body: `It loads ${names.slice(0, 4).map((f) => `"${f}"`).join(', ')}${names.length > 4 ? ' and more' : ''}, which ${names.length === 1 ? 'is' : 'are'} not among the sketch's files${have ? '' : ' (a page on its own carries none)'}. Add ${names.length === 1 ? 'it' : 'them'} to the sketch, or draw the same thing with code. Fonts every computer has (Helvetica, Arial, Georgia, Courier New) work with textFont() without a file.`,
      ranges: missing.map((l) => rangeOf(l.n)),
      fixes: [],
      links: [p5Reference('loadImage'), p5Reference('textFont')],
    }));
  }
  if (capture.length > 0) {
    tips.push(tip(source, {
      id: 'camera',
      kind: 'files',
      severity: 'warning',
      title: 'No camera for sketches',
      body: 'createCapture() opens a camera, which a sketch playing in Ghost Arcade cannot. Ghost Arcade has its own camera and capture layers: put one under this sketch and blend the two.',
      ranges: capture.map((l) => rangeOf(l.n)),
      fixes: [],
      links: [],
    }));
  }
  return tips;
}

// ─── Colours ───────────────────────────────────────────────────────────────

const COLOUR_CALLS = new Set(['fill', 'stroke', 'background']);

function hexToRgb(hex: string): number[] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const digits = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
}

/**
 * A plain name for a colour's hue, for naming its variable: pinkColor,
 * cyanColor. Never just red, green or blue, which are p5 functions.
 */
function hueName([r, g, b]: number[]): string {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 'grey';
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const degrees = h * 60;
  const names: Array<[number, string]> = [[15, 'red'], [40, 'orange'], [65, 'yellow'], [90, 'lime'], [150, 'green'], [175, 'teal'], [200, 'cyan'], [250, 'blue'], [285, 'purple'], [320, 'magenta'], [345, 'pink'], [360, 'red']];
  return names.find(([limit]) => degrees < limit)![1];
}

function rgbHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

interface ColourUse {
  call: Call;
  /** The colour as written: three numbers, or a hex string. */
  rgb: number[] | null;
  hex: string | null;
  alpha: SyntaxNode | null;
  argsFrom: number;
  argsTo: number;
}

function colourTips(source: SketchSource, runtime: SketchRuntime): SketchTip[] {
  const groups = new Map<string, ColourUse[]>();
  for (const call of p5Calls(source, COLOUR_CALLS)) {
    if (call.object) continue;
    const { block } = call.n;
    let use: Omit<ColourUse, 'call' | 'argsFrom' | 'argsTo'> | null = null;
    let last: SyntaxNode | null = null;
    if (call.args.length === 1) {
      const text = stringValue(block, call.args[0]);
      const rgb = text ? hexToRgb(text) : null;
      if (rgb && text) use = { rgb: null, hex: text, alpha: null };
      last = call.args[0];
    } else if (call.args.length === 3 || call.args.length === 4) {
      const values = call.args.slice(0, 3).map((a) => numberValue(block, a));
      if (values.every((v): v is number => v !== null && v >= 0 && v <= 255)) {
        use = { rgb: values as number[], hex: null, alpha: call.args[3] ?? null };
        last = call.args[2];
      }
    }
    if (!use || !last) continue;
    const rgb = use.rgb ?? hexToRgb(use.hex!)!;
    // Greys are brightness, not colour.
    if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) continue;
    const key = rgbHex(rgb);
    groups.set(key, [...(groups.get(key) ?? []), { ...use, call, argsFrom: block.from + call.args[0].from, argsTo: block.from + last.to }]);
  }
  if (!isGlobalMode(source)) return [];

  const tips: SketchTip[] = [];
  // Names stay distinct across the tips, so two colours never offer the same one.
  const named = new Set<string>();
  for (const [hex, uses] of [...groups].slice(0, MAX_COLOUR_TIPS)) {
    const first = uses[0];
    const edit = new SketchEdit(source);
    for (const taken of named) edit.taken.add(taken);
    const name = edit.freeName(`${hueName(first.rgb ?? hexToRgb(first.hex!)!)}Color`);
    named.add(name);
    // Three numbers keep the colour as written and work with any colorMode();
    // a colour written as hex stays hex.
    const asNumbers = uses.some((u) => u.rgb);
    const value = asNumbers ? `[${(first.rgb ?? hexToRgb(first.hex!)!).map(formatNumber).join(', ')}]` : `'${first.hex}'`;
    edit.atTop([`let ${name} = ${value};`]);
    for (const use of uses) {
      edit.replace(use.argsFrom, use.argsTo, use.alpha ? `...${name}` : name);
    }
    const written = source.text.slice(first.argsFrom, first.argsTo);
    tips.push(tip(source, {
      id: `colour-${hex}`,
      kind: 'colour',
      severity: 'suggestion',
      title: `Name the colour ${hex}`,
      body: `${first.call.name}(${written}${first.alpha ? ', …' : ''})${uses.length > 1 ? ` and ${uses.length - 1} more use${uses.length > 2 ? 's' : ''} of it` : ''}: a colour written into a call is easy to lose. As a variable at the top (let ${name} = ${value}) it is one place to change${runtime.colourControls ? ', and Ghost Arcade shows it as a colour control you can change live, map to MIDI or animate' : ''}.`,
      ranges: uses.map((u) => ({ from: u.argsFrom, to: u.argsTo })),
      fixes: [{ id: `colour-${hex}`, label: `Name it ${name}`, changes: edit.build() }],
      links: [p5Reference('fill')],
    }));
  }
  return tips;
}

// ─── Performance ───────────────────────────────────────────────────────────

function performanceTips(source: SketchSource): SketchTip[] {
  const draw = findFunction(source, 'draw');
  const tips: SketchTip[] = [];
  const inDraw = (c: Call) => !!draw && isInside(c.n, draw);

  const graphics = p5Calls(source, new Set(['createGraphics'])).filter(inDraw);
  if (graphics.length) {
    tips.push(tip(source, {
      id: 'perf-create-graphics', kind: 'performance', severity: 'warning',
      title: 'createGraphics() runs every frame',
      body: 'Each call makes a whole new canvas, 60 times a second, and memory fills up within minutes. Make it once in setup(), keep it in a variable, and clear() it when you need a fresh one.',
      ranges: graphics.map((c) => rangeOf(c.n)), fixes: [], links: [p5Reference('createGraphics')],
    }));
  }

  const pixels = p5Calls(source, new Set(['loadPixels', 'updatePixels'])).filter(inDraw);
  if (pixels.length) {
    tips.push(tip(source, {
      id: 'perf-pixels', kind: 'performance', severity: 'suggestion',
      title: 'Pixel work every frame',
      body: 'loadPixels() and updatePixels() copy every pixel of the canvas, two million of them at full HD, every frame. Ghost Arcade\'s effects (pixelate, colour grading, feedback) do this kind of work on the graphics card. If the sketch needs it, work on a smaller createGraphics() and draw that scaled up.',
      ranges: pixels.map((c) => rangeOf(c.n)), fixes: [], links: [p5Reference('loadPixels')],
    }));
  }

  const filters = p5Calls(source, new Set(['filter'])).filter((c) => inDraw(c) && !c.object);
  const canvasBlur: CodeNode[] = [];
  walkCode(source, (n) => {
    if (n.node.name !== 'AssignmentExpression') return;
    const target = textOf(n.block, n.node.firstChild);
    if (/^drawingContext\.(shadowBlur|shadowColor|filter)$/.test(target) && n.node.parent?.name === 'ExpressionStatement') {
      canvasBlur.push(codeNodeOf(n.block, n.node.parent));
    }
  });
  if (filters.length || canvasBlur.length) {
    const edit = new SketchEdit(source);
    let removable = true;
    for (const f of filters) {
      if (f.n.node.parent?.name === 'ExpressionStatement') edit.removeStatement({ block: f.n.block, node: f.n.node.parent });
      else removable = false;
    }
    for (const s of canvasBlur) edit.removeStatement(s);
    tips.push(tip(source, {
      id: 'perf-blur', kind: 'performance', severity: 'suggestion',
      title: 'Blur and glow drawn by the processor',
      body: 'filter(), shadowBlur and drawingContext.filter blur the picture on the processor, which costs a lot at full HD. Add Ghost Arcade\'s Blur or Glow effect to the layer instead: it runs on the graphics card and you can change it live.',
      ranges: [...filters.map((c) => rangeOf(c.n)), ...canvasBlur.map(rangeOf)].sort((a, b) => a.from - b.from),
      fixes: removable ? [{ id: 'perf-blur-remove', label: 'Remove them (add a Glow effect instead)', changes: edit.build() }] : [],
      links: [p5Reference('filter')],
    }));
  }

  // Loops over every pixel of the screen.
  if (draw) {
    const sized = (spec: SyntaxNode | null, block: ScriptBlock) => !!spec && /\b(width|height)\b/.test(textOf(block, spec));
    const pixelLoops: CodeNode[] = [];
    walkCode(source, (n) => {
      if (n.node.name !== 'ForStatement' || !isInside(n, draw) || !sized(n.node.getChild('ForSpec'), n.block)) return true;
      const body = n.node.getChild('Block') ?? n.node.lastChild;
      let inner = false;
      if (body) {
        const cursor = body.cursor();
        do {
          if (cursor.name === 'ForStatement' && sized(cursor.node.getChild('ForSpec'), n.block)) inner = true;
        } while (!inner && cursor.next() && cursor.from < body.to);
      }
      if (inner) { pixelLoops.push(n); return false; }
      return true;
    });
    if (pixelLoops.length) {
      tips.push(tip(source, {
        id: 'perf-pixel-loops', kind: 'performance', severity: 'suggestion',
        title: 'A loop over the whole screen',
        body: 'Two loops across width and height visit every pixel (or every few pixels) each frame. At 1920 × 1080 that is millions of steps a second. Make the step bigger, draw at a smaller size, or let a Ghost Arcade effect or shader do the per-pixel work.',
        ranges: pixelLoops.map(rangeOf), fixes: [], links: [],
      }));
    }
  }
  return tips;
}

// ─── Timing ────────────────────────────────────────────────────────────────

function timingTips(source: SketchSource): SketchTip[] {
  const uses = nameReads(source, new Set(['frameCount']));
  const operator = (n: CodeNode) => {
    const parent = n.node.parent;
    const op = parent?.name === 'BinaryExpression' ? parent.getChild('ArithOp') : null;
    return op ? textOf(n.block, op) : '';
  };
  const scaled = uses.filter((n) => operator(n) === '*' || operator(n) === '/');
  if (scaled.length === 0) return [];
  // A frame count kept, compared or subtracted somewhere is counting frames
  // on purpose; changing only some uses would mix frames with time.
  const mixed = uses.some((n) => operator(n) !== '*' && operator(n) !== '/' && operator(n) !== '%');
  const edit = new SketchEdit(source);
  for (const n of scaled) edit.replace(n.from, n.to, '(millis() / (1000 / 60))');
  return [tip(source, {
    id: 'timing-frame-count',
    kind: 'timing',
    severity: 'suggestion',
    title: 'Motion tied to the frame rate',
    body: `frameCount goes up by one each frame, so motion built on it slows down whenever frames drop: with heavy effects, a big output or several sketches at once. millis() / (1000 / 60) counts the same 60 a second by the clock, so the timing holds.${mixed ? ' This sketch also keeps or compares frame counts, so change these by hand to keep them in step.' : uses.length > scaled.length ? ' Uses such as frameCount % 60 count frames on purpose and are left alone.' : ''}`,
    ranges: scaled.map(rangeOf),
    fixes: mixed ? [] : [{ id: 'timing-clock', label: 'Time it by the clock', changes: edit.build() }],
    links: [p5Reference('millis'), p5Reference('deltaTime')],
  })];
}

// ─── Audio ─────────────────────────────────────────────────────────────────

function audioTips(source: SketchSource, runtime: SketchRuntime): SketchTip[] {
  const code = source.scripts.map((s) => s.code).join('\n');
  if (/\bghostAudio\b|p5\.(AudioIn|Amplitude|FFT)\b/.test(code) || source.scripts.length === 0) return [];
  const draw = findFunction(source, 'draw');
  return [tip(source, {
    id: 'audio',
    kind: 'audio',
    severity: 'info',
    title: 'Make it move with the music',
    body: runtime.soundFromShow
      ? 'p5.sound hears the music of the show in Ghost Arcade. Make an analyser once (let amp = new p5.Amplitude(); in setup()), then read it while drawing, for example circle(x, y, 50 + 400 * amp.getLevel()). The same code reacts to sound in the p5.js editor too. Keep the sketch moving on its own as well, for quiet moments.'
      : 'Ghost Arcade sends the music it hears to every sketch as window.ghostAudio: level, bass, mid, treble, high, beat, kick and snare from 0 to 1. For example, circle(x, y, 50 + 200 * (window.ghostAudio?.bass || 0)) makes a circle that jumps with the bass. Everything is 0 when nothing plays, so keep the sketch moving on its own as well.',
    ranges: draw ? [{ from: draw.from, to: draw.from + 8 }] : [{ from: source.scripts[0].from, to: source.scripts[0].from }],
    fixes: [],
    links: runtime.soundFromShow ? [{ label: 'p5.sound reference: p5.Amplitude', url: 'https://p5js.org/reference/p5.sound/p5.Amplitude/' }] : [],
  })];
}

/** Every tip for one sketch file, most important first. */
export function findSketchTips(text: string, options: SketchTipOptions = {}): SketchTip[] {
  const source = readSketchFile(text, options.language ?? 'html');
  if (source.scripts.length === 0) return [];
  const runtime = options.runtime ?? {};
  const all = [
    ...mouseTips(source),
    ...soundTips(source, runtime),
    ...fileTips(source, options.files),
    ...canvasTips(source, runtime),
    ...colourTips(source, runtime),
    ...performanceTips(source),
    ...timingTips(source),
    ...audioTips(source, runtime),
  ];
  return all.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.line - b.line);
}
