import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Edits to a deck's playing clip must reach the saved block grids (what a
 * project save writes and what a block switch restores), deleting a block
 * must leave no stale deck B grid behind, and every saved edit — but no
 * performance action — must advance the unsaved-changes counter.
 */
const h = vi.hoisted(() => {
  class FakeVideo extends EventTarget {
    loop = false; muted = false; playsInline = false; preload = ''; crossOrigin = '';
    readyState = 4; duration = 4; currentTime = 0; paused = true; videoWidth = 64; videoHeight = 36;
    playbackRate = 1; error = null; srcObject = null; _src = '';
    get src() { return this._src; }
    set src(value: string) { this._src = value; }
    play = vi.fn(async () => { this.paused = false; });
    pause = vi.fn(() => { this.paused = true; });
    load = vi.fn();
    removeAttribute = vi.fn((name: string) => { if (name === 'src') this._src = ''; });
  }
  const element = (tag: string) => tag === 'video'
    ? new FakeVideo()
    : { getContext: () => null, style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} };
  return { element };
});

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  isDesktopApp: true,
  isElectron: true,
  invoke: vi.fn(async () => null),
}));

vi.stubGlobal('document', {
  createElement: h.element,
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
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(), key: () => null, length: 0,
});
vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16));
vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

const { vjClipLauncher, vjEditVersion } = await import('./vjClipLauncher');
const { runAsLiveControl } = await import('./historyHooks');
const { keyframeTimeline } = await import('./keyframeTimeline');
const { get } = await import('svelte/store');

afterAll(() => {
  // Triggers start the keyframe transport; stop it before its frames lose rAF.
  keyframeTimeline.stop();
  vi.unstubAllGlobals();
});

type Deck = 'A' | 'B';
const shader = (id: string) => ({ id, type: 'shader', name: id, src: '', shaderCode: 'void main(){}', shaderValues: { a: 1 } }) as any;
const state = () => get(vjClipLauncher);
const activeBlock = () => state().blocks.find(block => block.id === state().activeBlockId)!;
const blockCell = (layer: number, column: number, deck: Deck = 'A') =>
  (deck === 'A' ? activeBlock().clipGrid : activeBlock().bankBClipGrid!)[layer][column] as any;
const playing = (layer: number, deck: Deck = 'A') =>
  (deck === 'A' ? state().layerStates : state().bankBLayerStates)[layer].activeClip as any;

/** Switch to a fresh block and back, the way a performer browses scenes. */
function roundTripBlock() {
  const home = state().activeBlockId;
  vjClipLauncher.addBlock('Away');
  vjClipLauncher.setActiveBlock(state().blocks[state().blocks.length - 1].id);
  vjClipLauncher.setActiveBlock(home);
}

beforeEach(() => vjClipLauncher.reset());

describe('edits to the playing clip reach the saved block', () => {
  it('shader values, clip effects and effect params', () => {
    vjClipLauncher.setClip(0, 2, shader('s1'));
    vjClipLauncher.triggerClipNow(0, 2);

    vjClipLauncher.updateActiveClipShaderValue(0, 'a', 0.25);
    vjClipLauncher.updateActiveClipShaderValues(0, { b: 3 });
    vjClipLauncher.addActiveClipEffect(0, { id: 'fx', type: 'blur', enabled: true, opacity: 1, blendMode: 'normal', params: { radius: 1 } } as any);
    vjClipLauncher.updateActiveClipEffectParams(0, 'fx', { radius: 9 });
    vjClipLauncher.toggleActiveClipEffect(0, 'fx');

    expect(blockCell(0, 2).shaderValues).toEqual({ a: 0.25, b: 3 });
    expect(blockCell(0, 2).effects).toEqual([expect.objectContaining({ id: 'fx', enabled: false, params: { radius: 9 } })]);

    roundTripBlock();
    expect(playing(0).shaderValues).toEqual({ a: 0.25, b: 3 });
    expect(playing(0).effects[0].params.radius).toBe(9);

    vjClipLauncher.removeActiveClipEffect(0, 'fx');
    expect(blockCell(0, 2).effects).toEqual([]);
  });

  it('JS animation params, splat and 3D model content, on deck B too', () => {
    vjClipLauncher.setClip(1, 0, { id: 'js', type: 'jsanimation', name: 'J', src: '', jsAnimation: { animationType: 'threejs', htmlCode: '', paramValues: { p: 1 } } } as any, 'B');
    vjClipLauncher.setClip(2, 0, { id: 'sp', type: 'splat', name: 'S', src: '' } as any);
    vjClipLauncher.setClip(3, 0, { id: 'm3', type: 'model3d', name: 'M', src: '' } as any);
    vjClipLauncher.triggerClipNow(1, 0, 'B');
    vjClipLauncher.triggerClipNow(2, 0);
    vjClipLauncher.triggerClipNow(3, 0);

    vjClipLauncher.updateActiveClipJSAnimationParam(1, 'p', 5, 'B');
    vjClipLauncher.updateActiveClipSplatContent(2, { pointSize: 7 } as any);
    vjClipLauncher.updateActiveClipModel3DContent(3, { scale: 2 } as any);

    expect(blockCell(1, 0, 'B').jsAnimation.paramValues.p).toBe(5);
    expect(blockCell(2, 0).splatContent.pointSize).toBe(7);
    expect(blockCell(3, 0).model3dContent.scale).toBe(2);
  });

  it('shader Auto settings by clip id', () => {
    vjClipLauncher.setClip(0, 0, shader('sa'));
    vjClipLauncher.triggerClipNow(0, 0);
    vjClipLauncher.setClipShaderValueAuto('sa', 'a', { enabled: true } as any);

    expect(blockCell(0, 0).shaderValueAuto).toEqual({ a: { enabled: true } });
    roundTripBlock();
    expect(playing(0).shaderValueAuto).toEqual({ a: { enabled: true } });
  });

  it('leaves the grid and blocks untouched for a clip that is in no cell', () => {
    vjClipLauncher.launchTransientClip(0, shader('performer'));
    const before = state();
    vjClipLauncher.updateActiveClipShaderValue(0, 'a', 0.5);
    expect(playing(0).shaderValues.a).toBe(0.5);
    expect(state().clipGrid).toBe(before.clipGrid);
    expect(state().blocks).toBe(before.blocks);
  });
});

