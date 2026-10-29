import { describe, expect, it } from 'vitest';
import { resolveObjectURL } from 'node:buffer';

import { iframePage, jsAnimationIframeHtml } from '../renderer/js-animation';
import { isP5Page } from '../renderer/jsAnimationPage';
import type { JSAnimationOrigin, JSAnimationSketch, JSAnimationSource, SketchFile } from '../types';
import {
  P5_SOUND_CDN,
  playablePage,
  singlePlayableDocument,
  singlePlayablePage,
  singleSketchDocument,
  singleSketchPage,
  sketchP5Version,
  sketchSource,
  wrapSketch,
} from './wrapSketch';

const EDITOR_INDEX = `<!DOCTYPE html>
<html lang="en">
  <head>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/addons/p5.sound.min.js"></script>
    <link rel="stylesheet" type="text/css" href="style.css">
    <meta charset="utf-8" />
    <!-- my notes -->
  </head>
  <body>
    <main>
    </main>
    <script src="particle.js"></script>
    <script src="sketch.js"></script>
  </body>
</html>
`;

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const ORIGIN: JSAnimationOrigin = {
  kind: 'p5-editor',
  sketchName: 'Snowflakes',
  author: 'p5',
  url: 'https://editor.p5js.org/p5/sketches/4GluUaiHzPj',
  sketchId: '4GluUaiHzPj',
  importedFrom: 'account',
  importedAt: 1_700_000_000_000,
};

function editorSketch(sketchJs: string, more: SketchFile[] = [], canvas?: 'fill' | 'fit'): JSAnimationSketch {
  return {
    files: [
      { path: 'index.html', text: EDITOR_INDEX },
      { path: 'style.css', text: 'html, body { margin: 0; }\ncanvas { display: block; background: url(assets/dot.png); }' },
      { path: 'particle.js', text: 'class Particle { constructor() { this.x = 0; } }' },
      { path: 'sketch.js', text: sketchJs },
      { path: 'assets/dot.png', base64: PNG_BASE64, mime: 'image/png' },
      ...more,
    ],
    ...(canvas ? { canvas } : {}),
  };
}

const RELATIVE_SKETCH = `let speed = 2;
function setup() {
  createCanvas(400, 400);
}
function draw() {
  background(0);
  ellipse(width / 2, height / 2, width * 0.25 * speed);
}`;

/** The text of the <script> that starts with `head`, up to its end. */
function scriptAt(html: string, head: string): string {
  const at = html.indexOf(head);
  expect(at, `${head} not found`).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</script>', at));
}

