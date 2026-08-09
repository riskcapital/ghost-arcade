// Performer Store - Visual Synthesizer State Management
import { writable, get } from 'svelte/store';
import {
  PERFORMER_CLIP_KEYS,
  PERFORMER_CLIP_ROW1,
  PERFORMER_CLIP_ROW2,
  PERFORMER_CLIP_ROW3,
  PERFORMER_CLIP_ROW4,
} from '../keyboard/performerKeyboard';

// 36 SYNTH SHADERS - Full keyboard layout (1-0, Q-P, A-L, Z-M)
// These match the inline GLSL shaders in SynthVision.svelte
export const SV_SHADER_DEFS = [
  // ROW 1: 1-0 (10 shaders) - Keys 1,2,3,4,5,6,7,8,9,0
  { name: 'HYPERSPACE', desc: 'tunnel', file: null, params: [{k:'tunnelR',l:'RADIUS',d:.5},{k:'sides',l:'SIDES',d:.5},{k:'colorShift',l:'COLOR',d:.5}] },
  { name: 'FRACTAL', desc: 'dimension', file: null, params: [{k:'iters',l:'ITERS',d:.5},{k:'scale',l:'SCALE',d:.5},{k:'rotSpd',l:'ROTATE',d:.5}] },
  { name: 'LIQUID', desc: 'metal', file: null, params: [{k:'blobSize',l:'SIZE',d:.5},{k:'turb',l:'TURB',d:.5},{k:'refl',l:'REFLECT',d:.5}] },
  { name: 'ELECTRIC', desc: 'storm', file: null, params: [{k:'intensity',l:'INTENSE',d:.5},{k:'branches',l:'BOLTS',d:.5},{k:'lspd',l:'SPEED',d:.5}] },
  { name: 'HOLO GRID', desc: 'cyber', file: null, params: [{k:'gridD',l:'DENSITY',d:.5},{k:'glowI',l:'GLOW',d:.5},{k:'scanSpd',l:'SCAN',d:.5}] },
  { name: 'NEURAL', desc: 'network', file: null, params: [{k:'nodes',l:'NODES',d:.5},{k:'conn',l:'CONNECT',d:.5},{k:'pulseSpd',l:'PULSE',d:.5}] },
  { name: 'KALEID', desc: 'scope', file: null, params: [{k:'segs',l:'SEGMENTS',d:.5},{k:'depth',l:'DEPTH',d:.5},{k:'rotSpd',l:'ROTATE',d:.5}] },
  { name: 'SACRED', desc: 'geometry', file: null, params: [{k:'shapes',l:'SHAPES',d:.5},{k:'layers',l:'LAYERS',d:.5},{k:'pulseRate',l:'PULSE',d:.5}] },
  { name: 'PULSE', desc: 'wave', file: null, params: [{k:'freq',l:'FREQ',d:.5},{k:'amp',l:'AMP',d:.5},{k:'layers',l:'LAYERS',d:.5}] },
  { name: 'QUANTUM', desc: 'field', file: null, params: [{k:'shells',l:'SHELLS',d:.5},{k:'noise',l:'NOISE',d:.5},{k:'spin',l:'SPIN',d:.5}] },
  // ROW 2: Q-P (10 shaders)
  { name: 'PLASMA', desc: 'reactor', file: null, params: [{k:'cells',l:'CELLS',d:.5},{k:'turb',l:'TURB',d:.5},{k:'glow',l:'GLOW',d:.5}] },
  { name: 'GRAVITY', desc: 'lens', file: null, params: [{k:'strength',l:'STRENGTH',d:.5},{k:'rings',l:'RINGS',d:.5},{k:'warp',l:'WARP',d:.5}] },
  { name: 'VOID', desc: 'tendrils', file: null, params: [{k:'count',l:'COUNT',d:.5},{k:'length',l:'LENGTH',d:.5},{k:'glow',l:'GLOW',d:.5}] },
  { name: 'RIFT', desc: 'dimension', file: null, params: [{k:'layers',l:'LAYERS',d:.5},{k:'twist',l:'TWIST',d:.5},{k:'glow',l:'GLOW',d:.5}] },
  { name: 'PARTICLE', desc: 'storm', file: null, params: [{k:'count',l:'COUNT',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'size',l:'SIZE',d:.5}] },
  { name: 'COSMIC', desc: 'web', file: null, params: [{k:'nodes',l:'NODES',d:.5},{k:'connect',l:'CONNECT',d:.5},{k:'pulse',l:'PULSE',d:.5}] },
  { name: 'DIGITAL', desc: 'rain', file: null, params: [{k:'density',l:'DENSE',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'glow',l:'GLOW',d:.5}] },
  { name: 'SINE', desc: 'field', file: null, params: [{k:'freq',l:'FREQ',d:.5},{k:'amp',l:'AMP',d:.5},{k:'layers',l:'LAYERS',d:.5}] },
  { name: 'NEON', desc: 'rings', file: null, params: [{k:'count',l:'RINGS',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'glow',l:'GLOW',d:.5}] },
  { name: 'CRYSTAL', desc: 'lattice', file: null, params: [{k:'facets',l:'FACETS',d:.5},{k:'refract',l:'REFRACT',d:.5},{k:'glow',l:'GLOW',d:.5}] },
  // ROW 3: A-L (9 shaders)
  { name: 'ORGANIC', desc: 'flow', file: null, params: [{k:'cells',l:'CELLS',d:.5},{k:'flow',l:'FLOW',d:.5},{k:'color',l:'COLOR',d:.5}] },
  { name: 'STARFIELD', desc: 'warp', file: null, params: [{k:'density',l:'STARS',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'depth',l:'DEPTH',d:.5}] },
  { name: 'MORPH', desc: 'shapes', file: null, params: [{k:'shapes',l:'SHAPES',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'blend',l:'BLEND',d:.5}] },
  { name: 'BIOLUM', desc: 'glow', file: null, params: [{k:'cells',l:'CELLS',d:.5},{k:'pulse',l:'PULSE',d:.5},{k:'color',l:'COLOR',d:.5}] },
  { name: 'GLITCH', desc: 'corrupt', file: null, params: [{k:'intensity',l:'INTENSE',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'blocks',l:'BLOCKS',d:.5}] },
  { name: 'PRISM', desc: 'light', file: null, params: [{k:'facets',l:'FACETS',d:.5},{k:'refract',l:'REFRACT',d:.5},{k:'rainbow',l:'RAINBOW',d:.5}] },
  { name: 'NEBULA', desc: 'cloud', file: null, params: [{k:'density',l:'DENSE',d:.5},{k:'turb',l:'TURB',d:.5},{k:'color',l:'COLOR',d:.5}] },
  { name: 'CIRCUIT', desc: 'board', file: null, params: [{k:'lines',l:'LINES',d:.5},{k:'nodes',l:'NODES',d:.5},{k:'pulse',l:'PULSE',d:.5}] },
  { name: 'AURORA', desc: 'waves', file: null, params: [{k:'bands',l:'BANDS',d:.5},{k:'flow',l:'FLOW',d:.5},{k:'color',l:'COLOR',d:.5}] },
  // ROW 4: Z-M (7 shaders)
  { name: 'VORTEX', desc: 'spin', file: null, params: [{k:'arms',l:'ARMS',d:.5},{k:'spin',l:'SPIN',d:.5},{k:'pull',l:'PULL',d:.5}] },
  { name: 'HEX', desc: 'grid', file: null, params: [{k:'scale',l:'SCALE',d:.5},{k:'glow',l:'GLOW',d:.5},{k:'pulse',l:'PULSE',d:.5}] },
  { name: 'FIRE', desc: 'flames', file: null, params: [{k:'intensity',l:'INTENSE',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'color',l:'COLOR',d:.5}] },
  { name: 'WAVE3D', desc: 'surface', file: null, params: [{k:'freq',l:'FREQ',d:.5},{k:'amp',l:'AMP',d:.5},{k:'speed',l:'SPEED',d:.5}] },
  { name: 'SPHERE', desc: 'glow', file: null, params: [{k:'size',l:'SIZE',d:.5},{k:'glow',l:'GLOW',d:.5},{k:'pulse',l:'PULSE',d:.5}] },
  { name: 'BURST', desc: 'radial', file: null, params: [{k:'rays',l:'RAYS',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'glow',l:'GLOW',d:.5}] },
  { name: 'MINIMAL', desc: 'clean', file: null, params: [{k:'shape',l:'SHAPE',d:.5},{k:'size',l:'SIZE',d:.5},{k:'color',l:'COLOR',d:.5}] }
] as const;

