import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A show takeover runs the VJ feeds without VJ mode being live: the clip
 * layers exist, clip transitions run, VJ mode's own output choice is left
 * alone.
 */
const h = vi.hoisted(() => {
  const videos: any[] = [];
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
  const element = (tag: string) => {
    if (tag === 'video') { const video = new FakeVideo(); videos.push(video); return video; }
    return { getContext: () => null, style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove: vi.fn() };
  };
  return { videos, element };
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

const { vjClipLauncher, vjOutputLayers, vjTransitionOutputLayers, vjFeedsRunning, vjTakeoverRows } = await import('./vjClipLauncher');
const { vjClipTransitions } = await import('./vjClipTransitions');
const { keyframeTimeline } = await import('./keyframeTimeline');
const { get } = await import('svelte/store');

afterAll(() => {
  keyframeTimeline.stop();
  vi.unstubAllGlobals();
});

const shader = (id: string) => ({ id, type: 'shader', name: id, src: `./ISF/${id}.fs`, shaderCode: 'void main(){}' }) as any;
const state = () => get(vjClipLauncher);

beforeEach(() => {
  vjClipLauncher.reset();
  vjClipTransitions.clear();
});

describe('takeoverLive', () => {
  it('vjFeedsRunning is live or takeover', () => {
    expect(vjFeedsRunning({ isLive: false, takeoverLive: false })).toBe(false);
    expect(vjFeedsRunning({ isLive: true, takeoverLive: false })).toBe(true);
    expect(vjFeedsRunning({ isLive: false, takeoverLive: true })).toBe(true);
  });

  it('builds the row layers with VJ mode closed while a takeover needs them', () => {
    vjClipLauncher.setClip(1, 0, shader('blue'));
    vjClipLauncher.triggerClipNow(1, 0, 'A');
    const unsubscribe = vjOutputLayers.subscribe(() => {});
    expect(get(vjOutputLayers)).toBeNull();
    vjClipLauncher.setTakeoverLive(true);
    expect(state().isLive).toBe(false);
    expect(state().isOpen).toBe(false);
    expect(get(vjOutputLayers)?.map((l) => l.id)).toEqual(['vj-layer-1']);
    vjClipLauncher.setTakeoverLive(false);
    expect(get(vjOutputLayers)).toBeNull();
    unsubscribe();
  });

  it('runs clip transitions on a row a takeover samples', () => {
    vjClipLauncher.setClip(0, 0, shader('red'));
    vjClipLauncher.setClip(0, 1, shader('blue'));
    vjClipLauncher.setLayerTransition(0, { duration: 2, style: 'dissolve' });
    vjClipLauncher.triggerClipNow(0, 0, 'A');
    // Not live, no takeover: a cut.
    vjClipLauncher.triggerClipNow(0, 1, 'A');
    expect(get(vjClipTransitions).size).toBe(0);
    vjClipLauncher.setTakeoverLive(true);
    vjClipLauncher.triggerClipNow(0, 0, 'A');
    expect([...get(vjClipTransitions).values()].map((t) => [t.layerIndex, t.duration])).toEqual([[0, 2]]);
    expect(get(vjTransitionOutputLayers).length).toBe(1);
  });

  it("VJ mode's Live toggle leaving does not end a takeover's transitions; ending the takeover does", () => {
    vjClipLauncher.setClip(0, 0, shader('red'));
    vjClipLauncher.setClip(0, 1, shader('blue'));
    vjClipLauncher.setLayerTransition(0, { duration: 2, style: 'dissolve' });
    vjClipLauncher.setOpen(true, { fromWorkspace: true });
    vjClipLauncher.setLive(true);
    vjClipLauncher.setTakeoverLive(true);
    vjClipLauncher.triggerClipNow(0, 0, 'A');
    vjClipLauncher.triggerClipNow(0, 1, 'A');
    expect(get(vjClipTransitions).size).toBe(1);
    vjClipLauncher.setLive(false);
    expect(get(vjClipTransitions).size).toBe(1);
    vjClipLauncher.setOpen(false, { fromWorkspace: true });
    expect(get(vjClipTransitions).size).toBe(1);
    vjClipLauncher.setTakeoverLive(false);
    expect(get(vjClipTransitions).size).toBe(0);
  });

});

describe('leaving VJ mode during a takeover', () => {
  const playing = (deck: 'A' | 'B' = 'A') => (deck === 'A' ? state().layerStates : state().bankBLayerStates).map((ls) => ls.activeClip?.id ?? null);
  const threeRows = () => {
    vjClipLauncher.setClip(0, 0, shader('red'));
    vjClipLauncher.setClip(1, 0, shader('blue'));
    vjClipLauncher.setClip(2, 0, shader('green'));
    for (const row of [0, 1, 2]) vjClipLauncher.triggerClipNow(row, 0, 'A');
    vjClipLauncher.setOpen(true, { fromWorkspace: true });
    vjClipLauncher.setLive(true);
  };

  it('with nothing taken over it is stopAll', () => {
    threeRows();
    vjClipLauncher.stopAllForLeave();
    expect(playing().slice(0, 3)).toEqual([null, null, null]);
    expect(state().stoppedAll).toBe(true);
  });

  it('keeps the row a takeover shows, stops the rest, and stops it at the hand-back', () => {
    threeRows();
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'row', deck: 'A', row: 1 }]);
    vjClipLauncher.stopAllForLeave();
    vjClipLauncher.setLive(false);
    vjClipLauncher.setOpen(false, { fromWorkspace: true });
    expect(playing().slice(0, 3)).toEqual([null, 'blue', null]);
    expect(state().stoppedAll).toBe(false);
    const unsubscribe = vjOutputLayers.subscribe(() => {});
    expect(get(vjOutputLayers)?.map((l) => l.id)).toEqual(['vj-layer-1']);
    unsubscribe();
    // The takeover moves on to the mix: nothing else restarts.
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'mix' }]);
    expect(playing().slice(0, 3)).toEqual([null, 'blue', null]);
    vjClipLauncher.setTakeoverLive(false);
    expect(playing().slice(0, 3)).toEqual([null, null, null]);
    expect(state().stoppedAll).toBe(true);
  });

  it('VJ mode back by the hand-back: the rows keep playing', () => {
    threeRows();
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'row', deck: 'A', row: 2 }]);
    vjClipLauncher.stopAllForLeave();
    vjClipLauncher.setOpen(false, { fromWorkspace: true });
    vjClipLauncher.setOpen(true, { fromWorkspace: true });
    vjClipLauncher.setTakeoverLive(false);
    expect(playing().slice(0, 3)).toEqual([null, null, 'green']);
  });

  it('the mix keeps every row; a group keeps its rows', () => {
    threeRows();
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'mix' }]);
    vjClipLauncher.stopAllForLeave();
    expect(playing().slice(0, 3)).toEqual(['red', 'blue', 'green']);
    vjClipLauncher.setTakeoverLive(false);
    vjClipLauncher.reset();
    threeRows();
    vjClipLauncher.addGroup(1, 2);
    const groupId = state().groups![0].id;
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'group', groupId }]);
    vjClipLauncher.stopAllForLeave();
    expect(playing().slice(0, 3)).toEqual([null, 'blue', 'green']);
  });

  it('keeps clip transitions and held pads on the kept row only', () => {
    threeRows();
    vjClipLauncher.setClip(1, 1, shader('cyan'));
    vjClipLauncher.setClip(0, 1, shader('pink'));
    vjClipLauncher.setLayerTransition(0, { duration: 2, style: 'dissolve' });
    vjClipLauncher.setLayerTransition(1, { duration: 2, style: 'dissolve' });
    vjClipLauncher.triggerClipNow(0, 1, 'A');
    vjClipLauncher.triggerClipNow(1, 1, 'A');
    expect(get(vjClipTransitions).size).toBe(2);
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'row', deck: 'A', row: 1 }]);
    vjClipLauncher.stopAllForLeave();
    expect([...get(vjClipTransitions).values()].map((t) => t.layerIndex)).toEqual([1]);
    vjClipLauncher.clearRuntimeSourceCache();
    expect([...get(vjClipTransitions).values()].map((t) => t.layerIndex)).toEqual([1]);
  });

  it('vjTakeoverRows', () => {
    const s = { layerStates: [{}, {}, {}], bankBLayerStates: [{}, {}, {}], groups: [{ id: 'g', first: 0, last: 1 }] } as any;
    const rows = (samples: any[]) => {
      const r = vjTakeoverRows(s, samples);
      return { A: [...r.A].sort(), B: [...r.B].sort() };
    };
    expect(rows([])).toEqual({ A: [], B: [] });
    expect(rows([{ kind: 'row', deck: 'B', row: 2 }])).toEqual({ A: [], B: [2] });
    expect(rows([{ kind: 'mix' }])).toEqual({ A: [0, 1, 2], B: [0, 1, 2] });
    expect(rows([{ kind: 'group', groupId: 'g' }, { kind: 'group', groupId: 'gone' }])).toEqual({ A: [0, 1], B: [0, 1] });
  });
});

