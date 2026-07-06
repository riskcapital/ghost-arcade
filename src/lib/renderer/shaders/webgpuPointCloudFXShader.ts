/**
 * WebGPUPointCloudFXShader — GpuShaderImpl wrapper around
 * WebGPUPointCloudFX. Exposes the point-cloud effects renderer as a
 * shader style in the gpu layer catalog.
 *
 * Source path: the renderer reads vertex data (positions + colors)
 * from an ArrayBuffer, NOT a 2D texture. To keep that flow consistent
 * with the existing GpuShaderImpl source contract (setSource for
 * Image/Video/Canvas), we add an OPTIONAL `setSourceBuffer(buf, ext)`
 * method that the runner duck-types in feedSource. When the user
 * picks a .ply or .splat file the runner fetches it as ArrayBuffer
 * and dispatches here instead of trying to decode it as an image.
 *
 * Audio: bass / treble pumped via the runner's `setBands` duck-type
 * (same path as the flythrough shader).
 */

import { WebGPUPointCloudFX, type PointCloudFXParams, type ColorMode, type ColorMap, type PointCloudFilterMode, type PointCloudFilterAxis } from '../webgpuPointCloudFX';
import { parsePLYBuffer } from '../../splat/plyLoader';
import { parseSplatBuffer } from '../../splat/splatLoader';
import type { PLYData } from '../../splat/plyLoader';
import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

