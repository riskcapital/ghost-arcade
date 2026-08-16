/**
 * Native composition transition — layer materialization.
 *
 * This is the thing that actually makes a transition visible: during the
 * window BOTH compositions' layers are in the scene at once and the core
 * composites them by opacity. Four properties have to hold or the feature is
 * either invisible or actively worse than a cut:
 *
 *  1. ENDPOINTS ARE EXACT. progress 0 must be pure outgoing and progress 1
 *     pure incoming, or every boundary gets a visible pop.
 *  2. THE SCENE IS STABLE ACROSS THE MIDPOINT. The composition swap happens
 *     halfway through a centred window; if the set of scene layer ids
 *     changed there, video and shader sources would re-warm while they are
 *     on screen.
 *  3. IT NEVER OVERRUNS THE CORE. MAX_SCENE_LAYERS is 64 and the core
 *     silently truncates past it — the builder has to refuse instead.
 *  4. IT IS A PURE FUNCTION OF PROGRESS. Same progress in, same opacities
 *     out, so a cold seek and an offline render agree with playback.
 */

import { describe, expect, it } from 'vitest';
import type { Layer } from '../types';
import {
  buildCompositionTransitionLayers,
  compositionTransitionWeights,
  MAX_TRANSITION_LAYERS,
  TRANSITION_LAYER_PREFIX,
  type ActiveCompositionTransition,
} from './compositionTransitionLayers';

function layer(id: string, opacity = 1, extra: Partial<Layer> = {}): Layer {
  return { id, opacity, blendMode: 'normal', visible: true, ...extra } as Layer;
}

const A_LAYERS = [layer('a1'), layer('a2', 0.5)];
const B_LAYERS = [layer('b1'), layer('b2', 0.8)];

function xfade(progress: number, style: ActiveCompositionTransition['style'] = 'dissolve'): ActiveCompositionTransition {
  return { style, progress, fromCompositionId: 'compA', toCompositionId: 'compB' };
}

/** Stand-in for `compositions.find(...)?.layers`. */
const lookup = (id: string): Layer[] | null =>
  id === 'compA' ? A_LAYERS : id === 'compB' ? B_LAYERS : null;

function build(args: {
  live: Layer[];
  active: string | null;
  transition: ActiveCompositionTransition | null;
  maxLayers?: number;
}) {
  return buildCompositionTransitionLayers({
    liveLayers: args.live,
    activeCompositionId: args.active,
    transition: args.transition,
    compositionLayers: lookup,
    maxLayers: args.maxLayers,
  });
}

describe('compositionTransitionWeights', () => {
  it('dissolve is constant power and exact at both ends', () => {
    expect(compositionTransitionWeights('dissolve', 0)).toMatchObject({ outgoing: 1, incoming: 0 });
    const mid = compositionTransitionWeights('dissolve', 0.5);
    expect(mid.outgoing).toBeCloseTo(Math.SQRT1_2, 9);
    expect(mid.incoming).toBeCloseTo(Math.SQRT1_2, 9);
    const end = compositionTransitionWeights('dissolve', 1);
    expect(end.outgoing).toBeCloseTo(0, 9);
    expect(end.incoming).toBeCloseTo(1, 9);
  });

  it('dipToBlack really does reach black at the midpoint', () => {
    const mid = compositionTransitionWeights('dipToBlack', 0.5);
    expect(mid.outgoing).toBe(0);
    expect(mid.incoming).toBe(0);
    expect(compositionTransitionWeights('dipToBlack', 0.25).outgoing).toBe(0.5);
    expect(compositionTransitionWeights('dipToBlack', 0.75).incoming).toBe(0.5);
  });

  it('additive puts the incoming stack on top with an add blend', () => {
    const w = compositionTransitionWeights('additive', 0.5);
    expect(w.incomingOnTop).toBe(true);
    expect(w.incomingBlend).toBe('add');
    expect(w.outgoing).toBe(0.5);
    expect(w.incoming).toBe(0.5);
  });

  it('clamps junk progress instead of producing negative opacity', () => {
    expect(compositionTransitionWeights('dissolve', -3).outgoing).toBe(1);
    expect(compositionTransitionWeights('dissolve', 9).incoming).toBeCloseTo(1, 9);
    expect(compositionTransitionWeights('dissolve', Number.NaN).outgoing).toBe(1);
  });

  it('is pure — the same progress always yields the same weights', () => {
    expect(compositionTransitionWeights('dissolve', 0.371))
      .toEqual(compositionTransitionWeights('dissolve', 0.371));
  });
});

