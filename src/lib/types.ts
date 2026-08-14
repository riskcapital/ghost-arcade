import type * as THREE from 'three';
import type { Fill, Stroke, Animation } from './drawing/types';
import type { LineElement, LinesContent } from './lines/types';
import { createDefaultLinesContent } from './lines/types';
export type { LinesContent };

// Import and re-export UUID utility for easy access
import { generateUUID } from './utils/uuid';
export { generateUUID };

// ============================================================================
// SHADER MANIFEST (v2)
// ============================================================================

export type ShaderTier = 'demo' | 'starter' | 'pro';

export interface ShaderManifestEntry {
  file: string;
  tier: ShaderTier;
  category: string;
  tags: string[];
  defaults: Record<string, any>;
  featured: boolean;
}

export interface ShaderManifestV2 {
  version: 2;
  shaders: ShaderManifestEntry[];
}

// Core types for the projection mapping system

export interface Point2D {
  x: number;
  y: number;
}

export interface BezierPoint extends Point2D {
  cpIn?: Point2D;   // Control handle into this anchor (absolute UV coords)
  cpOut?: Point2D;  // Control handle out of this anchor (absolute UV coords)
}

export interface WarpCorners {
  topLeft: Point2D;
  topRight: Point2D;
  bottomLeft: Point2D;
  bottomRight: Point2D;
}

export interface MeshWarpGrid {
  rows: number;
  cols: number;
  points: Point2D[][]; // [row][col]
}

export type WarpMode = 'corners' | 'mesh' | 'edge' | 'none';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'difference'
  | 'add'
  | 'subtract'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'exclusion'
  | 'hardlight'
  | 'softlight'
  | 'color-dodge'
  | 'color-burn'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'divide'
  | 'average'
  | 'negation'
  | 'phoenix'
  | 'linear-light'
  | 'hard-mix'
  | 'vivid-light'
  | 'pin-light';

export type MediaType =
  | 'image'
  | 'video'
  | 'shader'
  | 'color'
  | 'threejs'
  | 'p5js'
  | 'javascript'
  | 'spout'
  | 'effect'
  | 'synthvision';

// Integrated effect types (FluidGen, Particles3D, Point Cloud, 3D Models running natively in WebGL)
export type IntegratedEffectType = 'fluid' | 'particles' | 'splat' | 'model3d' | 'milkdrop' | 'audiomotion' | 'wavejs' | 'hydra' | 'ghostfx' | 'analyzerlab' | 'handfx' | 'ghostpilot' | 'vj-crossfade' | 'vj-mix' | 'performer-world';

// Stem identifiers for the multi-stem routing matrix (Milkdrop plugin).
// 'full' is the unsplit mix; the rest match standard Demucs output names plus a
// few common DAW stem buses. Routing matrix cells are stored as
// Record<MilkdropStem, Record<MilkdropTarget, number>>.
export type MilkdropStem =
  | 'full'
  | 'drums'
  | 'bass'
  | 'vocals'
  | 'other'
  | 'ch1'
  | 'ch2'
  | 'ch3'
  | 'ch4'
  | 'ch5'
  | 'ch6'
  | 'ch7'
  | 'ch8';
export type MilkdropTarget = 'bass' | 'mid' | 'treb';

// Integrated effect source configuration
export interface IntegratedEffectSource {
  effectType: IntegratedEffectType;
  // Shared params
  cameraEnabled?: boolean;     // Use webcam as input feed
  // Native Performer world overlay
  performerWorldIndex?: number;
  performerWorldSpace?: number;
  performerWorldX?: number;
  performerWorldY?: number;
  performerWorldPointerDown?: boolean;
  performerWorldParams?: number[];
  performerWorldPump?: number;
  // Fluid simulation params
  fluidMode?: number;      // 0=SMOKE, 1=FIRE, 2=INK, 3=NEON, 4=THERMAL
  fluidViscosity?: number;
  fluidVorticity?: number;
  fluidDissipation?: number;     // Density decay (0=persistent, 5=fast fade)
  fluidVelDissipation?: number;  // Velocity decay
  fluidForceScale?: number;      // Mouse/camera force multiplier (50-2000)
  fluidPressureIters?: number;   // Pressure solve quality (2-40)
  fluidCameraStrength?: number;  // Camera motion sensitivity (0.5-10)
  fluidIntensity?: number;
  fluidContrast?: number;
  fluidSaturation?: number;
  fluidHueShift?: number;
  fluidGlow?: number;
  fluidColor?: [number, number, number];    // Fluid injection color
  fluidBgColor?: [number, number, number];  // Background color
  // Particle system params
  particleMode?: number;   // 0=SPHERES, 1=TENDRILS, 2=VOXELS, 3=POINTCLOUD
  particleCount?: number;
  particleSize?: number;
  particleSpeed?: number;
  particleGravity?: number;
  particleTurbulence?: number;
  particleVortex?: number;
  particleDrag?: number;
  particleMouseForce?: number;
  particleMouseRadius?: number;
  particleEmission?: number;
  particleBloom?: number;
  particleBloomThreshold?: number;
  particleMaterial?: number;  // 0=Chrome, 1=Glass, 2=Neon, 3=Wire, 4=Soft
  particleColorA?: [number, number, number];
  particleColorB?: [number, number, number];
  particleColorC?: [number, number, number];
  particleColorMode?: number;          // 0=Tri-color 1=Rainbow 2=Monochrome 3=Temperature 4=Pulse
  particleConnectors?: boolean;       // Show connector lines between nearby particles
  particleConnectorDist?: number;     // Max distance for connectors (1-20)
  particleConnectorOpacity?: number;  // Connector line opacity (0-1)
  particleTextureUrl?: string;        // Blob URL for image/video texture
  particleLightCount?: number;
  particleLightIntensity?: number;
  particleLightOrbitSpeed?: number;
  particleLightColorA?: [number, number, number];  // Light tint colors
  particleLightColorB?: [number, number, number];
  particleLightConeAngle?: number;  // Spotlight cone width in radians
  particleAmbient?: number;
  particleAutoRotate?: boolean;
  particleRotationSpeed?: number;
  // Point cloud / splat params (full config stored here for VJ clips)
  splatContent?: SplatContent;
  // 3D Model params (full config stored here for VJ clips)
  model3dContent?: Model3DContent;
  // Milkdrop (Butterchurn) params
  milkdropPresetName?: string;           // currently-active preset (undefined = first available)
  milkdropPresetPack?: string;           // 'minimal' | 'full' | 'extra' | 'extra2' | 'md1' (default 'minimal')
  milkdropBlendTime?: number;            // seconds for preset crossfade (0–10, default 2.7)
  milkdropAutoEvolve?: boolean;          // cycle through presets automatically
  milkdropEvolveMode?: number;           // 0=timer 1=beat-sync
  milkdropEvolveInterval?: number;       // seconds (timer mode) — 5–120, default 22
  milkdropEvolveBars?: number;           // bars (beat-sync mode, assumes 4/4) — 1–32, default 8
  milkdropSensitivity?: number;          // global audio gain into butterchurn (0.5–4, default 1.5)
  milkdropBassGain?: number;             // per-band trim (placeholder until phase 2 routing)
  milkdropMidGain?: number;
  milkdropTrebGain?: number;
  milkdropHardCutEnabled?: boolean;      // cut to a fresh preset on big beats
  milkdropHardCutThreshold?: number;     // beat intensity threshold for hard cut (0.3–1.5)
  milkdropMeshSize?: number;             // warp mesh resolution 32–96 (perf knob, default 48)
  milkdropPixelRatio?: number;           // render scale 0.5–2 (perf knob, default 1)
  milkdropStemSourceId?: string;         // id of the active stem source (multiStemStore key) — empty = use built-in single-channel audio
  milkdropRoutingMatrix?: Record<string, Record<string, number>>;  // stem -> {bass,mid,treb} gain 0–2
  // AudioMotion params (audiomotion-analyzer by Henrique Vianna, AGPL-3.0)
  audiomotionMode?: number;             // 0=Discrete, 1..8=Octave bands, 10=Line, 11=Area
  audiomotionGradient?: string;
  audiomotionRadial?: boolean;
  audiomotionBarStyle?: 'normal' | 'led' | 'lumi' | 'alpha' | 'outline';
  audiomotionPeakLine?: boolean;        // continuous peak line — Line/Area modes only
  audiomotionShowPeaks?: boolean;       // falling peak indicators — bar modes only, hidden when barStyle='lumi'
  audiomotionReflexRatio?: number;
  audiomotionMirror?: number;           // -1, 0, 1 — horizontal mirror
  audiomotionFlipY?: boolean;           // flip vertically (bars hang from top)
  audiomotionBarSpace?: number;
  audiomotionMinFreq?: number;
  audiomotionMaxFreq?: number;
  audiomotionSensitivity?: number;      // 0=low, 1=normal, 2=high
  audiomotionBgAlpha?: number;
  audiomotionSmoothing?: number;
  // Wave.js params (@foobar404/wave by Curtis Hutten / Austin Michaud, MIT)
  wavejsAnimation?:
    | 'Wave'
    | 'Arcs'
    | 'Circles'
    | 'Cubes'
    | 'Flower'
    | 'Glob'
    | 'Lines'
    | 'Shine'
    | 'Square'
    | 'Turntable';
  wavejsSensitivity?: number;             // input gain (0.25..6) applied before FFT
  wavejsLineWidth?: number;
  wavejsColorA?: [number, number, number];
  wavejsColorB?: [number, number, number];
  wavejsUseGradient?: boolean;
  wavejsGradientRotate?: number;
  wavejsGlowStrength?: number;
  wavejsGlowColor?: [number, number, number];
  wavejsBgAlpha?: number;
  wavejsFlipY?: boolean;
  // Hydra params (hydra-synth by Olivia Jack, AGPL)
  hydraSketchName?: string;
  hydraSketchCode?: string;
  hydraSensitivity?: number;
  hydraBgAlpha?: number;
  // Analyzer Lab params (original Canvas-2D multi-panel analyzer)
  analyzerLabLayout?: 'stack' | 'spectrogram' | 'chromagram' | 'waveform' | 'mirror';
  analyzerLabColormap?: 'inferno' | 'viridis' | 'magma' | 'coral' | 'ice' | 'mono';
  analyzerLabSpectroOrientation?: 'horizontal' | 'vertical' | 'radial';
  analyzerLabSpectroGain?: number;       // 0..2
  analyzerLabSpectroMinDb?: number;      // -110..-40
  analyzerLabSpectroMaxDb?: number;      // -40..0
  analyzerLabScrollSpeed?: number;       // 0.25..4
  analyzerLabChromaStyle?: 'bars' | 'radial';
  analyzerLabChromaGlow?: number;        // 0..1
  analyzerLabWaveStyle?: 'line' | 'mirror' | 'filled';
  analyzerLabWaveLineWidth?: number;     // 1..4
  analyzerLabShowBeats?: boolean;
  analyzerLabBgAlpha?: number;           // 0..1
  analyzerLabShowLabels?: boolean;
  // HandFX params (MediaPipe-driven hand visualizer)
  handfxMode?: 'panel' | 'trails' | 'aurora' | 'skeleton' | 'bursts';
  handfxCameraOn?: boolean;
  handfxSmoothing?: number;
  handfxPredictMs?: number;
  handfxPanelColor?: string;
  handfxPanelOpacity?: number;
  handfxPanelPadding?: number;
  handfxPanelCornerRadius?: number;
  // Paint mode (mode === 'trails')
  handfxTrailFade?: number;
  handfxTrailColorMode?: 'rainbow' | 'coral' | 'white' | 'cyan';
  handfxTrailThickness?: number;
  handfxTrailVelocityScale?: number;
  handfxTrailSparkDensity?: number;
  handfxTrailFlowStrength?: number;
  // Ink mode (mode === 'aurora')
  handfxInkColorMode?: 'rainbow' | 'coral' | 'white' | 'cyan';
  handfxInkSize?: number;
  handfxInkOpacity?: number;
  handfxInkDrift?: number;
  // Skeleton
  handfxSkeletonColor?: string;
  handfxSkeletonGlow?: number;
  // Pinch spray (mode === 'bursts')
  handfxSprayColorMode?: 'rainbow' | 'coral' | 'white' | 'cyan';
  handfxSprayIntensity?: number;
  handfxSprayThreshold?: number;
  // Global
  handfxBgAlpha?: number;
  handfxShowHelp?: boolean;
  handfxShowCamera?: boolean;
  handfxCameraOpacity?: number;
  // Ghost Pilot params (playable, audio-built world flown with a gamepad)
  ghostpilotSensitivity?: number;       // 0.25..4 — audio drive multiplier
  ghostpilotSpeedScale?: number;        // 0.5..2.5 — throttle/cruise multiplier
  ghostpilotHueBase?: number;           // 0..1 — palette base rotation
  ghostpilotAutopilot?: boolean;        // allow idle autopilot takeover
  ghostpilotSteerAssist?: number;       // 0..1 — banking/yaw coupling to steer
  // GhostFX params (original WebGPU visualizer by Ghost Arcade)
  ghostfxScenePreset?: string;          // 'drift' (v5); more in later sessions
  ghostfxSensitivity?: number;          // 0.25..4 — audio drive multiplier
  ghostfxHueDriftSpeed?: number;        // 0..2 — palette rotation rate
  ghostfxBloomIntensity?: number;       // 0..3 — bloom add-back at composite
  ghostfxBloomThreshold?: number;       // 0..2 — bright pass threshold
  ghostfxVignette?: number;             // 0..1 — vignette strength
  ghostfxExposure?: number;             // -1..1 — post-bloom exposure trim
  ghostfxBgAlpha?: number;              // 0..1 — clear alpha
  // Drift-scene controls
  ghostfxVortexStrength?: number;       // 0..6 — curl-noise force gain
  ghostfxLatticeThreshold?: number;     // 0..6 — max neighbor distance for connecting lines
  ghostfxTrailIntensity?: number;       // 0..2 — trail brightness
  ghostfxFeedbackAmount?: number;       // 0..1 — frame-feedback echo (wired in 5.5)
  ghostfxFeedbackZoom?: number;         // 0.985..1.015 — per-frame zoom of feedback
  // Ribbons-scene controls
  ghostfxRibbonWidth?: number;          // 0.02..0.30 — head width (world units)
  ghostfxRibbonSpawn?: number;          // 0.2..3.0 — spawn-probability multiplier
  ghostfxRibbonTranslucency?: number;   // 0..1 — alpha gain (glass blend)
  ghostfxRibbonBlend?: 'additive' | 'lighten' | 'glass';
  ghostfxLightAzimuth?: number;         // 0..360 — light yaw degrees
  ghostfxLightElevation?: number;       // -90..90 — light pitch degrees
  ghostfxLightStrength?: number;        // 0..2 — directional light intensity
  ghostfxAmbient?: number;              // 0..1 — ambient floor
  // Liquid-scene controls
  ghostfxLiquidSplatForce?: number;     // 0.2..3.0 — impulse intensity
  ghostfxLiquidSplatRadius?: number;    // 0.01..0.20 — drop radius (uv)
  ghostfxLiquidDyeDecay?: number;       // 0.985..1.0 — dye fade per frame
  ghostfxLiquidVelDecay?: number;       // 0.95..1.0 — velocity damping
  ghostfxLiquidBassRate?: number;       // 0..2 — bass-driven splat rate multiplier
  // VJ crossfade carrier params (vj-xfade-N synthetic layers)
  vjxfadeLayerA?: string;               // Bank A composited layer id
  vjxfadeLayerB?: string;               // Bank B composited layer id
  vjxfadeOpacityA?: number;             // 0..1 — Bank A opacity
  vjxfadeOpacityB?: number;             // 0..1 — Bank B opacity
  vjxfadeMix?: number;                  // 0..1 — post-curve fader value
  vjxfadeTransition?: string;           // transition id (vjCrossfadeNative.ts)
  vjxfadeBlend?: string;                // overlap blend mode
  // VJ Mix carrier params (__vj-mix__ synthetic layer): all VJ rows,
  // ordered bottom→top, post-crossfade, with per-row opacity + blend.
  vjmixRows?: Array<{ layerId: string; opacity: number; blendMode: string }>;
}

// Spout source configuration (for plugin integrations)
export interface SpoutSource {
  name?: string;         // Legacy: Spout sender name (deprecated, use senderName)
  senderName: string;    // Spout sender name (e.g., 'FluidGen', 'Particles3D')
  pluginId?: string;     // Plugin identifier for controls
  width?: number;        // Optional resolution hint
  height?: number;       // Optional resolution hint
}

/** NDI receiver source — the name string is what the native addon
 *  uses to resolve the discovered network sender to an actual receiver
 *  instance. width / height are hints set after the first frame
 *  arrives so the engine can size its target texture early. */
export interface NdiSource {
  senderName: string;    // NDI source name as discovered on the network
  width?: number;
  height?: number;
}

// JavaScript animation types (Three.js or p5.js)
export type JSAnimationType = 'threejs' | 'p5js';

// JavaScript animation source (for user-created/AI-generated animations)
export interface JSAnimationSource {
  animationType: JSAnimationType;
  htmlCode: string;  // Complete HTML file content
  params?: Array<{
    name: string;
    type: 'number' | 'boolean' | 'color';
    default: number | boolean | number[];
    min?: number;
    max?: number;
    label?: string;
  }>;
  paramValues?: Record<string, number | boolean | number[]>;
  aiGenerated?: boolean;
  aiPrompt?: string;  // Original prompt used to generate
}

// Content fit modes for how source content maps to the layer quad
// 'stretch' = distort to fill (default), 'fill' = maintain aspect + crop overflow (CSS cover), 'crop' = maintain aspect + letterbox (CSS contain)
export type ContentFitMode = 'stretch' | 'fill' | 'crop';

export type LayerType =
  | 'media'
  | 'mask'
  | 'lines'
  | 'svg'
  | 'color'
  | 'lightpainting'
  | 'adv-lightpaint'
  | 'text'
  | 'splat'
  | 'model3d'
  | 'screen'
  | 'group'
  | 'pixel-fx'
  | 'gpu'
  | 'arcade';

/**
 * GPU layer — hosts a swappable WebGPU shader (similar to how a
 * media layer hosts a swappable shader/video/image). Shaders are
 * defined in the GPU shader registry (gpuShaderCatalog.ts); each
 * has its own param schema. Switching shaders mid-session is cheap.
 *
 * Renders to its own OffscreenCanvas so the existing engine pipeline
 * handles warp / blend / mesh / per-layer effects normally — the
 * GPU layer behaves exactly like a media layer from the engine's
 * point of view. Just the SOURCE of the pixels is a WebGPU shader
 * instead of a video/image/glsl-shader.
 */
export interface GPULayerContent {
  /** Shader id from the GPU shader registry (e.g. 'planet',
   *  'pixel-particles'). */
  shaderId: string;
  /** Active shader's params — keys + types are defined by the shader's
   *  paramSchema; the panel renders controls accordingly. Mirrors the
   *  current shader's slot from `paramsByShader` so the GPU runner,
   *  modulation system, and keyframe playback all read from one place. */
  params: Record<string, any>;
  /** Per-shader param history. Switching to a different shader stashes
   *  the current `params` under `paramsByShader[currentShaderId]` and
   *  restores `paramsByShader[newShaderId]` if it exists, falling back
   *  to defaults otherwise. Without this stash, the source picker
   *  selection (and every slider) would be wiped every time the user
   *  bounced between shaders. */
  paramsByShader?: Record<string, Record<string, any>>;
  /** Per-param auto-mode sidecar (playhead-driven sweep).
   *  Keyed by paramKey. Engine = autoEngine.ts which reads this
   *  field, advances phase, and writes back into `params`. */
  paramAuto?: Record<string, AutoConfig>;
  /** 0..1 — luminance-keyed background opacity. Default 1 = bg fully
   *  opaque (no keying). Lower values fade alpha proportionally to
   *  pixel brightness, so the shader's dark background becomes
   *  transparent while bright content stays solid. Applied at composite
   *  time by the layer's texture shader. */
  bgOpacity?: number;
}

export function createDefaultGPULayerContent(): GPULayerContent {
  // Default to planet — most visually striking out of the box.
  return {
    shaderId: 'planet',
    params: {},   // shader populates defaults from its schema on first render
  };
}

/**
 * Arcade layer — gamified, audio-reactive visuals that share the host's
 * audio bands, MIDI mapping, mesh warp, and effect chain. Each arcade
 * layer mounts a single game pack (`.gapack`) at runtime. The bundled
 * "Tendril Storm" pack is the default; future packs (community AGPL or
 * paid commercial) drop in via the same loader contract.
 *
 * Renders to its own OffscreenCanvas / WebGL render target so the
 * existing layer pipeline (warp / blend / per-layer effects /
 * compositor) handles the output exactly like any other layer. The
 * arcade engine is just the SOURCE of the pixels.
 */
export interface ArcadeLayerContent {
  /** Game pack id — matches `manifest.id` in the loaded .gapack. The
   *  bundled Tendril Storm pack uses id `ghostarcade.tendril-storm`. */
  packId: string;
  /** Active loadout id from the pack's `loadouts/`. The pack provides
   *  curated starter loadouts; this picks one. Null until the user
   *  chooses (defaults to the pack's first loadout at runtime). */
  loadoutId: string | null;
  /** World theme override — null means "use the pack's default theme"
   *  from world-theme.json. When set, this slot can be remapped to
   *  another of the pack's themes (e.g. dark/neon/wireframe variants). */
  themeId: string | null;
  /** Per-pack params (density / difficulty / spawn intensity / etc.).
   *  Keys + types defined by the active pack's manifest schema. The
   *  ArcadePanel renders controls accordingly. */
  params: Record<string, any>;
  /** Per-pack param history — same stash-on-switch pattern as
   *  GPULayerContent.paramsByShader, so swapping packs mid-session
   *  doesn't wipe the prior pack's tunings. */
  paramsByPack?: Record<string, Record<string, any>>;
  /** Controller binding overrides keyed by action id. Falls back to the
   *  pack's `controls.json` recommended bindings when unset. */
  controlOverrides?: Record<string, string>;
  /** Performer-only UI overlay (crosshair / combo meter / ultimate
   *  charge). Off by default so audience output stays clean — the
   *  performer can flip it on for their monitor. */
  showHUD?: boolean;
}

export function createDefaultArcadeContent(): ArcadeLayerContent {
  return {
    // Bundled pack id. PackLoader resolves this to the in-tree
    // welcome-showcase pack source until Phase 6 migrates it to the
    // .gapack runtime path.
    packId: 'ghostarcade.tendril-storm',
    loadoutId: null,
    themeId: null,
    params: {},
    showHUD: false,
  };
}

/**
 * PixelFX layer — turns any 2D source (image, video, canvas, shader)
 * into a cloud of GPU-animated particles. The source provides per-
 * particle color; the active mode drives the animation.
 *
 * sourceType + sourceUrl let us load by URL (drag-drop, MediaLibrary)
 * but we keep a runtime-only HTMLImageElement / blob handle as
 * `_runtimeSource` (not serialized) for hot reload performance.
 */
/** Pixel-FX rendering modes.
 *
 *   identity      — particle stays at its UV anchor (sanity check)
 *   depth-shift   — depth-mapped point cloud with lighting + noise
 *   sand-fall     — gravity drags particles down
 *   scatter       — random walk + slow recovery to anchor
 *   halftone      — particles snap to a coarse grid; size scales w/ luma
 *   stipple-noise — tight noise wobble around anchor (ink stipple)
 *   dissolve      — particles drift outward and fade
 *   flythrough    — endless point-cloud tunnel; camera flies through
 *                   N replicated slabs of the source. Optional worm-
 *                   stroke topology (extruded quads along velocity)
 *                   for a volumetric brush-stroke look. Dispatched to
 *                   a dedicated renderer (`WebGPUFlythrough`) rather
 *                   than the standard pixel-particles class because
 *                   the camera model + topology are fundamentally
 *                   different. See `flythrough*` fields below for
 *                   tuning. */
export type PixelFXMode =
  | 'identity'
  | 'depth-shift'
  | 'sand-fall'
  | 'scatter'
  | 'halftone'
  | 'stipple-noise'
  | 'dissolve'
  | 'flythrough';

/** Particle-rendering topology for the flythrough mode.
 *   points  — billboard sprites (cheap, classic point-cloud look)
 *   strokes — quads extruded along each particle's velocity vector
 *             for the "worms in fluid" / volumetric brush look. */
export type FlythroughTopology = 'points' | 'strokes';

/** Depth-source strategy for the flythrough mode. ML-based depth
 *  (Depth Anything V2 via ONNX) is reserved for a later iteration —
 *  would require an onnxruntime-node sidecar download. */
export type FlythroughDepthSource = 'luminance' | 'inverse-luminance' | 'edge-density';

export interface PixelFXContent {
  /** Where the source pixels come from. v1 supports:
   *    'media'  — sourceMediaId picks an item from the global Media
   *               Library (same items the Media Tray shows). Most
   *               common path — pick from your loaded clips/images.
   *    'layer'  — sourceLayerId points at another layer in the
   *               project; that layer's media is used as the source.
   *               Use when you've configured trim / playback on a
   *               media layer and want the pixel-fx to consume it.
   *    'image'  — sourceUrl points at a still image (file picker).
   *    'video'  — sourceUrl points at a video file (file picker). */
  sourceType: 'media' | 'image' | 'video' | 'layer' | 'canvas' | 'shader';
  /** URL or data URL of the source. For images, anything browsers
   *  can load. For videos, mp4/webm. Ignored when sourceType is
   *  'media' or 'layer'. */
  sourceUrl: string | null;
  /** Durable file identity — resolves sourceUrl on reload. */
  _sourceAssetRef?: import('./storage/assetRegistry').AssetRef;
  /** ID of a Media Library item to pull pixels from. The renderer
   *  reads the item's src (image) or videoElement (video) each
   *  frame so playback and replacement work transparently. */
  sourceMediaId?: string | null;
  /** ID of another layer in the project to read pixels from.
   *  v1 supports media layers (image / video). Other layer types
   *  (lines, svg, lightpainting, shader) need per-layer render-to-
   *  texture, queued for the next phase. */
  sourceLayerId?: string | null;
  /** The active effect mode. */
  mode: PixelFXMode;
  /** Per-mode tuning knobs — semantics vary by mode. The panel
   *  surfaces named sliders that map to these positions. */
  knobs: [number, number, number, number];
  /** Particle count. Higher = sharper image, more GPU. 250K is the
   *  sweet spot for 1080p output. */
  particleCount: number;
  /** Base billboard size in normalized canvas units. */
  baseSize: number;
  /** Global opacity envelope (0..1). */
  opacity: number;
  /** Anchor jitter to break grid banding (0..1). */
  anchorJitter: number;
  /** Camera FOV in degrees. Applies to ALL modes (not just depth-shift)
   *  so you can frame any effect properly. */
  fovDeg: number;
  /** Camera distance from origin along Z. Doubles as zoom — smaller
   *  value zooms in. */
  cameraZ: number;
  /** Camera yaw + pitch in degrees, applied around the world origin
   *  before perspective. Lets you orbit the scene from the panel. */
  cameraYaw?: number;
  cameraPitch?: number;
  /** Pan offset in normalized canvas units. Useful for off-center
   *  framing without rotating the camera. */
  panX?: number;
  panY?: number;

  /** ── Lighting (depth-shift mode) ──
   *  When enabled, particles are shaded by a movable point light
   *  with a Lambertian diffuse term computed from the source's
   *  luminance heightmap normal. Gives a real "lit and shadowed"
   *  3D look on the depth-shifted point cloud. */
  lightEnabled?: boolean;
  lightX?: number;       // -2..2  world X
  lightY?: number;       // -2..2  world Y
  lightZ?: number;       //  0..3  world Z (positive = in front of plane)
  lightIntensity?: number; // 0..3 multiplier on diffuse contribution
  lightAmbient?: number;   // 0..1 ambient term so unlit areas don't go pitch black
  lightHeightStrength?: number; // 0..3 scales the heightmap normal contribution

  /** ── Depth-shift noise displacement ──
   *  Adds a flowing noise field that wobbles each particle in
   *  XY (and optionally Z) over time. Works alongside auto-spin and
   *  camera orbit. Reads as the depth-mapped image gently flowing /
   *  breathing. */
  noiseAmpXY?: number;     // 0..0.4  XY displacement strength
  noiseAmpZ?: number;      // 0..2    Z displacement strength
  noiseFreq?: number;      // 0.5..30 spatial frequency
  noiseSpeed?: number;     // 0..3    time scale for animation