// Get the ISF shader filename for a given shader index
export function getSynthShaderFile(shaderIdx: number): string | undefined {
  const def = SV_SHADER_DEFS[shaderIdx];
  return def?.file ?? undefined;
}

export const SV_SHADERS = SV_SHADER_DEFS.map(s => s.name);

// Per-shader parameter values (stored per shader index)
export type ShaderParams = { [key: string]: number };
export const defaultShaderParams = (shaderIdx: number): ShaderParams => {
  const def = SV_SHADER_DEFS[shaderIdx];
  if (!def) return {};
  const params: ShaderParams = {};
  def.params.forEach(p => { params[p.k] = p.d; });
  return params;
};

export const SV_STYLES = ['NEON','MONO','OUTLINE','LOWPOLY','CHROME','VOID','HOLO','EMBER'];
export const SV_SPACES = ['ORBIT','FLY','LANDSCAPE','TUNNEL','ZERO-G','FALL'];
export const SV_WORLDS = ['PARTICLES','CUBES','FRACTAL','TERRAIN','NODES','FLUID','CRYSTAL','VORTEX','STARFIELD','ORGANISM','AURORA','DNA','SWARM','RINGS'];
export const SV_BLEND_NAMES = ['ADD','SUB','MULT','NORM'];

// 3D World parameters - 6 params for each world type
export const SV_WORLD_DEFS = [
  { name: 'PARTICLES', params: [{k:'count',l:'COUNT',d:.5},{k:'size',l:'SIZE',d:.4},{k:'spread',l:'SPREAD',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'trail',l:'TRAIL',d:.3},{k:'gravity',l:'GRAVITY',d:.2}] },
  { name: 'CUBES', params: [{k:'count',l:'COUNT',d:.5},{k:'size',l:'SIZE',d:.5},{k:'spacing',l:'SPACE',d:.5},{k:'rotate',l:'ROTATE',d:.5},{k:'explode',l:'EXPLODE',d:.3},{k:'thick',l:'THICK',d:.45}] },
  { name: 'FRACTAL', params: [{k:'depth',l:'DEPTH',d:.5},{k:'scale',l:'SCALE',d:.5},{k:'twist',l:'TWIST',d:.3},{k:'branch',l:'BRANCH',d:.5},{k:'glow',l:'GLOW',d:.4},{k:'animate',l:'ANIMATE',d:.5}] },
  { name: 'TERRAIN', params: [{k:'height',l:'HEIGHT',d:.5},{k:'detail',l:'DETAIL',d:.5},{k:'water',l:'WATER',d:.3},{k:'erosion',l:'EROSION',d:.4},{k:'fog',l:'FOG',d:.3},{k:'sun',l:'SUN',d:.6}] },
  { name: 'NODES', params: [{k:'count',l:'COUNT',d:.5},{k:'connect',l:'CONNECT',d:.6},{k:'pulse',l:'PULSE',d:.5},{k:'attract',l:'ATTRACT',d:.4},{k:'thick',l:'THICK',d:.3},{k:'glow',l:'GLOW',d:.5}] },
  { name: 'FLUID', params: [{k:'viscosity',l:'VISCOUS',d:.5},{k:'turbulence',l:'TURB',d:.5},{k:'density',l:'DENSE',d:.5},{k:'color',l:'COLOR',d:.5},{k:'flow',l:'FLOW',d:.5},{k:'splash',l:'SPLASH',d:.3}] },
  { name: 'CRYSTAL', params: [{k:'facets',l:'FACETS',d:.5},{k:'size',l:'SIZE',d:.5},{k:'thick',l:'THICK',d:.55},{k:'cluster',l:'CLUSTER',d:.4},{k:'glow',l:'GLOW',d:.5},{k:'rotate',l:'ROTATE',d:.3}] },
  { name: 'VORTEX', params: [{k:'arms',l:'ARMS',d:.5},{k:'spin',l:'SPIN',d:.5},{k:'pull',l:'PULL',d:.5},{k:'depth',l:'DEPTH',d:.5},{k:'particles',l:'PARTS',d:.4},{k:'color',l:'COLOR',d:.5}] },
  { name: 'STARFIELD', params: [{k:'density',l:'DENSE',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'size',l:'SIZE',d:.4},{k:'depth',l:'DEPTH',d:.6},{k:'nebula',l:'NEBULA',d:.3},{k:'twinkle',l:'TWINKLE',d:.5}] },
  { name: 'ORGANISM', params: [{k:'cells',l:'CELLS',d:.5},{k:'pulse',l:'PULSE',d:.5},{k:'branch',l:'BRANCH',d:.5},{k:'color',l:'COLOR',d:.5},{k:'flow',l:'FLOW',d:.4},{k:'mutate',l:'MUTATE',d:.3}] },
  { name: 'AURORA', params: [{k:'ribbons',l:'RIBBONS',d:.5},{k:'height',l:'HEIGHT',d:.5},{k:'wave',l:'WAVE',d:.5},{k:'shimmer',l:'SHIMMER',d:.5},{k:'color',l:'COLOR',d:.4},{k:'spread',l:'SPREAD',d:.5}] },
  { name: 'DNA', params: [{k:'twist',l:'TWIST',d:.5},{k:'rungs',l:'RUNGS',d:.5},{k:'radius',l:'RADIUS',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'glow',l:'GLOW',d:.4},{k:'pairs',l:'PAIRS',d:.5}] },
  { name: 'SWARM', params: [{k:'count',l:'COUNT',d:.5},{k:'cohesion',l:'COHESION',d:.5},{k:'speed',l:'SPEED',d:.5},{k:'scatter',l:'SCATTER',d:.4},{k:'trail',l:'TRAIL',d:.3},{k:'color',l:'COLOR',d:.5}] },
  { name: 'RINGS', params: [{k:'count',l:'COUNT',d:.5},{k:'radius',l:'RADIUS',d:.5},{k:'spin',l:'SPIN',d:.5},{k:'tilt',l:'TILT',d:.4},{k:'gap',l:'GAP',d:.5},{k:'thick',l:'THICK',d:.5}] }
] as const;

