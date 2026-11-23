/**
 * Engine voices: the render core's audio-reactive instruments as Audio Lab
 * visuals. An engine voice is a studio voice whose `file` is `engine:<id>`
 * instead of a VX shader. Everything a VX voice does works the same way: the
 * picker, following a sound, clip stacks, blend, order, level, mute, auto-mix,
 * knobs and drift.
 *
 * How it renders: the voice becomes a hidden `gpu` layer whose shader id is
 * the instrument, so the core draws its graph into that layer's frame and
 * the studio's mix samples it as one row, exactly as it samples a VX voice's
 * layer. The layer carries `audioSource` (the sound it follows), and the core
 * gives it that sound's own audio packet (voiceSourceAudio.ts).
 *
 * Controls: the instrument's manifest `param_defs` become an ISF-style input
 * list (`engineVoiceCode`), so the rack's knobs and drift read them like any
 * shader's. Sliders become float inputs and selects become indexed inputs;
 * controls that rebuild the simulation (quality, the scan file) are left
 * out, and colours and the Trigger button keep their defaults. A cloud voice
 * with no scan uses the small default scan the core ships.
 *
 * Instruments are native-only: without the core (or before its manifest
 * arrives) a voice draws a plain placeholder instead.
 */
import { get } from 'svelte/store';
import { audioReactiveInstrumentsAvailable } from '../plugins/addons';
import { nativeGraphParamDefs } from '../renderer/manifestParams';
import type { ParamControl } from '../renderer/gpuShaderTypes';
import { createDefaultGPULayerContent, createLayer, type Layer } from '../types';

export const ENGINE_VOICE_PREFIX = 'engine:';

/**
 * A cloud voice's own scan: a .ply the user picked (the main process granted
 * it then). Saved as an asset ref so a reopened project grants it again.
 */
export interface EngineScan {
  type: 'file';
  name: string;
  assetRef: { kind: 'local-file'; originalPath: string; name: string };
}

export function engineScanFromPath(path: string): EngineScan {
  const name = path.split(/[\\/]/).pop() || path;
  return { type: 'file', name, assetRef: { kind: 'local-file', originalPath: path, name } };
}

/** A saved scan, or undefined when it is not a usable .ply reference. */
export function normalizeEngineScan(raw: unknown): EngineScan | undefined {
  const ref = (raw as { assetRef?: { originalPath?: unknown } } | null)?.assetRef;
  const path = ref?.originalPath;
  if (typeof path !== 'string' || path.length > 4096 || !/\.ply$/i.test(path)) return undefined;
  return engineScanFromPath(path);
}

export interface EngineInstrument {
  id: string;
  name: string;
  blurb: string;
  /** Reads a point cloud (a picked .ply, or the default scan). */
  cloud?: boolean;
}

export const ENGINE_INSTRUMENTS: readonly EngineInstrument[] = [
  { id: 'strands', name: 'Strands', blurb: 'Each hit launches a line, ring, square or strata; burning fibres stream off it' },
  { id: 'cloud-pulse', name: 'Cloud Pulse', blurb: 'Waves of light travel through a scanned point cloud, one family per band', cloud: true },
  { id: 'cloud-flock', name: 'Cloud Flock', blurb: 'Kicks scatter a scanned point cloud into a swarm that re-forms', cloud: true },
  { id: 'depth-lights', name: 'Depth Lights', blurb: 'A point cloud as lights in space: depth slices switch with the music', cloud: true },
  { id: 'ribbon-field', name: 'Ribbon Field', blurb: 'Long silk ribbons ride a curl-noise river; hits kink them' },
  { id: 'shockwave-rings', name: 'Shockwave Rings', blurb: 'Hits send out rings and shells with hot fronts' },
  { id: 'fluid-ink', name: 'Fluid Ink', blurb: 'Ink bursts on every hit and swirls with the bass' },
  { id: 'lightning-arcs', name: 'Lightning Arcs', blurb: 'Branching bolts strike between nodes on every hit' },
  { id: 'spectral-terrain', name: 'Spectral Terrain', blurb: 'The spectrum builds a lit landscape that flies past' },
  { id: 'mesh-shatter', name: 'Mesh Shatter', blurb: 'A scanned point cloud breaks into shards on strong hits', cloud: true },
];

