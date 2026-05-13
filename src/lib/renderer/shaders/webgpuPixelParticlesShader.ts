/**
 * WebGPUPixelParticlesShader — GpuShaderImpl wrapper around the
 * existing WebGPUPixelParticles class. Migrates the legacy pixel-fx
 * layer's full feature set into the gpu-layer system so it gets:
 *   - Layer warp (corners + mesh grid)
 *   - Layer blend modes (normal / multiply / screen / overlay / etc.)
 *   - Per-layer effects (CSS + GPU effects like fluid sim) chained on top
 *   - Mask + edge effects
 *   - Keyframable params via the shared `gpu:` keyframe path
 *   - Project save / preset save (params live in gpuLayerContent)
 *
 * Every param the original PixelFXContent supported is reproduced
 * here as a ParamControl entry. Mode-specific knobs (depth, sand-
 * fall floor, scatter amplitude, etc.) are exposed as named keys
 * rather than the original `knobs[0..3]` array — cleaner UX, and
 * the shader internally maps them to the array slots the compute
 * shader expects.
 *
 * The source picker (media library / layer / file upload) is
 * driven by a `media-source` ParamControl handled in GPULayerPanel.
 * The runner resolves the source into an Image / Video / Canvas
 * element and calls our `setSource()`, which dispatches to the
 * underlying class's typed methods.
 */

import { WebGPUPixelParticles, type PixelEffectMode } from '../webgpuPixelParticles';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