describe('the wrapped page', () => {
  const sketch = editorSketch(RELATIVE_SKETCH);
  const wrapped = wrapSketch(sketch, { origin: ORIGIN });

  it('keeps every line of the author\'s index.html where it was', () => {
    const original = EDITOR_INDEX.split('\n');
    const served = wrapped.html.split('\n');
    expect(served).toHaveLength(original.length);
    // Untouched lines are identical; the p5 tags' lines are now empty.
    expect(served[3].trim()).toBe('');
    expect(served[4].trim()).toBe('');
    for (const n of [0, 1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15]) expect(served[n], `line ${n + 1}`).toBe(original[n]);
  });

  it('serves the sketch files as they are, at their own paths', () => {
    expect(wrapped.html).toContain('<script src="sketch.js"></script>');
    expect(wrapped.html).toContain('<link rel="stylesheet" type="text/css" href="style.css">');
    expect(wrapped.files.map((f) => f.path)).toEqual(['style.css', 'particle.js', 'sketch.js', 'assets/dot.png']);
    expect(wrapped.files.find((f) => f.path === 'sketch.js')).toEqual({ path: 'sketch.js', text: RELATIVE_SKETCH });
    expect(wrapped.files.find((f) => f.path === 'assets/dot.png')).toEqual({ path: 'assets/dot.png', base64: PNG_BASE64, mime: 'image/png' });
  });

  it('never changes the stored files', () => {
    expect(sketch.files[3]).toEqual({ path: 'sketch.js', text: RELATIVE_SKETCH });
    expect(sketch.files[0].text).toBe(EDITOR_INDEX);
  });

  it('leaves p5 to the bundled copy, loaded once and before the page pieces', () => {
    expect(wrapped.html).not.toContain('cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4');
    expect(isP5Page(wrapped.html)).toBe(true);
    const hosted = jsAnimationIframeHtml(wrapped.html);
    expect(hosted.match(/<script src="\/lib\/p5\.min\.js"><\/script>/g)).toHaveLength(1);
    expect(hosted.indexOf('/lib/p5.min.js')).toBeLessThan(hosted.indexOf('data-ghost-canvas'));
    expect(hosted).not.toContain('p5.sound');
  });

  it('adds its own pieces on the <head> line and credits the sketch', () => {
    const headLine = wrapped.html.split('\n')[2];
    expect(headLine.startsWith('  <head><!-- p5.js sketch "Snowflakes" by p5, from the p5.js Web Editor: https://editor.p5js.org/p5/sketches/4GluUaiHzPj -->')).toBe(true);
    expect(headLine).toContain('<meta name="ghost-arcade-sketch" content="');
    expect(headLine).toContain('data-ghost-canvas');
  });

  it('is a new page whenever a file changes', () => {
    const edited = editorSketch(RELATIVE_SKETCH.replace('0.25', '0.3'));
    expect(wrapSketch(edited, { origin: ORIGIN }).html).not.toBe(wrapped.html);
    expect(wrapSketch(editorSketch(RELATIVE_SKETCH), { origin: ORIGIN }).html).toBe(wrapped.html);
  });

  it('loads the bundled p5.sound after p5 when the sketch uses it', () => {
    const sound = wrapSketch(editorSketch(`let song;
function preload() { song = loadSound('assets/beat.mp3'); }
function setup() { createCanvas(windowWidth, windowHeight); song.loop(); }`, [{ path: 'assets/beat.mp3', base64: 'SUQz', mime: 'audio/mpeg' }]));
    expect(sound.html.match(/p5\.sound/g)).toHaveLength(1);
    expect(sound.html).toContain(`<script src="${P5_SOUND_CDN}"></script>`);
    const hosted = jsAnimationIframeHtml(sound.html);
    expect(hosted.indexOf('/lib/p5.min.js')).toBeLessThan(hosted.indexOf('/lib/p5.sound.min.js'));
    expect(hosted.indexOf('/lib/p5.sound.min.js')).toBeLessThan(hosted.indexOf('src="sketch.js"'));
    expect(sound.notes.join(' ')).toMatch(/p5\.sound/);
  });

  it('keeps other libraries and says they need the internet', () => {
    const withLibrary = editorSketch('function setup() { createCanvas(400, 400); }');
    withLibrary.files[0] = {
      path: 'index.html',
      text: EDITOR_INDEX.replace('</head>', '<script src="https://unpkg.com/ml5@1/dist/ml5.min.js"></script>\n</head>'),
    };
    const result = wrapSketch(withLibrary);
    expect(result.html).toContain('<script src="https://unpkg.com/ml5@1/dist/ml5.min.js"></script>');
    expect(result.notes).toContain('Loads ml5.min.js from unpkg.com each time it plays, so it needs the internet.');
  });

  it('builds a page for a sketch with no index.html, sketch.js last', () => {
    const result = wrapSketch({
      files: [
        { path: 'sketch.js', text: 'function setup() { createCanvas(windowWidth, windowHeight); }' },
        { path: 'walker.js', text: 'class Walker {}' },
      ],
    });
    expect(result.html.indexOf('src="walker.js"')).toBeLessThan(result.html.indexOf('src="sketch.js"'));
    expect(result.html).toMatch(/^<!DOCTYPE html>/);
    expect(result.files.map((f) => f.path)).toEqual(['sketch.js', 'walker.js']);
  });

  it('reports a script index.html loads but the sketch does not have', () => {
    const missing = editorSketch('function setup() {}');
    missing.files = missing.files.filter((f) => f.path !== 'particle.js');
    expect(wrapSketch(missing).notes).toContain("index.html loads particle.js, which isn't in the sketch.");
  });

  it('hands files that stay online to p5 by path', () => {
    const result = wrapSketch(editorSketch('function setup() {}', [
      { path: 'assets/song.mp3', url: 'https://assets.editor.p5js.org/x/song.mp3' },
    ]));
    const table = JSON.parse(scriptAt(result.html, '<script>(function (files) {').match(/\}\)\((\{[\s\S]*?\})\);$/)![1]);
    expect(table).toEqual({ 'assets/song.mp3': { type: 'audio/mpeg', url: 'https://assets.editor.p5js.org/x/song.mp3' } });
    expect(result.files.some((f) => f.path === 'assets/song.mp3')).toBe(false);
    expect(result.notes).toContain('song.mp3 loads from assets.editor.p5js.org each time it plays.');
  });
});