  /** ── Flythrough mode params ─────────────────────────────────────
   *  Only meaningful when `mode === 'flythrough'`. Routed to the
   *  dedicated `WebGPUFlythrough` renderer instead of the standard
   *  pixel-particles class. The visual: the source image / video is
   *  replicated into N "slabs" stacked along Z, and the camera
   *  continuously translates forward through them. As each slab
   *  passes behind the camera it wraps to the far end of the stack,
   *  producing an endless tunnel of the source. Particles within
   *  each slab swirl under a curl-noise velocity field; combined
   *  with stroke topology they read as fluid worms / brush strokes
   *  moving through the tunnel.
   */
  /** Particle-rendering topology. `strokes` extrudes each particle
   *  into a quad along its velocity vector — produces the volumetric
   *  brush-stroke / worm look. `points` is the cheap billboard path. */
  flythroughTopology?: FlythroughTopology;
  /** How depth is derived from the source pixels.
   *  `luminance`         — brighter pixels are closer (push toward camera)
   *  `inverse-luminance` — darker pixels are closer (good for backlit shots)
   *  `edge-density`      — high-contrast edges are closer (line-art look) */
  flythroughDepthSource?: FlythroughDepthSource;
  /** Camera Z-translation rate in world units per second. Positive
   *  values fly INTO the tunnel; negative values pull back out of it.
   *  Audio reactivity (when enabled) modulates this around the
   *  configured baseline. */
  flythroughFlySpeed?: number;       // -2..6
  /** Z extent of one source slab in world units. Smaller values stack
   *  more tightly; larger values spread the duplications out. */
  flythroughTunnelDepth?: number;    // 0.5..6
  /** How many duplicated slabs are visible at once. Bigger numbers
   *  produce a denser tunnel and cost linearly more on the GPU
   *  (instanced draws). */
  flythroughSlabCount?: number;      // 2..8 integer
  /** Curl-noise amplitude on per-particle velocity. 0 = particles
   *  ride exactly along the camera axis; higher = more swirl. */
  flythroughFlowStrength?: number;   // 0..2
  /** Spatial frequency of the curl-noise field. Higher = tighter
   *  swirls, more local detail. */
  flythroughFlowScale?: number;      // 0.5..8
  /** Pull factor toward each particle's source-UV anchor. Low =
   *  chaotic swirl that doesn't read as the source image. High =
   *  the image stays legible with subtle motion. */
  flythroughAnchorPull?: number;     // 0..3
  /** Stroke length in world units. Only used when topology is
   *  `strokes`. Longer strokes = more painterly streaks. */
  flythroughStrokeLength?: number;   // 0.01..0.4
  /** Stroke width in world units. Only used when topology is
   *  `strokes`. Wider strokes paint a fuller volume. */
  flythroughStrokeWidth?: number;    // 0.001..0.05
  /** Strength of the depth derived from the source (multiplier on
   *  the depth-source heuristic). Higher = more 3D pop within each
   *  slab; 0 = flat plane. */
  flythroughDepthStrength?: number;  // 0..1.5
  /** When true, fly speed and flow strength are modulated by the
   *  audio analyzer's bass / treble bands. The configured baselines
   *  remain the "no audio" values. */
  flythroughAudioReactive?: boolean;
}

export function createDefaultPixelFXContent(): PixelFXContent {
  return {
    sourceType: 'image',
    sourceUrl: null,
    mode: 'depth-shift',
    knobs: [0.6, 0, 0, 0],   // depth, _, spin_speed (0=no spin), spin_axis
    particleCount: 250_000,
    baseSize: 0.005,
    opacity: 1,
    anchorJitter: 0.6,
    fovDeg: 50,
    cameraZ: 2.2,
    cameraYaw: 0,
    cameraPitch: 0,
    panX: 0,
    panY: 0,
    lightEnabled: false,
    lightX: 1.0,
    lightY: 1.0,
    lightZ: 1.5,
    lightIntensity: 1.5,
    lightAmbient: 0.25,
    lightHeightStrength: 1.5,
    noiseAmpXY: 0,
    noiseAmpZ: 0,
    noiseFreq: 4,
    noiseSpeed: 0.5,
    // Flythrough defaults — tuned so a freshly-set-to-flythrough layer
    // looks compelling immediately (not flat, not chaotic). Users
    // can dial it all the way down to a slow corridor or all the
    // way up to a hyperspace tunnel from here.
    flythroughTopology: 'strokes',
    flythroughDepthSource: 'luminance',
    flythroughFlySpeed: 0.8,
    flythroughTunnelDepth: 2.0,
    flythroughSlabCount: 4,
    flythroughFlowStrength: 0.4,
    flythroughFlowScale: 2.0,
    flythroughAnchorPull: 1.2,
    flythroughStrokeLength: 0.08,
    flythroughStrokeWidth: 0.006,
    flythroughDepthStrength: 0.5,
    flythroughAudioReactive: false,
  };
}

// ── Group Layer ─────────────────────────────────────────────────────────────

export type GroupShaderMode = 'unified' | 'individual';

export interface GroupConfig {
  /** 'unified' = one shader across entire canvas, children are masked windows.
   *  'individual' = shader repeats independently per child. */
  shaderMode: GroupShaderMode;
  /** When true, group-level effects/edgeEffects replace each child's own. */
  overrideStyles: boolean;
  /** Shader applied across (unified) or to each child (individual). */
  shaderSource: MediaSource | null;
}

export interface ISFInputDef {
  NAME: string;
  TYPE: 'float' | 'bool' | 'long' | 'point2D' | 'color' | 'image' | 'event';
  DEFAULT?: number | boolean | number[] | string;
  MIN?: number;
  MAX?: number;
  LABEL?: string;
  VALUES?: number[];
  LABELS?: string[];
  IDENTITY?: unknown;
}

// Reference to an image input source (another layer or media item)
export interface ImageInputRef {
  type: 'layer' | 'media';
  id: string; // Layer ID or media item ID
  name: string;
}

export type VideoPlaybackMode = 'loop' | 'once' | 'timelapse';

export interface MediaSource {
  id: string;
  type: MediaType;
  src: string; // URL or path
  name: string;
  texture?: THREE.Texture;
  imageElement?: HTMLImageElement;
  videoElement?: HTMLVideoElement;
  iframeElement?: HTMLIFrameElement; // For three.js HTML sources
  threejsCanvas?: HTMLCanvasElement; // Offscreen canvas to capture iframe content
  shaderCode?: string; // ISF/GLSL shader source
  shaderInputs?: ISFInputDef[]; // ISF shader parameters
  shaderValues?: Record<string, number | boolean | number[]>; // Current parameter values
  /** Per-param Auto playhead state for shader inputs. Same role as
   *  Effect.paramAuto — see AutoConfig docs above. */
  shaderValueAuto?: Record<string, AutoConfig>;
  shaderImageInputs?: Record<string, ImageInputRef>; // References to textures for 'image' type inputs
  isPlaying?: boolean; // For video playback control
  mirrorX?: boolean; // Source-owned horizontal mirror, used for webcam/selfie feeds
  playbackMode?: VideoPlaybackMode; // Video playback mode (default: 'loop')
  playbackRate?: number; // Playback speed multiplier (default: 1.0)
  playbackSyncBeats?: number | null; // If set, fit full clip/trim span to this many beats
  trimStart?: number; // 0-1 normalized start point (default 0)
  trimEnd?: number; // 0-1 normalized end point (default 1)
  durationSeconds?: number; // Native transport metadata; retained when no browser video is attached
  _nativePlaybackTimeSeconds?: number; // Runtime anchor for the native decoder clock
  _nativePlaybackUpdatedAtMs?: number; // performance.now() corresponding to the native time anchor
  _nativePlaybackSeekSeq?: number; // Incremented for every explicit native seek/restart
  _lastFrameTime?: number; // Internal: timestamp for manual frame stepping
  // Timelapse mode properties
  timelapseInterval?: number; // Seconds between frames (1-30)
  timelapseRunning?: boolean; // Whether timelapse is actively stepping
  _timelapseFrame?: number; // Internal: current frame index
  _timelapseTotalFrames?: number; // Internal: total frames in video
  // JavaScript animation properties (for AI-generated or custom Three.js/p5.js)
  jsAnimation?: JSAnimationSource;
  // AI generation metadata (for shaders)
  aiGenerated?: boolean;
  aiPrompt?: string; // Original prompt used to generate this content
  // Spout source (for plugin integrations like FluidGen, Particles3D)
  spoutSource?: SpoutSource;
  // NDI receiver source (network video stream from another app/machine)
  ndiSource?: NdiSource;
  /** Native 2.0 live-ingest identity. Live pixels are acquired outside the
   * browser and imported into the render core as shared GPU surfaces. */
  liveSourceType?: 'webcam' | 'capture' | 'syphon' | 'ndi';
  liveSourceSessionId?: string;
  // Integrated effect source (native WebGL fluid/particles)
  effectSource?: IntegratedEffectSource;
  // SynthVision: shared offscreen canvas the texture mirrors
  synthVisionCanvas?: HTMLCanvasElement;
  // Set when src failed to load (404, decode error). Surfaced as a badge in the library UI.
  broken?: boolean;
  brokenReason?: string;
  // Durable identity of the underlying file (capture path + dest after Save).
  // Set at File-import time by createAssetRefFromFile; consumed at reload by
  // resolveAssetRefForRuntime to recompute `src` without trusting the
  // transient blob URL. Optional for backwards compat with pre-AssetRef projects.
  _assetRef?: import('./storage/assetRegistry').AssetRef;
}

// Lines layer content is defined in ./lines/types.ts and imported at top
// (LinesContent replaces the old GenerativeContent)

// SVG layer fill modes
export type SVGFillMode =
  | 'liquid'
  | 'solid'
  | 'gradient'
  | 'shimmer'
  | 'pulse'
  | 'noise'
  | 'particles'
  | 'fluid'
  | 'flow';

// SVG layer color modes
export type SVGColorMode = 'perShape' | 'rainbow' | 'monochrome' | 'complementary' | 'analogous' | 'white';

// SVG 3D render mode — 'flat' is the classic orthographic look; 'extrude'
// turns each shape into a beveled 3D solid under a perspective camera with
// real lights + materials (drop a logo and spin it in 3D).
export type SVGRenderMode = 'source' | 'flat' | 'extrude';

// PBR material look for extruded shapes. 'holographic' is the default —
// iridescent thin-film that shifts colour by view angle.
export type SVGMaterialPreset = 'holographic' | 'chrome' | 'glass' | 'neon' | 'matte';

// Light rig for extrude mode.
export type SVGLightPreset = 'studio' | 'neon' | 'rim';

// Outline rendering styles (was a single solid Line2 per shape).
export type SVGOutlineStyle = 'solid' | 'dashed' | 'gradient' | 'double' | 'taper' | 'glow-pulse';

// Node-connection styles between shape centroids.
export type SVGConnectionStyle = 'arc' | 'straight' | 'electric' | 'orbital' | 'beaded' | 'gravity' | 'dataflow';

// SVG layer content (animated SVG with all parameters from the SVG animator)
export interface SVGContent {
  // SVG source data
  svgSource: string; // The raw SVG content

  // Manual positioning and scaling (for user adjustment)
  panX: number;      // -1 to 1, horizontal offset (0 = centered)
  panY: number;      // -1 to 1, vertical offset (0 = centered)
  contentScale: number;  // 0.1 to 3, scale multiplier (1 = fit to canvas)

  // Fill mode and parameters
  fillMode: SVGFillMode;
  gradientAngle: number; // 0-360
  gradientSpread: number; // 0.1-0.8
  shimmerSpeed: number; // 1-15
  shimmerScale: number; // 0.02-0.3
  shimmerIntensity: number; // 0.2-1.5
  pulseSpeed: number; // 0.5-10
  pulseRingScale: number; // 2-30
  pulseRingSpeed: number; // 1-15
  noiseScale: number; // 0.005-0.1
  noiseSpeed: number; // 0.1-2
  noiseContrast: number; // 0-1
  particleFillDensity: number; // 50-500
  particleFillSize: number; // 1-10
  particleFillSpeed: number; // 0.1-3

  // Color mode and parameters
  colorMode: SVGColorMode;
  monochromeHue: number; // 0-360
  perShapeColors: boolean;
  colorCycleEnabled: boolean;
  colorCycleSpeed: number; // 0.05-1
  colorCycleSaturation: number; // 0.3-1
  colorCycleLightness: number; // 0.3-0.8

  // Outlines
  outlineThickness: number; // 1-10

  // Liquid fill
  liquidEnabled: boolean;
  liquidSpeed: number; // 0.05-1
  liquidWaveAmp: number; // 0.02-0.15

  // Edge particles
  particlesEnabled: boolean;
  particleSpeed: number; // 20-300
  particleSize: number; // 1-5

  // Energy pulses
  energyEnabled: boolean;
  energySpeed: number; // 50-500
  energySize: number; // 0.5-3

  // Connections
  connectionsEnabled: boolean;
  connectionPulseSpeed: number; // 0.5-6
  connectionThickness: number; // 1-8

  // Glow nodes
  glowEnabled: boolean;
  glowPulseSpeed: number; // 0.5-8
  glowSize: number; // 0.5-3
  glowIntensity: number; // 0.1-1

  // Ripples
  ripplesEnabled: boolean;
  rippleSpeed: number; // 0.3-3
  rippleSize: number; // 0.5-3
  rippleOpacity: number; // 0.1-1

  // Lightning
  lightningEnabled: boolean;
  lightningFrequency: number; // 0.1-4
  lightningThickness: number; // 1-8
  lightningBranches: number; // 0-6
  lightningDuration: number; // 0.05-0.4

  // Edge flow
  edgeFlowEnabled: boolean;
  edgeFlowSpeed: number; // 0.5-4
  edgeFlowThickness: number; // 1-6

  // Inner glow
  innerGlowEnabled: boolean;
  innerGlowIntensity: number; // 0.1-1

  // Nebula background
  nebulaEnabled: boolean;
  nebulaIntensity: number; // 0.1-0.8
  nebulaSpeed: number; // 0.05-0.5

  // Heartbeat
  heartbeatEnabled: boolean;
  heartbeatSpeed: number; // 0.3-2.5
  heartbeatIntensity: number; // 0.1-0.8

  // Plasma tendrils
  plasmaEnabled: boolean;
  plasmaIntensity: number; // 0.2-1.5
  plasmaSpeed: number; // 0.5-5
  plasmaThickness: number; // 1-8
  plasmaOpacity: number; // 0.2-1

  // Particle links
  particleLinksEnabled: boolean;
  particleLinkDistance: number; // 20-150
  particleLinkOpacity: number; // 0.1-1
  particleLinkThickness: number; // 1-6
  particleLinkMaxLinks: number; // 100-2000
  particleLinkSpeed: number; // 1-10 (update frequency)

  // Echo layers
  echoEnabled: boolean;
  echoLayers: number; // 1-8
  echoSpacing: number; // 3-20
  echoThickness: number; // 1-6
  echoOpacity: number; // 0.1-0.6

  // Arc bridges
  arcBridgesEnabled: boolean;
  arcBridgeHeight: number; // 5-40
  arcBridgeThickness: number; // 1-8
  arcBridgeOpacity: number; // 0.1-0.8

  // ── 3D extrude / material (headline level-up) ──────────────────────
  renderMode: SVGRenderMode;        // 'flat' (default, classic) | 'extrude'
  extrudeDepth: number;             // 0-120 — depth of the 3D solid
  bevelEnabled: boolean;
  bevelSize: number;                // 0-6
  materialPreset: SVGMaterialPreset; // default 'holographic'
  materialMetalness: number;        // 0-1
  materialRoughness: number;        // 0-1
  iridescence: number;              // 0-1 (holographic strength)
  glassTransmission: number;        // 0-1 (glass preset)
  envIntensity: number;             // 0-2 — reflection/IBL strength
  cameraFov: number;                // 25-75 degrees (perspective)
  rotateX: number;                  // manual base orientation, DEGREES
  rotateY: number;
  rotateZ: number;
  rotateSpeedX: number;             // auto-spin, radians/sec (adds on top of manual)
  rotateSpeedY: number;
  rotateSpeedZ: number;
  floatAmount: number;              // 0-40 px vertical bob
  floatSpeed: number;               // 0.1-3
  lightPreset: SVGLightPreset;
  lightIntensity: number;           // 0-3

  // ── Fluid fill (new fill modes 'fluid' | 'flow') ───────────────────
  fluidScale: number;               // 0.5-6
  fluidSpeed: number;               // 0.1-3
  fluidTurbulence: number;          // 0-2

  // ── Real volumetric particle fill (fills the shape interior) ───────
  particleFillEnabled: boolean;
  // (particleFillDensity / particleFillSize / particleFillSpeed already exist above)

  // ── Outline + connector styles ─────────────────────────────────────
  outlineStyle: SVGOutlineStyle;
  outlineDashSpeed: number;         // marching-ants speed
  outlineGradientSpread: number;    // 0-1
  connectionStyle: SVGConnectionStyle;
  connectionRange: number;          // 50-400 — max centroid distance to link
  connectionDataFlowSpeed: number;  // pulse travel speed (dataflow style)

  // ── Organic effects ────────────────────────────────────────────────
  organicWarpEnabled: boolean;
  warpAmount: number;               // 0-30 px
  warpSpeed: number;                // 0.1-3
  growthEnabled: boolean;
  growthSpeed: number;              // 0.1-2 (outline draw-on)
  breatheEnabled: boolean;
  breatheAmount: number;            // 0-0.3 scale
  breatheSpeed: number;             // 0.2-3

  // Post processing
  bloomStrength: number; // 0.5-4
  bloomThreshold: number; // 0-0.5
  chromatic: number; // 0-0.008
  vignette: number; // 0-0.6
}

// Solid color layer content
export interface ColorContent {
  hue: number;         // 0-360
  saturation: number;  // 0-100
  lightness: number;   // 0-100
  alpha: number;       // 0-1
}

// Click-point mask configuration
//
// A mask is a UNION of one-or-more sub-polygons ("shapes"). Each shape is an
// array of bezier anchor points (Illustrator-style: each anchor may carry
// `cpIn` / `cpOut` control handles to define curved segments). At least 3
// anchors are required for a shape to render; `closed` flips once the user
// finishes drawing it. The rasterizer tessellates each closed shape's beziers
// in JS, then unions the silhouettes.
export interface MaskShape {
  points: BezierPoint[];   // Normalized coordinates (0-1) with optional bezier handles
  closed: boolean;         // True once the user has closed this sub-polygon
}

export interface MaskConfig {
  enabled: boolean;
  shapes: MaskShape[]; // Multiple sub-polygons; final mask is the UNION
  inverted: boolean;   // If true, show outside mask, hide inside
  feather: number;     // Feather/softness at edges (0-1)
}

// Input crop/slice region (what portion of the source to use)
export interface CropRegion {
  x: number;      // Left edge (0-1)
  y: number;      // Top edge (0-1)
  width: number;  // Width (0-1)
  height: number; // Height (0-1)
}

// Layer shape types for masking
export type LayerShapeType =
  | 'rectangle'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'star'
  | 'line'
  | 'polyline'
  | 'custom';

// Parameters for different layer shapes
export interface LayerShapeParams {
  // For circle/ellipse
  radiusX?: number;        // 0-1 relative to layer
  radiusY?: number;        // 0-1 relative to layer

  // For polygon/star
  sides?: number;          // 3-12 for polygon, points for star
  innerRadius?: number;    // For star: inner radius ratio (0-1)

  // For triangle
  triangleType?: 'equilateral' | 'isosceles' | 'right';

  // For line/polyline
  lineWidth?: number;      // Thickness in normalized units
  linePoints?: Point2D[];  // For polyline: array of points
  lineCap?: 'butt' | 'round' | 'square';

  // For custom (pen-tool drawn polygon with optional bezier curves)
  customPoints?: BezierPoint[];  // Vertices with optional bezier handles (normalized 0-1)
  customClosed?: boolean;        // Whether the polygon has been closed/finalized
  customBasePoints?: BezierPoint[];  // Outline snapshot content was authored against (drives content-follow warp)
  customShapeFit?: 'warp' | 'fill' | 'mask';  // How texture maps to shape: warp=stretch to bbox, fill=aspect-preserving, mask=clip only (legacy)

  // Common params
  rotation?: number;       // Shape rotation in degrees
  feather?: number;        // Edge softness (0-1)
  scale?: number;          // Zoom/scale (0.1-3.0, default 1.0)
  invert?: boolean;        // Invert the mask (show content outside shape)
}

// ============================================================================
// LIGHT PAINTING TYPES
// ============================================================================

export type LightPaintingBrushType =
  // ── Original CPU-rasterised brushes ──
  | 'glow'        // Soft glowing trail (like long-exposure light)
  | 'neon'        // Hard-edged neon tube look
  | 'flame'       // Flickering fire trail
  | 'electric'    // Electrical/lightning trail
  | 'ribbon'      // Flat ribbon that twists in 3D
  | 'particle'    // Trail of particles
  | 'smoke'       // Wispy smoke trail
  | 'laser'       // Thin sharp laser beam
  | 'calligraphy' // Direction-sensitive nib (varies width by angle)
  | 'spray'       // Graffiti spray paint (scattered particles)
  | 'paintbrush'  // Wide bristle brush (direction-aware)
  | 'marker'      // Flat chisel-tip marker
  | 'watercolor'  // Soft wet edges with bleed effect
  // ── WebGPU compute-shader brushes ──
  // Each spawns thousands of GPU particles bound to the stroke's
  // tangent + normal vectors. Renders as instanced billboards with
  // additive glow. Skipped by the CPU stroke rasteriser — the GPU
  // pass is the entire visual.
  //
  // Designed for plant / organic projection mapping: spiral wraps
  // around tree limbs, firefly emanates outward (great on
  // branches), sap-flow simulates fluid travelling along the stroke.
  | 'spiral'      // Particles wrap around the stroke like a candy cane
  | 'firefly'     // Particles spawn near stroke + drift outward, twinkle
  | 'sap-flow'    // Particles travel along stroke at varying phases (flow)
  | 'water'       // Droplets fall from the stroke under gravity (rain off branches)
  | 'smoke'       // Wisps rise from the stroke with curl noise (incense)
  // ── Phase 2 — WebGL2-only procedural brushes ──
  // Rendered by webglRenderer.ts via fragment shaders in webglShaders.ts.
  // No CPU rasteriser fallback (the Canvas2D renderer skips them too).
  | 'sparkle'     // Twinkling specks scattered along the stroke
  | 'plasma'      // Animated noise-driven plasma blob
  | 'galaxy'      // Spiral-arm starfield centered on each stamp
  | 'lightning'   // Branching electrical filaments
  | 'vortex'      // Swirling gravitational well distortion
  // ── Phase 3 — additional WebGL2-only brushes ──
  | 'nebula'      // Soft volumetric cloud with internal glow
  | 'kaleido'     // Mirrored kaleidoscope segments
  | 'ink'         // Bleeding-edge ink wash
  | 'crystal'     // Faceted crystalline shards
  | 'aurora'      // Curtains of borealis-style light
  | 'bubbles'     // Floating soap-bubble field
  // ── Native particle brushes ──
  // Emulate the retired WebGPU compute-particle looks inside the
  // native fragment renderer: orbiting heads with motion trails.
  | 'orbit'       // Particle clusters orbit around the stroke with comet trails
  | 'helix';      // Candy-cane wrap of streaking particles around the stroke

export type LightPaintingLoopMode = 'forward' | 'reverse' | 'pingpong' | 'once';

export type LightPaintingSequenceMode =
  | 'recorded'
  | 'random'
  | 'alternating'
  | 'bottomUp'
  | 'topDown'
  | 'centerOut'
  | 'outsideIn';

// Drawing tool modes
export type LightPaintingDrawMode = 'freehand' | 'pen';

export interface LightPaintingBrush {
  type: LightPaintingBrushType;
  color: [number, number, number];    // RGB 0-255
  secondaryColor: [number, number, number] | null; // For multi-color glow (null = disabled)
  size: number;                       // Brush diameter 1-100
  opacity: number;                    // 0-1
  glow: number;                       // Glow intensity 0-5
  softness: number;                   // Edge softness 0-1
  jitter: number;                     // Random position jitter 0-1
  taper: boolean;                     // Taper stroke ends
  pressureSensitive: boolean;         // Use pressure for size
  smoothing: number;                  // Stroke smoothing 0-1 (0=raw, 1=max)
  speed: number;                      // Brush animation speed 0.1-5 (flame flicker, electric sparks, etc.)
  /** Per-stroke width multiplier at the START of the stroke
   *  (progress = 0). 1.0 = full brush width, 0.0 = pinched to a
   *  point. Combined with taperEnd this lets a single stroke paint
   *  a tapered shape — thicker at the base, thinner at the tip
   *  (or vice versa). Used for projecting tree trunks/branches that
   *  vary in thickness along their length. Defaults to 1. */
  taperStart?: number;                // 0 - 2
  /** Per-stroke width multiplier at the END of the stroke
   *  (progress = 1). 1.0 = full brush width, 0.0 = pinched to a
   *  point. Defaults to 1. */
  taperEnd?: number;                  // 0 - 2
  /** Power exponent applied to the taper interpolation curve.
   *  1 = linear (default), 2 = ease-in (slow then fast taper),
   *  0.5 = ease-out (fast then slow). Subtle but lets the taper
   *  feel like a natural branch contour rather than a wedge. */
  taperCurve?: number;                // 0.25 - 4
  // ── GPU brush params (only consumed when type is a GPU brush) ──
  // Defaults are set at brush creation; tuning happens in the panel.
  /** Particles allocated to this stroke per frame budget. Higher =
   *  denser visual but more GPU work. Each stroke gets its own slice
   *  of the global particle buffer. Default 800. */
  gpuParticleCount?: number;          // 50 - 4000
  /** For 'spiral' brush: orbit radius in normalized canvas units
   *  (0..1). 0.02 ≈ tight wrap, 0.1 ≈ wide spiral. */
  gpuSpiralRadius?: number;           // 0.005 - 0.2
  /** For 'spiral' brush: revolutions per second. Higher = faster
   *  spinning candy-cane. Negative = reverse direction. */
  gpuSpiralSpeed?: number;            // -5 - 5
  /** For 'spiral' brush: spiral pitch (turns per stroke length).
   *  Higher = tighter helix. */
  gpuSpiralPitch?: number;            // 1 - 30
  /** For 'firefly' / 'sap-flow' / 'water' / 'smoke' brushes: how
   *  far particles drift from the stroke before expiring. */
  gpuParticleDrift?: number;          // 0.005 - 0.3
  /** For 'spiral' brush: render a glowing line of particles along
   *  the stroke's center + hide back-side spiral particles entirely
   *  (so when projected on a 3D surface the wrap reads correctly —
   *  back-side particles can't leak through a tree trunk). When
   *  off the spiral renders as a 360° helix with both halves
   *  visible — usually the better look for free-floating shapes.
   *  Default false (full helix). Turn on when projecting onto a
   *  solid 3D object you want the spiral to wrap around. */
  gpuSpiralShowCore?: boolean;
  /** For 'water' brush: gravity strength (downward). 0=none,
   *  1=normal, 2=heavy. Default 1. */
  gpuWaterGravity?: number;           // 0 - 2
  /** For 'smoke' brush: how fast wisps rise. 0.1 = slow incense,
   *  1.5 = fast steam. Default 0.5. */
  gpuSmokeRise?: number;              // 0.05 - 1.5
  /** Render a translucent glass-style tube around the stroke that
   *  visually contains the particles inside. The tube's radius
   *  auto-scales with the per-brush max particle offset (spiral
   *  orbit radius / firefly+sap-flow drift) so the particles
   *  appear to live INSIDE the tube. Default ON for spiral and
   *  sap-flow (containers feel natural for fluid / wraparound),
   *  OFF for firefly (sparks should escape). */
  gpuGlassTube?: boolean;
  /** Optional override for glass-tube radius multiplier. 1.0 ≈
   *  exactly fits particles. >1 looser fit. Default 1.25. */
  gpuGlassTubeRadiusScale?: number;   // 0.5 - 3.0
  /** Glass-tube color, RGB 0..255. Independent of the particle
   *  colour so you can have e.g. a cool-blue glass tube containing
   *  warm-amber fireflies. Defaults to a soft white when unset. */
  gpuGlassTubeColor?: [number, number, number];
  // ── Procedural brush params (consumed by procedural GPU brushes for
  // particle-style strokes — internal glow, animated noise field, etc.) ──
  /** Per-particle size multiplier inside a procedural stamp. Default 1. */
  particleSize?: number;
  /** Inner glow intensity inside each particle splat. Default 1. */
  internalGlow?: number;
  /** Spatial scale of the animated noise field warping particles. Default 1. */
  noiseScale?: number;
  /** Temporal speed of the noise field. Default 1. */
  noiseSpeed?: number;
  /** Strength of noise displacement applied to particle positions. Default 0.6. */
  noiseAmount?: number;
  /** Procedural-brush complexity multiplier (octaves / detail). Default 1. */
  complexity?: number;
}

export interface LightPaintingStrokePoint {
  x: number;                          // Normalized 0-1
  y: number;                          // Normalized 0-1
  pressure: number;                   // 0-1
  timestamp: number;                  // ms relative to stroke start
}

// Pen tool anchor point with bezier control handles
export interface LightPaintingPenPoint {
  x: number;                          // Normalized 0-1
  y: number;                          // Normalized 0-1
  handleIn: { x: number; y: number } | null;   // Control handle towards previous point
  handleOut: { x: number; y: number } | null;  // Control handle towards next point
}

export interface LightPaintingStroke {
  id: string;
  points: LightPaintingStrokePoint[];
  brush: LightPaintingBrush;
  duration: number;                   // Total draw time in ms
  visible: boolean;
  locked: boolean;
  drawMode: LightPaintingDrawMode;    // How this stroke was created
  penPoints?: LightPaintingPenPoint[];// Original pen anchors (for pen mode strokes)
}

export interface LightPaintingContent {
  strokes: LightPaintingStroke[];
  backgroundColor: [number, number, number, number]; // RGBA 0-1

  // Drawing tool
  drawMode: LightPaintingDrawMode;    // Current drawing tool

