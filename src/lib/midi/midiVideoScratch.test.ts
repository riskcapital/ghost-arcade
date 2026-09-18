import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MidiMapping } from './midiTypes';

const harness = vi.hoisted(() => ({
  layer: null as any, vj: null as any, midi: null as any,
  scratch: { seek: vi.fn(), cancel: vi.fn(), refresh: vi.fn() },
}));
vi.mock('./midiStore', async () => {
  const { writable } = await import('svelte/store');
  harness.midi = writable({ mappings: [] });
  return { midiStore: harness.midi };
});
vi.mock('../stores/layers', async () => {
  const { writable } = await import('svelte/store');
  harness.layer = writable(null);
  return { selectedLayer: harness.layer, project: {
    updateLayer: vi.fn((_id, patch) => harness.layer.update((layer: any) => ({ ...layer, ...patch }))),
    setLayerSource: vi.fn((_id, source) => harness.layer.update((layer: any) => ({ ...layer, source }))),
  } };
});
vi.mock('../stores/vjClipLauncher', async () => {
  const { writable } = await import('svelte/store');
  harness.vj = writable({ layerStates: [], bankBLayerStates: [] });
  return { vjClipLauncher: { ...harness.vj,
    updateActiveClipVideoProps: vi.fn(), syncActiveClipPosition: vi.fn(),
  } };
});
vi.mock('../renderer/nativeVideoScratch', () => ({ createNativeVideoScratchController: () => harness.scratch }));
vi.mock('../stores/synthVision', () => ({ synthVisionStore: {} }));
vi.mock('../audio/modulation', () => ({ setBaseValue: vi.fn() }));
vi.mock('../plugins/registry', () => ({ getPluginByEffectType: vi.fn() }));
vi.mock('../stores/audio', () => ({ audioStore: {} }));
import { project } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { midiRouter } from './midiRouter';

describe('MIDI native video scratch routing', () => {
  const clip = (id: string) => ({ id, src: `/${id}.mp4`, type: 'video', durationSeconds: 8,
    trimStart: 0.25, trimEnd: 0.75, isPlaying: false, _nativePlaybackTimeSeconds: 4,
    _nativePlaybackUpdatedAtMs: 0, _nativePlaybackSeekSeq: 7 });
  const mapping = (path: string, mode: MidiMapping['mode'] = 'absolute'): MidiMapping => ({
    id: path, channel: -1, type: 'cc', number: 74, path, mode,
    min: 0, max: 1, step: 0, label: 'Video scratch',
  });
  beforeEach(() => {
    vi.clearAllMocks();
    harness.layer.set({ id: 'mapping-layer', source: clip('mapping-video') });
    harness.vj.set({ layerStates: [{ activeClip: clip('a') }], bankBLayerStates: [{ activeClip: clip('b') }] });
    harness.midi.set({ mappings: [] });
  });

  it('preserves the last absolute CC value inside a fast burst', () => {
    harness.midi.set({ mappings: [mapping('map:media:scratch')] });
    for (const raw of [0, 64, 127]) midiRouter.routeMessage(0, 'cc', 74, raw);
    expect(harness.scratch.seek.mock.calls).toEqual([
      ['map:mapping-layer', 0], ['map:mapping-layer', 64 / 127], ['map:mapping-layer', 1],
    ]);
  });

  it('routes each deck independently without requiring a browser video element', () => {
    midiRouter.dispatchPath('vj:0:video:scratch', 0.2);
    midiRouter.dispatchPath('vj-b:0:video:scratch', 0.8);
    expect(harness.scratch.seek.mock.calls).toEqual([['A:0', 0.2], ['B:0', 0.8]]);
  });

  it('preserves full absolute pitch-bend resolution for high-resolution position control', () => {
    harness.midi.set({ mappings: [{ ...mapping('vj:0:video:scratch'), type: 'pitchbend', number: 0 }] });
    for (const raw of [0, 8192, 8193, 16383]) midiRouter.routeMessage(0, 'pitchbend', 0, raw);
    expect(harness.scratch.seek.mock.calls).toEqual([
      ['A:0', 0], ['A:0', 8192 / 16383], ['A:0', 8193 / 16383], ['A:0', 1],
    ]);
  });

  it('does not reinterpret relative encoder messages as absolute positions', () => {
    harness.midi.set({ mappings: [mapping('map:media:scratch', 'relative')] });
    midiRouter.routeMessage(0, 'cc', 74, 65);
    expect(harness.scratch.seek).not.toHaveBeenCalled();
  });

  it('resumes the held native frame on Play and pauses on the next press', () => {
    midiRouter.dispatchPath('map:media:play', 1);
    expect(harness.scratch.cancel).toHaveBeenCalledWith('map:mapping-layer');
    expect(project.updateLayer).toHaveBeenLastCalledWith('mapping-layer', { source: expect.objectContaining({
      isPlaying: true, _nativePlaybackTimeSeconds: 4, _nativePlaybackSeekSeq: 7,
    }) });
    midiRouter.dispatchPath('map:media:play', 1);
    expect(project.updateLayer).toHaveBeenLastCalledWith('mapping-layer', { source: expect.objectContaining({ isPlaying: false }) });
  });

  it('resumes Deck B and leaves external position synchronization on its existing route', () => {
    midiRouter.dispatchPath('vj-b:0:video:play', 1);
    expect(harness.scratch.cancel).toHaveBeenCalledWith('B:0');
    expect(vjClipLauncher.updateActiveClipVideoProps).toHaveBeenCalledWith(0,
      expect.objectContaining({ isPlaying: true, _nativePlaybackTimeSeconds: 4 }), 'B');
    midiRouter.dispatchPath('vj-b:0:video:position', 0.75);
    expect(vjClipLauncher.syncActiveClipPosition).toHaveBeenCalledWith(0, 5, 'B');
    expect(harness.scratch.seek).not.toHaveBeenCalled();
  });
});
