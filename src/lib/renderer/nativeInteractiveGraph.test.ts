import { describe, it, expect } from 'vitest';
import { buildInteractiveGraph, SHAPE_FLOATS, type InteractiveGraphBuildResult } from './nativeInteractiveGraph';
import { MATTER_COMMON, MATTER_FLUID, MATTER_LIGHT, MATTER_RENDER } from './nativeInteractiveMatter';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { EFFECT_KINDS, advanceInteractiveAuto, makeEffect, type EffectKind } from '../mobile/studio/interactiveEffects';

const audio = { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 };
const build = (scene: InteractiveScene, extra: Record<string, unknown> = {}, frame = 1): InteractiveGraphBuildResult =>
  buildInteractiveGraph({
    kind: 'performer-world', sourceId: 'layer-1', params: { interactiveScene: scene, ...extra },
    width: 1920, height: 1080, time: frame / 60, frameDelta: 1 / 60, frameIndex: frame, audio, state: null, reset: false,
  } as Parameters<typeof buildInteractiveGraph>[0]);
const eight: EffectKind[] = ['fire', 'architecture', 'architecture', 'liquid', 'balls', 'smoke', 'cloud', 'light'];
const stack = (kinds: EffectKind[] = eight): InteractiveScene => ({ ...defaultInteractive(), effects: kinds.map((kind) => makeEffect(kind)) });
const changedValues = (a: InteractiveGraphBuildResult, b: InteractiveGraphBuildResult) => {
  const before = new Map(a.interactive.values.map((v) => [v.id, v.key]));
  return b.interactive.values.filter((v) => before.get(v.id) !== v.key);
};
const bytes = (value: unknown) => JSON.stringify(value).length;
/** What the in-place update of these buffers puts on the wire. */
const updateBytes = (values: { id: string; initial_b64: string }[]) =>
  bytes(values.map((v) => ({ type: 'update_native_graph_buffer', layer_id: 'layer-1', buffer_id: v.id, initial_b64: v.initial_b64 })));
const buffers = (graph: InteractiveGraphBuildResult) => graph.config.buffers as { id: string; byte_length: number; persistent?: boolean; initial_b64?: string }[];
const renders = (graph: InteractiveGraphBuildResult) => graph.config.render_passes as { name: string; clear: boolean; clear_color?: number[] }[];

