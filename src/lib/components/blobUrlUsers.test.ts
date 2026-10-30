import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Loading a new file into a model or splat layer frees the URL it replaced,
 * but only once nothing else uses it: a VJ clip in any block or deck, another
 * layer, a media item or an undo step would otherwise break on its next load.
 */
vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  isDesktopApp: true,
  isElectron: true,
  invoke: vi.fn(async () => null),
}));

const fakeElement = () => ({ getContext: () => null, style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} });
vi.stubGlobal('document', {
  createElement: fakeElement,
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {}, removeChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  documentElement: {
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  visibilityState: 'visible',
});
vi.stubGlobal('window', Object.assign(new EventTarget(), {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}));
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(), key: () => null, length: 0,
});
vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16));
vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

const { project } = await import('../stores/layers');
const { vjClipLauncher } = await import('../stores/vjClipLauncher');
const { mediaLibrary } = await import('../stores/media');
const { history } = await import('../stores/history');
const { keyframeTimeline } = await import('../stores/keyframeTimeline');
const { releaseBlobUrl, referencesUrl } = await import('./blobUrlUsers');
const { get } = await import('svelte/store');

const revoke = vi.fn();
let originalRevoke: typeof URL.revokeObjectURL;

beforeEach(() => {
  originalRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = revoke;
  vjClipLauncher.reset();
  mediaLibrary.reset();
  history.clear();
  // Clearing the media library revokes its own items' URLs.
  revoke.mockClear();
});
afterEach(() => {
  URL.revokeObjectURL = originalRevoke;
});
afterAll(() => {
  keyframeTimeline.stop();
  vi.unstubAllGlobals();
});

const modelClip = (id: string, url: string) =>
  ({ id, type: 'model3d', name: id, src: '', model3dContent: { modelData: url, modelFormat: 'glb' } }) as any;
const splatClip = (id: string, url: string) =>
  ({ id, type: 'splat', name: id, src: '', splatContent: { filePath: url } }) as any;

/** The panel loads a new file into a layer: the layer now shows `next`, and
 *  the URL it showed before is released. */
function loadIntoLayer(owned: Map<string, unknown>, previous: string, next: string): boolean {
  owned.set(next, {});
  project.update((p: any) => ({
    ...p,
    layers: [{ id: 'model-layer', type: 'model3d', name: 'Model', model3dContent: { modelData: next } }],
  }));
  return releaseBlobUrl(owned, previous);
}

describe('releasing a model or splat blob URL', () => {
  it('keeps a URL a VJ clip still uses, also in a hidden block', () => {
    const owned = new Map<string, unknown>([['blob:in-hidden-block', {}]]);
    const home = get(vjClipLauncher).activeBlockId;
    vjClipLauncher.addBlock('Away');
    const away = get(vjClipLauncher).blocks[get(vjClipLauncher).blocks.length - 1].id;
    vjClipLauncher.setActiveBlock(away);
    vjClipLauncher.setClip(1, 3, modelClip('hidden', 'blob:in-hidden-block'));
    vjClipLauncher.setActiveBlock(home);
    expect(get(vjClipLauncher).clipGrid[1][3]).toBeNull();

    expect(loadIntoLayer(owned, 'blob:in-hidden-block', 'blob:new-1')).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    expect(owned.has('blob:in-hidden-block')).toBe(true);
  });

  it('keeps a URL playing on deck B or sitting in the visible grid', () => {
    const owned = new Map<string, unknown>([['blob:deck-b', {}], ['blob:grid', {}]]);
    vjClipLauncher.launchTransientClip(2, splatClip('b', 'blob:deck-b'), 'B');
    vjClipLauncher.setClip(0, 0, modelClip('grid', 'blob:grid'));

    expect(loadIntoLayer(owned, 'blob:deck-b', 'blob:new-2')).toBe(false);
    expect(loadIntoLayer(owned, 'blob:grid', 'blob:new-3')).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('keeps a URL another layer, a media item or an undo step still holds', () => {
    const owned = new Map<string, unknown>([['blob:media', {}], ['blob:undo', {}], ['blob:other-layer', {}]]);
    mediaLibrary.addItem({ id: 'm', name: 'Model', type: 'video', src: 'blob:media' } as any);
    history.init({ id: 'p', name: 'P', width: 1, height: 1, layers: [{ id: 'old', model3dContent: { modelData: 'blob:undo' } }] } as any);

    expect(loadIntoLayer(owned, 'blob:media', 'blob:new-4')).toBe(false);
    expect(loadIntoLayer(owned, 'blob:undo', 'blob:new-5')).toBe(false);

    project.update((p: any) => ({
      ...p,
      layers: [
        { id: 'a', type: 'model3d', model3dContent: { modelData: 'blob:new-6' } },
        { id: 'b', type: 'model3d', model3dContent: { modelData: 'blob:other-layer' } },
      ],
    }));
    expect(releaseBlobUrl(owned, 'blob:other-layer')).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes a URL nobody uses, once', () => {
    const owned = new Map<string, unknown>([['blob:unused', {}]]);
    expect(loadIntoLayer(owned, 'blob:unused', 'blob:new-7')).toBe(true);
    expect(revoke).toHaveBeenCalledWith('blob:unused');
    expect(owned.has('blob:unused')).toBe(false);
    expect(releaseBlobUrl(owned, 'blob:unused')).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('never revokes a URL the panel did not make', () => {
    expect(releaseBlobUrl(new Map(), 'blob:someone-else', [])).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('referencesUrl', () => {
  it('finds a URL in nested data and JSON, but not inside class instances', () => {
    const url = 'blob:x';
    expect(referencesUrl({ a: [{ b: { c: url } }] }, url)).toBe(true);
    expect(referencesUrl('{"modelData":"blob:x"}', url)).toBe(true);
    class Holder { src = url; }
    expect(referencesUrl({ element: new Holder() }, url)).toBe(false);
    const cyclic: any = { self: null };
    cyclic.self = cyclic;
    expect(referencesUrl(cyclic, url)).toBe(false);
  });
});

describe('the panels', () => {
  it('free URLs only through releaseBlobUrl', () => {
    for (const file of ['Model3DPanel.svelte', 'SplatPanel.svelte']) {
      const source = readFileSync(join(process.cwd(), 'src', 'lib', 'components', file), 'utf8');
      const module = source.slice(0, source.indexOf('</script>'));
      expect(module, file).toContain("import { releaseBlobUrl } from './blobUrlUsers';");
      expect(module, file).not.toContain('URL.revokeObjectURL');
      // The only direct revoke left is the splat image path's throwaway URL.
      const direct = source.match(/URL\.revokeObjectURL\(([^)]*)\)/g) ?? [];
      expect(direct.every((call) => call === 'URL.revokeObjectURL(runtimeUrl)'), file).toBe(true);
    }
  });
});
