import { describe, expect, it } from 'vitest';
import { buildInteractiveGraph, type InteractiveGraphBuildResult } from './nativeInteractiveGraph';
import { defaultInteractive, type InteractiveScene } from '../mobile/studio/interactive';
import { makeEffect } from '../mobile/studio/interactiveEffects';
import { defaultReliefWorld, type ReliefWorld } from '../scene3d/worldModel';
import { SCENE3D_FRAME_BUFFER_SUFFIX } from './scene3dFrame';

const audio = { active: false, bass: 0, mid: 0, treble: 0, energy: 0, beatPhase: 0, beatPulse: 0, amplitude: 0 };
const build = (scene: InteractiveScene): InteractiveGraphBuildResult =>
  buildInteractiveGraph({
    kind: 'performer-world', sourceId: 'layer-1', params: { interactiveScene: scene },
    width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 1, audio, state: null, reset: false,
  } as Parameters<typeof buildInteractiveGraph>[0]);
type Binding = { binding: number; kind: string; resource?: string; texture?: string };
type Render = { name: string; target: string; texture?: string; clear: boolean; shader_id: string; fragment_entry: string; blend?: string; bindings: Binding[] };
type Pass = { name: string; bindings: Binding[] };
const renders = (g: InteractiveGraphBuildResult) => g.config.render_passes as unknown as Render[];
const block = { id: 'b', name: 'Block', behavior: 'solid' as const, points: [{ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 0.7 }, { x: 0.3, y: 0.7 }], height: 0.4 };
const effects = [makeEffect('architecture'), makeEffect('fire')];
const scene = (world: Partial<ReliefWorld> | null = {}, surfaces = [block]): InteractiveScene => ({
  ...defaultInteractive(),
  surfaces,
  effects,
  ...(world ? { world: { ...defaultReliefWorld(), ...world } } : {}),
});
const is2d = (r: Render) => r.name.startsWith('interactive-');

