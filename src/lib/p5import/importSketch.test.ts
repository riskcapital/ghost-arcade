import { describe, expect, it } from 'vitest';
import { MAX_KEPT_FILE_BYTES } from '../p5sketch/files';
import type { P5Sketch } from '../p5sketch/files';
import { importSketch } from './importSketch';

const INDEX = '<html><head><script src="p5.js"></script></head><body><script src="sketch.js"></script></body></html>';
const SKETCH = 'let speed = 2;\nfunction setup() { createCanvas(400, 400); }\nfunction draw() { circle(width / 2, height / 2, 10 * speed); }';
const tooBig = 'A'.repeat(Math.ceil(((MAX_KEPT_FILE_BYTES + 1024) * 4) / 3));

function zipSketch(): P5Sketch {
  return {
    name: 'Orbit',
    source: 'zip',
    files: [
      { path: 'index.html', text: INDEX },
      { path: 'sketch.js', text: SKETCH },
      { path: 'p5.js', text: '/*! p5.js v1.9.4 May 21, 2024 */', remote: 'library' },
      { path: 'assets/film.mov', base64: tooBig },
      { path: 'assets/dot.png', base64: 'iVBORw0KGgo=', mime: 'image/png' },
    ],
  };
}

describe('importSketch', () => {
  const imported = importSketch(zipSketch(), { now: 42 });

  it('keeps the sketch files exactly as written, without copies of p5', () => {
    expect(imported.source.sketch?.files).toEqual([
      { path: 'index.html', text: INDEX },
      { path: 'sketch.js', text: SKETCH },
      { path: 'assets/dot.png', base64: 'iVBORw0KGgo=', mime: 'image/png' },
    ]);
  });

  it('says what was too large to keep', () => {
    expect(imported.notes[0]).toBe('film.mov (8.0 MB) is too large to keep with the sketch, so it plays without it.');
  });

  it('records where it came from and the p5.js it was made with', () => {
    expect(imported.source.origin).toEqual({ kind: 'p5-editor', sketchName: 'Orbit', importedFrom: 'zip', importedAt: 42, p5Version: '1.9.4' });
    expect(imported.wrapped.p5Version).toBe('1.9.4');
  });

  it('plays from a page wrapped around the kept files, with controls', () => {
    expect(imported.source.htmlCode).not.toContain('function setup()');
    expect(imported.source.htmlCode).toContain('<script src="sketch.js"></script>');
    expect(imported.source.params?.map((p) => p.name)).toEqual(['speed']);
    expect(imported.wrapped.canvas.recommended).toBe('fill');
  });

  it('keeps the canvas the person chose', () => {
    const fitted = importSketch(zipSketch(), { canvas: 'fit' });
    expect(fitted.source.sketch?.canvas).toBe('fit');
    expect(fitted.wrapped.canvas.mode).toBe('fit');
    expect(importSketch(zipSketch()).source.sketch).not.toHaveProperty('canvas');
  });

  it('marks loose files as a sketch of their own, not one from the editor', () => {
    const local = importSketch({ name: 'walker', source: 'files', files: [{ path: 'sketch.js', text: SKETCH }] });
    expect(local.source.origin).toMatchObject({ kind: 'p5-files', importedFrom: 'files', sketchName: 'walker' });
    expect(local.source.htmlCode).toContain('<!-- p5.js sketch "walker" -->');
  });

  it('keeps an upload too large to carry as a link it loads online', () => {
    const fromEditor = importSketch({
      name: 'Clip',
      source: 'account',
      author: 'p5',
      files: [
        { path: 'sketch.js', text: 'function setup() {}' },
        { path: 'clip.mp4', url: 'https://assets.editor.p5js.org/clip.mp4', remote: 'size' },
      ],
    });
    expect(fromEditor.source.sketch?.files[1]).toEqual({ path: 'clip.mp4', url: 'https://assets.editor.p5js.org/clip.mp4' });
    expect(fromEditor.notes).toContain('clip.mp4 loads from assets.editor.p5js.org each time it plays.');
  });
});
