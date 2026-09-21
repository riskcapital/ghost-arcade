import { describe, expect, it } from 'vitest';
import { NativeLutResidency } from './nativeLutResidency';
const commands = () => [{ type: 'queue_compute_graph', buffers: [{ id: 'table', kind: 'storage', persistent: true, immutable_lut: true, initial_f32: [1, 2, 3, 0] }, { id: 'uniform', kind: 'uniform', initial_f32: [1] }] }];
describe('LUT upload residency', () => {
  it('uploads once after acknowledgment, then sends only the buffer reference and small uniforms', () => {
    const cache = new NativeLutResidency();
    const first = cache.prepare(commands());
    expect(first.commands[0].buffers[0].initial_f32).toBeDefined();
    expect(cache.prepare(commands()).commands[0].buffers[0].initial_f32).toBeDefined();
    first.finish(true);
    const next = cache.prepare(commands()).commands[0];
    expect(next.buffers[0].initial_f32).toBeUndefined();
    expect(next.buffers[1].initial_f32).toEqual([1]);
  });
  it('omits cached binary LUT data as well as JSON tables', () => {
    const cache = new NativeLutResidency();
    const binary = [{ type: 'queue_compute_graph', buffers: [{ id: 'binary', immutable_lut: true, persistent: true, initial_b64: 'AAAAAA==' }] }];
    cache.prepare(binary).finish(true);
    expect(cache.prepare(binary).commands[0].buffers[0]).not.toHaveProperty('initial_b64');
  });
  it('reuploads after failure or cache reset and ignores stale acknowledgments', () => {
    const cache = new NativeLutResidency();
    const first = cache.prepare(commands()); cache.reset(); first.finish(true);
    expect(cache.prepare(commands()).commands[0].buffers[0].initial_f32).toBeDefined();
    cache.prepare(commands()).finish(true);
    cache.prepare(commands()).finish(false);
    expect(cache.prepare(commands()).commands[0].buffers[0].initial_f32).toBeDefined();
  });
});
