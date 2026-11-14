/**
 * Auto, audio / LFO modulation and Music motion move values every frame.
 * Those values are live values (liveParams.ts) the frame sync puts on over
 * the stored ones: nothing is written into the project or the VJ launcher
 * per frame, the stored values (and each Auto's saved phase) stay as they
 * were, and the sync and the panels still see the values move.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('./visualAudio', async (original) => {
  const actual = await original<typeof import('./visualAudio')>();
  let n = 0;
  return {
    ...actual,
    getVisualAudioSnapshot: () => {
      n += 1;
      const beat = n % 8 === 0;
      return { ...actual.getVisualAudioSnapshot(), isActive: true, level: 0.6, energy: 0.6, bass: (n % 10) / 10, bassFast: beat ? 1 : 0.1, high: 0.3 };
    },
  };
});

let layers: typeof import('../stores/layers');
let launcherMod: typeof import('../stores/vjClipLauncher');
let auto: typeof import('./autoEngine');
let live: typeof import('./liveParams');
let modulation: typeof import('./modulation');
let music: typeof import('./musicMotionEngine');
let kf: typeof import('../stores/keyframeTimeline');

function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  const el = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {}, classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], getContext: () => null,
  });
  (globalThis as any).document = {
    documentElement: el(), body: el(), head: el(), createElement: () => el(),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).dispatchEvent = () => true;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

// Animation frames run only when a test says so.
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
let now = 10000;
function frame(ms = 1000 / 60) {
  now += ms;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(now));
}

beforeAll(async () => {
  installDomShim();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++nextFrame, cb); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  layers = await import('../stores/layers');
  launcherMod = await import('../stores/vjClipLauncher');
  auto = await import('./autoEngine');
  live = await import('./liveParams');
  modulation = await import('./modulation');
  music = await import('./musicMotionEngine');
  kf = await import('../stores/keyframeTimeline');
});

const sweep = (over: Record<string, unknown> = {}) => ({ phase: 0.1, mode: 'loop' as const, speedHz: 0.5, min: 0, max: 1, playing: true, ...over });

function mappingProject() {
  return {
    version: '2.1.12',
    project: {
      id: 'live', name: 'Live', width: 1920, height: 1080,
      layers: [{
        id: 'map-1', name: 'Shader', type: 'media', visible: true, opacity: 1, blendMode: 'normal',
        corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 1, y: 0 } },
        effects: [{ id: 'fx-1', type: 'blur', enabled: true, params: { amount: 0.25 }, paramAuto: { amount: sweep() } }],
        source: {
          id: 'src-1', type: 'shader', name: 'Shader', src: '',
          shaderCode: '/*{"INPUTS":[]}*/ void main(){ gl_FragColor = vec4(1.0); }',
          shaderValues: { speed: 0.5, glow: 0.4 },
          shaderValueAuto: { speed: sweep({ phase: 0.3 }) },
        },
      }],
      mappingComposition: { enabled: true, effects: [{ id: 'mix-1', type: 'blur', enabled: true, params: { amount: 0.2 }, paramAuto: { amount: sweep() } }] },
    },
  };
}

function vjSetup() {
  const launcher = launcherMod.vjClipLauncher;
  launcher.reset();
  const clip = {
    id: 'clip-1', type: 'shader', name: 'Clip', src: '',
    shaderCode: '/*{"INPUTS":[]}*/ void main(){ gl_FragColor = vec4(1.0); }',
    shaderValues: { speed: 0.5, glow: 0.4 },
    shaderValueAuto: { glow: sweep() },
  } as any;
  launcher.setClip(0, 0, clip, 'A');
  launcher.triggerClipNow(0, 0, 'A');
  launcher.setEffectChain('layer', [{ id: 'row-fx', type: 'blur', enabled: true, params: { amount: 0.3 } } as any], 0, 'A');
  launcher.setLayerEffectParamAuto(0, 'row-fx', 'amount', sweep(), 'A');
  launcher.setEffectChain('composition', [{ id: 'vj-mix', type: 'blur', enabled: true, params: { amount: 0.1 } } as any]);
  launcher.setCompositionEffectParamAuto('vj-mix', 'amount', sweep());
  return launcher;
}