// Param schema — declarative + grouped. The panel renders each
// group as a section and only the controls relevant to the current
// mode visually dominate (irrelevant ones are still shown but the
// shader ignores them, so toggling modes is non-destructive to the
// user's tuning).
export const pixelParticlesParamSchema: ParamControl[] = [
  // ── Source ──
  // The source always renders to the camera's view extent — use the
  // Camera Distance / FOV / Pan to frame it.
  { kind: 'media-source', key: 'source', label: 'Source', group: 'Source' },
  // Horizontal mirror — primarily for webcam selfie-flip but works
  // for any source (useful for "double exposure" style mixes too).
  { kind: 'toggle', key: 'mirrorX', label: 'Mirror Horizontally', group: 'Source', default: false },

  // ── Mode ──
  { kind: 'select', key: 'mode', label: 'Mode', group: 'Mode',
    options: [
      { value: 'depth-shift',   label: 'Depth Shift' },
      { value: 'sand-fall',     label: 'Sand Fall' },
      { value: 'scatter',       label: 'Scatter' },
      { value: 'halftone',      label: 'Halftone' },
      { value: 'stipple-noise', label: 'Stipple Ink' },
      { value: 'dissolve',      label: 'Dissolve' },
      { value: 'identity',      label: 'Identity' },
    ],
    default: 'depth-shift' },

  // ── Mode params ──
  // Each entry has `showWhen: { mode: 'X' }` so it appears in the
  // panel ONLY when its mode is selected. The shader keeps reading
  // every value so switching modes is non-destructive.

  // Depth shift
  { kind: 'slider', key: 'depthAmount',     label: 'Depth',           group: 'Mode Params', min: 0, max: 3, step: 0.01, default: 0.6, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'depthSpinSpeed',  label: 'Auto-spin Speed', group: 'Mode Params', min: -2, max: 2, step: 0.01, default: 0, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'depthSpinAxis',   label: 'Spin Axis (0=Y, 1=X)', group: 'Mode Params', min: 0, max: 1, step: 1, default: 0, showWhen: { mode: 'depth-shift' } },
  // Sand fall
  { kind: 'slider', key: 'sandFallSpeed',   label: 'Fall Speed',      group: 'Mode Params', min: 0.05, max: 3, step: 0.01, default: 0.4, showWhen: { mode: 'sand-fall' } },
  { kind: 'slider', key: 'sandFloorY',      label: 'Floor Y',         group: 'Mode Params', min: -1.5, max: 1.5, step: 0.01, default: -1.0, showWhen: { mode: 'sand-fall' } },
  { kind: 'slider', key: 'sandDrift',       label: 'X Drift',         group: 'Mode Params', min: 0, max: 0.2, step: 0.001, default: 0.02, showWhen: { mode: 'sand-fall' } },
  { kind: 'slider', key: 'sandDensity',     label: 'Density',         group: 'Mode Params', min: 0.05, max: 1, step: 0.01, default: 1.0, showWhen: { mode: 'sand-fall' } },
  // Scatter
  { kind: 'slider', key: 'scatterAmp',      label: 'Wobble Amp',      group: 'Mode Params', min: 0, max: 0.3, step: 0.005, default: 0.04, showWhen: { mode: 'scatter' } },
  { kind: 'slider', key: 'scatterRecovery', label: 'Recovery',        group: 'Mode Params', min: 0, max: 5, step: 0.05, default: 1.5, showWhen: { mode: 'scatter' } },
  { kind: 'slider', key: 'scatterFreq',     label: 'Noise Freq',      group: 'Mode Params', min: 0.5, max: 30, step: 0.5, default: 4.0, showWhen: { mode: 'scatter' } },
  // Halftone
  { kind: 'slider', key: 'halftoneCellSize',label: 'Cell Size',       group: 'Mode Params', min: 0.003, max: 0.05, step: 0.001, default: 0.012, showWhen: { mode: 'halftone' } },
  // Stipple
  { kind: 'slider', key: 'stippleAmp',      label: 'Wobble Amp',      group: 'Mode Params', min: 0, max: 0.05, step: 0.001, default: 0.008, showWhen: { mode: 'stipple-noise' } },
  { kind: 'slider', key: 'stippleFreq',     label: 'Wobble Freq',     group: 'Mode Params', min: 5, max: 100, step: 1, default: 35, showWhen: { mode: 'stipple-noise' } },
  // Dissolve
  { kind: 'slider', key: 'dissolveSpread',  label: 'Spread',          group: 'Mode Params', min: 0, max: 4, step: 0.05, default: 1.6, showWhen: { mode: 'dissolve' } },
  { kind: 'slider', key: 'dissolveSpeed',   label: 'Cycle Speed',     group: 'Mode Params', min: 0.05, max: 3, step: 0.05, default: 0.6, showWhen: { mode: 'dissolve' } },
  { kind: 'slider', key: 'dissolveSwirl',   label: 'Swirl',           group: 'Mode Params', min: -3, max: 3, step: 0.05, default: 0.5, showWhen: { mode: 'dissolve' } },

  // ── Particles (general) ──
  { kind: 'slider', key: 'particleCount',   label: 'Count',           group: 'Particles',  min: 10000, max: 1_000_000, step: 10000, default: 250000 },
  { kind: 'slider', key: 'baseSize',        label: 'Size',            group: 'Particles',  min: 0.001, max: 0.02, step: 0.0005, default: 0.005 },
  { kind: 'slider', key: 'opacity',         label: 'Opacity',         group: 'Particles',  min: 0, max: 1, step: 0.01, default: 1.0 },
  { kind: 'slider', key: 'anchorJitter',    label: 'Anchor Jitter',   group: 'Particles',  min: 0, max: 1, step: 0.01, default: 0.6 },

  // ── Camera ──
  { kind: 'slider', key: 'fovDeg',          label: 'FOV',             group: 'Camera',     min: 20, max: 100, step: 1, default: 50 },
  { kind: 'slider', key: 'cameraZ',         label: 'Distance',        group: 'Camera',     min: 0.5, max: 8, step: 0.05, default: 2.2 },
  { kind: 'angle',  key: 'cameraYaw',       label: 'Yaw',             group: 'Camera', default: 0 },
  { kind: 'angle',  key: 'cameraPitch',     label: 'Pitch',           group: 'Camera', default: 0 },
  { kind: 'slider', key: 'panX',            label: 'Pan X',           group: 'Camera',     min: -1.5, max: 1.5, step: 0.01, default: 0 },
  { kind: 'slider', key: 'panY',            label: 'Pan Y',           group: 'Camera',     min: -1.5, max: 1.5, step: 0.01, default: 0 },

  // ── Light (depth-shift only — surfaced when mode = depth-shift) ──
  { kind: 'toggle', key: 'lightEnabled',    label: 'Enable Light',    group: 'Light', default: false, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'lightX',          label: 'Light X',         group: 'Light', min: -2, max: 2, step: 0.01, default: 1.0, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'lightY',          label: 'Light Y',         group: 'Light', min: -2, max: 2, step: 0.01, default: 1.0, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'lightZ',          label: 'Light Z',         group: 'Light', min: 0.05, max: 4, step: 0.01, default: 1.5, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'lightIntensity',  label: 'Intensity',       group: 'Light', min: 0, max: 4, step: 0.01, default: 1.5, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'lightAmbient',    label: 'Ambient',         group: 'Light', min: 0, max: 1, step: 0.01, default: 0.25, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'lightHeightStrength', label: 'Surface Strength', group: 'Light', min: 0, max: 4, step: 0.01, default: 1.5, showWhen: { mode: 'depth-shift' } },

  // ── Noise (depth-shift only) ──
  { kind: 'slider', key: 'noiseAmpXY',      label: 'Wobble XY',       group: 'Noise Flow', min: 0, max: 0.5, step: 0.005, default: 0, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'noiseAmpZ',       label: 'Wobble Z',        group: 'Noise Flow', min: 0, max: 2, step: 0.01, default: 0, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'noiseFreq',       label: 'Frequency',       group: 'Noise Flow', min: 0.5, max: 30, step: 0.1, default: 4, showWhen: { mode: 'depth-shift' } },
  { kind: 'slider', key: 'noiseSpeed',      label: 'Speed',           group: 'Noise Flow', min: 0, max: 3, step: 0.01, default: 0.5, showWhen: { mode: 'depth-shift' } },
];

export const pixelParticlesParamDefaults = deriveDefaults(pixelParticlesParamSchema);

/** Map mode name → knobs[0..3] tuple. The compute shader reads
 *  these positions; the panel exposes them as named keys for UX. */