export type WorldParams = { [key: string]: number };
export const defaultWorldParams = (worldIdx: number): WorldParams => {
  const def = SV_WORLD_DEFS[worldIdx];
  if (!def) return {};
  const params: WorldParams = {};
  def.params.forEach(p => { params[p.k] = p.d; });
  return params;
};

// Camera blend modes (maps to canvas globalCompositeOperation)
export const SV_CAM_BLENDS = [
  { id: 0, name: 'ADD', op: 'lighter' },
  { id: 1, name: 'MULTIPLY', op: 'multiply' },
  { id: 2, name: 'SCREEN', op: 'screen' },
  { id: 3, name: 'OVERLAY', op: 'overlay' },
  { id: 4, name: 'DIFFERENCE', op: 'difference' },
  { id: 5, name: 'NORMAL', op: 'source-over' },
] as const;

// Spacebar trigger effects - spectacular visual bursts with easing
export const SV_SPACE_FX = [
  { id: 'pump', name: 'PUMP', desc: 'Classic beat pulse' },
  { id: 'shockwave', name: 'SHOCKWAVE', desc: 'Expanding ring ripple' },
  { id: 'flash', name: 'FLASH', desc: 'Bright strobe burst' },
  { id: 'zoom', name: 'ZOOM BURST', desc: 'Rapid zoom in/out' },
  { id: 'twist', name: 'TWIST', desc: 'Spiral rotation burst' },
  { id: 'glitch', name: 'GLITCH', desc: 'Digital corruption' },
  { id: 'scatter', name: 'SCATTER', desc: '3D particle explosion' },
  { id: 'chromatic', name: 'CHROMATIC', desc: 'RGB split burst' },
  { id: 'strobe', name: 'STROBE', desc: 'Rapid black/white flash' },
  { id: 'ripple', name: 'RIPPLE', desc: 'Concentric wave rings' },
  { id: 'pixelate', name: 'PIXELATE', desc: 'Mosaic breakdown' },
  { id: 'invert', name: 'INVERT', desc: 'Color inversion pulse' }
] as const;

export type SVSpaceFxId = typeof SV_SPACE_FX[number]['id'];