describe('the sketch as one document', () => {
  const page = singleSketchPage(editorSketch(RELATIVE_SKETCH), { origin: ORIGIN });

  it('folds in the scripts in the order index.html loads them', () => {
    expect(page).not.toMatch(/<script[^>]*src=["']?(sketch|particle)\.js/);
    const particle = page.indexOf('class Particle');
    expect(particle).toBeGreaterThan(-1);
    expect(page.indexOf('function setup()')).toBeGreaterThan(particle);
    expect(page).not.toContain('my notes');
  });

  it('folds in the style sheet and points its url() at the carried file', () => {
    expect(page).not.toMatch(/<link[^>]*style\.css/);
    expect(page).toContain('<style>\nhtml, body { margin: 0; }');
    expect(page).toContain(`url("data:image/png;base64,${PNG_BASE64}")`);
  });

  it('carries the files it did not fold in', () => {
    const table = JSON.parse(scriptAt(page, '<script>(function (files) {').match(/\}\)\((\{[\s\S]*?\})\);$/)![1]);
    expect(table).toEqual({ 'assets/dot.png': { type: 'image/png', b64: PNG_BASE64 } });
  });

  it('cannot be closed early, or kept open, by code that mentions script tags', () => {
    const result = singleSketchPage(editorSketch('const tag = "</script><script>alert(1)</script>";\nconst note = "<!-- <script>";\nfunction setup() { createCanvas(400, 400); }'));
    expect(result).toContain('const tag = "<\\/script><script>alert(1)<\\/script>";');
    expect(result).toContain('const note = "<\\!-- <script>";');
  });

  it('is what an iframe plays for a sketch kept as files', () => {
    const source = sketchSource(editorSketch(RELATIVE_SKETCH), { origin: ORIGIN });
    expect(singlePlayablePage(source)).toBe(singleSketchPage(source.sketch!, { origin: ORIGIN }));
    expect(singlePlayableDocument(source).html).toBe(singlePlayablePage(source));
  });
});

