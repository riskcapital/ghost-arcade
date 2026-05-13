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

export type MediaType = 'image' | 'video' | 'shader' | 'color' | 'threejs' | 'p5js' | 'javascript' | 'spout' | 'effect' | 'synthvision';

// Integrated effect types (FluidGen, Particles3D, Point Cloud, 3D Models running natively in WebGL)
export type IntegratedEffectType = 'fluid' | 'particles' | 'splat' | 'model3d';

// Integrated effect source configuration
export interface IntegratedEffectSource {
  effectType: IntegratedEffectType;
  // Shared params
  cameraEnabled?: boolean;     // Use webcam as input feed
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
}

// Spout source configuration (for plugin integrations)
export interface SpoutSource {
  name?: string;         // Legacy: Spout sender name (deprecated, use senderName)
  senderName: string;    // Spout sender name (e.g., 'FluidGen', 'Particles3D')
  pluginId?: string;     // Plugin identifier for controls
  width?: number;        // Optional resolution hint
  height?: number;       // Optional resolution hint
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

export type LayerType = 'media' | 'lines' | 'svg' | 'color' | 'lightpainting' | 'adv-lightpaint' | 'text' | 'splat' | 'model3d' | 'screen' | 'group' | 'pixel-fx' | 'gpu';

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
  /** Shader-specific params. Keys + types are defined by the
   *  shader's paramSchema; the panel renders controls accordingly. */
  params: Record<string, any>;
}

export function createDefaultGPULayerContent(): GPULayerContent {
  // Default to planet — most visually striking out of the box.
  return {
    shaderId: 'planet',
    params: {},   // shader populates defaults from its schema on first render
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
export type PixelFXMode = 'identity' | 'depth-shift' | 'sand-fall' | 'scatter' | 'halftone' | 'stipple-noise' | 'dissolve' | 'flythrough';

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
  videoElement?: HTMLVideoElement;
  iframeElement?: HTMLIFrameElement; // For three.js HTML sources
  threejsCanvas?: HTMLCanvasElement; // Offscreen canvas to capture iframe content
  shaderCode?: string; // ISF/GLSL shader source
  shaderInputs?: ISFInputDef[]; // ISF shader parameters
  shaderValues?: Record<string, number | boolean | number[]>; // Current parameter values
  shaderImageInputs?: Record<string, ImageInputRef>; // References to textures for 'image' type inputs
  isPlaying?: boolean; // For video playback control
  playbackMode?: VideoPlaybackMode; // Video playback mode (default: 'loop')
  playbackRate?: number; // Playback speed multiplier (default: 1.0)
  trimStart?: number; // 0-1 normalized start point (default 0)
  trimEnd?: number; // 0-1 normalized end point (default 1)
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
  // Integrated effect source (native WebGL fluid/particles)
  effectSource?: IntegratedEffectSource;
  // SynthVision: shared offscreen canvas the texture mirrors
  synthVisionCanvas?: HTMLCanvasElement;
  // Set when src failed to load (404, decode error). Surfaced as a badge in the library UI.
  broken?: boolean;
  brokenReason?: string;
}

// Lines layer content is defined in ./lines/types.ts and imported at top
// (LinesContent replaces the old GenerativeContent)

// SVG layer fill modes
export type SVGFillMode = 'liquid' | 'solid' | 'gradient' | 'shimmer' | 'pulse' | 'noise' | 'particles';

// SVG layer color modes
export type SVGColorMode = 'perShape' | 'rainbow' | 'monochrome' | 'complementary' | 'analogous' | 'white';

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
  | 'smoke';      // Wisps rise from the stroke with curl noise (incense)

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
  | 'spiral';           // Spiral in/out animation

// Displacement effect types
export type SplatDisplacementType =
  | 'none'
  | 'noise'             // Perlin/simplex noise displacement
  | 'audioReactive'     // Displacement based on audio bands
  | 'wave'              // Sine wave propagation
  | 'glitch'            // Random offset glitching
  | 'wind'              // Turbulent wind simulation
  | 'magnetic'          // Attraction/repulsion to points
  | 'ripple';           // Ripple from interaction point

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

  // Animation
  animationType: SplatAnimationType;
  animationSpeed: number;         // 0.1-5
  animationProgress: number;      // 0-1 manual control
  animationLoop: boolean;
  animationPingPong: boolean;
  animationIntensity: number;     // Effect strength 0-2

  // Animation-specific params
  explodeForce: number;           // 0-5
  implodeForce: number;           // 0-5
  voxelGridSize: number;          // 2-64
  peelAxis: 'x' | 'y' | 'z';
  peelDirection: 1 | -1;
  swarmCohesion: number;          // 0-1
  swarmSeparation: number;        // 0-1
  swarmAlignment: number;         // 0-1

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

  // Color effects
  colorEffectType: SplatColorEffectType;
  colorEffect: SplatColorEffectType;  // Alias for UI
  colorEffectIntensity: number;   // 0-1
  colorEffectSpeed: number;       // 0-5
  tintColor: string;              // Hex color for tint
  tintStrength: number;           // 0-1
  heatmapMin: number;             // 0-1
  heatmapMax: number;             // 0-1
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
    cameraDistance: 50,  // Default to zoomed out
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

    animationType: 'none',
    animationSpeed: 1,
    animationProgress: 0,
    animationLoop: true,
    animationPingPong: false,
    animationIntensity: 1,

    explodeForce: 1,
    implodeForce: 1,
    voxelGridSize: 16,
    peelAxis: 'y',
    peelDirection: 1,
    swarmCohesion: 0.5,
    swarmSeparation: 0.5,
    swarmAlignment: 0.5,

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

    materialType: 'standard',
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
}