// Camera feed visual modes - reactive to camera input (generates visuals, not feeds camera)
export const SV_CAM_MODES = [
  { id: 'direct', name: 'DIRECT', desc: 'Clean camera feed' },
  { id: 'lofi', name: 'LO-FI', desc: 'Pixelated VHS glitch' },
  { id: 'thermal', name: 'THERMAL', desc: 'Heat vision colors' },
  { id: 'edge', name: 'EDGE DETECT', desc: 'Neon outlines' },
  { id: 'particles', name: 'MOTION PARTICLES', desc: 'Particles spawn from motion' },
  { id: 'ascii', name: 'ASCII', desc: 'Text character render' },
  { id: 'liquid', name: 'LIQUID FLOW', desc: 'Motion creates flowing water' },
  { id: 'lava', name: 'LAVA LAMP', desc: 'Rising blobs react to motion' },
  { id: 'mirror', name: 'KALEID', desc: 'Kaleidoscope mirror' },
  { id: 'dna', name: 'DNA HELIX', desc: 'Double helix follows motion' },
  { id: 'datamosh', name: 'DATAMOSH', desc: 'Glitchy compression' },
  { id: 'silhouette', name: 'SILHOUETTE', desc: 'Body outline only' }
] as const;

export type SVCamModeId = typeof SV_CAM_MODES[number]['id'];

// Keyboard clip mapping - full keyboard layout
export const SV_CLIP_ROW1 = PERFORMER_CLIP_ROW1;
export const SV_CLIP_ROW2 = PERFORMER_CLIP_ROW2;
export const SV_CLIP_ROW3 = PERFORMER_CLIP_ROW3;
export const SV_CLIP_ROW4 = PERFORMER_CLIP_ROW4;
export const SV_ALL_CLIPS = PERFORMER_CLIP_KEYS;

export const SV_PARAMS = [
  {k:'chaos',l:'CHAOS'},{k:'speed',l:'SPEED'},{k:'zoom',l:'ZOOM'},{k:'color',l:'COLOR'},
  {k:'glow',l:'GLOW'},{k:'warp',l:'WARP'},{k:'mirror',l:'MIRROR'},{k:'feedback',l:'FEEDBK'},{k:'lofi',l:'LOFI'}
] as const;

export type SVParamKey = typeof SV_PARAMS[number]['k'];

export interface SVParams {
  chaos: number;
  speed: number;
  zoom: number;
  color: number;
  glow: number;
  warp: number;
  mirror: number;
  feedback: number;
  lofi: number;
}

export interface SVLayer {
  sh: number;      // shader index (0-23)
  style: number;   // style index
  space: number;   // camera space index
  world: number;   // 3D world index
  blend: number;   // blend mode index
  p: SVParams;     // parameters
}

export type SVReactivityMode = 'off' | 'smooth' | 'default' | 'aggressive';
export const SV_REACTIVITY_MODES: { id: SVReactivityMode; label: string; description: string }[] = [
  { id: 'off',        label: 'OFF',        description: 'Audio silent — visuals run on their own.' },
  { id: 'smooth',     label: 'SMOOTH',     description: 'Milkdrop-style smoothed normalized bass. Elegant, no woofer pulse.' },
  { id: 'default',    label: 'DEFAULT',    description: 'Smooth + onset envelopes for accent moments (kick/snare punches).' },
  { id: 'aggressive', label: 'AGGRESSIVE', description: 'Smooth + envelopes + BPM LFOs. Lively but busier.' },
];

export interface SVState {
  active: boolean;         // is synth vision open/running
  keyboardActive: boolean; // visible performer owns its displayed keyboard controls
  assignedLayer: number | null;  // VJ layer index it's assigned to
  layers: { a: SVLayer; b: SVLayer };
  focus: 'a' | 'b';
  xfade: number;           // 0=full A, 1=full B
  bpm: number;
  bp: number;              // beat phase 0-1
  lastBeat: number;
  bpmSync: boolean;
  mx: number;              // mouse x 0-1
  my: number;              // mouse y 0-1
  mDown: boolean;
  mic: boolean;
  micLevel: number;
  bass: number;
  // ── Audio reactivity smoothness ────────────────────────────────
  // 'off'        — no audio drives anything; bass stays 0
  // 'smooth'     — default. Bass tracks the Milkdrop bass_att
  //                (asymmetric IIR over a long-baseline-normalized
  //                ratio). No woofer-style back-and-forth.
  // 'default'    — smoothed bass + onset envelopes for accents
  //                (kick/snare fire a 30→350ms ADSR envelope).
  // 'aggressive' — raw Milkdrop bass + envelopes + LFOs; lively
  //                but can feel busier than smooth.
  reactivityMode: SVReactivityMode;
  // Live audio-reactive values, populated by the follower each
  // frame. World code can read these directly for richer reactivity
  // without going through bass. See `audio/milkdropFollower.ts`.
  // All values are post-smoothing, normalized.
  kickEnv: number;     // 0→1 envelope, fires on kick onset
  snareEnv: number;    // 0→1 envelope, fires on snare onset
  midPulse: number;    // smoothed mid (bass_att-equivalent for mids)
  trebShimmer: number; // smoothed treble (for highlight/twinkle)
  centroidHue: number; // smoothed centroid 0→1 for hue offset
  lfoBeat: number;     // BPM-locked sine, 0→1, one cycle per beat
  cam: boolean;
  time: number;
  pump: number;
  invert: boolean;
  blackout: number;
  whiteout: number;
  drift: boolean;
  driftTarget: SVParams | null;
  driftSpeed: number;
  driftTimer: number;
  driftInterval: number;
  autoMode: boolean;
  autoTimer: number;
  autoInterval: number;
  rndLocks: { shader: boolean; style: boolean; world: boolean; params: boolean; space: boolean };
  selParam: number;        // selected param index for keyboard
  // Spacebar trigger effect system
  spaceFx: SVSpaceFxId;    // which effect spacebar triggers
  fxIntensity: number;     // 0-1 current effect intensity (decays over time)
  fxShockwave: number;     // 0-1 shockwave radius
  fxTwist: number;         // twist angle
  fxChromatic: number;     // chromatic aberration amount
  fxPixelate: number;      // pixelation amount
  fxStrobe: number;        // strobe flash
  // Camera system - now used as DATA INPUT to shaders
  camMode: SVCamModeId;    // current camera visual mode
  camActive: boolean;      // is camera streaming
  camBlend: number;        // camera blend mode index (0=add, 1=multiply, 2=screen, 3=overlay, 4=normal)
  camOpacity: number;      // camera layer opacity 0-1
  // Camera data extracted for driving shaders (not displaying feed)
  camMotion: number;       // 0-1 motion intensity from frame diff
  camBrightness: number;   // 0-1 average brightness
  camEdge: number;         // 0-1 edge density
  camFlowX: number;        // -1 to 1 horizontal motion vector
  camFlowY: number;        // -1 to 1 vertical motion vector
  camPresence: number;     // 0-1 how much of frame has movement (body detection proxy)
  // Per-shader parameters (stored per shader index)
  shaderParams: ShaderParams[];  // 36 entries, one per shader
  // Per-world parameters (stored per world index)
  worldParams: WorldParams[];    // 14 entries, one per world
  // UI state
  paramTab: 'effects' | 'shader' | 'world';  // which tab is active in the params section
  // Splash screen — shown on startup until first interaction
  showSplash: boolean;
}

