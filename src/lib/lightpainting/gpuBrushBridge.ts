/**
 * GPU brush bridge — hands the offscreen WebGPU canvas that
 * WebGPUCanvas renders the Light Painting stroke-particles into over
 * to Canvas.svelte, which wraps it as a THREE.CanvasTexture and slots
 * it into the light-painting layer's z-position in the WebGL composite
 * (via the layer's `_lightPaintingGPUTexture`).
 *
 * WHY: the GPU stroke-particle brushes used to be painted as a final
 * overlay on top of the fully-composited bridge frame inside
 * WebGPUCanvas — so they (a) ignored layer z-order (anything stacked
 * above the light-paint layer was covered by the brushes) and (b)
 * kept animating when output was frozen (their compute pass ran in
 * WebGPUCanvas's own RAF loop). Routing the brushes through the engine
 * at the layer's real z-slot — exactly like the CPU/WebGL2 brushes
 * already do via `_lightPaintingTexture` — fixes both: layers above
 * the light-paint layer now occlude the brushes, and the brushes
 * freeze with the engine.
 *
 * The handshake is a single module-level canvas ref (one editor
 * WebGPUCanvas instance at a time). WebGPUCanvas sets it on mount,
 * clears it on destroy; Canvas.svelte reads it each frame. A null
 * value means "no GPU brush surface available" (WebGPU unsupported,
 * or the overlay torn down) — Canvas.svelte then just skips the GPU
 * texture and the layer shows only its CPU brushes.
 */

let gpuBrushCanvas: HTMLCanvasElement | null = null;

export function setGPUBrushCanvas(canvas: HTMLCanvasElement | null): void {
  gpuBrushCanvas = canvas;
}

export function getGPUBrushCanvas(): HTMLCanvasElement | null {
  return gpuBrushCanvas;
}
