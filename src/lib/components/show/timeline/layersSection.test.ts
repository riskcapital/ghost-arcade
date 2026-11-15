import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../../types';
import { showTimeline, setShowCompositionLoader, setShowTrackFrameSink } from '../../../stores/showTimeline';
import { project } from '../../../stores/layers';

// The project store pulls the whole editor in; only its id is read here.
vi.mock('../../../stores/layers', () => ({ project: writable({ id: 'project-1', layers: [] }) }));
import { moveClipsAcrossTracks } from '../../../show/tracks/showTrackEdit';
import { ADD_TRACK_ROW_HEIGHT, TRACK_ROW_HEIGHT, focusedTrackId } from './trackLayout';
import {
  LAYERS_OPEN_CAP,
  LAYERS_OPEN_KEY,
  LAYERS_SECTION_HEIGHT,
  layerBlockSpans,
  layersOpen,
  layersOpenFor,
  readLayersChoices,
  rememberLayersChoice,
  revealsLayerRow,
  rowShown,
  rowStack,
  setLayersOpen,
  stackHeight,
  stackIndexAt,
  stackSectionTop,
  stackTops,
  timelineRowStack,
  watchLayerReveal,
} from './layersSection';

const clip = (id: string, startTime: number, duration = 2): ShowLayerClip =>
  ({ id, startTime, duration, media: { kind: 'image', name: id, src: `/${id}` }, fadeIn: 0, fadeOut: 0 }) as unknown as ShowLayerClip;
const track = (id: string, extra: Partial<ShowLayerTrack> = {}): ShowLayerTrack =>
  ({ id, layerId: extra.layerId ?? id, layerName: id, template: null, clips: [], lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false, ...extra }) as ShowLayerTrack;
const group = (id: string, host: string, extra: Partial<ShowLayerTrack> = {}) =>
  track(id, { layerId: host, subRow: true, group: { orderId: `o-${id}`, unified: true }, ...extra });

// Show list: piece A, its group row G1, piece B, an added layer on B, piece C's group row G2.
const LIST = [track('A'), group('G1', 'A'), track('B'), track('B2', { layerId: 'B', subRow: true }), track('C'), group('G2', 'C')];

describe('Layers section: the rows as drawn', () => {
  it('puts the group rows above the layer rows, keeping each part in show order', () => {
    const st = rowStack(LIST, true);
    expect(st.rows.map((t) => t.id)).toEqual(['G1', 'G2', 'A', 'B', 'B2', 'C']);
    expect(st.groupCount).toBe(2);
    expect(st.section).toBe(true);
    // The header counts the pieces, not the layers added on them.
    expect(st.count).toBe(3);
  });

  it('keeps the show list itself when there are no group rows', () => {
    const plain = [track('A'), track('B')];
    expect(rowStack(plain, true).rows).toBe(plain);
    expect(rowStack([group('G', 'A')], true).section).toBe(false);
  });

  it('draws the header between the groups and the layers, and nothing of the layers folded', () => {
    const open = rowStack(LIST, true);
    expect(stackSectionTop(open)).toBe(2 * TRACK_ROW_HEIGHT);
    expect(stackTops(open)).toEqual([0, 44, 88 + LAYERS_SECTION_HEIGHT, 132 + LAYERS_SECTION_HEIGHT, 176 + LAYERS_SECTION_HEIGHT, 220 + LAYERS_SECTION_HEIGHT]);
    expect(stackHeight(open)).toBe(6 * TRACK_ROW_HEIGHT + LAYERS_SECTION_HEIGHT + ADD_TRACK_ROW_HEIGHT);

    const folded = rowStack(LIST, false);
    expect(folded.rows.filter((t) => rowShown(folded, t)).map((t) => t.id)).toEqual(['G1', 'G2']);
    // The summary strip keeps its height so the lanes stay lined up.
    expect(stackHeight(folded)).toBe(2 * TRACK_ROW_HEIGHT + LAYERS_SECTION_HEIGHT + ADD_TRACK_ROW_HEIGHT);
  });

  it('shows a group row even when its host sits in a folded mapping group', () => {
    const hidden = { kind: 'sub' as const, depth: 1, hidden: true, onStage: true };
    const st = rowStack([track('A', { row: { ...hidden, kind: 'piece' } }), group('G', 'A', { row: hidden })], true);
    expect(rowShown(st, st.rows[0])).toBe(true);
    expect(rowShown(st, st.rows[1])).toBe(false);
    expect(stackHeight(st)).toBe(TRACK_ROW_HEIGHT + LAYERS_SECTION_HEIGHT + ADD_TRACK_ROW_HEIGHT);
  });

  it('finds the row under the pointer across the header', () => {
    const st = rowStack(LIST, true);
    expect(stackIndexAt(st, 10)).toBe(0);
    expect(stackIndexAt(st, 50)).toBe(1);
    // On the header: the nearer side.
    expect(stackIndexAt(st, 88 + 4)).toBe(1);
    expect(stackIndexAt(st, 88 + LAYERS_SECTION_HEIGHT - 4)).toBe(2);
    expect(stackIndexAt(st, 88 + LAYERS_SECTION_HEIGHT + 50)).toBe(3);
    expect(stackIndexAt(st, 9999)).toBe(5);
    // Folded: past the groups is the last group row.
    expect(stackIndexAt(rowStack(LIST, false), 200)).toBe(1);
    expect(stackIndexAt(rowStack([], true), 10)).toBe(-1);
  });

  it('merges where the layer rows have blocks for the summary strip, leaving group blocks out', () => {
    const st = rowStack([
      track('A', { clips: [clip('a1', 0, 2), clip('a2', 10, 2)] }),
      group('G', 'A', { clips: [clip('g', 4, 2)] }),
      track('B', { clips: [clip('b1', 1, 3), clip('b2', 12, 1)] }),
    ], false);
    expect(layerBlockSpans(st)).toEqual([{ start: 0, end: 4 }, { start: 10, end: 13 }]);
  });
});

