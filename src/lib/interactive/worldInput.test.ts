import { describe, expect, it } from 'vitest';
import { THROW_EVERY, THROW_KEEP, WorldInput, worldInputParam } from './worldInput';
import type { Interaction } from '../mobile/studio/interactive';

const at = (x: number, y: number, mode: Interaction['mode'], id = 'a'): Interaction => ({ id, point: { x, y }, strength: 1, mode });

describe('touches on the 3D world', () => {
  it('throws one ball per press, then one every interval while held', () => {
    const input = new WorldInput();
    let state = input.update([at(0.5, 0.5, 'throw')], 10);
    expect(state.throws.map((t) => t.number)).toEqual([1]);
    state = input.update([at(0.5, 0.5, 'throw')], 10 + THROW_EVERY / 2);
    expect(state.throws.map((t) => t.number)).toEqual([1]);
    state = input.update([at(0.5, 0.5, 'throw')], 10 + THROW_EVERY * 1.01);
    expect(state.throws.map((t) => t.number)).toEqual([1, 2]);
    // A stalled frame does not release a backlog of balls.
    state = input.update([at(0.5, 0.5, 'throw')], 12);
    expect(state.throws.map((t) => t.number)).toEqual([3]);
  });

  it('keeps each throw listed for a moment, then lets it go; numbers only grow', () => {
    const input = new WorldInput();
    input.update([at(0.2, 0.2, 'throw')], 0);
    expect(input.update([], 0.1).throws).toHaveLength(1);
    expect(input.update([], THROW_KEEP + 0.01).throws).toHaveLength(0);
    expect(input.update([at(0.2, 0.2, 'throw', 'b')], 1).throws[0].number).toBe(2);
  });

  it('flings at the finger’s speed', () => {
    const input = new WorldInput();
    input.update([at(0.2, 0.5, 'push')], 0);
    for (let i = 1; i <= 6; i++) input.update([at(0.2 + i * 0.02, 0.5, 'push')], i * 0.02);
    const [p] = input.update([at(0.34, 0.5, 'push')], 0.14).pointers;
    expect(p.tool).toBe('push');
    expect(p.velocity.x).toBeGreaterThan(0.7);
    expect(Math.abs(p.velocity.y)).toBeLessThan(0.01);
    const t = input.update([at(0.36, 0.5, 'throw')], 0.16).throws[0];
    expect(t.velocity.x).toBeGreaterThan(0.7);
  });

  it('reads attract, repel and vortex as forces, and drops what is not sane', () => {
    const state = new WorldInput().update([at(0.1, 0.1, 'repel'), at(0.2, 0.2, 'vortex', 'b'), at(0.3, 0.3, undefined, 'c'), at(0.4, 0.4, 'pour', 'd')], 0);
    expect(state.pointers.map((p) => p.tool)).toEqual(['repel', 'vortex', 'attract', 'pour']);
    const param = worldInputParam({ pointers: [{ point: { x: NaN, y: 0 }, velocity: { x: 0, y: 0 }, tool: 'push', strength: 1 }, state.pointers[0]], throws: [{ point: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, number: 0, at: 0 }] });
    expect(param.pointers).toHaveLength(1);
    expect(param.throws).toHaveLength(0);
    expect(worldInputParam(undefined)).toEqual({ pointers: [], throws: [] });
  });
});
