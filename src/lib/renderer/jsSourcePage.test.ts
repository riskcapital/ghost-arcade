import { describe, expect, it } from 'vitest';

// @ts-ignore plain JS module shared with the Electron main process
import { buildHostHtml, buildHostPage, hostLineToPageLine, renderClockScript, uncaughtErrorMessage, wantsLiveClock, wantsTransparentBackground } from '../../../electron/js-source-page.js';
import vm from 'node:vm';

const threePage = `<!DOCTYPE html>
<html>
<head><title>t</title><script type="module">import * as THREE from 'three';</script></head>
<body></body>
</html>`;

const p5Page = `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/addons/p5.sound.min.js"></script>
</head>
<body><script>function setup(){ createCanvas(windowWidth, windowHeight); }</script></body>
</html>`;

describe('buildHostHtml', () => {
  it('puts the shims before any of the page scripts', () => {
    const html = buildHostHtml(threePage);
    const importMap = html.indexOf('<script type="importmap">');
    expect(importMap).toBeGreaterThan(html.indexOf('<head>'));
    expect(importMap).toBeLessThan(html.indexOf("import * as THREE from 'three'"));
    expect(html.indexOf('window.ghostAudio')).toBeLessThan(html.indexOf("import * as THREE from 'three'"));
  });

  it('maps three, its addons and its other entry points to the copy served by the host', () => {
    const html = buildHostHtml(threePage);
    const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)![1]);
    expect(map.imports).toMatchObject({
      three: '/lib/three.module.min.js',
      'three/addons/': '/lib/addons/',
      'three/examples/jsm/': '/lib/examples/jsm/',
      'three/webgpu': '/lib/three.webgpu.min.js',
      'three/tsl': '/lib/three.tsl.min.js',
    });
  });

  it('swaps a CDN p5 for the bundled one so only one sketch runs', () => {
    const html = buildHostHtml(p5Page);
    expect(html).not.toContain('cdnjs.cloudflare.com/ajax/libs/p5.js');
    expect(html.match(/<script src="\/lib\/p5\.min\.js"><\/script>/g)).toHaveLength(1);
    // Add-on libraries are the page's business and stay.
    expect(html).toContain('p5.sound.min.js');
  });

  it('does not load p5 into pages that never mention it', () => {
    expect(buildHostHtml(threePage)).not.toContain('/lib/p5.min.js');
  });

  it('still injects into fragments with no head or no body', () => {
    expect(buildHostHtml('<body><canvas></canvas></body>')).toMatch(/^<body>\n<style>/);
    expect(buildHostHtml('<canvas></canvas>')).toMatch(/^<style>[\s\S]*<canvas><\/canvas>$/);
  });

  it('pins the pixel ratio and paints an unpadded black page', () => {
    const html = buildHostHtml(threePage);
    expect(html).toContain('"devicePixelRatio",{value:1');
    expect(html).toContain('html,body{margin:0;padding:0;background:#000;overflow:hidden}');
  });
});

describe('see-through pages', () => {
  const transparentPage = '<html><head><meta name="ghost-arcade-background" content="transparent"><style>body{background:#000}</style></head><body><script src="p5.min.js"></script></body></html>';

  it('only pages that ask for it get a transparent background', () => {
    expect(wantsTransparentBackground(transparentPage)).toBe(true);
    expect(wantsTransparentBackground('<html><head></head><body></body></html>')).toBe(false);
    expect(wantsTransparentBackground('<meta name="ghost-arcade-background" content="black">')).toBe(false);
  });

  it('overrides the page background so the canvas alpha shows through', () => {
    const html = buildHostHtml(transparentPage);
    expect(html).toContain('background:transparent!important');
    expect(buildHostHtml('<html><head></head><body></body></html>')).toContain('background:#000');
  });
});

