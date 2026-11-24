/**
 * Every Audio Lab entry point asks the licence (addons/addonAccess.ts):
 * the studio store, the studio view key, its MIDI/OSC controls and paths,
 * band keys, the live looper (its controls, keys, Program Change and the
 * save flush), the engine voices, and the Timeline/plugin layers
 * (plugins/addons.test.ts). Buy goes to the add-on's own checkout.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

beforeAll(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { activeElement: null, documentElement: { style: { setProperty: () => {} } }, addEventListener: () => {}, removeEventListener: () => {} },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
});

// No Web Audio here: every engine call is a no-op.
vi.mock('../music/audioEngine', () => ({
  MusicAudioEngine: class {
    constructor() {
      return new Proxy(this, { get: (_t, key) => (key === 'then' ? undefined : () => 0) });
    }
  },
}));

// The looper's actions, watched: the gate decides whether they are reached.
vi.mock('../music/loopStation', async (original) => ({
  ...(await original<typeof import('../music/loopStation')>()),
  pressLoopTrack: vi.fn(),
  selectLoopTrack: vi.fn(),
  stopAllLoopTracks: vi.fn(),
  flushAudioLoops: vi.fn(async () => {}),
}));

async function load(unlocked: boolean) {
  vi.resetModules();
  const access = await import('./addonAccess');
  access.setAddonsStatusForTests({ 'addon.audio-lab': unlocked });
  const loops = await import('../music/loopControls');
  loops.registerLoopControls();
  return {
    access,
    studio: await import('../music/musicStudioStore'),
    controls: await import('../music/studioControls'),
    deck: await import('../music/studioDeck'),
    paths: await import('../control/controlPaths'),
    inputs: await import('../midi/midiInputs'),
    loops,
    station: (await import('../music/loopStation')) as unknown as Record<'pressLoopTrack' | 'selectLoopTrack' | 'stopAllLoopTracks' | 'flushAudioLoops', ReturnType<typeof vi.fn>>,
    programChange: await import('../midi/programChange'),
    voices: await import('../music/engineVoices'),
    scenes: await import('../music/visualScenes'),
  };
}

const space = () => ({ key: ' ', code: 'Space', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
const stopAll = () => ({ key: '.', code: 'Period', repeat: false, ctrlKey: false, metaKey: true, altKey: false, shiftKey: false });

const backquote = () => ({ code: 'Backquote', repeat: false, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;
const keysDevice = [{ id: 'k1', name: 'Keys', state: 'connected' }] as never[];
const keysSetup = [{ name: 'Keys', use: 'keys' }] as never[];

describe('Audio Lab locked', () => {
  it('never opens; asking for it offers the add-on instead', async () => {
    const m = await load(false);
    m.studio.musicStudio.open();
    m.studio.musicStudio.toggleOpen();
    m.studio.musicStudio.setStudioView(true);
    expect(get(m.studio.musicStudio).isOpen).toBe(false);
    expect(get(m.access.addonOffer)).toEqual({ product: 'addon.audio-lab', step: 'offer' });
  });

  it('leaves the studio view key alone', async () => {
    const m = await load(false);
    expect(m.deck.isStudioViewKey(backquote())).toBe(false);
  });

  it('offers no studio controls to MIDI, OSC, DMX or MCP, and lists none of its paths', async () => {
    const m = await load(false);
    expect(m.controls.studioControls()).toEqual([]);
    expect(m.controls.studioControl('studio.view')).toBeUndefined();
    expect(m.controls.runStudioControl('studio.view', 1)).toBe(false);
    expect(m.paths.controlPathExamples().some((e) => e.path.startsWith('studio:'))).toBe(false);
  });

  it('treats band keys as a controller', async () => {
    const m = await load(false);
    const inUse = m.inputs.resolveMidiInputs(keysDevice, keysSetup, null);
    expect(inUse.keys).toEqual([]);
    expect(inUse.control).toEqual(['k1']);
  });

  it('keeps the live looper out of reach: no controls, no keys, no Program Change', async () => {
    const m = await load(false);
    expect(m.controls.studioControl('loop.1.button')).toBeUndefined();
    expect(m.controls.studioControl('loop.pedal.1')).toBeUndefined();
    expect(m.controls.runStudioControl('loop.sel.button', 1, { momentary: true })).toBe(false);
    expect(m.loops.loopKey(space())).toBe(false);
    expect(m.loops.loopKey(stopAll())).toBe(false);
    m.programChange.emitProgramChange(0, 0);
    const learned = vi.fn();
    m.loops.learnProgramSelect(learned);
    m.programChange.emitProgramChange(3, 10);
    expect(learned).toHaveBeenCalledWith(false);
    expect(get(m.studio.musicStudio).loopStation.pc.on).toBe(false);
    expect(m.station.pressLoopTrack).not.toHaveBeenCalled();
    expect(m.station.selectLoopTrack).not.toHaveBeenCalled();
    expect(m.station.stopAllLoopTracks).not.toHaveBeenCalled();
  });

  it('saves a project without waiting on (or loading) the looper', async () => {
    const m = await load(false);
    const { flushLooperAudio } = await import('../stores/layers');
    await flushLooperAudio();
    expect(m.station.flushAudioLoops).not.toHaveBeenCalled();
  });

  it('offers no engine voices, but still knows a saved one (its voice is kept as it was)', async () => {
    const m = await load(false);
    expect(m.voices.offeredEngineInstruments()).toEqual([]);
    expect(m.scenes.offeredEngineVoiceShaders()).toEqual([]);
    expect(m.voices.isEngineVoiceFile('engine:fluid-ink')).toBe(true);
    expect(m.scenes.voiceShaderByFile('engine:fluid-ink')?.name).toBe('Fluid Ink');
  });
});

describe('Buy', () => {
  it('opens the add-on\'s own checkout and waits for the purchase', async () => {
    const m = await load(false);
    const invoke = vi.fn(async () => null);
    (window as any).electronAPI = { invoke };
    try {
      m.access.buyAddon('addon.audio-lab');
      expect(invoke).toHaveBeenLastCalledWith('open_external_url', { url: 'https://ghostarcade.live/addons/checkout?product=audio-lab' });
      expect(get(m.access.addonOffer)).toEqual({ product: 'addon.audio-lab', step: 'buy' });
      m.access.buyAddon('addon.analog-synth');
      expect(invoke).toHaveBeenLastCalledWith('open_external_url', { url: 'https://ghostarcade.live/addons/checkout?product=analog-synth' });
      expect(get(m.access.addonOffer)).toEqual({ product: 'addon.analog-synth', step: 'buy' });
    } finally {
      delete (window as any).electronAPI;
    }
  });
});

describe('Audio Lab unlocked', () => {
  it('opens', async () => {
    const m = await load(true);
    m.studio.musicStudio.open();
    expect(get(m.studio.musicStudio).isOpen).toBe(true);
    expect(get(m.access.addonOffer)).toBeNull();
  });

  it('answers the studio view key, its controls and its paths', async () => {
    const m = await load(true);
    expect(m.deck.isStudioViewKey(backquote())).toBe(true);
    expect(m.controls.studioControl('studio.view')).toBeDefined();
    expect(m.paths.controlPathExamples().some((e) => e.path.startsWith('studio:'))).toBe(true);
  });

  it('plays band keys', async () => {
    const m = await load(true);
    expect(m.inputs.resolveMidiInputs(keysDevice, keysSetup, null).keys).toEqual(['k1']);
  });

  it('runs the live looper from its controls, keys and Program Change', async () => {
    const m = await load(true);
    expect(m.controls.studioControl('loop.1.button')).toBeDefined();
    expect(m.controls.runStudioControl('loop.1.button', 1, { momentary: true })).toBe(true);
    expect(m.station.pressLoopTrack).toHaveBeenCalledWith(0);
    expect(m.loops.loopKey(stopAll())).toBe(true);
    expect(m.station.stopAllLoopTracks).toHaveBeenCalled();
    m.studio.musicStudio.updateLoopStation((d) => ({ ...d, pc: { on: true, channel: 0, offset: 0 } }));
    m.programChange.emitProgramChange(0, 1);
    expect(m.station.selectLoopTrack).toHaveBeenCalledWith(1);
  });

  it('waits for the looper\'s audio before a save', async () => {
    const m = await load(true);
    const { flushLooperAudio } = await import('../stores/layers');
    await flushLooperAudio();
    expect(m.station.flushAudioLoops).toHaveBeenCalled();
  });

  it('offers all ten engine voices', async () => {
    const m = await load(true);
    expect(m.voices.offeredEngineInstruments()).toHaveLength(10);
    expect(m.scenes.offeredEngineVoiceShaders().map((v) => v.file)).toContain('engine:fluid-ink');
  });
});
