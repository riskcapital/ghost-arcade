import { describe, it, expect } from 'vitest';
import { nativeClipAudioMix, nativeClipAudioRecordable } from './nativeClipAudio';
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
  it('describes a running clip transition: incoming fades in, outgoing fades out on the same voice id', () => {
    const outgoing = clip('old', { audioVolume: .5 });
    const fade = { token: 7, duration: 2, startedAtMs: 100, incomingClipId: 'a', outgoingClip: outgoing };
    const mix = nativeClipAudioMix(state(), undefined, new Map([['A:0', fade]]));
    expect(mix.voices).toEqual([
      { id: 'A:0:a', source_id: 'a', gain: 1, pan: 0, row: 'A:0', transition: { role: 'in', token: 7, duration: 2, running: true } },
      { id: 'A:0:old', source_id: 'old', gain: .5, pan: 0, row: 'A:0', transition: { role: 'out', token: 7, duration: 2, running: true } },
    ]);
    // The outgoing clip may have left the grid; its decoded audio is kept.
    expect(mix.sources).toContain('/clips/old.mov');
  });
  it('holds both levels until the picture starts, and holds a queued launch on its outgoing clip', () => {
    const waiting = nativeClipAudioMix(state(), undefined, new Map([['A:0', { token: 3, duration: 1, startedAtMs: null, incomingClipId: 'a', outgoingClip: clip('old') }]]));
    expect(waiting.voices.map(v => v.transition?.running)).toEqual([false, false]);
    const queued = nativeClipAudioMix(state(), undefined, new Map([['A:0', { token: 4, duration: 1, startedAtMs: null, queuedTriggerId: 'q', incomingClipId: 'next', outgoingClip: clip('a') }]]));
    expect(queued.voices).toEqual([{ id: 'A:0:a', source_id: 'a', gain: 1, pan: 0, row: 'A:0', transition: { role: 'out', token: 4, duration: 1, running: false } }]);
  });
  it('omits silent or non-video outgoing clips and keeps rows without a transition unchanged', () => {
    const mix = nativeClipAudioMix(state(), undefined, new Map([['A:0', { token: 1, duration: 1, startedAtMs: 0, incomingClipId: 'a', outgoingClip: clip('img', { type: 'image' }) }],
      ['A:5', { token: 2, duration: 1, startedAtMs: 0, incomingClipId: 'x', outgoingClip: clip('y') }]]));
    expect(mix.voices.map(v => v.id)).toEqual(['A:0:a']);
  });
  it('records clip audio only from the VJ workspace', () => {
    expect(nativeClipAudioRecordable({ isOpen: true, mapMode: false })).toBe(true);
    expect(nativeClipAudioRecordable({ isOpen: true, mapMode: true })).toBe(false);
    expect(nativeClipAudioRecordable({ isOpen: false, mapMode: false })).toBe(false);
  });
  it('applies master mute to both decks while retaining prepared audio', () => {
    const mix = nativeClipAudioMix(state({ crossfaderEnabled: true }), { volume: .5, muted: true });
    expect(mix.voices.every(v => v.gain === 0)).toBe(true);
    expect(mix.sources).toHaveLength(3);
  });
});