export interface EdgeEffectsConfig {
  enabled: boolean;
  effects: EdgeEffect[];
}

export interface Layer {
  id: string;
  name: string;
  type: LayerType;  // 'media', 'lines', 'svg', 'color', 'lightpainting', 'text', 'splat', or 'model3d'
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

  // Stage Mode: which VJ layer feeds this mapping layer (undefined = use own source)
  vjLayerIndex?: number;

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
  | 'chronophoto';

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

  // Vignette params
  vignetteSize?: number;          // 0-1, how far vignette extends
  vignetteSoftness?: number;      // 0-1, edge softness
  vignetteRoundness?: number;     // 0-1, circular vs rectangular

  // Edge feather params (independent sides)
  featherTop?: number;            // 0-1
  featherBottom?: number;
  featherLeft?: number;
  featherRight?: number;
  featherSoftness?: number;

  // Colorama params (cosine palette effect)
  coloramaPalette?: number;       // 0-7 preset palettes
  coloramaOffset?: number;        // 0-1 manual offset through palette
  coloramaSpeed?: number;         // 0-2 auto-cycle speed (0 = off)
  coloramaContrast?: number;      // 0.5-2 luminance contrast
  coloramaMix?: number;           // 0-1 blend with original

  // Dither params
  ditherType?: number;            // 0=bayer, 1=noise, 2=halftone, 3=ordered
  ditherIntensity?: number;       // 0-1
  ditherScale?: number;           // 1-16
  ditherColorDepth?: number;      // 1-8 bits

  // VHS params
  vhsTracking?: number;           // 0-1
  vhsNoise?: number;              // 0-1
  vhsDistortion?: number;         // 0-1
  vhsColorBleed?: number;         // 0-1
  vhsScanlines?: number;          // 0-1

  // Glitch params
  glitchIntensity?: number;       // 0-1
  glitchSpeed?: number;           // 0-2
  glitchBlockSize?: number;       // 0-1
  glitchRGBSplit?: number;        // 0-1
  glitchJitter?: number;          // 0-1

  // RGB Shift
  rgbShiftAmount?: number;        // 0-50 pixels
  rgbShiftAngle?: number;         // 0-360

  // Scanlines
  scanlinesIntensity?: number;    // 0-1
  scanlinesCount?: number;        // 50-500
  scanlinesSpeed?: number;        // 0-2

  // Pixelate
  pixelateSize?: number;          // 1-64

  // Blur
  blurRadius?: number;            // 0-20

  // Sharpen
  sharpenAmount?: number;         // 0-2

  // Noise
  noiseAmount?: number;           // 0-1
  noiseType?: number;             // 0=static, 1=animated

  // Kaleidoscope
  kaleidoscopeSegments?: number;  // 2-16
  kaleidoscopeAngle?: number;     // 0-360

  // Mirror
  mirrorAxis?: number;            // 0=horizontal, 1=vertical, 2=both
  mirrorPosition?: number;        // 0-1

  // Plasma params
  plasmaSpeed?: number;           // 0-2
  plasmaScale?: number;           // 1-20
  plasmaComplexity?: number;      // 1-5
  plasmaPalette?: number;         // 0=rainbow, 1=fire, 2=ocean, 3=neon, 4=custom

  // Posterize params (standalone)
  posterizeLevels?: number;       // 2-32

  // Edge Detection params
  edgeThreshold?: number;         // 0-1
  edgeThickness?: number;         // 0.5-3
  edgeMode?: number;              // 0=sobel, 1=laplacian, 2=prewitt, 3=frei-chen
  edgeInvert?: number;            // 0=normal, 1=inverted

  // Outline params
  outlineThickness?: number;      // 1-10
  outlineColor?: number[];        // RGB color
  outlineOnly?: number;           // 0=overlay, 1=outline only
  outlineGlow?: number;           // 0-1 glow amount

  // Emboss params
  embossStrength?: number;        // 0-2
  embossAngle?: number;           // 0-360

