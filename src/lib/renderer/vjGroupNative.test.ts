import { describe, expect, it } from 'vitest';
import { buildVJGroupGraph, type VJGroupGraphOptions } from './vjGroupNative';
const options = (): VJGroupGraphOptions => ({
  outputSourceId: 'group:one', rows: [
    { frameId: 'layer-frame:bottom', opacity: 0.8, blendMode: 'normal' },
    { frameId: 'layer-frame:top', opacity: 0.6, blendMode: 'screen' },
  ], effects: [{ effect: 'blur', amount: 5, mix: 1 }],
  opacity: 0.25, blendMode: 'add', width: 64, height: 64, time: 1, frameIndex: 60,
});
function floats(buffer: Record<string, unknown>) {
  return new Float32Array(Uint8Array.from(atob(buffer.initial_b64 as string), c => c.charCodeAt(0)).buffer);
}
describe('native group composition', () => {
  it('composites children before applying effects, leaving group level/blend to the parent', () => {
    const graph = buildVJGroupGraph(options());
    expect(graph.config.render_passes).toHaveLength(3);
    expect(graph.config.render_passes[1].source_id).toBe('group:one:children');
    expect(graph.config.render_passes[2].source_id).toBe('group:one');
    expect(graph.config.render_passes[2].bindings).toContainEqual({ binding: 0, kind: 'source-frame-texture', source_id: 'group:one:children' });
    expect(floats(graph.config.buffers[0])[2]).toBeCloseTo(0.8);
    expect(floats(graph.config.buffers[1])[2]).toBeCloseTo(0.6);
    expect(graph.row).toEqual({ frameId: 'group:one', opacity: 0.25, blendMode: 'add' });
    const passes = graph.config.render_passes;
    expect(passes.map(pass => pass.seq)).toEqual([3840, 3841, 3842]);
  });
  it('keeps group sources resident when faded out and supports no effects', () => {
    const graph = buildVJGroupGraph({ ...options(), effects: [], opacity: 0 });
    expect(graph.config.render_passes).toHaveLength(2);
    expect(graph.config.render_passes[1].source_id).toBe('group:one');
    expect(graph.row.opacity).toBe(0);
  });
  it('isolates simultaneous group buffers and render targets', () => {
    const a = buildVJGroupGraph(options());
    const b = buildVJGroupGraph({ ...options(), outputSourceId: 'group:two' });
    const aIds = new Set(a.config.buffers.map(buffer => buffer.id));
    expect(b.config.buffers.some(buffer => aIds.has(buffer.id))).toBe(false);
    const aTargets = new Set(a.config.render_passes.map(pass => pass.source_id));
    expect(b.config.render_passes.some(pass => aTargets.has(pass.source_id))).toBe(false);
  });
  it('rejects empty groups, feedback loops and oversized chains explicitly', () => {
    expect(() => buildVJGroupGraph({ ...options(), rows: [] })).toThrow();
    expect(() => buildVJGroupGraph({ ...options(), rows: [{ frameId: 'group:one:children', opacity: 1, blendMode: 'normal' }] })).toThrow();
    expect(() => buildVJGroupGraph({ ...options(), effects: Array(17).fill(options().effects[0]) })).toThrow();
  });
});

import { buildVJGroupedMixGraph } from './vjGroupNative';
it('places multiple groups before their parent and preserves ungrouped rows', () => {
  const graph = buildVJGroupedMixGraph({ ...options(), groups: [{ id: 'g', opacity: 0.3, blendMode: 'screen', effects: [] }],
    rows: [{ frameId: 'bottom', opacity: 1, blendMode: 'normal' }, { frameId: 'child', opacity: 1, blendMode: 'normal', groupId: 'g' }, { frameId: 'top', opacity: 1, blendMode: 'normal' }] });
  const passes = graph.config.render_passes;
  expect(passes[0].source_id).toBe('group:one:group:g');
  expect(passes[2].bindings).toContainEqual({ binding: 3, kind: 'source-frame-texture', source_id: 'group:one:group:g' });
  expect(passes.at(-1)?.source_id).toBe('group:one');
  expect(new Set(passes.map(p => p.seq)).size).toBe(passes.length);
});