describe('Layers section: dragging blocks across the rows as drawn', () => {
  it('moves a block one row down in drawn order, from a group row onto the first layer row', () => {
    const tracks = [track('A'), group('G1', 'A', { clips: [clip('g', 0)] }), track('B'), group('G2', 'B')];
    const order = rowStack(tracks, true).rows.map((t) => t.id); // G1, G2, A, B
    const moved = moveClipsAcrossTracks(tracks, new Set(['g']), 0, 2, order)!;
    expect(moved.find((t) => t.id === 'A')!.clips.map((c) => c.id)).toEqual(['g']);
    expect(moved.find((t) => t.id === 'G1')!.clips).toEqual([]);
    // Without the order the same offset counts in the show list (G1 + 2 = G2).
    const plain = moveClipsAcrossTracks(tracks, new Set(['g']), 0, 2)!;
    expect(plain.find((t) => t.id === 'G2')!.clips.map((c) => c.id)).toEqual(['g']);
  });

  it('refuses a move off the drawn rows or from a row missing from the order', () => {
    const tracks = [track('A', { clips: [clip('a', 0)] }), group('G', 'A')];
    expect(moveClipsAcrossTracks(tracks, new Set(['a']), 0, 1, ['G', 'A'])).toBeNull();
    expect(moveClipsAcrossTracks(tracks, new Set(['a']), 0, -1, ['G'])).toBeNull();
    expect(moveClipsAcrossTracks(tracks, new Set(['a']), 0, -1, ['G', 'A'])!.find((t) => t.id === 'G')!.clips.map((c) => c.id)).toEqual(['a']);
  });
});