function defaultParams(): SVParams {
  return { chaos: .3, speed: .5, zoom: .5, color: .5, glow: .4, warp: 0, mirror: 0, feedback: .1, lofi: 0 };
}

function defaultLayer(sh: number, world: number): SVLayer {
  return { sh, style: 0, space: 0, world, blend: 0, p: defaultParams() };
}

function createDefaultState(): SVState {
  return {
    active: false,
    keyboardActive: false,
    assignedLayer: null,
    layers: { a: defaultLayer(0, 0), b: defaultLayer(1, 1) },
    focus: 'a',
    xfade: 0,
    bpm: 120,
    bp: 0,
    lastBeat: 0,
    bpmSync: false,
    mx: .5,
    my: .5,
    mDown: false,
    mic: false,
    micLevel: 0,
    bass: 0,
    reactivityMode: 'smooth',
    kickEnv: 0,
    snareEnv: 0,
    midPulse: 0,
    trebShimmer: 0,
    centroidHue: 0,
    lfoBeat: 0,
    cam: false,
    time: 0,
    pump: 0,
    invert: false,
    blackout: 0,
    whiteout: 0,
    drift: false,
    driftTarget: null,
    driftSpeed: .3,
    driftTimer: 0,
    driftInterval: 4,
    autoMode: false,
    autoTimer: 0,
    autoInterval: 8,
    rndLocks: { shader: true, style: true, world: true, params: true, space: true },
    selParam: 0,
    // Spacebar effect system
    spaceFx: 'pump',
    fxIntensity: 0,
    fxShockwave: 0,
    fxTwist: 0,
    fxChromatic: 0,
    fxPixelate: 0,
    fxStrobe: 0,
    // Camera system - data input
    camMode: 'direct',
    camActive: false,
    camBlend: 0,      // 0=add
    camOpacity: 0.8,
    // Camera extracted data (drives shaders)
    camMotion: 0,
    camBrightness: 0.5,
    camEdge: 0,
    camFlowX: 0,
    camFlowY: 0,
    camPresence: 0,
    // Per-shader params (36 shaders now)
    shaderParams: Array.from({ length: 36 }, (_, i) => defaultShaderParams(i)),
    // Per-world params (10 worlds)
    worldParams: Array.from({ length: 14 }, (_, i) => defaultWorldParams(i)),
    // UI
    paramTab: 'effects',
    // Splash screen shown on startup
    showSplash: true,
  };
}

