import type {
  WLEDController,
  WLEDEffect,
  WLEDEffectAutomation,
  WLEDEffectBlendMode,
  WLEDGroup,
  WLEDPatternCategory,
  WLEDPatternId,
} from '../types';
import { parseWLEDHexColor } from './mapping';

export interface WLEDPatternDefinition {
  id: WLEDPatternId;
  label: string;
  category: WLEDPatternCategory;
  description: string;
  speed: number;
  blendMode: WLEDEffectBlendMode;
  params: Record<string, number>;
}

const movement: WLEDPatternDefinition[] = [
  ['chase', 'Chase', 'A clean runner through the fixture.', 0.65, 'replace', { width: 0.12, tail: 0.35, density: 0.5 }],
  ['comet', 'Comet', 'Bright head with a long luminous tail.', 0.45, 'add', { width: 0.08, tail: 0.7, density: 0.5 }],
  ['scanner', 'Scanner', 'Knight Rider style reflected sweep.', 0.55, 'replace', { width: 0.18, tail: 0.42, density: 0.5 }],
  ['dual-chase', 'Dual Chase', 'Two opposed runners orbit the strip.', 0.5, 'replace', { width: 0.12, tail: 0.35, density: 0.5 }],
  ['bounce', 'Bounce', 'A runner that rebounds from both ends.', 0.55, 'add', { width: 0.1, tail: 0.45, density: 0.5 }],
  ['orbit', 'Orbit', 'Soft paired lights circling continuously.', 0.35, 'add', { width: 0.2, tail: 0.5, density: 0.5 }],
  ['marquee', 'Marquee', 'Marching illuminated dashes.', 0.7, 'replace', { width: 0.42, tail: 0.15, density: 0.48 }],
  ['theater-chase', 'Theater Chase', 'Classic three-phase theater bulbs.', 0.8, 'replace', { width: 0.5, tail: 0, density: 0.34 }],
].map(([id, label, description, speed, blendMode, params]) => ({
  id: id as WLEDPatternId,
  label: label as string,
  category: 'movement',
  description: description as string,
  speed: speed as number,
  blendMode: blendMode as WLEDEffectBlendMode,
  params: params as Record<string, number>,
}));

const organic: WLEDPatternDefinition[] = [
  ['firefly', 'Firefly', 'Sparse points slowly bloom and disappear.', 0.25, 'add', { width: 0.25, tail: 0.65, density: 0.22 }],
  ['twinkle', 'Twinkle', 'Fine randomized star shimmer.', 0.8, 'add', { width: 0.18, tail: 0.28, density: 0.42 }],
  ['embers', 'Embers', 'Warm low light with rising sparks.', 0.35, 'add', { width: 0.2, tail: 0.58, density: 0.35 }],
  ['fire', 'Fire', 'Layered turbulent flame movement.', 0.55, 'colorize', { width: 0.38, tail: 0.5, density: 0.7 }],
  ['lightning', 'Lightning', 'Irregular full-fixture electric strikes.', 0.7, 'add', { width: 0.5, tail: 0.12, density: 0.18 }],
  ['rain', 'Rain', 'Falling droplets traveling through the map.', 0.65, 'add', { width: 0.08, tail: 0.5, density: 0.42 }],
  ['ripple', 'Ripple', 'Expanding rings from changing origins.', 0.4, 'add', { width: 0.13, tail: 0.38, density: 0.5 }],
  ['aurora', 'Aurora', 'Slow overlapping waves of luminous color.', 0.18, 'colorize', { width: 0.65, tail: 0.72, density: 0.5 }],
  ['breathing', 'Breathing', 'A slow organic whole-rig breath.', 0.16, 'multiply', { width: 0.5, tail: 0.65, density: 0.5 }],
  ['plasma', 'Plasma', 'Fluid interference bands across the LEDs.', 0.38, 'colorize', { width: 0.45, tail: 0.5, density: 0.5 }],
].map(([id, label, description, speed, blendMode, params]) => ({
  id: id as WLEDPatternId,
  label: label as string,
  category: 'organic',
  description: description as string,
  speed: speed as number,
  blendMode: blendMode as WLEDEffectBlendMode,
  params: params as Record<string, number>,
}));

