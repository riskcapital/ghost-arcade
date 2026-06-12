// Type definitions for the 3D Stage Designer.
//
// The 3D scene is a tree of `Stage3DNode` instances. Nodes describe the
// stage geometry (trusses, ground, walls) and the LED screens that play
// back live VJ-layer textures. The scene is serialisable to JSON so user
// designs save/load and can be shared / sold as stage packs.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Stage3DNode is the discriminated union of every placeable thing in
 *  the scene. New node types extend this — keep the `type` literal
 *  enumerated so the renderer can dispatch on it. */
export type Stage3DNode =
  | StageLedScreenNode
  | StageTrussNode
  | StagePrimitiveNode
  | StageSvgExtrudeNode
  | StageImportedGlbNode
  | StageSpotLightNode
  | StagePointLightNode
  | StageRectAreaLightNode
  | StageLaserNode
  | StageFogVolumeNode
  | StageGroupNode;

interface Stage3DBaseNode {
  id: string;
  name: string;
  position: Vec3;
  /** Euler angles in radians, XYZ order. */
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  /** UI-locked nodes can't be selected or moved — used to pin preset
   *  scenery so users don't accidentally drag the stage floor. */
  locked?: boolean;
}

/** LED screen: the workhorse of the 3D scene. A flat or curved mesh
 *  whose material samples a `CanvasTexture` bound to the editor's
 *  layer-renderer output. `layerId` lets a screen show a specific
 *  layer instead of the full editor composite — useful when you want
 *  one wall to play camera and another wall to play a shader. */
export interface StageLedScreenNode extends Stage3DBaseNode {
  type: 'led-screen';
  /** Physical size in scene units (meters). Width × Height. */
  width: number;
  height: number;
  /** Curvature radius in scene units. `0` = flat. Positive = convex
   *  facing +Z, negative = concave. Curved screens use a small grid of
   *  subdivisions internally. */
  curvature: number;
  /** Material look. `led` = high-emissive + pixel-grid overlay,
   *  `projection` = lower brightness, `clean` = unlit basic material. */
  finish: 'led' | 'projection' | 'clean';
  /** Frame depth in meters — the bezel sticking out behind the screen
   *  surface so LED walls don't look infinitely thin. `0` hides frame. */
  frameDepth: number;
  /** Source layer. `'auto'` follows VJ Screen-layer order,
   *  `'master'` = full editor composite/VJ mix, and a layer id pins the
   *  screen to that specific VJ Screen layer. */
  source: 'auto' | 'master' | string;
  /** Brightness multiplier on the material's emissive (0..4). Lets
   *  designers darken individual screens without touching the source. */
  brightness: number;
  /** When true, the LED-grid overlay shader is added to make the
   *  screen look like physical LED pixels (visible from close camera). */
  showPixels: boolean;
  /** How the source texture maps onto the screen surface. Mirrors CSS
   *  object-fit semantics so users coming from the editor's layer
   *  Content Fit picker get familiar behaviour.
   *  `stretch` = fill the panel ignoring source aspect (default — current behaviour),
   *  `contain` = letterbox to keep source aspect,
   *  `cover`   = crop to keep source aspect, no bars. */
  displayFit?: 'stretch' | 'contain' | 'cover';
  /** Edge / bezel effect rendered over the LED surface.
   *  `none`        = no overlay,
   *  `bezel-glow`  = soft inner glow ring along the perimeter,
   *  `soft-border` = fade-to-black vignette at edges,
   *  `scanlines`   = thin horizontal scanline overlay,
   *  `pixel-grid`  = visible LED pixel grid (close-up texture). */
  edgeEffect?: 'none' | 'bezel-glow' | 'soft-border' | 'scanlines' | 'pixel-grid';
}

/** Pre-built scenery: trusses, stages, speakers. These are imported as
 *  GLB or generated procedurally from parameters. */
export interface StageTrussNode extends Stage3DBaseNode {
  type: 'truss';
  /** Length × beam thickness. */
  length: number;
  thickness: number;
  /** Triangular vs square cross-section. */
  profile: 'triangular' | 'square';
  /** Diagonal brace density (0..1). */
  braceDensity: number;
  color: string;
}