function createSynthVisionStore() {
  const { subscribe, update, set } = writable<SVState>(createDefaultState());

  return {
    subscribe,
    set,
    update,
    get: () => get({ subscribe }),

    activate: () => update(s => ({ ...s, active: true })),
    deactivate: () => update(s => ({ ...s, active: false, keyboardActive: false })),
    setKeyboardActive: (keyboardActive: boolean) => update(s => (
      s.keyboardActive === keyboardActive ? s : { ...s, keyboardActive }
    )),

    setAssignedLayer: (layerIdx: number | null) => update(s => ({ ...s, assignedLayer: layerIdx })),

    // Focus
    setFocus: (f: 'a' | 'b') => update(s => ({ ...s, focus: f })),
    toggleFocus: () => update(s => ({ ...s, focus: s.focus === 'a' ? 'b' : 'a' })),

    // Active layer helper
    activeLayer: (): SVLayer => {
      const s = get({ subscribe });
      return s.layers[s.focus];
    },

    // Fire clip on focused layer
    fireClip: (shaderIdx: number) => update(s => {
      const newLayers = { ...s.layers };
      newLayers[s.focus] = { ...newLayers[s.focus], sh: shaderIdx };
      return { ...s, layers: newLayers };
    }),

    // Set param on focused layer
    setParam: (key: SVParamKey, value: number) => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus], p: { ...newLayers[s.focus].p } };
      l.p[key] = Math.max(0, Math.min(1, value));
      newLayers[s.focus] = l;
      return { ...s, layers: newLayers };
    }),

    nudgeParam: (key: SVParamKey, delta: number) => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus], p: { ...newLayers[s.focus].p } };
      l.p[key] = Math.max(0, Math.min(1, l.p[key] + delta));
      newLayers[s.focus] = l;
      return { ...s, layers: newLayers };
    }),

    // Style / Space / World
    cycleStyle: (d: number) => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus] };
      l.style = ((l.style + d) % SV_STYLES.length + SV_STYLES.length) % SV_STYLES.length;
      newLayers[s.focus] = l;
      return { ...s, layers: newLayers };
    }),

    cycleSpace: (d: number) => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus] };
      l.space = ((l.space + d) % SV_SPACES.length + SV_SPACES.length) % SV_SPACES.length;
      newLayers[s.focus] = l;
      return { ...s, layers: newLayers };
    }),

    cycleWorld: (d: number) => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus] };
      l.world = ((l.world + d) % SV_WORLDS.length + SV_WORLDS.length) % SV_WORLDS.length;
      newLayers[s.focus] = l;
      return { ...s, layers: newLayers };
    }),

    setWorld: (idx: number) => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus] };
      l.world = idx;
      newLayers[s.focus] = l;
      return { ...s, layers: newLayers };
    }),

    cycleBlend: (layer: 'a' | 'b') => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[layer] };
      l.blend = (l.blend + 1) % SV_BLEND_NAMES.length;
      newLayers[layer] = l;
      return { ...s, layers: newLayers };
    }),

    // Crossfader
    setXfade: (v: number) => update(s => ({ ...s, xfade: Math.max(0, Math.min(1, v)) })),
    nudgeXfade: (d: number) => update(s => ({ ...s, xfade: Math.max(0, Math.min(1, s.xfade + d)) })),

    // BPM
    setBpm: (v: number) => update(s => ({ ...s, bpm: Math.max(40, Math.min(300, v)) })),
    setReactivityMode: (m: SVReactivityMode) => update(s => ({ ...s, reactivityMode: m })),
    nudgeBpm: (d: number) => update(s => ({ ...s, bpm: Math.max(40, Math.min(300, s.bpm + d)) })),
    toggleSync: () => update(s => ({ ...s, bpmSync: !s.bpmSync })),

    // Actions
    doPump: () => update(s => ({ ...s, pump: 1 })),
    doGlitch: () => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus], p: { ...newLayers[s.focus].p } };
      l.p.warp = Math.min(1, l.p.warp + .3);
      newLayers[s.focus] = l;
      setTimeout(() => {
        update(s2 => {
          const nl = { ...s2.layers };
          const ll = { ...nl[s2.focus], p: { ...nl[s2.focus].p } };
          ll.p.warp = Math.max(0, ll.p.warp - .3);
          nl[s2.focus] = ll;
          return { ...s2, layers: nl };
        });
      }, 200);
      return { ...s, pump: .5, layers: newLayers };
    }),
    doBlackout: () => update(s => ({ ...s, blackout: s.blackout > .5 ? 0 : 1 })),
    doWhiteout: () => update(s => ({ ...s, whiteout: s.whiteout > .5 ? 0 : 1 })),
    toggleInvert: () => update(s => ({ ...s, invert: !s.invert })),

    // Drift & Auto
    toggleDrift: () => update(s => {
      if (s.drift) return { ...s, drift: false, driftTarget: null };
      const target = defaultParams();
      for (const p of SV_PARAMS) (target as any)[p.k] = Math.random();
      return { ...s, drift: true, driftTarget: target, driftTimer: 0 };
    }),
    toggleAuto: () => update(s => ({ ...s, autoMode: !s.autoMode, autoTimer: 0 })),

    // Random locks
    toggleRndLock: (k: keyof SVState['rndLocks']) => update(s => ({
      ...s, rndLocks: { ...s.rndLocks, [k]: !s.rndLocks[k] }
    })),

    // Random
    doRandom: () => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus], p: { ...newLayers[s.focus].p } };
      if (s.rndLocks.shader) l.sh = Math.floor(Math.random() * 36);
      if (s.rndLocks.style) l.style = Math.floor(Math.random() * SV_STYLES.length);
      if (s.rndLocks.space) l.space = Math.floor(Math.random() * SV_SPACES.length);
      if (s.rndLocks.world) l.world = Math.floor(Math.random() * SV_WORLDS.length);
      if (s.rndLocks.params) for (const p of SV_PARAMS) (l.p as any)[p.k] = Math.random();
      newLayers[s.focus] = l;
      return { ...s, layers: newLayers };
    }),

    // Select param
    setSelParam: (idx: number) => update(s => ({ ...s, selParam: idx })),
    cycleSelParam: () => update(s => ({ ...s, selParam: (s.selParam + 1) % SV_PARAMS.length })),

    // Mouse
    setMouse: (x: number, y: number) => update(s => ({ ...s, mx: x, my: y })),
    setMouseDown: (v: boolean) => update(s => ({ ...s, mDown: v })),

    // Mic / Cam
    toggleMic: () => update(s => ({ ...s, mic: !s.mic })),
    toggleCam: () => update(s => ({ ...s, cam: !s.cam })),

    // Spacebar effect system
    setSpaceFx: (fx: SVSpaceFxId) => update(s => ({ ...s, spaceFx: fx })),
    cycleSpaceFx: (d: number) => update(s => {
      const idx = SV_SPACE_FX.findIndex(f => f.id === s.spaceFx);
      const newIdx = ((idx + d) % SV_SPACE_FX.length + SV_SPACE_FX.length) % SV_SPACE_FX.length;
      return { ...s, spaceFx: SV_SPACE_FX[newIdx].id };
    }),

    // Trigger the selected spacebar effect with easing
    triggerSpaceFx: () => update(s => {
      const base = { ...s, fxIntensity: 1 };
      switch (s.spaceFx) {
        case 'pump': return { ...base, pump: 1 };
        case 'shockwave': return { ...base, fxShockwave: 0.01 }; // starts small, expands
        case 'flash': return { ...base, whiteout: 1 };
        case 'zoom': return { ...base, pump: 1.5 }; // extra strong pump
        case 'twist': return { ...base, fxTwist: 1 };
        case 'glitch': return { ...base, fxPixelate: 0.8, fxChromatic: 0.5 };
        case 'scatter': return { ...base, pump: 1, fxShockwave: 0.01 };
        case 'chromatic': return { ...base, fxChromatic: 1 };
        case 'strobe': return { ...base, fxStrobe: 1 };
        case 'ripple': return { ...base, fxShockwave: 0.01, fxTwist: 0.3 };
        case 'pixelate': return { ...base, fxPixelate: 1 };
        case 'invert': return { ...base, invert: !s.invert };
        default: return { ...base, pump: 1 };
      }
    }),

    // Decay effects over time (call in render loop)
    decayEffects: (dt: number) => update(s => {
      // Clamp dt to avoid huge values on first frame or after tab switch
      const safeDt = Math.max(0, Math.min(0.1, dt));
      const decay = safeDt * 3; // decay rate
      const fastDecay = safeDt * 8;
      return {
        ...s,
        pump: Math.max(0, Math.min(1, s.pump - decay)),
        fxIntensity: Math.max(0, Math.min(1, s.fxIntensity - decay)),
        fxShockwave: s.fxShockwave > 0 ? Math.min(2, s.fxShockwave + safeDt * 2) : 0, // expands then stops
        fxTwist: Math.max(0, Math.min(1, s.fxTwist - decay)),
        fxChromatic: Math.max(0, Math.min(1, s.fxChromatic - decay)),
        fxPixelate: Math.max(0, Math.min(1, s.fxPixelate - fastDecay)),
        fxStrobe: s.fxStrobe > 0 ? (s.fxStrobe > 0.5 ? 0.3 : 0) : 0, // quick on/off
        whiteout: Math.max(0, Math.min(1, s.whiteout - fastDecay)),
        blackout: Math.max(0, Math.min(1, s.blackout - fastDecay)),
      };
    }),

    // Camera system
    setCamMode: (mode: SVCamModeId) => update(s => ({ ...s, camMode: mode })),
    cycleCamMode: (d: number) => update(s => {
      const idx = SV_CAM_MODES.findIndex(m => m.id === s.camMode);
      const newIdx = ((idx + d) % SV_CAM_MODES.length + SV_CAM_MODES.length) % SV_CAM_MODES.length;
      return { ...s, camMode: SV_CAM_MODES[newIdx].id };
    }),
    toggleCamActive: () => update(s => ({ ...s, camActive: !s.camActive })),
    setCamActive: (active: boolean) => update(s => ({ ...s, camActive: active })),
    cycleCamBlend: (d: number) => update(s => {
      const newIdx = ((s.camBlend + d) % SV_CAM_BLENDS.length + SV_CAM_BLENDS.length) % SV_CAM_BLENDS.length;
      return { ...s, camBlend: newIdx };
    }),
    setCamBlend: (idx: number) => update(s => ({ ...s, camBlend: idx })),
    setCamOpacity: (v: number) => update(s => ({ ...s, camOpacity: Math.max(0, Math.min(1, v)) })),

    // Camera data update (from video analysis)
    updateCamData: (data: {
      motion?: number;
      brightness?: number;
      edge?: number;
      flowX?: number;
      flowY?: number;
      presence?: number;
    }) => update(s => ({
      ...s,
      camMotion: data.motion ?? s.camMotion,
      camBrightness: data.brightness ?? s.camBrightness,
      camEdge: data.edge ?? s.camEdge,
      camFlowX: data.flowX ?? s.camFlowX,
      camFlowY: data.flowY ?? s.camFlowY,
      camPresence: data.presence ?? s.camPresence,
    })),

    // Per-shader parameters
    setShaderParam: (shaderIdx: number, paramKey: string, value: number) => update(s => {
      const newParams = [...s.shaderParams];
      newParams[shaderIdx] = { ...newParams[shaderIdx], [paramKey]: Math.max(0, Math.min(1, value)) };
      return { ...s, shaderParams: newParams };
    }),
    getShaderParams: (shaderIdx: number) => {
      const s = get({ subscribe });
      return s.shaderParams[shaderIdx] || {};
    },

    // Per-world parameters
    setWorldParam: (worldIdx: number, paramKey: string, value: number) => update(s => {
      const newParams = [...s.worldParams];
      newParams[worldIdx] = { ...newParams[worldIdx], [paramKey]: Math.max(0, Math.min(1, value)) };
      return { ...s, worldParams: newParams };
    }),
    getWorldParams: (worldIdx: number) => {
      const s = get({ subscribe });
      return s.worldParams[worldIdx] || {};
    },

    // UI tab toggle
    setParamTab: (tab: 'effects' | 'shader' | 'world') => update(s => ({ ...s, paramTab: tab })),

    // Full random - randomizes everything (shader, world, style, space, global params, world params)
    doFullRandom: () => update(s => {
      const newLayers = { ...s.layers };
      const l = { ...newLayers[s.focus], p: { ...newLayers[s.focus].p } };

      // Random shader (0-35)
      l.sh = Math.floor(Math.random() * 36);
      // Random world
      l.world = Math.floor(Math.random() * SV_WORLDS.length);
      // Random style
      l.style = Math.floor(Math.random() * SV_STYLES.length);
      // Random space
      l.space = Math.floor(Math.random() * SV_SPACES.length);
      // Random global params
      for (const p of SV_PARAMS) (l.p as any)[p.k] = Math.random();

      newLayers[s.focus] = l;

      // Also randomize world params for current world
      const newWorldParams = [...s.worldParams];
      const worldDef = SV_WORLD_DEFS[l.world];
      if (worldDef) {
        const wp: WorldParams = {};
        worldDef.params.forEach(p => { wp[p.k] = Math.random(); });
        newWorldParams[l.world] = wp;
      }

      return { ...s, layers: newLayers, worldParams: newWorldParams };
    }),

    // Reset
    reset: () => set(createDefaultState()),

    // Get serializable snapshot for saving with composition
    getSerializable: () => {
      const s = get({ subscribe });
      // Only save the performance-relevant settings, not runtime state
      return {
        layers: s.layers,
        xfade: s.xfade,
        bpm: s.bpm,
        bpmSync: s.bpmSync,
        drift: s.drift,
        driftSpeed: s.driftSpeed,
        driftInterval: s.driftInterval,
        autoMode: s.autoMode,
        autoInterval: s.autoInterval,
        rndLocks: s.rndLocks,
        spaceFx: s.spaceFx,
        camMode: s.camMode,
        camBlend: s.camBlend,
        camOpacity: s.camOpacity,
        shaderParams: s.shaderParams,
        worldParams: s.worldParams,
      };
    },

    // Load serialized state from composition
    loadSerializable: (data: any) => {
      if (!data) return;
      update(s => ({
        ...s,
        layers: data.layers ?? s.layers,
        xfade: data.xfade ?? s.xfade,
        bpm: data.bpm ?? s.bpm,
        bpmSync: data.bpmSync ?? s.bpmSync,
        drift: data.drift ?? s.drift,
        driftSpeed: data.driftSpeed ?? s.driftSpeed,
        driftInterval: data.driftInterval ?? s.driftInterval,
        autoMode: data.autoMode ?? s.autoMode,
        autoInterval: data.autoInterval ?? s.autoInterval,
        rndLocks: data.rndLocks ?? s.rndLocks,
        spaceFx: data.spaceFx ?? s.spaceFx,
        camMode: data.camMode ?? s.camMode,
        camBlend: data.camBlend ?? s.camBlend,
        camOpacity: data.camOpacity ?? s.camOpacity,
        shaderParams: data.shaderParams ?? s.shaderParams,
        worldParams: data.worldParams ?? s.worldParams,
      }));
    },
  };
}