describe('deleting the shown block', () => {
  it('shows the surviving block on both decks', () => {
    const first = state().activeBlockId;
    vjClipLauncher.setClip(0, 0, shader('keepB'), 'B');
    vjClipLauncher.setClip(0, 1, shader('keepA'));
    vjClipLauncher.triggerClipNow(0, 1);
    vjClipLauncher.addBlock('Second');
    const second = state().blocks[1].id;
    vjClipLauncher.setActiveBlock(second);
    vjClipLauncher.setClip(1, 1, shader('goneB'), 'B');

    vjClipLauncher.deleteBlock(second);

    expect(state().activeBlockId).toBe(first);
    expect(state().bankBClipGrid[0][0]?.id).toBe('keepB');
    expect(state().bankBClipGrid[1][1]).toBeNull();
    // The playing clip is in the survivor again, so its column lights up.
    expect(state().layerStates[0].activeColumn).toBe(1);

    // A later deck B edit must not write the deleted block's grid back.
    vjClipLauncher.setClipTriggerStyle(0, 0, 'toggle', 'B');
    expect(state().blocks[0].bankBClipGrid![1][1]).toBeNull();
    expect(state().blocks[0].bankBClipGrid![0][0]?.triggerStyle).toBe('toggle');
  });
});

describe('unsaved-changes counter', () => {
  const version = () => get(vjEditVersion);

  it('counts edits but not performance actions or live control', () => {
    let last = version();
    const bumped = () => { const now = version(); const changed = now > last; last = now; return changed; };

    vjClipLauncher.setClip(0, 0, shader('e1'));
    expect(bumped()).toBe(true);

    vjClipLauncher.triggerClipNow(0, 0);
    vjClipLauncher.setLayerOpacity(0, 0.5);
    vjClipLauncher.toggleLayerSolo(0);
    vjClipLauncher.setCrossfaderValue(0.7);
    vjClipLauncher.setSelectedLayerIndex(0);
    vjClipLauncher.updateGroup('missing', { opacity: 0.4 });
    vjClipLauncher.stopLayer(0);
    expect(bumped()).toBe(false);

    vjClipLauncher.triggerClipNow(0, 0);
    vjClipLauncher.updateActiveClipShaderValue(0, 'a', 0.3);
    expect(bumped()).toBe(true);

    runAsLiveControl(() => vjClipLauncher.updateActiveClipShaderValue(0, 'a', 0.9));
    expect(bumped()).toBe(false);
    expect(playing(0).shaderValues.a).toBe(0.9);

    vjClipLauncher.setLayerBlendMode(0, 'screen' as any);
    expect(bumped()).toBe(true);
    vjClipLauncher.setCrossfaderCurve('linear');
    expect(bumped()).toBe(true);
    vjClipLauncher.addColumn();
    expect(bumped()).toBe(true);
  });

  it('counts video settings but not transport', () => {
    vjClipLauncher.setClip(0, 0, { id: 'v', type: 'video', name: 'V', src: '/v.mov', durationSeconds: 4 } as any);
    vjClipLauncher.triggerClipNow(0, 0);
    const before = version();
    vjClipLauncher.updateActiveClipVideoProps(0, { isPlaying: false, _nativePlaybackTimeSeconds: 1, _nativePlaybackUpdatedAtMs: 0 });
    expect(version()).toBe(before);
    vjClipLauncher.updateActiveClipVideoProps(0, { trimStart: 0.25 });
    expect(version()).toBe(before + 1);
    expect(blockCell(0, 0).trimStart).toBe(0.25);
  });

  it('does not count loading or resetting a project', () => {
    vjClipLauncher.setClip(0, 0, shader('loaded'));
    const before = version();
    vjClipLauncher.set({ ...state(), quantization: '1bar' });
    vjClipLauncher.reset();
    expect(version()).toBe(before);
  });
});