  // Animation
  loopMode: LightPaintingLoopMode;
  animationSpeed: number;             // Playback speed multiplier 0.1-5
  trailLength: number;                // How much trail persists 0-1 (0=full persist, 1=instant fade)
  drawSpeed: number;                  // How fast strokes draw themselves 0.1-10
  staggerStrokes: boolean;            // Draw strokes one after another vs all at once
  staggerDelay: number;               // Delay between staggered strokes in ms
  pingPongHold: number;               // Hold at each end of ping-pong playback in ms
  sequenceMode: LightPaintingSequenceMode; // Stroke playback ordering
  randomSequenceSeed: number;         // Seed used for deterministic random stroke order

  // Global effects
  bloom: number;                      // Post-process bloom intensity 0-3
  motionBlur: number;                 // Motion blur amount 0-1
  afterglow: number;                  // Lingering glow after trail passes 0-1
  colorShift: number;                 // Hue rotation over time 0-1
  echo: number;                       // Echo/repeat lines effect (0=off, 1-10 echo count)
  echoOffset: number;                 // Distance between echo lines 0-1
  echoDecay: number;                  // Opacity decay per echo 0-1
  snake: number;                      // Snake drawing head length (0=off, 0.01-1 = head proportion)
  snakeSpeed: number;                 // Snake animation speed multiplier 0.1-5
  multiColorGlow: boolean;            // Enable secondary color glow halo
  pulse: number;                      // Pulsing brightness animation 0-1
  pulseSpeed: number;                 // Pulse speed 0.1-5
  strobe: number;                     // Strobe flash rate 0-1 (0=off)
  wave: number;                       // Sine wave distortion amount 0-1
  waveFreq: number;                   // Wave frequency 0.5-10
  waveSpeed: number;                  // Wave animation speed 0.1-5
  windSway: number;                   // Organic per-point wind sway 0-1
  windSpeed: number;                  // Wind sway speed 0.1-5
  windScale: number;                  // Wind spatial frequency/detail 0.5-8
  windAnchor: number;                 // How much lower/root areas resist sway 0-1
  flowPulse: number;                  // Traveling brightness pulse along strokes 0-1
  flowSpeed: number;                  // Flow pulse speed 0.1-5
  flowWidth: number;                  // Flow pulse width 0.03-0.5
  sparkle: number;                    // Random sparkle particles along stroke 0-1
  flicker: number;                    // Random brightness flicker 0-1
  breathe: number;                    // Smooth size breathing 0-1
  breatheSpeed: number;               // Breathing speed 0.1-5

  // State
  selectedStrokeId: string | null;
  isPlaying: boolean;
  isRecording: boolean;               // Currently painting
  playbackPosition: number;           // 0-1 normalized playback position
  // Live preview of an in-flight stroke (drawn but not yet committed to `strokes`).
  // Cleared when recording stops.
  livePreviewStroke?: { points: any[]; brush: any } | null;
}

export function createDefaultLightPaintingBrush(): LightPaintingBrush {
  return {
    type: 'glow',
    color: [255, 160, 40],            // Warm amber like the reference images
    secondaryColor: null,
    size: 20,
    opacity: 1,
    glow: 2,
    softness: 0.6,
    jitter: 0,
    taper: true,
    pressureSensitive: false,
    smoothing: 0.5,
    speed: 1,
    // GPU brush defaults — sensible starter values for spiral. The
    // panel will swap these to brush-specific defaults when the user
    // picks a different GPU brush type.
    gpuParticleCount: 800,
    gpuSpiralRadius: 0.025,
    gpuSpiralSpeed: 1.2,
    gpuSpiralPitch: 8,
    gpuParticleDrift: 0.05,
    gpuSpiralShowCore: false,
    gpuWaterGravity: 1,
    gpuSmokeRise: 0.5,
    gpuGlassTube: false,                  // off by default — opt in per stroke
    gpuGlassTubeRadiusScale: 1.25,
    gpuGlassTubeColor: [220, 230, 255],   // soft cool-white — looks right for most particle colors
    taperStart: 1,                        // no taper by default — both ends full width
    taperEnd: 1,
    taperCurve: 1,                        // linear interpolation
  };
}

export function createDefaultLightPaintingContent(): LightPaintingContent {
  return {
    strokes: [],
    backgroundColor: [0, 0, 0, 1],   // Black background
    drawMode: 'freehand',
    loopMode: 'forward',
    animationSpeed: 1,
    trailLength: 0.3,
    drawSpeed: 1,
    staggerStrokes: true,
    staggerDelay: 200,
    pingPongHold: 0,
    sequenceMode: 'recorded',
    randomSequenceSeed: 1337,
    bloom: 1.5,
    motionBlur: 0.2,
    afterglow: 0.4,
    colorShift: 0,
    echo: 0,
    echoOffset: 0.03,
    echoDecay: 0.3,
    snake: 0,
    snakeSpeed: 1,
    multiColorGlow: false,
    pulse: 0,
    pulseSpeed: 1,
    strobe: 0,
    wave: 0,
    waveFreq: 3,
    waveSpeed: 1,
    windSway: 0,
    windSpeed: 1,
    windScale: 2,
    windAnchor: 0.7,
    flowPulse: 0,
    flowSpeed: 1,
    flowWidth: 0.12,
    sparkle: 0,
    flicker: 0,
    breathe: 0,
    breatheSpeed: 1,
    selectedStrokeId: null,
    isPlaying: false,
    isRecording: false,
    playbackPosition: 0,
  };
}

// ============================================================================
// ADV LIGHT PAINTING (WebGPU 3D PARTICLE PAINT) TYPES
// ============================================================================
//
// A WebGPU-only layer type. Unlike the legacy `lightpainting` layer
// (CPU stroke rasterisation, 13 brush types, animation timeline),
// Adv Light Painting is a pure compute-shader showcase: the user
// drags on the canvas, the renderer spawns thousands of physics-driven
// particles in 3D that drip / pool / spray / splash. No CPU stroke
// drawing happens — the brush IS the particle physics, configured by
// the brush preset.
//
// Brush presets steer the compute shader's force model:
//
//   drip      — gravity-dominated; viscosity high; particles fall in
//               coherent streams. Looks like dripping paint.
//   water     — gravity + cohesion; particles attract weakly; pools
//               form at rest. Approximates 2D fluid surface tension.
//   smoke     — buoyant (negative gravity), low viscosity, expanding;
//               wispy upward plumes.
//   plasma    — chaotic curl-noise driven; bright additive particles
//               that swirl. The original demo aesthetic.
//   shader    — sample colour from a chosen ISF shader (future v2);
//               for now identical to plasma but reads colour from a
//               procedural pattern.

export type AdvLightPaintBrush = 'drip' | 'water' | 'smoke' | 'plasma' | 'shader';

export interface AdvLightPaintingContent {
  /** Active brush preset. Defines the force model the compute shader
   *  applies each frame. */
  brush: AdvLightPaintBrush;

  /** Particle population cap. The compute pipeline allocates this
   *  many slots in the storage buffer; runtime always tracks the
   *  full count even when most are dead. Higher = denser drips but
   *  more GPU work. */
  particleCount: number;            // 10000 - 200000

  /** Particles spawned per frame while the user is actively
   *  dragging. Higher = denser stroke. */
  spawnRate: number;                // 10 - 500

  /** Initial velocity randomness applied at spawn. */
  spawnSpread: number;              // 0 - 1

  /** Gravity vector strength (positive = downward). The brush preset
   *  scales this to its preferred direction (e.g. smoke flips sign). */
  gravity: number;                  // 0 - 2

  /** Per-second velocity damping. Higher viscosity = slower-moving
   *  particles + tighter clusters. */
  viscosity: number;                // 0.5 - 0.99

  /** Particle lifespan in seconds. Long lifespans produce visible
   *  trails as particles fall. */
  lifespanSec: number;              // 0.5 - 10

  /** Brightness multiplier applied at the additive blend step.
   *  Higher = more glow buildup where particles overlap. */
  glow: number;                     // 0 - 4

  /** Hue cycle rate in cycles per second. 0 = fixed colour, 0.05 =
   *  one rainbow per ~20s. */
  hueCycleSpeed: number;            // 0 - 1

  /** Base colour (RGB 0-1). Hue cycling rotates from this base. */
  baseColor: [number, number, number];

  /** Particle billboard size in normalized canvas coords. */
  size: number;                     // 0.001 - 0.05

  /** Audio bass kick reactivity. 0 = ignore audio, 1 = full effect. */
  audioReactivity: number;          // 0 - 1

  /** Z-axis (depth) emission position when drawing. Negative = closer
   *  to camera (larger), positive = further (smaller). */
  emissionZ: number;                // -1 to 1
}

export function createDefaultAdvLightPaintingContent(): AdvLightPaintingContent {
  return {
    brush: 'drip',
    particleCount: 80000,
    spawnRate: 350,
    spawnSpread: 0.4,
    gravity: 0.7,
    viscosity: 0.92,
    lifespanSec: 5,
    glow: 1.8,
    hueCycleSpeed: 0.04,
    baseColor: [1.0, 0.3, 0.82],   // hot pink default
    size: 0.014,                    // bigger so particles are clearly visible
    audioReactivity: 0.7,
    emissionZ: 0,
  };
}

// ============================================================================
// TEXT LAYER TYPES
// ============================================================================

export type TextAnimationType =
  | 'none'
  | 'ticker'           // Continuous horizontal scroll loop
  | 'letterReveal'     // Letters appear one by one with glow
  | 'typewriter'       // Typing with cursor blink
  | 'fadeInLetters'    // Each letter fades in sequentially
  | 'waveY'           // Vertical sine wave per letter
  | 'waveX'           // Horizontal sine wave per letter
  | 'elastic'          // Letters bounce in with overshoot
  | 'scramble'         // Random chars resolve to correct ones
  | 'glitch3d'         // RGB split + perspective skew + noise
  | 'perspective3d'    // Rotating text in faux-3D
  | 'flipLetters'      // Individual letter Y-axis flip
  | 'spiralIn'         // Letters spiral from outside to position
  | 'explode'          // Letters burst out then reassemble
  | 'liquid'           // Fluid distortion warping letters
  | 'neonPulse'        // Glow intensity cycles with bloom
  | 'matrixRain'       // Characters cascade down green-on-black
  | 'bounce';          // Physics-based bounce from top

export type TextAlignment = 'left' | 'center' | 'right';

export interface TextAnimation {
  type: TextAnimationType;
  speed: number;          // Multiplier, 1.0 = default
  loop: boolean;          // Whether animation loops
  direction: 'forward' | 'reverse' | 'alternate';
  staggerDelay: number;   // Delay between each letter (0-0.5s)
  intensity: number;      // Effect strength 0-1
}

export interface TextContent {
  text: string;
  fontFamily: string;
  fontSize: number;          // In pixels (relative to 1080p canvas)
  fontWeight: number;        // 100-900
  fontStyle: 'normal' | 'italic';
  color: string;             // CSS color string
  strokeColor: string;       // Outline color
  strokeWidth: number;       // Outline width in px
  alignment: TextAlignment;
  letterSpacing: number;     // Extra spacing in px
  lineHeight: number;        // Multiplier (1.0 = normal)
  backgroundColor: string;   // Background behind text (transparent default)
  shadowColor: string;       // Text shadow color
  shadowBlur: number;        // Shadow blur radius
  shadowOffsetX: number;
  shadowOffsetY: number;
  animation: TextAnimation;
  // 3D extrusion
  enable3D: boolean;
  extrudeDepth: number;       // Depth in px (0-100)
  extrudeColor: string;       // Side/depth face color
  rotateX: number;            // Isometric X rotation in degrees (-90 to 90)
  rotateY: number;            // Isometric Y rotation in degrees (-90 to 90)
  rotateZ: number;            // Z rotation in degrees (-180 to 180)
  lightAngle: number;         // Light direction angle in degrees (0-360)
  lightIntensity: number;     // 0-1, how much shading on depth faces
  bevelSize: number;          // Bevel/highlight on top face edge (0-10px)
  // ── Optional aliases / flags read by the text renderer cache key ──
  // Present on some serialized presets but not part of the canonical
  // field set above (alignment / strokeColor / strokeWidth cover the
  // same shapes). Kept optional so the cache-key signature compiles
  // and old preset files still load.
  textAlign?: TextAlignment;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  shadowEnabled?: boolean;
  outlineEnabled?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
}

export function createDefaultTextContent(): TextContent {
  return {
    text: 'HELLO WORLD',
    fontFamily: 'Arial',
    fontSize: 120,
    fontWeight: 700,
    fontStyle: 'normal',
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0,
    alignment: 'center',
    letterSpacing: 0,
    lineHeight: 1.2,
    backgroundColor: 'transparent',
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    animation: {
      type: 'none',
      speed: 1.0,
      loop: true,
      direction: 'forward',
      staggerDelay: 0.05,
      intensity: 1.0,
    },
    enable3D: false,
    extrudeDepth: 20,
    extrudeColor: '#444444',
    rotateX: 15,
    rotateY: -25,
    rotateZ: 0,
    lightAngle: 135,
    lightIntensity: 0.6,
    bevelSize: 0,
  };
}

// ============================================================================
// SPLAT LAYER TYPES (Gaussian Splats & Point Clouds)
// ============================================================================

// Type of 3D point data
export type SplatDataType = 'pointcloud' | 'gaussian';
export type SplatImportOrientation =
  | 'authored'
  | 'yUp'
  | 'zUp'
  | 'zUpInverted'
  | 'xUp'
  | 'auto'
  | 'custom';

// Animation types for splat layers
export type SplatAnimationType =
  | 'none'
  | 'explode'           // Points expand outward from center
  | 'implode'           // Points collapse toward center
  | 'slice'             // Animated cutting plane reveals/hides
  | 'voxelSnap'         // Points snap to voxel grid
  | 'peel'              // Layer-by-layer reveal
  | 'gravity'           // Physics-based falling/floating
  | 'swarm'             // Boid-like flocking behavior
  | 'morph'             // Morph between two point clouds
  | 'orbit'             // Points orbit around center
  | 'wave3d'            // 3D wave propagation
  | 'scatter'           // Random scatter and reassemble
  | 'spiral' // Spiral in/out animation
  | 'tumble' // Continuous multi-axis rotation
  | 'breathe' // Rhythmic expansion and contraction
  | 'drift' // Coherent floating motion
  | 'vortex'; // Position-dependent continuous twist

// Displacement effect types
export type SplatDisplacementType =
  | 'none'
  | 'noise'             // Perlin/simplex noise displacement
  | 'audioReactive'     // Displacement based on audio bands
  | 'wave'              // Sine wave propagation
  | 'glitch'            // Random offset glitching
  | 'wind'              // Turbulent wind simulation
  | 'magnetic'          // Attraction/repulsion to points
  | 'ripple' // Ripple from interaction point
  | 'curlNoise' // Organic vector-field turbulence
  | 'twist' // Axis-based torsion
  | 'radialPulse' // Concentric expanding pressure waves
  | 'scanline'; // Traveling planar displacement

// Color effect types
export type SplatColorEffectType =
  | 'none'
  | 'chromatic'         // Chromatic shift based on depth/position
  | 'heatmap'           // Color based on density/distance
  | 'pointillist'       // Cycling colors per point
  | 'hologram'          // Holographic scan lines
  | 'rainbow'           // Rainbow gradient mapping
  | 'audioColor'        // Color responds to audio
  | 'depthGradient'     // Color based on Z depth
  | 'neon'              // Neon glow effect
  | 'pastel'            // Soft pastel colors
  | 'cyberpunk'         // Magenta/cyan cyberpunk
  | 'fire'              // Fire/flame colors
  | 'ice';              // Ice/frost colors

// Opacity effect types
export type SplatOpacityEffectType =
  | 'none'
  | 'dof'               // Depth of field blur/fade
  | 'fog'               // Volumetric fog effect
  | 'pulse'             // Pulsing opacity
  | 'proximity'         // Reveal based on distance to cursor
  | 'dissolve'          // Random dissolve in/out
  | 'scanReveal'        // Scan line reveal
  | 'audioFade';        // Fade based on audio level

// Creative effect types
export type SplatCreativeEffectType =
  | 'none'
  | 'feedback'          // Temporal feedback loops
  | 'kaleidoscope'      // Kaleidoscopic mirroring
  | 'constellation'     // Connect nearby points with lines
  | 'datamosh'          // Digital glitch aesthetic
  | 'pixelSort'         // Pixel sorting effect
  | 'echo';             // Temporal echo/ghosting

// Render mode for points
export type SplatRenderMode =
  | 'points'            // Simple points
  | 'spheres'           // 3D spheres
  | 'gaussians'         // Gaussian splats (if supported)
  | 'billboards'        // Camera-facing quads
  | 'cubes'             // Voxel cubes
  | 'wireframe';        // Lines connecting nearby points

// Mouse interaction modes
export type SplatMouseInteraction =
  | 'none'              // No mouse interaction
  | 'attract'           // Points attracted to cursor
  | 'repel'             // Points repelled from cursor
  | 'swirl'             // Points swirl around cursor
  | 'reveal';           // Reveal points near cursor

// Slice plane configuration
export interface SplatSlicePlane {
  enabled: boolean;
  axis: 'x' | 'y' | 'z';
  position: number;       // -1 to 1
  thickness: number;      // 0 to 1
  animated: boolean;
  speed: number;          // Animation speed
  mode: 'hide' | 'reveal' | 'isolate';
}

// Physics configuration for animations
export interface SplatPhysics {
  gravity: number;        // -2 to 2
  damping: number;        // 0 to 1
  bounce: number;         // 0 to 1
  turbulence: number;     // 0 to 1
  attractorStrength: number; // -1 to 1
  attractorPosition: { x: number; y: number; z: number };
}

// Camera/View configuration for 3D
export interface SplatCamera {
  autoRotate: boolean;
  rotateSpeed: number;    // Degrees per second
  distance: number;       // Camera distance from center
  fov: number;            // Field of view
  orbitX: number;         // Orbit angle X
  orbitY: number;         // Orbit angle Y
  panX: number;           // Pan offset X
  panY: number;           // Pan offset Y
  lookAt: { x: number; y: number; z: number };
}

// Main splat content interface
export interface SplatContent {
  // Source data
  dataType: SplatDataType;        // Point cloud or gaussian splat
  filePath: string;               // Path to .ply/.splat file
  pointCount: number;             // Number of points (read-only, set on load)
  sourcePointCount?: number; // Original file count before display LOD
  pointDensity: number;           // 0-1, percentage of points to render (1 = all)
  activePointCount: number;       // Current number of active points (read-only)

  // Texture mapping (for PLY files bundled with images or videos)
  textureEnabled: boolean;        // Whether to use texture mapping
  texturePath: string;            // Path to texture image/video file (data URL or blob URL)
  textureBlend: number;           // 0-1, blend between point colors and texture
  textureType: 'image' | 'video'; // Type of texture source
  textureProjection: 'spherical' | 'cylindrical' | 'planarXY' | 'planarXZ' | 'planarYZ' | 'box' | 'native'; // UV projection mode
  textureScale: number;           // Scale of texture mapping (default 1)
  textureOffsetX: number;         // Texture offset X
  textureOffsetY: number;         // Texture offset Y
  hasNativeUVs?: boolean;         // Read-only: true if PLY file contained UV coordinates
  // Durable file identity for the .ply/.splat itself (resolves filePath on reload).
  _assetRef?: import('./storage/assetRegistry').AssetRef;
  // Durable file identity for the texture map (resolves texturePath on reload).
  _textureAssetRef?: import('./storage/assetRegistry').AssetRef;

  // Point rendering
  renderMode: SplatRenderMode;
  pointSize: number;              // Base point size 1-50
  pointSizeAttenuation: boolean;  // Size decreases with distance
  sizeAttenuation: boolean;       // Alias for UI
  depthTest: boolean;             // Enable depth testing
  opacity: number;                // Global opacity 0-1

  // Colors
  useOriginalColors: boolean;     // Use colors from file
  colorA: [number, number, number]; // Primary color RGB 0-255
  colorB: [number, number, number]; // Secondary color RGB 0-255
  colorMix: number;               // 0 = colorA, 1 = colorB, 0.5 = blend
  hueShift: number;               // -180 to 180

  // Camera/3D view (flattened for easier access)
  cameraOrbitEnabled: boolean;  // Enable orbit controls
  autoRotate: boolean;          // Auto-rotate camera
  autoRotateSpeed: number;      // Degrees per second
  cameraDistance: number;       // Distance from center
  cameraFov: number;            // Field of view
  cameraOrbitX: number;         // Orbit angle X (degrees)
  cameraOrbitY: number;         // Orbit angle Y (degrees)
  cameraRoll: number;           // Camera roll / Z rotation (degrees)
  cameraPanX: number;           // Pan offset X
  cameraPanY: number;           // Pan offset Y
  cameraLookAt: { x: number; y: number; z: number };

  // Transform (3D transforms)
  scaleUniform: number;           // Uniform scale 0.1-10
  rotationX: number;              // Rotation in degrees
  rotationY: number;
  rotationZ: number;
  positionX: number;              // Position offset
  positionY: number;
  positionZ: number;
  showTransformGizmo: boolean;
  // Source-coordinate correction. This is applied before the manual gizmo
  // transform so animation, interaction, and camera controls all see Y-up data.
  importOrientation: SplatImportOrientation;
  importRotationX: number;
  importRotationY: number;
  importRotationZ: number;
  // Best-effort recommendation computed once when source data loads.
  autoLevelRotationX?: number;
  autoLevelRotationY?: number;
  autoLevelRotationZ?: number;
  autoLevelConfidence?: number;

  // Animation
  animationType: SplatAnimationType;
  animationSpeed: number;         // 0.1-5
  animationProgress: number;      // 0-1 manual control
  animationLoop: boolean;
  animationPingPong: boolean;
  animationIntensity: number;     // Effect strength 0-2

  // Animation-specific params
  explodeForce: number;           // 0-5
  explodeTurbulence: number; // 0-2
  implodeForce: number;           // 0-5
  implodeSpin: number; // 0-4
  voxelGridSize: number;          // 2-64
  peelAxis: 'x' | 'y' | 'z';
  peelDirection: 1 | -1;
  peelWidth: number; // 0.05-2
  peelCurl: number; // 0-4
  sliceWidth: number; // 0.05-2
  sliceSoftness: number; // 0-1
  sliceTravel: number; // 0.25-3
  waveAxis: 'x' | 'y' | 'z';
  animationWaveFrequency: number; // 0.25-12
  animationWaveAmplitude: number; // 0-2
  scatterDistance: number; // 0-5
  scatterRandomness: number; // 0-2
  spiralRadius: number; // 0-4
  spiralTurns: number; // 0.25-8
  spiralLift: number; // -3 to 3
  swarmCohesion: number;          // 0-1
  swarmSeparation: number;        // 0-1
  swarmAlignment: number;         // 0-1
  gravityStrength: number; // 0-20
  gravitySpread: number; // 0-2
  gravityFloor: number; // -3 to 1
  turntableTilt: number; // -90 to 90
  tumbleSpread: number; // 0-2
  breatheAmount: number; // 0-1
  driftAmount: number; // 0-2
  vortexTwist: number; // 0-6
  morphRoundness: number; // 0-1

  // Slice plane
  slicePlane: SplatSlicePlane;

  // Physics (nested and flattened for UI)
  physics: SplatPhysics;
  physicsEnabled: boolean;        // Enable physics simulation
  gravity: number;                // -20 to 20
  friction: number;               // 0 to 1
  bounciness: number;             // 0 to 1

  // Displacement effects
  displacementType: SplatDisplacementType;
  displacementAmount: number;     // 0-2
  displacementIntensity: number;  // Alias for UI 0-2
  displacementSpeed: number;      // Alias for UI 0-5
  displacementScale: number;      // Alias for UI 0.1-10
  noiseScale: number;             // 0.1-10
  noiseSpeed: number;             // 0-5
  noiseOctaves: number;           // 1-6
  waveFrequency: number;          // 0.5-10
  waveAmplitude: number;          // 0-1
  glitchIntensity: number;        // 0-1
  glitchFrequency: number;        // 0-10
  windDirection: { x: number; y: number; z: number };
  windStrength: number;           // 0-2

  // Audio reactivity
  audioEnabled: boolean;
  audioSensitivity: number;       // 0-3
  audioBand: 'sub' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'high' | 'all';
  audioDisplacement: number;      // 0-1
  audioScale: number;             // 0-1
  audioColor: number;             // 0-1
  audioSmoothing: number; // 0-0.98

  // Color effects
  colorEffectType: SplatColorEffectType;
  colorEffect: SplatColorEffectType;  // Alias for UI
  colorEffectIntensity: number;   // 0-1
  colorEffectSpeed: number;       // 0-5
  tintColor: string;              // Hex color for tint
  tintStrength: number;           // 0-1
  heatmapMin: number;             // 0-1
  heatmapMax: number;             // 0-1
  depthColorNear: string; // Near color for depth gradient
  depthColorFar: string; // Far color for depth gradient
  depthGradientBias: number; // 0-1 depth gradient midpoint
  hologramSpeed: number;          // 0-10
  hologramDensity: number;        // 1-50

  // Opacity effects
  opacityEffectType: SplatOpacityEffectType;
  opacityEffect: SplatOpacityEffectType;  // Alias for UI
  opacityEffectIntensity: number; // 0-1
  dofFocalDistance: number;       // 0-1
  dofFocusDistance: number;       // Alias for UI 0-100
  dofBlurAmount: number;          // 0-1
  fogDensity: number;             // 0-1
  fogColor: string;               // Hex color (UI uses string)
  pulseSpeed: number;             // 0-5
  proximityRadius: number;        // 0-1
  dissolveProgress: number;       // 0-1

  // Lighting and atmosphere
  lightingEnabled: boolean;
  ambientIntensity: number; // 0-2
  keyLightIntensity: number; // 0-4
  keyLightColor: string;
  keyLightAzimuth: number; // -180 to 180
  keyLightElevation: number; // -90 to 90
  rimLightIntensity: number; // 0-4
  rimLightColor: string;
  rimLightAzimuth: number; // -180 to 180
  shadowStrength: number; // 0-1
  shadowSoftness: number; // 0-1
  specularStrength: number; // 0-2
  atmosphereEnabled: boolean;
  atmosphereDensity: number; // 0-1
  atmosphereColor: string;
  atmosphereScale: number; // 0.1-8
  atmosphereTurbulence: number; // 0-2
  atmosphereSpeed: number; // 0-3
  backgroundOpacity: number; // 0-1
  backgroundColor: string;

  // Creative effects
  creativeEffectType: SplatCreativeEffectType;
  creativeEffect: SplatCreativeEffectType;  // Alias for UI
  creativeEffectIntensity: number; // 0-1
  trailLength: number;            // 1-100 (integer count)
  trailFade: number;              // Alias for decay 0-1
  trailDecay: number;             // 0-1
  feedbackAmount: number;         // 0-1
  kaleidoscopeSegments: number;   // 2-16
  constellationDistance: number;  // 0-1
  constellationMaxDistance: number;  // Alias 0-1
  constellationOpacity: number;   // 0-1
  echoCount: number;              // 1-10
  echoDelay: number;              // 0-1

  // Interaction
  mouseInfluence: number;         // 0-1 (how much mouse affects points)
  mouseRadius: number;            // Influence radius 0-1
  mouseStrength: number;          // 0-2 for UI
  mouseMode: 'attract' | 'repel' | 'swirl' | 'reveal';
  mouseInteraction: SplatMouseInteraction;  // Alias for UI

  // Post-processing
  bloom: number;                  // 0-3
  bloomThreshold: number;         // 0-1
  chromatic: number;              // 0-0.02
  vignette: number;               // 0-1

  // Per-parameter Auto playheads. Audio/LFO routing lives in the
  // modulation store; Auto persists with the splat layer itself.
  paramAuto?: Record<string, AutoConfig>;
}