describe('where a line of the one-document page came from', () => {
  const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
  const sketchJs = `let speed = 2;
function setup() {
  createCanvas(400, 400);
}
function draw() {
  background(0);
  circle(width / 2, height / 2, nothing.size);
}`;
  const sketch = editorSketch(sketchJs);
  const doc = singleSketchDocument(sketch, { origin: ORIGIN });

  it('names the sketch file and the line the author wrote', () => {
    expect(doc.place(lineOf(doc.html, 'nothing.size'))).toEqual({ file: 'sketch.js', line: 7 });
    expect(doc.place(lineOf(doc.html, 'let speed'))).toEqual({ file: 'sketch.js', line: 1 });
    expect(doc.place(lineOf(doc.html, 'class Particle'))).toEqual({ file: 'particle.js', line: 1 });
    expect(doc.place(lineOf(doc.html, 'canvas { display: block'))).toEqual({ file: 'style.css', line: 2 });
  });

  it('names index.html for its own lines, after the folded files', () => {
    expect(doc.place(lineOf(doc.html, '<main>'))).toEqual({ file: 'index.html', line: lineOf(EDITOR_INDEX, '<main>') });
    expect(doc.place(lineOf(doc.html, '</body>'))).toEqual({ file: 'index.html', line: lineOf(EDITOR_INDEX, '</body>') });
    expect(doc.place(lineOf(doc.html, '<html lang'))).toEqual({ file: 'index.html', line: 2 });
  });

  it('gives no file for the lines Ghost Arcade adds', () => {
    expect(doc.place(lineOf(doc.html, 'data-ghost-canvas'))).toBeNull();
    expect(doc.place(lineOf(doc.html, 'ghost-arcade-sketch'))).toBeNull();
    expect(doc.place(0)).toBeNull();
    expect(doc.place(doc.html.split('\n').length + 5)).toBeNull();
  });

  it('traces code written in index.html itself', () => {
    const inline = editorSketch(sketchJs);
    inline.files[0] = {
      path: 'index.html',
      text: EDITOR_INDEX.replace('    <script src="sketch.js"></script>', '    <script>\n      let broken = missing.value;\n    </script>'),
    };
    const page = singleSketchDocument(inline);
    expect(page.place(lineOf(page.html, 'missing.value'))).toEqual({ file: 'index.html', line: lineOf(inline.files[0].text!, 'missing.value') });
  });

  it('keeps tracing through the iframe runtime added in front of it', () => {
    const source = sketchSource(sketch, { origin: ORIGIN });
    const played = iframePage(source);
    expect(played.html).toContain('__ghostSketchErrors');
    expect(played.place(lineOf(played.html, 'nothing.size'))).toEqual({ file: 'sketch.js', line: 7 });
    expect(played.place(lineOf(played.html, '__ghostSketchErrors'))).toBeNull();
  });

  it('gives a page kept whole its own lines, as index.html', () => {
    const page = '<html>\n<head>\n<script\n  src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js">\n</script>\n</head>\n<body><script>\nlet a = b;\n</script></body></html>';
    const played = iframePage({ animationType: 'p5js', htmlCode: page });
    expect(played.html).not.toContain('cdn.jsdelivr.net');
    expect(played.place(lineOf(played.html, 'let a = b'))).toEqual({ file: 'index.html', line: 8 });
  });
});

