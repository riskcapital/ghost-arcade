import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * The main process side of the p5.js Web Editor import
 * (electron/p5-editor-import.cjs): fixed editor URLs, sketch files walked
 * from the editor's flat list, and uploads downloaded only from the hosts
 * the editor stores them on.
 */

const require = createRequire(import.meta.url);
const electronDir = join(process.cwd(), 'electron');
const editor = require(join(electronDir, 'p5-editor-import.cjs'));
const mainSource = readFileSync(join(electronDir, 'main.js'), 'utf8');
const preloadSource = readFileSync(join(electronDir, 'preload.cjs'), 'utf8');

function project(id: string, name: string, files: unknown[]) {
  return { id, name, createdAt: '2024-06-03T01:05:14.476Z', updatedAt: '2024-06-03T01:05:14.476Z', visibility: 'Public', files };
}

const FILES = [
  { name: 'root', fileType: 'folder', id: 'r', children: ['a', 'b', 'c'] },
  { name: 'sketch.js', fileType: 'file', id: 'a', content: 'function setup() {}', children: [] },
  {
    name: 'index.html',
    fileType: 'file',
    id: 'b',
    content: '<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.js"></script><script src="sketch.js"></script>',
    children: [],
  },
  { name: 'assets', fileType: 'folder', id: 'c', children: ['d', 'e', 'f', 'g'] },
  { name: 'moon.jpg', fileType: 'file', id: 'd', url: 'https://assets.editor.p5js.org/u/moon.jpg', children: [] },
  { name: 'far.png', fileType: 'file', id: 'e', url: 'https://example.com/far.png', children: [] },
  { name: 'p5.min.js', fileType: 'file', id: 'f', url: 'https://cdn.jsdelivr.net/npm/p5/lib/p5.min.js', children: [] },
  { name: '..', fileType: 'file', id: 'g', content: 'x', children: [] },
  { name: 'orphan.js', fileType: 'file', id: 'z', content: 'x', children: [] },
];

type Responder = (url: string) => Response;

function fakeFetch(respond: Responder) {
  const calls: string[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push(url);
    expect(init.redirect).toBe('manual');
    return respond(url);
  };
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sketch files from the editor', () => {
  it('walks the folder tree into paths and leaves out stray and unsafe entries', () => {
    expect(editor.sketchFileEntries(FILES).map((f: { path: string }) => f.path)).toEqual([
      'sketch.js', 'index.html', 'assets/moon.jpg', 'assets/far.png', 'assets/p5.min.js',
    ]);
  });

  it('survives a folder that names itself as a child', () => {
    const loop = [{ name: 'root', fileType: 'folder', id: 'r', children: ['r', 'x'] }, { name: 'x', fileType: 'folder', id: 'x', children: ['x'] }];
    expect(editor.sketchFileEntries(loop)).toEqual([]);
  });

  it('lists the scripts a page loads', () => {
    expect(editor.scriptSources(FILES[2].content)).toEqual(['https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.js', 'sketch.js']);
  });
});