/** Instruments that read a point cloud file (`path`). */
export const CLOUD_INSTRUMENT_IDS = new Set<string>(ENGINE_INSTRUMENTS.filter((i) => i.cloud).map((i) => i.id));

const BY_ID = new Map(ENGINE_INSTRUMENTS.map((i) => [i.id, i]));

/** The instruments this build offers (the Audio Lab gate). */
export function offeredEngineInstruments(): readonly EngineInstrument[] {
  return audioReactiveInstrumentsAvailable() ? ENGINE_INSTRUMENTS : [];
}

export const engineVoiceFile = (id: string) => `${ENGINE_VOICE_PREFIX}${id}`;

export function isEngineVoiceFile(file: unknown): boolean {
  return typeof file === 'string' && file.startsWith(ENGINE_VOICE_PREFIX) && BY_ID.has(file.slice(ENGINE_VOICE_PREFIX.length));
}

export function engineInstrumentOf(file: string): EngineInstrument | undefined {
  return file.startsWith(ENGINE_VOICE_PREFIX) ? BY_ID.get(file.slice(ENGINE_VOICE_PREFIX.length)) : undefined;
}

/** The picture baked through the core (scripts/build-voice-thumbnails.mjs). */
export const engineThumbName = (id: string) => `engine-${id}.jpg`;

/**
 * The controls each voice shows, in order: the first four are its main
 * knobs, the rest sit under "more". Each was checked to change the picture
 * clearly across its range (a still sweep through the core). Every other
 * control keeps its default.
 */
export const ENGINE_VOICE_KEYS: Readonly<Record<string, readonly string[]>> = {
  strands: ['shape', 'changeEvery', 'size', 'width', 'trail', 'speed', 'fibres', 'autoRotateZ', 'palette'],
  'cloud-pulse': ['waveGain', 'pointSize', 'displacement', 'intensity', 'baseGlow', 'scale', 'autoRotateY', 'palette'],
  'cloud-flock': ['scatter', 'swarm', 'reform', 'intensity', 'edgeLight', 'autoRotateY', 'timeScale', 'palette'],
  'depth-lights': ['lights', 'lightSize', 'decay', 'intensity', 'autoRotateY', 'timeScale', 'palette'],
  'ribbon-field': ['width', 'kink', 'flowSpeed', 'travel', 'sheen', 'fog', 'speed', 'palette'],
  'shockwave-rings': ['reach', 'width', 'streak', 'particleSize', 'ringSpeed', 'dust', 'speed', 'palette'],
  'fluid-ink': ['burstSize', 'force', 'swirl', 'dissipation', 'curl', 'speed', 'palette'],
  'lightning-arcs': ['strikeRate', 'size', 'glowWidth', 'jagged', 'coreWidth', 'speed', 'palette'],
  'spectral-terrain': ['heightScale', 'flightSpeed', 'lineGlow', 'fog', 'cameraHeight', 'speed', 'palette'],
  'mesh-shatter': ['explode', 'shardSize', 'crackGlow', 'pointSize', 'breakThreshold', 'autoRotateY', 'speed', 'palette'],
};

/** Controls a voice exposes: its curated few (no rebuilds, no file, no button). */
function voiceControls(id: string, controls: readonly ParamControl[]): ParamControl[] {
  const usable = controls.filter((c) => !c.resets && !c.button && (c.kind === 'slider' || c.kind === 'select'));
  const keys = ENGINE_VOICE_KEYS[id];
  if (!keys) return usable;
  return keys.map((k) => usable.find((c) => c.key === k)).filter((c): c is ParamControl => !!c);
}

/** The core's controls for an instrument, or null before its manifest arrives. */
export function engineControls(id: string): ParamControl[] | null {
  const defs = get(nativeGraphParamDefs)[id];
  return defs?.length ? defs : null;
}

const codeCache = new Map<string, { defs: readonly ParamControl[]; code: string }>();

/**
 * The instrument's controls as ISF inputs (no shader: the header is all the
 * rack, the clip stack editor and drift read). Undefined until the core has
 * published them.
 */