export const pointCloudFXParamSchema: ParamControl[] = [
  // ── Source ─────────────────────────────────────────────────────
  // media-source kind reuses the existing file picker UI, but
  // restricted to `file` only — the media library / layer / camera /
  // Spout options can't produce point-cloud vertex data, so showing
  // them just creates confusing dead-end picks. The runner intercepts
  // .ply / .splat by filename and routes to setSourceBuffer instead
  // of the Image/Video path.
  { kind: 'media-source', key: 'source', label: 'Point Cloud (.ply / .splat)', group: 'Source',
    sources: ['file'], accept: '.ply,.splat' },

  // ── Topology ───────────────────────────────────────────────────
  { kind: 'select', key: 'topology', label: 'Topology', group: 'Topology',
    options: [
      { value: 'points',     label: 'Points' },
      { value: 'billboards', label: 'Billboards' },
      { value: 'strokes',    label: 'Worm Strokes' },
    ],
    default: 'points' },
  { kind: 'slider', key: 'pointSize', label: 'Point Size', group: 'Topology',
    min: 0.001, max: 0.05, step: 0.0005, default: 0.006,
    showWhen: { topology: 'points' } },
  // Billboards reuses pointSize × 2 internally; expose the same knob
  // so users have one control.
  { kind: 'slider', key: 'pointSize', label: 'Billboard Size', group: 'Topology',
    min: 0.001, max: 0.05, step: 0.0005, default: 0.006,
    showWhen: { topology: 'billboards' } },
  { kind: 'slider', key: 'strokeLength', label: 'Stroke Length', group: 'Topology',
    min: 0.005, max: 0.2, step: 0.001, default: 0.04,
    showWhen: { topology: 'strokes' } },
  { kind: 'slider', key: 'strokeWidth',  label: 'Stroke Width',  group: 'Topology',
    min: 0.0005, max: 0.03, step: 0.0005, default: 0.004,
    showWhen: { topology: 'strokes' } },
  { kind: 'slider', key: 'opacity', label: 'Opacity', group: 'Topology',
    min: 0, max: 1, step: 0.01, default: 1.0 },

  // ── Filter Gesture ────────────────────────────────────────────
  // Signal-loss-style point-cloud gestures: named, performable
  // transforms on top of the raw cloud. The base controls below stay
  // intentionally generic so they can be keyframed and MIDI-mapped.
  { kind: 'select', key: 'filterMode', label: 'Gesture', group: 'Filter Gesture',
    options: [
      { value: 'none',    label: 'None' },
      { value: 'drift',   label: 'Drift Field' },
      { value: 'swarm',   label: 'Swarm Scatter' },
      { value: 'slice',   label: 'Scan Slice' },
      { value: 'contour', label: 'Depth Contours' },
      { value: 'rift',    label: 'Signal Rift' },
      { value: 'prism',   label: 'Prism Split' },
      { value: 'fog',     label: 'Fog Veil' },
    ],
    default: 'none' },
  { kind: 'slider', key: 'filterAmount', label: 'Amount', group: 'Filter Gesture',
    min: 0, max: 1.5, step: 0.01, default: 0.75 },
  { kind: 'select', key: 'filterAxis', label: 'Axis', group: 'Filter Gesture',
    options: [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z / Depth' },
      { value: 'radial', label: 'Radial' },
    ],
    default: 'z' },
  { kind: 'slider', key: 'filterSpeed', label: 'Motion Speed', group: 'Filter Gesture',
    min: -2, max: 2, step: 0.01, default: 0.2 },
  { kind: 'slider', key: 'filterPhase', label: 'Phase', group: 'Filter Gesture',
    min: -1, max: 1, step: 0.01, default: 0.0 },
  { kind: 'slider', key: 'filterWidth', label: 'Width', group: 'Filter Gesture',
    min: 0.005, max: 1.5, step: 0.005, default: 0.18 },
  { kind: 'slider', key: 'filterSoftness', label: 'Softness', group: 'Filter Gesture',
    min: 0.005, max: 0.75, step: 0.005, default: 0.08 },
  { kind: 'slider', key: 'contourBands', label: 'Contour Bands', group: 'Filter Gesture',
    min: 2, max: 48, step: 1, default: 12 },
  { kind: 'slider', key: 'fogDensity', label: 'Fog Density', group: 'Filter Gesture',
    min: 0, max: 3, step: 0.01, default: 0.0 },
  { kind: 'slider', key: 'fogOpacity', label: 'Fog Opacity', group: 'Filter Gesture',
    min: 0, max: 1, step: 0.01, default: 0.0 },
  { kind: 'color', key: 'fogColor', label: 'Fog Color', group: 'Filter Gesture', default: [5, 6, 9] },

  // ── Motion (Curl Wind + Anchor) ────────────────────────────────
  { kind: 'slider', key: 'windStrength', label: 'Wind Strength', group: 'Motion',
    min: 0, max: 1.0, step: 0.005, default: 0.05 },
  { kind: 'slider', key: 'windScale',    label: 'Wind Scale',    group: 'Motion',
    min: 0.2, max: 6, step: 0.05, default: 1.0 },
  { kind: 'slider', key: 'anchorPull',   label: 'Anchor Pull',   group: 'Motion',
    min: 0, max: 8, step: 0.05, default: 2.0 },
  { kind: 'slider', key: 'damping',      label: 'Damping',       group: 'Motion',
    min: 0, max: 3, step: 0.01, default: 0.8 },

  // ── Audio reactivity ───────────────────────────────────────────
  // Burst explosion impulse on bass hits + treble shimmer. The
  // runner pumps the bands; user just chooses gain.
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio',
    default: true },
  { kind: 'slider', key: 'burstGain',  label: 'Bass Burst Gain', group: 'Audio',
    min: 0, max: 3, step: 0.05, default: 0.6 },
  { kind: 'slider', key: 'burstDecay', label: 'Bass Burst Decay', group: 'Audio',
    min: 0.5, max: 8, step: 0.1, default: 2.5 },
  { kind: 'slider', key: 'shimmerStrength', label: 'Treble Shimmer', group: 'Audio',
    min: 0, max: 0.2, step: 0.001, default: 0.02 },

  // ── Proximity Wave ─────────────────────────────────────────────
  // A "field sphere" orbits through the cloud, pushing nearby points
  // outward as it passes. Smooth radial falloff = clean ring of
  // displacement around the sphere's surface.
  { kind: 'toggle', key: 'waveEnabled', label: 'Enable Wave', group: 'Proximity Wave',
    default: true },
  { kind: 'slider', key: 'waveSpeed', label: 'Orbit Speed', group: 'Proximity Wave',
    min: 0, max: 4, step: 0.01, default: 0.6, showWhen: { waveEnabled: true } },
  { kind: 'slider', key: 'waveOrbitRadius', label: 'Orbit Radius', group: 'Proximity Wave',
    min: 0, max: 1.5, step: 0.01, default: 0.8, showWhen: { waveEnabled: true } },
  { kind: 'slider', key: 'waveRadius', label: 'Field Radius', group: 'Proximity Wave',
    min: 0.05, max: 1.5, step: 0.01, default: 0.3, showWhen: { waveEnabled: true } },
  { kind: 'slider', key: 'waveFalloff', label: 'Field Softness', group: 'Proximity Wave',
    min: 0.02, max: 1, step: 0.01, default: 0.2, showWhen: { waveEnabled: true } },
  { kind: 'slider', key: 'waveStrength', label: 'Push Strength', group: 'Proximity Wave',
    min: 0, max: 3, step: 0.01, default: 0.8, showWhen: { waveEnabled: true } },

  // ── Twist & Voxel (geometry effects) ───────────────────────────
  // Twist: rotate XZ around Y by an angle proportional to height.
  // Crank it up for candy-stripe spirals; pair with auto-rotate Y
  // for hypnotic helix motion.
  // Voxel: snap home positions to a 3D grid. Mix between unsnapped
  // and snapped lets users dial chunky cubism in / out smoothly.
  { kind: 'slider', key: 'twistAmount', label: 'Twist (height-driven)', group: 'Geometry',
    min: -6.28, max: 6.28, step: 0.05, default: 0 },
  { kind: 'slider', key: 'voxelMix', label: 'Voxelize', group: 'Geometry',
    min: 0, max: 1, step: 0.01, default: 0 },
  { kind: 'slider', key: 'voxelSize', label: 'Voxel Size', group: 'Geometry',
    min: 0.01, max: 0.5, step: 0.005, default: 0.1,
    showWhen: { /* shown whenever voxelMix > 0; the panel doesn't
                  do numeric-comparison showWhen yet so we leave
                  this always-shown. */ } },

  // ── Color Mode ─────────────────────────────────────────────────
  // The aesthetic heart of the shader. Mode picks how each particle
  // gets colored; the map drives WHICH value indexes the palette.
  { kind: 'select', key: 'colorMode', label: 'Color Mode', group: 'Color Mode',
    options: [
      { value: 'source',    label: 'Source (from file)' },
      { value: 'solid',     label: 'Solid' },
      { value: 'gradient2', label: '2-Stop Gradient' },
      { value: 'gradient3', label: '3-Stop Gradient' },
      { value: 'palette4',  label: '4-Color Palette' },
      { value: 'rainbow',   label: 'Rainbow Cycle' },
      { value: 'random',    label: 'Random per Particle' },
    ],
    default: 'source' },
  { kind: 'select', key: 'colorMap', label: 'Mapping', group: 'Color Mode',
    options: [
      { value: 'index',     label: 'Particle Index (multi-color worms)' },
      { value: 'depth-z',   label: 'Depth — World Z (back/front)' },
      { value: 'depth-cam', label: 'Depth — From Camera' },
      { value: 'radial',    label: 'Radial — Distance From Center' },
      { value: 'y-axis',    label: 'Vertical — Y Height' },
      { value: 'luminance', label: 'Source Luminance' },
      { value: 'noise',     label: 'Noise — Organic Patches' },
    ],
    default: 'index' },
  { kind: 'slider', key: 'colorMix', label: 'Mix (source ↔ custom)', group: 'Color Mode',
    min: 0, max: 1, step: 0.01, default: 1.0 },
  { kind: 'slider', key: 'colorMapScale', label: 'Map Range', group: 'Color Mode',
    min: 0.1, max: 5, step: 0.05, default: 1.0 },
  { kind: 'slider', key: 'colorMapOffset', label: 'Map Offset', group: 'Color Mode',
    min: -1, max: 1, step: 0.01, default: 0.0 },
  { kind: 'slider', key: 'colorCycleSpeed', label: 'Cycle Speed', group: 'Color Mode',
    min: -2, max: 2, step: 0.01, default: 0.0 },

  // ── Color Stops ────────────────────────────────────────────────
  // Four pickers feed the gradient / palette modes. Stored as
  // [r,g,b] in 0-255 to match the convention used everywhere else
  // in the codebase (light painting, etc.). The wrapper normalizes
  // to 0..1 before pushing to the GPU.
  { kind: 'color', key: 'colorA', label: 'Color A', group: 'Color Stops', default: [60, 100, 240] },
  { kind: 'color', key: 'colorB', label: 'Color B', group: 'Color Stops', default: [240, 60, 180] },
  { kind: 'color', key: 'colorC', label: 'Color C', group: 'Color Stops', default: [255, 200, 30] },
  { kind: 'color', key: 'colorD', label: 'Color D', group: 'Color Stops', default: [40, 220, 220] },

  // ── Random Hue Params ──────────────────────────────────────────
  { kind: 'slider', key: 'randomSat', label: 'Random Saturation', group: 'Random Hue',
    min: 0, max: 1, step: 0.01, default: 0.85,
    showWhen: { colorMode: 'random' } },
  { kind: 'slider', key: 'randomVal', label: 'Random Brightness', group: 'Random Hue',
    min: 0.1, max: 2, step: 0.01, default: 1.0,
    showWhen: { colorMode: 'random' } },

  // ── Global Color Adjust (applied AFTER mode) ───────────────────
  { kind: 'slider', key: 'hueShiftSpeed', label: 'Hue Shift Speed', group: 'Color Adjust',
    min: -1, max: 1, step: 0.005, default: 0.05 },
  { kind: 'slider', key: 'saturation',   label: 'Saturation',      group: 'Color Adjust',
    min: 0, max: 2, step: 0.01, default: 1.0 },
  { kind: 'slider', key: 'brightness',   label: 'Brightness',      group: 'Color Adjust',
    min: 0.1, max: 3, step: 0.01, default: 1.0 },

  // ── Dissolve ───────────────────────────────────────────────────
  { kind: 'slider', key: 'dissolveRadius', label: 'Dissolve Radius', group: 'Dissolve',
    min: 0, max: 2, step: 0.01, default: 10.0 },
  { kind: 'slider', key: 'dissolveSoftness', label: 'Dissolve Softness', group: 'Dissolve',
    min: 0.005, max: 0.5, step: 0.005, default: 0.05 },

  // ── Object Rotation ────────────────────────────────────────────
  // Rotate the CLOUD around its OWN center (which sits at the world
  // origin after the centroid normalization). Static sliders pose
  // the cloud; auto-rotate sliders spin it continuously, additively.
  // Auto values are in degrees/second so visually-paced numbers
  // (5°/s = lazy, 60°/s = energetic) are intuitive.
  { kind: 'angle',  key: 'rotateX', label: 'Rotate X (Pitch)', group: 'Object Rotation', default: 0 },
  { kind: 'angle',  key: 'rotateY', label: 'Rotate Y (Yaw)',   group: 'Object Rotation', default: 0 },
  { kind: 'angle',  key: 'rotateZ', label: 'Rotate Z (Roll)',  group: 'Object Rotation', default: 0 },
  { kind: 'slider', key: 'autoRotateX', label: 'Auto-Spin X', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 0 },
  { kind: 'slider', key: 'autoRotateY', label: 'Auto-Spin Y', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 8 },
  { kind: 'slider', key: 'autoRotateZ', label: 'Auto-Spin Z', group: 'Object Rotation',
    min: -180, max: 180, step: 0.5, default: 0 },

  // ── Camera ─────────────────────────────────────────────────────
  // The camera stays straight-on; object rotation handles framing.
  // FOV + distance are all you need.
  { kind: 'slider', key: 'fovDeg',  label: 'FOV',      group: 'Camera',
    min: 20, max: 100, step: 1, default: 50 },
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 0.5, max: 8, step: 0.05, default: 2.5 },
];

