/**
 * The takeover in the scene: a copy above the surface at the takeover's
 * level, VJ feeds in invisibly only when needed, deck rows with and without
 * the crossfader, empty rows black, the mix, groups, dropped media, effects,
 * the overlay, off-stage surfaces, and the layer cap dropping takeover
 * helpers before show helpers.
 */
import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../../types';
import {
  buildTakeoverScene,
  capTakeoverScene,
  takeoverLayerId,
  TakeoverMediaSources,
  TAKEOVER_OVERLAY_ID,
  vjRowFeedId,
} from './takeoverScene';
import type { TakeoverFrame, TakeoverSurfaceFrame } from './liveTakeover';

const layer = (id: string, patch: Partial<Layer> = {}): Layer => ({ ...createLayer(id, id, 'media'), ...patch });
const surface = (patch: Partial<TakeoverSurfaceFrame>): TakeoverSurfaceFrame => ({
  surfaceId: 'wall', trackId: 't1', source: { kind: 'black' }, level: 1, key: 'wall:1', engagedAtMs: 0, ...patch,
});
const frame = (surfaces: TakeoverSurfaceFrame[], extra: Partial<TakeoverFrame> = {}): TakeoverFrame => ({
  surfaces,
  overlay: null,
  needsVjFeeds: surfaces.some((s) => s.source && s.source.kind.startsWith('vj')),
  ...extra,
});
const feed = (id: string) => layer(id, { opacity: 0.8 });
const sampled = (l: Layer | undefined) => (l?.source as any)?.effectSource?.vjmixRows?.[0]?.layerId ?? null;

