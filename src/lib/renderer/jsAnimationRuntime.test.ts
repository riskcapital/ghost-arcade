import { describe, expect, it } from 'vitest';
import { iframePage as playedPage, jsAnimationIframeHtml as playedHtml, pageAudioFrom, type IframePageOptions } from './js-animation';
import { renameThreeCoreImport, THREE_CORE_SPECIFIER, type PageLibraries } from './sandboxPage';
import type { VisualAudioState } from '../audio/visualAudio';
import type { JSAnimationSource } from '../types';

/** Stand-ins for the bundled libraries, two lines each like the real minified files. */
const LIBRARIES: PageLibraries = {
  p5: '/*! p5.js v1.11.0 */\nwindow.p5 = function () {};',
  p5Sound: '/*! p5.sound */\nwindow.p5.SoundFile = function () {};',
  threeModuleUrl: 'data:text/javascript;base64,VEhSRUU=',
  threeCoreUrl: 'data:text/javascript;base64,Q09SRQ==',
};
const iframePage = (source: JSAnimationSource, options: IframePageOptions = {}) => playedPage(source, { libraries: LIBRARIES, nonce: 'n1', ...options });
const jsAnimationIframeHtml = (page: string, options: IframePageOptions = {}) => playedHtml(page, { libraries: LIBRARIES, nonce: 'n1', ...options });

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

describe('the page an iframe plays', () => {
  it('carries the bundled p5 once, in place of the CDN copy', () => {
    const html = jsAnimationIframeHtml(p5Page);
    expect(html).not.toContain('cdnjs.cloudflare.com');
    expect(html.match(/<script data-ghost-lib="p5">/g)).toHaveLength(1);
    expect(html).toContain('window.p5 = function () {};');
  });

  it('carries the bundled p5.sound when the page asked for one, after p5 and before the sketch', () => {
    const html = jsAnimationIframeHtml(p5Page);
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html.indexOf('data-ghost-lib="p5"')).toBeLessThan(html.indexOf('data-ghost-lib="p5.sound"'));
    expect(html.indexOf('data-ghost-lib="p5.sound"')).toBeLessThan(html.indexOf('function setup()'));
  });

  it('does not load p5 into pages that never mention it', () => {
    expect(jsAnimationIframeHtml('<html><head></head><body><canvas></canvas></body></html>')).not.toContain('data-ghost-lib');
  });

  it('loads nothing from the app: a sandboxed page has no origin to load it from', () => {
    const three = '<html><head><script type="module">import * as THREE from "three";</script></head><body></body></html>';
    for (const html of [jsAnimationIframeHtml(p5Page), jsAnimationIframeHtml(three)]) {
      expect(html).not.toMatch(/src="[^"]*\/lib\//);
      expect(html).not.toContain('/lib/three');
    }
    const map = JSON.parse(jsAnimationIframeHtml(three).match(/<script type="importmap">(.*?)<\/script>/)![1]);
    expect(map.imports).toEqual({ three: LIBRARIES.threeModuleUrl, [THREE_CORE_SPECIFIER]: LIBRARIES.threeCoreUrl });
    expect(jsAnimationIframeHtml(p5Page)).not.toContain('importmap');
  });

  it('lets three find its core from a data: URL', () => {
    expect(renameThreeCoreImport('import{a as b}from"./three.core.min.js";export{c}from"./three.core.min.js";'))
      .toBe(`import{a as b}from"${THREE_CORE_SPECIFIER}";export{c}from"${THREE_CORE_SPECIFIER}";`);
  });

  it('never lets a library close its own script element', () => {
    const html = playedHtml(p5Page, { libraries: { ...LIBRARIES, p5: 'var s = "</script><img src=x>";' } });
    expect(html).toContain('var s = "<\\/script><img src=x>";');
  });

  it('talks to the editor only through messages stamped with its run', () => {
    const html = jsAnimationIframeHtml(p5Page);
    expect(html).toContain('var N="n1",P=window.parent;');
    expect(html).toContain('P.postMessage(m,"*",t||[])');
    // Nothing reaches into the editor's window.
    expect(html).not.toMatch(/parent\.(?!postMessage)[a-zA-Z]/);
  });

  it('is silent when asked, and only then', () => {
    expect(jsAnimationIframeHtml(p5Page, { muted: true })).toContain('AudioDestinationNode');
    expect(jsAnimationIframeHtml(p5Page)).not.toContain('AudioDestinationNode');
  });

  it('guards the page\'s loops on their own lines', () => {
    const looping = p5Page.replace('function draw() { background(0); }', 'function draw() { let y = 0; while (y < height) { line(0, y, width, y); } }');
    const page = iframePage({ animationType: 'p5js', htmlCode: looping });
    const line = lineOf(page.html, 'while (y < height)');
    expect(page.html.split('\n')[line - 1]).toContain('__ghostLoopGuard.c(');
    expect(page.place(line)).toEqual({ file: 'index.html', line: lineOf(looping, 'while (y < height)') });
    expect(page.html.indexOf('window.__ghostLoopGuard=')).toBeLessThan(page.html.indexOf('while (y < height)'));
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
      expect(page.place(lineOf(page.html, needle)), needle).toEqual({ file: 'index.html', line: lineOf(p5Page, needle) });
    }
    expect(page.place(lineOf(page.html, '__ghostSketchErrors'))).toBeNull();
    expect(page.place(null)).toBeNull();
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
