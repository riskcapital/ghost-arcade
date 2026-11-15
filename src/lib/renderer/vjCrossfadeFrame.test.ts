/**
 * The A/B crossfader as a per-frame value: a VJ scene built at one fader
 * position and moved to another by the frame sync (applyCrossfadeFrame) is
 * exactly the scene a full build at the new position gives, while the fader
 * stays inside one step. So a moving fader needs no scene rebuild.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Composition, Layer } from '../types';

let createLayer: typeof import('../types').createLayer;
let frame: typeof import('./vjCrossfadeFrame');
let scene: typeof import('./vjCrossfadeScene');
let transitions: typeof import('./vjClipTransitionNative');
let maps: typeof import('./mapPresetLayers');

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { style: { setProperty: () => {} } } } });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) },
  });
  ({ createLayer } = await import('../types'));
  frame = await import('./vjCrossfadeFrame');
  scene = await import('./vjCrossfadeScene');
  transitions = await import('./vjClipTransitionNative');
  maps = await import('./mapPresetLayers');
});

type Curve = 'linear' | 'constant-power' | 'sharp-cut';

function row(id: string, opacity: number, blendMode: Layer['blendMode'] = 'normal'): Layer {
  const layer = createLayer(id, id, 'media');
  return {
    ...layer, visible: true, opacity, blendMode,
    source: { id: `${id}-clip`, type: 'shader', name: id, src: id, shaderCode: 'void main(){}', shaderValues: {} } as any,
  };
}

const clipRow = (on: boolean) => ({ activeClip: on ? { id: 'c', type: 'shader' } : null, mute: false, solo: false, opacity: 1 }) as any;

/** A launcher state with the rows each deck plays. */
function state(value: number, curve: Curve, rowsA: number[], rowsB: number[], extra: Record<string, unknown> = {}) {
  const rows = (on: number[]) => [0, 1, 2, 3].map((i) => clipRow(on.includes(i)));
  return {
    crossfaderEnabled: true, crossfaderValue: value, crossfaderCurve: curve,
    crossfaderTransition: 'wipe-left', crossfaderBlendMode: 'screen',
    stageMode: false, layerStates: rows(rowsA), bankBLayerStates: rows(rowsB), ...extra,
  } as any;
}

const overlays = (deck: 'A' | 'B' | null) => ({
  A: deck === 'A' ? { deck: 'A', layerIndex: 0, enabled: true, worldIndex: 1, spaceIndex: 0, x: 0.5, y: 0.5, pointerDown: false, params: {}, pump: 0 } : null,
  B: deck === 'B' ? { deck: 'B', layerIndex: 1, enabled: true, worldIndex: 2, spaceIndex: 0, x: 0.4, y: 0.6, pointerDown: false, params: {}, pump: 0 } : null,
}) as any;

/** The scene Canvas builds for the VJ rows at this launcher state. */
function build(incoming: Layer[], st: any, world: 'A' | 'B' | null = null): Layer[] {
  const vjLayers = transitions.buildVJClipTransitionLayers(incoming, new Map(), true);
  return scene.buildVjCrossfadeScene({ vjLayers, incomingLayers: incoming, state: st, overlays: overlays(world), groups: [], mixEffects: [] })!;
}

const CASES: Array<{ name: string; incoming: () => Layer[]; rowsA: number[]; rowsB: number[]; extra?: Record<string, unknown>; world?: 'A' | 'B' }> = [
  { name: 'both decks playing (deck mix)', incoming: () => [row('vj-layer-0-A', 0.9), row('vj-layer-1-B', 0.7, 'add')], rowsA: [0], rowsB: [1] },
  { name: 'only deck A playing, with a Performer world', incoming: () => [row('vj-layer-0-A', 0.8), row('vj-layer-2-A', 0.6, 'screen')], rowsA: [0, 2], rowsB: [], world: 'A' },
  { name: 'only deck B playing, with a Performer world', incoming: () => [row('vj-layer-1-B', 0.5)], rowsA: [], rowsB: [1], world: 'B' },
  { name: 'Stage: a paired row and a single row', incoming: () => [row('vj-layer-0-A', 1), row('vj-layer-0-B', 0.8, 'multiply'), row('vj-layer-1-B', 0.65)], rowsA: [0], rowsB: [0, 1], extra: { stageMode: true } },
];

/** Positions inside one step each: below the middle, and above it. */
const STEPS: Array<[number, number[]]> = [
  [0.1, [0.02, 0.2, 0.33, 0.49]],
  [0.6, [0.51, 0.7, 0.85, 0.98]],
];

