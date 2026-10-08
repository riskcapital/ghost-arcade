// Sorts a clip's parameters into a few named sections for the Controls inspector.
//
// Shaders declare a flat list (the largest has 40 inputs). The file format has no grouping, so
// sections come from the words in each input's name and label. The few controls a performer
// reaches for most are pinned above the sections, in the order the shader declares them.

export type ParamGroupId = 'look' | 'motion' | 'colour' | 'audio';

export interface ParamLike {
  NAME: string;
  TYPE: string;
  LABEL?: string;
  VALUES?: number[];
}

export interface ParamGroup<T> {
  id: ParamGroupId;
  label: string;
  params: T[];
}

export const PARAM_GROUP_LABELS: Record<ParamGroupId, string> = {
  look: 'Look',
  motion: 'Motion',
  colour: 'Colour',
  audio: 'Audio',
};
const GROUP_ORDER: ParamGroupId[] = ['look', 'motion', 'colour', 'audio'];

/** Lower-case words of a name such as `bassToBloom`, `Bass → Emission` or `trail_length2`. */
export function paramWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

const AUDIO = new Set(['audio', 'bass', 'treble', 'treb', 'fft', 'beat', 'pump', 'react', 'reactive', 'reactivity', 'sensitivity', 'response', 'music', 'sound', 'kick', 'band']);
const COLOUR = new Set(['color', 'colour', 'hue', 'saturation', 'palette', 'tint', 'brightness', 'contrast', 'gamma', 'bg', 'background', 'warm', 'warmth', 'tone', 'iridescence', 'ink', 'exposure', 'chroma']);
const MOTION = new Set(['speed', 'rate', 'pace', 'rotate', 'rotation', 'rot', 'spin', 'drift', 'flow', 'orbit', 'cycle', 'move', 'movement', 'motion', 'march', 'tilt', 'yaw', 'pan', 'scroll', 'tempo', 'velocity', 'turbulence', 'sway', 'wobble', 'travel', 'camera', 'cam', 'fov']);

/** The section one parameter belongs to. */
export function paramGroupOf(param: ParamLike): ParamGroupId {
  const name = `${param.NAME} ${param.LABEL ?? ''}`;
  const words = paramWords(name);
  const has = (set: Set<string>) => words.some((word) => set.has(word));
  // "Bass → Emission", "energyToWarp": an audio feature routed to something.
  if (/→|->/.test(name) || (words.includes('to') && words.some((w) => ['bass', 'mid', 'treb', 'treble', 'energy'].includes(w)))) return 'audio';
  if (has(AUDIO)) return 'audio';
  if (param.TYPE === 'color' || has(COLOUR)) return 'colour';
  if (has(MOTION)) return 'motion';
  return 'look';
}

// How strongly a word marks a control as one a performer reaches for first.
const PIN_WEIGHT: Record<string, number> = {
  speed: 100, intensity: 90, zoom: 82, scale: 80, glow: 76, shift: 72, hue: 70, density: 64, count: 62,
  warp: 58, amount: 54, size: 52, brightness: 50, depth: 46, width: 42, chaos: 40, pump: 36,
};

/** Sliders only: a pinned control must be something to ride, not a switch or a colour well. */
const isSlider = (param: ParamLike) => (param.TYPE === 'float' || param.TYPE === 'long') && !(param.TYPE === 'long' && param.VALUES?.length);

/**
 * The few parameters shown above the sections. Chosen by how central their name is, then by the
 * shader's own order, and returned in that order so a clip's quick controls never shuffle.
 */
export function pinnedParams<T extends ParamLike>(params: T[], max = 4): T[] {
  const ranked = params
    .map((param, index) => {
      if (!isSlider(param)) return null;
      const group = paramGroupOf(param);
      if (group === 'audio') return null;
      const weight = Math.max(0, ...paramWords(`${param.NAME} ${param.LABEL ?? ''}`).map((word) => PIN_WEIGHT[word] ?? 0));
      // Earlier inputs win ties: authors list the main controls first.
      return { param, index, score: weight - index * 0.75 };
    })
    .filter((entry): entry is { param: T; index: number; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, max));
  return ranked.sort((a, b) => a.index - b.index).map((entry) => entry.param);
}

/** Pinned controls plus the remaining parameters in their sections. Empty sections are left out. */
export function groupParams<T extends ParamLike>(params: T[], maxPinned = 4): { pinned: T[]; groups: ParamGroup<T>[] } {
  // A short list needs no pinning: everything is already in reach.
  const pinned = params.length > maxPinned + 2 ? pinnedParams(params, maxPinned) : [];
  const taken = new Set(pinned);
  const buckets = new Map<ParamGroupId, T[]>();
  for (const param of params) {
    if (taken.has(param)) continue;
    const id = paramGroupOf(param);
    buckets.set(id, [...(buckets.get(id) ?? []), param]);
  }
  const groups = GROUP_ORDER.filter((id) => buckets.get(id)?.length).map((id) => ({ id, label: PARAM_GROUP_LABELS[id], params: buckets.get(id)! }));
  return { pinned, groups };
}

/** Which sections start open: all of them for a short list, only Look for a long one. */
export function defaultOpenGroups<T>(groups: ParamGroup<T>[], pinnedCount: number): Set<ParamGroupId> {
  const total = groups.reduce((sum, group) => sum + group.params.length, 0) + pinnedCount;
  if (total <= 10) return new Set(groups.map((group) => group.id));
  const first = groups.find((group) => group.id === 'look') ?? groups[0];
  return new Set(first ? [first.id] : []);
}

/** A readable label for an input that only has a code name: `trailLength` reads "Trail length". */
export function paramLabel(param: { NAME: string; LABEL?: string }): string {
  if (param.LABEL?.trim()) return param.LABEL.trim();
  const words = param.NAME.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().split(/\s+/);
  // The library's shared "sv" inputs are extra drive on top of the clip's own controls.
  if (words[0]?.toLowerCase() === 'sv' && words.length > 1) words[0] = 'Boost';
  const text = words.map((word, index) => (index === 0 ? (word[0] ?? '').toUpperCase() + word.slice(1) : word.toLowerCase())).join(' ');
  return text || param.NAME;
}