describe('Auto plays live values, never the stores', () => {
  beforeEach(() => {
    auto.stopAutoEngine();
    auto.resetAutoForTest();
    live.resetLiveValuesForTest();
    frames.clear();
  });
  afterEach(() => auto.stopAutoEngine());

  it('runs 120 frames on a mapping layer, its composition and a VJ row with zero store publishes', async () => {
    expect(layers.project.importProject(mappingProject() as any)).toBe(true);
    const launcher = vjSetup();
    const storedProject = structuredClone({
      layers: get(layers.project).layers.map((l) => ({ effects: l.effects, source: { shaderValues: l.source!.shaderValues, shaderValueAuto: l.source!.shaderValueAuto } })),
      mix: get(layers.project).mappingComposition,
    });
    const storedVj = structuredClone({
      clip: launcher && get(launcher).layerStates[0].activeClip!.shaderValues,
      glowAuto: get(launcher).layerStates[0].activeClip!.shaderValueAuto,
      row: get(launcher).layerStates[0].effects,
      mix: get(launcher).compositionEffects,
    });
    let projectPublishes = 0;
    let vjPublishes = 0;
    const stopP = layers.project.subscribe(() => { projectPublishes += 1; });
    const stopV = launcher.subscribe(() => { vjPublishes += 1; });
    projectPublishes = 0;
    vjPublishes = 0;

    auto.startAutoEngine();
    const seen = { speed: new Set<string>(), fx: new Set<string>(), mix: new Set<string>(), glow: new Set<string>(), row: new Set<string>(), vjMix: new Set<string>() };
    for (let i = 0; i < 121; i++) {
      frame();
      if (i === 0) continue;
      const mapValues = live.liveValuesForLayer(get(layers.project).layers[0])!;
      seen.speed.add(mapValues['shader:speed'].toFixed(4));
      seen.fx.add(mapValues['fx:fx-1:amount'].toFixed(4));
      seen.mix.add(live.liveCompositionValues('map', 'mix-1')!.amount.toFixed(4));
      const row = live.liveValuesForDeck('A', 0, 'clip-1')!;
      seen.glow.add(row['shader:glow'].toFixed(4));
      seen.row.add(row['fx:row-fx:amount'].toFixed(4));
      seen.vjMix.add(live.liveCompositionValues('vj', 'vj-mix')!.amount.toFixed(4));
    }
    for (const values of Object.values(seen)) expect(values.size).toBeGreaterThan(50);
    expect(projectPublishes).toBe(0);
    expect(vjPublishes).toBe(0);

    // The stored values, and each Auto's saved phase, are as they were.
    expect({
      layers: get(layers.project).layers.map((l) => ({ effects: l.effects, source: { shaderValues: l.source!.shaderValues, shaderValueAuto: l.source!.shaderValueAuto } })),
      mix: get(layers.project).mappingComposition,
    }).toEqual(storedProject);
    expect({
      clip: get(launcher).layerStates[0].activeClip!.shaderValues,
      glowAuto: get(launcher).layerStates[0].activeClip!.shaderValueAuto,
      row: get(launcher).layerStates[0].effects,
      mix: get(launcher).compositionEffects,
    }).toEqual(storedVj);
    // The engine keeps the playhead: started from the saved phase, moved on.
    expect(auto.autoPlayhead('map:map-1:shader:speed')).not.toBe(0.3);

    // The frame sync puts them on over the stored values, for the mapping
    // layer and the VJ row it is handed.
    const { NativeRendererSync } = await import('../sync/nativeRendererSync');
    const sync = new NativeRendererSync() as any;
    const mapLayer = get(layers.project).layers[0];
    const vjLayer = { ...mapLayer, id: 'vj-layer-0', effects: [{ id: 'row-fx', type: 'blur', enabled: true, params: { amount: 0.3 } }], source: { ...mapLayer.source!, id: 'clip-1', shaderValues: { speed: 0.5, glow: 0.4 } } };
    const sent = sync.applyTimelineOverrides([mapLayer, vjLayer]);
    expect(sent[0].source.shaderValues.speed).toBe(live.liveValuesForLayer(mapLayer)!['shader:speed']);
    expect(sent[0].effects[0].params.amount).toBe(live.liveValuesForLayer(mapLayer)!['fx:fx-1:amount']);
    expect(sent[1].source.shaderValues.glow).toBe(live.liveValuesForDeck('A', 0, 'clip-1')!['shader:glow']);
    expect(sent[1].effects[0].params.amount).toBe(live.liveValuesForDeck('A', 0, 'clip-1')!['fx:row-fx:amount']);
    // A row now showing another clip gets nothing from this one.
    const other = sync.applyTimelineOverrides([{ ...vjLayer, source: { ...vjLayer.source, id: 'clip-2' } }]);
    expect(other[0].source.shaderValues.glow).toBe(0.4);

    // Stopping takes the live values away: the stored ones show again.
    auto.stopAutoEngine();
    expect(live.hasLiveValues()).toBe(false);
    stopP();
    stopV();
  });

  it('keeps the value a paused Auto stopped on, written once, and resumes from its playhead', () => {
    expect(layers.project.importProject(mappingProject() as any)).toBe(true);
    auto.startAutoEngine();
    for (let i = 0; i < 10; i++) frame();
    const playing = live.liveLayerValue('map-1', 'fx:fx-1:amount')!;
    const head = auto.autoPlayhead('map:map-1:fx:fx-1:amount')!;
    layers.project.setEffectParamAuto('map-1', 'fx-1', 'amount', { ...get(layers.project).layers[0].effects[0].paramAuto!.amount, playing: false });
    let publishes = 0;
    const stop = layers.project.subscribe(() => { publishes += 1; });
    publishes = 0;
    frame();
    expect(publishes).toBe(1);
    expect(get(layers.project).layers[0].effects[0].params.amount).toBeCloseTo(playing, 1);
    expect(live.liveLayerValue('map-1', 'fx:fx-1:amount')).toBeUndefined();
    for (let i = 0; i < 10; i++) frame();
    expect(publishes).toBe(1);
    expect(auto.autoPlayhead('map:map-1:fx:fx-1:amount')).toBe(head);
    // An edit of the Auto (here: play again) does not rewind it.
    layers.project.setEffectParamAuto('map-1', 'fx-1', 'amount', { ...get(layers.project).layers[0].effects[0].paramAuto!.amount, playing: true });
    frame();
    expect(auto.autoPlayhead('map:map-1:fx:fx-1:amount')!).toBeGreaterThan(head);
    stop();
  });

  it('keeps the value a paused VJ clip Auto stopped on: one launcher publish, a new clip, the old one untouched', () => {
    const launcher = vjSetup();
    auto.startAutoEngine();
    for (let i = 0; i < 10; i++) frame();
    const playing = live.liveDeckValue('A', 0, 'clip-1', 'shader:glow')!;
    const glowAuto = get(launcher).layerStates[0].activeClip!.shaderValueAuto!.glow;
    launcher.setClipShaderValueAuto('clip-1', 'glow', { ...glowAuto, playing: false });
    const before = get(launcher).layerStates[0].activeClip!;
    const beforeValues = { ...before.shaderValues };
    let publishes = 0;
    const stop = launcher.subscribe(() => { publishes += 1; });
    publishes = 0;
    frame();
    for (let i = 0; i < 10; i++) frame();
    stop();
    // Every launcher publish in those frames is the pause's one write (the
    // row effect and the VJ mix keep playing as live values).
    expect(publishes).toBe(1);
    const after = get(launcher).layerStates[0].activeClip!;
    expect(after).not.toBe(before);
    expect(after.shaderValues!.glow).toBeCloseTo(playing, 1);
    expect(before.shaderValues).toEqual(beforeValues);
    // The grid cell holds the clip with the value too.
    expect(get(launcher).clipGrid[0][0]!.shaderValues!.glow).toBe(after.shaderValues!.glow);
    // The same values again: nothing is published.
    publishes = 0;
    const again = launcher.subscribe(() => { publishes += 1; });
    publishes = 0;
    launcher.batchUpdateShaderValues(0, { glow: after.shaderValues!.glow as number }, 'A');
    again();
    expect(publishes).toBe(0);
  });

  it('still records into an armed keyframe track', () => {
    expect(layers.project.importProject(mappingProject() as any)).toBe(true);
    kf.keyframeTimeline.clearAll();
    kf.keyframeTimeline.toggleArmed('map-1', 'fx:fx-1:amount');
    const spy = vi.spyOn(kf.keyframeTimeline, 'autoRecord');
    auto.startAutoEngine();
    frame(); frame(); frame();
    expect(spy).toHaveBeenCalledWith('map-1', 'fx:fx-1:amount', live.liveLayerValue('map-1', 'fx:fx-1:amount'), 'amount', 'number');
    spy.mockRestore();
    kf.keyframeTimeline.clearAll();
  });

  it('keeps a bounded list of playheads, the oldest dropped first', () => {
    const layersList = Array.from({ length: auto.AUTO_PLAYHEAD_LIMIT + 10 }, (_, i) => ({
      ...mappingProject().project.layers[0], id: `map-${i}`, effects: [], source: { ...mappingProject().project.layers[0].source, id: `src-${i}` },
    }));
    expect(layers.project.importProject({ version: '2.1.12', project: { ...mappingProject().project, layers: layersList } } as any)).toBe(true);
    auto.stepAutoForTest(1000);
    auto.stepAutoForTest(1016);
    expect(auto.autoPlayheadCount()).toBe(auto.AUTO_PLAYHEAD_LIMIT);
    expect(auto.autoPlayhead('map:map-0:shader:speed')).toBeUndefined();
    expect(auto.autoPlayhead(`map:map-${auto.AUTO_PLAYHEAD_LIMIT + 9}:shader:speed`)).toBeDefined();
  });
});