describe('listSketches', () => {
  it('reads a user from the fixed editor URL and returns summaries, newest first', async () => {
    const older = project('older1', 'Older', FILES);
    const newer = { ...project('newer1', 'Newer', FILES), updatedAt: '2025-01-01T00:00:00.000Z' };
    const { impl, calls } = fakeFetch(() => json({ projects: [older, newer] }));
    const result = await editor.listSketches('p5', { fetchImpl: impl });
    expect(calls).toEqual(['https://editor.p5js.org/editor/p5/projects']);
    expect(result.ok).toBe(true);
    expect(result.sketches.map((s: { id: string }) => s.id)).toEqual(['newer1', 'older1']);
    expect(result.sketches[0]).toEqual({
      id: 'newer1',
      name: 'Newer',
      createdAt: '2024-06-03T01:05:14.476Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      scripts: ['https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.js', 'sketch.js'],
      files: 5,
      assets: 3,
    });
  });

  it('refuses usernames that could reach another path', async () => {
    const { impl, calls } = fakeFetch(() => json({ projects: [] }));
    for (const name of ['..', '../admin', 'a/b', 'a?b', '', ' ', 'x'.repeat(65)]) {
      expect((await editor.listSketches(name, { fetchImpl: impl })).ok, name).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it('explains an unknown user and a busy editor', async () => {
    const missing = await editor.listSketches('nobody', { fetchImpl: fakeFetch(() => json({ message: 'nope' }, 404)).impl });
    expect(missing).toEqual({ ok: false, reason: 'There is no p5.js Web Editor user called "nobody".' });
    const busy = await editor.listSketches('p5', { fetchImpl: fakeFetch(() => json({}, 429)).impl });
    expect(busy.reason).toMatch(/busy/);
  });

  it('will not follow the editor off its own host', async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    const result = await editor.listSketches('p5', { fetchImpl: impl });
    expect(result.ok).toBe(false);
    expect(calls).toEqual(['https://editor.p5js.org/editor/p5/projects']);
  });
});

describe('getSketch', () => {
  it('downloads uploads from the editor hosts and keeps the rest as links', async () => {
    const sketchJson = { ...project('6vk4kMm65eE', 'Alpha Mask', FILES), user: { username: 'p5' } };
    const { impl, calls } = fakeFetch((url) => {
      if (url.startsWith('https://editor.p5js.org/')) return json(sketchJson);
      if (url === 'https://assets.editor.p5js.org/u/moon.jpg') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
      throw new Error(`unexpected ${url}`);
    });
    const result = await editor.getSketch('p5', '6vk4kMm65eE', { fetchImpl: impl });
    expect(calls).toEqual(['https://editor.p5js.org/editor/p5/projects/6vk4kMm65eE', 'https://assets.editor.p5js.org/u/moon.jpg']);
    expect(result.sketch).toMatchObject({
      id: '6vk4kMm65eE',
      name: 'Alpha Mask',
      author: 'p5',
      url: 'https://editor.p5js.org/p5/sketches/6vk4kMm65eE',
    });
    expect(result.sketch.files).toEqual([
      { path: 'sketch.js', text: 'function setup() {}' },
      { path: 'index.html', text: FILES[2].content },
      { path: 'assets/moon.jpg', base64: 'AQID', mime: 'image/jpeg' },
      { path: 'assets/far.png', url: 'https://example.com/far.png', remote: 'host' },
      { path: 'assets/p5.min.js', url: 'https://cdn.jsdelivr.net/npm/p5/lib/p5.min.js', remote: 'library' },
    ]);
  });

  it('keeps an upload over the size limit as a link', async () => {
    const big = new Uint8Array(editor.ASSET_MAX_BYTES + 1);
    const { impl } = fakeFetch((url) => (url.startsWith('https://editor.p5js.org/')
      ? json(project('id1', 'Big', FILES))
      : new Response(big, { headers: { 'content-length': String(big.length) } })));
    const result = await editor.getSketch('p5', 'id1', { fetchImpl: impl });
    expect(result.sketch.files[2]).toEqual({ path: 'assets/moon.jpg', url: 'https://assets.editor.p5js.org/u/moon.jpg', remote: 'size' });
  });

  it('refuses a redirect from an upload host to anywhere else', async () => {
    const { impl, calls } = fakeFetch((url) => (url.startsWith('https://editor.p5js.org/')
      ? json(project('id1', 'R', FILES))
      : new Response(null, { status: 301, headers: { location: 'http://localhost:8080/secret' } })));
    const result = await editor.getSketch('p5', 'id1', { fetchImpl: impl });
    expect(result.sketch.files[2]).toMatchObject({ path: 'assets/moon.jpg', remote: 'failed' });
    expect(calls.some((u) => u.includes('localhost'))).toBe(false);
  });

  it('points a private or missing sketch at the zip route', async () => {
    const result = await editor.getSketch('p5', 'nope', { fetchImpl: fakeFetch(() => json({}, 404)).impl });
    expect(result).toEqual({ ok: false, reason: 'That sketch does not exist, or it is private. Private sketches import from a downloaded zip.' });
  });
});

describe('the IPC surface', () => {
  it('accepts uploads only over https from the editor and CDN hosts', () => {
    expect(editor.isAllowedAssetUrl('https://assets.editor.p5js.org/a.png')).toBe(true);
    expect(editor.isAllowedAssetUrl('https://cdn.jsdelivr.net/gh/x/y@main/a.png')).toBe(true);
    expect(editor.isAllowedAssetUrl('http://assets.editor.p5js.org/a.png')).toBe(false);
    expect(editor.isAllowedAssetUrl('https://assets.editor.p5js.org.evil.com/a.png')).toBe(false);
    expect(editor.isAllowedAssetUrl('https://user:pw@assets.editor.p5js.org/a.png')).toBe(false);
    expect(editor.isAllowedAssetUrl('file:///etc/passwd')).toBe(false);
  });

  it('is registered in the main process and allowed by the preload', () => {
    for (const command of ['p5_editor_list_sketches', 'p5_editor_get_sketch']) {
      expect(mainSource).toContain(`ipcMain.handle('${command}'`);
      expect(preloadSource).toContain(`'${command}'`);
    }
  });
});