function knobsForMode(mode: string, p: Record<string, any>): [number, number, number, number] {
  switch (mode) {
    case 'depth-shift':
      return [p.depthAmount ?? 0.6, 0, p.depthSpinSpeed ?? 0, p.depthSpinAxis ?? 0];
    case 'sand-fall':
      return [p.sandFallSpeed ?? 0.4, p.sandFloorY ?? -1.0, p.sandDrift ?? 0.02, p.sandDensity ?? 1.0];
    case 'scatter':
      return [p.scatterAmp ?? 0.04, p.scatterRecovery ?? 1.5, p.scatterFreq ?? 4.0, 0];
    case 'halftone':
      return [p.halftoneCellSize ?? 0.012, 1.0, 0, 0];
    case 'stipple-noise':
      return [p.stippleAmp ?? 0.008, p.stippleFreq ?? 35, 0, 0];
    case 'dissolve':
      return [p.dissolveSpread ?? 1.6, p.dissolveSpeed ?? 0.6, p.dissolveSwirl ?? 0.5, 0];
    default:
      return [0, 0, 0, 0];
  }
}

export class WebGPUPixelParticlesShader implements GpuShaderImpl {
  private inner: WebGPUPixelParticles;

  constructor(device: any, presentFormat: any) {
    // Use the `create` static — synchronous in the existing class
    // because the constructor does all the work. We assert into the
    // class type so TypeScript stops complaining about the private
    // constructor; this is the same pattern the legacy WebGPUCanvas
    // wiring uses.
    this.inner = new (WebGPUPixelParticles as any)(device, presentFormat);
  }

  setParams(p: Record<string, any>): void {
    const merged = { ...pixelParticlesParamDefaults, ...p };
    const mode = (merged.mode || 'depth-shift') as PixelEffectMode;
    this.inner.setMode(mode);
    this.inner.setKnobs(knobsForMode(mode, merged));
    this.inner.setBaseSize(merged.baseSize ?? 0.005);
    this.inner.setOpacity(merged.opacity ?? 1);
    this.inner.setAnchorJitter(merged.anchorJitter ?? 0.6);
    this.inner.setCamera(merged.fovDeg ?? 50, merged.cameraZ ?? 2.2);
    this.inner.setOrbit(merged.cameraYaw ?? 0, merged.cameraPitch ?? 0);
    this.inner.setPan(merged.panX ?? 0, merged.panY ?? 0);
    this.inner.setLight(
      !!merged.lightEnabled,
      merged.lightX ?? 1, merged.lightY ?? 1, merged.lightZ ?? 1.5,
      merged.lightIntensity ?? 1.5, merged.lightAmbient ?? 0.25, merged.lightHeightStrength ?? 1.5,
    );
    this.inner.setNoise(
      merged.noiseAmpXY ?? 0, merged.noiseAmpZ ?? 0,
      merged.noiseFreq ?? 4, merged.noiseSpeed ?? 0.5,
    );
    this.inner.setParticleCount(merged.particleCount ?? 250000);
    this.inner.setMirrorX(!!merged.mirrorX);
    // Blend mode is now handled by the gpu LAYER (engine compositor),
    // not the inner renderer — we always render normal-blended into
    // the layer canvas so the engine's blend mode applies.
    this.inner.setBlendMode('normal');
  }

  /** Source dispatch — the runner calls this per frame for videos
   *  (cheap canvas/video copy each frame) or once on change for
   *  still images. */
  setSource(source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap): void {
    if (source instanceof HTMLVideoElement) {
      this.inner.updateSourceFromVideo(source);
    } else if (source instanceof HTMLCanvasElement) {
      this.inner.updateSourceFromCanvas(source);
    } else {
      // HTMLImageElement / ImageBitmap → async load (handled
      // internally by setSourceImage). Errors logged there.
      void this.inner.setSourceImage(source);
    }
  }

  /** Zero-copy raw-bytes upload — used for Spout/Syphon where the IPC
   *  layer hands us flat RGBA. Routes straight to writeTexture, no
   *  canvas / ImageBitmap intermediate. */
  setSourceFromBytes(data: Uint8Array, w: number, h: number): void {
    this.inner.updateSourceFromBytes(data, w, h);
  }

  encodeFrame(encoder: any, targetView: any, targetFormat: any, width: number, height: number, _dt: number): void {
    // Match the canvas size + target format. The inner class's
    // encodeFrame only takes (encoder, view) so we stash the
    // viewport via setViewport before encoding.
    this.inner.setViewport(width, height);
    // Clear the target first — the inner renderer assumes the
    // bridge has been cleared already (it uses load+additive).
    // For our layer canvas we own it so we clear here.
    const clearPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    clearPass.end();
    // Now run the inner pipeline; it loads the cleared target and
    // composites particles + trails + tubes additively.
    this.inner.encodeFrame(encoder, targetView);
  }

  resize(_w: number, _h: number): void {
    // No-op — inner class allocates trail textures lazily based on
    // the viewport set during encodeFrame.
  }

  dispose(): void {
    try { this.inner.dispose?.(); } catch { /* */ }
  }
}
