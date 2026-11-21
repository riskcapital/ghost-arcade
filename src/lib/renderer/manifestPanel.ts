/**
 * Small pure helpers for the layer panel's manifest-driven controls
 * (GPULayerPanel.svelte), kept here so they can be tested.
 */
import type { ParamControl } from './gpuShaderTypes';
import type { CloudLoadState } from './manifestParams';

/** Whether any control rebuilds the instrument (the panel then explains ↻). */
export function hasRebuildParams(schema: ParamControl[]): boolean {
  return schema.some((p) => p.resets === true);
}

/** What the panel says about a cloud instrument's scan file. */
export function cloudLoadMessage(state: CloudLoadState | undefined, path: unknown): { text: string; failed: boolean } {
  if (!path) return { text: 'Pick a .ply scan to start', failed: false };
  if (!state || state.state === 'loading') return { text: 'Loading scan…', failed: false };
  if (state.state === 'ready') return { text: `Scan ready: ${state.points.toLocaleString()} points`, failed: false };
  return { text: `Could not read the scan: ${state.reason}`, failed: true };
}

/** Visible controls grouped by their `group`, in first-seen order; groups
 *  left empty by `visible` are dropped. */
export function groupControls(schema: ParamControl[], visible: (p: ParamControl) => boolean = () => true): [string, ParamControl[]][] {
  const groups = new Map<string, ParamControl[]>();
  for (const p of schema) {
    if (!visible(p)) continue;
    const g = p.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return Array.from(groups.entries());
}
