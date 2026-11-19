/**
 * Opens "Link to existing surface" (SurfaceLinkModal.svelte): from the
 * Geometry panel with the layer's surface as the source, or from a preset's
 * menu with that preset ticked.
 */
import { writable } from 'svelte/store';

export interface SurfaceLinkOpenRequest {
  /** Source surface to start from. */
  surfaceId?: string;
  /** Presets to start ticked. */
  compositionIds?: string[];
}

export const surfaceLinkRequest = writable<SurfaceLinkOpenRequest | null>(null);

export function openSurfaceLink(request: SurfaceLinkOpenRequest = {}): void {
  surfaceLinkRequest.set(request);
}