export function createDefaultSplatContent(): SplatContent {
  return {
    dataType: 'pointcloud',
    filePath: '',
    pointCount: 0,
    pointDensity: 1,        // 100% of points
    activePointCount: 0,

    textureEnabled: false,
    texturePath: '',
    textureBlend: 0.5,
    textureType: 'image',
    textureProjection: 'spherical',
    textureScale: 1,
    textureOffsetX: 0,
    textureOffsetY: 0,

    renderMode: 'points',
    pointSize: 3,
    pointSizeAttenuation: true,
    sizeAttenuation: true,
    depthTest: true,
    opacity: 1,

    useOriginalColors: true,
    colorA: [255, 255, 255],
    colorB: [100, 200, 255],
    colorMix: 0,
    hueShift: 0,

    // Camera (flattened)
    cameraOrbitEnabled: true,
    autoRotate: false,
    autoRotateSpeed: 1,
    cameraDistance: 5,
    cameraFov: 60,
    cameraOrbitX: 0,
    cameraOrbitY: 0,
    cameraRoll: 0,
    cameraPanX: 0,
    cameraPanY: 0,
    cameraLookAt: { x: 0, y: 0, z: 0 },

    scaleUniform: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    showTransformGizmo: true,
    importOrientation: 'authored',
    importRotationX: 0,
    importRotationY: 0,
    importRotationZ: 0,

    animationType: 'none',
    animationSpeed: 1,
    animationProgress: 0,
    animationLoop: true,
    animationPingPong: false,
    animationIntensity: 1,

    explodeForce: 1,
    explodeTurbulence: 0.25,
    implodeForce: 1,
    implodeSpin: 0.5,
    voxelGridSize: 16,
    peelAxis: 'y',
    peelDirection: 1,
    peelWidth: 0.5,
    peelCurl: 1.5,
    sliceWidth: 0.35,
    sliceSoftness: 0.25,
    sliceTravel: 1,
    waveAxis: 'y',
    animationWaveFrequency: 3,
    animationWaveAmplitude: 0.35,
    scatterDistance: 1.5,
    scatterRandomness: 0.75,
    spiralRadius: 1,
    spiralTurns: 2,
    spiralLift: 0.75,
    swarmCohesion: 0.5,
    swarmSeparation: 0.5,
    swarmAlignment: 0.5,
    gravityStrength: 5,
    gravitySpread: 0.25,
    gravityFloor: -2,
    turntableTilt: 0,
    tumbleSpread: 1,
    breatheAmount: 0.25,
    driftAmount: 0.5,
    vortexTwist: 2,
    morphRoundness: 0.85,

    slicePlane: {
      enabled: false,
      axis: 'y',
      position: 0,
      thickness: 0.1,
      animated: false,
      speed: 1,
      mode: 'reveal',
    },

    physics: {
      gravity: 0,
      damping: 0.95,
      bounce: 0.5,
      turbulence: 0,
      attractorStrength: 0,
      attractorPosition: { x: 0, y: 0, z: 0 },
    },

    displacementType: 'none',
    displacementAmount: 0.5,
    noiseScale: 2,
    noiseSpeed: 1,
    noiseOctaves: 3,
    waveFrequency: 2,
    waveAmplitude: 0.3,
    glitchIntensity: 0.5,
    glitchFrequency: 2,
    windDirection: { x: 1, y: 0, z: 0 },
    windStrength: 0.5,

    audioEnabled: false,
    audioSensitivity: 1,
    audioBand: 'all',
    audioDisplacement: 0.5,
    audioScale: 0.3,
    audioColor: 0.5,
    audioSmoothing: 0.7,

    // Physics flattened
    physicsEnabled: false,
    gravity: 0,
    friction: 0.05,
    bounciness: 0.5,

    // Displacement aliases
    displacementIntensity: 0.5,
    displacementSpeed: 1,
    displacementScale: 2,

    // Color effects
    colorEffectType: 'none',
    colorEffect: 'none',  // Alias for UI
    colorEffectIntensity: 1,
    colorEffectSpeed: 1,
    tintColor: '#ffffff',
    tintStrength: 0,
    heatmapMin: 0,
    heatmapMax: 1,
    depthColorNear: '#ff5c33',
    depthColorFar: '#3377ff',
    depthGradientBias: 0.5,
    hologramSpeed: 2,
    hologramDensity: 20,

    // Opacity effects
    opacityEffectType: 'none',
    opacityEffect: 'none',  // Alias for UI
    opacityEffectIntensity: 1,
    dofFocalDistance: 0.5,
    dofFocusDistance: 50,  // Alias for UI (0-100)
    dofBlurAmount: 0.5,
    fogDensity: 0.3,
    fogColor: '#323250',  // Hex color string for UI
    pulseSpeed: 1,
    proximityRadius: 0.3,
    dissolveProgress: 0,

    // Lighting and atmosphere
    lightingEnabled: true,
    ambientIntensity: 1,
    keyLightIntensity: 1.25,
    keyLightColor: '#ffffff',
    keyLightAzimuth: 35,
    keyLightElevation: 45,
    rimLightIntensity: 0.65,
    rimLightColor: '#59d9ff',
    rimLightAzimuth: -135,
    shadowStrength: 0.35,
    shadowSoftness: 0.5,
    specularStrength: 0.35,
    atmosphereEnabled: false,
    atmosphereDensity: 0.25,
    atmosphereColor: '#6a7da8',
    atmosphereScale: 1.5,
    atmosphereTurbulence: 0.7,
    atmosphereSpeed: 0.25,
    backgroundOpacity: 0,
    backgroundColor: '#000000',

    // Creative effects
    creativeEffectType: 'none',
    creativeEffect: 'none',  // Alias for UI
    creativeEffectIntensity: 1,
    trailLength: 10,  // Integer count 1-100
    trailFade: 0.9,   // Alias for decay
    trailDecay: 0.9,
    feedbackAmount: 0.3,
    kaleidoscopeSegments: 6,
    constellationDistance: 0.1,
    constellationMaxDistance: 0.1,  // Alias
    constellationOpacity: 0.5,
    echoCount: 3,
    echoDelay: 0.1,

    // Mouse interaction
    mouseInfluence: 0,
    mouseRadius: 0.2,
    mouseStrength: 0.5,  // Alias for UI
    mouseMode: 'attract',
    mouseInteraction: 'none',  // Alias for UI

    bloom: 0,
    bloomThreshold: 0.5,
    chromatic: 0,
    vignette: 0,
  };
}

// ============================================================================
// 3D MODEL LAYER TYPES
// ============================================================================

// Supported 3D model formats
export type Model3DFormat = 'glb' | 'gltf' | 'obj' | 'fbx';

// Material types for 3D models
export type Model3DMaterialType =
  | 'source'        // Preserve materials and textures embedded in the model
  | 'standard'      // PBR material
  | 'wireframe'     // Lines only
  | 'glass'         // Transparent refraction
  | 'chrome'        // Mirror reflective
  | 'hologram'      // Sci-fi scanlines
  | 'lava'          // Animated magma
  | 'ice'           // Frosted translucent
  | 'neon'          // Glowing emissive
  | 'xray'          // Medical see-through
  | 'toon'          // Cel-shaded
  | 'matcap'        // Lit sphere texture
  | 'fresnel'       // Edge glow falloff
  | 'dissolve'      // Noise disintegration
  | 'glitch'        // Digital corruption
  | 'normal'        // Normal map visualization
  | 'depth';        // Depth visualization

// Wireframe modes
export type Model3DWireframeMode =
  | 'none'
  | 'classic'       // Standard edges
  | 'animated'      // Flowing lines
  | 'glow'          // Soft glow
  | 'neon'          // Hard neon tubes
  | 'pulse'         // Brightness pulsing
  | 'rainbow'       // Color cycling
  | 'dotted'        // Dashed lines
  | 'thick';        // Variable thickness

// Vertex decoration types
export type Model3DVertexDecoration =
  | 'none'
  | 'spheres'       // Spheres at vertices
  | 'cubes'         // Cubes at vertices
  | 'pyramids'      // Tetrahedrons
  | 'points'        // GL_POINTS
  | 'stars'         // Star shapes
  | 'diamonds';     // Diamond shapes

// Deformation types
export type Model3DDeformationType =
  | 'none'
  | 'noise'         // Perlin displacement
  | 'wave'          // Sinusoidal ripple
  | 'twist'         // Rotate along axis
  | 'bend'          // Arc deformation
  | 'taper'         // Scale along axis
  | 'spherify'      // Pull to sphere
  | 'inflate'       // Push along normals
  | 'explode'       // Faces fly outward (steady — pair with rotate animation)
  | 'implode'       // Collapse to center (steady)
  | 'shatter'       // Break into fragments (steady)
  | 'melt'          // Drip downward
  | 'pixelate'      // Voxelize mesh
  | 'jelly'         // Bouncy soft body
  | 'breathe'       // Pulsing scale
  | 'pulse'         // Concentric ripple from center
  | 'bulge'         // Traveling outward wave
  | 'tentacle'      // Tendril-like waves
  | 'magnetic'      // Pull toward poles
  | 'swirl'         // Helical vortex
  | 'fracture';     // Split into chunks with separation

// Animation types for 3D models
export type Model3DAnimationType =
  | 'none'
  | 'rotate'        // Continuous rotation
  | 'orbit'         // Circular path
  | 'bounce'        // Vertical bounce
  | 'swing'         // Pendulum motion
  | 'float'         // Gentle floating
  | 'shake'         // Vibration
  | 'spiral'        // Spiral path
  | 'fadeIn'        // Opacity fade
  | 'scaleIn'       // Scale from 0
  | 'unfold'        // Origami unfold
  | 'assemble'      // Parts fly in
  | 'grow'          // Organic growth
  | 'morphLoop'     // Morph keyframes
  | 'colorCycle'    // Hue rotation
  | 'texturePan';   // UV animation

// Echo/Trail effect types
export type Model3DEchoType =
  | 'none'
  | 'ghostTrail'    // Fading copies behind
  | 'motionBlur'    // Blur along path
  | 'afterimage'    // Persistent ghosts
  | 'strobeCopies'  // Discrete snapshots
  | 'stream'        // Flowing copies
  | 'swarm'         // Boid flock
  | 'grid'          // 3D grid array
  | 'radial'        // Around center
  | 'spiral'        // Spiral arrangement
  | 'random'        // Random scatter
  | 'fountain'      // Emit and fall
  | 'tornado'       // Spiral vortex
  | 'explosion'     // Burst outward
  | 'orbit'         // Orbiting copies
  | 'matrix'        // Matrix falling
  | 'dna'           // Double helix
  | 'kaleidoscope'; // Mirrored copies

// Render style types
export type Model3DRenderStyle =
  | 'solid'         // Normal rendering
  | 'wireframeSolid' // Wire + solid
  | 'pointCloud'    // As particles
  | 'voxel'         // Minecraft style
  | 'sketch'        // Pencil drawing
  | 'blueprint'     // Technical drawing
  | 'holographic'   // Sci-fi projection
  | 'thermal'       // Heat map
  | 'ascii';        // ASCII art

// Lighting presets
export type Model3DLightingPreset =
  | 'studio'        // 3-point lighting
  | 'dramatic'      // High contrast
  | 'neon'          // Colored rim
  | 'sunrise'       // Warm gradient
  | 'moonlight'     // Cool blue
  | 'disco'         // Animated colors
  | 'none';         // Unlit

// Texture source configuration
export interface Model3DTextureSource {
  type: 'none' | 'image' | 'video' | 'shader';
  path: string;                 // Data URL or blob URL
  blend: number;                // 0-1 blend with material
  uvScale: number;              // UV scale factor
  uvOffsetX: number;
  uvOffsetY: number;
  uvRotation: number;           // UV rotation in degrees
}

// Echo/instancing configuration
export interface Model3DEchoConfig {
  enabled: boolean;
  type: Model3DEchoType;
  count: number;                // Number of copies (1-100)
  spacing: number;              // Distance between copies
  fadeRate: number;             // Opacity decay per copy
  scaleVariation: number;       // Random scale 0-1
  rotationVariation: number;    // Random rotation
  colorVariation: number;       // Hue shift per copy
  phaseOffset: number;          // Animation offset
  speed: number;                // Animation speed
}

// Camera configuration for 3D view
export interface Model3DCamera {
  autoRotate: boolean;
  rotateSpeed: number;
  distance: number;
  fov: number;
  orbitX: number;
  orbitY: number;
  roll: number;
  panX: number;
  panY: number;
}

// Audio reactivity mapping
export interface Model3DAudioMapping {
  enabled: boolean;
  scaleResponse: number;        // 0-1 scale reaction
  rotationResponse: number;     // 0-1 rotation reaction
  deformResponse: number;       // 0-1 deformation reaction
  colorResponse: number;        // 0-1 color reaction
  emissiveResponse: number;     // 0-1 glow reaction
  audioBand: 'sub' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'high' | 'all';
}

// Main 3D Model content interface
export interface Model3DContent {
  // Model data
  modelData: string | null;     // Data URL or blob URL
  modelFormat: Model3DFormat;
  modelName: string;
  vertexCount: number;          // Read-only, set on load
  faceCount: number;            // Read-only
  // Durable file identity (resolves modelData on reload — survives blob URL death).
  _assetRef?: import('./storage/assetRegistry').AssetRef;

  // Material
  materialType: Model3DMaterialType;
  materialColor: [number, number, number];  // RGB 0-255
  materialRoughness: number;    // 0-1
  materialMetalness: number;    // 0-1
  materialOpacity: number;      // 0-1
  materialEmissive: [number, number, number];  // Emissive color
  materialEmissiveIntensity: number;  // 0-5

  // Material-specific params
  hologramScanSpeed: number;    // For hologram
  hologramScanCount: number;
  hologramGlitchIntensity: number;
  hologramRimColor: [number, number, number];
  lavaFlowSpeed: number;        // For lava
  lavaCrackIntensity: number;
  lavaGlowColor: [number, number, number];
  iceRefraction: number;        // For ice
  iceFrostIntensity: number;
  glassIOR: number;             // For glass
  glassThickness: number;
  chromeReflectivity: number;   // For chrome
  dissolveAmount: number;       // For dissolve 0-1
  dissolveEdgeColor: [number, number, number];
  dissolveEdgeWidth: number;
  toonLevels: number;           // For toon shading
  toonEdgeThickness: number;
  fresnelPower: number;         // For fresnel
  fresnelColor: [number, number, number];

  // Textures
  diffuseTexture: Model3DTextureSource;
  normalTexture: Model3DTextureSource;
  emissiveTexture: Model3DTextureSource;

  // Wireframe
  wireframeMode: Model3DWireframeMode;
  wireframeColor: [number, number, number];
  wireframeOpacity: number;
  wireframeThickness: number;
  wireframeAnimSpeed: number;

  // Vertex decorations
  vertexDecoration: Model3DVertexDecoration;
  vertexDecorationSize: number;
  vertexDecorationColor: [number, number, number];

  // Deformation
  deformationType: Model3DDeformationType;
  deformationIntensity: number;
  deformationSpeed: number;
  deformationScale: number;
  deformationAxis: 'x' | 'y' | 'z' | 'all';
  // Multiplier on outward/extent displacement — pushes pieces farther for explode/shatter/etc.
  // 1.0 = legacy behavior, up to ~6 for extreme spread.
  deformationSpread: number;

  // Animation
  animationType: Model3DAnimationType;
  animationSpeed: number;
  animationIntensity: number;
  animationLoop: boolean;
  animationProgress: number;    // Manual control 0-1

  // Echo/Instancing
  echo: Model3DEchoConfig;

  // Render style
  renderStyle: Model3DRenderStyle;

  // Transform
  scaleUniform: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  positionX: number;
  positionY: number;
  positionZ: number;

  // Camera
  camera: Model3DCamera;

  // Lighting
  lightingPreset: Model3DLightingPreset;
  ambientIntensity: number;
  directionalIntensity: number;
  lightColor: [number, number, number];
  environmentEnabled: boolean;
  environmentIntensity: number;
  toneMappingExposure: number;
  backgroundMode: 'transparent' | 'color' | 'environment';
  backgroundColor: [number, number, number];
  backgroundOpacity: number;
  keyLightAzimuth: number;
  keyLightElevation: number;
  fillIntensity: number;
  rimIntensity: number;
  rimColor: [number, number, number];
  shadowsEnabled: boolean;
  shadowQuality: 'low' | 'medium' | 'high';
  shadowSoftness: number;
  shadowBias: number;

  // Audio reactivity
  audio: Model3DAudioMapping;

  // Post-processing
  bloom: number;
  bloomThreshold: number;
  chromatic: number;
  vignette: number;

  // Beat sync
  beatScale: number;            // Scale punch on beat 0-1
  beatRotate: number;           // Rotation on beat 0-1
  beatExplode: number;          // Scatter on beat 0-1
  beatColorFlash: number;       // Color flash 0-1

  // File animation (GLTF/FBX embedded animations)
  useFileAnimation?: boolean;     // default true — play embedded animations
  fileAnimationSpeed?: number;    // default 1 — playback speed multiplier
  hasFileAnimations?: boolean;    // read-only — set after loading
}

// Create default Model3D content
export function createDefaultModel3DContent(): Model3DContent {
  return {
    modelData: null,
    modelFormat: 'glb',
    modelName: '',
    vertexCount: 0,
    faceCount: 0,

    materialType: 'source',
    materialColor: [200, 200, 200],
    materialRoughness: 0.5,
    materialMetalness: 0.0,
    materialOpacity: 1.0,
    materialEmissive: [0, 0, 0],
    materialEmissiveIntensity: 0,

    hologramScanSpeed: 2,
    hologramScanCount: 20,
    hologramGlitchIntensity: 0.3,
    hologramRimColor: [0, 200, 255],
    lavaFlowSpeed: 1,
    lavaCrackIntensity: 0.5,
    lavaGlowColor: [255, 100, 0],
    iceRefraction: 1.3,
    iceFrostIntensity: 0.5,
    glassIOR: 1.5,
    glassThickness: 0.5,
    chromeReflectivity: 1.0,
    dissolveAmount: 0,
    dissolveEdgeColor: [255, 100, 0],
    dissolveEdgeWidth: 0.05,
    toonLevels: 4,
    toonEdgeThickness: 2,
    fresnelPower: 2,
    fresnelColor: [100, 200, 255],

    diffuseTexture: { type: 'none', path: '', blend: 1, uvScale: 1, uvOffsetX: 0, uvOffsetY: 0, uvRotation: 0 },
    normalTexture: { type: 'none', path: '', blend: 1, uvScale: 1, uvOffsetX: 0, uvOffsetY: 0, uvRotation: 0 },
    emissiveTexture: { type: 'none', path: '', blend: 1, uvScale: 1, uvOffsetX: 0, uvOffsetY: 0, uvRotation: 0 },

    wireframeMode: 'none',
    wireframeColor: [100, 200, 255],
    wireframeOpacity: 1,
    wireframeThickness: 1,
    wireframeAnimSpeed: 1,

    vertexDecoration: 'none',
    vertexDecorationSize: 0.05,
    vertexDecorationColor: [255, 255, 255],

    deformationType: 'none',
    deformationIntensity: 0.5,
    deformationSpeed: 1,
    deformationScale: 2,
    deformationAxis: 'all',
    deformationSpread: 1,

    animationType: 'none',
    animationSpeed: 1,
    animationIntensity: 1,
    animationLoop: true,
    animationProgress: 0,

    echo: {
      enabled: false,
      type: 'none',
      count: 5,
      spacing: 0.5,
      fadeRate: 0.2,
      scaleVariation: 0,
      rotationVariation: 0,
      colorVariation: 0,
      phaseOffset: 0.1,
      speed: 1,
    },

    renderStyle: 'solid',

    scaleUniform: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    positionX: 0,
    positionY: 0,
    positionZ: 0,

    camera: {
      autoRotate: false,
      rotateSpeed: 1,
      distance: 5,
      fov: 50,
      orbitX: 0,
      orbitY: 20,
      roll: 0,
      panX: 0,
      panY: 0,
    },

    lightingPreset: 'studio',
    ambientIntensity: 0.4,
    directionalIntensity: 1.0,
    lightColor: [255, 255, 255],
    environmentEnabled: true,
    environmentIntensity: 1,
    toneMappingExposure: 1,
    backgroundMode: 'transparent',
    backgroundColor: [8, 8, 12],
    backgroundOpacity: 1,
    keyLightAzimuth: 45,
    keyLightElevation: 50,
    fillIntensity: 0.35,
    rimIntensity: 0.4,
    rimColor: [120, 180, 255],
    shadowsEnabled: true,
    shadowQuality: 'medium',
    shadowSoftness: 1,
    shadowBias: -0.0005,

    audio: {
      enabled: false,
      scaleResponse: 0.3,
      rotationResponse: 0,
      deformResponse: 0.5,
      colorResponse: 0.3,
      emissiveResponse: 0.5,
      audioBand: 'all',
    },

    bloom: 0,
    bloomThreshold: 0.5,
    chromatic: 0,
    vignette: 0,

    beatScale: 0,
    beatRotate: 0,
    beatExplode: 0,
    beatColorFlash: 0,
  };
}

// Layer shape configuration
export interface LayerShape {
  type: LayerShapeType;
  params: LayerShapeParams;
  enabled: boolean;
  // Control points for warping the shape (normalized 0-1 coordinates)
  // These are the shape's vertices that can be individually moved
  controlPoints?: Point2D[];
}

// Edge effects: drawing-layer-style effects applied to media layer shape edges
export interface EdgeEffect {
  id: string;
  enabled: boolean;
  fill: Fill;
  stroke: Stroke;
  animation: Animation;
  blendMode: BlendMode;
  opacity: number;
  /** Per-param Auto playhead state. Keyed by the dotted param path
   *  used in the UI (e.g. `stroke.width`, `fill.speed`, `animation.count`,
   *  or top-level `opacity`). Same role as Effect.paramAuto — see
   *  AutoConfig above. */
  paramAuto?: Record<string, AutoConfig>;
}

export interface EdgeEffectsConfig {
  enabled: boolean;
  effects: EdgeEffect[];
}

export const VJ_MIX_SOURCE_INDEX = -1;

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  source: MediaSource | null;  // For media layers
  linesContent: LinesContent | null;  // For lines layers
  svgContent: SVGContent | null;  // For SVG layers
  colorContent: ColorContent | null;  // For solid color layers
  lightPaintingContent: LightPaintingContent | null;  // For light painting layers
  advLightPaintingContent: AdvLightPaintingContent | null;  // For Adv Light Painting layers (WebGPU)
  textContent: TextContent | null;  // For text layers
  splatContent: SplatContent | null;  // For splat (point cloud/gaussian splat) layers
  model3dContent: Model3DContent | null;  // For 3D model layers
  pixelFXContent: PixelFXContent | null;  // For pixel-fx layers (WebGPU source-to-particles)
  gpuLayerContent: GPULayerContent | null; // For 'gpu' layers (swappable WebGPU shaders)
  arcadeContent: ArcadeLayerContent | null; // For 'arcade' layers (gamified visuals + game packs)

  // Transform (applied to the whole layer quad)
  position: Point2D;  // Offset in normalized coords (0-1)
  scale: Point2D;
  rotation: number;   // degrees
  flipH: boolean;     // Horizontal flip
  flipV: boolean;     // Vertical flip

  // Warping
  warpMode: WarpMode;
  corners: WarpCorners;
  meshGrid: MeshWarpGrid | null;

  // Mask (click-point polygon mask)
  mask: MaskConfig | null;

  // Input crop/slice (what portion of the source to use)
  cropRegion: CropRegion | null;

  // Layer shape mask (circle, triangle, line, etc.)
  layerShape: LayerShape | null;

  // Effects (applied to both media and generative layers)
  effects: Effect[];

  // Edge effects (fill/stroke/animation applied to shape edges, composited with blend mode)
  edgeEffects: EdgeEffectsConfig | null;

  // Content fit mode: how source content maps to the layer quad
  contentFit?: ContentFitMode;

  // Render quality multiplier for shader layers (1.0 = full res, 0.5 = half, 0.25 = quarter)
  // Lower values dramatically improve performance for heavy raymarched shaders
  renderQuality?: number;

  // Stage Mode: which VJ layer feeds this mapping layer (undefined = use own source, -1 = VJ Mix)
  vjLayerIndex?: number;

  // Stage Designer surfaces use canvas Y-down coordinates while source
  // textures use UV Y-up coordinates. Set on Stage-generated screen layers
  // so source orientation remains stable after users rotate or warp them.
  stageTextureFlipV?: boolean;

  // ── Deck confidence monitors (native crossfade mode) ───────────────────
  /** VJ bank tag for the native deck monitors: bank layers composite at
   *  opacity 0 in the program mix, but the core re-renders tagged layers
   *  into the Deck A / Deck B monitor targets at their true level. */
  _deckMonitorBank?: 'a' | 'b';
  /** True pre-crossfader opacity for the monitor pass. */
  _deckMonitorOpacity?: number;

  // ── Group nesting ──────────────────────────────────────────────────────
  /** ID of parent group layer (undefined/null = top-level layer) */
  parentGroupId?: string | null;
  /** Group configuration (only meaningful when type === 'group') */
  groupConfig?: GroupConfig;
  /** UI collapse state for groups */
  groupCollapsed?: boolean;

  // ── VJ crossfader bank routing ────────────────────────────────────────
  /**
   * Bank assignment when the VJ crossfader is enabled. Layers tagged 'A' or
   * 'B' render to their respective offscreen bank target; the engine then
   * mixes the two via the active transition shader.
   *
   * Set by `vjOutputLayers` when `crossfaderEnabled` is true on the
   * launcher store; undefined in single-bank mode (engine renders the
   * normal single composite path).
   */
  bank?: 'A' | 'B';
}

// Effect types — 81 curated effects with unique shader implementations
export type EffectType =
  // ── WebGPU compute / fragment effects ──
  // Names are prefixed `gpu` so the engine can dispatch them via the
  // gpuEffectRunner instead of the regular WebGL effect chain.
  | 'gpuFluidSim'
  | 'eulerianMagnify'
  // Masking (2)
  | 'vignette'
  | 'edgeFeather'
  // Color (15)
  | 'colorama'
  | 'plasma'
  | 'invert'
  | 'posterize'
  | 'exposure'
  | 'gamma'
  | 'vibrance'
  | 'temperatureTint'
  | 'colorBalance'
  | 'curves'
  | 'liftGammaGain'
  | 'thermal'
  | 'nightVision'
  | 'filmicTonemap'
  | 'selectiveColor'
  // Stylize (14)
  | 'dither'
  | 'edgeDetect'
  | 'outline'
  | 'emboss'
  | 'vhs'
  | 'glitch'
  | 'rgbShift'
  | 'scanlines'
  | 'fmScanlines'
  | 'phaseLab'
  | 'pixelate'
  | 'halftone'
  | 'toon'
  | 'kuwahara'
  | 'oilPaint'
  | 'watercolor'
  // Blur & Focus (7)
  | 'blur'
  | 'sharpen'
  | 'directionalBlur'
  | 'zoomBlur'
  | 'radialBlur'
  | 'tiltShift'
  | 'defocusBokeh'
  // Light & Glow (7)
  | 'bloom'
  | 'chromaticAberration'
  | 'godRays'
  | 'halation'
  | 'anamorphicStreak'
  | 'lensDirt'
  | 'diffusionPromist'
  // Generate & Texture (4)
  | 'noise'
  | 'filmGrain'
  | 'heatHaze'
  | 'crt'
  // Distort (9)
  | 'kaleidoscope'
  | 'mirror'
  | 'wave'
  | 'fisheye'
  | 'lensDistortion'
  | 'displacement'
  | 'twirl'
  | 'pinchBulge'
  | 'polarTransform'
  // Keying (5)
  | 'chromaKey'
  | 'lumaKey'
  | 'differenceKey'
  | 'erode'
  | 'dilate'
  // Premium Color (3)
  | 'falseColor'
  | 'shadowRecovery'
  | 'highlightRolloff'
  // Premium Stylize (6)
  | 'compressionArtifacts'
  | 'ascii'
  | 'comicInk'
  | 'datamoshLite'
  | 'scanlineDrift'
  | 'tapeDropout'
  // Premium Warp (4)
  | 'rippleCaustics'
  | 'shockwave'
  | 'drosteRecursive'
  | 'slitScan'
  // Premium Atmosphere (5)
  | 'volumetricFogOverlay'
  | 'rainFogSnowOverlay'
  | 'particleOverlayFx'
  | 'glintStarburst'
  | 'embossRelight'
  // Premium Text & Pattern
  | 'dotMatrix'
  | 'matrixRain'
  | 'binaryCode'
  | 'crosshatch'
  | 'blockMosaic'
  | 'numberGrid'
  | 'braillePattern'
  | 'circuitBoard'
  | 'stainedGlass'
  | 'wovenFabric'
  | 'mosaicTile'
  | 'neonOutline'
  | 'pixelSort'
  | 'linocut'
  | 'topoMap'
  | 'ledWall'
  // Premium 3D & Advanced
  | 'explode3D'
  | 'terrain3D'
  | 'sphereProject'
  | 'cubeProject'
  | 'cylinderWrap'
  | 'torusTunnel'
  | 'diamondGem'
  | 'shatter3D'
  | 'mobiusStrip'
  | 'voxelDisplace'
  | 'waveSurface'
  | 'prismSplit'
  | 'origamiFold'
  | 'mirrorRoom'
  | 'tunnelFlight'
  | 'infiniteMirror'
  | 'fractalWarp'
  | 'crystalRefract'
  | 'feedbackZoom'
  | 'fluidDistort'
  | 'wormhole'
  | 'geometricTile'
  | 'geometricTilePro'
  | 'hexGrid'
  | 'spiralTile'
  | 'shingleStack'
  | 'voronoiShatter'
  // Premium Trails & Echo
  | 'motionTrails'
  | 'echoRepeat'
  | 'ghostDouble'
  | 'strobeFlash'
  | 'lightPaint'
  | 'recursiveEcho'
  // Blob Tracking / Analysis
  | 'blobTrack'
  | 'blobContour'
  | 'blobHeatmap'
  // VJ-only simple effects
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'hue'
  // Time-based effects
  | 'timeSmear'
  | 'chronophoto'
  // ── New Hero Effects (Batch A) ──
  | 'opticalFlowDatamosh'
  | 'flowFieldTrails'
  | 'reactionDiffusion'
  | 'neonTubeTrace'
  | 'depthParallax'
  | 'pointCloudDissolve'
  | 'pixelSand'
  | 'liquidGlass'
  | 'hologramScan'
  | 'laserSlice'
  // ── New Hero Effects (Batch B) ──
  | 'auraField'
  | 'smokeDisintegrate'
  | 'shimmerCloth'
  | 'glitchQuilt'
  | 'cellularAutomataBurn'
  | 'rorschachMirror'
  | 'spectralPrismTunnel'
  | 'ledVolume'
  | 'posterTear'
  | 'paintPeel'
  // ── New Hero Effects (Batch C) ──
  | 'audioShockBloom'
  | 'vhsFullDeck'
  | 'analogFeedbackRack'
  | 'clubLaserGrid'
  | 'mirrorShards'
  | 'ghostExposure'
  | 'thermalContour'
  | 'dreamDiffusion'
  | 'topoWarp'
  | 'strobeSequencer'
  | 'wrappedTerrain'
  // ── Geometric 3D (10) ──
  | 'stringOrb'
  | 'sphereWireframe'
  | 'voxelCubeCluster'
  | 'mobiusLattice'
  | 'crystalShardField'
  | 'tubeLattice'
  | 'discoMirrorBall'
  | 'lissajousKnot'
  | 'helixParticleStream'
  | 'donutConstellation';