describe('Interactive graph: structure versus values', () => {
  it('keeps the installed graph when only a value changes, and sends one small buffer', () => {
    const scene = stack();
    const installed = build(scene);
    const light = scene.effects![7];
    const swept = { ...scene, effects: scene.effects!.map((e) => (e === light ? { ...e, params: { ...e.params, lightPower: 0.4 } } : e)) };
    const next = build(swept, {}, 2);
    expect(next.interactive.topology).toBe(installed.interactive.topology);
    const changed = changedValues(installed, next);
    expect(changed.map((v) => v.id)).toEqual([`performer-world:layer-1:${light.id}:interactive:matter`]);
    expect(updateBytes(changed)).toBeLessThan(2500);
    // The whole graph, by contrast: sent on every frame before (and 522 KB
    // then, with a fixed 34 KB surface table per effect).
    expect(bytes(next.config)).toBeGreaterThan(50 * updateBytes(changed));
    expect(bytes(next.config)).toBeLessThan(200_000);
  });

  it('sends nothing when only the clock and the audio moved', () => {
    const scene = stack();
    const a = build(scene, {}, 1);
    const b = buildInteractiveGraph({
      kind: 'performer-world', sourceId: 'layer-1', params: { interactiveScene: scene }, width: 1920, height: 1080,
      time: 99, frameDelta: 0.03, frameIndex: 500, state: null, reset: false,
      audio: { active: true, bass: 0.9, mid: 0.4, treble: 0.2, energy: 0.8, beatPhase: 0.5, beatPulse: 1, amplitude: 0.7 },
    } as Parameters<typeof buildInteractiveGraph>[0]);
    expect(b.interactive.topology).toBe(a.interactive.topology);
    expect(changedValues(a, b)).toEqual([]);
  });

  it('treats Auto playback, a scene-effect slider, touches and a dragged surface as values', () => {
    const scene = stack();
    scene.effects![7].paramAuto = { lightPower: { phase: 0, mode: 'loop', speedHz: 1, min: 0, max: 3, playing: true } };
    const installed = build(scene);
    const auto = build(advanceInteractiveAuto(scene, 0.3, 0));
    expect(auto.interactive.topology).toBe(installed.interactive.topology);
    expect(changedValues(installed, auto)).toHaveLength(1);

    const arch = scene.effects![1];
    const dimmed = build({ ...scene, effects: scene.effects!.map((e) => (e === arch ? { ...e, params: { ...e.params, opacity: 0.25 } } : e)) });
    expect(dimmed.interactive.topology).toBe(installed.interactive.topology);
    expect(changedValues(installed, dimmed).map((v) => v.id)).toEqual([`performer-world:layer-1:${arch.id}:interactive:uniform`]);

    const touched = build(scene, { interactiveInputs: [{ id: 't', point: { x: 0.5, y: 0.5 }, strength: 1, mode: 'attract' }] });
    expect(touched.interactive.topology).toBe(installed.interactive.topology);
    expect(changedValues(installed, touched).every((v) => /:(touches|uniform)$/.test(v.id))).toBe(true);

    const moved = structuredClone(scene);
    moved.surfaces[0].points[0].x += 0.05;
    const dragged = build(moved);
    expect(dragged.interactive.topology).toBe(installed.interactive.topology);
    expect(changedValues(installed, dragged).every((v) => v.id.endsWith(':surfaces'))).toBe(true);
    expect(updateBytes(changedValues(installed, dragged))).toBeLessThan(30_000);

    // Pointing an emitter at a surface changes material flags, not passes.
    const fire = scene.effects![0];
    const attached = build({ ...scene, effects: scene.effects!.map((e) => (e === fire ? { ...e, target: 'stage' } : e)) });
    expect(attached.interactive.topology).toBe(installed.interactive.topology);
    expect(changedValues(installed, attached).map((v) => v.id.split(':').pop()).sort()).toEqual(['matter', 'surfaces']);
  });

  it('reinstalls for anything that changes buffers or passes', () => {
    const scene = stack(['fire', 'architecture']);
    const base = build(scene).interactive.topology;
    const differs = (next: InteractiveScene, extra = {}) => expect(build(next, extra).interactive.topology).not.toBe(base);
    differs({ ...scene, effects: [...scene.effects!, makeEffect('liquid')] });
    differs({ ...scene, effects: scene.effects!.slice(0, 1) });
    differs({ ...scene, effects: [...scene.effects!].reverse() });
    differs({ ...scene, effects: scene.effects!.map((e, i) => (i === 0 ? { ...e, enabled: false } : e)) });
    differs({ ...scene, surfaces: scene.surfaces.slice(0, 1) });
    differs(scene, { interactivePaused: true });
    // Energy on a scene effect is modulated by the core from the installed
    // parameters, so its modulation is part of the structure.
    differs({ ...scene, effects: scene.effects!.map((e, i) => (i === 1 ? { ...e, mods: { energy: { source: 'bass', amount: 0.5, speed: 0.15, invert: false } } } : e)) });
  });

  it('names every effect in the scene so removed ones can be released, and keeps disabled ones', () => {
    const scene = stack(['fire', 'liquid']);
    scene.effects![1].enabled = false;
    const graph = build(scene);
    expect(graph.interactive.effectIds).toEqual(scene.effects!.map((e) => e.id));
    expect(buffers(graph).every((b) => b.id.startsWith(graph.interactive.bufferPrefix(scene.effects![0].id)))).toBe(true);
  });
});

describe('Interactive graph: a layer with real alpha', () => {
  it('clears to transparent exactly once, for every style and for stacks', () => {
    for (const kinds of [...EFFECT_KINDS.map((kind) => [kind]), eight]) {
      const passes = renders(build(stack(kinds)));
      expect(passes.filter((pass) => pass.clear).map((pass) => pass.clear_color)).toEqual([[0, 0, 0, 0]]);
      expect(passes[0].clear).toBe(true);
    }
    const legacy = renders(build({ ...defaultInteractive(), preset: 'liquid' }));
    expect(legacy[0]).toMatchObject({ clear: true, clear_color: [0, 0, 0, 0] });
  });

  it('draws an empty stack as one transparent pass with no simulation', () => {
    const graph = build({ ...defaultInteractive(), effects: [] });
    expect(graph.config.passes).toEqual([]);
    expect(renders(graph)).toHaveLength(1);
    expect(buffers(graph).some((b) => b.persistent)).toBe(false);
    expect(buffers(graph).reduce((sum, b) => sum + b.byte_length, 0)).toBeLessThan(2000);
  });

  it('sizes the surface buffer to the surfaces in use', () => {
    const two = buffers(build(stack(['garden']))).find((b) => b.id.endsWith(':surfaces'))!;
    expect(two.byte_length).toBe(2 * SHAPE_FLOATS * 4);
    const none = buffers(build({ ...stack(['garden']), surfaces: [] })).find((b) => b.id.endsWith(':surfaces'))!;
    expect(none.byte_length).toBe(SHAPE_FLOATS * 4);
  });

  it('outputs premultiplied colour scaled by opacity in the matter shader', () => {
    expect(MATTER_RENDER).toContain('coverage*opacity');
    expect(MATTER_RENDER).not.toMatch(/return vec4<f32>\(pow\(max\(col/);
  });

  it('never raises a possibly negative value to the power of two', () => {
    for (const source of [MATTER_COMMON, MATTER_FLUID, MATTER_LIGHT, MATTER_RENDER]) {
      // pow( <anything up to one level of nested parentheses> , 2.)
      expect(source).not.toMatch(/pow\((?:[^(),]|\([^()]*\))*,\s*2\.?0?\)/);
    }
  });
});
