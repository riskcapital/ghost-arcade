/**
 * The mapping show: rows are the mapping layers, empty means hidden, layers
 * added on a piece draw over it in order, a block's own values reach the
 * scene, old show files open as rows, and a takeover works on a row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { evaluateShowTracks, type ShowTrackFrame } from './showTrackEval';
import { buildShowTrackScene, showSubLayerId, showTrackLayerId, ShowTrackSceneCache } from './showTrackScene';
import { ShowClipSources } from './showClipSources';
import { isBareRow, numberedRows, reconcileStageRows, rowTrackId, stagePieces } from './showStageRows';
import { showTimeline, setShowCompositionLoader, setShowTrackFrameSink, trackTemplateFromLayer } from '../../stores/showTimeline';
import { buildTakeoverScene, takeoverLayerId } from '../takeover/takeoverScene';
import { hiddenSpans, trackHeight } from '../../components/show/timeline/trackLayout';

function layer(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: { id: `own-${id}`, type: 'image', src: '/own.png', name: 'own' }, ...extra } as unknown as Layer;
}
const group = (id: string) => layer(id, { type: 'group' as Layer['type'], source: null });
const child = (id: string, parent: string) => layer(id, { parentGroupId: parent });

const shader = (values: Record<string, number> = { amount: 0.25 }): ShowClipMedia => ({
  kind: 'shader', name: 'Glow', src: 'ISF/Glow.fs', shaderCode: 'void main(){}', shaderInputs: [{ NAME: 'amount', TYPE: 'float', MIN: 0, MAX: 1, DEFAULT: 0.5 }], shaderValues: values,
});
const image = (name = 'a.png'): ShowClipMedia => ({ kind: 'image', name, src: `/media/${name}` });

function clip(id: string, startTime: number, duration: number, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media: image(), inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

function row(layerId: string, clips: ShowLayerClip[], extra: Partial<ShowLayerTrack> = {}): ShowLayerTrack {
  return { id: rowTrackId(layerId), layerId, layerName: layerId, template: layer(layerId, { surfaceId: layerId }), clips, lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false, ...extra };
}

function frameAt(tracks: ShowLayerTrack[], t: number): ShowTrackFrame {
  return evaluateShowTracks(tracks, t, { playing: true, seekGeneration: 1 });
}

function build(live: Layer[], frame: ShowTrackFrame, sources = new ShowClipSources({ now: () => 1000 })) {
  return buildShowTrackScene(live, frame, {
    sourceFor: (st) => sources.sourceFor(st, frame),
    xfadeSourceFor: (st) => sources.xfadeSourceFor(st, frame),
  });
}

const opts = { templateOf: trackTemplateFromLayer };

describe('rows are the mapping layers', () => {
  it('follows the stage order, with groups and their children', () => {
    const stage = [group('Arch'), child('ArchL', 'Arch'), child('ArchR', 'Arch'), layer('Door')];
    const rows = reconcileStageRows([], stagePieces(stage, []), opts)!;
    expect(rows.map((r) => r.layerId)).toEqual(['Arch', 'ArchL', 'ArchR', 'Door']);
    expect(rows.map((r) => r.row?.kind)).toEqual(['group', 'piece', 'piece', 'piece']);
    expect(rows.map((r) => r.row?.depth)).toEqual([0, 1, 1, 0]);
    expect(rows.every((r) => r.id === rowTrackId(r.layerId) && isBareRow(r))).toBe(true);
  });

  it('a folded group hides its children\'s rows (they take no height)', () => {
    const stage = [group('Arch'), child('ArchL', 'Arch'), layer('Door')];
    const first = reconcileStageRows([], stagePieces(stage, []), opts)!;
    const folded = first.map((r) => (r.layerId === 'Arch' ? { ...r, foldChildren: true } : r));
    const rows = reconcileStageRows(folded, stagePieces(stage, []), opts)!;
    expect(rows.map((r) => r.row?.hidden)).toEqual([false, true, false]);
    expect(rows.map(trackHeight)[1]).toBe(0);
  });

  it('merges the pieces of every look the show uses, by layer id', () => {
    const stage = [layer('Facade'), layer('Door')];
    const lookB = [layer('Facade'), layer('Windows'), layer('Door')];
    const lookC = [layer('Roof'), layer('Facade')];
    const pieces = stagePieces(stage, [lookB, lookC]);
    expect(pieces.map((p) => p.id)).toEqual(['Roof', 'Facade', 'Windows', 'Door']);
    expect(pieces.map((p) => p.onStage)).toEqual([false, true, false, true]);
    const rows = reconcileStageRows([], pieces, opts)!;
    expect(rows.find((r) => r.layerId === 'Windows')?.row).toMatchObject({ kind: 'piece', onStage: false });
  });

  it('follows renames, reorders, new and removed layers, and keeps the rows that have blocks', () => {
    let tracks = reconcileStageRows([], stagePieces([layer('A'), layer('B')], []), opts)!;
    tracks = tracks.map((t) => (t.layerId === 'B' ? { ...t, clips: [clip('c', 0, 4)] } : t));
    const renamed = layer('B', { name: 'Big wall' });
    tracks = reconcileStageRows(tracks, stagePieces([renamed, layer('C'), layer('A')], []), opts)!;
    expect(tracks.map((t) => [t.layerId, t.layerName])).toEqual([['B', 'Big wall'], ['C', 'C'], ['A', 'A']]);
    expect(tracks[0].clips).toHaveLength(1);
    // A layer gone with nothing on its row: the row goes. With blocks: a
    // missing-piece row the user can delete.
    tracks = reconcileStageRows(tracks, stagePieces([layer('C')], []), opts)!;
    expect(tracks.map((t) => [t.layerId, t.row?.kind])).toEqual([['C', 'piece'], ['B', 'missing']]);
    // Nothing changes: no new list.
    expect(reconcileStageRows(tracks, stagePieces([layer('C')], []), opts)).toBeNull();
  });

  it('keeps the layers added on a piece right under it', () => {
    const base = reconcileStageRows([], stagePieces([layer('A'), layer('B')], []), opts)!;
    const sub: ShowLayerTrack = { ...row('A', [clip('s', 0, 2)]), id: 'sub1', subRow: true, layerName: 'A glow' };
    const rows = reconcileStageRows([...base, sub], stagePieces([layer('A'), layer('B')], []), opts)!;
    expect(rows.map((r) => [r.id, r.row?.kind])).toEqual([[rowTrackId('A'), 'piece'], ['sub1', 'sub'], [rowTrackId('B'), 'piece']]);
    expect(numberedRows(rows).map((r) => r.layerId)).toEqual(['A', 'B']);
  });
});

describe('empty means hidden', () => {
  const live = [layer('A'), layer('B')];

  it('hides the piece where its row has no block; a row with no blocks follows the look', () => {
    const tracks = [row('A', [clip('c', 2, 2)]), row('B', [])];
    const gap = frameAt(tracks, 1);
    expect(gap.tracks[0].opacity).toBe(0);
    expect(gap.tracks[1].opacity).toBe(1);
    const scene = build(live, gap);
    expect(scene.find((l) => l.id === 'A')?._showOpacityMul).toBe(0);
    expect(scene.find((l) => l.id === 'B')).toBe(live[1]);
    const during = build(live, frameAt(tracks, 3));
    expect(during.find((l) => l.id === 'A')?._showOpacityMul).toBeUndefined();
    expect(during.find((l) => l.id === 'A')?.source?.id).toBe('show:c');
  });

  it('a row set to show the look between blocks passes the piece through', () => {
    const scene = build(live, frameAt([row('A', [clip('c', 2, 2)], { gap: 'layer' })], 1));
    expect(scene).toBe(live);
  });

  it('the eye hides the piece for the whole show', () => {
    const frame = frameAt([row('A', [], { muted: true })], 5);
    expect(frame.tracks[0].opacity).toBe(0);
  });

  it('draws the hidden stretches the row shows hatched', () => {
    const r = row('A', [clip('a', 2, 2), clip('b', 6, 1)]);
    expect(hiddenSpans(r, 0, 10)).toEqual([{ start: 0, end: 2 }, { start: 4, end: 6 }, { start: 7, end: 10 }]);
    expect(hiddenSpans(row('A', []), 0, 10)).toEqual([]);
    expect(hiddenSpans({ ...r, gap: 'layer' }, 0, 10)).toEqual([]);
    expect(hiddenSpans({ ...r, muted: true }, 0, 10)).toEqual([{ start: 0, end: 10 }]);
  });
});

describe('layers added on a piece', () => {
  const live = [layer('Top'), layer('A', { blendMode: 'screen' }), layer('B')];
  const sub = (id: string, clips: ShowLayerClip[]): ShowLayerTrack => ({ ...row('A', clips), id, subRow: true, layerName: id });

  it('draw over the piece, later rows on top, each with its block\'s blend mode', () => {
    const tracks = [
      row('A', [clip('main', 0, 10)]),
      sub('s1', [clip('one', 0, 10, { blendMode: 'add', media: shader() })]),
      sub('s2', [clip('two', 0, 10, { opacity: 0.5 })]),
    ];
    const scene = build(live, frameAt(tracks, 1));
    expect(scene.map((l) => l.id)).toEqual(['Top', showSubLayerId('A', 's2'), showSubLayerId('A', 's1'), 'A', 'B']);
    const s1 = scene[2];
    const s2 = scene[1];
    expect(s1.blendMode).toBe('add');
    expect(s1.source?.type).toBe('shader');
    // Unset: normal, whatever the piece's own blend mode.
    expect(s2.blendMode).toBe('normal');
    expect(s2._showOpacityMul).toBe(0.5);
    // The piece keeps its own blend mode under its row's block.
    expect(scene[3].blendMode).toBe('screen');
    expect(scene[3].source?.id).toBe('show:main');
  });

  it('draw only while a block plays, and do not hide the piece in their gaps', () => {
    const tracks = [row('A', []), sub('s1', [clip('one', 5, 2)])];
    expect(build(live, frameAt(tracks, 1))).toBe(live);
    const scene = build(live, frameAt(tracks, 6));
    expect(scene.map((l) => l.id)).toEqual(['Top', showSubLayerId('A', 's1'), 'A', 'B']);
    expect(scene[2]).toBe(live[1]);
  });

  it('go over the piece\'s own copy when the look lacks the piece', () => {
    const tracks = [row('X', [clip('main', 0, 10)]), sub('s1', [clip('one', 0, 10)])].map((t) => ({ ...t, layerId: 'X', template: layer('X', { surfaceId: 'X' }) }));
    const scene = build(live, frameAt(tracks, 1));
    expect(scene.map((l) => l.id).slice(0, 2)).toEqual([showSubLayerId('X', 's1'), showTrackLayerId('X')]);
  });

  it('a block blend change rebuilds a cached scene (not only its values)', () => {
    const cache = new ShowTrackSceneCache();
    const sources = new ShowClipSources({ now: () => 1000 });
    const run = (blend: ShowLayerClip['blendMode']) => {
      const tracks = [sub('s1', [clip('one', 0, 10, { blendMode: blend })])];
      const frame = frameAt(tracks, 1);
      const ctx = { sourceFor: (st: any) => sources.sourceFor(st, frame) };
      const prepared = cache.prepare(live, frame, ctx, [live]);
      const scene = prepared.reusable ? prepared.reuse() : prepared.build(live.map((l) => ({ ...l })));
      prepared.commit(scene);
      return scene.find((l) => l.id === showSubLayerId('A', 's1'))!.blendMode;
    };
    expect(run('add')).toBe('add');
    expect(run('multiply')).toBe('multiply');
  });
});

describe('the show store with rows', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  it('makes a row per piece without saving the empty ones or counting them as content', () => {
    showTimeline.syncStageRows([layer('A'), layer('B')], []);
    expect(get(showTimeline).layerTracks.map((t) => t.id)).toEqual([rowTrackId('A'), rowTrackId('B')]);
    expect(showTimeline.hasContent()).toBe(false);
    expect(showTimeline.serialize().layerTracks).toEqual([]);
    showTimeline.addLayerClip(rowTrackId('B'), image(), 0);
    expect(showTimeline.hasContent()).toBe(true);
    expect(showTimeline.serialize().layerTracks!.map((t) => t.id)).toEqual([rowTrackId('B')]);
    expect((showTimeline.serialize().layerTracks![0] as any).row).toBeUndefined();
  });

  it('adds a layer on a piece under it, and the frame marks it', () => {
    showTimeline.syncStageRows([layer('A'), layer('B')], []);
    const sub = showTimeline.addSubRow('A')!;
    expect(get(showTimeline).layerTracks.map((t) => t.id)).toEqual([rowTrackId('A'), sub, rowTrackId('B')]);
    let frame: ShowTrackFrame | null = null;
    setShowTrackFrameSink((f) => { frame = f; });
    showTimeline.addLayerClip(sub, shader(), 0, { blendMode: 'add' });
    expect(frame!.tracks.map((t) => [t.trackId, t.sub ?? false])).toEqual([[sub, true]]);
    expect(frame!.tracks[0].clip?.blendMode).toBe('add');
    // The sub row survives a save and reopen.
    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    showTimeline.syncStageRows([layer('A'), layer('B')], []);
    expect(get(showTimeline).layerTracks.map((t) => [t.id, t.row?.kind])).toEqual([[rowTrackId('A'), 'piece'], [sub, 'sub'], [rowTrackId('B'), 'piece']]);
  });

  it('a block\'s own shader value edit reaches the scene at once, and only the block has it', () => {
    showTimeline.syncStageRows([layer('A')], []);
    const clipId = showTimeline.addLayerClip(rowTrackId('A'), shader({ amount: 0.25 }), 0)!;
    let frame: ShowTrackFrame | null = null;
    setShowTrackFrameSink((f) => { frame = f; });
    showTimeline.seek(1);
    const sources = new ShowClipSources({ now: () => 1000 });
    const before = build([layer('A')], frame!, sources).find((l) => l.id === 'A')!;
    expect(before.source?.shaderValues).toMatchObject({ amount: 0.25 });
    const found = showTimeline.findLayerClip(clipId)!;
    showTimeline.updateLayerClip(clipId, { media: { ...found.clip.media, shaderValues: { amount: 0.9 } } });
    const after = build([layer('A')], frame!, sources).find((l) => l.id === 'A')!;
    expect(after.source?.shaderValues).toMatchObject({ amount: 0.9 });
    expect(after.source?.id).toBe(before.source?.id);
    // Paused, the edit still reaches the scene (a new frame is published).
    showTimeline.pause();
    const media = showTimeline.findLayerClip(clipId)!.clip.media;
    const published = frame;
    showTimeline.updateLayerClip(clipId, { media: { ...media, shaderValues: { amount: 0.1 } } });
    expect(frame).not.toBe(published);
    expect(build([layer('A')], frame!, sources).find((l) => l.id === 'A')!.source?.shaderValues).toMatchObject({ amount: 0.1 });
  });

  it('opens an old show: tracks keep their ids and become their pieces\' rows, a gone layer is a missing piece', () => {
    const old = {
      version: 2, isOpen: true, loop: false, zoom: 12, snapEnabled: true, audioTracks: [], presetClips: [],
      layerTracks: [
        { id: 'old-1', layerId: 'Wall', layerName: 'Wall', template: layer('Wall'), clips: [clip('c1', 0, 4)], lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false },
        { id: 'old-2', layerId: 'Gone', layerName: 'Gone', template: layer('Gone'), clips: [clip('c2', 0, 4)], lanes: [], gap: 'hide', muted: false, locked: false, collapsed: false },
        { id: 'old-3', layerId: 'Empty', layerName: 'Empty', template: layer('Empty'), clips: [], lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false },
      ],
    };
    showTimeline.hydrate(old);
    showTimeline.syncStageRows([layer('Floor'), layer('Wall')], []);
    const rows = get(showTimeline).layerTracks;
    expect(rows.map((t) => [t.id, t.row?.kind])).toEqual([[rowTrackId('Floor'), 'piece'], ['old-1', 'piece'], ['old-2', 'missing']]);
    // An old track keeps what it did between its clips.
    expect(rows[1].gap).toBe('layer');
    // A missing piece can be deleted.
    showTimeline.removeLayerTrack('old-2');
    showTimeline.syncStageRows([layer('Floor'), layer('Wall')], []);
    expect(get(showTimeline).layerTracks.map((t) => t.id)).toEqual([rowTrackId('Floor'), 'old-1']);
  });
});

describe('takeover on a row', () => {
  it('numbers rows without the layers added on pieces, and draws the takeover over them', () => {
    const tracks = reconcileStageRows([], stagePieces([layer('A'), layer('B')], []), opts)!;
    const sub = { ...row('A', [clip('one', 0, 10)]), id: 'sub1', subRow: true };
    const all = reconcileStageRows([...tracks, sub], stagePieces([layer('A'), layer('B')], []), opts)!;
    expect(numberedRows(all)[1].layerId).toBe('B');
    const live = [layer('A'), layer('B')];
    const scene = build(live, frameAt([all[1]], 1));
    expect(scene.map((l) => l.id)).toEqual([showSubLayerId('A', 'sub1'), 'A', 'B']);
    const taken = buildTakeoverScene(scene, {
      surfaces: [{ surfaceId: 'A', trackId: rowTrackId('A'), level: 1, source: { kind: 'black' }, key: 'k', phase: 'live' } as any],
    } as any)!;
    expect(taken.map((l) => l.id)).toEqual([takeoverLayerId('A'), showSubLayerId('A', 'sub1'), 'A', 'B']);
  });
});