describe('buildCompositionTransitionLayers', () => {
  it('hands the live stack straight back when nothing is transitioning', () => {
    const out = build({ live: A_LAYERS, active: 'compA', transition: null });
    expect(out).toBe(A_LAYERS);
  });

  it('puts BOTH stacks in the scene, outgoing on top', () => {
    const out = build({ live: A_LAYERS, active: 'compA', transition: xfade(0.5) });
    // index 0 is topmost — the native sync sends z_index = index and the core
    // blends the largest z first.
    expect(out.map((l) => l.id)).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('endpoints are exact — no pop at either edge of the window', () => {
    const open = build({ live: A_LAYERS, active: 'compA', transition: xfade(0) });
    expect(open.find((l) => l.id === 'a1')!.opacity).toBe(1);
    expect(open.find((l) => l.id === 'b1')!.opacity).toBe(0);

    const close = build({ live: B_LAYERS, active: 'compB', transition: xfade(1) });
    expect(close.find((l) => l.id === 'a1')!.opacity).toBeCloseTo(0, 9);
    expect(close.find((l) => l.id === 'b1')!.opacity).toBeCloseTo(1, 9);
  });

  it('multiplies into each layer\'s OWN opacity rather than overwriting it', () => {
    const out = build({ live: A_LAYERS, active: 'compA', transition: xfade(0.5) });
    // a2 sits at 0.5 in its composition; the blend scales it, it does not
    // promote it to full.
    expect(out.find((l) => l.id === 'a2')!.opacity).toBeCloseTo(0.5 * Math.SQRT1_2, 9);
    expect(out.find((l) => l.id === 'b2')!.opacity).toBeCloseTo(0.8 * Math.SQRT1_2, 9);
  });

  it('never mutates the stored composition layers', () => {
    build({ live: A_LAYERS, active: 'compA', transition: xfade(0.5) });
    expect(A_LAYERS.map((l) => l.opacity)).toEqual([1, 0.5]);
    expect(B_LAYERS.map((l) => l.opacity)).toEqual([1, 0.8]);
  });

  it('THE MIDPOINT SWAP: the same scene, before and after loadComposition', () => {
    // Just before the boundary the outgoing composition is the loaded one;
    // just after, the incoming is. Both must produce the identical set of
    // scene layer ids in the identical order, or the core sees an add/remove
    // storm at the exact moment both pictures are on screen.
    const before = build({ live: A_LAYERS, active: 'compA', transition: xfade(0.4999) });
    const after = build({ live: B_LAYERS, active: 'compB', transition: xfade(0.5001) });
    expect(before.map((l) => l.id)).toEqual(after.map((l) => l.id));
    for (let i = 0; i < before.length; i++) {
      expect(after[i].opacity).toBeCloseTo(before[i].opacity, 3);
    }
  });

  it('additive reverses the order and overrides only the incoming blend', () => {
    const out = build({ live: A_LAYERS, active: 'compA', transition: xfade(0.5, 'additive') });
    expect(out.map((l) => l.id)).toEqual(['b1', 'b2', 'a1', 'a2']);
    expect(out.find((l) => l.id === 'b1')!.blendMode).toBe('add');
    expect(out.find((l) => l.id === 'a1')!.blendMode).toBe('normal');
  });

  it('namespaces the clone only when the two stacks share layer ids', () => {
    // No collision: ids pass through untouched, which is what keeps the
    // scene stable across the midpoint swap.
    const clean = build({ live: A_LAYERS, active: 'compA', transition: xfade(0.5) });
    expect(clean.some((l) => l.id.startsWith(TRANSITION_LAYER_PREFIX))).toBe(false);

    // Collision (a save-as copy keeps its layer ids): the cloned side is
    // renamed wholesale so nothing overwrites its twin.
    const collidingLookup = (id: string) => (id === 'compB' ? A_LAYERS : null);
    const out = buildCompositionTransitionLayers({
      liveLayers: A_LAYERS,
      activeCompositionId: 'compA',
      transition: xfade(0.5),
      compositionLayers: collidingLookup,
    });
    expect(out.map((l) => l.id)).toEqual([
      'a1', 'a2', `${TRANSITION_LAYER_PREFIX}a1`, `${TRANSITION_LAYER_PREFIX}a2`,
    ]);
  });

  it('rewrites parentGroupId when it namespaces, so groups stay intact', () => {
    const grouped = [
      layer('g', 1, { type: 'group' } as Partial<Layer>),
      layer('gc', 1, { parentGroupId: 'g' } as Partial<Layer>),
    ];
    const out = buildCompositionTransitionLayers({
      liveLayers: grouped,
      activeCompositionId: 'compA',
      transition: xfade(0.5),
      compositionLayers: () => grouped,
    });
    const clone = out.filter((l) => l.id.startsWith(TRANSITION_LAYER_PREFIX));
    expect(clone.map((l) => l.id)).toEqual([`${TRANSITION_LAYER_PREFIX}g`, `${TRANSITION_LAYER_PREFIX}gc`]);
    expect((clone[1] as { parentGroupId?: string }).parentGroupId).toBe(`${TRANSITION_LAYER_PREFIX}g`);
  });

  it('refuses rather than letting the core silently truncate the scene', () => {
    const big = Array.from({ length: 40 }, (_, i) => layer(`x${i}`));
    const out = buildCompositionTransitionLayers({
      liveLayers: big,
      activeCompositionId: 'compA',
      transition: xfade(0.5),
      compositionLayers: () => Array.from({ length: 40 }, (_, i) => layer(`y${i}`)),
    });
    expect(out).toBe(big); // hard cut
    expect(80).toBeGreaterThan(MAX_TRANSITION_LAYERS);
  });

  it('allows a doubled stack that still fits under the ceiling', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => layer(`x${i}`));
    const out = buildCompositionTransitionLayers({
      liveLayers: thirty,
      activeCompositionId: 'compA',
      transition: xfade(0.5),
      compositionLayers: () => Array.from({ length: 30 }, (_, i) => layer(`y${i}`)),
    });
    expect(out).toHaveLength(60);
  });

  it('hard-cuts when a side is missing, empty, or the same composition', () => {
    expect(build({ live: A_LAYERS, active: 'compA', transition: { ...xfade(0.5), toCompositionId: 'gone' } }))
      .toBe(A_LAYERS);
    expect(build({ live: A_LAYERS, active: 'compA', transition: { ...xfade(0.5), toCompositionId: 'compA' } }))
      .toBe(A_LAYERS);
    expect(buildCompositionTransitionLayers({
      liveLayers: A_LAYERS,
      activeCompositionId: 'compA',
      transition: xfade(0.5),
      compositionLayers: () => [],
    })).toBe(A_LAYERS);
  });

  it('hard-cuts when the operator punched in a THIRD composition mid-blend', () => {
    // Neither side of the resolved transition is what is actually loaded, so
    // blending them would be a lie about what is on screen.
    expect(build({ live: A_LAYERS, active: 'compZ', transition: xfade(0.5) })).toBe(A_LAYERS);
  });
});
