import { describe, expect, it } from 'vitest';
import { iframePage, jsAnimationIframeHtml } from './js-animation';

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
  it('loads the bundled p5 once, in place of the CDN copy', () => {
    const html = jsAnimationIframeHtml(p5Page);
    expect(html).not.toContain('cdnjs.cloudflare.com');
    expect(html.match(/<script src="\/lib\/p5\.min\.js"><\/script>/g)).toHaveLength(1);
  });

  it('loads the bundled p5.sound where the page asked for one, after p5 and before the sketch', () => {
    const html = jsAnimationIframeHtml(p5Page);
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html.indexOf('/lib/p5.min.js')).toBeLessThan(html.indexOf('/lib/p5.sound.min.js'));
    expect(html.indexOf('/lib/p5.sound.min.js')).toBeLessThan(html.indexOf('function setup()'));
  });

  it('does not load p5 into pages that never mention it', () => {
    expect(jsAnimationIframeHtml('<html><head></head><body><canvas></canvas></body></html>')).not.toContain('p5.min.js');
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

