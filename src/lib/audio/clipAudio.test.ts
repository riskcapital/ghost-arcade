import { describe, it, expect } from 'vitest';
import { ClipAudioMixer, clipAudioVoices, type ClipAudioDeckRow, type ClipAudioDeckState } from './clipAudio';

const el = () => ({ muted: true, volume: 1 }) as unknown as HTMLMediaElement;
const video = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'video', src: `ghost-asset://localhost/${id}.mp4`, videoElement: el(), ...extra });
const deck = (rows: ClipAudioDeckRow[], extra: Partial<ClipAudioDeckState> = {}): ClipAudioDeckState => ({
  isOpen: true, isLive: false, stoppedAll: false, crossfaderEnabled: false, crossfaderValue: 0, layerStates: rows, bankBLayerStates: [], ...extra,
});

describe('which clips sound', () => {
  it('plays a video clip at full level by default, and nothing else', () => {
    const voices = clipAudioVoices(deck([
      { activeClip: video('a') }, { activeClip: null },
      { activeClip: { id: 's', type: 'shader' } },
      { activeClip: video('cam', { src: 'live://webcam/1' }) },
    ]));
    expect(voices.map((v) => [v.id, v.gain, v.pan])).toEqual([['a', 1, 0]]);
  });

  it('applies clip volume, pan and mute, and a row mute or solo', () => {
    const voices = clipAudioVoices(deck([
      { activeClip: video('a', { audioVolume: 0.5, audioPan: -0.4 }) },
      { activeClip: video('b', { audioMuted: true }) },
      { activeClip: video('c'), mute: true },
    ]));
    expect(voices.map((v) => [v.id, v.gain, v.pan])).toEqual([['a', 0.5, -0.4], ['b', 0, 0], ['c', 0, 0]]);
    const soloed = clipAudioVoices(deck([{ activeClip: video('a') }, { activeClip: video('b'), solo: true }]));
    expect(soloed.map((v) => v.gain)).toEqual([0, 1]);
  });

  it('is silent after Stop All and when the deck is neither open nor live', () => {
    expect(clipAudioVoices(deck([{ activeClip: video('a') }], { stoppedAll: true }))).toEqual([]);
    expect(clipAudioVoices(deck([{ activeClip: video('a') }], { isOpen: false }))).toEqual([]);
    expect(clipAudioVoices(deck([{ activeClip: video('a') }], { isOpen: false, isLive: true }))).toHaveLength(1);
  });

  it('follows the crossfader with equal power, and ignores deck B while it is off', () => {
    const a = video('a'), b = video('b');
    const rows = { layerStates: [{ activeClip: a }], bankBLayerStates: [{ activeClip: b }] };
    expect(clipAudioVoices(deck([], rows)).map((v) => v.id)).toEqual(['a']);
    const mid = clipAudioVoices(deck([], { ...rows, crossfaderEnabled: true, crossfaderValue: 0.5 }));
    expect(mid.map((v) => +v.gain.toFixed(3))).toEqual([0.707, 0.707]);
    const end = clipAudioVoices(deck([], { ...rows, crossfaderEnabled: true, crossfaderValue: 1 }));
    expect(end.map((v) => +v.gain.toFixed(3))).toEqual([0, 1]);
  });

  it('treats one clip on two rows as one voice at its loudest', () => {
    const shared = video('a');
    const voices = clipAudioVoices(deck([{ activeClip: shared, mute: true }, { activeClip: shared }]));
    expect(voices).toHaveLength(1);
    expect(voices[0].gain).toBe(1);
  });
});

describe('the mixer', () => {
  function fakeContext() {
    const param = () => ({ value: 0, target: 0, setTargetAtTime(v: number) { this.target = v; } });
    const node = () => ({ gain: param(), pan: param(), connect(next: unknown) { return next; } });
    const sources: unknown[] = [];
    const context = {
      state: 'running', currentTime: 0, destination: {},
      createGain: node, createStereoPanner: node,
      createMediaElementSource(element: unknown) { if (sources.includes(element)) throw new Error('already wired'); sources.push(element); return node(); },
    };
    return { context: context as unknown as AudioContext, sources };
  }

  it('unmutes a clip that should sound, mutes it again after, and wires each element once', () => {
    const { context, sources } = fakeContext();
    const mixer = new ClipAudioMixer(() => context);
    const a = el(), b = el();
    mixer.apply([{ id: 'a', element: a, gain: 1, pan: 0 }]);
    expect([a.muted, b.muted]).toEqual([false, true]);
    mixer.apply([{ id: 'b', element: b, gain: 0.5, pan: 0 }]);
    expect([a.muted, b.muted]).toEqual([true, false]);
    mixer.apply([{ id: 'a', element: a, gain: 1, pan: 0 }, { id: 'b', element: b, gain: 1, pan: 0 }]);
    expect(sources).toHaveLength(2);
    mixer.apply([]);
    expect([a.muted, b.muted]).toEqual([true, true]);
  });

  it('builds nothing until a clip needs it', () => {
    let made = 0;
    const mixer = new ClipAudioMixer(() => { made++; return fakeContext().context; });
    mixer.apply([]);
    mixer.setMasterVolume(0.4);
    expect(made).toBe(0);
  });
});