export interface EffectParams {
  // ── WebGPU Fluid Sim params (gpuFluidSim) ──
  // Real-time Navier-Stokes simulation. The source layer feeds dye
  // (color) + force (luminance gradient) into the fluid; the result
  // swirls and dissipates over time.
  injectStrength?: number;          // 0..3 — how much source feeds dye + force
  velocityFromGradient?: number;    // 0..3 — luminance-gradient → velocity
  viscosity?: number;               // 0..0.01 — momentum diffusion
  dyeDecay?: number;                // 0..3 (1/sec) — exponential dye fade
  velocityDecay?: number;           // 0..3 (1/sec)
  vorticity?: number;               // 0..3 — extra swirl (vorticity confinement)
  outputBoost?: number;             // 0.5..4 — visual brightness multiplier
  timeScale?: number;               // 0.1..3 — sim speed independent of fps

  // Eulerian / phase-style motion magnification params
  eulerianMode?: number;             // 0=color pulse, 1=motion phase, 2=hybrid, 3=attenuate
  eulerianAmplification?: number;    // 0-80
  eulerianLowHz?: number;            // lower temporal cutoff
  eulerianHighHz?: number;           // upper temporal cutoff
  eulerianColorMix?: number;         // 0-1 color temporal band contribution
  eulerianMotionMix?: number;        // 0-1 phase-flow contribution
  eulerianSpatialRadius?: number;    // gradient sampling radius in pixels
  eulerianNoiseFloor?: number;       // gradient denominator guard
  eulerianMaxShift?: number;         // max motion displacement in pixels
  eulerianOutputMix?: number;        // wet/dry
  eulerianShowBand?: number;         // 0/1 debug temporal band
  eulerianChromaOnly?: number;       // 0/1 remove luma from color pulse band

  // Vignette params (hero rewrite)
  vignetteSize?: number;          // 0-1, how far vignette extends
  vignetteSoftness?: number;      // 0-1, edge softness
  vignetteRoundness?: number;     // 0-1, circular vs rectangular (legacy mix factor)
  vignetteShape?: number;         // 0=round, 1=oval, 2=square, 3=superellipse
  vignetteAspect?: number;        // 0.3-3.0 oval/superellipse aspect ratio (X/Y)
  vignetteCenterX?: number;       // 0-1 center offset
  vignetteCenterY?: number;
  vignetteColorR?: number;        // 0-1 tint color (used when tintAmount > 0)
  vignetteColorG?: number;
  vignetteColorB?: number;
  vignetteTintAmount?: number;    // 0=transparent fade (legacy), 1=solid color fade
  vignetteBreathing?: number;     // 0-1 animated size oscillation amplitude
  vignetteBreathSpeed?: number;   // 0-2 breathing speed

  // Edge feather params (hero rewrite)
  featherTop?: number;            // 0-1
  featherBottom?: number;
  featherLeft?: number;
  featherRight?: number;
  featherSoftness?: number;
  featherGamma?: number;          // 0.2-3.0 falloff curve (1.0 linear)
  featherMattePreview?: number;   // 0=normal, 1=red matte preview overlay

  // Colorama params (cosine palette effect — hero rewrite)
  coloramaPalette?: number;       // 0-11 named palettes (Rainbow, Sunset, Ocean, Neon, Fire,
                                  //   Forest, Ice, Psychedelic, Vaporwave, Club, Pastel, Mono Glow)
  coloramaOffset?: number;        // 0-1 manual offset through palette
  coloramaSpeed?: number;         // 0-2 auto-cycle speed (0 = off)
  coloramaContrast?: number;      // 0.5-2 luminance contrast
  coloramaMix?: number;           // 0-1 blend with original
  coloramaBands?: number;         // 0 = smooth gradient, 1-32 = posterized into N bands
  coloramaAudioReact?: number;    // 0-1 how much live audio rms modulates the cycling
  coloramaHueShift?: number;      // 0-1 fixed hue offset (used by Mono palette as base hue)

  // Dither params (hero — palette lock + pixel lock)
  ditherType?: number;            // 0=bayer4, 1=bayer8, 2=noise, 3=ordered, 4=floyd-style hash
  ditherIntensity?: number;       // 0-1
  ditherScale?: number;           // 1-16
  ditherColorDepth?: number;      // 1-8 bits
  ditherPalette?: number;         // 0=free, 1=gameboy, 2=cga, 3=mono, 4=c64
  ditherPixelLock?: number;       // 0-1 snap dither to pixel grid

  // VHS params
  vhsTracking?: number;           // 0-1
  vhsNoise?: number;              // 0-1
  vhsDistortion?: number;         // 0-1
  vhsColorBleed?: number;         // 0-1
  vhsScanlines?: number;          // 0-1
  vhsHeadSwitch?: number;
  vhsTapeWobble?: number;
  vhsDropout?: number;
  vhsChromaDelay?: number;
  vhsTrackingJump?: number;
  vhsSaturation?: number;

  // Glitch params
  glitchIntensity?: number;       // 0-1
  glitchSpeed?: number;           // 0-2
  glitchBlockSize?: number;       // 0-1
  glitchRGBSplit?: number;        // 0-1
  glitchJitter?: number;          // 0-1
  glitchTriggerMode?: number;
  glitchBlockHold?: number;
  glitchVerticalSlice?: number;
  glitchFreezeBurst?: number;
  glitchTearChance?: number;

  // RGB Shift (hero — directional/radial/prism/luma/edge modes)
  rgbShiftAmount?: number;        // 0-50 pixels
  rgbShiftAngle?: number;         // 0-360
  rgbShiftMode?: number;          // 0=directional, 1=radial, 2=prism, 3=luma-driven, 4=edge-driven
  rgbShiftCenterX?: number;       // 0-1 radial/prism center
  rgbShiftCenterY?: number;       // 0-1
  rgbShiftPrismSpread?: number;   // 0-3 prism rainbow spread

  // Scanlines (hero — phosphor mask + rolling bar + curvature + interlace)
  scanlinesIntensity?: number;    // 0-1
  scanlinesCount?: number;        // 50-500
  scanlinesSpeed?: number;        // 0-2
  scanlinesPhosphor?: number;     // 0-1 RGB phosphor mask strength
  scanlinesRollingBar?: number;   // 0-1 vertical rolling brightness bar
  scanlinesCurvature?: number;    // 0-1 CRT curvature warp
  scanlinesInterlace?: number;    // 0-1 odd/even field flicker

  // FM Lines (fmScanlines) — luminance-driven line displacement portrait
  fmLinesMode?: number;           // 0 horizontal, 1 vertical, 2 concentric
  fmLinesCount?: number;          // 20-400 line density
  fmLinesWidth?: number;          // 0-1 line thickness
  fmLinesFreq?: number;           // 0-1 base wave frequency
  fmLinesFmDepth?: number;        // 0-1 brightness → frequency (the "FM")
  fmLinesAmp?: number;            // 0-1 brightness → amplitude
  fmLinesSpeed?: number;          // 0-2 animation speed
  fmLinesColorMix?: number;       // 0 white lines → 1 source-tinted
  fmLinesInvert?: number;         // 0/1 dark lines on bright field

  // Phase Lab — source-driven scientific imaging modes
  phaseLabMode?: number;           // 0=BOS, 1=photoelastic, 2=Lippmann, 3=InSAR, 4/5=catoptric, 6=DTI, 7=composite
  phaseLabIntensity?: number;      // 0-4
  phaseLabScale?: number;          // 0.25-24
  phaseLabSpeed?: number;          // -4-4
  phaseLabPhase?: number;          // -TAU-TAU
  phaseLabMix?: number;            // 0-1
  phaseLabColorGain?: number;      // 0.2-4
  phaseLabSourceBleed?: number;    // 0-1
  phaseLabEdgeBoost?: number;      // 0-8
  phaseLabDistortion?: number;     // -0.25-0.25
  phaseLabLineDensity?: number;    // 1-80
  phaseLabPolarizerAngle?: number; // degrees
  phaseLabSpectralShift?: number;  // -2-2
  phaseLabFocus?: number;          // 0.1-4
  phaseLabMirrorRadius?: number;   // 0.03-0.45
  phaseLabConeLift?: number;       // 0.2-3
  phaseLabAudioReactive?: number;  // 0/1
  phaseLabAudioDrive?: number;     // 0-3

  // Pixelate (hero — modes + grid + animated)
  pixelateSize?: number;          // 1-64
  pixelateMode?: number;          // 0=square, 1=hex, 2=triangular, 3=voronoi
  pixelateGrid?: number;          // 0-1 grid line overlay strength
  pixelateAnimSpeed?: number;     // 0-2 animated size pulse speed
  pixelateAnimAmount?: number;    // 0-1 animated size pulse amount

  // Blur (hero — modes/quality/edge protect)
  blurRadius?: number;            // 0-30
  blurMode?: number;              // 0=box, 1=gaussian, 2=motion, 3=bilateral
  blurAngle?: number;             // 0-360 (motion direction)
  blurQuality?: number;           // 0=low, 1=mid, 2=high
  blurEdgeProtect?: number;       // 0-1 bilateral edge preservation
  blurMix?: number;               // 0-1 wet/dry

  // Sharpen (hero — laplacian/unsharp + clarity)
  sharpenAmount?: number;         // 0-3
  sharpenMode?: number;           // 0=laplacian, 1=unsharp mask
  sharpenRadius?: number;         // 1-8 unsharp radius
  sharpenEdgeProtect?: number;    // 0-1 limit sharpening on flat areas
  sharpenClarity?: number;        // 0-1 mid-tone contrast pop

  // Directional Blur (hero)
  dirBlurAmount?: number;         // 0-1 normalized blur length
  dirBlurAngle?: number;          // 0-360 degrees
  dirBlurSamples?: number;        // 4-32
  dirBlurFalloff?: number;        // 0-1
  dirBlurCenterBias?: number;     // 0-1 keep center sharper
  dirBlurMix?: number;            // 0-1

  // Zoom Blur (hero)
  zoomBlurAmount?: number;        // 0-1
  zoomBlurCenterX?: number;       // 0-1
  zoomBlurCenterY?: number;       // 0-1
  zoomBlurSamples?: number;       // 4-32
  zoomBlurFalloff?: number;       // 0-1
  zoomBlurChromatic?: number;     // 0-1 RGB split during zoom
  zoomBlurMix?: number;           // 0-1

  // Radial Blur (hero — spin)
  radialBlurAmount?: number;      // 0-1
  radialBlurCenterX?: number;     // 0-1
  radialBlurCenterY?: number;     // 0-1
  radialBlurSamples?: number;     // 4-32
  radialBlurFalloff?: number;     // 0-1
  radialBlurRadiusInner?: number; // 0-1 unblurred inner radius
  radialBlurRadiusOuter?: number; // 0-1 fully blurred outer radius
  radialBlurMix?: number;         // 0-1

  // Oil Paint (hero — bristle painterly)
  oilPaintRadius?: number;        // 1-8 brush radius
  oilPaintIntensity?: number;     // 4-32 quantization bins
  oilPaintBrushLength?: number;   // 0-2 directional brush length
  oilPaintBristle?: number;       // 0-1 bristle striations
  oilPaintColorPunch?: number;    // 0-1 saturation pop
  oilPaintHighlight?: number;     // 0-1 wet specular pop on bright bins
  oilPaintMode?: number;          // 0=bin pick, 1=variance pick

  // Watercolor (hero — bleed + edge darken + paper)
  watercolorBleed?: number;       // 0-1 pigment bleed radius
  watercolorEdgeDarken?: number;  // 0-1 sobel-driven edge darkening
  watercolorPaperTexture?: number;// 0-1 paper noise strength
  watercolorPaperScale?: number;  // 1-32 paper noise scale
  watercolorWetness?: number;     // 0-1 colour saturation boost (wet pigment)
  watercolorGranulation?: number; // 0-1 pigment granulation noise
  watercolorPaperHue?: number;    // 0=cream, 1=cool grey, 2=tea-stain

  // Noise (hero — multi-type generator + tonal weighting)
  noiseAmount?: number;           // 0-1
  noiseType?: number;             // 0=white, 1=blue, 2=value, 3=fbm, 4=cellular
  noiseMode?: number;             // 0=overlay, 1=add, 2=multiply, 3=screen, 4=replace
  noiseScale?: number;            // 0.5-32
  noiseMono?: number;             // 0=RGB, 1=mono
  noiseShadow?: number;           // 0-1 shadow zone amplitude
  noiseMid?: number;              // 0-1 mid zone amplitude
  noiseHigh?: number;             // 0-1 highlight zone amplitude
  noiseAnimSpeed?: number;        // 0-2

  // Kaleidoscope (hero)
  kaleidoscopeSegments?: number;  // 2-32
  kaleidoscopeAngle?: number;     // 0-360
  kaleidoscopeCenterX?: number;   // 0-1
  kaleidoscopeCenterY?: number;   // 0-1
  kaleidoscopeZoom?: number;      // 0.25-4
  kaleidoscopeMode?: number;      // 0=mirror, 1=tile, 2=spiral
  kaleidoscopeSpiral?: number;    // 0-2
  kaleidoscopeAnimSpeed?: number; // 0-2 auto-rotate
  kaleidoscopeMix?: number;       // 0-1

  // Mirror (hero)
  mirrorMode?: number;            // 0=horizontal, 1=vertical, 2=quad, 3=diagonal
  mirrorAxis?: number;            // legacy alias for backward compat
  mirrorPosition?: number;        // 0-1
  mirrorOffset?: number;          // 0-1
  mirrorFlipSide?: number;        // 0/1
  mirrorMix?: number;             // 0-1

  // Plasma params
  plasmaSpeed?: number;
  plasmaScale?: number;
  plasmaComplexity?: number;
  plasmaPalette?: number;         // 0..7
  plasmaMode?: number;
  plasmaBlendMode?: number;
  plasmaMix?: number;
  plasmaWarpAmount?: number;
  plasmaAudioReact?: number;

  // Posterize params (hero rewrite)
  posterizeLevels?: number;       // 2-32 quantization levels per channel
  posterizeDither?: number;       // 0-1 Bayer 4x4 ordered dither strength
  posterizeAnimSpeed?: number;    // 0-2 animated level stepping speed (0 = static)
  posterizePalette?: number;      // 0=free RGB, 1=comic, 2=thermal, 3=retro

  // Exposure params (hero rewrite — dedicated shader)
  exposureStops?: number;         // -2..+2 photographic stops
  exposureRollOff?: number;       // 0-1 highlight shoulder softness
  exposureHighlightProtect?: number; // 0-1 reduce gain on bright pixels

  // Gamma (hero) — three-zone gamma split
  gammaShadows?: number;          // 0.2-3.0 shadow gamma
  gammaMids?: number;             // 0.2-3.0 midtone gamma
  gammaHighlights?: number;       // 0.2-3.0 highlight gamma
  gammaMix?: number;              // 0-1 wet/dry

  // Vibrance (hero) — skin/highlight protect, ceiling, negative
  vibranceAmount?: number;        // -1..+1
  vibranceSkinProtect?: number;   // 0-1
  vibranceHighlightProtect?: number; // 0-1
  vibranceCeiling?: number;       // 0-1 saturation clamp

  // Temperature/Tint (hero) — split-tone + auto-cycle
  tempTemperature?: number;       // -1..+1 cool to warm
  tempTint?: number;              // -1..+1 green to magenta
  tempShadow?: number;            // -1..+1 split-tone shadow temp
  tempHighlight?: number;         // -1..+1 split-tone highlight temp
  tempSplitTone?: number;         // 0-1 blend between simple temp and split
  tempAutoCycle?: number;         // 0-1 auto temperature oscillation

  // Color Balance (hero) — three-zone RGB
  cbShadowR?: number;
  cbShadowG?: number;
  cbShadowB?: number; // -1..+1 each
  cbMidR?: number;
  cbMidG?: number;
  cbMidB?: number;
  cbHighR?: number;
  cbHighG?: number;
  cbHighB?: number;
  cbPreserveLuma?: number;        // 0-1 keep brightness stable
  cbMix?: number;

  // Curves (hero) — S-curve + toe + shoulder + black crush
  curvesContrast?: number;        // 0-1 S-curve strength
  curvesToe?: number;             // 0-1 lift dark end
  curvesShoulder?: number;        // 0-1 soften bright end
  curvesBlackCrush?: number;      // 0-1 crush below threshold
  curvesMix?: number;

  // Lift / Gamma / Gain (hero) — three-zone color wheels
  lggLiftR?: number;
  lggLiftG?: number;
  lggLiftB?: number; // -0.5..+0.5
  lggGammaR?: number;
  lggGammaG?: number;
  lggGammaB?: number; // 0.5..1.5
  lggGainR?: number;
  lggGainG?: number;
  lggGainB?: number; // 0.5..2.0
  lggLumaOnly?: number;           // 0=color shifts, 1=luma-only
  lggMix?: number;

  // Filmic Tonemap (hero) — multi-curve selector
  tonemapCurve?: number;          // 0=ACES, 1=Reinhard, 2=Hable, 3=Bleach, 4=Print, 5=Soft Clip
  tonemapExposure?: number;       // 0.25-4.0 pre-tonemap gain
  tonemapContrast?: number;       // 0-1 post S-curve
  tonemapMix?: number;

  // Selective Color (hero) — hue target picker, isolate/replace
  selColorTargetHue?: number;     // 0-1 hue to target
  selColorRange?: number;         // 0-1 hue band width
  selColorFeather?: number;       // 0-1 edge softness
  selColorMode?: number;          // 0=isolate (desat outside), 1=replace
  selColorReplaceHue?: number;    // 0-1 destination hue for replace mode
  selColorSatBoost?: number;      // 0-1 saturation boost on targeted pixels

  // Thermal (hero) — extra params
  thermalShimmer?: number;        // 0-1 heat-haze shimmer on hot pixels
  thermalSensorNoise?: number;    // 0-1 rolling sensor noise

  // Night Vision (hero) — extra params
  nightVisionPhosphor?: number;   // 0=green, 1=amber, 2=white phosphor
  nightVisionBloom?: number;      // 0-2 phosphor bloom strength
  nightVisionScopeMask?: number;  // 0=off, 1=circle, 2=scope crosshairs
  nightVisionRollingNoise?: number; // 0-1 horizontal rolling noise

  // Edge Detection params (hero — color edges + tint + glow)
  edgeThreshold?: number;         // 0-1
  edgeThickness?: number;         // 0.5-3
  edgeMode?: number;              // 0=sobel, 1=laplacian, 2=prewitt, 3=frei-chen, 4=color
  edgeInvert?: number;            // 0=normal, 1=inverted
  edgeTintR?: number;             // 0-1 edge tint colour
  edgeTintG?: number;
  edgeTintB?: number;
  edgeTintEdges?: number;         // 0-1 mix tint over original edges
  edgeGlow?: number;              // 0-1 edge glow falloff
  edgeOnlyAlpha?: number;         // 0-1 only show edges (transparent elsewhere)

  // Outline params (hero — inner/outer/both, crawl, glow falloff, alpha aware)
  outlineThickness?: number;      // 1-10
  outlineColor?: number[];        // RGB color
  outlineOnly?: number;           // 0=overlay, 1=outline only
  outlineGlow?: number;           // 0-1 glow amount
  outlinePosition?: number;       // 0=inner, 1=outer, 2=both
  outlineCrawl?: number;          // 0-1 marching-ants crawl speed
  outlineGlowFalloff?: number;    // 0.1-4 glow falloff exponent
  outlineAlphaAware?: number;     // 0-1 use alpha for edge detection

  // Emboss params (hero — relight + colored hi/lo + normal-map + metallic)
  embossStrength?: number;        // 0-2
  embossAngle?: number;           // 0-360
  embossHeight?: number;          // 0-4 height field exaggeration
  embossHighlightR?: number;      // 0-1 highlight tint
  embossHighlightG?: number;
  embossHighlightB?: number;
  embossShadowR?: number;         // 0-1 shadow tint
  embossShadowG?: number;
  embossShadowB?: number;
  embossNormalMode?: number;      // 0=relight, 1=normal map preview
  embossMetallicness?: number;    // 0-1 specular punch

  // Halftone (hero — CMYK + dot shapes + drift)
  halftoneDotSize?: number;       // 2-32 dot screen pixel size
  halftoneDotShape?: number;      // 0=dot, 1=square, 2=line, 3=cross
  halftoneAngleC?: number;        // 0-180 cyan screen angle
  halftoneAngleM?: number;
  halftoneAngleY?: number;
  halftoneAngleK?: number;
  halftoneMode?: number;          // 0=greyscale, 1=cmyk, 2=spot
  halftoneDrift?: number;         // 0-2 animated screen drift speed
  halftoneSpotColor?: number[];   // RGB tint for spot mode

  // Toon (hero — quantization + outlines + shadow band)
  toonSteps?: number;             // 2-12 luma quantization bands
  toonOutline?: number;           // 0-2 outline thickness (sobel)
  toonOutlineColor?: number[];    // RGB outline tint
  toonShadowBand?: number;        // 0-1 dedicated shadow band darkness
  toonRampSoftness?: number;      // 0-1 soften step transitions
  toonColorPop?: number;          // 0-1 saturation pop in lit zones

  // Kuwahara (hero — painterly oil paint smoothing)
  kuwaharaRadius?: number;        // 1-8 quadrant radius
  kuwaharaEdgeSharpness?: number; // 0-1 edge preservation strength
  kuwaharaColorPunch?: number;    // 0-1 saturation boost

  // CRT (hero)
  crtScanlines?: number;          // 0-1
  crtScanCount?: number;          // 100-1200
  crtMask?: number;               // 0-1
  crtMaskType?: number;           // 0=Trinitron, 1=Aperture grille, 2=Shadow mask
  crtCurvature?: number;          // 0-1
  crtVignette?: number;           // 0-1
  crtGlow?: number;               // 0-1
  crtRollingBar?: number;         // 0-1
  crtChromatic?: number;          // 0-1

  // Lens Distortion (hero)
  lensDistAmount?: number;        // -1..1
  lensDistMode?: number;          // 0=barrel, 1=pincushion, 2=mustache, 3=anamorphic
  lensDistCenterX?: number;       // 0-1
  lensDistCenterY?: number;       // 0-1
  lensDistCubic?: number;         // -0.5..0.5
  lensDistAnamorphicX?: number;   // 0.5-2
  lensDistEdgeFade?: number;      // 0-1
  lensDistChromaFringe?: number;  // 0-1

  // Chroma Key (hero)
  chromaKeyR?: number;            // 0-1 key colour
  chromaKeyG?: number;
  chromaKeyB?: number;
  chromaKeyTolerance?: number;    // 0-1
  chromaKeySoftness?: number;     // 0-1
  chromaKeySpill?: number;        // 0-1
  chromaKeyMatte?: number;        // 0/1 show matte
  chromaKeyMode?: number;         // 0=hue, 1=YCbCr, 2=RGB

  // Luma Key (hero)
  lumaKeyLowCut?: number;         // 0-1
  lumaKeyHighCut?: number;        // 0-1
  lumaKeyInvert?: number;         // 0/1
  lumaKeyGamma?: number;          // 0.2-3
  lumaKeyMatte?: number;          // 0/1
  lumaKeyPremultiply?: number;    // 0/1

  // Difference Key (hero)
  diffKeyR?: number;              // 0-1 reference colour
  diffKeyG?: number;
  diffKeyB?: number;
  diffKeyTolerance?: number;      // 0-1
  diffKeySoftness?: number;       // 0-1
  diffKeyInvert?: number;         // 0/1
  diffKeyMatte?: number;          // 0/1
  diffKeyMode?: number;           // 0=Euclidean, 1=Manhattan, 2=Max channel

  // Wave distortion params (hero — multi-waveform)
  waveWaveform?: number;          // 0=sin, 1=triangle, 2=saw, 3=square
  wavePhase?: number;             // 0-360
  waveSecondary?: number;         // 0-1 second harmonic
  waveChromaSplit?: number;       // 0-1 RGB phase shift
  waveAmplitude?: number;         // 0-50
  waveFrequency?: number;         // 1-30
  waveSpeed?: number;             // 0-2
  waveType?: number;              // 0=horizontal, 1=vertical, 2=radial

  // Fisheye params
  // Fisheye (hero)
  fisheyeStrength?: number;       // -1..1
  fisheyeRadius?: number;         // 0.1-1
  fisheyeCenterX?: number;        // 0-1
  fisheyeCenterY?: number;        // 0-1
  fisheyeZoom?: number;           // 0.5-2
  fisheyeMode?: number;           // 0=spherize, 1=barrel, 2=pincushion
  fisheyeChromaEdge?: number;     // 0-1

  // Thermal camera params
  thermalIntensity?: number;      // 0-2
  thermalPalette?: number;        // 0=classic, 1=ironbow, 2=arctic

  // Night vision params
  nightVisionIntensity?: number;  // 0-2
  nightVisionNoise?: number;      // 0-1
  nightVisionVignette?: number;   // 0-1

  // Tilt-Shift (hero — focus band + blur)
  tiltShiftMode?: number;          // 0=horizontal, 1=vertical, 2=radial, 3=linear gradient
  tiltShiftFocusY?: number;        // 0-1
  tiltShiftFocusX?: number;        // 0-1
  tiltShiftFocusBand?: number;     // 0-1 sharp band width
  tiltShiftFalloff?: number;       // 0-1
  tiltShiftMaxBlur?: number;       // 0-1
  tiltShiftAngle?: number;         // 0-360 (linear gradient direction)
  tiltShiftSaturation?: number;    // 0-2

  // Defocus Bokeh (hero — disc kernel)
  bokehRadius?: number;            // 0-30
  bokehSamples?: number;           // 12-48
  bokehBrightWeight?: number;      // 0-2 highlight punch
  bokehThreshold?: number;         // 0-1
  bokehChromaFringe?: number;      // 0-1
  bokehShape?: number;             // 0=disc, 1=hex, 2=octagon
  bokehRotation?: number;          // 0-360
  bokehMix?: number;               // 0-1

  // Chromatic Aberration (hero)
  caAmount?: number;               // 0-1
  caMode?: number;                 // 0=linear, 1=radial, 2=lens, 3=prism
  caAngle?: number;                // 0-360
  caCenterX?: number;              // 0-1
  caCenterY?: number;              // 0-1
  caEdgeFalloff?: number;          // 0-1
  caMix?: number;                  // 0-1

  // God Rays (hero)
  godRaysIntensity?: number;       // 0-2
  godRaysDecay?: number;           // 0.85-1.0
  godRaysExposure?: number;        // 0.1-1
  godRaysDensity?: number;         // 0-1
  godRaysThreshold?: number;       // 0-1
  godRaysCenterX?: number;         // 0-1
  godRaysCenterY?: number;         // 0-1
  godRaysSamples?: number;         // 16-128
  godRaysTintR?: number;           // 0-1
  godRaysTintG?: number;
  godRaysTintB?: number;
  godRaysMix?: number;             // 0-1

  // Halation (hero)
  halationAmount?: number;         // 0-2
  halationRadius?: number;         // 1-30
  halationThreshold?: number;      // 0-1
  halationTintR?: number;          // 0-1
  halationTintG?: number;
  halationTintB?: number;
  halationMode?: number;           // 0=screen, 1=add, 2=soft light
  halationMix?: number;            // 0-1

  // Anamorphic Streak (hero)
  anaIntensity?: number;           // 0-2
  anaLength?: number;              // 0-1
  anaThreshold?: number;           // 0-1
  anaTintR?: number;               // 0-1
  anaTintG?: number;
  anaTintB?: number;
  anaAngle?: number;               // 0-180
  anaSamples?: number;             // 16-64
  anaMix?: number;                 // 0-1

  // Lens Dirt (hero)
  dirtAmount?: number;             // 0-1
  dirtScale?: number;              // 1-32
  dirtThreshold?: number;          // 0-1
  dirtTintWarmth?: number;         // 0-1
  dirtScratches?: number;          // 0-1
  dirtSpots?: number;              // 0-1
  dirtMode?: number;               // 0=screen, 1=add, 2=multiply
  dirtAnimSpeed?: number;          // 0-1

  // Diffusion / Promist (hero)
  diffAmount?: number;             // 0-1
  diffRadius?: number;             // 1-30
  diffThreshold?: number;          // 0-1
  diffShadowLift?: number;         // 0-1
  diffHighlightBloom?: number;     // 0-1
  diffHaze?: number;               // 0-1
  diffHazeWarmth?: number;         // 0-1
  diffMix?: number;                // 0-1

  // Film Grain (hero — multi-stock)
  grainAmount?: number;            // 0-1
  grainSize?: number;              // 0.5-4
  grainShadow?: number;            // 0-1 shadow zone amplitude
  grainMid?: number;               // 0-1 mid zone amplitude
  grainHigh?: number;              // 0-1 highlight zone amplitude
  grainMono?: number;              // 0/1 mono vs RGB grain
  grainStock?: number;             // 0=fine, 1=35mm, 2=16mm, 3=Super8
  grainColorJitter?: number;       // 0-1 chroma noise
  grainAnimSpeed?: number;         // 0-1 anim cadence