export interface StagePrimitiveNode extends Stage3DBaseNode {
  type: 'primitive';
  geometry: 'box' | 'cylinder' | 'sphere' | 'plane' | 'cone';
  /** Up to 3 geometry-specific dimensions; meaning depends on `geometry`. */
  dimensions: Vec3;
  material: {
    color: string;
    roughness: number;
    metalness: number;
    emissive?: string;
    emissiveIntensity?: number;
  };
}

/** SVG-extruded wall — the hand-off between the 2D stage designer
 *  and the 3D scene. The SVG path becomes a 2D shape extruded along
 *  +Z by `depth` units, with the option to add LED-screen material. */
export interface StageSvgExtrudeNode extends Stage3DBaseNode {
  type: 'svg-extrude';
  svgSource: string;
  depth: number;
  bevelEnabled: boolean;
  bevelSize: number;
  /** If non-null, the front face becomes an LED screen sourcing this
   *  layer. Lets a designer build an outlined "GHOST" wall and have
   *  the letters themselves play visuals. */
  ledSource: 'master' | string | null;
  material: StagePrimitiveNode['material'];
}

/** Imported GLB asset — scenery, furniture, audience-prop stand-ins. */
export interface StageImportedGlbNode extends Stage3DBaseNode {
  type: 'imported-glb';
  /** Persisted asset id (resolved against assetRegistry at load). */
  assetId: string;
  /** Cached display name from the source file. */
  sourceName: string;
}

/** Light nodes. Each light can route its intensity to an audio
 *  channel; envelope shaping handled by the renderer. */
type AudioRouting = {
  /** Audio source to react to. `'none'` = static. */
  source: 'none' | 'audioBass' | 'audioMid' | 'audioHigh' | 'audioLevel' | 'audioBeat';
  /** Mix between baseline value and audio-driven value (0..1). */
  amount: number;
  /** Smoothing factor — higher = slower response. */
  smoothing: number;
};

export interface StageSpotLightNode extends Stage3DBaseNode {
  type: 'spot-light';
  color: string;
  intensity: number;
  distance: number;
  angle: number;
  penumbra: number;
  decay: number;
  /** Target position the cone points at, in scene-space. */
  target: Vec3;
  /** Audio routings — intensity by default; can also drive color hue,
   *  cone angle, or pan target offset for swept-beam effects. */
  audioIntensity: AudioRouting;
  audioHue: AudioRouting;
  audioPan: AudioRouting;
}

export interface StagePointLightNode extends Stage3DBaseNode {
  type: 'point-light';
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  audioIntensity: AudioRouting;
}

export interface StageRectAreaLightNode extends Stage3DBaseNode {
  type: 'rect-area-light';
  color: string;
  intensity: number;
  width: number;
  height: number;
  audioIntensity: AudioRouting;
}

/** Laser node — a beam (or a fan of beams) with bloom. Lasers fan via
 *  `count` discrete beams spread across `spread` radians. */
export interface StageLaserNode extends Stage3DBaseNode {
  type: 'laser';
  color: string;
  /** Total beam intensity (multiplier on bloom). */
  intensity: number;
  /** Number of discrete beams (1 = single laser, 8 = fan). */
  count: number;
  /** Angular spread of the fan, radians. */
  spread: number;
  /** Beam length, meters. */
  length: number;
  /** Beam thickness, meters. */
  thickness: number;
  /** Beat-synced cue: when true, lasers strobe on `audioBeat`. */
  beatStrobe: boolean;
  /** Sweep speed (radians/sec) — 0 = static, positive = rotating fan. */
  sweepSpeed: number;
  audioIntensity: AudioRouting;
}

/** Fog volume — a box region inside which raymarched volumetric fog
 *  is rendered. The fog density modulates with audio for atmospheric
 *  builds during drops. */
export interface StageFogVolumeNode extends Stage3DBaseNode {
  type: 'fog-volume';
  /** Box dimensions in meters (W × H × D). */
  dimensions: Vec3;
  color: string;
  density: number;
  /** Noise scale for the procedural haze pattern. */
  noiseScale: number;
  /** Animation speed of the fog scroll. */
  windSpeed: number;
  audioDensity: AudioRouting;
}