describe('Layers section: open or folded, per project', () => {
  it('opens a project never folded unless it has group rows', () => {
    expect(layersOpenFor(null, false)).toBe(true);
    expect(layersOpenFor(null, true)).toBe(false);
    expect(layersOpenFor(true, true)).toBe(true);
    expect(layersOpenFor(false, false)).toBe(false);
  });

  it('keeps the latest choice per project, dropping the oldest past the cap', () => {
    let list = rememberLayersChoice([], 'p1', false);
    list = rememberLayersChoice(list, 'p2', true);
    list = rememberLayersChoice(list, 'p1', true);
    expect(list).toEqual([['p2', true], ['p1', true]]);
    for (let i = 0; i < LAYERS_OPEN_CAP + 10; i++) list = rememberLayersChoice(list, `x${i}`, false);
    expect(list).toHaveLength(LAYERS_OPEN_CAP);
    expect(list.some(([id]) => id === 'p1')).toBe(false);
    expect(list[list.length - 1]).toEqual([`x${LAYERS_OPEN_CAP + 9}`, false]);
  });

  it('opens only for something newly picked on a layer row', () => {
    const tracks = [track('A', { clips: [clip('a', 0)] }), group('G', 'A', { clips: [clip('g', 0)] })];
    expect(revealsLayerRow(tracks, [], ['a'])).toBe(true);
    expect(revealsLayerRow(tracks, [], ['g'])).toBe(false);
    // Already selected before (the section was folded with it): no.
    expect(revealsLayerRow(tracks, ['a'], ['a', 'g'])).toBe(false);
    expect(revealsLayerRow(tracks, [], [], null, 'A')).toBe(true);
    expect(revealsLayerRow(tracks, [], [], null, 'G')).toBe(false);
    expect(revealsLayerRow(tracks, [], [], 'A', 'A')).toBe(false);
  });
});

describe('Layers section in the show', () => {
  const media = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
  const layer = (id: string) => ({ id, name: id, type: 'media', opacity: 1, source: null }) as unknown as Layer;
  let storage: Map<string, string>;
  let groupRow = '';
  let pieceRow = '';
  let stopReveal: () => void = () => {};

  beforeEach(() => {
    storage = new Map();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
    };
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
    pieceRow = showTimeline.addLayerTrack(layer('A'))!;
    showTimeline.setWhereOrders([{ id: 'left', name: 'Left', order: 'left-right', slots: [['A'], ['B']] }]);
    groupRow = showTimeline.addGroupRow('A', 'Left', { orderId: 'left', unified: true })!;
    showTimeline.addLayerClip(pieceRow, media('p'), 0, { duration: 4 });
    showTimeline.addLayerClip(groupRow, media('g'), 0, { duration: 4 });
    setLayersOpen(true);
    stopReveal = watchLayerReveal();
  });
  afterEach(() => {
    stopReveal();
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const clipOn = (trackId: string) => get(showTimeline).layerTracks.find((t) => t.id === trackId)!.clips[0].id;

  it('remembers the choice for this project and draws from it', () => {
    setLayersOpen(false);
    expect(get(layersOpen)).toBe(false);
    expect(readLayersChoices()).toContainEqual([get(project).id, false]);
    expect(JSON.parse(storage.get(LAYERS_OPEN_KEY)!)).toHaveLength(1);
    const st = get(timelineRowStack);
    expect(st.rows[0].id).toBe(groupRow);
    expect(st.rows.filter((t) => rowShown(st, t)).map((t) => t.id)).toEqual([groupRow]);
  });

  it('lets go of the blocks, the row and the focus on the layer rows when folding, so no key acts out of sight', () => {
    showTimeline.selectLayerClips([clipOn(pieceRow), clipOn(groupRow)]);
    focusedTrackId.set(pieceRow);
    setLayersOpen(false);
    expect(get(showTimeline).selectedClipIds).toEqual([clipOn(groupRow)]);
    expect(get(focusedTrackId)).toBeNull();
  });

  it('opens again when a block on a layer row is picked from elsewhere', () => {
    setLayersOpen(false);
    showTimeline.selectLayerClips([clipOn(groupRow)]);
    expect(get(layersOpen)).toBe(false);
    showTimeline.selectLayerClips([clipOn(pieceRow)]);
    expect(get(layersOpen)).toBe(true);
  });

  it('opens when a layer row itself is selected', () => {
    setLayersOpen(false);
    showTimeline.select({ kind: 'track', id: pieceRow });
    expect(get(layersOpen)).toBe(true);
  });

  it('still records onto a folded layer row', () => {
    setLayersOpen(false);
    showTimeline.cutInLayerMedia(pieceRow, media('q'), 10, null);
    expect(get(showTimeline).layerTracks.find((t) => t.id === pieceRow)!.clips.map((c) => c.media.name)).toContain('q');
    expect(get(layersOpen)).toBe(false);
  });
});
