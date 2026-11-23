/**
 * Auto show's runtime: a draft is laid down only onto what it was worked out
 * from (a piece deleted or a block added since refuses it, and so does a
 * moved song or the Show tab), never twice, Shuffle after an undo of the
 * whole show refuses instead of laying a new one, it keeps the last few
 * drafts only, and a stopped read stops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derived, get, writable } from 'svelte/store';
import type { Layer } from '../../types';
import { analyzeSongFeatures } from '../lines/songFeatures';
// @ts-expect-error plain JS shared with the Show Runner's fixtures
import { styleSong } from '../../../../scripts/show-runner/styleSongs.mjs';

function quad(id: string, x0: number, y0: number, x1: number, y1: number): Layer {
  return {
    id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null, edgeEffects: null, parentGroupId: null, layerShape: null,
    corners: { topLeft: { x: x0, y: 1 - y0 }, topRight: { x: x1, y: 1 - y0 }, bottomRight: { x: x1, y: 1 - y1 }, bottomLeft: { x: x0, y: 1 - y1 } },
  } as unknown as Layer;
}
const wall: Layer[] = [quad('screen', 0.4, 0.35, 0.6, 0.65)];
for (let c = 0; c < 6; c++) wall.push(quad(`t${c}`, c / 6, 0, (c + 1) / 6, 0.3));

const state = writable<{ layers: Layer[]; selectedLayerId: null }>({ layers: wall, selectedLayerId: null });
vi.mock('../../stores/layers', () => ({
  project: { subscribe: state.subscribe, selectLayer: () => {} },
  layers: derived(state, (s) => s.layers),
  selectedLayerId: derived(state, (s) => s.selectedLayerId),
}));
vi.mock('../../audio/showAudio', () => ({ cachedShowAudioDecode: () => null, decodeShowAudio: async () => null, retainShowAudioDecodes: () => {} }));
const features = analyzeSongFeatures(styleSong('driving'), 22050);
let gate: Promise<void> = Promise.resolve();
vi.mock('../lines/songFeatures', async (orig) => ({
  ...(await orig<typeof import('../lines/songFeatures')>()),
  songFeaturesFor: async () => { await gate; return features; },
}));

const { showTimeline, setShowCompositionLoader } = await import('../../stores/showTimeline');
const rt = await import('./autoShowRuntime');
const { AUTO_SHOW_CATALOG } = await import('./catalogData');
const { createTempoMap } = await import('../../show/tempoMap');
type Prep = import('./autoShowRuntime').AutoShowPrep;

const songTrack = { id: 'song', name: 'Song.wav', url: 'blob:song', startTime: 0, duration: features.duration, offset: 0, sourceDuration: features.duration, volume: 1, muted: false, lane: 0, peaks: [1] };
function song(track = songTrack) {
  showTimeline.hydrate({
    version: 8, activeDoc: 'timeline', audioTracks: [], presetClips: [],
    timeline: {
      version: 8,
      audioTracks: [track],
      presetClips: [],
      tempo: createTempoMap(128, 0),
      layerTracks: wall.map((l) => ({ id: `row:${l.id}`, layerId: l.id, layerName: l.name, template: null, clips: [], lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false })),
    },
  } as never);
}

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  rt._setShaderSources(Object.fromEntries(AUTO_SHOW_CATALOG.filter((c) => c.kind === 'shader').map((c) => [c.ref, '/*{"ISFVSN":"2","INPUTS":[]}*/ void main(){}'])));
  state.set({ layers: wall, selectedLayerId: null });
  gate = Promise.resolve();
  song();
});
afterEach(() => showTimeline._resetForTest());

async function prepared(): Promise<Prep> {
  const r = await rt.prepareAutoShow();
  expect(r.ok).toBe(true);
  return (r as { prep: Prep }).prep;
}
const subRows = () => get(showTimeline).layerTracks.filter((t) => t.subRow).length;

describe('laying an Auto show down', () => {
  it('lays a fresh draft, and never the same draft twice', async () => {
    const prep = await prepared();
    expect(rt.commitAutoShow(prep, { play: false })).toEqual({ ok: true });
    expect(subRows()).toBe(4);
    const again = rt.commitAutoShow(prep, { play: false });
    expect(again).toMatchObject({ ok: false, why: 'changed' });
    expect(subRows()).toBe(4);
  });

  it('refuses a draft made before a piece was deleted (the old one would land on it)', async () => {
    const prep = await prepared();
    state.set({ layers: wall.filter((l) => l.id !== prep.draft.hostLayerId), selectedLayerId: null });
    const r = rt.commitAutoShow(prep, { play: false });
    expect(r).toMatchObject({ ok: false, why: 'changed' });
    expect(subRows()).toBe(0);
    expect(get(showTimeline).sections).toHaveLength(0);
    // Worked out again onto the pieces as they are now, it goes in.
    const again = await rt.redraftAutoShow(prep, {});
    expect(again!.draft.hostLayerId).not.toBe(prep.draft.hostLayerId);
    expect(rt.commitAutoShow(again!, { play: false })).toEqual({ ok: true });
  });

  it('refuses after a piece moved, or a block was added to the Timeline meanwhile', async () => {
    const prep = await prepared();
    state.set({ layers: wall.map((l) => (l.id === 't0' ? quad('t0', 0, 0, 0.1, 0.2) : l)), selectedLayerId: null });
    expect(rt.commitAutoShow(prep, { play: false })).toMatchObject({ ok: false, why: 'changed' });
    state.set({ layers: wall, selectedLayerId: null });
    expect(rt.draftStalenessOf(prep)).toBeNull();
    showTimeline.replaceTimelineParts({ sections: [{ id: 'mine', name: 'Mine', start: 0, end: 4 } as never] });
    expect(rt.commitAutoShow(prep, { play: false })).toMatchObject({ ok: false, why: 'changed' });
  });

  it('a renamed piece or another layer\'s shader values changing does not count; an undo back to the same Timeline does not either', async () => {
    const before = showTimeline.exportArrangement();
    const prep = await prepared();
    state.set({ layers: wall.map((l) => (l.id === 't3' ? { ...l, opacity: 0.4, source: { type: 'shader', shaderValues: { a: Math.random() } } } as unknown as Layer : l)), selectedLayerId: null });
    expect(rt.draftStalenessOf(prep)).toBeNull();
    showTimeline.replaceTimelineParts({ sections: [{ id: 'mine', name: 'Mine', start: 0, end: 4 } as never] });
    expect(rt.draftStalenessOf(prep)).toBe('changed');
    showTimeline.restoreArrangement(before);
    expect(rt.draftStalenessOf(prep)).toBeNull();
  });

  it('refuses when the song moved, or the Show tab is open', async () => {
    const prep = await prepared();
    song({ ...songTrack, startTime: 4 });
    expect(rt.commitAutoShow(prep, { play: false })).toMatchObject({ ok: false, why: 'song' });
    song();
    const p2 = await prepared();
    showTimeline.activateDoc('show');
    expect(rt.commitAutoShow(p2, { play: false })).toMatchObject({ ok: false, why: 'doc' });
    expect(get(showTimeline).sections).toEqual([]);
  });
});