export const pointCloudFXParamDefaults = deriveDefaults(pointCloudFXParamSchema);

export class WebGPUPointCloudFXShader implements GpuShaderImpl {
  private inner: WebGPUPointCloudFX;
  private bands: { bass: number; mid: number; treble: number } | null = null;
  private lastParams: Record<string, any> = { ...pointCloudFXParamDefaults };
  // Track which buffer hash we last loaded so we don't re-decode the
  // same file every time the user touches an unrelated knob.
  private loadedBufferKey: string = '';

  constructor(device: any, presentFormat: any) {
    this.inner = new WebGPUPointCloudFX(device, presentFormat);
  }

  setBands(bass: number, mid: number, treble: number): void {
    this.bands = { bass, mid, treble };
    this.applyParamsToInner();
  }

  setParams(p: Record<string, any>): void {
    this.lastParams = { ...pointCloudFXParamDefaults, ...p };
    this.applyParamsToInner();
  }

  /** The panel's `color` ParamControl stores [r,g,b] as integers
   *  0-255 (matches the light-painting / palette convention). The
   *  renderer wants 0..1 RGB. This normalizes + clamps so a bad
   *  value doesn't blow up the gradient lookup. */
  private rgb01(c: any, fallback: [number, number, number]): [number, number, number] {
    if (!Array.isArray(c) || c.length < 3) return fallback;
    return [
      Math.max(0, Math.min(1, (c[0] ?? 0) / 255)),
      Math.max(0, Math.min(1, (c[1] ?? 0) / 255)),
      Math.max(0, Math.min(1, (c[2] ?? 0) / 255)),
    ];
  }