/** Group node — folder for organising the scene tree. Children inherit
 *  the parent's transform. */
export interface StageGroupNode extends Stage3DBaseNode {
  type: 'group';
  children: Stage3DNode[];
}

/** Camera state — saved with the scene so reload lands you on the
 *  same view. The `cinematicPaths` array carries auto-orbit / preset
 *  camera moves shown via the playback controls. */
export interface StageCamera {
  position: Vec3;
  target: Vec3;
  fov: number;
  cinematicPaths?: CameraPath[];
}

export interface CameraPath {
  id: string;
  name: string;
  /** Sequence of keyframes describing the cinematic move. */
  keyframes: { t: number; position: Vec3; target: Vec3 }[];
  /** Total path length in seconds. */
  duration: number;
  loop: boolean;
}

/** Stage platform — the raised deck under the artist. Defined as a
 *  rectangular box positioned in world space so a single platform can
 *  describe both a centred mainstage AND a wide festival deck via
 *  width/depth/height + position. The bevelled top edge gives it the
 *  silhouette of a real stage rather than a flat cube. */
export interface StagePlatform {
  enabled: boolean;
  position: Vec3;
  /** W × H × D in meters. Height = deck thickness; the floor of the
   *  stage sits at `position.y` and the top surface at `position.y + height`. */
  width: number;
  height: number;
  depth: number;
  /** Deck top colour. Defaults to a matte black for stage darkness. */
  topColor: string;
  /** Side/skirt colour — usually darker than the top so the deck reads
   *  as a "stage rectangle floating above the ground". */
  skirtColor: string;
  /** Optional under-glow strip running along the front of the deck.
   *  Renders as an emissive thin box; colour modulates the underlight. */
  underglow: { enabled: boolean; color: string; intensity: number };
  /** Bevel size on the top edges (meters). 0 = sharp box, larger
   *  rounds the front lip so it catches light. */
  bevelSize: number;
}

/** A complete stage scene — what gets persisted as a `.stage.json` or
 *  shipped as a marketplace preset. */
export interface Stage3DScene {
  id: string;
  name: string;
  /** Schema version for forward-compat. Bump when the shape changes. */
  schemaVersion: 1;
  /** Author + license fields populated for marketplace assets. */
  author?: string;
  license?: string;
  /** Optional thumbnail (data URL or relative path). */
  thumbnail?: string;
  /** Scene background colour or HDRI. */
  environment: {
    background: string;
    /** Path to an HDRI environment map (.hdr / .exr) for image-based lighting. */
    hdri?: string;
    /** Ambient light intensity baseline. */
    ambient: number;
    /** Show / hide the ground plane (rooftop stages skip it). */
    showGround: boolean;
    groundColor: string;
  };
  /** Stage platform / deck. Optional — empty scenes start without one;
   *  presets define their own to fit their footprint. */
  platform?: StagePlatform;
  /** Default camera state when the scene opens. */
  camera: StageCamera;
  /** Scene graph root — flat-ish; group nodes can nest. */
  nodes: Stage3DNode[];
  /** Per-scene reactive-lighting preset id (matches a record in the
   *  lighting cue library). `null` = no reactive lighting on by default. */
  lightingCueId: string | null;
  /** Stage base preset — picks the scenery: truss, ceiling, walls,
   *  audience riser, floor finish, ambient lighting baseline. Reads
   *  like "Festival mainstage", "Arena bowl" etc. Visuals only — does
   *  not affect screen geometry (that comes from the project's screen
   *  layers via auto-sync). */
  basePreset?: Stage3DBasePreset;
  /** Per-screen-layer 3D transform overrides. The 3D scene auto-builds
   *  LED meshes from project.layers (type === 'screen'); each LED's
   *  default position is derived from its corner box. Once the user
   *  drags an LED in 3D, that hand-tweaked transform is stored here
   *  by screen-layer id so it survives scene rebuilds. Resetting an
   *  override returns the LED to the auto-derived default. */
  screenOverrides?: Record<string, Stage3DScreenOverride>;
  /** Active venue preset — drives scenery (floor, walls, fog, lighting
   *  baseline). Defaults to 'festival' when absent. Replaces the older
   *  `basePreset` field which conflated venue + scenery presets. */
  venue?: Stage3DVenue;
  /** User-placed library elements (truss, lights, PA, decks, etc.). LED
   *  screens are NOT stored here — they auto-derive from the project's
   *  screen layers. Persisted with the scene so designs survive reloads. */
  userElements?: UserStageElement[];
  /** Per-scenery overrides keyed by stable sceneryId (deck, riser,
   *  truss-front, mover-side-L-0, par-7, …). Lets the user move /
   *  rotate / scale / delete venue scenery without rebuilding the
   *  venue. `deleted: true` hides the mesh. */
  sceneryOverrides?: Record<string, StageSceneryOverride>;
  /** Per-scene lighting + screen overrides — multipliers on top of the
   *  venue's lighting baseline. All in 0..2 except floorDarkness which
   *  is a 0..1 darkening factor. Defaults to neutral (1, 0, 1, 0). */
  lighting?: Stage3DLighting;
  /** Atmosphere FX toggles (beams / lasers / haze / LED strips).
   *  Absent = all off. */
  atmosphere?: Stage3DAtmosphere;
  /** Free-form metadata for the marketplace + thumbnails system. */
  meta?: Record<string, string | number | boolean>;
}