describe('the 3D world in an Interactive layer', () => {
  it('leaves a scene without a world exactly as it was', () => {
    const g = build(scene(null));
    expect('textures' in g.config).toBe(false);
    expect(renders(g).every((r) => r.target === 'source_frame')).toBe(true);
    expect(g.interactive.topology.includes('scene3d')).toBe(false);
    expect(build(scene({ enabled: false })).config).toEqual(g.config);
  });

  it('throws the effects onto the relief as light (Projected)', () => {
    const g = build(scene({ flat: 'projected' }));
    const r = renders(g);
    const flat = (g.config as unknown as { textures: { id: string; width: number; height: number }[] }).textures[0];
    expect(flat).toMatchObject({ id: 'scene3d:layer-1:flat', width: 1920, height: 1080 });
    const flatPasses = r.filter(is2d);
    expect(flatPasses.length).toBeGreaterThan(1);
    // The effects draw first, into the flat picture, cleared once.
    expect(r.slice(0, flatPasses.length)).toEqual(flatPasses);
    expect(flatPasses.every((p) => p.target === 'texture' && p.texture === flat.id && !('source_id' in p))).toBe(true);
    expect(flatPasses.map((p) => p.clear)).toEqual(flatPasses.map((_, i) => i === 0));
    // The lit pass reads it; the world's composite is the one pass on the output, and clears it.
    const opaque = r.find((p) => p.name === 'opaque')!;
    expect([opaque.shader_id, opaque.fragment_entry]).toEqual(['scene3d/relief', 'fs_relief_wet']);
    expect(opaque.bindings.find((b) => b.binding === 11)).toMatchObject({ kind: 'graph-texture', texture: flat.id });
    const out = r.filter((p) => p.target === 'source_frame');
    expect(out.map((p) => [p.name, p.clear])).toEqual([['composite', true]]);
    expect(r[r.length - 1].name).toBe('composite');
  });

  it('draws the effects over the world (Over), and leaves them out (Off)', () => {
    const over = renders(build(scene({ flat: 'over' })));
    const first2d = over.findIndex(is2d);
    expect(over[first2d - 1].name).toBe('composite');
    expect(over.filter((p) => p.target === 'source_frame' && p.clear).map((p) => p.name)).toEqual(['composite']);
    const opaque = over.find((p) => p.name === 'opaque')!;
    expect(opaque.fragment_entry).toBe('fs_wet');
    expect(opaque.bindings.some((b) => b.binding === 11)).toBe(false);
    const off = build(scene({ flat: 'off' }));
    expect(renders(off).some(is2d)).toBe(false);
    expect((off.config.passes as unknown as Pass[]).some((p) => p.name.startsWith('interactive'))).toBe(false);
  });

  it('declares one frame block the core fills, and keeps the world’s buffers its own', () => {
    const g = build(scene());
    const ids = (g.config.buffers as { id: string }[]).map((b) => b.id);
    const frames = ids.filter((id) => id.endsWith(SCENE3D_FRAME_BUFFER_SUFFIX));
    expect(frames).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith('scene3d:')).length).toBeGreaterThan(5);
    // The 2D effects' buffers never take the world's prefix.
    expect(ids.filter((id) => !id.startsWith('scene3d:')).every((id) => id.startsWith('performer-world:'))).toBe(true);
    expect(g.interactive.values.some((v) => frames.includes(v.id))).toBe(false);
  });

  it('binds at most eight storage buffers in any pass', () => {
    const g = build(scene());
    for (const p of [...(g.config.passes as unknown as Pass[]), ...renders(g)]) {
      expect(p.bindings.filter((b) => b.kind === 'storage' || b.kind === 'read-only-storage').length, p.name).toBeLessThanOrEqual(8);
    }
  });

  it('treats the sun and a block’s depth as values, a new block as structure', () => {
    const a = build(scene());
    const sun = build(scene({ sun: { ...defaultReliefWorld().sun, color: '#ff0000' } }));
    expect(sun.interactive.topology).toBe(a.interactive.topology);
    const deeper = build(scene({}, [{ ...block, height: 0.8 }]));
    expect(deeper.interactive.topology).toBe(a.interactive.topology);
    const before = new Map(a.interactive.values.map((v) => [v.id, v.key]));
    expect(deeper.interactive.values.filter((v) => before.get(v.id) !== v.key).map((v) => v.id.split(':').pop())).toContain('vertices');
    const more = build(scene({}, [block, { ...block, id: 'c', points: block.points.map((p) => ({ x: p.x * 0.5, y: p.y })) }]));
    expect(more.interactive.topology).not.toBe(a.interactive.topology);
  });

  it('simulates balls before drawing them, and casts their shadows into the shadow map', () => {
    const balls = makeEffect('balls3d');
    const g = build({ ...scene(), effects: [balls, ...effects] });
    const names = (g.config.passes as unknown as Pass[]).map((p) => p.name);
    expect(names.indexOf('balls-life')).toBeGreaterThan(names.indexOf('frame'));
    expect(names.filter((n) => n.startsWith('balls-step'))).toHaveLength(4);
    const r = renders(g).map((p) => p.name);
    expect(r.indexOf('ball-shadows')).toBe(r.indexOf('shadow') + 1);
    expect(r.indexOf('balls')).toBe(r.indexOf('opaque') + 1);
    // The shadow map is drawn into there, so it is not also read.
    expect(renders(g).find((p) => p.name === 'ball-shadows')!.bindings.some((b) => b.binding === 5)).toBe(false);
    // The 2D builder leaves the world's elements alone.
    expect(renders(g).filter(is2d).length).toBe(renders(build(scene())).filter(is2d).length);
  });

  it('treats a throw, a ball param and switching balls off as values, a new balls effect as structure', () => {
    const balls = makeEffect('balls3d');
    const base = { ...scene(), effects: [balls, ...effects] };
    const a = build(base);
    const withInput = buildInteractiveGraph({
      kind: 'performer-world', sourceId: 'layer-1',
      params: { interactiveScene: base, interactiveWorld: { pointers: [], throws: [{ point: { x: 0.5, y: 0.2 }, velocity: { x: 0, y: 0 }, number: 3, at: 0 }] } },
      width: 1920, height: 1080, time: 0, frameDelta: 1 / 60, frameIndex: 1, audio, state: null, reset: false,
    } as Parameters<typeof buildInteractiveGraph>[0]);
    expect(withInput.interactive.topology).toBe(a.interactive.topology);
    const changed = (g: InteractiveGraphBuildResult) => {
      const before = new Map(a.interactive.values.map((v) => [v.id, v.key]));
      return g.interactive.values.filter((v) => before.get(v.id) !== v.key).map((v) => v.id.split(':').pop());
    };
    expect(changed(withInput)).toEqual(['ball-input']);
    const bigger = build({ ...base, effects: [{ ...balls, params: { ...balls.params, size: 0.9 } }, ...effects] });
    expect(bigger.interactive.topology).toBe(a.interactive.topology);
    expect(changed(bigger)).toContain('ball-kinds');
    const off = build({ ...base, effects: [{ ...balls, enabled: false }, ...effects] });
    expect(off.interactive.topology).toBe(a.interactive.topology);
    const two = build({ ...base, effects: [balls, { ...makeEffect('balls3d') }, ...effects] });
    expect(two.interactive.topology).not.toBe(a.interactive.topology);
  });

  it('keeps the paint on the world: the wet map fades, then the drops paint it, before the surfaces read it', () => {
    const drips = { ...makeEffect('drips'), target: 'b' };
    const g = build({ ...scene(), effects: [drips, ...effects] });
    const r = renders(g);
    const names = r.map((p) => p.name);
    const opaque = names.indexOf('opaque');
    expect(names.slice(opaque - 4, opaque)).toEqual(['wet-fade', 'gloss-fade', 'wet-splat', 'gloss-splat']);
    expect(r.find((p) => p.name === 'wet-fade')!.blend).toBe('alpha');
    expect(r.find((p) => p.name === 'gloss-splat')!.blend).toBe('add');
    const stain = r.find((p) => p.name === 'wet-splat')!.texture!;
    expect(r[opaque].bindings.find((b) => b.binding === 19)).toMatchObject({ texture: stain });
    expect(names.indexOf('drips')).toBe(names.indexOf('balls') + 1);
    expect((g.config.passes as unknown as Pass[]).map((p) => p.name)).toContain('drips');
  });

  it('drips from the upper edges of the block it is on', async () => {
    const { dripSites } = await import('./scene3dWorld');
    const { reliefFrame } = await import('../scene3d/relief');
    const s = scene();
    const frame = reliefFrame(16 / 9, s.world!.lens);
    const sites = dripSites(s, s.world!, frame, 'b');
    // A rectangle has one upper edge: its top, which is the highest in the world (y up).
    expect(sites).toHaveLength(1);
    expect(sites[0].a.y).toBeCloseTo(sites[0].b.y, 9);
    const tri = { ...block, id: 't', points: [{ x: 0.5, y: 0.2 }, { x: 0.7, y: 0.6 }, { x: 0.3, y: 0.6 }] };
    expect(dripSites({ ...s, surfaces: [tri] }, s.world!, frame, 't')).toHaveLength(2);
    expect(dripSites(s, s.world!, frame, 'nothing')).toEqual([]);
  });
});