  // Heat Haze (hero — animated displacement)
  hazeAmount?: number;             // 0-1
  hazeScale?: number;              // 1-32
  hazeSpeed?: number;              // 0-3
  hazeDirectionY?: number;         // -1..1
  hazeTurbulence?: number;         // 0-1
  hazeMode?: number;               // 0=heat, 1=underwater, 2=glass
  hazeFocusY?: number;             // 0-1
  hazeFocusBand?: number;          // 0-1

  // Compression Artifacts (hero — block DCT)
  compArtBlockSize?: number;       // 4-32
  compArtQuality?: number;         // 0-1 (low=more artifacts)
  compArtChromaSubsample?: number; // 0-1
  compArtBlockNoise?: number;      // 0-1
  compArtMode?: number;            // 0=DCT-style, 1=hard 8x8, 2=color banding
  compArtMix?: number;             // 0-1

  // Erode (hero)
  erodeRadius?: number;            // 1-8
  erodeShape?: number;             // 0=cross, 1=square, 2=circle
  erodeChannel?: number;           // 0=luma, 1=R, 2=G, 3=B, 4=A
  erodeMix?: number;               // 0-1

  // Dilate (hero)
  dilateRadius?: number;           // 1-8
  dilateShape?: number;            // 0=cross, 1=square, 2=circle
  dilateChannel?: number;          // 0=luma, 1=R, 2=G, 3=B, 4=A
  dilateMix?: number;              // 0-1

  // Displacement (hero — procedural noise)
  dispAmount?: number;             // 0-1
  dispScale?: number;              // 1-32
  dispSpeed?: number;              // 0-3
  dispMode?: number;               // 0=fbm, 1=cellular, 2=sine grid, 3=ripple
  dispTurbulence?: number;         // 0-1
  dispChromatic?: number;          // 0-1

  // Twirl (hero)
  twirlAngle?: number;             // radians
  twirlRadius?: number;            // 0.05-1
  twirlCenterX?: number;           // 0-1
  twirlCenterY?: number;           // 0-1
  twirlFalloff?: number;           // 0.5-4
  twirlAnimSpeed?: number;         // 0-2
  twirlMix?: number;               // 0-1

  // Pinch / Bulge (hero)
  pinchAmount?: number;            // -1..1
  pinchRadius?: number;            // 0.1-1
  pinchCenterX?: number;           // 0-1
  pinchCenterY?: number;           // 0-1
  pinchFalloff?: number;           // 0.5-4
  pinchChromatic?: number;         // 0-1
  pinchMix?: number;               // 0-1

  // Polar Transform (hero)
  polarMode?: number;              // 0=cart→polar, 1=polar→cart, 2=log polar
  polarRotation?: number;          // 0-360
  polarZoom?: number;              // 0.25-4
  polarCenterX?: number;           // 0-1
  polarCenterY?: number;           // 0-1
  polarMix?: number;               // 0-1

  // False Color (hero)
  falseColorMode?: number;         // 0=DIT exposure, 1=zone heat, 2=Resolve, 3=histogram
  falseColorMix?: number;          // 0-1
  falseColorShowOriginal?: number; // 0-1
  falseColorMidpoint?: number;     // 0-1
  falseColorRange?: number;        // 0-0.5

  // Shadow Recovery (hero)
  shadowAmount?: number;           // 0-1
  shadowThreshold?: number;        // 0-1
  shadowSoftness?: number;         // 0-1
  shadowColorRecovery?: number;    // 0-1
  shadowHighlightProtect?: number; // 0-1
  shadowMix?: number;              // 0-1

  // Highlight Rolloff (hero)
  highRolloffAmount?: number;      // 0-1
  highRolloffThreshold?: number;   // 0-1
  highRolloffSoftness?: number;    // 0-1
  highRolloffPreserveHue?: number; // 0-1
  highRolloffMaxValue?: number;    // 0.7-1.5
  highRolloffMix?: number;         // 0-1

  // ASCII (hero)
  asciiCellSize?: number;          // 4-32
  asciiContrast?: number;          // 0-2
  asciiColorMix?: number;          // 0-1
  asciiMode?: number;              // 0=density, 1=stipple, 2=block, 3=line
  asciiInvert?: number;            // 0/1
  asciiTintR?: number;             // 0-1
  asciiTintG?: number;
  asciiTintB?: number;

  // Comic Ink (hero)
  comicInkStrength?: number;       // 0-2
  comicInkThreshold?: number;      // 0-1
  comicInkPosterize?: number;      // 2-12
  comicInkHalftone?: number;       // 0-1
  comicInkHalftoneSize?: number;   // 2-16
  comicInkColorMix?: number;       // 0-1
  comicInkR?: number;
  comicInkG?: number;
  comicInkB?: number;

  // Datamosh Lite (hero)
  datamoshIntensity?: number;      // 0-1
  datamoshBlockSize?: number;      // 4-32
  datamoshSmear?: number;          // 0-1
  datamoshChannelSplit?: number;   // 0-1
  datamoshChaos?: number;          // 0-1
  datamoshMode?: number;           // 0=horizontal, 1=any, 2=blocks-only

  // Scanline Drift (hero)
  scanDriftIntensity?: number;     // 0-1
  scanDriftFrequency?: number;     // 1-200
  scanDriftSpeed?: number;         // 0-3
  scanDriftWaveform?: number;      // 0=sin, 1=noise, 2=sawtooth
  scanDriftChromaSplit?: number;   // 0-1
  scanDriftChunkiness?: number;    // 0-1

  // Tape Dropout (hero)
  tapeDropoutDensity?: number;     // 0-1
  tapeDropoutLength?: number;      // 0-1
  tapeDropoutColor?: number;       // 0=white, 1=mono, 2=glitch hue
  tapeDropoutSpeed?: number;       // 0-3
  tapeDropoutNoise?: number;       // 0-1
  tapeDropoutMix?: number;         // 0-1

  // Ripple Caustics (hero)
  causticsIntensity?: number;      // 0-2
  causticsScale?: number;          // 1-32
  causticsSpeed?: number;          // 0-3
  causticsRefraction?: number;     // 0-1
  causticsTintR?: number;
  causticsTintG?: number;
  causticsTintB?: number;
  causticsMode?: number;           // 0=overlay, 1=add, 2=screen

  // Shockwave (hero)
  shockTriggerTime?: number;
  shockSpeed?: number;             // 0.1-3
  shockAmplitude?: number;         // 0-0.2
  shockRingWidth?: number;         // 0.01-0.5
  shockCenterX?: number;
  shockCenterY?: number;
  shockChromatic?: number;         // 0-1
  shockMode?: number;              // 0=looping, 1=one-shot

  // Droste Recursive (hero)
  drosteZoom?: number;             // 1.05-3
  drosteRotation?: number;         // 0-360
  drosteIterations?: number;       // 1-12
  drosteOffsetX?: number;
  drosteOffsetY?: number;
  drosteFrameSize?: number;        // 0-0.5
  drosteMix?: number;              // 0-1

  // Slit Scan (hero)
  slitScanIntensity?: number;      // 0-1
  slitScanMode?: number;           // 0=horizontal, 1=vertical, 2=radial, 3=stretch
  slitScanPattern?: number;        // 0=linear, 1=sine, 2=noise
  slitScanSpeed?: number;          // 0-3
  slitScanChromaSplit?: number;    // 0-1

  // Volumetric Fog Overlay (hero)
  fogDensity?: number;             // 0-1
  fogScale?: number;               // 1-32
  fogSpeed?: number;               // 0-2
  fogHeightFalloff?: number;       // -1..1
  fogDepthSim?: number;            // 0-1
  fogColorR?: number;
  fogColorG?: number;
  fogColorB?: number;
  fogTurbulence?: number;          // 0-1
  fogMode?: number;                // 0=add, 1=mix, 2=subtract

  // Rain/Fog/Snow Overlay (hero)
  weatherType?: number;            // 0=rain, 1=snow, 2=mist, 3=embers
  weatherDensity?: number;         // 0-1
  weatherSpeed?: number;           // 0-3
  weatherAngle?: number;           // -45..45
  weatherSize?: number;            // 0.5-3
  weatherFog?: number;             // 0-1
  weatherColorR?: number;
  weatherColorG?: number;
  weatherColorB?: number;

  // Particle Overlay (hero)
  partMode?: number;               // 0=stars, 1=bokeh, 2=sparkles, 3=fireflies, 4=dust
  partDensity?: number;            // 0-1
  partSize?: number;               // 0.5-4
  partSpeed?: number;              // 0-3
  partTwinkle?: number;            // 0-1
  partColorR?: number;
  partColorG?: number;
  partColorB?: number;
  partBlend?: number;              // 0=add, 1=screen

  // Glint Starburst (hero)
  glintIntensity?: number;         // 0-2
  glintThreshold?: number;         // 0-1
  glintLength?: number;            // 0-1
  glintPoints?: number;            // 4-12 (doubled)
  glintRotation?: number;          // 0-360
  glintColorR?: number;
  glintColorG?: number;
  glintColorB?: number;

  // Emboss Relight (hero)
  embRelStrength?: number;         // 0-3
  embRelAngle?: number;            // 0-360
  embRelHeight?: number;           // 0-4
  embRelDetail?: number;           // 0-2
  embRelSpecular?: number;         // 0-1
  embRelColorPreserve?: number;    // 0-1
  embRelAmbient?: number;          // 0-1

  // Dot Matrix (hero)
  dmDotSize?: number;              // 4-32
  dmDotShape?: number;             // 0=circle, 1=square, 2=hex
  dmGap?: number;                  // 0-1
  dmPosterize?: number;            // 1-8
  dmGlow?: number;                 // 0-1
  dmBgR?: number;
  dmBgG?: number;
  dmBgB?: number;

  // Matrix Rain (hero)
  matrixDensity?: number;          // 0-1
  matrixSpeed?: number;            // 0-3
  matrixCellSize?: number;         // 6-32
  matrixTrailLength?: number;      // 0-1
  matrixColorR?: number;
  matrixColorG?: number;
  matrixColorB?: number;
  matrixBgMix?: number;            // 0-1

  // Binary Code (hero)
  binDensity?: number;             // 0-1
  binSpeed?: number;               // 0-3
  binCellSize?: number;            // 6-32
  binColorR?: number;
  binColorG?: number;
  binColorB?: number;
  binBgMix?: number;               // 0-1
  binContrast?: number;            // 0-2

  // Crosshatch (hero)
  hatchDensity?: number;           // 0-1 (lower=fewer lines)
  hatchAngle?: number;             // 0-180
  hatchLineWidth?: number;         // 0.5-4
  hatchContrast?: number;          // 0-2
  hatchPaperR?: number;
  hatchPaperG?: number;
  hatchPaperB?: number;
  hatchInkR?: number;
  hatchInkG?: number;
  hatchInkB?: number;

  // Block Mosaic (hero)
  mosaicTileSize?: number;         // 8-64
  mosaicMode?: number;             // 0=square, 1=voronoi, 2=hex, 3=brick
  mosaicGrout?: number;            // 0-1
  mosaicColorJitter?: number;      // 0-1
  mosaicGroutR?: number;
  mosaicGroutG?: number;
  mosaicGroutB?: number;

  // Tunnel Flight (hero)
  tunnelSpeed?: number;            // 0-3
  tunnelTwist?: number;            // 0-3
  tunnelDepth?: number;            // 0.5-3
  tunnelCenterX?: number;
  tunnelCenterY?: number;
  tunnelMode?: number;             // 0=cylinder, 1=funnel, 2=square
  tunnelChromatic?: number;        // 0-1

  // Infinite Mirror (hero)
  infMirrorIterations?: number;    // 1-12
  infMirrorShrink?: number;        // 0.5-0.95
  infMirrorRotation?: number;      // 0-360
  infMirrorTintFade?: number;      // 0-1
  infMirrorHueShift?: number;      // 0-1
  infMirrorMode?: number;          // 0=center, 1=offset
  infMirrorOffsetX?: number;
  infMirrorOffsetY?: number;

  // Fractal Warp (hero)
  fractalWarpAmount?: number;      // 0-1
  fractalWarpScale?: number;       // 0.5-16
  fractalWarpOctaves?: number;     // 2-6
  fractalWarpSpeed?: number;       // 0-3
  fractalWarpChromatic?: number;   // 0-1
  fractalWarpMode?: number;        // 0=fbm, 1=ridged, 2=hybrid

  // Crystal Refract (hero)
  crystalScale?: number;           // 1-16
  crystalRefraction?: number;      // 0-1
  crystalSparkle?: number;         // 0-1
  crystalEdgeGlow?: number;        // 0-1
  crystalTintR?: number;
  crystalTintG?: number;
  crystalTintB?: number;
  crystalMode?: number;            // 0=voronoi, 1=hex

  // Fluid Distort (hero)
  fluidDistAmount?: number;        // 0-1
  fluidDistScale?: number;         // 1-16
  fluidDistSpeed?: number;         // 0-3
  fluidDistTurbulence?: number;    // 0-1
  fluidDistMode?: number;          // 0=swirl, 1=push, 2=oil

  // Wormhole (hero)
  wormholePullStrength?: number;   // 0-1
  wormholeRotation?: number;       // 0-3
  wormholeCenterX?: number;
  wormholeCenterY?: number;
  wormholeTwist?: number;          // 0-3
  wormholeChromatic?: number;      // 0-1
  wormholeAnimSpeed?: number;      // 0-2

  // Geometric Tile (hero)
  geomTiles?: number;              // 1-16
  geomMode?: number;               // 0=mirror, 1=rotate, 2=tile, 3=quilt
  geomRotation?: number;           // 0-360
  geomOffsetX?: number;            // 0-1
  geomMix?: number;                // 0-1
  // Geometric Tile Pro — premiumPack2 Mode 11 (flip-board)
  geomProTileCount?: number;       // 0-1 → 3..18 tiles
  geomProFlipRange?: number;       // 0-1 → 0..PI flip angle
  geomProSpeed?: number;           // 0-1 → 0..2 flip speed
  geomProGap?: number;             // 0-1 → 0..0.1 gap size

  // Motion Trails (hero)
  motionTrailsLength?: number;     // 0-1
  motionTrailsAngle?: number;      // 0-360
  motionTrailsSamples?: number;    // 4-32
  motionTrailsFalloff?: number;    // 0-1
  motionTrailsChromaSplit?: number;// 0-1
  motionTrailsMode?: number;       // 0=fade, 1=copy

  // Echo Repeat (hero)
  echoCount?: number;              // 1-12
  echoOffsetX?: number;            // -0.5..0.5
  echoOffsetY?: number;
  echoDecay?: number;              // 0.5-0.95
  echoHueShift?: number;           // 0-1
  echoMode?: number;               // 0=add, 1=screen, 2=replace

  // Ghost Double (hero)
  ghostOpacity?: number;           // 0-1
  ghostOffsetX?: number;
  ghostOffsetY?: number;
  ghostMirror?: number;            // 0/1
  ghostTintR?: number;
  ghostTintG?: number;
  ghostTintB?: number;
  ghostBlend?: number;             // 0=screen, 1=add, 2=multiply

  // Strobe Flash (hero)
  strobeRate?: number;             // 0.5-30 Hz
  strobeDuty?: number;             // 0-1
  strobeIntensity?: number;        // 0-2
  strobeMode?: number;             // 0=on/off, 1=invert, 2=tint
  strobeTintR?: number;
  strobeTintG?: number;
  strobeTintB?: number;

  // Light Paint (hero — long-exposure)
  lightPaintIntensity?: number;    // 0-2
  lightPaintThreshold?: number;    // 0-1
  lightPaintTrailLength?: number;  // 0-1
  lightPaintFlowAngle?: number;    // 0-360
  lightPaintFlowScale?: number;    // 1-16
  lightPaintChromaShift?: number;  // 0-1
  lightPaintTintR?: number;
  lightPaintTintG?: number;
  lightPaintTintB?: number;

  // Recursive Echo (hero)
  recEchoDepth?: number;           // 1-12
  recEchoZoom?: number;            // 0.85-1.15
  recEchoRotation?: number;        // 0-360
  recEchoOpacity?: number;         // 0-1
  recEchoHueShift?: number;        // 0-1
  recEchoOffsetX?: number;
  recEchoOffsetY?: number;
  recEchoMode?: number;            // 0=zoom, 1=mirror, 2=spiral

  // ── New Hero Effects (Batch A) ──

  // Optical Flow Datamosh (hero — uses uFeedback)
  ofdmIntensity?: number;          // 0-1
  ofdmMotionScale?: number;        // 0-2
  ofdmPersistence?: number;        // 0-1
  ofdmChromaSplit?: number;        // 0-1
  ofdmBlockSize?: number;          // 4-32
  ofdmFreeze?: number;             // 0-1
  ofdmMode?: number;               // 0=normal, 1=glitch, 2=smooth

  // Flow Field Trails (hero)
  fftFlowScale?: number;           // 0.5-16
  fftTrailLength?: number;         // 0-1
  fftSamples?: number;             // 8-64
  fftSpeed?: number;               // 0-3
  fftChromaSplit?: number;         // 0-1
  fftContrast?: number;            // 0-2
  fftMode?: number;                // 0=advect, 1=streak, 2=tendril
  fftColorCycle?: number;          // 0-1

  // Reaction Diffusion (hero — uses uFeedback)
  rdFeedRate?: number;             // 0-0.1
  rdKillRate?: number;             // 0-0.1
  rdDiffusionA?: number;           // 0.5-1.5
  rdDiffusionB?: number;           // 0.2-1
  rdPatternScale?: number;         // 0.5-4
  rdLumaMask?: number;             // 0-1
  rdMode?: number;                 // 0=spots, 1=stripes, 2=mitosis, 3=coral
  rdColorR?: number;
  rdColorG?: number;
  rdColorB?: number;
  rdMix?: number;
  rdReseed?: number;               // 0-1

  // Neon Tube Trace (hero)
  ntEdgeThreshold?: number;        // 0-1
  ntTubeWidth?: number;            // 0.5-4
  ntGlow?: number;                 // 0-2
  ntGlowRadius?: number;           // 1-12
  ntTintR?: number;
  ntTintG?: number;
  ntTintB?: number;
  ntChase?: number;                // 0-1
  ntChaseSpeed?: number;           // 0-3
  ntFlicker?: number;              // 0-1
  ntBg?: number;                   // 0=black, 1=keep, 2=darkened

  // Depth Parallax (hero)
  dpDepthStrength?: number;        // 0-1
  dpPushIn?: number;               // 0-1
  dpLayers?: number;               // 1-8
  dpChromatic?: number;            // 0-1
  dpDepthBoost?: number;           // 0-2
  dpMode?: number;                 // 0=push, 1=pan, 2=swing
  dpPanX?: number;                 // -1..1
  dpPanY?: number;                 // -1..1

  // Point Cloud Dissolve (hero)
  pcdDissolve?: number;            // 0-1
  pcdDotSize?: number;             // 1-12
  pcdScatterRadius?: number;       // 0-1
  pcdAttract?: number;             // 0-1
  pcdTurbulence?: number;          // 0-1
  pcdMode?: number;                // 0=square, 1=circle, 2=cross
  pcdBgR?: number;
  pcdBgG?: number;
  pcdBgB?: number;
  pcdHueShift?: number;            // 0-1

  // Pixel Sand (hero — uses uFeedback)
  psGravity?: number;              // 0-2
  psTurbulence?: number;           // 0-1
  psThreshold?: number;            // 0-1
  psPersistence?: number;          // 0-1
  psMode?: number;                 // 0=fall, 1=rise, 2=swirl
  psReplenish?: number;            // 0-1
  psChromaSplit?: number;          // 0-1
  psGrainSize?: number;            // 1-6 grain pixel size

  // Liquid Glass (hero)
  lgBlobs?: number;                // 1-8
  lgBlobSize?: number;             // 0.05-0.4
  lgRefraction?: number;           // 0-1
  lgChromatic?: number;            // 0-1
  lgSpecular?: number;             // 0-1
  lgCausticAmount?: number;        // 0-1
  lgSpeed?: number;                // 0-3
  lgTintR?: number;
  lgTintG?: number;
  lgTintB?: number;

  // Hologram Scan (hero)
  hsIntensity?: number;            // 0-1
  hsScanFreq?: number;             // 50-500
  hsScanSpeed?: number;            // 0-3
  hsGridSpacing?: number;          // 4-32
  hsRGBFlicker?: number;           // 0-1
  hsBrokenBands?: number;          // 0-1
  hsTintR?: number;
  hsTintG?: number;
  hsTintB?: number;
  hsOpacityFlicker?: number;       // 0-1
  hsEdgeGlow?: number;             // 0-1

  // Laser Slice (hero — uses uFeedback)
  lsMode?: number;                 // 0=h, 1=v, 2=diag, 3=radial
  lsSpeed?: number;                // 0-3
  lsBeamWidth?: number;            // 0.005-0.1
  lsGlow?: number;                 // 0-2
  lsSparks?: number;               // 0-1
  lsEraseAmount?: number;          // 0-1
  lsTintR?: number;
  lsTintG?: number;
  lsTintB?: number;
  lsReveal?: number;               // 0=erase, 1=reveal
  lsPersistence?: number;          // 0-1

  // ── New Hero Effects (Batch B) ──

  // Aura Field (hero)
  afIntensity?: number;            // 0-2
  afRadius?: number;               // 4-32
  afEdgeAmount?: number;           // 0-1
  afLumaAmount?: number;           // 0-1
  afAudioReact?: number;           // 0-2
  afHueShift?: number;             // 0-1
  afTintR?: number;
  afTintG?: number;
  afTintB?: number;
  afMode?: number;                 // 0=add, 1=screen, 2=replace
  nativeMaskStream?: boolean;      // phone vision native person/object mask
  nativeMaskWidth?: number;
  nativeMaskHeight?: number;
  nativeMaskFormat?: string;

  // Smoke Disintegrate (hero)
  smokeAmount?: number;            // 0-1
  smokeScale?: number;             // 0.5-16
  smokeSpeed?: number;             // 0-3
  smokeDirection?: number;         // 0-360
  smokeEdgeFade?: number;          // 0-1
  smokeColorR?: number;
  smokeColorG?: number;
  smokeColorB?: number;
  smokeMode?: number;              // 0=top-down, 1=center-out, 2=fbm-driven

  // Shimmer Cloth (hero)
  clothAmplitude?: number;         // 0-1
  clothFrequency?: number;         // 1-30
  clothSpeed?: number;             // 0-3
  clothThreadDensity?: number;     // 1-200
  clothThreadDepth?: number;       // 0-1
  clothShimmer?: number;           // 0-2
  clothMode?: number;              // 0=horizontal, 1=plaid, 2=satin

  // Glitch Quilt (hero)
  gqTileSize?: number;             // 8-128
  gqShuffleAmount?: number;        // 0-1
  gqRotateAmount?: number;         // 0-1
  gqDelayAmount?: number;          // 0-1
  gqChromaSplit?: number;          // 0-1
  gqTriggerRate?: number;          // 0-3
  gqMode?: number;                 // 0=quilt, 1=swap, 2=mosh

  // Cellular Automata Burn (hero)
  caCellSize?: number;             // 1-8
  caBirthThreshold?: number;       // 0-1
  caSurvivalLow?: number;          // 0-8
  caSurvivalHigh?: number;         // 0-8
  caColorR?: number;
  caColorG?: number;
  caColorB?: number;
  // NOTE: caMode + caMix were re-declared here as separate cellular-automata
  // params but conflict with the chromatic-aberration block's caMode/caMix
  // (~line 3020). Cellular-automata effect reuses the same underlying keys
  // — runtime code already does, this just dedupes the TS declaration.

  // Rorschach Mirror (hero)
  rmMode?: number;                 // 0=v, 1=h, 2=both, 3=4-fold
  rmInkAmount?: number;            // 0-1
  rmFluidEdges?: number;           // 0-1
  rmTintR?: number;
  rmTintG?: number;
  rmTintB?: number;
  rmBgR?: number;
  rmBgG?: number;
  rmBgB?: number;
  rmMixOriginal?: number;          // 0-1

  // Spectral Prism Tunnel (hero)
  sptTunnelDepth?: number;         // 0.5-3
  sptPrismSpread?: number;         // 0-2
  sptRotation?: number;            // 0-3
  sptSpeed?: number;               // 0-3
  sptSlices?: number;              // 4-32
  sptFade?: number;                // 0-1

  // LED Volume (hero)
  ledVoxelSize?: number;           // 8-32
  ledDepthPulse?: number;          // 0-1
  ledDepthSpeed?: number;          // 0-3
  ledPosterize?: number;           // 1-8
  ledGlow?: number;                // 0-1
  ledPerspective?: number;         // 0-1
  ledMode?: number;                // 0=square, 1=round, 2=hex
  ledBgR?: number;
  ledBgG?: number;
  ledBgB?: number;

  // Poster Tear (hero)
  ptTearAmount?: number;           // 0-1
  ptTearAngle?: number;            // 0-360
  ptTearJitter?: number;           // 0-1
  ptShiftBelow?: number;           // 0-1
  ptOffsetX?: number;              // -0.3..0.3
  ptOffsetY?: number;              // -0.3..0.3
  ptTearGlow?: number;             // 0-1
  ptMode?: number;                 // 0=line, 1=arc, 2=rectangle

  // Paint Peel (hero)
  ppAmount?: number;               // 0-1
  ppScale?: number;                // 1-16
  ppLumaBias?: number;             // 0-1
  ppCurl?: number;                 // 0-1
  ppShadow?: number;               // 0-1
  ppBgR?: number;
  ppBgG?: number;
  ppBgB?: number;
  ppMode?: number;                 // 0=fbm, 1=cellular, 2=cracks

  // ── New Hero Effects (Batch C) ──

  // Audio Shock Bloom (hero — uses uAudio)
  asbIntensity?: number;           // 0-2
  asbBloomThreshold?: number;      // 0-1
  asbBloomRadius?: number;         // 1-30
  asbShockSpeed?: number;          // 0.1-3
  asbShockAmplitude?: number;      // 0-0.2
  asbChromaSplit?: number;         // 0-1
  asbStrobeAmount?: number;        // 0-1
  asbTintR?: number;
  asbTintG?: number;
  asbTintB?: number;
  asbAudioGate?: number;           // 0-1

  // VHS Full Deck (hero)
  vhsFdTracking?: number;          // 0-1
  vhsFdHeadSwitch?: number;        // 0-1
  vhsFdChromaBleed?: number;       // 0-1
  vhsFdDropouts?: number;          // 0-1
  vhsFdTapeNoise?: number;         // 0-1
  vhsFdScanlines?: number;         // 0-1
  vhsFdColorBleed?: number;        // 0-1
  vhsFdSaturation?: number;        // 0-1.5
  vhsFdTrackingJump?: number;      // 0-1
  vhsFdMode?: number;              // 0=clean, 1=worn, 2=destroyed

  // Analog Feedback Rack (hero — uses uFeedback)
  afrMix?: number;                 // 0-1
  afrZoom?: number;                // 0.85-1.15
  afrRotation?: number;            // -0.2..0.2
  afrDecay?: number;               // 0-1
  afrHueShift?: number;            // 0-1
  afrMaskCenter?: number;          // 0-1
  afrChromaSplit?: number;         // 0-1
  afrOffsetX?: number;             // -0.1..0.1
  afrOffsetY?: number;             // -0.1..0.1
  afrMode?: number;                // 0=normal, 1=invert, 2=multiply

  // Club Laser Grid (hero — uses uAudio)
  clgIntensity?: number;           // 0-2
  clgGridDensity?: number;         // 4-32
  clgPerspective?: number;         // 0-1
  clgSpeed?: number;               // 0-3
  clgIntersectionGlow?: number;    // 0-1
  clgLineWidth?: number;           // 0.5-4
  clgTintR?: number;
  clgTintG?: number;
  clgTintB?: number;
  clgAudioReact?: number;          // 0-2
  clgMode?: number;                // 0=floor, 1=ceiling, 2=tunnel

  // Mirror Shards (hero — uses uFeedback)
  msShards?: number;               // 4-32
  msShardSize?: number;            // 0.05-0.5
  msRotation?: number;             // 0-360
  msDelayAmount?: number;          // 0-1
  msChromatic?: number;            // 0-1
  msMode?: number;                 // 0=voronoi, 1=hex, 2=triangular

  // Ghost Exposure (hero — uses uFeedback)
  geExposure?: number;             // 0-1
  geDecay?: number;                // 0-1
  geHueShiftPerFrame?: number;     // 0-0.05
  geIntensity?: number;            // 0-2
  geMode?: number;                 // 0=add, 1=max, 2=screen
  geClamp?: number;                // 0-1

  // Thermal Contour (hero)
  tcPalette?: number;              // 0=ironbow, 1=jet, 2=viridis, 3=inferno
  tcContourCount?: number;         // 1-12
  tcContourWidth?: number;         // 0.001-0.02
  tcContourGlow?: number;          // 0-1
  tcIntensity?: number;            // 0-2
  tcTrackBlobs?: number;           // 0-1
  tcMix?: number;                  // 0-1

