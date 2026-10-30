import { describe, expect, it, vi } from 'vitest';
import type { Layer } from '../types';
import { NativeLayerInteractionTracker, coalesceToMicrotask } from './nativeSceneSync';

function corners(offset = 0) {
  return {
    topLeft: { x: 0 + offset, y: 1 },
    topRight: { x: 1, y: 1 },
    bottomRight: { x: 1, y: 0 },
    bottomLeft: { x: 0, y: 0 },
  };
}

function layer(id: string, extra: Partial<Layer> = {}): Layer {
  return { id, corners: corners(), meshGrid: null, warpMode: 'corners', ...extra } as unknown as Layer;
}

describe('NativeLayerInteractionTracker', () => {
  it('reports every layer the first time', () => {
    const tracker = new NativeLayerInteractionTracker();
    const out = tracker.collect([layer('a'), layer('b')]);
    expect(out.map((entry) => entry.layer_id)).toEqual(['a', 'b']);
    expect(out[0].mesh_grid).toBeNull();
  });

  it('does not serialize layers whose warp objects are unchanged', () => {
    const tracker = new NativeLayerInteractionTracker();
    const a = layer('a');
    tracker.collect([a]);
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      // A modulated copy of the layer keeps the same warp objects.
      const out = tracker.collect([{ ...a, opacity: 0.5 } as Layer]);
      expect(out).toEqual([]);
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
  });

  it('reports a moved corner and skips a new but equal object', () => {
    const tracker = new NativeLayerInteractionTracker();
    const a = layer('a');
    tracker.collect([a]);
    expect(tracker.collect([{ ...a, corners: corners() } as Layer])).toEqual([]);
    const moved = tracker.collect([{ ...a, corners: corners(0.25) } as Layer]);
    expect(moved).toHaveLength(1);
    expect(moved[0].corners.topLeft.x).toBe(0.25);
  });

  it('reports a warp mode change that changes the mesh it sends', () => {
    const tracker = new NativeLayerInteractionTracker();
    const meshGrid = {
      rows: 2,
      cols: 2,
      points: [
        [{ x: 0, y: 1 }, { x: 1, y: 1 }],
        [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      ],
    };
    const a = layer('a', { meshGrid, warpMode: 'edge' });
    expect(tracker.collect([a])[0].mesh_grid).toBeNull();
    const out = tracker.collect([{ ...a, warpMode: 'mesh' } as Layer]);
    expect(out).toHaveLength(1);
    expect(out[0].mesh_grid).toEqual(meshGrid);
  });

  it('forgets removed layers and reports them again if they return', () => {
    const tracker = new NativeLayerInteractionTracker();
    const a = layer('a');
    const b = layer('b');
    tracker.collect([a, b]);
    tracker.collect([a]);
    expect(tracker.size).toBe(1);
    expect(tracker.collect([a, b]).map((entry) => entry.layer_id)).toEqual(['b']);
  });
});

describe('coalesceToMicrotask', () => {
  it('runs once per task however often it is scheduled', async () => {
    const run = vi.fn();
    const queue = coalesceToMicrotask(run);
    queue.schedule();
    queue.schedule();
    queue.schedule();
    expect(run).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    queue.schedule();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('flush runs a pending run now and only once', async () => {
    const run = vi.fn();
    const queue = coalesceToMicrotask(run);
    queue.flush();
    expect(run).not.toHaveBeenCalled();
    queue.schedule();
    queue.flush();
    expect(run).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('drops a pending run on cancel and can be scheduled again', async () => {
    const run = vi.fn();
    const queue = coalesceToMicrotask(run);
    queue.schedule();
    queue.cancel();
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    queue.schedule();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