  private applyParamsToInner(): void {
    const p = this.lastParams;
    const reactive = !!p.audioReactive && this.bands;
    const liveBass = reactive ? this.bands!.bass : 0;
    const liveTreble = reactive ? this.bands!.treble : 0;
    this.inner.setParams({
      topology: (p.topology ?? 'points') as PointCloudFXParams['topology'],
      pointSize: p.pointSize ?? 0.006,
      opacity: p.opacity ?? 1.0,
      windStrength: p.windStrength ?? 0.05,
      windScale: p.windScale ?? 1.0,
      anchorPull: p.anchorPull ?? 2.0,
      damping: p.damping ?? 0.8,
      twistAmount: p.twistAmount ?? 0,
      voxelMix: p.voxelMix ?? 0,
      voxelSize: p.voxelSize ?? 0.1,
      bass: liveBass,
      treble: liveTreble,
      shimmerStrength: p.shimmerStrength ?? 0.02,
      burstGain: p.burstGain ?? 0.6,
      burstDecay: p.burstDecay ?? 2.5,
      waveEnabled: !!p.waveEnabled,
      waveSpeed: p.waveSpeed ?? 0.6,
      waveOrbitRadius: p.waveOrbitRadius ?? 0.8,
      waveRadius: p.waveRadius ?? 0.3,
      waveFalloff: p.waveFalloff ?? 0.2,
      waveStrength: p.waveStrength ?? 0.8,
      hueShiftSpeed: p.hueShiftSpeed ?? 0.05,
      saturation: p.saturation ?? 1.0,
      brightness: p.brightness ?? 1.0,
      colorMode: (p.colorMode ?? 'source') as ColorMode,
      colorMap:  (p.colorMap  ?? 'index')  as ColorMap,
      colorMix: p.colorMix ?? 1.0,
      colorMapScale: p.colorMapScale ?? 1.0,
      colorMapOffset: p.colorMapOffset ?? 0.0,
      colorCycleSpeed: p.colorCycleSpeed ?? 0.0,
      randomSat: p.randomSat ?? 0.85,
      randomVal: p.randomVal ?? 1.0,
      filterMode: (p.filterMode ?? 'none') as PointCloudFilterMode,
      filterAxis: (p.filterAxis ?? 'z') as PointCloudFilterAxis,
      filterAmount: p.filterAmount ?? 0.75,
      filterSpeed: p.filterSpeed ?? 0.2,
      filterPhase: p.filterPhase ?? 0.0,
      filterWidth: p.filterWidth ?? 0.18,
      filterSoftness: p.filterSoftness ?? 0.08,
      contourBands: p.contourBands ?? 12,
      fogDensity: p.fogDensity ?? 0.0,
      fogOpacity: p.fogOpacity ?? 0.0,
      fogColor: this.rgb01(p.fogColor, [0.02, 0.025, 0.035]),
      colorA: this.rgb01(p.colorA, [0.24, 0.39, 0.94]),
      colorB: this.rgb01(p.colorB, [0.94, 0.24, 0.71]),
      colorC: this.rgb01(p.colorC, [1.00, 0.78, 0.12]),
      colorD: this.rgb01(p.colorD, [0.16, 0.86, 0.86]),
      dissolveRadius: p.dissolveRadius ?? 10.0,
      dissolveSoftness: p.dissolveSoftness ?? 0.05,
      strokeLength: p.strokeLength ?? 0.04,
      strokeWidth: p.strokeWidth ?? 0.004,
      fovDeg: p.fovDeg ?? 50,
      cameraZ: p.cameraZ ?? 2.5,
      rotateX: p.rotateX ?? 0,
      rotateY: p.rotateY ?? 0,
      rotateZ: p.rotateZ ?? 0,
      autoRotateX: p.autoRotateX ?? 0,
      autoRotateY: p.autoRotateY ?? 8,
      autoRotateZ: p.autoRotateZ ?? 0,
    });
  }

