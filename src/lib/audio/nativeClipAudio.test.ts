import { describe, it, expect } from 'vitest';
import { nativeClipAudioMix } from './nativeClipAudio';
import type { VJClipLauncherState } from '../stores/vjClipLauncher';
const clip = (id: string, extra = {}) => ({ id, src: `/clips/${id}.mov`, type: 'video', ...extra });
const state = (extra = {}) => ({ isOpen: true, isLive: true, stoppedAll: false, mapMode: false,
  crossfaderEnabled: false, crossfaderValue: 0, layerStates: [{ activeClip: clip('a') }],
  bankBLayerStates: [{ activeClip: clip('b') }], clipGrid: [[clip('a'), clip('c')]], bankBClipGrid: [[clip('b')]], ...extra,
}) as unknown as VJClipLauncherState;
describe('Native clip audio routing', () => {
  it('enables sound by default and prepares idle clips without playing them', () => {
    const mix = nativeClipAudioMix(state());
    expect(mix.voices).toEqual([{ id: 'A:0:a', source_id: 'a', gain: 1, pan: 0 }]);
    expect(mix.sources).toEqual(['/clips/a.mov', '/clips/c.mov']);
  });
  it('honors saved opt-outs, mute and solo independently of visual opacity', () => {
    const mix = nativeClipAudioMix(state({ layerStates: [
      { activeClip: clip('a'), opacity: 0, solo: true, audioVolume: .5 },
      { activeClip: clip('b') }, { activeClip: clip('c', { audioPlayback: false }) },
    ] }));
    expect(mix.voices.map(v => v.gain)).toEqual([.5, 0]);
  });
  it('uses equal-power deck gains and independent clip/layer pan', () => {
    const mix = nativeClipAudioMix(state({ crossfaderEnabled: true, crossfaderValue: .5,
      layerStates: [{ activeClip: clip('a', { audioVolume: .5, audioPan: .8 }), audioVolume: .5, audioPan: .5 }],
    }));
    expect(mix.voices[0].gain).toBeCloseTo(Math.SQRT1_2 * .25);
    expect(mix.voices[0].pan).toBe(1);
    expect(mix.voices[1].gain).toBeCloseTo(Math.SQRT1_2);
  });
  it.each([{ isOpen: false }, { isLive: false }, { stoppedAll: true }, { mapMode: true }])('silences inactive output %j', patch => {
    expect(nativeClipAudioMix(state(patch)).voices).toEqual([]);
  });
  it('applies master mute to both decks while retaining prepared audio', () => {
    const mix = nativeClipAudioMix(state({ crossfaderEnabled: true }), { volume: .5, muted: true });
    expect(mix.voices.every(v => v.gain === 0)).toBe(true);
    expect(mix.sources).toHaveLength(3);
  });
});
