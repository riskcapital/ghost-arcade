/**
 * DMX input bindings: pure functions shared by the store, the panel and the
 * tests. A binding reads one channel (8-bit), a coarse and fine pair
 * (16-bit), or one channel as a button (trigger, with hysteresis), and
 * writes a control path through the same router MIDI and OSC use.
 */
import { inferOscBindingMode } from '../osc/oscBindings';
import { normalizeControlPath } from '../control/controlPaths';

export type DmxProtocol = 'artnet' | 'sacn';
export type DmxBindingMode = '8bit' | '16bit' | 'trigger';
export type DmxMergeMode = 'htp' | 'ltp' | 'priority';

export const DMX_CHANNELS = 512;
export const DEFAULT_TRIGGER_THRESHOLD = 128;
export const DEFAULT_TRIGGER_HYSTERESIS = 16;
export const MAX_UNIVERSE_FILTER = 64;
/** Channels must travel at least this far during learn to count as a wiggle. */
export const LEARN_MIN_SPAN = 24;

export interface DmxBinding {
  id: string;
  protocol: DmxProtocol;
  /** Art-Net 0-32767, sACN 1-63999. */
  universe: number;
  /** 1-512. The coarse channel in 16-bit mode. */
  channel: number;
  /** 1-512, 16-bit mode only. Defaults to channel + 1. */
  fineChannel?: number;
  mode: DmxBindingMode;
  path: string;
  label?: string;
  /** Output range in the target's own units (0-1 for opacity). */
  min: number;
  max: number;
  invert: boolean;
  /** Trigger: pressed at or above this DMX value (1-255). */
  threshold: number;
  /** Trigger: released below threshold minus this (0-127). */
  hysteresis: number;
  /** Named values for discrete targets such as blend mode. */
  discreteValues?: string[];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function maxUniverseFor(protocol: DmxProtocol): number {
  return protocol === 'sacn' ? 63999 : 32767;
}

export function minUniverseFor(protocol: DmxProtocol): number {
  return protocol === 'sacn' ? 1 : 0;
}

/** Buttons and one-shot actions default to trigger, everything else 8-bit. */
export function inferDmxBindingMode(path: string): DmxBindingMode {
  return inferOscBindingMode(normalizeControlPath(path)) === 'trigger' ? 'trigger' : '8bit';
}

export function dmxUniverseKey(protocol: DmxProtocol, universe: number): string {
  return `${protocol}:${universe}`;
}

/** Fine channel for a 16-bit binding (the next channel unless set). */
export function fineChannelOf(binding: Pick<DmxBinding, 'channel' | 'fineChannel'>): number {
  return binding.fineChannel ?? Math.min(DMX_CHANNELS, binding.channel + 1);
}

/** Clean a binding coming from a saved project or the UI. Returns null if unusable. */
export function sanitizeDmxBinding(raw: unknown, id: string): DmxBinding | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Partial<DmxBinding>;
  const protocol: DmxProtocol = entry.protocol === 'sacn' ? 'sacn' : 'artnet';
  const path = typeof entry.path === 'string' ? normalizeControlPath(entry.path) : '';
  if (!path) return null;
  const mode: DmxBindingMode = entry.mode === '16bit' || entry.mode === 'trigger' || entry.mode === '8bit'
    ? entry.mode
    : inferDmxBindingMode(path);
  const channel = clampInt(entry.channel, 1, DMX_CHANNELS, 1);
  const binding: DmxBinding = {
    id,
    protocol,
    universe: clampInt(entry.universe, minUniverseFor(protocol), maxUniverseFor(protocol), minUniverseFor(protocol)),
    channel,
    mode,
    path,
    min: finite(entry.min, 0),
    max: finite(entry.max, 1),
    invert: entry.invert === true,
    threshold: clampInt(entry.threshold, 1, 255, DEFAULT_TRIGGER_THRESHOLD),
    hysteresis: clampInt(entry.hysteresis, 0, 127, DEFAULT_TRIGGER_HYSTERESIS),
  };
  if (typeof entry.label === 'string' && entry.label) binding.label = entry.label.slice(0, 120);
  if (mode === '16bit') binding.fineChannel = clampInt(entry.fineChannel, 1, DMX_CHANNELS, Math.min(DMX_CHANNELS, channel + 1));
  if (Array.isArray(entry.discreteValues) && entry.discreteValues.every(value => typeof value === 'string')) {
    binding.discreteValues = entry.discreteValues.slice(0, 64);
  }
  return binding;
}

/**
 * Normalized 0-1 position of the binding's channel(s), invert applied.
 * 16-bit: (coarse * 256 + fine) / 65535.
 */
export function readDmxBindingPosition(binding: DmxBinding, data: ArrayLike<number>): number {
  const coarse = data[binding.channel - 1] ?? 0;
  let position: number;
  if (binding.mode === '16bit') {
    const fine = data[fineChannelOf(binding) - 1] ?? 0;
    position = (coarse * 256 + fine) / 65535;
  } else {
    position = coarse / 255;
  }
  return binding.invert ? 1 - position : position;
}

