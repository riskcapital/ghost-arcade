/**
 * Score / Shuffle as the dialog runs them: Shuffle after an undo still
 * replaces the draft that is back, it never writes into the Show tab, and a
 * new document starts Shuffle over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derived, get, writable } from 'svelte/store';
import { analyzeSongFeatures } from '../lines/songFeatures';
import { synthSong, SYNTH_DEFAULT } from './synthSong.testutil';

const state = writable({ layers: [], selectedLayerId: null });
vi.mock('../../stores/layers', () => ({
  project: { subscribe: state.subscribe, selectLayer: () => {} },
  layers: derived(state, (s) => s.layers),
  selectedLayerId: derived(state, (s) => s.selectedLayerId),
}));
vi.mock('../../audio/showAudio', () => ({ cachedShowAudioDecode: () => null, decodeShowAudio: async () => null, retainShowAudioDecodes: () => {} }));

const features = analyzeSongFeatures(synthSong(SYNTH_DEFAULT), 22050);
let gate: Promise<void> = Promise.resolve();
vi.mock('../lines/songFeatures', async (orig) => ({
  ...(await orig<typeof import('../lines/songFeatures')>()),
  songFeaturesFor: async () => { await gate; return features; },
}));

const { showTimeline, setShowCompositionLoader } = await import('../../stores/showTimeline');
const { commitScore, prepareScore, shuffleScore, hasLastScore } = await import('./scoreRuntime');
const { createTempoMap } = await import('../../show/tempoMap');

function song() {
  showTimeline.hydrate({
    version: 8,
    activeDoc: 'timeline',
    audioTracks: [],
    presetClips: [],
    timeline: {
      version: 8,
      audioTracks: [{ id: 'song', name: 'Song.wav', url: 'blob:song', startTime: 0, duration: 120, offset: 0, sourceDuration: 120, volume: 1, muted: false, lane: 0, peaks: [1] }],
      presetClips: [],
      tempo: createTempoMap(120, 0),
    },
  } as never);
}

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  gate = Promise.resolve();
  song();
});
afterEach(() => showTimeline._resetForTest());

const lookIds = () => get(showTimeline).lookClips.map((c) => c.id).sort().join();

describe('Shuffle', () => {
  it('after an undo it replaces the draft that came back', async () => {
    const r = await prepareScore();
    expect(r.ok).toBe(true);
    const before = showTimeline.exportArrangement();
    commitScore((r as { prep: Parameters<typeof commitScore>[0] }).prep);
    const a = showTimeline.exportArrangement();
    const aLooks = lookIds();
    expect(aLooks).not.toBe('');
    expect((await shuffleScore()).ok).toBe(true);
    // Undo the Shuffle: draft A is back.
    showTimeline.restoreArrangement(a);
    expect(lookIds()).toBe(aLooks);
    expect((await shuffleScore()).ok).toBe(true);
    const looks = get(showTimeline).lookClips;
    expect(looks.length).toBeGreaterThan(0);
    expect(lookIds()).not.toBe(aLooks);
    // One draft on the Timeline, not A's left with nothing new beside it.
    expect(get(showTimeline).lookClips.every((c) => !aLooks.split(',').includes(c.id))).toBe(true);
    showTimeline.restoreArrangement(before);
  });

  it('started on the Timeline, finishing after the Show tab opened writes nothing into the Show', async () => {
    const r = await prepareScore();
    commitScore((r as { prep: Parameters<typeof commitScore>[0] }).prep);
    let open!: () => void;
    gate = new Promise((res) => { open = res; });
    const pending = shuffleScore();
    showTimeline.activateDoc('show');
    open();
    const out = await pending;
    expect(out.ok).toBe(false);
    expect(get(showTimeline).doc).toBe('show');
    expect(get(showTimeline).sections).toEqual([]);
    expect(get(showTimeline).lookClips).toEqual([]);
  });

  it('a new document starts Shuffle over', async () => {
    const r = await prepareScore();
    commitScore((r as { prep: Parameters<typeof commitScore>[0] }).prep);
    expect(hasLastScore()).toBe(true);
    song();
    expect(hasLastScore()).toBe(false);
  });
});
