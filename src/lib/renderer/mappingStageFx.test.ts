/**
 * The native Screen FX driver copied every layer on every frame while an
 * effect ran (and ran the composition engine on the copies) only to read
 * back the multiplier it applied. The values are now worked out without
 * copying or changing any layer; these cases hold them to what the copy
 * route produced.
 */
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer, type MappingCompositionState, type StageEffect } from '../types';

// A deterministic effect: brightness and tint depend only on the screen and the time.
vi.mock('../stores/stageEffects', () => ({
  chaseOrderIndices: (screens: unknown[], order?: string[]) => screens.map((_, i) => (order?.length ? screens.length - 1 - i : i)),
  evaluateStageEffectOutputForScreen: (screenId: string, _effect: unknown, cx: number, cy: number, tSec: number, options: { sliceIndex?: number; sliceCount?: number }) => {
    const n = [...screenId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const brightness = ((n * 0.37 + tSec * 1.3 + cx * 0.5 + cy * 0.25 + (options.sliceIndex ?? 0) * 0.11) % 1.4);
    return { brightness, tint: n % 3 === 0 ? [1, 0.5, 0.25] : null };
  },
}));

const { collectMappingStageFx, forEachMappingStageFx, mappingStageLayers } = await import('./mappingStageFx');

function stage(): Layer[] {
  const layers: Layer[] = [];
  for (let i = 0; i < 9; i++) {
    const layer = createLayer(`Piece ${i}`, { type: 'shader', src: 'x' } as any);
    layer.id = `piece-${i}`;
    layer.opacity = [1, 0.5, 0.8, 0, 1, 0.3, 1, 0.9, 0.6][i];
    layer.corners = { topLeft: { x: i / 10, y: 0.1 }, topRight: { x: i / 10 + 0.1, y: 0.1 }, bottomLeft: { x: i / 10, y: 0.4 }, bottomRight: { x: i / 10 + 0.1, y: 0.4 } } as any;
    layers.push(layer);
  }
  layers[2].visible = false;
  (layers[4] as any).type = 'group';
  layers[5].id = 'vj-layer-1-A';
  layers[7].id = 'piece-6'; // a duplicate id: counted once
  return layers;
}

const effect = { id: 'fx1', type: 'chase', enabled: true, opacity: 1, params: {} } as unknown as StageEffect;
const mc = { enabled: true, stageEffects: [effect], activeStageEffectId: 'fx1' } as unknown as MappingCompositionState;
const deps = (advance = vi.fn()) => ({ timeline: null, advance });

/** The old driver: copy every layer, let the engine modulate the copies in
 *  place, read the multiplier back (copy.opacity / original opacity). */
function viaCopies(layers: Layer[], nowMs: number, d: ReturnType<typeof deps> | { timeline: any; advance: any }) {
  const next = new Map<string, number>();
  const tint = new Map<string, [number, number, number]>();
  const copies = layers.filter((l) => !String(l.id).startsWith('vj-')).map((l) => ({ ...l }) as Layer & { _stageOrigOpacity?: number });
  forEachMappingStageFx(mc, copies, nowMs, d, (layer, brightness, color) => {
    const m = Math.max(0, Math.min(1, brightness));
    if (m < 0.999) {
      const mutable = layer as any;
      if (mutable._stageOrigOpacity === undefined) mutable._stageOrigOpacity = layer.opacity;
      layer.opacity = layer.opacity * m;
    }
    if (color) layer._stageTint = color as any;
  });
  for (const copy of copies) {
    if (copy._stageTint) tint.set(copy.id, copy._stageTint);
    const base = copy._stageOrigOpacity;
    if (base === undefined) continue;
    next.set(copy.id, (next.get(copy.id) ?? 1) * (base > 0 ? copy.opacity / base : 0));
  }
  return { next, tint };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

describe('Screen FX values without copying layers', () => {
  it('match the copy route frame by frame, for the project effect and the Timeline row', () => {
    const timeline = (id: string) => (id.endsWith('1') || id.endsWith('3') ? { brightness: 0.4, tint: [0, 1, 0] as [number, number, number] } : id.endsWith('8') ? { brightness: 1.2, tint: null } : undefined);
    for (const d of [deps(), { timeline, advance: vi.fn() }]) {
      for (let frame = 0; frame < 60; frame++) {
        const now = 1000 + frame * 16.7;
        const layers = stage();
        const expected = viaCopies(layers, now, d);
        const opacity = new Map<string, number>();
        const tint = new Map<string, [number, number, number]>();
        collectMappingStageFx(mc, layers, now, d, opacity, tint);
        expect([...opacity.keys()]).toEqual([...expected.next.keys()]);
        for (const value of opacity.values()) expect(value).toBeLessThan(1);
        for (const [id, value] of expected.next) {
          const base = stage().find((l) => l.id === id)!.opacity;
          // Same picture: the core multiplies the stored opacity by the value.
          expect(base * (opacity.get(id) ?? 1), `${id}@${frame}`).toBeCloseTo(base * value, 12);
        }
        expect(tint).toEqual(expected.tint);
      }
    }
  });

  it('never copies or changes a layer', () => {
    const layers = deepFreeze(stage());
    const seen: Layer[] = [];
    expect(() => forEachMappingStageFx(mc, layers, 5000, deps(), (layer) => { seen.push(layer); })).not.toThrow();
    // The visitor gets the scene's own objects: visible, not a group, not a VJ feed, each id once.
    expect(seen.map((l) => l.id)).toEqual(['piece-0', 'piece-1', 'piece-3', 'piece-6', 'piece-8']);
    for (const layer of seen) expect(layers).toContain(layer);
    expect(mappingStageLayers(layers).map((l) => l.id)).toEqual(seen.map((l) => l.id));
    const opacity = new Map<string, number>();
    collectMappingStageFx(mc, layers, 5000, deps(), opacity, new Map());
    for (const value of opacity.values()) expect(value).toBeLessThan(1);
  });

  it('the Timeline row drives alone: the project cycle waits', () => {
    const advance = vi.fn();
    const opacity = new Map<string, number>();
    collectMappingStageFx(mc, stage(), 1000, { timeline: (id) => (id === 'piece-1' ? { brightness: 0.25, tint: null } : undefined), advance }, opacity, new Map());
    expect(advance).not.toHaveBeenCalled();
    expect([...opacity]).toEqual([['piece-1', 0.25]]);
    collectMappingStageFx(mc, stage(), 1000, deps(advance), new Map(), new Map());
    expect(advance).toHaveBeenCalledTimes(1);
    // Off, or no live effect: nothing.
    const none = new Map<string, number>();
    collectMappingStageFx({ ...mc, enabled: false }, stage(), 1000, deps(), none, new Map());
    collectMappingStageFx({ ...mc, activeStageEffectId: 'gone' }, stage(), 1000, deps(), none, new Map());
    expect(none.size).toBe(0);
  });

  it('Canvas no longer copies layers or logs every 2 s while Screen FX run', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const canvas = readFileSync(fileURLToPath(new URL('../components/Canvas.svelte', import.meta.url)), 'utf8');
    expect(canvas).not.toContain('[StageFX:native]');
    expect(canvas).not.toMatch(/working\.map\(\(layer\) => \(\{ \.\.\.layer \}\)\)/);
    expect(canvas).toContain('collectMappingStageFx(mc, working, engineNowMs(), mappingStageFxDeps(), next, nextTint)');
  });
});