export function engineVoiceCode(file: string): string | undefined {
  const inst = engineInstrumentOf(file);
  if (!inst) return undefined;
  const defs = engineControls(inst.id);
  if (!defs) return undefined;
  const cached = codeCache.get(inst.id);
  if (cached && cached.defs === defs) return cached.code;
  const inputs = voiceControls(inst.id, defs).map((c) => {
    if (c.kind === 'slider') return { NAME: c.key, LABEL: c.label, TYPE: 'float', MIN: c.min, MAX: c.max, DEFAULT: c.default };
    const select = c as Extract<ParamControl, { kind: 'select' }>;
    return {
      NAME: c.key, LABEL: c.label, TYPE: 'long',
      VALUES: select.options.map((_, i) => i), LABELS: select.options.map((o) => o.label),
      DEFAULT: Math.max(0, select.options.findIndex((o) => o.value === select.default)),
    };
  });
  const code = `/*${JSON.stringify({ ISFVSN: '2', DESCRIPTION: inst.name, CATEGORIES: ['Engine'], INPUTS: inputs })}*/\nvoid main() { gl_FragColor = vec4(0.0); }\n`;
  codeCache.set(inst.id, { defs, code });
  return code;
}

/**
 * The params the core gets: its defaults, the voice's numbers (select
 * indices turned back into their values) and the sound it follows. A voice
 * following everything reads the master packet.
 */
export function engineLayerParams(id: string, params: Record<string, number>, follows: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = ENGINE_VOICE_KEYS[id];
  for (const c of engineControls(id) ?? []) {
    // A colour left unset keeps the palette: its panel default (white) is not sent.
    if (c.kind === 'media-source' || c.kind === 'color') continue;
    if ('default' in c) out[c.key] = Array.isArray(c.default) ? [...c.default] : c.default;
    // Only the voice's own controls move; the rest stay at their defaults.
    if (keys && !keys.includes(c.key)) continue;
    const v = params[c.key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (c.kind === 'slider') out[c.key] = Math.min(c.max, Math.max(c.min, v));
    else if (c.kind === 'select') out[c.key] = c.options[Math.min(c.options.length - 1, Math.max(0, Math.round(v)))]?.value ?? c.default;
    else if (c.kind === 'toggle' && !c.button) out[c.key] = v >= 0.5;
  }
  if (follows && follows !== 'all') out.audioSource = follows;
  return out;
}

/** Marks a gpu layer as an Audio Lab engine voice (the only route instruments take). */
export const ENGINE_VOICE_MARK = 'engineVoice';

export function isEngineVoiceLayer(layer: unknown): boolean {
  return !!layer && (layer as Record<string, unknown>)[ENGINE_VOICE_MARK] === true;
}

/** A plain card the studio draws where an instrument cannot render. */
export const ENGINE_PLACEHOLDER_CODE = `/*{"ISFVSN":"2","DESCRIPTION":"Engine visual placeholder","INPUTS":[]}*/
void main() {
  vec2 uv = isf_FragNormCoord;
  float stripe = step(0.5, fract((uv.x + uv.y) * 12.0));
  vec2 d = abs(uv - 0.5);
  float frame = step(0.46, max(d.x, d.y));
  gl_FragColor = vec4(vec3(0.05 + 0.04 * stripe + 0.35 * frame), 1.0);
}
`;

/**
 * A hidden layer the studio's mix samples: the instrument drawn by the core,
 * or the placeholder where the core cannot draw it.
 */
export function engineVoiceLayer(id: string, file: string, params: Record<string, number>, follows: string, scan?: EngineScan): Layer {
  const inst = engineInstrumentOf(file)!;
  if (!engineControls(inst.id)) {
    return {
      ...createLayer(id, inst.name, 'media'),
      opacity: 0,
      source: { id: `${id}:placeholder`, type: 'shader', name: inst.name, src: 'ISF/engine-placeholder.fs', shaderCode: ENGINE_PLACEHOLDER_CODE, shaderValues: {} },
    } as Layer;
  }
  const content = createDefaultGPULayerContent();
  content.shaderId = inst.id;
  const coreParams = engineLayerParams(inst.id, params, follows);
  // No scan: the core draws its bundled default.
  if (inst.cloud && scan) coreParams.path = scan;
  content.params = coreParams as typeof content.params;
  return { ...createLayer(id, inst.name, 'gpu'), opacity: 0, gpuLayerContent: content, [ENGINE_VOICE_MARK]: true } as Layer;
}