const rhythmic: WLEDPatternDefinition[] = [
  ['beat-pulse', 'Beat Pulse', 'A clean whole-rig pulse on every beat.', 1, 'multiply', { width: 0.5, tail: 0.42, density: 0.5 }],
  ['strobe', 'Strobe', 'Hard rhythmic on-off flashes.', 2, 'replace', { width: 0.5, tail: 0, density: 0.5 }],
  ['random-blink', 'Random Blink', 'Independent rhythmic pixel pops.', 1.2, 'add', { width: 0.2, tail: 0.2, density: 0.35 }],
  ['bass-hits', 'Bass Hits', 'Heavy low-frequency style impact pulses.', 0.5, 'add', { width: 0.55, tail: 0.6, density: 0.5 }],
  ['hi-hat-sparkle', 'Hi-Hat Sparkle', 'Fast bright detail over the source colors.', 2, 'add', { width: 0.12, tail: 0.12, density: 0.3 }],
  ['bar-sweep', 'Bar Sweep', 'A beat-locked sweep from end to end.', 0.5, 'replace', { width: 0.2, tail: 0.35, density: 0.5 }],
  ['euclidean-pulse', 'Euclidean Pulse', 'Evenly distributed rhythmic accents.', 1, 'replace', { width: 0.3, tail: 0.2, density: 0.4 }],
].map(([id, label, description, speed, blendMode, params]) => ({
  id: id as WLEDPatternId,
  label: label as string,
  category: 'rhythmic',
  description: description as string,
  speed: speed as number,
  blendMode: blendMode as WLEDEffectBlendMode,
  params: params as Record<string, number>,
}));

const spatial: WLEDPatternDefinition[] = [
  ['wave', 'Wave', 'A smooth traveling intensity wave.', 0.45, 'multiply', { width: 0.5, tail: 0.5, density: 0.5 }],
  ['sine-wave', 'Sine Wave', 'Layered sinusoidal ribbons of light.', 0.35, 'colorize', { width: 0.5, tail: 0.5, density: 0.6 }],
  ['radial-wave', 'Radial Wave', 'Concentric waves over mapped positions.', 0.42, 'add', { width: 0.18, tail: 0.42, density: 0.5 }],
  ['center-out', 'Center Out', 'Light expands from the fixture center.', 0.5, 'replace', { width: 0.18, tail: 0.4, density: 0.5 }],
  ['edge-in', 'Edge In', 'Both edges collapse toward the center.', 0.5, 'replace', { width: 0.18, tail: 0.4, density: 0.5 }],
  ['wipe', 'Wipe', 'A solid directional reveal.', 0.4, 'gate', { width: 0.12, tail: 0.18, density: 0.5 }],
  ['gradient-drift', 'Gradient Drift', 'A slowly moving two-color gradient.', 0.2, 'colorize', { width: 0.7, tail: 0.7, density: 0.5 }],
  ['pinwheel', 'Pinwheel', 'Rotating spokes across mapped fixtures.', 0.3, 'add', { width: 0.24, tail: 0.42, density: 0.55 }],
  ['snake', 'Snake', 'A segmented runner with articulated motion.', 0.48, 'replace', { width: 0.3, tail: 0.62, density: 0.55 }],
].map(([id, label, description, speed, blendMode, params]) => ({
  id: id as WLEDPatternId,
  label: label as string,
  category: 'spatial',
  description: description as string,
  speed: speed as number,
  blendMode: blendMode as WLEDEffectBlendMode,
  params: params as Record<string, number>,
}));