describe('stop all during a takeover', () => {
  const playing = () => state().layerStates.slice(0, 3).map((ls) => ls.activeClip?.id ?? null);
  const threeRows = () => {
    vjClipLauncher.setClip(0, 0, shader('red'));
    vjClipLauncher.setClip(1, 0, shader('blue'));
    vjClipLauncher.setClip(2, 0, shader('green'));
    for (const row of [0, 1, 2]) vjClipLauncher.triggerClipNow(row, 0, 'A');
  };

  it('keeps the row a takeover shows and stops it once the takeover no longer shows it', () => {
    threeRows();
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'row', deck: 'A', row: 1 }]);
    vjClipLauncher.stopAllKeepingTakeover();
    expect(playing()).toEqual([null, 'blue', null]);
    expect(state().stoppedAll).toBe(false);
    // The takeover moves to row 3 (nothing playing there): row 2 stops now.
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'row', deck: 'A', row: 2 }]);
    expect(playing()).toEqual([null, null, null]);
    expect(state().stoppedAll).toBe(true);
  });

  it('at the hand-back, a clip launched on the kept row since keeps playing', () => {
    threeRows();
    vjClipLauncher.setClip(1, 1, shader('cyan'));
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'row', deck: 'A', row: 1 }]);
    vjClipLauncher.stopAllKeepingTakeover();
    vjClipLauncher.triggerClipNow(1, 1, 'A');
    vjClipLauncher.setTakeoverLive(false);
    expect(playing()).toEqual([null, 'cyan', null]);
  });

  it("is stopAll with nothing taken over, or with VJ mode's own output live", () => {
    threeRows();
    vjClipLauncher.stopAllKeepingTakeover();
    expect(playing()).toEqual([null, null, null]);
    expect(state().stoppedAll).toBe(true);
    threeRows();
    vjClipLauncher.setLive(true);
    vjClipLauncher.setTakeoverLive(true, [{ kind: 'row', deck: 'A', row: 1 }]);
    vjClipLauncher.stopAllKeepingTakeover();
    expect(playing()).toEqual([null, null, null]);
  });
});
