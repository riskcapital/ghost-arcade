import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioEngine } from './engine';
import { defaultShow, normalizeShow, clipUnavailable, type Clip } from './model';
import { MOBILE_SHADERS } from '../standaloneShaderList';
import { mobileHeavyShaderPaths, mobileRemovedShaderPaths, mobileShaderBudgets } from './shaderPerformance';
import { standaloneShaderPaths } from './shaderAvailability';

const renderers = vi.hoisted(() => [] as Array<{
  setShaderInputs: ReturnType<typeof vi.fn>;
  drawFrame: ReturnType<typeof vi.fn>;
}>);
vi.mock('../standaloneRenderer', () => ({
  StandaloneRenderer: class {
    setShaderInputs = vi.fn();
    clearSource = vi.fn();
    loadShaderSource = vi.fn().mockResolvedValue(undefined);
    setShaderImage = vi.fn();
    setAudio = vi.fn();
    setClipParams = vi.fn();
    drawFrame = vi.fn();
    destroy = vi.fn();
    textureOutput = null;
    constructor() { renderers.push(this); }
  },
}));
vi.mock('./compositor', () => ({
  StudioCompositor: class {
    context = {};
    beginFrame = vi.fn();
    render = vi.fn();
    destroy = vi.fn();
    constructor(public canvas: HTMLCanvasElement) {}
  },
}));

const SOURCE = '/*{"INPUTS":[{"NAME":"detail","TYPE":"float","MIN":0,"MAX":1,"DEFAULT":0.65},{"NAME":"_ghostClock","TYPE":"float"}]}*/\nvoid main(){gl_FragColor=vec4(detail);}';
let frame: FrameRequestCallback;
let engine: StudioEngine | undefined;
let fetched: string[] = [];
beforeEach(() => {
  renderers.length = 0;
  fetched = [];
  vi.stubGlobal('HTMLVideoElement', class {});
  vi.stubGlobal('HTMLImageElement', class {});
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetched.push(String(url)); return { ok: true, text: async () => SOURCE }; }));
});
afterEach(() => {
  engine?.destroy();
  engine = undefined;
  vi.unstubAllGlobals();
});
function setup() {
  const show = defaultShow();
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
  engine = new StudioEngine(canvas, () => show);
  return { engine, show };
}
const heavy = MOBILE_SHADERS.find(s => mobileHeavyShaderPaths.has(s.path))!;

describe('GhostFX on mobile', () => {
  it('is in the library and the starter set, with a render budget instead of an exclusion', () => {
    expect(standaloneShaderPaths.has('ISF/GA-GhostFX.fs')).toBe(true);
    expect(mobileHeavyShaderPaths.has('ISF/GA-GhostFX.fs')).toBe(false);
    expect(mobileShaderBudgets['ISF/GA-GhostFX.fs'].scale).toBeLessThan(1);
    const show = defaultShow();
    const clip = show.clips.find(c => c.shaderId === 'ga-ghostfx');
    expect(clip).toBeDefined();
    expect(clipUnavailable(clip)).toBe(false);
    expect(show.launchGrid.slice(0, 4).flat()).toContain(clip!.id);
  });

  it('renders at a lower internal scale and step count than an ordinary shader', async () => {
    const { engine, show } = setup();
    const ghost = show.clips.find(c => c.shaderId === 'ga-ghostfx')!;
    const plain = show.clips.find(c => c.shaderId === 'featured-lumenstrata')!;
    show.layers[0].clipId = ghost.id;
    show.layers[1].clipId = plain.id;
    await engine.launch(0, ghost);
    await engine.launch(1, plain);
    expect(engine.renderBudget(0)).toEqual(mobileShaderBudgets['ISF/GA-GhostFX.fs']);
    expect(engine.renderBudget(1)).toBeUndefined();
    engine.start();
    frame(performance.now());
    const [ghostWidth, ghostHeight] = renderers[1].drawFrame.mock.lastCall!;
    const [, plainHeight] = renderers[3].drawFrame.mock.lastCall!;
    expect(ghostHeight / plainHeight).toBeCloseTo(mobileShaderBudgets['ISF/GA-GhostFX.fs'].scale, 1);
    expect(ghostWidth / ghostHeight).toBeCloseTo(16 / 9, 1);
    expect(ghostHeight).toBeGreaterThanOrEqual(180);
    const inputs = renderers[1].setShaderInputs.mock.lastCall![0];
    expect(inputs.detail).toBeCloseTo(0.65 * mobileShaderBudgets['ISF/GA-GhostFX.fs'].detail, 5);
    // A user value is scaled, never replaced.
    show.layers[0].params = { detail: 1 };
    frame(performance.now() + 16);
    expect(renderers[1].setShaderInputs.mock.lastCall![0].detail).toBeCloseTo(mobileShaderBudgets['ISF/GA-GhostFX.fs'].detail, 5);
    expect(renderers[3].setShaderInputs.mock.lastCall![0].detail).toBeUndefined();
  });
});