/** Stage base preset — controls the venue scenery surrounding the LED rig. */
export type Stage3DBasePreset = 'festival' | 'arena' | 'club' | 'conference' | 'empty';

/** Venue presets ported from the STAGEFORGE reference. Drive scenery
 *  (room/ground/walls), lighting baseline, fog, and grid visibility.
 *  Picked separately from `basePreset` (which is the legacy field).
 *  Each venue exposes a `stageW` / `frontZ` so PA presets place sensibly. */
export type Stage3DVenue = 'festival' | 'arena' | 'club' | 'nightclub' | 'sphere';

/** Atmosphere FX toggles — the "full rock show" layer. Each element is
 *  independently toggleable; everything animates to the shared
 *  visual-audio bus (beams sweep, lasers fan, strips chase the bass).
 *  Persisted with the scene. */
export interface Stage3DAtmosphere {
  /** Volumetric beam cones on every venue mover, pan/tilt animated. */
  beams: boolean;
  /** Laser fan units on the rig — sharp saturated sweeps. */
  lasers: boolean;
  /** Dense haze: thickens scene fog and fattens beam glow. */
  haze: boolean;
  /** Emissive LED pixel-strips along the trusses, bass-chased. */
  strips: boolean;
}

export const DEFAULT_ATMOSPHERE: Stage3DAtmosphere = {
  beams: false,
  lasers: false,
  haze: false,
  strips: false,
};

/** User-placed scene element (truss, light, speaker, deck, etc.) backed
 *  by an entry in the element-type registry. LED screens are NOT user
 *  elements — they auto-sync from project screen layers via Apply Stage.
 *  Params are a free dict keyed by the registry's field definitions so
 *  new element types don't require schema migrations. */
export interface UserStageElement {
  id: string;
  type: string;
  params: Record<string, number | string>;
  position: Vec3;
  /** Y-axis rotation in radians (other axes rarely needed for stage gear). */
  rotationY: number;
  scale: number;
}

/** Scene-wide lighting + screen tuning. Lets the user dim the room or
 *  boost the screens without changing the venue preset. The renderer
 *  applies these on top of the venue's baseline lighting / fixture
 *  intensities every frame. */
