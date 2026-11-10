/**
 * The Timeline's Looks row: which look blocks are under the playhead and how
 * strongly, and the shapes wearing them in the scene (never the project).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EdgeEffectsConfig, Layer, ShowLookClip } from '../../types';
import { applyShowLooks, evaluateShowLooks, showLooksSignature, _resetShowLookCaches } from './showLooks';
import { evaluateShowTracks } from './showTrackEval';
import { buildShowTrackScene, ShowTrackSceneCache } from './showTrackScene';

const corners = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } };
function shape(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal', source: null, corners, edgeEffects: null, ...extra } as unknown as Layer;
}
function look(id: string, startTime: number, duration: number, extra: Partial<ShowLookClip> = {}): ShowLookClip {
  return { id, startTime, duration, lookId: 'neon-pulse', paletteId: 'neon', scope: 'all', fadeIn: 0, fadeOut: 0, ...extra };
}
const own: EdgeEffectsConfig = {
  enabled: true,
  effects: [{ id: 'own-1', enabled: true, stroke: { type: 'solid' } as any, fill: { type: 'none' } as any, animation: { type: 'none' } as any, blendMode: 'normal', opacity: 1 }],
};

beforeEach(() => _resetShowLookCaches());
afterEach(() => _resetShowLookCaches());

describe('evaluating the Looks row', () => {
  it('gives a block full strength inside its span and nothing outside', () => {
    const clips = [look('a', 2, 4)];
    expect(evaluateShowLooks(clips, 1.99)).toEqual([]);
    expect(evaluateShowLooks(clips, 2).map((l) => [l.clipId, l.weight])).toEqual([['a', 1]]);
    expect(evaluateShowLooks(clips, 5.9)[0].weight).toBe(1);
    expect(evaluateShowLooks(clips, 6)).toEqual([]);
  });

  it('ramps with the fades', () => {
    const clips = [look('a', 0, 10, { fadeIn: 2, fadeOut: 4 })];
    expect(evaluateShowLooks(clips, 1)[0].weight).toBeCloseTo(0.5);
    expect(evaluateShowLooks(clips, 5)[0].weight).toBe(1);
    expect(evaluateShowLooks(clips, 8)[0].weight).toBeCloseTo(0.5);
  });

  it('crossfades over an overlap, and cuts where two blocks only touch', () => {
    const fade = [look('a', 0, 6), look('b', 4, 6, { lookId: 'kick-strobe' })];
    const mid = evaluateShowLooks(fade, 5);
    expect(mid.map((l) => l.clipId)).toEqual(['a', 'b']);
    expect(mid[0].weight).toBeCloseTo(0.5);
    expect(mid[1].weight).toBeCloseTo(0.5);
    expect(evaluateShowLooks(fade, 4.5).map((l) => Number(l.weight.toFixed(2)))).toEqual([0.75, 0.25]);
    const cut = [look('a', 0, 4), look('b', 4, 4)];
    expect(evaluateShowLooks(cut, 3.999).map((l) => l.clipId)).toEqual(['a']);
    expect(evaluateShowLooks(cut, 4).map((l) => l.clipId)).toEqual(['b']);
  });

  it('leaves out a block whose look is not in the catalog', () => {
    expect(evaluateShowLooks([look('a', 0, 4, { lookId: 'no-such-look' })], 1)).toEqual([]);
  });

  it('signs what the scene needs: look, colours, scope and visible strength', () => {
    const a = showLooksSignature(evaluateShowLooks([look('a', 0, 10, { fadeIn: 10 })], 5));
    const b = showLooksSignature(evaluateShowLooks([look('a', 0, 10, { fadeIn: 10 })], 5.0001));
    expect(a).toBe(b);
    expect(showLooksSignature(evaluateShowLooks([look('a', 0, 10, { paletteId: 'ice' })], 5))).not.toBe(showLooksSignature(evaluateShowLooks([look('a', 0, 10)], 5)));
  });
});

describe('the shapes wear the look in the scene', () => {
  const stage = () => [shape('Left', { edgeEffects: own }), shape('Right'), shape('Group', { type: 'group' as Layer['type'], corners: undefined } as any), shape('Kid', { parentGroupId: 'Group' })];

  it('dresses every shape for the block, with ids that stay put, and leaves the project layers alone', () => {
    const live = stage();
    const looks = evaluateShowLooks([look('a', 0, 4)], 1);
    const scene = applyShowLooks(live, looks);
    const left = scene.find((l) => l.id === 'Left')!;
    const right = scene.find((l) => l.id === 'Right')!;
    expect(left.edgeEffects?.look).toEqual({ id: 'neon-pulse', paletteId: 'neon' });
    expect(right.edgeEffects?.look?.id).toBe('neon-pulse');
    expect(left.edgeEffects!.effects.length).toBeGreaterThan(0);
    // Not the group itself; its members are shapes.
    expect(scene.find((l) => l.id === 'Group')!.edgeEffects).toBeNull();
    expect(scene.find((l) => l.id === 'Kid')!.edgeEffects?.look?.id).toBe('neon-pulse');
    // Each shape has its own effect ids, the same on every rebuild.
    const ids = (l: Layer) => l.edgeEffects!.effects.map((e) => e.id);
    expect(ids(left)).not.toEqual(ids(right));
    expect(applyShowLooks(stage(), looks).find((l) => l.id === 'Left')!.edgeEffects).toBe(left.edgeEffects);
    // The project's layers were not written.
    expect(live[0].edgeEffects).toBe(own);
    expect(live[1].edgeEffects).toBeNull();
  });

  it('a block scoped to pieces dresses only those (a group brings its members)', () => {
    const looks = evaluateShowLooks([look('a', 0, 4, { scope: 'pieces', layerIds: ['Right', 'Group'] })], 1);
    const scene = applyShowLooks(stage(), looks);
    expect(scene.find((l) => l.id === 'Left')!.edgeEffects).toBe(own);
    expect(scene.find((l) => l.id === 'Right')!.edgeEffects?.look?.id).toBe('neon-pulse');
    expect(scene.find((l) => l.id === 'Kid')!.edgeEffects?.look?.id).toBe('neon-pulse');
  });

  it('mixes two looks over a crossfade, and lets the shape\'s own effects through a fade', () => {
    const xf = applyShowLooks(stage(), evaluateShowLooks([look('a', 0, 6), look('b', 4, 6, { lookId: 'kick-strobe' })], 5));
    const effects = xf.find((l) => l.id === 'Right')!.edgeEffects!.effects;
    expect(effects.some((e) => e.id.startsWith('showlook:a:'))).toBe(true);
    expect(effects.some((e) => e.id.startsWith('showlook:b:'))).toBe(true);
    const fading = applyShowLooks(stage(), evaluateShowLooks([look('a', 0, 10, { fadeIn: 4 })], 1));
    const leftEffects = fading.find((l) => l.id === 'Left')!.edgeEffects!.effects;
    const ownEffect = leftEffects.find((e) => e.id === 'own-1')!;
    expect(ownEffect.opacity).toBeCloseTo(0.75, 2);
    expect(leftEffects.filter((e) => e.id.startsWith('showlook:')).every((e) => (e.opacity ?? 1) <= 0.26)).toBe(true);
  });

  it('is part of the scene the show builds: on inside the block, gone outside it', () => {
    const lookClips = [look('a', 2, 2)];
    const frameAt = (t: number) => ({ ...evaluateShowTracks([], t, { playing: true, seekGeneration: 1 }), looks: evaluateShowLooks(lookClips, t) });
    const ctx = { sourceFor: () => null };
    const live = stage();
    const inside = buildShowTrackScene(live, frameAt(3), ctx);
    expect(inside.find((l) => l.id === 'Right')!.edgeEffects?.look?.id).toBe('neon-pulse');
    const outside = buildShowTrackScene(live, frameAt(5), ctx);
    expect(outside).toBe(live);
    // The cached scene builder takes a frame with looks and no rows, too.
    const cache = new ShowTrackSceneCache();
    const prepared = cache.prepare(live, frameAt(3), ctx, [live]);
    expect(prepared.build(live.map((l) => ({ ...l }))).find((l) => l.id === 'Left')!.edgeEffects?.look?.id).toBe('neon-pulse');
  });
});