describe('canvas size', () => {
  it('lets a sketch that draws from width and height fill the output', () => {
    const result = wrapSketch(editorSketch(RELATIVE_SKETCH));
    expect(result.canvas.size).toEqual({ kind: 'fixed', width: 400, height: 400 });
    expect(result.canvas.recommended).toBe('fill');
    expect(result.html).toContain('})("fill", false);</script>');
  });

  it('scales a sketch drawn at fixed positions, sharp, instead of stretching its layout', () => {
    const result = wrapSketch(editorSketch('function setup() { createCanvas(400, 400); }\nfunction draw() { background(220); ellipse(200, 200, 80); }'));
    expect(result.canvas.recommended).toBe('fit');
    expect(result.canvas.sharpen).toBe(true);
    expect(result.canvas.reason).toMatch(/400 × 400/);
    expect(result.html).toContain('})("fit", true);</script>');
  });

  it('follows a canvas sized from top-level constants', () => {
    const result = wrapSketch(editorSketch('const W = 720, H = 400;\nfunction setup() { createCanvas(W, H); }\nfunction draw() { rect(W / 2, 10, 20, 20); }'));
    expect(result.canvas.size).toEqual({ kind: 'fixed', width: 720, height: 400 });
    expect(result.canvas.recommended).toBe('fit');
  });

  it('fills the output for a sketch already sized to its window', () => {
    const result = wrapSketch(editorSketch('function setup() { createCanvas(windowWidth, windowHeight); }\nfunction draw() { circle(width / 2, height / 2, 50); }'));
    expect(result.canvas.size).toEqual({ kind: 'window' });
    expect(result.canvas.recommended).toBe('fill');
  });

  it('keeps the resolution of a sketch that works on its pixels', () => {
    const result = wrapSketch(editorSketch('function setup() { createCanvas(200, 200); }\nfunction draw() { loadPixels(); for (let i = 0; i < width * height * 4; i += 4) pixels[i] = 255; updatePixels(); }'));
    expect(result.canvas.recommended).toBe('fit');
    expect(result.canvas.sharpen).toBe(false);
  });

  it('leaves the density to a sketch that sets its own', () => {
    expect(wrapSketch(editorSketch('function setup() { createCanvas(300, 300); pixelDensity(1); }\nfunction draw() { ellipse(150, 150, 10); }')).canvas.sharpen).toBe(false);
  });

  it('takes the canvas the person chose', () => {
    const result = wrapSketch(editorSketch(RELATIVE_SKETCH, [], 'fit'));
    expect(result.canvas.recommended).toBe('fill');
    expect(result.canvas.mode).toBe('fit');
    expect(result.html).toContain('})("fit", true);</script>');
  });

  function runCanvasRuntime(mode: 'fill' | 'fit') {
    const html = wrapSketch(editorSketch(RELATIVE_SKETCH, [], mode)).html;
    const code = scriptAt(html, '<script>(function (mode, sharpen)').slice('<script>'.length);
    const calls: Array<[string, number[]]> = [];
    const style = { textContent: '' };
    class FakeP5 {
      width = 0;
      height = 0;
      canvas: { setAttribute: () => void } | null = null;
      createCanvas(w: number, h: number) {
        calls.push(['createCanvas', [w, h]]);
        this.width = w;
        this.height = h;
        this.canvas = { setAttribute: () => {} };
      }
      resizeCanvas(w: number, h: number) {
        calls.push(['resizeCanvas', [w, h]]);
        this.width = w;
        this.height = h;
      }
      pixelDensity(d: number) {
        calls.push(['pixelDensity', [d]]);
        this.resizeCanvas(this.width, this.height);
      }
    }
    const fakeWindow = { p5: FakeP5, innerWidth: 1920, innerHeight: 1080, addEventListener: () => {} };
    const fakeDocument = { createElement: () => style, head: { appendChild: () => {} } };
    new Function('window', 'document', code)(fakeWindow, fakeDocument);
    const instance = new FakeP5();
    instance.createCanvas(400, 400);
    return { calls, style: style.textContent, instance };
  }

  it('hands a filling sketch the output size, whatever it asked for', () => {
    const { calls, instance } = runCanvasRuntime('fill');
    expect(calls[0]).toEqual(['createCanvas', [1920, 1080]]);
    instance.resizeCanvas(400, 400);
    expect([instance.width, instance.height]).toEqual([1920, 1080]);
  });

  it('scales a fitted canvas to the output and raises its density to stay sharp', () => {
    const { calls, style, instance } = runCanvasRuntime('fit');
    expect(calls[0]).toEqual(['createCanvas', [400, 400]]);
    expect(calls).toContainEqual(['pixelDensity', [3]]);
    expect([instance.width, instance.height]).toEqual([400, 400]);
    // 400 × 400 scaled by 2.7 to 1080 × 1080, centred on 1920 × 1080.
    expect(style).toContain('left:420px!important');
    expect(style).toContain('width:1080px!important;height:1080px!important');
  });
});