export const synthVisionStore = createSynthVisionStore();

// ─── Session-Level Clip Assignment Cache ─────────────────────────
// Persists performer clip assignments in memory across SynthVision component
// mount/unmount cycles (e.g., toggling VJ mode on/off). Lost on app restart.
import type { SVClipAssignment } from '../types';

let _sessionClipAssignments: Record<number, SVClipAssignment> | null = null;
let _sessionActivePresetId: string | null = null;
let _sessionDirty = false; // true if assignments changed since last preset save/load
let _sessionAssignedVJLayer: number = 0;

export const sessionClipCache = {
  /** Save current clip assignments to session cache */
  save(assignments: Record<number, SVClipAssignment>, activePresetId: string | null, dirty: boolean, assignedVJLayer: number = 0) {
    _sessionClipAssignments = JSON.parse(JSON.stringify(assignments));
    _sessionActivePresetId = activePresetId;
    _sessionDirty = dirty;
    _sessionAssignedVJLayer = assignedVJLayer;
  },

  /** Restore clip assignments from session cache (returns null if nothing cached) */
  restore(): { assignments: Record<number, SVClipAssignment>; activePresetId: string | null; dirty: boolean; assignedVJLayer: number } | null {
    if (!_sessionClipAssignments) return null;
    return {
      assignments: JSON.parse(JSON.stringify(_sessionClipAssignments)),
      activePresetId: _sessionActivePresetId,
      dirty: _sessionDirty,
      assignedVJLayer: _sessionAssignedVJLayer,
    };
  },

  /** Check if there are unsaved changes in the session cache */
  hasUnsavedChanges(): boolean {
    return _sessionDirty && _sessionClipAssignments !== null && Object.keys(_sessionClipAssignments).length > 0;
  },

  /** Clear the session cache */
  clear() {
    _sessionClipAssignments = null;
    _sessionActivePresetId = null;
    _sessionDirty = false;
    _sessionAssignedVJLayer = 0;
  },
};

// ─── Module-Level ISF Shader Cache ───────────────────────────────
// Persists loaded ISF shader data across SynthVision mount/unmount cycles
// so we don't re-fetch 274 shaders every time the performer is opened.
export type CachedShaderEntry = {
  id: string;
  name: string;
  src: string;
  shaderCode: string;
  thumbnail?: string;
  manifestDefaults?: Record<string, any>;
};

let _cachedISFShaders: CachedShaderEntry[] | null = null;

export const isfShaderCache = {
  get(): CachedShaderEntry[] | null {
    return _cachedISFShaders;
  },
  set(shaders: CachedShaderEntry[]) {
    _cachedISFShaders = shaders;
  },
  clear() {
    _cachedISFShaders = null;
  },
};