describe('sets that hold a shader this device cannot run', () => {
  const foreign = (): Clip[] => [
    { id: 'heavy-clip', shaderId: heavy.id, name: heavy.name, kind: 'shader' },
    { id: 'gone-clip', shaderId: 'not-in-this-build', name: 'Removed shader', kind: 'shader' },
  ];
  it('keeps the pads, clears the playing layer and never throws on restore', async () => {
    const { engine, show } = setup();
    show.clips.push(...foreign());
    show.launchGrid[0][0] = 'heavy-clip';
    show.launchGrid[1][0] = 'gone-clip';
    show.layers[0].clipId = 'heavy-clip';
    show.layers[1].clipId = 'gone-clip';
    const errors: string[] = [];
    engine.onError = message => errors.push(message);
    await expect(engine.restore(show)).resolves.toBeUndefined();
    expect(errors).toEqual([]);
    expect(show.layers[0].clipId).toBeNull();
    expect(show.layers[1].clipId).toBeNull();
    expect(show.launchGrid[0][0]).toBe('heavy-clip');
    expect(show.launchGrid[1][0]).toBe('gone-clip');
    expect(fetched.some(url => url.includes(encodeURI(heavy.path)))).toBe(false);
  });
  it('normalizes a saved set the same way', () => {
    const show = defaultShow();
    show.clips.push(...foreign());
    show.launchGrid[2][3] = 'heavy-clip';
    show.layers[2].clipId = 'heavy-clip';
    const restored = normalizeShow(JSON.parse(JSON.stringify(show)));
    expect(restored.clips.some(c => c.id === 'heavy-clip')).toBe(true);
    expect(restored.launchGrid[2][3]).toBe('heavy-clip');
    expect(restored.layers[2].clipId).toBeNull();
    expect(clipUnavailable(restored.clips.find(c => c.id === 'gone-clip'))).toBe(true);
    expect(clipUnavailable(restored.clips.find(c => c.kind === 'shader' && c.shaderId === 'featured-tide'))).toBe(false);
    expect(clipUnavailable({ id: 'v', kind: 'video', name: 'Clip.mp4', assetId: 'v' })).toBe(false);
  });
  it('treats a shader stripped from the mobile release as unavailable instead of failing to download it', async () => {
    const removed = MOBILE_SHADERS.find(s => mobileRemovedShaderPaths.has(s.path));
    expect(mobileRemovedShaderPaths.size).toBeGreaterThan(0);
    if (!removed) return; // not every stripped file is listed in the catalogue
    const clip: Clip = { id: 'stripped', shaderId: removed.id, name: removed.name, kind: 'shader' };
    expect(clipUnavailable(clip)).toBe(true);
    const { engine, show } = setup();
    show.clips.push(clip); show.layers[0].clipId = clip.id;
    const errors: string[] = [];
    engine.onError = message => errors.push(message);
    await engine.restore(show);
    expect(errors).toEqual([]);
    expect(show.layers[0].clipId).toBeNull();
    expect(fetched.some(url => url.includes(encodeURI(removed.path)))).toBe(false);
  });
  it('refuses a direct launch with a plain message', async () => {
    const { engine } = setup();
    await expect(engine.launch(0, foreign()[0])).rejects.toThrow(/not available on this device/);
    await expect(engine.launch(0, foreign()[1])).rejects.toThrow(/not available on this device/);
  });
});
