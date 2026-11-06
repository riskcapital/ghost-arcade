import { describe, expect, it } from 'vitest';
import { localFilesFromList, looksLikeSketch, sketchFromLocalFiles, type LocalFile } from './localFiles';

const file = (path: string, body: string | Uint8Array, type = '') => ({ path, file: new File([body as BlobPart], path.split('/').pop()!, { type }) });

describe('local sketch files', () => {
  it('reads a dropped folder as the sketch, named by its page', async () => {
    const files: LocalFile[] = [
      file('orbit/index.html', '<html><head><title>Orbit</title></head><body><script src="sketch.js"></script></body></html>'),
      file('orbit/sketch.js', 'function draw() {}'),
      file('orbit/assets/dot.png', new Uint8Array([137, 80, 78, 71]), 'image/png'),
      file('orbit/libraries/p5.min.js', `/*! p5.js v1.9.0 */${'x'.repeat(1000)}`),
      file('orbit/.DS_Store', 'junk'),
    ];
    const sketch = await sketchFromLocalFiles(files);
    expect(sketch.name).toBe('Orbit');
    expect(sketch.source).toBe('files');
    expect(sketch.files).toEqual([
      { path: 'index.html', text: '<html><head><title>Orbit</title></head><body><script src="sketch.js"></script></body></html>' },
      { path: 'sketch.js', text: 'function draw() {}' },
      { path: 'assets/dot.png', base64: 'iVBORw==', mime: 'image/png' },
      { path: 'libraries/p5.min.js', text: `/*! p5.js v1.9.0 */${'x'.repeat(237)}`, remote: 'library' },
    ]);
  });

  it('takes loose files picked together, named by their folder or as a sketch', async () => {
    const sketch = await sketchFromLocalFiles(localFilesFromList([
      new File(['function setup() {}'], 'sketch.js'),
      new File(['body { margin: 0 }'], 'style.css'),
    ]));
    expect(sketch.name).toBe('p5.js sketch');
    expect(sketch.files.map((f) => f.path)).toEqual(['sketch.js', 'style.css']);
  });

  it('turns away files with no JavaScript of their own', async () => {
    await expect(sketchFromLocalFiles([file('a.html', '<html></html>'), file('p5.js', '/*! p5.js v1 */')])).rejects.toThrow(/no \.js file/);
  });

  it('tells a sketch from a page or from media', () => {
    expect(looksLikeSketch(['index.html', 'sketch.js'])).toBe(true);
    expect(looksLikeSketch(['walker.js'])).toBe(true);
    expect(looksLikeSketch(['index.html'])).toBe(false);
    expect(looksLikeSketch(['p5.min.js', 'photo.png'])).toBe(false);
  });
});
