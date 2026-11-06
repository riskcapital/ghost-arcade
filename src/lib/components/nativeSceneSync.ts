import type { Layer, MeshWarpGrid, WarpCorners } from '../types';
import { layerOutlineMeshGrid } from '../utils/meshWarp';

/**
 * The warp the native viewport needs for one layer's hit testing: the
 * layer's outline as drawn. A Custom Shape keeps its outline when a mesh
 * warp moves the content inside it, so its clickable area does too.
 */
export interface NativeLayerInteractionPayload {
  layer_id: string;
  corners: WarpCorners;
  mesh_grid: MeshWarpGrid | null;
}

interface TrackedLayerWarp {
  corners: unknown;
  meshGrid: unknown;
  warpMode: unknown;
  customShape: boolean;
  signature: string;
  seen: number;
}

/**
 * Finds layers whose warp changed since the last call. Store updates
 * replace the warp objects they touch, so unchanged references mean an
 * unchanged warp and the JSON compare is skipped.
 */
export class NativeLayerInteractionTracker {
  private readonly layers = new Map<string, TrackedLayerWarp>();
  private pass = 0;

  collect(projectLayers: readonly Layer[]): NativeLayerInteractionPayload[] {
    const pass = ++this.pass;
    const changed: NativeLayerInteractionPayload[] = [];
    for (const layer of projectLayers) {
      const tracked = this.layers.get(layer.id);
      const customShape = !!layer.layerShape?.enabled && layer.layerShape.type === 'custom';
      if (
        tracked
        && tracked.corners === layer.corners
        && tracked.meshGrid === layer.meshGrid
        && tracked.warpMode === layer.warpMode
        && tracked.customShape === customShape
      ) {
        tracked.seen = pass;
        continue;
      }
      const meshGrid = layerOutlineMeshGrid(layer);
      const signature = JSON.stringify([layer.corners, meshGrid]);
      this.layers.set(layer.id, {
        corners: layer.corners,
        meshGrid: layer.meshGrid,
        warpMode: layer.warpMode,
        customShape,
        signature,
        seen: pass,
      });
      if (tracked?.signature === signature) continue;
      changed.push({ layer_id: layer.id, corners: layer.corners, mesh_grid: meshGrid });
    }
    for (const [id, tracked] of this.layers) {
      if (tracked.seen !== pass) this.layers.delete(id);
    }
    return changed;
  }

  get size(): number {
    return this.layers.size;
  }

  clear(): void {
    this.layers.clear();
  }
}

/**
 * Runs `run` once after the current task, however many times `schedule`
 * is called before then. `flush` runs a pending run now instead, and
 * `cancel` drops it.
 */
export function coalesceToMicrotask(run: () => void): {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
} {
  let queued = false;
  let generation = 0;
  const cancel = () => {
    generation += 1;
    queued = false;
  };
  return {
    schedule() {
      if (queued) return;
      queued = true;
      const mine = generation;
      queueMicrotask(() => {
        if (mine !== generation) return;
        queued = false;
        run();
      });
    },
    flush() {
      if (!queued) return;
      cancel();
      run();
    },
    cancel,
  };
}