  // Dream Diffusion Look (hero)
  ddBloomAmount?: number;          // 0-2
  ddBloomRadius?: number;          // 1-30
  ddHalation?: number;             // 0-1
  ddChromaticBlur?: number;        // 0-1
  ddPastelRolloff?: number;        // 0-1
  ddShadowLift?: number;           // 0-0.5
  ddSoftness?: number;             // 0-1
  ddTintR?: number;
  ddTintG?: number;
  ddTintB?: number;

  // Topo Warp (hero)
  twContourCount?: number;         // 4-32
  twContourWidth?: number;         // 0.001-0.05
  twDisplacement?: number;         // 0-1
  twChromaticEdge?: number;        // 0-1
  twColorR?: number;
  twColorG?: number;
  twColorB?: number;
  twShadowRidges?: number;         // 0-1
  twMix?: number;                  // 0-1

  // Strobe Sequencer (hero)
  ssBPM?: number;                  // 30-240
  ssSteps?: number;                // 4-16
  ssPattern?: number;              // bitmask
  ssMode?: number;                 // 0=on/off, 1=invert, 2=tint, 3=zoom
  ssIntensity?: number;            // 0-2
  ssTintR?: number;
  ssTintG?: number;
  ssTintB?: number;
  ssSwing?: number;                // 0-0.5

  // Terrain 3D (hero — added fade/source-mix)
  terrainMode?: number;            // 0=opaque, 1=fade horizon, 2=blend source
  terrainHeight?: number;          // 0-1
  terrainCamHeight?: number;       // 0-1
  terrainSpeed?: number;           // 0-1
  terrainFog?: number;             // 0-1
  terrainYaw?: number;             // radians
  terrainPitch?: number;           // 0-1
  terrainRoll?: number;            // 0-1
  terrainFogR?: number;
  terrainFogG?: number;
  terrainFogB?: number;
  terrainHorizonFade?: number;     // 0-1
  terrainSourceMix?: number;       // 0-1

  // Wrapped Terrain (sphere/cube/pyramid extrude)
  wtShape?: number;                // 0=sphere, 1=cube, 2=pyramid
  wtHeight?: number;               // 0-1 extrusion
  wtRotateX?: number;              // 0-1
  wtRotateY?: number;              // 0-1
  wtAutoRotate?: number;           // 0-2
  wtCamDistance?: number;          // 1-5
  wtSpecular?: number;             // 0-1
  wtAmbient?: number;              // 0-1
  wtFogDistance?: number;          // 0-1
  wtFogR?: number;
  wtFogG?: number;
  wtFogB?: number;
  wtHorizonFade?: number;          // 0-1
  wtSourceMix?: number;            // 0-1
  wtTileScale?: number;            // 0.5-4

  // ── Geometric 3D effects ──
  // (every effect ships with audio hooks: soAudioBass / soAudioHigh / soAudioBeatPulse,
  //  but these read from a shared uniform set — params below cover the visual params.)

  // 1. String Orb
  soRadius?: number;
  soHeight?: number;
  soLatCount?: number;
  soLonCount?: number;
  soDiagCount?: number;
  soSlope?: number;
  soWidth?: number;
  soSpin?: number;
  soTilt?: number;
  soFlow?: number;
  soIntensity?: number;
  soGlow?: number;
  soGlowR?: number;
  soGlowG?: number;
  soGlowB?: number;
  soHorizonFade?: number;
  soTileScale?: number;

  // 2. Sphere Wireframe
  swRadius?: number;
  swHeight?: number;
  swMeridians?: number;
  swParallels?: number;
  swWidth?: number;
  swSpin?: number;
  swTilt?: number;
  swIntensity?: number;
  swHaloGlow?: number;
  swColorR?: number;
  swColorG?: number;
  swColorB?: number;
  swHorizonFade?: number;
  swFillSource?: number;
  swTileScale?: number;

  // 3. Voxel Cube Cluster
  vccGridSize?: number;
  vccCubeSize?: number;
  vccSpacing?: number;
  vccHeight?: number;
  vccSpin?: number;
  vccTilt?: number;
  vccCamDistance?: number;
  vccSpecular?: number;
  vccAmbient?: number;
  vccHorizonFade?: number;
  vccBgR?: number;
  vccBgG?: number;
  vccBgB?: number;

  // 4. Mobius Lattice
  mlMajorR?: number;
  mlRibbonW?: number;
  mlTwists?: number;
  mlSpin?: number;
  mlTilt?: number;
  mlLineDensity?: number;
  mlLineWidth?: number;
  mlIntensity?: number;
  mlLineR?: number;
  mlLineG?: number;
  mlLineB?: number;
  mlHorizonFade?: number;

  // 5. Crystal Shard Field
  csfShardCount?: number;
  csfShardSize?: number;
  csfSpread?: number;
  csfChromaEdge?: number;
  csfRefraction?: number;
  csfSpin?: number;
  csfIntensity?: number;
  csfTintR?: number;
  csfTintG?: number;
  csfTintB?: number;
  csfHorizonFade?: number;

  // 6. Tube Lattice
  tlTubeCount?: number;
  tlTubeRadius?: number;
  tlSpread?: number;
  tlSpin?: number;
  tlTilt?: number;
  tlTwist?: number;
  tlIntensity?: number;
  tlRimR?: number;
  tlRimG?: number;
  tlRimB?: number;
  tlHorizonFade?: number;

  // 7. Disco Mirror Ball
  dmbRadius?: number;
  dmbFacetCount?: number;
  dmbSpin?: number;
  dmbTilt?: number;
  dmbChaseSpeed?: number;
  dmbChaseHueWidth?: number;
  dmbSparkle?: number;
  dmbIntensity?: number;
  dmbHighlightR?: number;
  dmbHighlightG?: number;
  dmbHighlightB?: number;
  dmbHorizonFade?: number;

  // 8. Lissajous Knot
  lkRatioX?: number;
  lkRatioY?: number;
  lkRatioZ?: number;
  lkPhaseX?: number;
  lkPhaseY?: number;
  lkTubeRadius?: number;
  lkScale?: number;
  lkSpin?: number;
  lkTilt?: number;
  lkIntensity?: number;
  lkTubeR?: number;
  lkTubeG?: number;
  lkTubeB?: number;
  lkHorizonFade?: number;

  // 9. Helix Particle Stream
  hpsHelices?: number;
  hpsHelixRadius?: number;
  hpsTurns?: number;
  hpsHeight?: number;
  hpsTubeRadius?: number;
  hpsRiseSpeed?: number;
  hpsSpin?: number;
  hpsTilt?: number;
  hpsIntensity?: number;
  hpsTintR?: number;
  hpsTintG?: number;
  hpsTintB?: number;
  hpsHorizonFade?: number;

  // 10. Donut Constellation
  dcMajorR?: number;
  dcMinorR?: number;
  dcStarCount?: number;
  dcStarSize?: number;
  dcSpin?: number;
  dcTilt?: number;
  dcTintIntensity?: number;
  dcTorusR?: number;
  dcTorusG?: number;
  dcTorusB?: number;
  dcStarR?: number;
  dcStarG?: number;
  dcStarB?: number;
  dcHorizonFade?: number;

  // Brightness/Contrast/Saturation/Hue (VJ mode simple effects)
  radius?: number;                // Generic radius param (blur in VJ)
  amount?: number;                // Generic amount param (brightness/contrast/saturation)
  shift?: number;                 // Hue shift degrees
  size?: number;                  // Generic size (pixelate in VJ)
  segments?: number;              // Kaleidoscope segments (VJ)
  intensity?: number;             // Generic intensity (glitch in VJ)
  hueShift?: number;              // Colorama hue shift

  // VJ mode specific effect amounts
  brightnessAmount?: number;      // -1 to 1
  contrastAmount?: number;        // -1 to 1
  saturationAmount?: number;      // -1 to 1
  invertAmount?: number;          // 0-1 partial invert (1=full)
  invertMode?: number;            // 0=RGB,1=luma,2=hue,3=strobe,4=threshold-above
  invertThreshold?: number;       // 0-1 threshold for mode 4
  invertStrobeRate?: number;      // 0-10 Hz strobe rate for mode 3

  // Plasma additional
  // NOTE: plasmaMix already declared in the Plasma block (~line 2781);
  // this duplicate has been removed.

  // Edge detection additional
  edgeStrength?: number;          // 0-2 edge detection strength

  // Outline additional
  outlineThreshold?: number;      // 0-1 outline threshold

  // Noise additional
  noiseAnimated?: number;         // 0=static, 1=animated

  // Kaleidoscope additional
  kaleidoscopeRotation?: number;  // 0-360 rotation

  // Mirror additional
  mirrorHorizontal?: number;      // 0 or 1
  mirrorVertical?: number;        // 0 or 1

  // Pro effect generic controls
  amount2?: number;               // Secondary amount parameter
  amount3?: number;               // Tertiary amount parameter
  threshold?: number;             // Generic threshold parameter
  angle?: number;                 // Generic angle parameter
  centerX?: number;               // Generic center X
  centerY?: number;               // Generic center Y
  red?: number;
  green?: number;
  blue?: number;
  softness?: number;

  // Bloom hero rewrite — dedicated multi-octave bloom shader
  bloomIntensity?: number;
  bloomKnee?: number;
  bloomRadius?: number;
  bloomAnamorphic?: number;

  // Feedback Zoom hero rewrite — real previous-frame buffer
  feedbackZoom?: number;
  feedbackRotation?: number;
  feedbackDecay?: number;
  feedbackHueShift?: number;
  feedbackMaskCenter?: number;

  // Blob Tracking params
  blobThreshold?: number;         // 0-1 luminance threshold for blob detection
  blobShape?: number;             // 0=circle, 1=square, 2=triangle, 3=diamond, 4=crosshair
  blobColor?: number;             // 0-7 color preset (0=green, 1=cyan, 2=magenta, 3=amber, 4=red, 5=blue, 6=white, 7=auto)
  blobThickness?: number;         // 0.5-5 outline/marker thickness
  blobMinSize?: number;           // 0-0.5 minimum blob size (fraction of screen)
  blobMaxBlobs?: number;          // 1-64 max number of tracked blobs
  blobShowCoords?: number;        // 0=off, 1=on - show coordinate readout text
  blobShowBBox?: number;          // 0=off, 1=on - show bounding boxes
  blobShowCenter?: number;        // 0=off, 1=on - show center markers
  blobTrailLength?: number;       // 0-1 motion trail persistence
  blobGridSize?: number;          // 4-64 analysis grid resolution
  blobMix?: number;               // 0-1 blend with original image
  blobColorMode?: number;         // 0=auto (getTrackColor), 1=fixed (user color), 2=spectrum (rainbow from brightness)
  blobFixedColorR?: number;       // 0-1 red component for fixed color mode
  blobFixedColorG?: number;       // 0-1 green component for fixed color mode
  blobFixedColorB?: number;       // 0-1 blue component for fixed color mode
  blobMarkerSize?: number;        // 0.2-3, marker size multiplier (default 1)
  blobBlendMode?: number;         // 0=Add 1=Screen 2=Multiply 3=Overlay 4=Replace

  // Time-based effects (timeSmear, chronophoto)
  mode?: number;                  // 0-N, effect-specific variant selector
  speed?: number;                 // 0-2, temporal sample rate / delay feedback
}

/**
 * Per-param auto playhead config. Lives directly on the thing being
 * automated (effect, shader source) — NOT in a separate modulation
 * map keyed by layer index. That earlier architecture broke whenever
 * layers were reordered or when the same param needed automation in
 * VJ + mapping simultaneously, because the routing decided per-frame
 * which target to write to and dropped entries on collision.
 *
 * The new rule: if it's in the data, it animates. The autoEngine
 * walks every layer and writes resolved values into the underlying
 * `effect.params[paramName]` / `source.shaderValues[paramName]`
 * directly. Save/load survives because it's on the layer. Mode
 * switches survive for the same reason. Per-clip in VJ survives
 * because clip auto state lives on the clip.
 *
 * `phase` is intentionally persisted alongside the config so
 * pause/resume continues from where the user paused — but the
 * runtime mutates it in place via the store action without doing
 * a full Svelte rerender per tick (see autoEngine).
 */
export interface AutoConfig {
  /** Internal sweep counter, 0..1. Advanced by `speedHz × dt` per frame
   *  when `playing` is true. */
  phase: number;
  /** loop = saw (0→1, wrap), pingpong = triangle (0→1→0). */
  mode: 'loop' | 'pingpong';
  /** Cycles per second. */
  speedHz: number;
  /** Lower sweep bound in the param's natural units (absolute, not fraction). */
  min: number;
  /** Upper sweep bound in the param's natural units (absolute). */
  max: number;
  /** Play/pause. When false the playhead doesn't advance and the
   *  param sits at the last published value. */
  playing: boolean;
}

export const DEFAULT_AUTO: AutoConfig = {
  phase: 0,
  mode: 'loop',
  speedHz: 0.15,  // ~6.7s full cycle, calm VJ pacing
  min: 0,
  max: 1,
  playing: true,
};

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: EffectParams;
  opacity?: number;       // 0-1, default 1 (fully opaque effect)
  blendMode?: BlendMode;  // How this effect composites onto the source, default 'normal'
  /** Per-param Auto playhead state. Keyed by the same param names
   *  as `params`. Persists across saves and rides with the effect
   *  through every render path. */
  paramAuto?: Record<string, AutoConfig>;
}

// Stage Preset - A saved mapping layout with VJ layer assignments for Stage Mode
export interface StagePreset {
  id: string;
  name: string;
  thumbnail?: string;
  createdAt: number;
  layers: Layer[];  // Deep clone of mapping layers with vjLayerIndex assignments
  scope?: 'project' | 'global';  // Two-tier: 'project' saved in .ghost-arcade, 'global' in localStorage
  /** Surface whose slices and Stage FX own this preset. Added in 1.9.98;
   *  older presets recover the relationship from slice-to-layer bindings. */
  surfaceId?: string;
  /** Complete Stage Designer surface at save time. Presets must restore
   *  slice geometry, source bindings, and Stage FX together; otherwise
   *  every preset silently shares whichever surface was edited last. */
  surfaceSnapshot?: Surface;
  /** Stage Effects bundle — captured at save time so re-triggering
   *  the preset re-instates the entire animation setup (catalog of
   *  effects + which one is currently live + automation play state
   *  and interval). Optional so old presets load cleanly with no
   *  effects snapshot. */
  stageEffects?: {
    effects: StageEffect[];
    activeEffectId: string | null;
    automation: SurfaceEffectAutomation | null;
  };
  /** Full 3D Ghost Stage snapshot — venue, lighting, scenery overrides,
   *  user-placed elements, per-screen 3D tweaks. Captured at save time
   *  so loading the preset rebuilds the matching 3D view alongside the
   *  2D mapping layout. Stored as an opaque JSON blob to avoid pulling
   *  Stage3DScene into every consumer of StagePreset. */
  stage3d?: unknown;
}

// SynthVision Keyboard Clip Assignment
export interface SVClipAssignment {
  type: 'shader' | 'media';
  /** Performer keyboard cells belong to the deck that was selected when
   *  they were assigned. Older presets omit this and intentionally load
   *  on Deck A. */
  performerDeck?: 'A' | 'B';
  // Shader fields
  shaderId?: string;
  shaderName?: string;
  shaderSrc?: string;
  shaderThumbnail?: string;
  shaderCode?: string;
  manifestDefaults?: Record<string, any>;
  // Media fields
  mediaId?: string;
  mediaName?: string;
  mediaSrc?: string;
  mediaType?: 'video' | 'image';
  /** Snapshot frame used as the key's preview image. For images this is
   *  usually omitted (the CSS background-image: url(mediaSrc) renders
   *  fine on its own), but videos can't be sampled by CSS — we capture
   *  the first decoded frame to a data URL at drop time and store it
   *  here so the key shows a still preview instead of an empty tile. */
  mediaThumbnail?: string;
  /** Durable file identity for the assigned media. `mediaSrc` is a runtime
   *  URL (usually a blob:) that dies with the session, so without this a
   *  performer key came back silent after a restart. */
  _assetRef?: import('./storage/assetRegistry').AssetRef;
}

// SynthVision Keyboard Preset - Saved keyboard layout with clip assignments
export interface SVKeyboardPreset {
  id: string;
  name: string;
  assignments: Record<number, SVClipAssignment>;
  createdAt: number;
  scope?: 'project' | 'global';  // Two-tier: 'project' saved in .ghost-arcade, 'global' in localStorage
}

// Composition/Preset - A saved snapshot of all layer states
export interface Composition {
  id: string;
  name: string;
  thumbnail?: string; // Base64 thumbnail preview
  createdAt: number;  // Timestamp
  layers: Layer[];    // Deep copy of all layers at save time
  synthVision?: any;  // Performer state snapshot (optional for backwards compat)
  // Transport snapshots: if either was actively playing at save time,
  // load resets that sub-store's playhead and auto-starts it. Both
  // optional so older presets (which lack these fields) load with the
  // current sub-store state untouched.
  sequencer?: {
    snapshot: any;        // output of layerSequencer.serialize()
    wasPlaying: boolean;  // sub-store's isPlaying flag at save time
  };
  keyframes?: {
    snapshot: any;        // output of keyframeTimeline.exportAll()
    wasPlaying: boolean;  // config.isPlaying at save time
  };
}

// VJ Deck - A slot that can hold a composition for live mixing
export interface VJDeck {
  id: string;
  name?: string;                  // Deck display name
  compositionId: string | null;   // Which composition is loaded
  opacity: number;                // 0-1
  blendMode: BlendMode;
  isActive: boolean;              // Whether this deck is currently playing
  volume?: number;                // 0-1 audio volume
  playbackSpeed?: number;         // Playback rate multiplier
  isPlaying?: boolean;            // Whether the deck is playing
  transitionType?: string;        // Transition type for mixing
  transitionDuration?: number;    // Duration of transition in seconds
}

// Timeline clip - A composition in the timeline with duration
export interface TimelineClip {
  id: string;
  compositionId: string;
  startTime: number;     // Start time in seconds
  duration: number;      // Duration in seconds
  transitionIn?: 'cut' | 'fade' | 'crossfade';   // Transition type
  transitionDuration?: number; // Duration of transition in seconds
}

// Timeline configuration
export interface Timeline {
  clips: TimelineClip[];
  loop: boolean;          // Loop the entire timeline
  totalDuration: number;  // Calculated total duration
  isPlaying: boolean;
  currentTime: number;    // Current playback position in seconds
}

// ═══════════════════════════════════════════════════
// Layer Sequencer Types
// ═══════════════════════════════════════════════════

export type SequencerPresetMode = 'snake' | 'everyOther' | 'random' | 'custom';
export type SequencerTimingMode = 'beat' | 'fixed';
export type SequencerSubdivision = 1 | 2 | 4; // quarter, eighth, sixteenth

export interface SequencerStep {
  /** Map of layerId -> active (true = visible, false = hidden). Missing keys = hidden. */
  activeLayers: Record<string, boolean>;
}

export interface SequencerPattern {
  steps: SequencerStep[];
  stepCount: number;
  /** Per-layer "continuous" flag. When set for a layer, the sequencer's
   *  active/inactive cell only gates that layer's final composite alpha —
   *  the layer is still rendered every frame so its shader uniforms,
   *  keyframe-driven parameters, and time-dependent effects keep advancing
   *  even while the cell is "off." Missing keys / false = legacy behavior
   *  (layer hides on inactive cells and may visually restart on the next
   *  on-step). Optional so old saved patterns deserialize cleanly. */
  continuousLayers?: Record<string, boolean>;
}

export interface SequencerConfig {
  timingMode: SequencerTimingMode;
  bpm: number;                     // used in beat mode
  subdivision: SequencerSubdivision; // 1=quarter, 2=eighth, 4=sixteenth
  fixedStepDuration: number;       // seconds, used in fixed mode
  crossfadeEnabled: boolean;
  crossfadeDuration: number;       // seconds (0.1 to 2.0)
  loop: boolean;
  presetMode: SequencerPresetMode;
  randomDensity: number;           // 0-1, for random mode
}

// ═══════════════════════════════════════════════════
// Keyframe Timeline Types
// ═══════════════════════════════════════════════════

export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step';

export interface Keyframe {
  time: number;            // seconds from timeline start
  value: number;           // parameter value at this time
  easing: KeyframeEasing;  // interpolation curve TO the next keyframe
}

export interface BoolKeyframe {
  time: number;
  value: boolean;
}

export interface KeyframeTrack {
  key: string;             // e.g. "shader:speed", "fx:abc123:enabled"
  label: string;           // display name for UI
  type: 'number' | 'boolean';
  keyframes: Keyframe[];           // sorted by time (for number tracks)
  boolKeyframes: BoolKeyframe[];   // sorted by time (for boolean tracks)
}

export interface LayerKeyframeTimeline {
  layerId: string;
  tracks: KeyframeTrack[];
}

export interface KeyframeTimelineConfig {
  duration: number;        // total timeline length in seconds (default 30)
  isPlaying: boolean;
  isLooping: boolean;
  currentTime: number;     // playhead position in seconds
  zoom: number;            // pixels per second for timeline ruler
  scrollLeft: number;      // horizontal scroll offset in pixels
}

// VJ Mode state
export interface VJModeState {
  enabled: boolean;
  compositions: Composition[];
  decks: VJDeck[];           // Multiple decks for mixing
  timeline: Timeline;
  activeCompositionId: string | null;  // Currently active/previewing composition
  masterOpacity: number;     // Master output opacity
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: Layer[];
  selectedLayerId: string | null;
  /** Mapping-mode composition controls. When enabled, the whole mapping
   *  layer stack can receive post-composite effects and stage-style
   *  layer-list animation without entering VJ mode. */
  mappingComposition?: MappingCompositionState;
  // VJ Mode data (optional - null when not used)
  vjMode: VJModeState | null;
  // Media tray organization folders (project-scoped)
  mediaFolders?: MediaTrayFolder[];
  // Saved compositions (shortcut access)
  compositions?: Composition[];
  // Stage Mode presets (mapping layouts with VJ layer assignments)
  stagePresets?: StagePreset[];
  /** Active Ghost Stage 3D scene saved with the project file. This is
   *  explicit file persistence only; scratch scene edits are no longer
   *  auto-restored from localStorage on app launch. */
  stage3d?: unknown;
  // SynthVision keyboard presets (performer mode keyboard assignments)
  svKeyboardPresets?: SVKeyboardPreset[];
  // Stage Designer surfaces: SVG-imported polygon slice layouts.
  // Distinct from `stagePresets` (which is a saved mapping-layer
  // layout for VJ-style use); a Surface is the projection geometry
  // itself — polygons the user pins to physical projection surfaces
  // and routes content into. Optional + defaults to empty so legacy
  // projects load unchanged.
  surfaces?: Surface[];
  activeSurfaceId?: string | null;
  // WLED LED-controller integration. Each entry describes one
  // controller on the local network that the engine pushes pixel
  // data to via UDP (DRGB protocol). Per-frame the renderer reads
  // a tiny spatial tap texture sized to ledCount pixels, packs it, and
  // sends through the main process. Optional + defaults to empty
  // so legacy projects load unchanged.
  wledControllers?: WLEDController[];
  /** Cross-controller fixture groups used by LED performance effects. */
  wledGroups?: WLEDGroup[];
  /** Project-scoped LED performance effects shown in VJ mode. */
  wledEffects?: WLEDEffect[];
  wledEffectAutomation?: WLEDEffectAutomation;
  /** Multi-output slices — saved with the project so a recalled
   *  show restores the operator's full projector / display layout
   *  (master canvas resolution, every slice's crop, blend, color
   *  correction, and target). The runtime mirrors this into
   *  $settings.output for the per-frame slice extractor. Plain
   *  data — no runtime refs. Optional + defaults to empty so
   *  legacy projects load unchanged. */
  outputSlices?: OutputSliceShape[];
  outputMasterCanvasWidth?: number;
  outputMasterCanvasHeight?: number;
  /** Global master warp — single output-side warp on the whole master
   *  canvas. Mirrors OutputWarp from settings.ts (kept structural here
   *  so types.ts doesn't import the settings module). */
  outputMasterWarp?: {
    enabled: boolean;
    mode: 'corners' | 'mesh';
    corners?: WarpCorners;
    meshGrid?: MeshWarpGrid;
  };
}

/** Mirror of the OutputSlice shape from src/lib/stores/settings.ts.
 *  Duplicated here so types.ts doesn't pull settings into its import
 *  graph (settings depends on lots of UI stuff). The migrate function
 *  in settings.ts is the single source of truth for defaults. */
export interface OutputSliceShape {
  id: string;
  name: string;
  enabled: boolean;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  targetType?: 'sender' | 'display';
  displayId?: number | null;
  outputType?: 'spout' | 'syphon' | 'ndi';
  spoutName: string;
  edgeBlendLeft: number;
  edgeBlendRight: number;
  edgeBlendTop: number;
  edgeBlendBottom: number;
  edgeBlendGamma: number;
  edgeBlendLeftGamma?: number;
  edgeBlendRightGamma?: number;
  edgeBlendTopGamma?: number;
  edgeBlendBottomGamma?: number;
  blackLevelR?: number;
  blackLevelG?: number;
  blackLevelB?: number;
  blackLevelFeather?: number;
  brightness: number;
  gamma: number;
  contrast: number;
  rotation: 0 | 90 | 180 | 270;
}

/** A single WLED controller on the local network. Stored on the
 *  Project so the same lighting rig follows a saved show. The
 *  renderer subscribes to this list and runs one UDP sender per
 *  enabled controller. */
export type WLEDMappingMode = 'auto-grid' | 'strip' | 'matrix' | 'custom';
export type WLEDScanAxis = 'horizontal' | 'vertical';
export type WLEDTestPattern = 'off' | 'solid' | 'rainbow' | 'chase';
export type WLEDColorSamplingMode = 'exact' | 'average' | 'dominant' | 'highlight' | 'palette' | 'luma-hue';
export type WLEDEffectBlendMode = 'replace' | 'add' | 'multiply' | 'gate' | 'colorize';
export type WLEDColorSource = 'shader' | 'palette' | 'custom' | 'rainbow';
export type WLEDSpeedMode = 'manual' | 'bpm';
export type WLEDPatternCategory = 'color' | 'movement' | 'organic' | 'rhythmic' | 'spatial' | 'content' | 'glitch';
export type WLEDPatternId =
  | 'solid-color'
  | 'chase'
  | 'comet'
  | 'scanner'
  | 'dual-chase'
  | 'bounce'
  | 'orbit'
  | 'marquee'
  | 'theater-chase'
  | 'firefly'
  | 'twinkle'
  | 'embers'
  | 'fire'
  | 'lightning'
  | 'rain'
  | 'ripple'
  | 'aurora'
  | 'breathing'
  | 'plasma'
  | 'beat-pulse'
  | 'strobe'
  | 'random-blink'
  | 'bass-hits'
  | 'hi-hat-sparkle'
  | 'bar-sweep'
  | 'euclidean-pulse'
  | 'wave'
  | 'sine-wave'
  | 'radial-wave'
  | 'center-out'
  | 'edge-in'
  | 'wipe'
  | 'gradient-drift'
  | 'pinwheel'
  | 'snake'
  | 'shader-color-chase'
  | 'highlight-runner'
  | 'palette-sparkle'
  | 'luma-gate'
  | 'saturation-pop'
  | 'pixel-echo'
  | 'content-freeze-chase'
  | 'packet-drop'
  | 'scan-tear'
  | 'noise-blocks'
  | 'random-blackout'
  | 'rgb-split'
  | 'signal-burst';

export interface WLEDRange {
  id: string;
  name: string;
  /** Zero-based physical LED index on the controller. */
  start: number;
  /** Number of consecutive physical LEDs in this fixture. */
  count: number;
}

export interface WLEDGroupMember {
  controllerId: string;
  /** Omit to target the controller's entire LED span. */
  rangeId?: string;
}

export interface WLEDGroup {
  id: string;
  name: string;
  members: WLEDGroupMember[];
}

export interface WLEDEffectTarget {
  mode: 'all' | 'controller' | 'range' | 'group';
  controllerId?: string;
  rangeId?: string;
  groupId?: string;
}

export interface WLEDEffect {
  id: string;
  name: string;
  pattern: WLEDPatternId;
  /** Included in the automatic sequence. */
  enabled: boolean;
  /** Manually latched on. Multiple effects may stack. */
  active: boolean;
  amount: number;
  speed: number;
  speedMode: WLEDSpeedMode;
  /** Pattern cycles per beat when BPM sync is active. */
  beatDivision: number;
  blendMode: WLEDEffectBlendMode;
  colorSource: WLEDColorSource;
  color: string;
  secondaryColor: string;
  tertiaryColor?: string;
  quaternaryColor?: string;
  target: WLEDEffectTarget;
  /** Pattern-specific normalized controls such as width, density and tail. */
  params: Record<string, number>;
  seed: number;
}

export interface WLEDEffectAutomation {
  playing: boolean;
  mode: 'beat' | 'time';
  beats: number;
  seconds: number;
  order: 'forward' | 'random' | 'pingpong';
}

export interface WLEDNormalizedPoint {
  /** Horizontal coordinate inside the selected source region. */
  x: number;
  /** Vertical coordinate inside the selected source region. */
  y: number;
}

export interface WLEDSourceRegion {
  /** Normalized left edge in the final composite. */
  x: number;
  /** Normalized top edge in the final composite. */
  y: number;
  /** Normalized width in the final composite. */
  width: number;
  /** Normalized height in the final composite. */
  height: number;
}