describe('Shuffle', () => {
  it('after the whole show was undone it refuses (no new show on its own)', async () => {
    const before = showTimeline.exportArrangement();
    rt.commitAutoShow(await prepared(), { play: false });
    showTimeline.restoreArrangement(before);
    const r = await rt.shuffleAutoShow();
    expect(r).toMatchObject({ ok: false, undone: true });
    expect(get(showTimeline).sections).toHaveLength(0);
    expect(subRows()).toBe(0);
  });

  it('after an undo of a Shuffle it replaces the show that came back', async () => {
    rt.commitAutoShow(await prepared(), { play: false });
    const a = showTimeline.exportArrangement();
    const aSections = get(showTimeline).sections.map((s) => s.id).join();
    expect((await rt.shuffleAutoShow()).ok).toBe(true);
    showTimeline.restoreArrangement(a);
    const r = await rt.shuffleAutoShow();
    showTimeline.pause();
    expect(r.ok).toBe(true);
    expect(get(showTimeline).sections.map((s) => s.id).join()).not.toBe(aSections);
  });

  it('remembers the last 8 drafts only, and lets go of the analysis on release', async () => {
    rt.commitAutoShow(await prepared(), { play: false });
    for (let i = 0; i < 12; i++) expect((await rt.shuffleAutoShow()).ok).toBe(true);
    showTimeline.pause();
    expect(rt._autoDraftCount()).toBe(rt.MAX_AUTO_DRAFTS);
    expect(rt.MAX_AUTO_DRAFTS).toBe(8);
    // Still one show on the Timeline: each Shuffle took the last one out.
    expect(subRows()).toBe(4);
    expect(rt.hasLastAutoShow()).toBe(true);
    rt.releaseLastAutoShow();
    expect(rt.hasLastAutoShow()).toBe(false);
    expect(await rt.shuffleAutoShow()).toMatchObject({ ok: false });
    // A new document forgets the drafts too.
    song();
    expect(rt._autoDraftCount()).toBe(0);
  });

  it('reopened after editing one block, Shuffle redrafts the rest and keeps the edit', async () => {
    rt.commitAutoShow(await prepared(), { play: false });
    showTimeline.pause();
    const autoClips = () => get(showTimeline).layerTracks.flatMap((t) => t.clips.filter((c) => c.where?.namedOrder?.startsWith('autoshow:')));
    const before = autoClips().length;
    expect(before).toBeGreaterThan(1);
    // Edit one block: it is the user's now.
    const edited = autoClips()[0];
    showTimeline.replaceTimelineParts({ layerTracks: get(showTimeline).layerTracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === edited.id ? { ...c, name: 'mine' } : c)) })) });
    rt.releaseLastAutoShow();
    await prepared();
    expect((await rt.shuffleAutoShow()).ok).toBe(true);
    showTimeline.pause();
    const after = autoClips();
    expect(after.some((c) => c.id === edited.id)).toBe(true);
    expect(after.length).toBeGreaterThan(1);
  });

  it('stopped while it waits, it changes nothing', async () => {
    rt.commitAutoShow(await prepared(), { play: false });
    const ids = get(showTimeline).sections.map((s) => s.id).join();
    const ac = new AbortController();
    const pending = rt.shuffleAutoShow({}, { signal: ac.signal });
    ac.abort();
    expect(await pending).toMatchObject({ ok: false, cancelled: true });
    expect(get(showTimeline).sections.map((s) => s.id).join()).toBe(ids);
  });
});

describe('reading the song', () => {
  it('stopped while it waits on the analysis, it returns stopped', async () => {
    let open!: () => void;
    gate = new Promise((r) => { open = r; });
    const ac = new AbortController();
    const pending = rt.prepareAutoShow({ signal: ac.signal });
    ac.abort();
    open();
    expect(await pending).toMatchObject({ ok: false, cancelled: true });
  });

  it('the Show tab opened while it waited: refused', async () => {
    let open!: () => void;
    gate = new Promise((r) => { open = r; });
    const pending = rt.prepareAutoShow();
    showTimeline.activateDoc('show');
    open();
    expect(await pending).toMatchObject({ ok: false, reason: 'Open the Timeline first.' });
  });
});