describe('buildTakeoverScene', () => {
  it('hands the list back untouched when nothing is taken over', () => {
    const list = [layer('a')];
    expect(buildTakeoverScene(list, null)).toBe(list);
    expect(buildTakeoverScene(list, frame([]))).toBe(list);
  });

  it('puts a copy directly above the surface at the takeover level; the surface stays as the show drives it', () => {
    const wall = layer('wall', { opacity: 1, _showOpacityMul: 0.5, _showParams: { x: 1 }, effects: [{ id: 'own' } as any] });
    const list = [layer('top'), wall, layer('bottom')];
    const out = buildTakeoverScene(list, frame([surface({ level: 0.4 })]))!;
    expect(out.map((l) => l.id)).toEqual(['top', takeoverLayerId('wall'), 'wall', 'bottom']);
    const copy = out[1];
    expect(copy.opacity).toBe(0.4);
    expect(copy._showOpacityMul).toBeUndefined();
    expect(copy._showParams).toBeUndefined();
    expect(copy.effects.map((e) => e.id)).toEqual(['own']);
    expect(copy.source?.shaderCode).toContain('vec4(0.0, 0.0, 0.0, 1.0)');
    expect(out[2]).toBe(wall);
  });

  it('samples a deck row: the feeds come in at opacity 0 and saved row assignments are left out', () => {
    const feeds = [feed('vj-layer-0'), feed('vj-layer-1'), feed('__vj-mix__')];
    const list = [layer('wall'), layer('screen', { vjLayerIndex: 0 }), layer('slice', { vjGroupId: 'g' })];
    const out = buildTakeoverScene(list, frame([surface({ source: { kind: 'vjRow', deck: 'A', row: 1 } })]), { feeds: () => feeds })!;
    expect(out.slice(0, 3).map((l) => [l.id, l.opacity])).toEqual([['vj-layer-0', 0], ['vj-layer-1', 0], ['__vj-mix__', 0]]);
    const copy = out.find((l) => l.id === takeoverLayerId('wall'));
    expect(sampled(copy)).toBe('vj-layer-1');
    expect(copy?.vjLayerIndex).toBeUndefined();
    expect(out.find((l) => l.id === 'screen')?.vjLayerIndex).toBeUndefined();
    expect(out.find((l) => l.id === 'slice')?.vjGroupId).toBeUndefined();
  });

  it('does not touch saved assignments when no feeds are needed', () => {
    const screen = layer('screen', { vjLayerIndex: 0 });
    const out = buildTakeoverScene([layer('wall'), screen], frame([surface({})]))!;
    expect(out.find((l) => l.id === 'screen')).toBe(screen);
  });

  it('picks the deck with the crossfader on, and shows black for an empty row or deck B without it', () => {
    const feeds = [feed('vj-layer-0-A'), feed('vj-layer-0-B'), feed('vj-xfade-0')];
    expect(vjRowFeedId({ deck: 'B', row: 0 }, feeds, true)).toBe('vj-layer-0-B');
    expect(vjRowFeedId({ deck: 'A', row: 3 }, feeds, true)).toBeNull();
    expect(vjRowFeedId({ deck: 'B', row: 0 }, [feed('vj-layer-0')], false)).toBeNull();
    const out = buildTakeoverScene([layer('wall')], frame([surface({ source: { kind: 'vjRow', deck: 'A', row: 3 } })]), { feeds: () => feeds, crossfaderEnabled: true })!;
    expect(out.find((l) => l.id === takeoverLayerId('wall'))?.source?.id).toBe('takeover:black');
  });

  it('samples the mix carrier; a group goes through the core routing by group id', () => {
    const feeds = [feed('vj-layer-0'), feed('__vj-mix__')];
    const out = buildTakeoverScene(
      [layer('a'), layer('b')],
      frame([surface({ surfaceId: 'a', source: { kind: 'vjMix' } }), surface({ surfaceId: 'b', key: 'b:1', source: { kind: 'vjGroup', groupId: 'g1' } })]),
      { feeds: () => feeds },
    )!;
    expect(sampled(out.find((l) => l.id === takeoverLayerId('a')))).toBe('__vj-mix__');
    expect(out.find((l) => l.id === takeoverLayerId('b'))?.vjGroupId).toBe('g1');
  });

  it('waits a sync when the launcher layers are a tick behind', () => {
    expect(buildTakeoverScene([layer('wall')], frame([surface({ source: { kind: 'vjMix' } })]), { feeds: () => null })).toBeNull();
  });

  it('a surface the scene does not have is drawn from its track template, above the stage', () => {
    const tpl = layer('wall', { surfaceId: 'wall', position: { x: 10, y: 20 } });
    const out = buildTakeoverScene([layer('other')], frame([surface({})]), { templateFor: (id) => (id === 'wall' ? tpl : null) })!;
    expect(out.map((l) => l.id)).toEqual([takeoverLayerId('wall'), 'other']);
    expect(out[0].position).toEqual({ x: 10, y: 20 });
  });

  it("an injected show copy counts as the surface", () => {
    const out = buildTakeoverScene([layer('showtrack::wall')], frame([surface({})]))!;
    expect(out.map((l) => l.id)).toEqual([takeoverLayerId('wall'), 'showtrack::wall']);
  });

  it('temporary effects: on the copy, or on the surface itself when there is no source', () => {
    const fx = { id: 'tmp', type: 'invert' } as any;
    let out = buildTakeoverScene([layer('wall')], frame([surface({ effects: [fx] })]))!;
    expect(out[0].effects.map((e) => e.id)).toEqual(['tmp']);
    out = buildTakeoverScene([layer('wall')], frame([surface({ source: null, effects: [fx] })]))!;
    expect(out.map((l) => l.id)).toEqual(['wall']);
    expect(out[0].effects.map((e) => e.id)).toEqual(['tmp']);
  });

  it('a level of 0 leaves the copy out', () => {
    expect(buildTakeoverScene([layer('wall')], frame([surface({ level: 0 })]))!.map((l) => l.id)).toEqual(['wall']);
  });

  it('the overlay goes over everything at its level and blend', () => {
    const feeds = [feed('vj-layer-0'), feed('__vj-mix__')];
    const out = buildTakeoverScene([layer('wall')], frame([], { overlay: { source: { kind: 'vjMix' }, level: 0.3, blend: 'screen' }, needsVjFeeds: true }), { feeds: () => feeds })!;
    expect(out.map((l) => l.id)).toEqual(['vj-layer-0', '__vj-mix__', TAKEOVER_OVERLAY_ID, 'wall']);
    expect(out[2]).toMatchObject({ opacity: 0.3, blendMode: 'screen' });
    expect(sampled(out[2])).toBe('__vj-mix__');
  });

  it('dropped media: one stable source per engage; a video starts at the engage and loops', () => {
    const sources = new TakeoverMediaSources();
    const media = { kind: 'video' as const, name: 'clip.mp4', src: 'file:///clip.mp4', sourceDuration: 4 };
    const s1 = surface({ source: { kind: 'media', media }, engagedAtMs: 1234 });
    const a = sources.sourceFor(s1);
    expect(sources.sourceFor(s1)).toBe(a);
    expect(a).toMatchObject({ type: 'video', isPlaying: true, playbackMode: 'loop', _nativePlaybackTimeSeconds: 0, _nativePlaybackUpdatedAtMs: 1234 });
    const out = buildTakeoverScene([layer('wall')], frame([s1]), { mediaSourceFor: (s) => sources.sourceFor(s) })!;
    expect(out[0].source).toBe(a);
    expect(sources.sourceFor({ ...s1, key: 'wall:2' })).not.toBe(a);
    sources.retain(new Set(['wall:2']));
    expect(sources.sourceFor(s1)).not.toBe(a);
  });
});

describe('capTakeoverScene', () => {
  it('drops takeover copies, the overlay and then the feeds before any show helper', () => {
    const list = [
      feed('vj-layer-0'), layer(TAKEOVER_OVERLAY_ID), layer('takeover::a'), layer('takeover::b'),
      layer('showwarm::w'), layer('showxf::x'), layer('showtrack::t'), layer('stage'),
    ];
    const ids = (n: number) => capTakeoverScene(list, new Set(['vj-layer-0']), n).map((l) => l.id);
    expect(ids(8)).toHaveLength(8);
    expect(ids(7)).toEqual(['vj-layer-0', TAKEOVER_OVERLAY_ID, 'takeover::a', 'showwarm::w', 'showxf::x', 'showtrack::t', 'stage']);
    // With no copy or overlay left, nothing samples the feeds: they go too.
    expect(ids(5)).toEqual(['showwarm::w', 'showxf::x', 'showtrack::t', 'stage']);
    expect(ids(4)).toEqual(['showwarm::w', 'showxf::x', 'showtrack::t', 'stage']);
    expect(ids(2)).toEqual(['showtrack::t', 'stage']);
  });
});
