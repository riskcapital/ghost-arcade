/**
 * The beat grid detected from a song moves with the song: drop it at
 * 28.25 s, detect tempo, then set its Start to 0, and bar 1 must still be on
 * the song's first beat (it stayed at 28.25 s, so the bar counter read
 * -15.4.3 at 0:00 and Auto show's sections landed off the beat).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../audio/clipAudioBus', () => ({
  clipAudioBus: {
    attachClip: () => true,
    detachClip: () => {},
    rewireClip: () => {},
    setClipVolume: () => {},
    setClipMuted: () => {},
    subscribe: (fn: (v: unknown) => void) => { fn({}); return () => {}; },
  },
}));
vi.stubGlobal('document', {
  createElement: (tag: string) => ({ tag, dataset: {}, pause() {}, load() {}, removeAttribute() {}, src: '', muted: false, loop: false, preload: '', crossOrigin: '' }),
});

const { showTimeline } = await import('./showTimeline');
const { tempoFromAnalysis } = await import('../show/tempoMap');

afterEach(() => { vi.restoreAllMocks(); showTimeline._resetForTest(); });

const beats = Array.from({ length: 64 }, (_, i) => 0.125 + i * (60 / 128));

async function songWithGrid(at: number) {
  // Measuring the file needs a real <audio>; the length is given here.
  vi.spyOn(showTimeline, 'analyzeAudioTrack').mockResolvedValue(true);
  showTimeline.activateDoc('timeline');
  const id = (await showTimeline.addAudioTrack({ name: 'song.wav', url: 'ghost-asset://localhost/song.wav', startTime: at, duration: 30 }))!;
  const track = get(showTimeline).audioTracks.find((t) => t.id === id)!;
  showTimeline.setTempo(tempoFromAnalysis({ tempo: 128, beats }, track));
  expect(get(showTimeline).tempo!.offset).toBeCloseTo(at + 0.125, 6);
  return id;
}

describe('the detected beat grid follows its song', () => {
  it('moving the song (Inspector Start, a drag) moves bar 1 with it', async () => {
    const id = await songWithGrid(28.25);
    showTimeline.moveAudioTrack(id, 0);
    expect(get(showTimeline).audioTracks[0].startTime).toBe(0);
    expect(get(showTimeline).tempo!.offset).toBeCloseTo(0.125, 6);
  });

  it('trimming the head keeps the grid where the audio is', async () => {
    const id = await songWithGrid(4);
    showTimeline.resizeAudioTrack(id, 'start', 6);
    const t = get(showTimeline).audioTracks[0];
    expect(t.startTime).toBe(6);
    expect(get(showTimeline).tempo!.offset).toBeCloseTo(4.125, 6);
  });

  it('a sound row edit that moves the block moves the grid', async () => {
    const id = await songWithGrid(10);
    const s = get(showTimeline);
    showTimeline.setSoundBlocks(s.audioTracks.map((t) => (t.id === id ? { ...t, startTime: 2 } : t)));
    expect(get(showTimeline).tempo!.offset).toBeCloseTo(2.125, 6);
  });

  it('a grid typed in by hand, or from another song, stays put', async () => {
    const id = await songWithGrid(10);
    showTimeline.setTempo({ ...get(showTimeline).tempo!, source: 'manual' });
    showTimeline.moveAudioTrack(id, 0);
    expect(get(showTimeline).tempo!.offset).toBeCloseTo(10.125, 6);
  });
});