export interface Stage3DLighting {
  /** Multiplier on hemi/ambient/key/fill/rim intensities. 1 = baseline,
   *  0 = totally dark room. Useful when the room over-lights the LEDs. */
  roomIntensity: number;
  /** 0 = floor as venue defined, 1 = pitch-black floor. Linear darken. */
  floorDarkness: number;
  /** Multiplier on LED brightness (screen boost). 1 = baseline. */
  screenBoost: number;
  /** Tone-mapping exposure override. 0 = use venue's default exposure;
   *  positive value replaces it. */
  exposure: number;
  /** Truss colour override. Empty string = venue baseline (silver
   *  aluminium). Hex string ('#1a1d22') swaps every truss chord +
   *  brace material to that colour. Renderer applies per-frame so the
   *  picker feels live. */
  trussColor: string;
  /** Key light position offset from the venue's baseline. Lets the user
   *  move the sun-like key directional light without rebuilding the
   *  venue. `null` = use venue default. */
  keyPosition: Vec3 | null;
  /** Key light colour override. Empty string = venue default white. */
  keyColor: string;
  /** Master shadow toggle. When false, the renderer disables every
   *  light's castShadow flag so the scene reads flat (no per-fixture
   *  shadow rendering — big perf win on slower GPUs). */
  shadows: boolean;
  /** Strength of the per-screen ambient-light tinting effect: each LED
   *  spawns a PointLight whose colour tracks the average colour of the
   *  screen's content, so the room glows in sync with the visuals.
   *  0 = no influence (lights stay off), 5 = blinding glow. Default 1. */
  screenLightInfluence: number;
}

export const DEFAULT_LIGHTING: Stage3DLighting = {
  roomIntensity: 1,
  floorDarkness: 0,
  screenBoost: 1,
  exposure: 0,
  trussColor: '',
  keyPosition: null,
  keyColor: '',
  shadows: true,
  screenLightInfluence: 1,
};

/** Per-scenery override. The renderer captures each scenery group's
 *  baseline position/rotation/scale at venue build, then applies these
 *  fields on top. `deleted: true` hides the mesh entirely (and skips
 *  it from raycasts so the picker doesn't snag on invisible geometry). */
export interface StageSceneryOverride {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  deleted?: boolean;
}

/** Per-screen-layer 3D transform override. All fields optional — only
 *  set when the user has manually tweaked that aspect. The renderer
 *  merges these on top of the auto-derived defaults. */
export interface Stage3DScreenOverride {
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  /** Visual settings the user can tweak per screen in 3D mode. These
   *  do not affect the underlying screen layer in 2D mapping mode. */
  curvature?: number;
  brightness?: number;
  frameDepth?: number;
  finish?: 'led' | 'projection' | 'clean';
  displayFit?: 'stretch' | 'contain' | 'cover';
  edgeEffect?: 'none' | 'bezel-glow' | 'soft-border' | 'scanlines' | 'pixel-grid';
  /** How source content maps onto a DOME screen (sphere venue only;
   *  ignored on flat-wall venues).
   *  `wrap`       = the source rectangle spreads across the dome's
   *                 lat/long extents (equirect-style, the default —
   *                 flat 16:9 content wraps like the real Sphere),
   *  `domemaster` = source is a 180° angular-fisheye circle (the
   *                 editor's Dome Projection output in angular /
   *                 stereographic / orthographic modes),
   *  `equirect`   = source is a 360° equirectangular panorama (the
   *                 Dome Projection output's equirectangular mode). */
  domeMapping?: 'wrap' | 'domemaster' | 'equirect';
}

export const NEUTRAL_AUDIO_ROUTING: AudioRouting = {
  source: 'none',
  amount: 0,
  smoothing: 0.5,
};

/** Build a fresh empty scene. The empty scene is the fallback when a
 *  user opens the panel without picking a preset; it's also what the
 *  Director gets handed before "generate_stage_from_prompt". */
export function createEmptyScene(name = 'Untitled Stage'): Stage3DScene {
  return {
    id: `stage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    schemaVersion: 1,
    environment: {
      background: '#06060a',
      ambient: 0.4,
      showGround: true,
      groundColor: '#15151b',
    },
    camera: {
      position: [12, 6, 14],
      target: [0, 2, 0],
      fov: 50,
    },
    nodes: [],
    lightingCueId: null,
    basePreset: 'festival',
    venue: 'festival',
    userElements: [],
    lighting: { ...DEFAULT_LIGHTING },
    screenOverrides: {},
  };
}
