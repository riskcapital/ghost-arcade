/**
 * WebGPUFlythroughShader — GpuShaderImpl wrapper around WebGPUFlythrough.
 *
 * Exposes the flythrough renderer as its own shader style in the gpu
 * layer catalog (parallel to Planet, Pixel Particles, etc.). User
 * picks "Flythrough" from the shader-style dropdown; gets the full
 * endless-tunnel + worm-stroke param surface directly without going
 * through the pixel-particles Mode selector.
 *
 * Architectural note: this is a SIBLING of WebGPUPixelParticlesShader,
 * not a mode of it. The flythrough renderer's camera model (auto-
 * advancing Z accumulator), particle topology (worm strokes / billboard
 * points), and slab-replication draw call are different enough that
 * cramming it into the existing PixelParticles compute branch would
 * have bloated that class. See the doc comment in webgpuFlythrough.ts
 * for the full rationale.
 *
 * Source dispatch: flythrough is a source-driven shader (needsSource
 * = true in the catalog entry). The runner resolves the user's media
 * pick into an Image / Video / Canvas element and calls setSource()
 * per frame for videos / once on change for stills.
 */

import { WebGPUFlythrough } from '../webgpuFlythrough';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

// Param schema — declarative + grouped. Each control's `group` drives
// the panel's section headers. Defaults match the renderer's internal
// DEFAULT_PARAMS so a freshly-created flythrough layer looks compelling
// from the very first frame.
export const flythroughParamSchema: ParamControl[] = [
  // ── Source ────────────────────────────────────────────────────
  // Source picker (media library / layer / file upload). Required —
  // the tunnel is the source replicated into N slabs.
  { kind: 'media-source', key: 'source', label: 'Source', group: 'Source' },
  // Horizontal mirror — the selfie flip. A camera pointed at you reads
  // backwards without it, so this belongs beside the source, not in a
  // rendering group.
  { kind: 'toggle', key: 'mirrorX', label: 'Mirror Horizontally', group: 'Source', default: false },

  // ── Topology ──────────────────────────────────────────────────
  // The big aesthetic switch: classic billboarded points vs. quads
  // extruded along each particle's velocity for the worm / brush-
  // stroke look. Stroke params reveal only when topology === strokes.
  { kind: 'select', key: 'topology', label: 'Topology', group: 'Topology',
    options: [
      { value: 'strokes', label: 'Worm Strokes' },
      { value: 'points',  label: 'Points' },
    ],
    default: 'strokes' },
  { kind: 'slider', key: 'strokeLength', label: 'Stroke Length', group: 'Topology',
    min: 0.01, max: 0.4, step: 0.005, default: 0.08,
    showWhen: { topology: 'strokes' } },
  { kind: 'slider', key: 'strokeWidth',  label: 'Stroke Width',  group: 'Topology',
    min: 0.001, max: 0.05, step: 0.0005, default: 0.006,
    showWhen: { topology: 'strokes' } },

  // ── Camera Motion (the endless-tunnel core) ───────────────────
  // flySpeed accumulates internally; the renderer wraps it through
  // the slab-modulo so the visible tunnel cycles continuously.
  { kind: 'slider', key: 'flySpeed',    label: 'Fly Speed',    group: 'Camera Motion',
    min: -2, max: 6, step: 0.05, default: 0.8 },
  { kind: 'slider', key: 'tunnelDepth', label: 'Tunnel Depth', group: 'Camera Motion',
    min: 0.5, max: 6, step: 0.05, default: 2.0 },
  { kind: 'slider', key: 'slabCount',   label: 'Slab Count',   group: 'Camera Motion',
    min: 2, max: 8, step: 1, default: 4 },

  // ── Flow & Anchor ─────────────────────────────────────────────
  // Curl-noise advection drives the swirl. anchorPull yanks particles
  // back toward their UV-anchor so the source image stays legible.
  { kind: 'slider', key: 'flowStrength', label: 'Flow Strength', group: 'Flow & Anchor',
    min: 0, max: 2, step: 0.01, default: 0.4 },
  { kind: 'slider', key: 'flowScale',    label: 'Flow Scale',    group: 'Flow & Anchor',
    min: 0.5, max: 8, step: 0.05, default: 2.0 },
  { kind: 'slider', key: 'anchorPull',   label: 'Anchor Pull',   group: 'Flow & Anchor',
    min: 0, max: 3, step: 0.01, default: 1.2 },
  { kind: 'slider', key: 'depthStrength',label: 'Depth Strength',group: 'Flow & Anchor',
    min: 0, max: 1.5, step: 0.01, default: 0.5 },

  // ── Depth Source ──────────────────────────────────────────────
  // How depth is derived from the source pixels. v1 wires this
  // through to the shader as a string param; the compute branch
  // currently uses `luminance` for everything (inverse-luminance +
  // edge-density wiring is a small follow-up in the compute pass).
  { kind: 'select', key: 'depthSource', label: 'Depth Source', group: 'Depth Source',
    options: [
      { value: 'luminance',         label: 'Luma' },
      { value: 'inverse-luminance', label: 'Inverse Luma' },
      { value: 'edge-density',      label: 'Edges' },
    ],
    default: 'luminance' },

  // ── Particles ─────────────────────────────────────────────────
  { kind: 'slider', key: 'particleCount', label: 'Count',         group: 'Particles',
    min: 10000, max: 1_000_000, step: 10000, default: 250000 },
  { kind: 'slider', key: 'baseSize',      label: 'Point Size',    group: 'Particles',
    min: 0.001, max: 0.02, step: 0.0005, default: 0.005,
    showWhen: { topology: 'points' } },
  { kind: 'slider', key: 'opacity',       label: 'Opacity',       group: 'Particles',
    min: 0, max: 1, step: 0.01, default: 1.0 },

  // ── Camera framing ────────────────────────────────────────────
  // Pitch + yaw rotate the world around the camera origin so users
  // can angle into the tunnel without breaking the straight-Z fly
  // model.
  { kind: 'slider', key: 'fovDeg',      label: 'FOV',   group: 'Camera Framing',
    min: 20, max: 100, step: 1, default: 50 },
  { kind: 'angle',  key: 'cameraYaw',   label: 'Yaw',   group: 'Camera Framing', default: 0 },
  { kind: 'angle',  key: 'cameraPitch', label: 'Pitch', group: 'Camera Framing', default: 0 },

  // ── Audio Reactive ────────────────────────────────────────────
  // Bass boosts fly speed (kick = forward burst), treble boosts
  // flow strength (high freq = swirl chaos). Baselines stay the
  // no-audio values; reactivity ADDS to them rather than replacing.
  // Wiring lives in the runner — it pumps bands into a setBands()
  // method on the wrapper each frame.
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio',
    default: false },
];