describe('audio and LFO modulation play live values, never the stores', () => {
  beforeEach(() => {
    modulation.modulationStore.clearAll();
    modulation.modulationEngine.stop();
    live.resetLiveValuesForTest();
    frames.clear();
  });
  afterEach(() => {
    modulation.modulationStore.clearAll();
    modulation.modulationEngine.stop();
  });

  it('runs 120 frames on a mapping layer and a VJ row with zero store publishes', () => {
    const plain = mappingProject();
    plain.project.layers[0].effects[0].paramAuto = undefined as any;
    (plain.project.layers[0].source as any).shaderValueAuto = undefined;
    expect(layers.project.importProject(plain as any)).toBe(true);
    const launcher = vjSetup();
    const lfo = { source: 'lfo-sine' as const, amount: 1, speed: 2, invert: false, bpmSync: false };
    modulation.registerEffectParamRange(0, 'fx-1', 'amount', 0, 1);
    modulation.modulationStore.setEffectModulation(0, 'fx-1', 'amount', lfo, 'A', 'mapping');
    modulation.modulationStore.setModulation(0, 'glow', lfo, 'A', 'mapping');
    modulation.registerEffectParamRange(0, 'row-fx', 'amount', 0, 1);
    modulation.modulationStore.setEffectModulation(0, 'row-fx', 'amount', lfo, 'A', 'vj');
    const storedFx = get(layers.project).layers[0].effects[0].params.amount;
    const storedRow = get(launcher).layerStates[0].effects[0].params.amount;
    let projectPublishes = 0;
    let vjPublishes = 0;
    const stopP = layers.project.subscribe(() => { projectPublishes += 1; });
    const stopV = launcher.subscribe(() => { vjPublishes += 1; });
    projectPublishes = 0;
    vjPublishes = 0;
    modulation.modulationEngine.start();
    const fx = new Set<string>();
    const row = new Set<string>();
    for (let i = 0; i < 120; i++) {
      vi.spyOn(performance, 'now').mockReturnValue(now + 1000 / 60);
      frame();
      const a = live.liveLayerValue('map-1', 'fx:fx-1:amount');
      const b = live.liveDeckValue('A', 0, 'clip-1', 'fx:row-fx:amount');
      if (a !== undefined) fx.add(a.toFixed(4));
      if (b !== undefined) row.add(b.toFixed(4));
    }
    vi.restoreAllMocks();
    expect(fx.size).toBeGreaterThan(20);
    expect(row.size).toBeGreaterThan(20);
    expect(projectPublishes).toBe(0);
    expect(vjPublishes).toBe(0);
    expect(get(layers.project).layers[0].effects[0].params.amount).toBe(storedFx);
    expect(get(launcher).layerStates[0].effects[0].params.amount).toBe(storedRow);
    stopP();
    stopV();
  });
});

