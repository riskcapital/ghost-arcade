import { describe, expect, it } from 'vitest';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { listZipEntries, sketchFromZip, sketchNameFromZipName, ZipError, type InflateRaw } from './zip';

const inflate: InflateRaw = async (data) => new Uint8Array(inflateRawSync(data));

/** A zip archive written the way the p5.js Web Editor writes them. */
function makeZip(entries: Array<{ name: string; data: string | Uint8Array; store?: boolean }>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(encoder.encode(entry.name));
    const raw = Buffer.from(typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data);
    const isFolder = entry.name.endsWith('/');
    const method = entry.store || isFolder ? 0 : 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('sketch zips', () => {
  it('reads an editor download: text, binary files, and p5 itself by its version only', async () => {
    const zip = makeZip([
      { name: 'sketch.js', data: 'function setup() { createCanvas(400, 400); }' },
      { name: 'index.html', data: '<html><head></head><body><script src="sketch.js"></script></body></html>' },
      { name: 'assets/', data: '' },
      { name: 'assets/moon.png', data: PNG, store: true },
      { name: 'p5.js', data: `/*! p5.js v1.9.4 May 21, 2024 */\n${'x'.repeat(5000)}` },
      { name: 'p5.sound.min.js', data: '/** [p5.sound]  Version: 1.0.1 */' },
    ]);
    const sketch = await sketchFromZip('Image Alpha Mask_2026_10_28_15_09_37.zip', zip, inflate);
    expect(sketch.name).toBe('Image Alpha Mask');
    expect(sketch.source).toBe('zip');
    expect(sketch.files.map((f) => f.path)).toEqual(['sketch.js', 'index.html', 'assets/moon.png', 'p5.js', 'p5.sound.min.js']);
    expect(sketch.files[0].text).toBe('function setup() { createCanvas(400, 400); }');
    expect(sketch.files[2]).toEqual({ path: 'assets/moon.png', base64: Buffer.from(PNG).toString('base64'), mime: 'image/png' });
    expect(sketch.files[3].remote).toBe('library');
    expect(sketch.files[3].text!.length).toBeLessThanOrEqual(256);
    expect(sketch.files[3].text).toContain('p5.js v1.9.4');
  });

  it('drops the folder a sketch was zipped in, and system clutter', async () => {
    const zip = makeZip([
      { name: 'My Sketch/index.html', data: '<html></html>' },
      { name: 'My Sketch/sketch.js', data: 'function draw() {}' },
      { name: '__MACOSX/My Sketch/._sketch.js', data: 'junk' },
      { name: 'My Sketch/.DS_Store', data: 'junk' },
    ]);
    const sketch = await sketchFromZip('My Sketch.zip', zip, inflate);
    expect(sketch.files.map((f) => f.path)).toEqual(['index.html', 'sketch.js']);
  });

  it('refuses a zip with no sketch in it', async () => {
    await expect(sketchFromZip('photos.zip', makeZip([{ name: 'a.png', data: PNG }]), inflate)).rejects.toThrow(/No p5\.js sketch/);
  });

  it('refuses a file that is not a zip', () => {
    expect(() => listZipEntries(new TextEncoder().encode('not a zip at all, just some text'))).toThrow(ZipError);
  });

  it('never writes a path outside the sketch', async () => {
    const zip = makeZip([
      { name: '../../evil.js', data: 'x' },
      { name: 'sketch.js', data: 'function draw() {}' },
    ]);
    const sketch = await sketchFromZip('s.zip', zip, inflate);
    expect(sketch.files.map((f) => f.path)).toEqual(['sketch.js']);
  });

  it('names a sketch after its download', () => {
    expect(sketchNameFromZipName('Snowflakes_2024_06_03_01_05_14.zip')).toBe('Snowflakes');
    expect(sketchNameFromZipName('flow field.zip')).toBe('flow field');
    expect(sketchNameFromZipName('.zip')).toBe('Untitled sketch');
  });
});