const content: WLEDPatternDefinition[] = [
  ['shader-color-chase', 'Shader Color Chase', 'A chase colored directly by the live content.', 0.55, 'replace', { width: 0.15, tail: 0.48, density: 0.5 }],
  ['highlight-runner', 'Highlight Runner', 'Pulls the brightest source colors into a runner.', 0.45, 'add', { width: 0.18, tail: 0.55, density: 0.5 }],
  ['palette-sparkle', 'Palette Sparkle', 'Twinkles using dominant shader palette colors.', 0.8, 'add', { width: 0.16, tail: 0.25, density: 0.4 }],
  ['luma-gate', 'Luma Gate', 'Keeps only source pixels above a light threshold.', 0.2, 'gate', { width: 0.5, tail: 0.5, density: 0.55 }],
  ['saturation-pop', 'Saturation Pop', 'Accents the most colorful parts of the source.', 0.25, 'colorize', { width: 0.5, tail: 0.5, density: 0.5 }],
  ['pixel-echo', 'Pixel Echo', 'Offsets and repeats source colors down the strip.', 0.35, 'add', { width: 0.35, tail: 0.65, density: 0.5 }],
  ['content-freeze-chase', 'Freeze + Chase Reveal', 'A moving window reveals the current content frame.', 0.4, 'gate', { width: 0.22, tail: 0.38, density: 0.5 }],
].map(([id, label, description, speed, blendMode, params]) => ({
  id: id as WLEDPatternId,
  label: label as string,
  category: 'content',
  description: description as string,
  speed: speed as number,
  blendMode: blendMode as WLEDEffectBlendMode,
  params: params as Record<string, number>,
}));

const glitch: WLEDPatternDefinition[] = [
  ['packet-drop', 'Packet Drop', 'Intentional rhythmic missing LED packets.', 0.8, 'gate', { width: 0.4, tail: 0.12, density: 0.58 }],
  ['scan-tear', 'Scan Tear', 'Displaced scan bands moving through the fixture.', 0.65, 'replace', { width: 0.16, tail: 0.2, density: 0.5 }],
  ['noise-blocks', 'Noise Blocks', 'Chunked randomized color and blackout blocks.', 0.6, 'replace', { width: 0.35, tail: 0.18, density: 0.5 }],
  ['random-blackout', 'Random Blackout', 'Momentary hard black sections.', 0.75, 'gate', { width: 0.4, tail: 0.12, density: 0.42 }],
  ['rgb-split', 'RGB Split', 'Separates source channels spatially.', 0.25, 'replace', { width: 0.35, tail: 0.5, density: 0.5 }],
  ['signal-burst', 'Signal Burst', 'Short noisy transmissions separated by darkness.', 0.7, 'add', { width: 0.32, tail: 0.16, density: 0.35 }],
].map(([id, label, description, speed, blendMode, params]) => ({
  id: id as WLEDPatternId,
  label: label as string,
  category: 'glitch',
  description: description as string,
  speed: speed as number,
  blendMode: blendMode as WLEDEffectBlendMode,
  params: params as Record<string, number>,
}));

export const WLED_PATTERN_CATALOG: WLEDPatternDefinition[] = [
  ...movement,
  ...organic,
  ...rhythmic,
  ...spatial,
  ...content,
  ...glitch,
];

export const WLED_PATTERN_CATEGORIES: Array<{ id: WLEDPatternCategory; label: string }> = [
  { id: 'movement', label: 'Movement' },
  { id: 'organic', label: 'Organic' },
  { id: 'rhythmic', label: 'Rhythmic' },
  { id: 'spatial', label: 'Spatial' },
  { id: 'content', label: 'Content Aware' },
  { id: 'glitch', label: 'Glitch' },
];

export function getWLEDPatternDefinition(pattern: WLEDPatternId): WLEDPatternDefinition {
  return WLED_PATTERN_CATALOG.find(definition => definition.id === pattern) ?? WLED_PATTERN_CATALOG[0];
}

