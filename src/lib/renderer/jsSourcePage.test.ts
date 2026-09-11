import { describe, expect, it } from 'vitest';

// @ts-ignore plain JS module shared with the Electron main process
import { buildHostHtml } from '../../../electron/js-source-page.js';

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