describe('controls', () => {
  const code = `let speed = 2;
const NUM_FLAKES = 120;
let showTrails = true;
let angle = 0;
let cols = 10;
let grid;
function setup() {
  createCanvas(windowWidth, windowHeight);
  grid = new Array(cols);
}
function draw() {
  angle += speed * 0.01;
  for (let i = 0; i < NUM_FLAKES; i++) point(i, angle);
  if (showTrails) background(0, 10);
}`;
  const wrapped = wrapSketch(editorSketch(code));

  it('turns values the sketch only reads while it plays into controls', () => {
    expect(wrapped.controls).toEqual(['speed', 'NUM_FLAKES', 'showTrails']);
    expect(wrapped.params?.map((p) => [p.name, p.type, p.default, p.label])).toEqual([
      ['speed', 'number', 2, 'Speed'],
      ['NUM_FLAKES', 'number', 120, 'Num Flakes'],
      ['showTrails', 'boolean', true, 'Show Trails'],
    ]);
    expect(wrapped.paramValues).toEqual({ speed: 2, NUM_FLAKES: 120, showTrails: true });
  });

  it('serves a const control as let without moving anything in the file', () => {
    const served = wrapped.files.find((f) => f.path === 'sketch.js')!.text!;
    expect(served).toContain('let   NUM_FLAKES = 120;');
    expect(served).toHaveLength(code.length);
    expect(served.split('\n').map((l) => l.length)).toEqual(code.split('\n').map((l) => l.length));
  });

  it('declares the starting values ahead of the sketch and syncs them after it', () => {
    expect(wrapped.html).toContain('<script>window.shaderParams = { speed: 2, NUM_FLAKES: 120, showTrails: true };</script>');
    expect(wrapped.html.indexOf('window.shaderParams')).toBeLessThan(wrapped.html.indexOf('src="sketch.js"'));
    expect(wrapped.html.indexOf('var __ghostLast')).toBeGreaterThan(wrapped.html.indexOf('src="sketch.js"'));
    expect(wrapped.html.indexOf('var __ghostLast')).toBeLessThan(wrapped.html.indexOf('</body>'));
  });

  it('applies a moved control to the running sketch', () => {
    const sync = scriptAt(wrapped.html, '(function () { var __ghostLast');
    const scope: Record<string, unknown> = { speed: 2, NUM_FLAKES: 120, showTrails: true };
    const frames: Array<() => void> = [];
    const fakeWindow = { shaderParams: { speed: 2, NUM_FLAKES: 120, showTrails: true } };
    new Function('window', 'requestAnimationFrame', 'scope', `with (scope) { ${sync} }`)(fakeWindow, (fn: () => void) => frames.push(fn), scope);
    fakeWindow.shaderParams.speed = 5;
    fakeWindow.shaderParams.NUM_FLAKES = 80.6;
    frames.shift()!();
    expect(scope.speed).toBe(5);
    expect(scope.NUM_FLAKES).toBe(81);
  });

  it('adds no controls to a sketch without plain top-level values', () => {
    const plain = wrapSketch(editorSketch('function setup() { createCanvas(400, 400); }\nfunction draw() { background(frameCount % 255); }'));
    expect(plain.controls).toEqual([]);
    expect(plain.params).toBeUndefined();
    expect(plain.html).not.toContain('window.shaderParams');
  });
});

describe('sketchSource', () => {
  it('keeps the files as written, the wrapped page and the credit', () => {
    const sketch = editorSketch(RELATIVE_SKETCH);
    const source = sketchSource(sketch, { origin: ORIGIN });
    expect(source.animationType).toBe('p5js');
    expect(source.sketch).toBe(sketch);
    expect(source.htmlCode).toBe(wrapSketch(sketch, { origin: ORIGIN }).html);
    expect(source.origin).toEqual(ORIGIN);
    expect(source.params?.map((p) => p.name)).toEqual(['speed']);
  });

  it('keeps a moved slider through an edit, unless the edit changed its starting value', () => {
    const first = sketchSource(editorSketch('let speed = 2;\nlet size = 10;\nfunction draw() { circle(0, 0, size * speed); }'), { origin: ORIGIN });
    const moved: JSAnimationSource = { ...first, paramValues: { speed: 4, size: 30 } };
    const edited = sketchSource(editorSketch('let speed = 2;\nlet size = 12;\nlet spin = 1;\nfunction draw() { rotate(spin); circle(0, 0, size * speed); }'), { previous: moved });
    expect(edited.paramValues).toEqual({ speed: 4, size: 12, spin: 1 });
    expect(edited.origin).toEqual(ORIGIN);
  });
});

