/**
 * Screen FX, clip transitions and composition crossfades as frame values.
 *
 * Each of these moves every frame while it runs. The scene is now built once
 * (when the effect or transition starts) and the frame sync puts this
 * frame's values on it. A scene built at one moment and moved this way has
 * to be exactly the scene a full build at the later moment gives, and the
 * published scene must never change under it.
 */
import { describe, expect, it } from 'vitest';
import { createLayer, type Layer } from '../types';
import { applyStageFxFrame, NO_STAGE_FX, type StageFxFrameValues } from './stageFxFrame';
import {
  applyCompositionFadeFrame,
  buildCompositionTransitionLayers,
  compositionTransitionSceneKey,
  type ActiveCompositionTransition,
} from './compositionTransitionLayers';
import { applyClipFadeFrame, buildVJClipTransitionLayers, clipFadeProgress, type VJClipTransitionState } from './vjClipTransitionNative';
import { buildVjCrossfadeScene } from './vjCrossfadeScene';
import { buildTakeoverScene } from '../show/takeover/takeoverScene';
import type { ScreenFxOut } from '../timeline/stagefx/stageFxEval';

/** Everything the frame-value tags add, so a moved scene compares with a full build. */
function strip(list: Layer[]): Layer[] {
  return list.map((layer) => {
    const { _compFadeFrame: _c, _clipFadeFrame: _k, ...rest } = layer;
    return rest as Layer;
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

// ── Screen FX ────────────────────────────────────────────────────────────

/** The scene build's old Screen FX step (Canvas.svelte withStageFxOpacity before round 5). */
function oldWithStageFx(
  list: Layer[],
  opacity: Map<string, number>,
  tint: Map<string, [number, number, number]>,
  timeline: ((id: string) => ScreenFxOut | undefined) | null,
): Layer[] {
  if (opacity.size === 0 && tint.size === 0) return list;
  return list.map((layer) => {
    let multiplier = opacity.get(layer.id);
    let t = tint.get(layer.id);
    if (multiplier === undefined && !t && timeline) {
      const out = timeline(layer.id);
      if (out) {
        if (out.brightness < 1) multiplier = Math.max(0, out.brightness);
        if (out.tint) t = out.tint;
      }
    }
    if (multiplier === undefined && !t) return layer;
    const next = multiplier === undefined ? { ...layer } : { ...layer, opacity: layer.opacity * multiplier };
    if (t) next._stageTint = t;
    return next;
  });
}

function piece(id: string, opacity = 1): Layer {
  return { ...createLayer(id, id, 'media'), opacity };
}

describe('Screen FX as frame values', () => {
  const scene = deepFreeze([piece('p1'), piece('p2', 0.5), piece('showtrack::p3', 0.8), piece('p4'), piece('vj-layer-0')]);

  it('gives the scene the old build gave, frame after frame, from one published list', () => {
    const timelineFx = new Map<string, ScreenFxOut>([['p3', { brightness: 0.25, tint: [1, 0, 0] }]]);
    const fallback = (id: string) => timelineFx.get(id) ?? timelineFx.get(id.replace(/^showtrack::/, ''));
    for (let frame = 0; frame < 60; frame++) {
      const opacity = new Map<string, number>([['p1', 0.5 + 0.5 * Math.sin(frame / 7)], ['p2', frame % 2 ? 0 : 0.3]]);
      const tint = new Map<string, [number, number, number]>(frame % 3 ? [['p4', [0, 1, frame / 60]]] : []);
      for (const timeline of [null, fallback]) {
        const values: StageFxFrameValues = { opacity, tint, fallback: timeline };
        expect(applyStageFxFrame(scene, values)).toEqual(oldWithStageFx(scene, opacity, tint, timeline));
      }
    }
  });

  it('leaves the list alone with no Screen FX, and only copies the layers it changes', () => {
    expect(applyStageFxFrame(scene, NO_STAGE_FX)).toBe(scene);
    const out = applyStageFxFrame(scene, { opacity: new Map([['p2', 0.5]]), tint: new Map() });
    expect(out).not.toBe(scene);
    expect(out[1].opacity).toBe(0.25);
    expect(out.filter((layer, i) => layer !== scene[i]).map((l) => l.id)).toEqual(['p2']);
    // Untouched pieces (and the frozen published scene) are as they were.
    expect(scene[1].opacity).toBe(0.5);
  });
});

// ── Composition crossfade ────────────────────────────────────────────────

const A = [piece('a1'), piece('a2', 0.5), { ...piece('shared', 0.7), blendMode: 'screen' as const }];
const B = [piece('b1'), piece('b2', 0.8), piece('shared', 0.9)];
const lookup = (id: string) => (id === 'compA' ? A : id === 'compB' ? B : null);
const xfade = (progress: number, style: ActiveCompositionTransition['style']): ActiveCompositionTransition =>
  ({ style, progress, fromCompositionId: 'compA', toCompositionId: 'compB' });

function buildComp(progress: number, style: ActiveCompositionTransition['style'], active: string, frameWeights: boolean): Layer[] {
  return buildCompositionTransitionLayers({
    liveLayers: active === 'compA' ? A : B,
    activeCompositionId: active,
    transition: xfade(progress, style),
    compositionLayers: lookup,
    frameWeights,
  });
}

describe('composition crossfade as frame values', () => {
  const styles: ActiveCompositionTransition['style'][] = ['dissolve', 'dipToBlack', 'additive'];
  const builtAt = [0, 0.3, 0.5, 0.8];
  const movedTo = [0, 0.1, 0.45, 0.5, 0.55, 0.9, 1];

  for (const style of styles) {
    for (const active of ['compA', 'compB']) {
      it(`${style}, ${active} loaded: a scene built once and weighted per frame equals a full build`, () => {
        for (const p0 of builtAt) {
          const built = deepFreeze(buildComp(p0, style, active, true));
          for (const p1 of movedTo) {
            const moved = applyCompositionFadeFrame(built, xfade(p1, style));
            expect(strip(moved)).toEqual(buildComp(p1, style, active, false));
          }
        }
      });
    }
  }

  it('keeps the ids, order and blends of the full build (only opacity moves)', () => {
    const tagged = buildComp(0.2, 'additive', 'compA', true);
    const full = buildComp(0.7, 'additive', 'compA', false);
    expect(tagged.map((l) => [l.id, l.blendMode])).toEqual(full.map((l) => [l.id, l.blendMode]));
  });

  it('uses the progress it was built at while the store already holds another transition', () => {
    const built = buildComp(0.4, 'dissolve', 'compA', true);
    const other = { ...xfade(0.9, 'dissolve'), toCompositionId: 'compC' };
    expect(strip(applyCompositionFadeFrame(built, other))).toEqual(buildComp(0.4, 'dissolve', 'compA', false));
    expect(strip(applyCompositionFadeFrame(built, null))).toEqual(buildComp(0.4, 'dissolve', 'compA', false));
  });

  it('only the pair and the style rebuild: the scene key ignores progress', () => {
    expect(compositionTransitionSceneKey(xfade(0.1, 'dissolve'))).toBe(compositionTransitionSceneKey(xfade(0.9, 'dissolve')));
    expect(compositionTransitionSceneKey(xfade(0.1, 'dissolve'))).not.toBe(compositionTransitionSceneKey(xfade(0.1, 'additive')));
    expect(compositionTransitionSceneKey(null)).toBe('');
  });

  it('a list with nothing tagged comes back as it is', () => {
    const list = [piece('x')];
    expect(applyCompositionFadeFrame(list, xfade(0.5, 'dissolve'))).toBe(list);
  });

  it('a live takeover over a fading piece keeps its own level', () => {
    const built = buildComp(0.3, 'dissolve', 'compA', true);
    const frame = {
      surfaces: [{ surfaceId: 'a1', level: 0.6, source: { kind: 'black' } }],
      overlay: null,
      needsVjFeeds: false,
    } as unknown as Parameters<typeof buildTakeoverScene>[1];
    const withTakeover = buildTakeoverScene(built, frame, {})!;
    const copy = applyCompositionFadeFrame(withTakeover, xfade(0.8, 'dissolve')).find((l) => l.id !== 'a1' && l.id.includes('a1'));
    expect(copy?.opacity).toBe(0.6);
  });
});

// ── Clip transitions ─────────────────────────────────────────────────────

function row(id: string, opacity = 1): Layer {
  return { ...createLayer(id, id, 'media'), opacity, source: { id: `src:${id}`, type: 'video' as const, src: `${id}.mp4`, name: id } };
}

describe('clip transitions as frame values', () => {
  const startedAtMs = 10_000;
  const durationMs = 2000;
  const fades = (nowMs: number, withClock: boolean) => new Map<string, VJClipTransitionState>([[
    'vj-layer-0',
    {
      outgoing: row('vj-layer-0', 0.9), token: 7, style: 'wipe-left', duration: durationMs / 1000, running: true,
      progress: clipFadeProgress({ startedAtMs, durationMs }, nowMs),
      ...(withClock ? { clock: { startedAtMs, durationMs } } : {}),
    },
  ]]);
  const rows = [row('vj-layer-0', 0.8), row('vj-layer-1')];

  it('a carrier built at one moment and moved per frame equals a full build at that moment', () => {
    for (const builtAt of [startedAtMs, startedAtMs + 300, startedAtMs + 1500]) {
      const built = deepFreeze(buildVJClipTransitionLayers(rows, fades(builtAt, true), true));
      // Until the end: there the transition completes and the scene is built
      // again in its steady shape (vjClipTransitions.complete).
      for (let now = builtAt; now < startedAtMs + durationMs; now += 37) {
        expect(strip(applyClipFadeFrame(built, now))).toEqual(buildVJClipTransitionLayers(rows, fades(now, false), true));
      }
    }
  });

  it('past the end, before the completed scene arrives, the carrier holds the incoming clip', () => {
    const built = buildVJClipTransitionLayers(rows, fades(startedAtMs + 500, true), true);
    for (const now of [startedAtMs + durationMs, startedAtMs + durationMs + 400]) {
      const carrier = applyClipFadeFrame(built, now).find((l) => l._clipFadeFrame)!;
      expect((carrier.source!.effectSource as { vjxfadeMix: number }).vjxfadeMix).toBe(1);
    }
  });

  it('moves the carrier only: the rows around it and their copies with other sources stay', () => {
    const built = buildVJClipTransitionLayers(rows, fades(startedAtMs, true), true);
    const carrier = built.find((l) => l._clipFadeFrame)!;
    // A layer copied from the carrier with its own source (a Performer world) is left alone.
    const copy = { ...carrier, id: 'performer-world-A-0', source: { id: 'w', type: 'effect' as const, src: 'plugin://performer-world', name: 'w', effectSource: { effectType: 'performer-world' } as never } };
    const list = [...built, copy];
    const moved = applyClipFadeFrame(list, startedAtMs + 1000);
    expect(moved.filter((l, i) => l !== list[i]).map((l) => l.id)).toEqual([carrier.id]);
    expect((moved.find((l) => l.id === carrier.id)!.source!.effectSource as { vjxfadeMix: number }).vjxfadeMix).toBeCloseTo(0.5, 6);
    // Same moment as the build: nothing to change.
    expect(applyClipFadeFrame(built, startedAtMs)).toBe(built);
  });

  it('a fade that has not started (waiting for the next clip) carries no clock', () => {
    const waiting = new Map<string, VJClipTransitionState>([[
      'vj-layer-0', { outgoing: row('vj-layer-0'), token: 3, style: 'dissolve', duration: 2, running: false, progress: 0 },
    ]]);
    const built = buildVJClipTransitionLayers(rows, waiting, true);
    expect(built.some((l) => l._clipFadeFrame)).toBe(false);
    expect(applyClipFadeFrame(built, startedAtMs + 5000)).toBe(built);
  });

  it('survives the crossfade scene: the moved scene equals a full build there too', () => {
    const deckRows = [row('vj-layer-0-A', 0.8), row('vj-layer-0-B', 0.6), row('vj-layer-1-A')];
    const deckFades = (nowMs: number, withClock: boolean) => new Map<string, VJClipTransitionState>([[
      'vj-layer-0-A',
      {
        outgoing: row('vj-layer-0-A', 0.5), token: 9, style: 'dissolve', duration: durationMs / 1000, running: true,
        progress: clipFadeProgress({ startedAtMs, durationMs }, nowMs),
        ...(withClock ? { clock: { startedAtMs, durationMs } } : {}),
      },
    ]]);
    const scene = (nowMs: number, withClock: boolean, stageMode: boolean) => buildVjCrossfadeScene({
      vjLayers: buildVJClipTransitionLayers(deckRows, deckFades(nowMs, withClock), true),
      incomingLayers: deckRows,
      state: {
        crossfaderEnabled: true, crossfaderValue: 0.3, crossfaderCurve: 'linear', crossfaderTransition: 'dissolve',
        crossfaderBlendMode: 'normal', stageMode, layerStates: [], bankBLayerStates: [],
      } as never,
      overlays: {} as never,
      groups: [],
      mixEffects: [],
    })!;
    for (const stageMode of [false, true]) {
      const built = deepFreeze(scene(startedAtMs + 100, true, stageMode));
      expect(built.some((l) => l._clipFadeFrame)).toBe(true);
      for (const now of [startedAtMs + 100, startedAtMs + 700, startedAtMs + 1999]) {
        expect(strip(applyClipFadeFrame(built, now))).toEqual(scene(now, false, stageMode));
      }
    }
  });
});