export const flythroughParamDefaults = deriveDefaults(flythroughParamSchema);

export class WebGPUFlythroughShader implements GpuShaderImpl {
  private inner: WebGPUFlythrough;
  // Latest bass / treble snapshot. Pumped by the runner's audio
  // subscription — kept here so per-frame setParams can modulate.
  // null until the analyzer ticks once.
  private bands: { bass: number; mid: number; treble: number } | null = null;
  // Latest user-merged params, stashed so setBands → setParams flows
  // can re-derive the audio-modulated values without losing the
  // user's configured baselines.
  private lastParams: Record<string, any> = { ...flythroughParamDefaults };

  constructor(device: any, presentFormat: any) {
    this.inner = new WebGPUFlythrough(device, presentFormat);
  }

  /** Push audio bands from the runner. Optional — not part of the
   *  GpuShaderImpl interface; the runner duck-types this. */
  setBands(bass: number, mid: number, treble: number): void {
    this.bands = { bass, mid, treble };
    // Re-derive audio-modulated params on the inner renderer so the
    // visual reacts immediately rather than waiting for the next
    // setParams call from the panel.
    this.applyParamsToInner();
  }

  setParams(p: Record<string, any>): void {
    this.lastParams = { ...flythroughParamDefaults, ...p };
    this.applyParamsToInner();
  }

  /** Apply lastParams + current audio bands to the inner renderer.
   *  Split out so setBands() can re-derive cheaply when the bands
   *  update between panel setParams ticks. */
  private applyParamsToInner(): void {
    const p = this.lastParams;
    const baseFly = p.flySpeed ?? 0.8;
    const baseFlow = p.flowStrength ?? 0.4;
    const reactive = !!p.audioReactive && this.bands;
    const flySpeed = reactive
      ? baseFly * (1 + this.bands!.bass * 1.8)
      : baseFly;
    const flowStrength = reactive
      ? baseFlow * (1 + this.bands!.treble * 1.5)
      : baseFlow;

    this.inner.setParams({
      topology: (p.topology ?? 'strokes') as any,
      depthSource: (p.depthSource ?? 'luminance') as any,
      flySpeed,
      tunnelDepth: p.tunnelDepth ?? 2.0,
      slabCount: Math.max(2, Math.min(8, Math.round(p.slabCount ?? 4))),
      flowStrength,
      flowScale: p.flowScale ?? 2.0,
      anchorPull: p.anchorPull ?? 1.2,
      strokeLength: p.strokeLength ?? 0.08,
      strokeWidth: p.strokeWidth ?? 0.006,
      depthStrength: p.depthStrength ?? 0.5,
      baseSize: p.baseSize ?? 0.005,
      opacity: p.opacity ?? 1.0,
      fovDeg: p.fovDeg ?? 50,
      cameraYaw: p.cameraYaw ?? 0,
      cameraPitch: p.cameraPitch ?? 0,
      particleCount: Math.round(p.particleCount ?? 250000),
    });
    // Blend mode is owned by the gpu LAYER (engine compositor), not
    // the inner renderer — we always composite normal-blended into
    // the layer canvas so the layer's blend mode applies on the way
    // up to the final canvas.
    this.inner.setBlendMode('normal');
  }

  setSource(source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap): void {
    if (source instanceof HTMLVideoElement) {
      this.inner.updateSourceFromVideo(source);
    } else if (source instanceof HTMLCanvasElement) {
      this.inner.updateSourceFromCanvas(source);
    } else {
      void this.inner.setSourceImage(source);
    }
  }

  setSourceFromBytes(data: Uint8Array, w: number, h: number): void {
    this.inner.updateSourceFromBytes(data, w, h);
  }

  encodeFrame(
    encoder: any,
    targetView: any,
    _targetFormat: any,
    width: number,
    height: number,
    dt: number,
    time?: number,
  ): void {
    this.inner.setViewport(width, height);
    // Clear the layer canvas first — the inner renderer's pass uses
    // loadOp: 'load' so it composites onto whatever's already there.
    // For our owned layer canvas we want a fresh frame each tick;
    // the engine handles the layer-stack blend mode on the way out.
    const clearPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();
    this.inner.encodeFrame(encoder, targetView, time, dt);
  }

  resize(_w: number, _h: number): void {
    // No-op — the inner renderer reads viewport from setViewport each
    // frame and reallocates the source texture on size changes
    // automatically.
  }

  dispose(): void {
    try { this.inner.dispose?.(); } catch { /* */ }
  }
}