describe('playablePage', () => {
  it('plays a stored page as it is', () => {
    const legacy: JSAnimationSource = { animationType: 'p5js', htmlCode: '<html><script src="p5.min.js"></script></html>' };
    expect(playablePage(legacy)).toEqual({ html: legacy.htmlCode });
    expect(singlePlayablePage(legacy)).toBe(legacy.htmlCode);
  });

  it('wraps a sketch kept as files each time, from its files', () => {
    const source = sketchSource(editorSketch(RELATIVE_SKETCH), { origin: ORIGIN });
    const page = playablePage(source);
    expect(page.html).toBe(source.htmlCode);
    expect(page.files?.map((f) => f.path)).toEqual(['style.css', 'particle.js', 'sketch.js', 'assets/dot.png']);
    // The same object every frame: the runtime asks often.
    expect(playablePage(source).files).toBe(page.files);
  });
});

describe('p5.js versions', () => {
  function withIndex(script: string, code: string): JSAnimationSketch {
    return {
      files: [
        { path: 'index.html', text: `<html><head><script src="${script}"></script></head><body><script src="sketch.js"></script></body></html>` },
        { path: 'sketch.js', text: code },
      ],
    };
  }

  it('plays a 1.x sketch as it is', () => {
    const result = wrapSketch(withIndex('https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.js', 'function setup() {}'));
    expect(result.p5Version).toBe('1.9.4');
    expect(result.compatibility).toEqual({ level: 'ok', message: null });
  });

  it("says plainly that a sketch using p5.js 2 features can't run", () => {
    const result = wrapSketch(withIndex(
      'https://cdn.jsdelivr.net/npm/p5@2.0.4/lib/p5.js',
      'let font;\nasync function setup() { createCanvas(400, 400); font = await loadFont("x.ttf"); }\nfunction draw() { textWeight(400); }',
    ));
    expect(result.p5Version).toBe('2.0.4');
    expect(result.compatibility.level).toBe('blocked');
    expect(result.compatibility.message).toBe("Can't run: it is written for p5.js 2.0.4 and uses await loadFont() and textWeight, which p5.js 1.11, the version Ghost Arcade plays, doesn't have.");
  });

  it('warns about a 2.x sketch that uses nothing 2.x added', () => {
    const result = wrapSketch(withIndex('https://cdn.jsdelivr.net/npm/p5@2.3.4/lib/p5.min.js', 'function setup() { createCanvas(400, 400); }'));
    expect(result.compatibility.level).toBe('warn');
    expect(result.compatibility.message).toMatch(/^Written for p5\.js 2\.3\.4\./);
  });

  it('reads the version from a p5.js file bundled in a zip, and from the import when the copy is gone', () => {
    const files = [
      { path: 'index.html', text: '<html><head><script src="p5.js"></script></head><body><script src="sketch.js"></script></body></html>' },
      { path: 'p5.js', text: '/*! p5.js v1.11.1 October 1, 2024 */', remote: 'library' as const },
      { path: 'sketch.js', text: 'function setup() {}' },
    ];
    expect(sketchP5Version(files)).toBe('1.11.1');
    const kept = wrapSketch({ files: files.filter((f) => f.path !== 'p5.js') }, { origin: { ...ORIGIN, p5Version: '1.11.1' } });
    expect(kept.p5Version).toBe('1.11.1');
    expect(kept.html).not.toMatch(/<script src="p5\.js">/);
  });
});