  /** Point-cloud-specific source path. Called by gpuLayerRenderer
   *  when it detects a .ply or .splat URL. `key` is a unique-per-
   *  source-pick string the runner uses to avoid re-loading the same
   *  file when only unrelated params changed. */
  setSourceBuffer(buf: ArrayBuffer, kind: 'ply' | 'splat', key: string): void {
    if (key === this.loadedBufferKey) return;
    let data: PLYData;
    try {
      data = kind === 'splat' ? parseSplatBuffer(buf) : parsePLYBuffer(buf);
    } catch (e: any) {
      console.warn('[pointcloud-fx] parse failed:', e?.message || e);
      return;
    }
    if (!data.vertices || data.vertices.length === 0) {
      console.warn('[pointcloud-fx] empty point cloud — nothing to render');
      return;
    }
    // Convert into the Float32Array views the renderer wants. PLY
    // colors are 0..255; normalize to 0..1.
    const n = data.vertices.length;
    const positions = new Float32Array(n * 3);
    const colors    = new Float32Array(n * 3);
    const alpha = new Float32Array(n);
    const splatScale = new Float32Array(n * 3);
    const splatRotation = new Float32Array(n * 4);
    const shCoeffCount = data.sphericalHarmonicsCoefficientCount ?? 0;
    const shRestStride = shCoeffCount >= 9 ? 9 : 0;
    const shRest = shRestStride > 0 ? new Float32Array(n * shRestStride) : undefined;
    let gaussian = data.dataType === 'gaussian';
    for (let i = 0; i < n; i++) {
      const v = data.vertices[i];
      positions[i * 3 + 0] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      colors[i * 3 + 0] = Math.max(0, Math.min(1, (v.r ?? 255) / 255));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, (v.g ?? 255) / 255));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, (v.b ?? 255) / 255));
      alpha[i] = Math.max(0, Math.min(1, (v.a ?? 255) / 255));
      const scaleOff = i * 3;
      splatScale[scaleOff + 0] = Number.isFinite(v.scale_0) ? v.scale_0! : 0;
      splatScale[scaleOff + 1] = Number.isFinite(v.scale_1) ? v.scale_1! : 0;
      splatScale[scaleOff + 2] = Number.isFinite(v.scale_2) ? v.scale_2! : 0;
      if (
        Number.isFinite(v.scale_0) ||
        Number.isFinite(v.scale_1) ||
        Number.isFinite(v.scale_2)
      ) {
        gaussian = true;
      }
      const rotOff = i * 4;
      splatRotation[rotOff + 0] = Number.isFinite(v.rot_0) ? v.rot_0! : 1;
      splatRotation[rotOff + 1] = Number.isFinite(v.rot_1) ? v.rot_1! : 0;
      splatRotation[rotOff + 2] = Number.isFinite(v.rot_2) ? v.rot_2! : 0;
      splatRotation[rotOff + 3] = Number.isFinite(v.rot_3) ? v.rot_3! : 0;
      if (shRest && v.f_rest?.length) {
        const shOff = i * shRestStride;
        const copyCount = Math.min(shRestStride, v.f_rest.length);
        for (let j = 0; j < copyCount; j++) {
          const coeff = v.f_rest[j];
          shRest[shOff + j] = Number.isFinite(coeff) ? coeff : 0;
        }
      }
    }
    this.inner.setPointCloudData(positions, colors, {
      alpha,
      splatScale: gaussian ? splatScale : undefined,
      splatRotation: gaussian ? splatRotation : undefined,
      sphericalHarmonicsRest: shRest,
      sphericalHarmonicsRestStride: shRestStride,
      sphericalHarmonicsDegree: data.sphericalHarmonicsDegree ?? 0,
      sphericalHarmonicsCoefficientCount: shCoeffCount,
      gaussian,
    });
    this.loadedBufferKey = key;
  }

  // We don't consume 2D textures — but the runner may still hand us
  // a source via setSource when the user accidentally picks an image
  // file before realizing point clouds need PLY. Quietly ignore so
  // we don't crash the renderer.
  setSource(_source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap): void {
    /* unused — see setSourceBuffer above */
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
    // Clear our layer canvas before compositing; the renderer's
    // pass uses loadOp:'load' so it composites onto whatever's there.
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

  resize(_w: number, _h: number): void { /* no-op */ }

  dispose(): void {
    try { this.inner.dispose?.(); } catch { /* */ }
  }
}