/** Value sent to the router for a continuous binding: position mapped onto min..max. */
export function resolveDmxBindingValue(binding: DmxBinding, data: ArrayLike<number>): number {
  const position = readDmxBindingPosition(binding, data);
  return binding.min + (binding.max - binding.min) * position;
}

/**
 * One step of a trigger binding. Pressed once the (inverted if asked) DMX
 * value reaches the threshold; released only after it falls below
 * threshold - hysteresis, so a fader resting near the threshold, or a
 * noisy desk, cannot machine-gun a clip.
 */
export function stepDmxTrigger(
  binding: DmxBinding,
  data: ArrayLike<number>,
  wasPressed: boolean,
): { pressed: boolean; edge: 'press' | 'release' | null } {
  const raw = data[binding.channel - 1] ?? 0;
  const value = binding.invert ? 255 - raw : raw;
  const threshold = Math.max(1, Math.min(255, binding.threshold));
  const release = Math.max(0, threshold - Math.max(0, binding.hysteresis));
  if (!wasPressed && value >= threshold) return { pressed: true, edge: 'press' };
  if (wasPressed && value < release) return { pressed: false, edge: 'release' };
  return { pressed: wasPressed, edge: null };
}

/** Channels (1-based) a binding reads. */
export function bindingChannels(binding: DmxBinding): number[] {
  return binding.mode === '16bit' ? [binding.channel, fineChannelOf(binding)] : [binding.channel];
}

/**
 * Parse a universe filter such as "0-3, 8". Empty text means every
 * universe. Returns the sorted list or an error message.
 */
export function parseUniverseFilter(text: string): { universes: number[]; error: string | null } {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { universes: [], error: null };
  const found = new Set<number>();
  for (const part of trimmed.split(/[\s,]+/).filter(Boolean)) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) return { universes: [], error: `"${part}" is not a universe or a range like 0-3` };
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (end < start) return { universes: [], error: `Range ${part} runs backwards` };
    if (end > 63999) return { universes: [], error: 'Universes go up to 63999' };
    if (end - start + 1 + found.size > MAX_UNIVERSE_FILTER) {
      return { universes: [], error: `At most ${MAX_UNIVERSE_FILTER} universes` };
    }
    for (let universe = start; universe <= end; universe += 1) found.add(universe);
  }
  return { universes: [...found].sort((a, b) => a - b), error: null };
}

export function formatUniverseFilter(universes: number[]): string {
  const sorted = [...new Set(universes)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const start = sorted[index];
    let end = start;
    while (sorted[index + 1] === end + 1) { end += 1; index += 1; }
    parts.push(end > start ? `${start}-${end}` : `${start}`);
  }
  return parts.join(', ');
}

export interface DmxLearnCandidate {
  protocol: DmxProtocol;
  universe: number;
  /** 1-based. */
  channel: number;
  span: number;
}

/**
 * Learn by wiggle: tracks how far every channel travels after learn starts
 * and picks the one that moved furthest once any has moved LEARN_MIN_SPAN.
 * A desk that is streaming a static look never trips it; a fader or button
 * does on its first real move.
 */
export function createDmxLearnTracker(minSpan = LEARN_MIN_SPAN) {
  const ranges = new Map<string, { protocol: DmxProtocol; universe: number; channel: number; min: number; max: number }>();
  return {
    observe(protocol: DmxProtocol, universe: number, channelIndex: number, previous: number, next: number) {
      const key = `${protocol}:${universe}:${channelIndex}`;
      let range = ranges.get(key);
      if (!range) {
        range = { protocol, universe, channel: channelIndex + 1, min: previous, max: previous };
        ranges.set(key, range);
      }
      range.min = Math.min(range.min, next);
      range.max = Math.max(range.max, next);
    },
    winner(): DmxLearnCandidate | null {
      let best: DmxLearnCandidate | null = null;
      for (const range of ranges.values()) {
        const span = range.max - range.min;
        if (span < minSpan) continue;
        if (!best || span > best.span || (span === best.span && range.channel < best.channel)) {
          best = { protocol: range.protocol, universe: range.universe, channel: range.channel, span };
        }
      }
      return best;
    },
    /**
     * 16-bit learn. A 16-bit desk fader moves its fine channel much further
     * than its coarse one, so the widest mover is usually the fine channel.
     * When the channel just below the winner moved too, that one is coarse.
     */
    winner16(): DmxLearnCandidate | null {
      const best = this.winner();
      if (!best) return null;
      const below = ranges.get(`${best.protocol}:${best.universe}:${best.channel - 2}`);
      if (below && below.max > below.min) return { ...best, channel: best.channel - 1 };
      return best.channel < DMX_CHANNELS ? best : { ...best, channel: DMX_CHANNELS - 1 };
    },
    reset() { ranges.clear(); },
  };
}