describe('tracing a trial run back to the page', () => {
  const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

  it('names the line of the page as given behind a line of the served page, and none for the host\'s own', () => {
    const { html, layout } = buildHostPage(p5Page);
    for (const needle of ['createCanvas', '<html>', '</html>']) {
      expect(hostLineToPageLine(layout, lineOf(html, needle)), needle).toBe(lineOf(p5Page, needle));
    }
    expect(hostLineToPageLine(layout, lineOf(html, 'window.ghostAudio'))).toBeNull();
    expect(hostLineToPageLine(layout, null)).toBeNull();
  });

  it('keeps the line breaks of the CDN tags it takes out', () => {
    const tall = p5Page.replace('<script src="https://cdnjs', '<script\n  src="https://cdnjs');
    const { html, layout } = buildHostPage(tall);
    expect(hostLineToPageLine(layout, lineOf(html, 'createCanvas'))).toBe(lineOf(tall, 'createCanvas'));
  });

  it('counts uncaught errors and rejections, not logs', () => {
    expect(uncaughtErrorMessage('Uncaught ReferenceError: x is not defined')).toBe('Uncaught ReferenceError: x is not defined');
    expect(uncaughtErrorMessage('Uncaught (in promise) TypeError: boom')).toBe('Uncaught (in promise) TypeError: boom');
    expect(uncaughtErrorMessage('🌸 p5.js says: hello')).toBeNull();
    expect(uncaughtErrorMessage(undefined)).toBeNull();
  });
});

describe('the render clock in a page', () => {
  // The script on a stand-in window: real rAF frames run when the test says.
  function page(opts = { dateMs: 1_700_000_000_000, seed: 7 }) {
    const realFrames: Array<() => void> = [];
    let onStep: ((s: unknown) => void) | null = null;
    const answered: number[] = [];
    const window: Record<string, unknown> = {
      requestAnimationFrame: (cb: () => void) => { realFrames.push(cb); return 1; },
      ghostHost: { onStep: (cb: (s: unknown) => void) => { onStep = cb; }, stepped: (n: number) => answered.push(n) },
      ghostAudio: { level: 0 },
    };
    const ctx = vm.createContext({ window, performance: { now: () => 123456 }, Date, Math: Object.create(Math), Reflect, Object, Array, console });
    window.Date = Date;
    vm.runInContext(`window.performance = performance; window.Math = Math; ${renderClockScript(opts)}; window.__Date = window.Date;`, ctx);
    const run = (code: string) => vm.runInContext(code, ctx);
    const flushReal = () => { const f = realFrames.splice(0); f.forEach((cb) => cb()); };
    return { window, run, step: (s: unknown) => onStep!(s), answered, flushReal };
  }

  it('time moves only on a step, by the step, and animation frames run with it', () => {
    const p = page();
    expect(p.run('performance.now()')).toBe(0);
    p.run('window.seen = []; window.requestAnimationFrame(function (t) { window.seen.push(t); window.requestAnimationFrame(function (t2) { window.seen.push(t2); }); });');
    p.step({ n: 1, ms: 0, audio: { level: 0.5 } });
    expect(p.run('window.seen')).toEqual([0]);
    expect((p.window.ghostAudio as { level: number }).level).toBe(0.5);
    p.step({ n: 2, ms: 1000 / 24 });
    expect(p.run('window.seen')).toEqual([0, 1000 / 24]);
    expect(p.run('performance.now()')).toBe(1000 / 24);
    expect(p.run('window.__Date.now()')).toBe(1_700_000_000_000 + 1000 / 24);
    expect(p.run('new window.__Date().getTime()')).toBe(Math.round(1_700_000_000_000 + 1000 / 24 - 0.5));
    expect(p.run('new window.__Date(5).getTime()')).toBe(5);
    expect(p.run('new window.__Date() instanceof Date')).toBe(true);
  });

  it('answers a step after two of Chromium\'s own frames, so the drawing is on screen', () => {
    const p = page();
    p.step({ n: 9, ms: 0 });
    expect(p.answered).toEqual([]);
    p.flushReal();
    expect(p.answered).toEqual([]);
    p.flushReal();
    expect(p.answered).toEqual([9]);
  });

  it('a cancelled frame does not run, and random numbers repeat from render to render', () => {
    const a = page();
    a.run('window.ran = 0; var id = window.requestAnimationFrame(function () { window.ran++; }); window.cancelAnimationFrame(id);');
    a.step({ n: 1, ms: 16 });
    expect(a.run('window.ran')).toBe(0);
    const seq = (p: ReturnType<typeof page>) => p.run('[Math.random(), Math.random(), Math.random()]');
    expect(seq(page())).toEqual(seq(page()));
  });

  it('a page can keep its own clock', () => {
    expect(wantsLiveClock('<meta name="ghost-arcade-clock" content="live">')).toBe(true);
    expect(wantsLiveClock('<meta name="viewport" content="live">')).toBe(false);
    expect(buildHostHtml('<html><head></head></html>', { renderClock: { dateMs: 1, seed: 2 } })).toContain('host.onStep');
    expect(buildHostHtml('<html><head></head></html>')).not.toContain('host.onStep');
  });
});

