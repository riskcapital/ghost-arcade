import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsAnimationFromHtml } from '../renderer/jsAnimationPage';
import { sketchSource } from '../p5sketch/wrapSketch';
import type { JSAnimationSource } from '../types';
import { editorFiles, errorInFiles, filesFromPage, sketchWithFiles, sketchWrapping } from './sketchFiles';
import { readSketch } from './sketchSource';

const flock = readFileSync(resolve(__dirname, '../../../public/threejs/flock/index.html'), 'utf8');

describe('sketch files', () => {
  it('shows a page\'s inline sketch as sketch.js, the way the p5.js editor does', () => {
    const files = filesFromPage(flock)!;
    expect(files.map((f) => f.path)).toEqual(['sketch.js', 'index.html']);
    const sketch = files[0].text!;
    expect(sketch.startsWith('// Flock: A murmuration')).toBe(true);
    expect(sketch).toContain('\nfunction setup() {');
    expect(files[1].text).toContain('<script src="sketch.js"></script>');
    expect(files[1].text).not.toContain('function setup');
  });

  it('plays the same sketch after a round trip', () => {
    const source = jsAnimationFromHtml(flock);
    const files = editorFiles(source);
    const rebuilt = sketchWithFiles({ ...source, htmlCode: flock + ' ' }, files);
    const code = (html: string) => readSketch(html).scripts.map((s) => s.code.replace(/\s+/g, ' ').trim());
    expect(code(rebuilt.htmlCode)).toEqual(code(flock));
    expect(rebuilt.params?.map((p) => p.name)).toEqual(source.params?.map((p) => p.name));
  });

  it('gives files the plain line breaks the code editor uses', () => {
    const files = editorFiles({ animationType: 'p5js', htmlCode: flock.replace(/\r?\n/g, '\r\n') });
    for (const file of files) expect(file.text, file.path).not.toContain('\r');
  });

  it('keeps a page with nothing to take out as one file', () => {
    expect(editorFiles({ animationType: 'p5js', htmlCode: '<html><body><script src="x.js"></script></body></html>' }).map((f) => f.path)).toEqual(['index.html']);
  });

  it('places an error in the playing page in the file it came from', () => {
    const files = [
      { path: 'sketch.js', text: 'function setup() {\n  createCanvas(400, 400);\n}\n\nfunction draw() {\n  boom();\n}\n' },
      { path: 'index.html', text: '<html>\n<head>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<script src="sketch.js"></script>\n<p>after</p>\n</body>\n</html>\n' },
      { path: 'style.css', text: 'body {\n  margin: 0;\n}\n' },
    ];
    const source: JSAnimationSource = { animationType: 'p5js', htmlCode: '' };
    const page = sketchWithFiles(source, files).htmlCode;
    const pageLine = (needle: string) => page.split('\n').findIndex((l) => l.includes(needle)) + 1;
    expect(errorInFiles(source, files, { file: 'index.html', line: pageLine('boom()') })).toEqual({ file: 'sketch.js', line: 6 });
    expect(errorInFiles(source, files, { file: 'index.html', line: pageLine('margin') })).toEqual({ file: 'style.css', line: 2 });
    expect(errorInFiles(source, files, { file: 'index.html', line: pageLine('<p>after') })).toEqual({ file: 'index.html', line: 7 });
    expect(errorInFiles(source, files, { file: null, line: null })).toEqual({ file: null, line: null });
  });
});

describe('a sketch kept as files', () => {
  const index = '<!DOCTYPE html>\r\n<html>\r\n<head>\r\n<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.js"></script>\r\n<link rel="stylesheet" href="style.css">\r\n</head>\r\n<body>\r\n<script src="sketch.js"></script>\r\n</body>\r\n</html>\r\n';
  const sketchJs = 'let size = 40;\r\n\r\nfunction setup() {\r\n  createCanvas(400, 400);\r\n}\r\n\r\nfunction draw() {\r\n  background(0);\r\n  circle(200, 200, size);\r\n}\r\n';
  const style = 'body {\r\n  margin: 0;\r\n}\r\n';
  const stored = () =>
    sketchSource({
      files: [
        { path: 'index.html', text: index, mime: 'text/html' },
        { path: 'sketch.js', text: sketchJs, mime: 'text/javascript' },
        { path: 'style.css', text: style, mime: 'text/css' },
      ],
    });

  it('shows the files as they were written, not the page that plays', () => {
    const source = stored();
    const files = editorFiles(source);
    expect(files.map((f) => f.path)).toEqual(['index.html', 'sketch.js', 'style.css']);
    expect(files.find((f) => f.path === 'sketch.js')!.text).toBe(sketchJs.replace(/\r\n/g, '\n'));
    expect(files.find((f) => f.path === 'index.html')!.text).toBe(index.replace(/\r\n/g, '\n'));
    for (const file of files) expect(file.text, file.path).not.toContain('\r');
  });

  it('hands back the same source when nothing changed', () => {
    const source = stored();
    expect(sketchWithFiles(source, editorFiles(source))).toBe(source);
  });

  it('keeps the edited files as written and wraps them again to play', () => {
    const source = stored();
    const files = editorFiles(source).map((f) => (f.path === 'sketch.js' ? { ...f, text: f.text!.replace('let size = 40;', 'let size = 80;') } : f));
    const next = sketchWithFiles(source, files);
    const kept = new Map(next.sketch!.files.map((f) => [f.path, f]));
    expect(kept.get('sketch.js')!.text).toContain('let size = 80;');
    expect(kept.get('sketch.js')!.text).not.toContain('__ga');
    // Files the editor left alone go back byte for byte, line breaks included.
    expect(kept.get('index.html')).toBe(source.sketch!.files[0]);
    expect(kept.get('style.css')).toBe(source.sketch!.files[2]);
    expect(next.htmlCode).not.toBe(source.htmlCode);
    expect(next.paramValues?.size).toBe(80);
  });

  it('leaves errors in the file the player names', () => {
    const source = stored();
    const error = { file: 'sketch.js', line: 9 };
    expect(errorInFiles(source, editorFiles(source), error)).toBe(error);
  });

  it('says what Ghost Arcade adds when the sketch plays', () => {
    const wrapping = sketchWrapping(stored())!;
    expect(['fill', 'fit']).toContain(wrapping.runtime.canvas?.mode);
    expect(wrapping.runtime.canvas?.reason).toBeTruthy();
    expect(wrapping.controls).toContain('size');
    expect(sketchWrapping({ animationType: 'p5js', htmlCode: flock })).toBeNull();
  });
});
