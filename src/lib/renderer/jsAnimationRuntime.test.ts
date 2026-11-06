import { beforeAll, describe, expect, it } from 'vitest';
import { iframePage, jsAnimationIframeHtml, loadPageLibraries, pageAudioFrom, playsSandboxed } from './js-animation';
import type { VisualAudioState } from '../audio/visualAudio';

const p5Page = `<!DOCTYPE html>
<html>
<head>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/addons/p5.sound.min.js"></script>
</head>
<body>
<script>
function setup() { createCanvas(400, 400); }
function draw() { background(0); }
</script>
</body>
</html>`;

const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
// The page's own lines come after the shims, which carry p5 itself.
const lastLineOf = (text: string, needle: string) => text.split('\n').findLastIndex((l) => l.includes(needle)) + 1;

beforeAll(async () => {
  await loadPageLibraries();
});

describe('the page an iframe plays', () => {
  it('carries the bundled p5 once, in place of the CDN copy', () => {
    const html = jsAnimationIframeHtml(p5Page);
    expect(html).not.toMatch(/src="https:\/\/cdnjs\.cloudflare\.com/);
    expect(html.match(/<script data-ghost-lib="p5">/g)).toHaveLength(1);
  });

  it('carries the bundled p5.sound when the page asked for one, after p5 and before the sketch', () => {
    const html = jsAnimationIframeHtml(p5Page);
    expect(html).not.toMatch(/src="https:\/\/cdn\.jsdelivr\.net/);
    expect(html.indexOf('data-ghost-lib="p5"')).toBeLessThan(html.indexOf('data-ghost-lib="p5.sound"'));
    expect(html.indexOf('data-ghost-lib="p5.sound"')).toBeLessThan(html.indexOf('function setup()'));
  });

  it('does not load p5 into pages that never mention it', () => {
    const html = jsAnimationIframeHtml('<html><head></head><body><canvas></canvas></body></html>');
    expect(html).not.toContain('data-ghost-lib');
    expect(html).toContain('<script type="importmap">');
  });

  it('plays p5 pages and sketches sandboxed, and three.js pages as before', () => {
    expect(playsSandboxed({ animationType: 'threejs', htmlCode: p5Page })).toBe(true);
    expect(playsSandboxed({ animationType: 'p5js', htmlCode: '<canvas></canvas>' })).toBe(true);
    expect(playsSandboxed({ animationType: 'threejs', htmlCode: '', sketch: { files: [] } })).toBe(true);
    expect(playsSandboxed({ animationType: 'threejs', htmlCode: '<script type="module">import * as THREE from "three";</script>' })).toBe(false);
    const page = iframePage({ animationType: 'p5js', htmlCode: p5Page });
    expect(page.sandboxed).toBe(true);
    // A sandboxed page talks to the app only by message; it has no importmap to the app's files.
    expect(page.html).toContain('ghost:"frame"');
    expect(page.html).not.toContain('importmap');
  });

  it('stops a loop that never ends in a sandboxed page, keeping its lines', () => {
    const looping = p5Page.replace('function draw() { background(0); }', 'function draw() { while (true) {} }');
    const page = iframePage({ animationType: 'p5js', htmlCode: looping });
    expect(page.html).toContain('window.__ghostLoopGuard=');
    const line = lastLineOf(page.html, 'function draw()');
    expect(page.html.split('\n')[line - 1]).toContain('__ghostLoopGuard.c(');
    expect(page.place(line)).toEqual({ file: 'index.html', line: lineOf(looping, 'function draw()') });
    // three.js pages play as they always have.
    const three = iframePage({ animationType: 'threejs', htmlCode: '<html><head></head><body><script>while (go()) {}</script></body></html>' });
    expect(three.html).not.toContain('__ghostLoopGuard');
  });

  it('keeps every page silent', () => {
    for (const html of [jsAnimationIframeHtml(p5Page), jsAnimationIframeHtml('<html><head></head><body></body></html>')]) {
      expect(html).toContain('AudioNode.prototype.connect');
      expect(html.indexOf('AudioNode.prototype.connect')).toBeLessThan(html.lastIndexOf('</head>'));
    }
  });

  it('gives the page a silent window.ghostAudio before any of its code runs', () => {
    const html = jsAnimationIframeHtml(p5Page);
    const at = html.indexOf('window.ghostAudio={');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('function setup()'));
    expect(html).toContain('"bass":0');
    expect(html).toContain('"active":false');
  });

  it('maps error lines back to the page as written, and none inside its own shims', () => {
    const page = iframePage({ animationType: 'p5js', htmlCode: p5Page });
    for (const needle of ['createCanvas', '<html>', '</body>']) {
      // <html> comes before the shims; the rest of the page after them.
      const find = needle === '<html>' ? lineOf : lastLineOf;
      expect(page.place(find(page.html, needle)), needle).toEqual({ file: 'index.html', line: lineOf(p5Page, needle) });
    }
    expect(page.place(lineOf(page.html, '__ghostSketchErrors'))).toBeNull();
    expect(page.place(null)).toBeNull();
  });

  it('keeps promise rejections too, with the page lines on their stack, innermost first', () => {
    const page = iframePage({ animationType: 'p5js', htmlCode: p5Page });
    const shim = page.html.split('\n').find((l) => l.includes('__ghostSketchErrors'))!;
    const code = shim.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const listeners: Record<string, (event: unknown) => void> = {};
    const fakeWindow: { __ghostSketchErrors?: Array<{ message: string; line: number | null; lines: number[]; count: number }> } = {};
    new Function('window', 'addEventListener', 'parent', 'setTimeout', code)(
      fakeWindow, (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; }, { postMessage() {} }, () => 1,
    );
    const sketchLine = lastLineOf(page.html, 'createCanvas');
    const p5Line = lineOf(page.html, 'data-ghost-lib="p5"');
    const error = new ReferenceError('asdfgh is not defined');
    error.stack = `ReferenceError: asdfgh is not defined\n    at e.default.createCanvas (blob:http://localhost:1431/1f2e:${p5Line}:120)\n    at setup (blob:http://localhost:1431/1f2e:${sketchLine}:20)`;
    listeners.unhandledrejection({ reason: error });
    listeners.unhandledrejection({ reason: 'plain' });
    listeners.error({ message: 'Uncaught TypeError: x is not a function', filename: `blob:http://localhost:1431/1f2e`, lineno: sketchLine, error: null });
    expect(fakeWindow.__ghostSketchErrors).toEqual([
      { message: 'Uncaught (in promise) ReferenceError: asdfgh is not defined', line: p5Line, lines: [p5Line, sketchLine], count: 1 },
      { message: 'Uncaught (in promise) plain', line: null, lines: [], count: 1 },
      { message: 'Uncaught TypeError: x is not a function', line: sketchLine, lines: [sketchLine], count: 1 },
    ]);
    // Inside p5 there is no place of the author's; the call from setup() is one.
    expect(page.place(p5Line)).toBeNull();
    expect(page.place(sketchLine)).toEqual({ file: 'index.html', line: lineOf(p5Page, 'createCanvas') });
  });

  it('maps lines of a fragment with no head or body', () => {
    const fragment = ['<canvas></canvas>', '<script>', 'boom();', '</script>'].join('\n');
    const page = iframePage({ animationType: 'threejs', htmlCode: fragment });
    expect(page.place(lineOf(page.html, 'boom()'))).toEqual({ file: 'index.html', line: 3 });
    expect(page.place(1)).toBeNull();
  });
});

describe('the show\'s audio for pages', () => {
  const quiet: VisualAudioState = {
    isActive: true, bands: {} as VisualAudioState['bands'], level: 0.5, energy: 0, peak: 0, bass: 0.2, bassFast: 0.8,
    mid: 2, treble: Number.NaN, high: -1, sub: 0, lowMid: 0, highMid: 0, air: 0, presence: 0, kick: 1, snare: 0,
    beat: 0.4, beatPhase: 0.25, lfoBeat: 0, lfoHalf: 0, lfoBar: 0, centroid: 0.3, bpm: 128,
  };

  it('keeps every value but bpm between 0 and 1, and the bass quick to answer', () => {
    const { bass, ...rest } = pageAudioFrom(quiet);
    expect(bass).toBeCloseTo(0.72);
    expect(rest).toEqual({
      level: 0.5, mid: 1, treble: 0, high: 0, beat: 0.4, beatPhase: 0.25, bpm: 128,
      centroid: 0.3, kick: 1, snare: 0, active: true,
    });
  });
});