describe('A/B crossfader: a built scene follows the fader per frame', () => {
  for (const curve of ['constant-power', 'linear', 'sharp-cut'] as Curve[]) {
    for (const c of CASES) {
      it(`${c.name}, ${curve}: moved values equal a full build`, () => {
        for (const [from, tos] of STEPS) {
          const st = (v: number) => state(v, curve, c.rowsA, c.rowsB, c.extra);
          const built = build(c.incoming(), st(from), c.world);
          // Something follows the fader in every case.
          expect(built.some((l) => l._xfadeFrame)).toBe(true);
          // At the position it was built at, nothing changes.
          expect(frame.applyCrossfadeFrame(built, st(from))).toBe(built);
          for (const to of tos) {
            if (frame.crossfadeSceneStep(st(to)) !== frame.crossfadeSceneStep(st(from))) continue;
            const moved = frame.applyCrossfadeFrame(built, st(to));
            expect(moved).toEqual(build(c.incoming(), st(to), c.world));
            // Only the layers that follow the fader are new objects.
            moved.forEach((layer, i) => { if (!built[i]._xfadeFrame) expect(layer).toBe(built[i]); });
          }
        }
      });
    }
  }

  it('the per-frame values do change with the fader (not a no-op)', () => {
    const c = CASES[1];
    const st = (v: number) => state(v, 'constant-power', c.rowsA, c.rowsB);
    const built = build(c.incoming(), st(0.6));
    const mix = (list: Layer[]) => (list.find((l) => l.id === '__vj-mix__')!.source!.effectSource as any).vjmixRows.map((r: any) => r.opacity);
    expect(mix(frame.applyCrossfadeFrame(built, st(0.9)))).not.toEqual(mix(built));
    const deck = build(CASES[0].incoming(), state(0.6, 'linear', [0], [1]));
    const xfade = frame.applyCrossfadeFrame(deck, state(0.8, 'linear', [0], [1])).find((l) => l.id === '__vj-deck-xfade__')!;
    expect((xfade.source!.effectSource as any).vjxfadeMix).toBeCloseTo(0.8);
  });

  it('crossing the middle, or reaching an end where a deck goes silent, is a new step', () => {
    const st = (v: number, curve: Curve = 'linear') => state(v, curve, [0], [1]);
    expect(frame.crossfadeSceneStep(st(0.3))).toBe(frame.crossfadeSceneStep(st(0.45)));
    expect(frame.crossfadeSceneStep(st(0.45))).not.toBe(frame.crossfadeSceneStep(st(0.55)));
    expect(frame.crossfadeSceneStep(st(0))).not.toBe(frame.crossfadeSceneStep(st(0.1)));
    expect(frame.crossfadeSceneStep(st(1))).not.toBe(frame.crossfadeSceneStep(st(0.9)));
    expect(frame.crossfadeSceneStep({ crossfaderEnabled: false, crossfaderValue: 0.3 })).toBe('off');
    // With the fader off nothing is tagged and nothing moves.
    const off = build(CASES[1].incoming(), { ...st(0.4), crossfaderEnabled: false });
    expect(off.some((l) => l._xfadeFrame)).toBe(false);
    expect(frame.applyCrossfadeFrame(off, st(0.9))).toBe(off);
  });

  it('a layer hidden under the mix keeps no opacity tag (it stays at 0)', () => {
    const built = build(CASES[1].incoming(), state(0.3, 'linear', [0, 2], []), 'A');
    const moved = frame.applyCrossfadeFrame(built, state(0.4, 'linear', [0, 2], []));
    for (const layer of moved) if (layer.id !== '__vj-mix__') expect(layer.opacity).toBe(0);
  });
});

describe('A/B crossfader in MAP: preset rows follow the fader per frame', () => {
  function composition(id: string): Composition {
    const a = createLayer(`${id}-l1`, 'One', 'media');
    const b = createLayer(`${id}-l2`, 'Two', 'media');
    return { id, name: id, layers: [a, b] } as unknown as Composition;
  }
  let comps: Composition[];
  beforeAll(() => { comps = [composition('p1'), composition('p2')]; });
  const presetRow = (presetId: string, opacity: number) => ({ activeClip: { id: `clip-${presetId}`, type: 'preset', presetId }, mute: false, solo: false, opacity, blendMode: 'normal', effects: [] }) as any;
  const st = (v: number, curve: Curve) => ({
    crossfaderEnabled: true, crossfaderValue: v, crossfaderCurve: curve, masterOpacity: 0.9,
    layerStates: [presetRow('p1', 0.8)], bankBLayerStates: [presetRow('p2', 0.7)],
  }) as any;
  const sequencer = { isPlaying: true, opacityOverrides: { 0: 0.75 }, bankBOpacityOverrides: {} } as any;
  const buildMap = (v: number, curve: Curve) => maps.buildMapPresetLayers(
    maps.mapPresetRows(st(v, curve), comps, sequencer, frame.crossfadeWeights(st(v, curve))),
    { liveLayers: [], surfaces: [], cache: new Map() },
  );

  for (const curve of ['constant-power', 'linear', 'sharp-cut'] as Curve[]) {
    it(`${curve}: moved group opacities equal a full build`, () => {
      for (const [from, tos] of STEPS) {
        const built = buildMap(from, curve);
        expect(built.filter((l) => l._xfadeFrame?.opacity)).toHaveLength(2);
        for (const to of tos) {
          if (frame.crossfadeSceneStep(st(to, curve)) !== frame.crossfadeSceneStep(st(from, curve))) continue;
          expect(frame.applyCrossfadeFrame(built, st(to, curve))).toEqual(buildMap(to, curve));
        }
      }
    });
  }
});