export interface WLEDMappingConfig {
  mode: WLEDMappingMode;
  /** Wiring traversal for strips and matrices. */
  axis?: WLEDScanAxis;
  /** Matrix width. Rows are derived from ledCount. */
  columns?: number;
  /** Reverse every other row/column to match serpentine wiring. */
  serpentine?: boolean;
  /** Reverse the final LED index order. */
  reverse?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  /** Crop the final composite before LED coordinates are resolved. */
  sourceRegion?: WLEDSourceRegion;
  /** Ordered LED positions, relative to sourceRegion, in custom mode. */
  points?: WLEDNormalizedPoint[];
  /** Spatial averaging radius, normalized to the sampled frame. */
  sampleRadius?: number;
}

export interface WLEDColorCalibration {
  redGain?: number;
  greenGain?: number;
  blueGain?: number;
  saturation?: number;
  /** Values below this normalized luminance are treated as black. */
  blackThreshold?: number;
  /** Temporal smoothing amount. 0 is immediate; 0.95 is very smooth. */
  smoothing?: number;
  /** Row-major 3x3 linear-light color correction matrix. */
  colorMatrix?: number[];
}

export interface WLEDController {
  id: string;
  /** Display name for the UI ("stage left strip", "back wall matrix"). */
  name: string;
  /** IPv4 address of the WLED controller, e.g. "192.168.1.42". */
  ipAddr: string;
  /** UDP port. WLED's realtime port is 21324 by default. */
  port: number;
  /** Number of LEDs on the strip / matrix. 1..490 fits in one DRGB
   *  packet; v1 caps at 490 (DNRGB for larger comes later). */
  ledCount: number;
  /** Master enable. When false the controller stops receiving
   *  packets — WLED falls back to whatever local effect it had
   *  configured before. */
  enabled: boolean;
  /** Brightness multiplier 0..1 applied to RGB before send. Lets
   *  the user dial down a too-bright strip without touching the
   *  WLED side. */
  brightness?: number;
  /** Gamma correction 0.5..3.0 (default 1, no correction). LEDs
   *  often need ~2.2 to look right because the eye perceives
   *  brightness non-linearly. */
  gamma?: number;
  /** Spatial mapping from the final composite into physical LED order. */
  mapping?: WLEDMappingConfig;
  /** Per-controller color matching and temporal response. */
  calibration?: WLEDColorCalibration;
  /** How local source pixels are reduced to one LED color. */
  samplingMode?: WLEDColorSamplingMode;
  /** Named physical spans for controllers driving more than one strip. */
  ranges?: WLEDRange[];
  /** Setup-only pattern used to identify wiring and LED order. */
  testPattern?: WLEDTestPattern;
  /** Hex color used by the solid setup pattern. */
  testColor?: string;
}

// ═══════════════════════════════════════════════════
// Stage Designer types
// ═══════════════════════════════════════════════════
// A Surface is the projection geometry the user designs in the Stage
// Designer workspace — an SVG-imported (or hand-drawn) set of named
// polygon slices that map onto physical projection surfaces. Each
// slice routes content from one source: a project Layer, a VJ clip,
// or a procedural Stage Effect (Phase 4).
//
// Naming note: `StagePreset` is a pre-existing concept (saved mapping-
// layer layout) and is intentionally unrelated. "Surface" matches the
// projection-mapping industry vocabulary (Resolume, MadMapper, HeavyM
// all call these surfaces).

export interface Surface {
  id: string;
  name: string;
  /** Logical canvas size — slice polygon coordinates are in this space. */
  width: number;
  height: number;
  slices: SurfaceSlice[];
  /** Optional reference SVG shown faintly behind the slices in the
   *  designer canvas — used for tracing / alignment. Slices are
   *  generated FROM this SVG on import but stored independently so the
   *  user can edit them afterward. */
  background?: { svgRef?: string; color?: string };
  /** Stage Effects catalog — procedural pixel-map sources the user
   *  has configured for this surface. Each effect emits a brightness
   *  value per slice each frame. They live on the surface as
   *  configurations; only the one referenced by `activeEffectId` is
   *  actually running at any given moment (stacking multiple effects
   *  produced confusing multiplicative results, so we switched to a
   *  radio-button "pick one to go live" model). */
  effects?: StageEffect[];
  /** Which effect (or 'still') is currently live. `null` / `'still'`
   *  = no effect running, slices render at their natural layer
   *  opacity. Any other value is an effect.id from effects[]. */
  activeEffectId?: string | null;
  /** Optional auto-cycle automation. When `playing` is true, an
   *  internal scheduler advances `activeEffectId` through the
   *  surface's effects[] (and optionally through the 'still' slot)
   *  at the configured interval. */
  effectAutomation?: SurfaceEffectAutomation;
}

export interface SurfaceEffectAutomation {
  playing: boolean;
  /** 'time' = fixed seconds-per-step, 'beat' = BPM-synced where one
   *  step lasts `beats` audio beats (uses audioStore.bpm). */
  mode: 'time' | 'beat';
  seconds: number;    // used when mode='time'
  beats: number;      // used when mode='beat'
}

export interface MappingCompositionState {
  enabled: boolean;
  effects: Effect[];
  stageEffects: StageEffect[];
  activeStageEffectId: string | null;
  stageEffectAutomation: SurfaceEffectAutomation;
}

// ── Stage Effects ────────────────────────────────────────
// Resolume-style "stage-pixel" effects — procedural generators that
// drive per-slice brightness in waves / pulses / sweeps so the whole
// stage reacts together. Each slice's centroid samples the effect's
// virtual output at that location; the resulting brightness becomes
// an opacity multiplier on the slice's bound mapping layer.

export type StageEffectType =
  | 'still'                 // no effect — slices render at their natural opacity; useful as a "rest beat" in auto-cycles
  | 'radial-pulse'          // expanding ring from configurable origin
  | 'linear-sweep'          // bar of light sweeping across the surface
  | 'noise-flicker'         // pseudo-random per-slice brightness (Perlin-ish)
  | 'audio-rms-intensity'   // solid brightness driven by audio RMS
  | 'chase'                 // one slice at a time lights, cycles through in order
  | 'strobe'                // all slices flash at a configurable rate (synced)
  | 'twinkle'               // each slice independently fades in/out at random
  | 'sine-wave'             // per-slice sine oscillation with positional phase
  | 'beat-pulse'            // pulse on audio onset (kick / snare flash)
  | 'spiral'                // pulse rotating around centroid with angular sweep
  | 'cascade'               // vertical drop wave with delay between rows
  | 'random-hits'           // per-slice random one-shot strobes
  | 'breathing'             // smooth global pulse (lub-dub heartbeat option)
  | 'checker'               // alternating on/off based on slice index parity
  | 'inverse-pulse'         // ring contracting from edge inward to origin
  | 'split-flash';          // top/bottom or left/right halves alternate

export interface StageEffect {
  id: string;
  type: StageEffectType;
  /** Now means "include in the automation cycle." The actual live-or-not
   *  state is on Surface.activeEffectId — only one effect runs at a time
   *  (multiple stacking was confusing). When effectAutomation.playing,
   *  the scheduler steps through enabled=true effects in order. */
  enabled: boolean;
  /** 0..1 wet/dry — at 0 the effect contributes nothing (slice gets
   *  brightness 1 from this effect's perspective), at 1 full effect. */
  opacity: number;
  /** Type-specific generator params. Keys are stable for serialization
   *  (no enum on values — numbers only so MIDI / LFO modulation can
   *  reach in via the standard modulationStore pipeline). */
  params: Record<string, number>;
  /** Optional color tint the effect renders WITH the brightness.
   *  Stored as `#rrggbb`. The stageEffects store publishes a per-slice
   *  color map alongside the brightness map; engine integration for
   *  tinting slice content with this color is a follow-up. UI exposes
   *  the picker so the data round-trips with project save. */
  color?: string;
}

export interface SurfaceSlice {
  id: string;
  /** Auto-generated as "Polygon 1, Polygon 2, ..." on SVG import;
   *  user-renameable in the slice list. */
  name: string;
  /** Vertices in the parent surface's coordinate space
   *  (0..width, 0..height). Each entry is a BezierPoint: the `x`/`y`
   *  fields define an anchor; optional `cpIn`/`cpOut` define cubic
   *  bezier control handles entering / leaving that anchor (also in
   *  surface coords, absolute — NOT deltas).
   *
   *  - Anchor with no handles ⇒ straight segment to the next anchor.
   *  - Anchor with `cpOut` set ⇒ curve LEAVES it through cpOut.
   *  - Next anchor with `cpIn` set ⇒ curve ARRIVES at it through cpIn.
   *
   *  SVG imports populate handles for path C/Q/S/T commands; the pen
   *  tool can add handles via click-and-drag. Rendering walks the
   *  array and emits SVG `C x1 y1 x2 y2 x y` when EITHER endpoint of
   *  a segment carries a handle, else a straight `L x y`. */
  polygon: BezierPoint[];
  /** Stroke/outline color in the designer UI (hex). Has no effect on
   *  rendered output. */
  color: string;
  visible: boolean;
  locked: boolean;
  /** What feeds content into this slice — Phase 3 wires this through to
   *  the rendering pipeline. Null = slice exists in the layout but
   *  carries no content yet (useful for staging layouts before binding). */
  sourceBinding: SurfaceSliceBinding | null;
  /** Phase 3: named output destination (Spout/Syphon sender name) this
   *  slice's polygon-clipped content gets sent to. Null = no separate
   *  output (slice is composite-only). */
  outputDestination?: string | null;
}

export type SurfaceSliceBinding =
  | { kind: 'layer';       layerId: string }
  | { kind: 'vjClip';      clipId: string }
  | { kind: 'stageEffect'; effectId: string };

export interface MediaTrayFolder {
  id: string;
  name: string;
  tab: 'videos' | 'images' | 'shaders';
  itemIds: string[];
}

export interface OutputConfig {
  mode: 'embedded' | 'window';
  display: number; // monitor index
  fullscreen: boolean;
}

// WebSocket message types for mobile connection
export interface WSMessage {
  type: string;
  payload: unknown;
}

export interface ControlPointUpdate {
  type: 'control_point';
  layerId: string;
  corner: keyof WarpCorners;
  position: Point2D;
}

export interface ParameterUpdate {
  type: 'parameter';
  layerId: string;
  param: string;
  value: number | string | boolean;
}

// Default factory functions
// Note: In our coordinate system, y=0 is BOTTOM (OpenGL convention for clip space)
// and y=1 is TOP. This matches what the shader expects.
export function createDefaultCorners(): WarpCorners {
  return {
    topLeft: { x: 0, y: 1 },
    topRight: { x: 1, y: 1 },
    bottomLeft: { x: 0, y: 0 },
    bottomRight: { x: 1, y: 0 },
  };
}

export function createMeshGrid(rows: number, cols: number): MeshWarpGrid {
  const points: Point2D[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Point2D[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        x: c / (cols - 1),
        // y=1 at top (row 0), y=0 at bottom (last row) - OpenGL convention
        y: 1 - r / (rows - 1),
      });
    }
    points.push(row);
  }
  return { rows, cols, points };
}

export function createDefaultSVGContent(): SVGContent {
  return {
    svgSource: '',

    // Manual positioning and scaling
    panX: 0,
    panY: 0,
    contentScale: 1,

    // Fill mode (default: liquid)
    fillMode: 'liquid',
    gradientAngle: 90,
    gradientSpread: 0.3,
    shimmerSpeed: 5.0,
    shimmerScale: 0.1,
    shimmerIntensity: 0.8,
    pulseSpeed: 3.0,
    pulseRingScale: 10.0,
    pulseRingSpeed: 5.0,
    noiseScale: 0.02,
    noiseSpeed: 0.5,
    noiseContrast: 0.5,
    particleFillDensity: 200,
    particleFillSize: 3,
    particleFillSpeed: 1.0,

    // Color mode
    colorMode: 'perShape',
    monochromeHue: 0,
    perShapeColors: true,
    colorCycleEnabled: true,
    colorCycleSpeed: 0.3,
    colorCycleSaturation: 0.8,
    colorCycleLightness: 0.55,

    // Outlines
    outlineThickness: 3,

    // Liquid fill
    liquidEnabled: true,
    liquidSpeed: 0.4,
    liquidWaveAmp: 0.08,

    // Edge particles
    particlesEnabled: true,
    particleSpeed: 80,
    particleSize: 2.5,

    // Energy pulses
    energyEnabled: true,
    energySpeed: 150,
    energySize: 1.0,

    // Connections
    connectionsEnabled: true,
    connectionPulseSpeed: 2.0,
    connectionThickness: 2,

    // Glow nodes
    glowEnabled: true,
    glowPulseSpeed: 2.0,
    glowSize: 1.0,
    glowIntensity: 0.8,

    // Ripples
    ripplesEnabled: true,
    rippleSpeed: 1.0,
    rippleSize: 1.0,
    rippleOpacity: 0.5,

    // Lightning
    lightningEnabled: true,
    lightningFrequency: 1.5,
    lightningThickness: 3,
    lightningBranches: 3,
    lightningDuration: 0.12,

    // Edge flow
    edgeFlowEnabled: true,
    edgeFlowSpeed: 1.5,
    edgeFlowThickness: 2,

    // Inner glow
    innerGlowEnabled: true,
    innerGlowIntensity: 0.5,

    // Nebula background
    nebulaEnabled: true,
    nebulaIntensity: 0.3,
    nebulaSpeed: 0.2,

    // Heartbeat
    heartbeatEnabled: true,
    heartbeatSpeed: 1.0,
    heartbeatIntensity: 0.3,

    // Plasma tendrils
    plasmaEnabled: true,
    plasmaIntensity: 0.8,
    plasmaSpeed: 2.0,
    plasmaThickness: 3,
    plasmaOpacity: 0.6,

    // Particle links
    particleLinksEnabled: true,
    particleLinkDistance: 80,
    particleLinkOpacity: 0.5,
    particleLinkThickness: 2,
    particleLinkMaxLinks: 800,
    particleLinkSpeed: 5,

    // Echo layers
    echoEnabled: true,
    echoLayers: 4,
    echoSpacing: 8,
    echoThickness: 2,
    echoOpacity: 0.3,

    // Arc bridges
    arcBridgesEnabled: true,
    arcBridgeHeight: 15,
    arcBridgeThickness: 3,
    arcBridgeOpacity: 0.4,

    // 3D extrude / material — default to the classic flat look so existing
    // layers are unchanged; holographic is the look when 3D is switched on.
    renderMode: 'flat',
    extrudeDepth: 28,
    bevelEnabled: true,
    bevelSize: 2,
    materialPreset: 'holographic',
    materialMetalness: 0.6,
    materialRoughness: 0.25,
    iridescence: 1.0,
    glassTransmission: 0.9,
    envIntensity: 1.0,
    cameraFov: 40,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    rotateSpeedX: 0,
    rotateSpeedY: 0.25,
    rotateSpeedZ: 0,
    floatAmount: 8,
    floatSpeed: 0.8,
    lightPreset: 'studio',
    lightIntensity: 1.0,

    // Fluid fill
    fluidScale: 2.5,
    fluidSpeed: 0.6,
    fluidTurbulence: 1.0,

    // Volumetric particle fill
    particleFillEnabled: false,

    // Outline + connector styles
    outlineStyle: 'solid',
    outlineDashSpeed: 1.0,
    outlineGradientSpread: 0.5,
    connectionStyle: 'arc',
    connectionRange: 200,
    connectionDataFlowSpeed: 1.5,

    // Organic
    organicWarpEnabled: false,
    warpAmount: 6,
    warpSpeed: 0.8,
    growthEnabled: false,
    growthSpeed: 0.6,
    breatheEnabled: false,
    breatheAmount: 0.08,
    breatheSpeed: 1.0,

    // Post processing
    bloomStrength: 1.8,
    bloomThreshold: 0.15,
    chromatic: 0.002,
    vignette: 0.3,
  };
}

export function createLayer(id: string, name: string, type: LayerType = 'media'): Layer {
  return {
    id,
    name,
    type,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode:
      type === 'lines' ||
      type === 'svg' ||
      type === 'lightpainting' ||
      type === 'adv-lightpaint' ||
      type === 'splat' ||
      type === 'model3d'
        ? 'add'
        : 'normal',
    source: null,
    linesContent: type === 'lines' ? createDefaultLinesContent() : null,
    svgContent: type === 'svg' ? createDefaultSVGContent() : null,
    colorContent:
      type === 'color'
        ? {
      hue: 0,
      saturation: 100,
      lightness: 50,
      alpha: 1,
          }
        : null,
    lightPaintingContent: type === 'lightpainting' ? createDefaultLightPaintingContent() : null,
    advLightPaintingContent: type === 'adv-lightpaint' ? createDefaultAdvLightPaintingContent() : null,
    textContent: type === 'text' ? createDefaultTextContent() : null,
    splatContent: type === 'splat' ? createDefaultSplatContent() : null,
    model3dContent: type === 'model3d' ? createDefaultModel3DContent() : null,
    pixelFXContent: type === 'pixel-fx' ? createDefaultPixelFXContent() : null,
    gpuLayerContent: type === 'gpu' ? createDefaultGPULayerContent() : null,
    arcadeContent: type === 'arcade' ? createDefaultArcadeContent() : null,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    flipH: false,
    flipV: false,
    warpMode: 'corners',
    corners: createDefaultCorners(),
    meshGrid: null,
    mask: type === 'mask' ? { enabled: true, shapes: [], inverted: false, feather: 0 } : null,
    cropRegion: null,
    layerShape: type === 'media' ? createDefaultLayerShape('rectangle') : null,
    effects: [],
    edgeEffects: null,
    ...(type === 'screen' ? { vjLayerIndex: 0 } : {}),
  };
}

export function createScreenLayer(id: string, name: string): Layer {
  return { ...createLayer(id, name, 'screen'), vjLayerIndex: 0 };
}

export function createGroupLayer(id: string, name: string): Layer {
  return {
    ...createLayer(id, name, 'group'),
    groupConfig: {
      shaderMode: 'individual',
      overrideStyles: false,
      shaderSource: null,
    },
    groupCollapsed: false,
  };
}

export function createLinesLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'lines');
}

export function createSVGLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'svg');
}

export function createColorLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'color');
}

export function createLightPaintingLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'lightpainting');
}

export function createAdvLightPaintingLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'adv-lightpaint');
}

export function createTextLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'text');
}

export function createSplatLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'splat');
}

export function createModel3DLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'model3d');
}

export function createPixelFXLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'pixel-fx');
}

export function createGPULayer(id: string, name: string): Layer {
  return createLayer(id, name, 'gpu');
}

export function createArcadeLayer(id: string, name: string): Layer {
  return createLayer(id, name, 'arcade');
}

export function createVJDeck(id: string): VJDeck {
  return {
    id,
    compositionId: null,
    opacity: 1,
    blendMode: 'normal',
    isActive: false,
  };
}

export function createDefaultTimeline(): Timeline {
  return {
    clips: [],
    loop: true,
    totalDuration: 0,
    isPlaying: false,
    currentTime: 0,
  };
}

export function createDefaultVJModeState(): VJModeState {
  return {
    enabled: false,
    compositions: [],
    decks: [createVJDeck('deck-a'), createVJDeck('deck-b'), createVJDeck('deck-c'), createVJDeck('deck-d')],
    timeline: createDefaultTimeline(),
    activeCompositionId: null,
    masterOpacity: 1,
  };
}

export function createDefaultMappingCompositionState(): MappingCompositionState {
  return {
    enabled: false,
    effects: [],
    stageEffects: [],
    activeStageEffectId: null,
    stageEffectAutomation: {
      playing: false,
      mode: 'time',
      seconds: 4,
      beats: 4,
    },
  };
}

export function createProject(name: string): Project {
  return {
    id: generateUUID(),
    name,
    width: 1920,
    height: 1080,
    layers: [],
    selectedLayerId: null,
    mappingComposition: createDefaultMappingCompositionState(),
    vjMode: null,
    mediaFolders: [],
    stagePresets: [],
    svKeyboardPresets: [],
    wledControllers: [],
    wledGroups: [],
    wledEffects: [],
    wledEffectAutomation: {
      playing: false,
      mode: 'beat',
      beats: 8,
      seconds: 4,
      order: 'forward',
    },
  };
}

export function createDefaultCropRegion(): CropRegion {
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  };
}

export function createDefaultLayerShape(type: LayerShapeType = 'rectangle'): LayerShape {
  const baseParams: LayerShapeParams = {
    feather: 0,
    rotation: 0,
  };

  switch (type) {
    case 'circle':
      return {
        type,
        enabled: true,
        params: { ...baseParams, radiusX: 1.0, radiusY: 1.0 },
        // Warp quad + center focus handle. Corners start AT the layer bounds
        // so the initial warp is an identity — content is untouched until a
        // handle is actually dragged.
        controlPoints: [
          { x: 0, y: 1 }, // top-left
          { x: 1, y: 1 }, // top-right
          { x: 0, y: 0 }, // bottom-left
          { x: 1, y: 0 }, // bottom-right
          { x: 0.5, y: 0.5 }, // center focus
        ],
      };
    case 'ellipse':
      return {
        type,
        enabled: true,
        params: { ...baseParams, radiusX: 1.0, radiusY: 0.7 },
      };
    case 'triangle':
      return {
        type,
        enabled: true,
        params: { ...baseParams, triangleType: 'equilateral' },
        // 3-corner warp controls
        controlPoints: [
          { x: 0.5, y: 0.88 }, // top
          { x: 0.14, y: 0.14 }, // bottom-left
          { x: 0.86, y: 0.14 }, // bottom-right
        ],
      };
    case 'polygon':
      return {
        type,
        enabled: true,
        params: { ...baseParams, sides: 6 },
      };
    case 'star':
      return {
        type,
        enabled: true,
        params: { ...baseParams, sides: 5, innerRadius: 0.4 },
      };
    case 'line':
      return {
        type,
        enabled: true,
        params: {
          ...baseParams,
          lineWidth: 0.05,
          linePoints: [
            { x: 0.2, y: 0.5 },
            { x: 0.8, y: 0.5 },
          ],
          lineCap: 'round',
        },
      };
    case 'polyline':
      return {
        type,
        enabled: true,
        params: {
          ...baseParams,
          lineWidth: 0.03,
          linePoints: [
            { x: 0.1, y: 0.5 },
            { x: 0.3, y: 0.2 },
            { x: 0.5, y: 0.8 },
            { x: 0.7, y: 0.3 },
            { x: 0.9, y: 0.6 },
          ],
          lineCap: 'round',
        },
      };
    case 'custom':
      return {
        type: 'custom',
        enabled: true,
        params: {
          ...baseParams,
          customPoints: [],
          customClosed: false,
        },
      };
    case 'rectangle':
    default:
      return {
        type: 'rectangle',
        enabled: true,
        params: baseParams,
      };
  }
}

export function createDefaultEdgeEffect(): EdgeEffect {
  return {
    id: generateUUID(),
    enabled: true,
    fill: { type: 'none' },
    stroke: {
      type: 'glow',
      color: [0, 1, 0.5, 1] as [number, number, number, number],
      width: 3,
      glowSize: 15,
      glowIntensity: 1,
      pulseSpeed: 1,
    },
    animation: { type: 'none' },
    blendMode: 'add',
    opacity: 1,
  };
}

/**
 * Convert a parametric LayerShape to a custom polygon shape.
 * Computes polygon vertices that approximate the original shape.
 */
export function convertShapeToCustom(shape: LayerShape): LayerShape {
  const points: Point2D[] = [];
  const rotation = ((shape.params.rotation ?? 0) * Math.PI) / 180;
  const scale = shape.params.scale ?? 1.0;

  const rotatePoint = (x: number, y: number): Point2D => {
    const rx = x * Math.cos(rotation) - y * Math.sin(rotation);
    const ry = x * Math.sin(rotation) + y * Math.cos(rotation);
    return { x: rx + 0.5, y: ry + 0.5 };
  };

  switch (shape.type) {
    case 'rectangle': {
      const hw = 0.5 * scale,
        hh = 0.5 * scale;
      points.push(rotatePoint(-hw, hh));   // top-left
      points.push(rotatePoint(hw, hh));    // top-right
      points.push(rotatePoint(hw, -hh));   // bottom-right
      points.push(rotatePoint(-hw, -hh));  // bottom-left
      break;
    }
    case 'circle': {
      // Multiply by 0.5 to match the SDF shader which does sdCircle(p, uRadiusX * 0.5)
      const r = (shape.params.radiusX ?? 0.5) * 0.5 * scale;
      const n = 64; // Smooth circle (was 24 — too jagged)
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + rotation;
        points.push({ x: 0.5 + r * Math.cos(angle), y: 0.5 + r * Math.sin(angle) });
      }
      break;
    }
    case 'ellipse': {
      // Multiply by 0.5 to match the SDF shader which does sdEllipse(p, vec2(rx,ry) * 0.5)
      const rx = (shape.params.radiusX ?? 0.5) * 0.5 * scale;
      const ry = (shape.params.radiusY ?? 0.35) * 0.5 * scale;
      const n = 64; // Smooth ellipse (was 24 — too jagged)
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2;
        const px = rx * Math.cos(angle);
        const py = ry * Math.sin(angle);
        points.push(rotatePoint(px, py));
      }
      break;
    }
    case 'triangle': {
      if (shape.controlPoints && shape.controlPoints.length === 3) {
        points.push(...shape.controlPoints);
      } else {
        const r = 0.4 * scale;
        for (let i = 0; i < 3; i++) {
          const angle = (i / 3) * Math.PI * 2 - Math.PI / 2 + rotation;
          points.push({ x: 0.5 + r * Math.cos(angle), y: 0.5 + r * Math.sin(angle) });
        }
      }
      break;
    }
    case 'polygon': {
      const sides = shape.params.sides ?? 6;
      const r = 0.4 * scale;
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2 - Math.PI / 2 + rotation;
        points.push({ x: 0.5 + r * Math.cos(angle), y: 0.5 + r * Math.sin(angle) });
      }
      break;
    }
    case 'star': {
      const starSides = shape.params.sides ?? 5;
      const outerR = 0.4 * scale;
      const innerR = outerR * (shape.params.innerRadius ?? 0.4);
      for (let i = 0; i < starSides * 2; i++) {
        const angle = (i / (starSides * 2)) * Math.PI * 2 - Math.PI / 2 + rotation;
        const r = i % 2 === 0 ? outerR : innerR;
        points.push({ x: 0.5 + r * Math.cos(angle), y: 0.5 + r * Math.sin(angle) });
      }
      break;
    }
    case 'custom': {
      // Already custom, return as-is
      return { ...shape };
    }
    default: {
      // Fallback: unit square
      points.push({ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.1 });
      break;
    }
  }

  return {
    type: 'custom',
    enabled: shape.enabled,
    params: {
      feather: shape.params.feather,
      rotation: 0,
      customPoints: points,
      // Snapshot the outline as authored: dragging vertices later warps the
      // content smoothly against this base (MadMapper-style content follow).
      customBasePoints: points.map((point) => ({ ...point })),
      customClosed: true,
    },
  };
}

/**
 * Get polygon vertices from any LayerShape (for edge effects rendering).
 * Does NOT modify the shape - computes vertices on-the-fly.
 * For custom shapes, tessellates bezier curves into line segments for smooth outlines.
 */
export function getShapeVertices(shape: LayerShape): Point2D[] {
  if (shape.type === 'custom') {
    const customPts = shape.params.customPoints;
    if (!customPts || customPts.length < 3) return [];
    // Tessellate bezier curves into dense point array
    const tessellated: Point2D[] = [];
    const BEZIER_STEPS = 10;
    for (let ci = 0; ci < customPts.length; ci++) {
      const a = customPts[ci];
      const nextI = (ci + 1) % customPts.length;
      const b = customPts[nextI];
      const hasCurve = a.cpOut || b.cpIn;
      tessellated.push({ x: a.x, y: a.y });
      if (hasCurve) {
        const cp1 = a.cpOut ?? a;
        const cp2 = b.cpIn ?? b;
        for (let s = 1; s < BEZIER_STEPS; s++) {
          const t = s / BEZIER_STEPS;
          const mt = 1 - t;
          const mt2 = mt * mt;
          const t2 = t * t;
          tessellated.push({
            x: mt2 * mt * a.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t2 * t * b.x,
            y: mt2 * mt * a.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t2 * t * b.y,
          });
        }
      }
    }
    return tessellated;
  }
  const converted = convertShapeToCustom(shape);
  let pts = converted.params.customPoints ?? [];

  // Apply shape-warp control points so the edge outline follows the warped
  // shape (e.g. when the user drags circle warp handles in Edit Shape Warp).
  // Circle has 5 control points: TL, TR, BL, BR, Center.
  // Triangle uses 3 control points: its corner vertices (already handled
  // directly in convertShapeToCustom, so skip here).
  if (shape.type === 'circle' && shape.controlPoints?.length === 5) {
    const [tl, tr, bl, br, center] = shape.controlPoints;
    // Forward bilinear warp: map each UV-space vertex through the quad
    // defined by the 4 corner control points.
    pts = pts.map((p) => {
      const topX = tl.x + (tr.x - tl.x) * p.x;
      const topY = tl.y + (tr.y - tl.y) * p.x;
      const botX = bl.x + (br.x - bl.x) * p.x;
      const botY = bl.y + (br.y - bl.y) * p.x;
      return {
        x: botX + (topX - botX) * p.y,
        y: botY + (topY - botY) * p.y,
      };
    });
  }

  return pts;
}