describe('the file loader in a single-document page', () => {
  function loader(files: SketchFile[]) {
    const html = singleSketchPage({ files: [{ path: 'sketch.js', text: 'function setup() {}' }, ...files] });
    const code = scriptAt(html, '(function (files) {');
    const fetched: unknown[] = [];
    const opened: unknown[] = [];
    class FakeElement { setAttribute(this: Record<string, string>, name: string, value: string) { this[`attr:${name}`] = value; } }
    const srcProperty = () => {
      const proto = Object.create(FakeElement.prototype);
      Object.defineProperty(proto, 'src', {
        configurable: true,
        get(this: { _src?: string }) { return this._src; },
        set(this: { _src?: string }, value: string) { this._src = value; },
      });
      const Type = function () {} as unknown as { prototype: object };
      Type.prototype = proto;
      return Type;
    };
    const HTMLImageElement = srcProperty();
    const HTMLMediaElement = srcProperty();
    const HTMLSourceElement = srcProperty();
    const XMLHttpRequest = function () {} as unknown as { prototype: { open: (...args: unknown[]) => void } };
    XMLHttpRequest.prototype.open = (_method: unknown, url: unknown) => { opened.push(url); };
    const fakeWindow = { fetch: (input: unknown) => { fetched.push(input); return Promise.resolve(); } };
    new Function('window', 'location', 'XMLHttpRequest', 'HTMLImageElement', 'HTMLMediaElement', 'HTMLSourceElement', 'Element', code)(
      fakeWindow, { origin: 'ghost-js://s1' }, XMLHttpRequest, HTMLImageElement, HTMLMediaElement, HTMLSourceElement, FakeElement,
    );
    return { fakeWindow, fetched, opened, HTMLImageElement, HTMLSourceElement, XMLHttpRequest };
  }

  it('answers sketch paths with the carried file, by any spelling p5 uses', async () => {
    const { fakeWindow, fetched } = loader([
      { path: 'assets/dot.png', base64: PNG_BASE64, mime: 'image/png' },
      { path: 'data/words.txt', text: 'hello' },
    ]);
    for (const path of ['assets/dot.png', './assets/dot.png', '/assets/dot.png', 'ghost-js://s1/assets/dot.png', 'Assets/Dot.png', 'assets/dot.png?v=2']) {
      await fakeWindow.fetch(path);
    }
    expect(new Set(fetched).size).toBe(1);
    expect(String(fetched[0])).toMatch(/^blob:/);
    await fakeWindow.fetch('data/words.txt');
    const blob = resolveObjectURL(String(fetched[fetched.length - 1]));
    expect(await blob?.text()).toBe('hello');
    expect(blob?.type).toBe('text/plain');
  });

  it('leaves other URLs alone', async () => {
    const { fakeWindow, fetched } = loader([{ path: 'assets/dot.png', base64: PNG_BASE64, mime: 'image/png' }]);
    for (const url of ['https://example.com/assets/dot.png', 'data:text/plain,x', 'other.png', 'ghost-js://s2/assets/dot.png']) {
      await fakeWindow.fetch(url);
    }
    expect(fetched).toEqual(['https://example.com/assets/dot.png', 'data:text/plain,x', 'other.png', 'ghost-js://s2/assets/dot.png']);
  });

  it('resolves XMLHttpRequest, image src and media source attributes', () => {
    const { opened, XMLHttpRequest, HTMLImageElement, HTMLSourceElement } = loader([
      { path: 'assets/font.otf', base64: 'AAEAAA==', mime: 'font/otf' },
      { path: 'assets/clip.mp4', url: 'https://assets.editor.p5js.org/clip.mp4' },
    ]);
    const request = new (XMLHttpRequest as unknown as new () => { open: (m: string, u: string) => void })();
    request.open('GET', 'assets/font.otf');
    expect(String(opened[0])).toMatch(/^blob:/);
    const image = new (HTMLImageElement as unknown as new () => { src: string })();
    image.src = 'assets/font.otf';
    expect(image.src).toBe(opened[0]);
    const source = new (HTMLSourceElement as unknown as new () => { setAttribute: (n: string, v: string) => void } & Record<string, unknown>)();
    source.setAttribute('src', 'assets/clip.mp4');
    expect(source['attr:src']).toBe('https://assets.editor.p5js.org/clip.mp4');
  });
});