export function createWLEDEffect(pattern: WLEDPatternId, index = 0): WLEDEffect {
  const definition = getWLEDPatternDefinition(pattern);
  return {
    id: `led-fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: definition.label,
    pattern,
    enabled: true,
    active: false,
    amount: 1,
    speed: definition.speed,
    speedMode: definition.category === 'rhythmic' ? 'bpm' : 'manual',
    beatDivision: 1,
    blendMode: definition.blendMode,
    colorSource: definition.category === 'content' ? 'shader' : 'palette',
    color: '#ff6f61',
    secondaryColor: '#28d7ff',
    target: { mode: 'all' },
    params: { ...definition.params },
    seed: (Date.now() + index * 7919) >>> 0,
  };
}

interface TargetSpan {
  start: number;
  count: number;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash(value: number): number {
  return fract(Math.sin(value * 12.9898 + 78.233) * 43758.5453123);
}

function circularDistance(a: number, b: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, 1 - direct);
}

function smoothPulse(distance: number, width: number, tail: number): number {
  const safeWidth = Math.max(0.005, width);
  const edge = safeWidth + Math.max(0.005, tail) * 0.35;
  if (distance >= edge) return 0;
  if (distance <= safeWidth * 0.35) return 1;
  const normalized = (distance - safeWidth * 0.35) / Math.max(0.001, edge - safeWidth * 0.35);
  return Math.pow(1 - clamp(normalized), 1.3);
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const h = fract(hue) * 6;
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const m = value - chroma;
  let rgb: [number, number, number];
  if (h < 1) rgb = [chroma, x, 0];
  else if (h < 2) rgb = [x, chroma, 0];
  else if (h < 3) rgb = [0, chroma, x];
  else if (h < 4) rgb = [0, x, chroma];
  else if (h < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  return rgb.map(channel => (channel + m) * 255) as [number, number, number];
}

function mixColor(a: [number, number, number], b: [number, number, number], amount: number): [number, number, number] {
  const t = clamp(amount);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function sourceColor(buffer: Uint8Array, index: number): [number, number, number] {
  const count = Math.max(1, Math.floor(buffer.length / 3));
  const safeIndex = ((Math.floor(index) % count) + count) % count;
  const offset = safeIndex * 3;
  return [buffer[offset] ?? 0, buffer[offset + 1] ?? 0, buffer[offset + 2] ?? 0];
}

function extractPalette(buffer: Uint8Array): Array<[number, number, number]> {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  const count = Math.floor(buffer.length / 3);
  for (let index = 0; index < count; index += 1) {
    const [r, g, b] = sourceColor(buffer, index);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = 0;
    if (delta > 0) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = fract(hue / 6);
    }
    const saturation = max > 0 ? delta / max : 0;
    const weight = Math.max(0.02, saturation * (max / 255));
    const bin = bins[Math.min(11, Math.floor(hue * 12))];
    bin.weight += weight;
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
  }
  return bins
    .filter(bin => bin.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(bin => [bin.r / bin.weight, bin.g / bin.weight, bin.b / bin.weight] as [number, number, number]);
}

function targetSpans(controller: WLEDController, effect: WLEDEffect, groups: WLEDGroup[]): TargetSpan[] {
  const total = Math.max(1, Math.floor(controller.ledCount));
  const whole = [{ start: 0, count: total }];
  if (effect.target.mode === 'all') return whole;
  if (effect.target.mode === 'controller') {
    return effect.target.controllerId === controller.id ? whole : [];
  }
  const findRange = (rangeId: string | undefined): TargetSpan[] => {
    const range = (controller.ranges ?? []).find(item => item.id === rangeId);
    if (!range) return [];
    const start = Math.max(0, Math.min(total - 1, Math.floor(range.start)));
    return [{ start, count: Math.max(1, Math.min(total - start, Math.floor(range.count))) }];
  };
  if (effect.target.mode === 'range') {
    return effect.target.controllerId === controller.id ? findRange(effect.target.rangeId) : [];
  }
  const group = groups.find(item => item.id === effect.target.groupId);
  if (!group) return [];
  return group.members
    .filter(member => member.controllerId === controller.id)
    .flatMap(member => member.rangeId ? findRange(member.rangeId) : whole);
}

function automationEffect(
  effects: WLEDEffect[],
  automation: WLEDEffectAutomation | undefined,
  nowMs: number,
  bpm: number
): WLEDEffect | null {
  if (!automation?.playing) return null;
  const sequence = effects.filter(effect => effect.enabled);
  if (sequence.length === 0) return null;
  const intervalMs = automation.mode === 'beat'
    ? (60000 / Math.max(1, bpm)) * Math.max(1, automation.beats)
    : Math.max(0.1, automation.seconds) * 1000;
  const rawStep = Math.floor(nowMs / intervalMs);
  let index = rawStep % sequence.length;
  if (automation.order === 'random') index = Math.floor(hash(rawStep + 913) * sequence.length);
  if (automation.order === 'pingpong' && sequence.length > 1) {
    const length = sequence.length * 2 - 2;
    const position = rawStep % length;
    index = position < sequence.length ? position : length - position;
  }
  return sequence[index];
}

interface PatternSample {
  mask: number;
  colorMix?: number;
  sourceShift?: number;
}

function patternSample(
  effect: WLEDEffect,
  position: number,
  index: number,
  count: number,
  time: number,
  base: [number, number, number]
): PatternSample {
  const width = clamp(effect.params.width ?? 0.2, 0.01, 1);
  const tail = clamp(effect.params.tail ?? 0.4);
  const density = clamp(effect.params.density ?? 0.5);
  const phase = fract(time);
  const step = Math.floor(time * 8);
  const random = hash(index * 37.1 + step * 101.7 + effect.seed);
  const luma = (base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722) / 255;
  const saturation = (Math.max(...base) - Math.min(...base)) / Math.max(1, Math.max(...base));

  switch (effect.pattern) {
    case 'chase':
    case 'shader-color-chase':
    case 'highlight-runner':
      return { mask: smoothPulse(circularDistance(position, phase), width, tail) };
    case 'comet': {
      const behind = fract(phase - position);
      return { mask: behind < width ? 1 : behind < width + tail ? 1 - (behind - width) / Math.max(0.001, tail) : 0 };
    }
    case 'scanner':
    case 'bounce': {
      const bounce = 1 - Math.abs(fract(time * 0.5) * 2 - 1);
      return { mask: smoothPulse(Math.abs(position - bounce), width, tail) };
    }
    case 'dual-chase':
    case 'orbit':
      return { mask: Math.max(
        smoothPulse(circularDistance(position, phase), width, tail),
        smoothPulse(circularDistance(position, fract(phase + 0.5)), width, tail)
      ) };
    case 'marquee':
      return { mask: fract(position * Math.max(2, Math.round(4 + density * 12)) - time) < width ? 1 : 0.08 };
    case 'theater-chase':
      return { mask: (index + Math.floor(time * 6)) % 3 === 0 ? 1 : 0.03 };
    case 'firefly':
      return { mask: random > 1 - density * 0.16 ? Math.pow(hash(index * 9.7 + effect.seed + Math.floor(time)), 2) : 0 };
    case 'twinkle':
    case 'palette-sparkle':
    case 'hi-hat-sparkle':
      return { mask: random > 1 - density * 0.42 ? hash(index + step * 17 + effect.seed) : 0 };
    case 'embers': {
      const spark = hash(index * 13 + Math.floor(time * 3) + effect.seed);
      return { mask: clamp((spark - (1 - density * 0.4)) * 5 + (1 - position) * 0.18) };
    }
    case 'fire':
      return { mask: clamp(0.25 + (1 - position) * 0.4 + hash(index * 0.8 + step + effect.seed) * 0.55), colorMix: position };
    case 'lightning': {
      const strike = hash(Math.floor(time * 5) + effect.seed);
      return { mask: strike > 1 - density * 0.32 ? Math.pow(hash(index * 0.4 + step), 0.25) : 0 };
    }
    case 'rain': {
      const drop = fract(position + hash(index * 0.3 + effect.seed) - time * 1.7);
      return { mask: smoothPulse(drop, width * 0.35, tail) };
    }
    case 'ripple':
    case 'radial-wave': {
      const ring = Math.abs(fract(Math.abs(position - 0.5) * 2 - time) - 0.5) * 2;
      return { mask: smoothPulse(ring, width, tail) };
    }
    case 'aurora':
      return { mask: clamp(0.3 + Math.sin(position * 12 + time * 3) * 0.25 + Math.sin(position * 5 - time * 1.3) * 0.2), colorMix: fract(position + time * 0.1) };
    case 'breathing':
    case 'beat-pulse':
    case 'bass-hits':
      return { mask: 0.08 + Math.pow(0.5 + 0.5 * Math.cos(phase * Math.PI * 2), effect.pattern === 'bass-hits' ? 8 : 3) * 0.92 };
    case 'plasma':
      return { mask: clamp(0.5 + Math.sin(position * 16 + time * 2) * 0.25 + Math.cos(position * 7 - time * 3.1) * 0.25), colorMix: fract(position - time * 0.08) };
    case 'strobe':
      return { mask: fract(time * 2) < 0.35 ? 1 : 0 };
    case 'random-blink':
      return { mask: random > 1 - density ? 1 : 0.03 };
    case 'bar-sweep':
      return { mask: smoothPulse(Math.abs(position - phase), width, tail) };
    case 'euclidean-pulse': {
      const pulses = Math.max(1, Math.round(1 + density * 7));
      return { mask: ((index + Math.floor(time * count)) * pulses) % Math.max(1, count) < pulses ? 1 : 0.04 };
    }
    case 'wave':
      return { mask: 0.5 + 0.5 * Math.sin(position * Math.PI * 2 - time * Math.PI * 2) };
    case 'sine-wave':
      return { mask: clamp(0.5 + 0.32 * Math.sin(position * 12 - time * 4) + 0.18 * Math.sin(position * 27 + time * 2)), colorMix: fract(position + time * 0.08) };
    case 'center-out':
      return { mask: smoothPulse(Math.abs(Math.abs(position - 0.5) * 2 - phase), width, tail) };
    case 'edge-in':
      return { mask: smoothPulse(Math.abs((1 - Math.abs(position - 0.5) * 2) - phase), width, tail) };
    case 'wipe':
      return { mask: position <= phase ? 1 : smoothPulse(position - phase, width, tail) };
    case 'gradient-drift':
      return { mask: 1, colorMix: fract(position + time * 0.12) };
    case 'pinwheel':
      return { mask: Math.pow(0.5 + 0.5 * Math.sin(position * Math.PI * 8 - time * Math.PI * 2), 2), colorMix: fract(position + time * 0.1) };
    case 'snake': {
      const segment = smoothPulse(circularDistance(position, phase), width, tail);
      return { mask: segment * (0.55 + 0.45 * Math.sin(index * 1.8 + time * 5)) };
    }
    case 'luma-gate':
      return { mask: luma >= density ? 1 : 0 };
    case 'saturation-pop':
      return { mask: clamp((saturation - density * 0.7) * 3), colorMix: saturation };
    case 'pixel-echo':
      return { mask: 0.65, sourceShift: Math.round((0.03 + width * 0.25) * count) };
    case 'content-freeze-chase':
      return { mask: smoothPulse(circularDistance(position, phase), width, tail) };
    case 'packet-drop':
      return { mask: hash(Math.floor(index / Math.max(1, Math.round(width * count))) + step + effect.seed) > density ? 1 : 0 };
    case 'scan-tear':
      return { mask: 1, sourceShift: random > 0.72 ? Math.round((random - 0.5) * count * width) : 0 };
    case 'noise-blocks': {
      const block = hash(Math.floor(index / Math.max(1, Math.round(width * count))) + step + effect.seed);
      return { mask: block > density ? 1 : 0.08, colorMix: block };
    }
    case 'random-blackout':
      return { mask: random > density * 0.65 ? 1 : 0 };
    case 'rgb-split':
      return { mask: 1, sourceShift: Math.max(1, Math.round(width * count * 0.12)) };
    case 'signal-burst': {
      const burst = hash(Math.floor(time * 4) + effect.seed) > 1 - density;
      return { mask: burst ? random : 0 };
    }
  }
}

function blendPixel(
  base: [number, number, number],
  effectColor: [number, number, number],
  mask: number,
  amount: number,
  blendMode: WLEDEffectBlendMode
): [number, number, number] {
  const strength = clamp(mask * amount);
  if (blendMode === 'add') {
    return [
      Math.min(255, base[0] + effectColor[0] * strength),
      Math.min(255, base[1] + effectColor[1] * strength),
      Math.min(255, base[2] + effectColor[2] * strength),
    ];
  }
  if (blendMode === 'multiply') {
    return [
      base[0] * (1 - strength + (effectColor[0] / 255) * strength),
      base[1] * (1 - strength + (effectColor[1] / 255) * strength),
      base[2] * (1 - strength + (effectColor[2] / 255) * strength),
    ];
  }
  if (blendMode === 'gate') {
    const gate = 1 - amount + mask * amount;
    return [base[0] * gate, base[1] * gate, base[2] * gate];
  }
  if (blendMode === 'colorize') {
    const luma = base[0] * 0.2126 + base[1] * 0.7152 + base[2] * 0.0722;
    const max = Math.max(1, effectColor[0], effectColor[1], effectColor[2]);
    const colored: [number, number, number] = [
      effectColor[0] / max * luma,
      effectColor[1] / max * luma,
      effectColor[2] / max * luma,
    ];
    return mixColor(base, colored, strength);
  }
  return mixColor(base, effectColor.map(channel => channel * mask) as [number, number, number], amount);
}

/** Apply all active and automated LED FX in project order to one controller. */
export function applyWLEDEffects(
  source: Uint8Array,
  output: Uint8Array,
  controller: WLEDController,
  groups: WLEDGroup[],
  effects: WLEDEffect[],
  automation: WLEDEffectAutomation | undefined,
  nowMs: number,
  bpm = 120
): Uint8Array {
  output.set(source.subarray(0, output.length));
  const auto = automationEffect(effects, automation, nowMs, bpm);
  const active = effects.filter(effect => effect.active || effect.id === auto?.id);
  if (active.length === 0) return output;
  const palette = extractPalette(source);

  for (const effect of active) {
    const spans = targetSpans(controller, effect, groups);
    if (spans.length === 0) continue;
    const cyclesPerSecond = effect.speedMode === 'bpm'
      ? (Math.max(1, bpm) / 60) * Math.max(0.0625, effect.beatDivision)
      : Math.max(0.01, effect.speed);
    const time = nowMs / 1000 * cyclesPerSecond;
    const primary = parseWLEDHexColor(effect.color);
    const secondary = parseWLEDHexColor(effect.secondaryColor);

    for (const span of spans) {
      for (let localIndex = 0; localIndex < span.count; localIndex += 1) {
        const index = span.start + localIndex;
        if (index < 0 || index * 3 + 2 >= output.length) continue;
        const position = span.count <= 1 ? 0.5 : localIndex / (span.count - 1);
        const original = sourceColor(output, index);
        const sample = patternSample(effect, position, localIndex, span.count, time, original);
        let base = original;
        if (sample.sourceShift) {
          if (effect.pattern === 'rgb-split') {
            const left = sourceColor(output, index - sample.sourceShift);
            const right = sourceColor(output, index + sample.sourceShift);
            base = [left[0], original[1], right[2]];
          } else {
            base = sourceColor(output, index + sample.sourceShift);
          }
        }
        let color: [number, number, number];
        if (effect.colorSource === 'shader') color = base;
        else if (effect.colorSource === 'rainbow') color = hsvToRgb(position + time * 0.08, 1, 1);
        else if (effect.colorSource === 'palette' && palette.length > 0) {
          const palettePosition = sample.colorMix ?? position + time * 0.05;
          color = palette[Math.floor(fract(palettePosition) * palette.length) % palette.length];
        } else {
          color = mixColor(primary, secondary, sample.colorMix ?? position);
        }
        const blended = blendPixel(base, color, sample.mask, effect.amount, effect.blendMode);
        const offset = index * 3;
        output[offset] = Math.round(clamp(blended[0] / 255) * 255);
        output[offset + 1] = Math.round(clamp(blended[1] / 255) * 255);
        output[offset + 2] = Math.round(clamp(blended[2] / 255) * 255);
      }
    }
  }
  return output;
}