describe('Music motion on a VJ row plays live values', () => {
  it('runs 120 frames with zero launcher publishes and the clip values untouched', () => {
    const launcher = launcherMod.vjClipLauncher;
    launcher.reset();
    const clip = {
      id: 'mm-clip', type: 'shader', name: 'Clip', src: '',
      shaderCode: '/*{"INPUTS":[{"NAME":"speed","TYPE":"float","DEFAULT":0.5,"MIN":0,"MAX":1},{"NAME":"glow","TYPE":"float","DEFAULT":0.4,"MIN":0,"MAX":1}]}*/ void main(){ gl_FragColor = vec4(1.0); }',
      shaderValues: { speed: 0.5, glow: 0.4 },
      musicMotion: { on: true, amount: 1, params: ['speed', 'glow'] },
    } as any;
    launcher.setClip(0, 0, clip, 'B');
    launcher.triggerClipNow(0, 0, 'B');
    const stored = structuredClone(get(launcher).bankBLayerStates[0].activeClip!.shaderValues);
    let publishes = 0;
    const stop = launcher.subscribe(() => { publishes += 1; });
    publishes = 0;
    const seen = new Set<string>();
    for (let i = 0; i <= 120; i++) {
      music.stepMusicMotionForTest(1000 + i * (1000 / 60));
      const v = live.liveDeckValue('B', 0, 'mm-clip', 'shader:speed');
      if (v !== undefined) seen.add(v.toFixed(4));
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(publishes).toBe(0);
    expect(get(launcher).bankBLayerStates[0].activeClip!.shaderValues).toEqual(stored);
    music.stopMusicMotionEngine();
    expect(live.liveDeckValue('B', 0, 'mm-clip', 'shader:speed')).toBeUndefined();
    stop();
  });
});

describe('live values', () => {
  beforeEach(() => live.resetLiveValuesForTest());

  it('merges engines in order, guards a row by its clip and lets Timeline copies follow a layer', () => {
    const a = new live.LiveFrameWriter('auto');
    const m = new live.LiveFrameWriter('mod');
    a.layer('L', 'S', 'shader:x', 1); a.layer('L', 'S', 'fx:f:p', 2); a.deck('A', 1, 'C', 'shader:x', 3); a.composition('vj', 'E', 'p', 4);
    m.layer('L', 'S', 'fx:f:p', 5); m.deck('A', 1, 'C', 'fx:f:p', 6);
    a.commit(); m.commit();
    expect(live.liveValuesForLayer({ id: 'L', source: { id: 'S' } })).toEqual({ 'shader:x': 1, 'fx:f:p': 5 });
    // A copy of the piece showing its shader follows it; a block's clip on it keeps only the effect values.
    expect(live.liveValuesForLayer({ id: 'copy', source: { id: 'S' } })).toEqual({ 'shader:x': 1, 'fx:f:p': 5 });
    expect(live.liveValuesForLayer({ id: 'L', source: { id: 'other' } })).toEqual({ 'fx:f:p': 5 });
    expect(live.liveValuesForDeck('A', 1, 'C')).toEqual({ 'shader:x': 3, 'fx:f:p': 6 });
    expect(live.liveValuesForDeck('A', 1, 'D')).toBeUndefined();
    expect(live.liveValuesForDeck('B', 1, 'C')).toBeUndefined();
    expect(live.liveCompositionValues('vj', 'E')).toEqual({ p: 4 });
    expect(live.liveDeckOfLayerId('vj-layer-3-B')).toEqual({ deck: 'B', row: 3 });
    expect(live.liveDeckOfLayerId('vj-layer-2')).toEqual({ deck: 'A', row: 2 });
    expect(live.liveDeckOfLayerId('map-1')).toBeNull();
    // A frame replaces what an engine said before.
    a.layer('L', 'S', 'shader:x', 9); a.commit();
    expect(live.liveValuesForLayer({ id: 'L', source: { id: 'S' } })).toEqual({ 'shader:x': 9, 'fx:f:p': 5 });
    live.clearLiveValues('mod');
    live.clearLiveValues('auto');
    expect(live.hasLiveValues()).toBe(false);
  });

  it('moves the panel tick at most 15 times a second and once more after the last change', () => {
    vi.useFakeTimers();
    try {
      let ticks = 0;
      const stop = live.liveParamsTick.subscribe(() => { ticks += 1; });
      ticks = 0;
      const w = new live.LiveFrameWriter('auto');
      for (let i = 0; i < 60; i++) {
        w.layer('L', 'S', 'shader:x', i); w.commit();
        vi.advanceTimersByTime(1000 / 60);
      }
      vi.advanceTimersByTime(200);
      expect(ticks).toBeGreaterThanOrEqual(14);
      expect(ticks).toBeLessThanOrEqual(16);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