  // Wave distortion params
  waveAmplitude?: number;         // 0-50
  waveFrequency?: number;         // 1-20
  waveSpeed?: number;             // 0-2
  waveType?: number;              // 0=horizontal, 1=vertical, 2=radial

  // Fisheye params
  fisheyeStrength?: number;       // -1 to 1 (negative = pincushion)
  fisheyeRadius?: number;         // 0-1

  // Thermal camera params
  thermalIntensity?: number;      // 0-2
  thermalPalette?: number;        // 0=classic, 1=ironbow, 2=arctic

  // Night vision params
  nightVisionIntensity?: number;  // 0-2
  nightVisionNoise?: number;      // 0-1
  nightVisionVignette?: number;   // 0-1

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
  invertAmount?: number;          // 0 or 1

  // Plasma additional
  plasmaMix?: number;             // 0-1 plasma mix amount

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
  red?: number;                   // Generic color grading red component
  green?: number;                 // Generic color grading green component
  blue?: number;                  // Generic color grading blue component
  softness?: number;              // Generic softness parameter

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

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: EffectParams;
  opacity?: number;       // 0-1, default 1 (fully opaque effect)
  blendMode?: BlendMode;  // How this effect composites onto the source, default 'normal'
}

// Stage Preset - A saved mapping layout with VJ layer assignments for Stage Mode
export interface StagePreset {
  id: string;
  name: string;
  thumbnail?: string;
  createdAt: number;
  layers: Layer[];  // Deep clone of mapping layers with vjLayerIndex assignments
  scope?: 'project' | 'global';  // Two-tier: 'project' saved in .ghost-arcade, 'global' in localStorage
}

// SynthVision Keyboard Clip Assignment
export interface SVClipAssignment {
  type: 'shader' | 'media';
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
  // VJ Mode data (optional - null when not used)
  vjMode: VJModeState | null;
  // Media tray organization folders (project-scoped)
  mediaFolders?: MediaTrayFolder[];
  // Saved compositions (shortcut access)
  compositions?: Composition[];
  // Stage Mode presets (mapping layouts with VJ layer assignments)
  stagePresets?: StagePreset[];
  // SynthVision keyboard presets (performer mode keyboard assignments)
  svKeyboardPresets?: SVKeyboardPreset[];
}

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
    blendMode: type === 'lines' || type === 'svg' || type === 'lightpainting' || type === 'adv-lightpaint' || type === 'splat' || type === 'model3d' ? 'add' : 'normal',
    source: null,
    linesContent: type === 'lines' ? createDefaultLinesContent() : null,
    svgContent: type === 'svg' ? createDefaultSVGContent() : null,
    colorContent: type === 'color' ? {
      hue: 0,
      saturation: 100,
      lightness: 50,
      alpha: 1,
    } : null,
    lightPaintingContent: type === 'lightpainting' ? createDefaultLightPaintingContent() : null,
    advLightPaintingContent: type === 'adv-lightpaint' ? createDefaultAdvLightPaintingContent() : null,
    textContent: type === 'text' ? createDefaultTextContent() : null,
    splatContent: type === 'splat' ? createDefaultSplatContent() : null,
    model3dContent: type === 'model3d' ? createDefaultModel3DContent() : null,
    pixelFXContent: type === 'pixel-fx' ? createDefaultPixelFXContent() : null,
    gpuLayerContent: type === 'gpu' ? createDefaultGPULayerContent() : null,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    flipH: false,
    flipV: false,
    warpMode: 'corners',
    corners: createDefaultCorners(),
    meshGrid: null,
    mask: null,
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
    decks: [
      createVJDeck('deck-a'),
      createVJDeck('deck-b'),
      createVJDeck('deck-c'),
      createVJDeck('deck-d'),
    ],
    timeline: createDefaultTimeline(),
    activeCompositionId: null,
    masterOpacity: 1,
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
    vjMode: null,
    mediaFolders: [],
    stagePresets: [],
    svKeyboardPresets: [],
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
        // X-style warp controls + center focus handle
        controlPoints: [
          { x: 0.2, y: 0.8 }, // top-left
          { x: 0.8, y: 0.8 }, // top-right
          { x: 0.2, y: 0.2 }, // bottom-left
          { x: 0.8, y: 0.2 }, // bottom-right
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
          linePoints: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }],
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
  const rotation = (shape.params.rotation ?? 0) * Math.PI / 180;
  const scale = shape.params.scale ?? 1.0;

  const rotatePoint = (x: number, y: number): Point2D => {
    const rx = x * Math.cos(rotation) - y * Math.sin(rotation);
    const ry = x * Math.sin(rotation) + y * Math.cos(rotation);
    return { x: rx + 0.5, y: ry + 0.5 };
  };

  switch (shape.type) {
    case 'rectangle': {
      const hw = 0.5 * scale, hh = 0.5 * scale;
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
    pts = pts.map(p => {
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
