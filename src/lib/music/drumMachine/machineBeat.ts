/**
 * The drum machine's beats: parts and the song they make.
 *
 * A part is a pattern of sixteen tracks, one per pad, one to four bars of
 * sixteenth steps. Each step has a velocity (0 = off), a roll (1 to 4 hits
 * inside the step) and a chance (how often it plays). A track can be shorter
 * than the part and loop on its own length, so a three-step track drifts
 * across a four-beat bar.
 *
 * A song is the parts laid end to end on a timeline, each block held for a
 * number of bars. Everything here is plain data and pure functions, so the
 * scheduler can look ahead and a test can check exactly what lands where.
 */

import { PAD_COUNT } from './machineKits';

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;
export const PART_BARS = [1, 2, 4] as const;
export type PartBars = (typeof PART_BARS)[number];
export const MAX_PARTS = 16;
export const MAX_BLOCKS = 128;
export const MAX_BLOCK_BARS = 64;

export type PartKind = 'loop' | 'fill' | 'break' | 'build' | 'drop' | 'intro' | 'outro';

export const PART_KINDS: { id: PartKind; label: string }[] = [
  { id: 'intro', label: 'Intro' },
  { id: 'loop', label: 'Loop' },
  { id: 'fill', label: 'Fill' },
  { id: 'break', label: 'Break' },
  { id: 'build', label: 'Build' },
  { id: 'drop', label: 'Drop' },
  { id: 'outro', label: 'Outro' },
];

export interface Track {
  /** Velocity per step, 0-1; 0 is off. */
  vel: number[];
  /** Hits per step, 1-4. */
  roll: number[];
  /** Chance a step plays, 0-1. */
  chance: number[];
  /** Steps before the track loops, 1 to the part's length. */
  length: number;
  mute: boolean;
}

export interface Part {
  id: string;
  name: string;
  kind: PartKind;
  bars: PartBars;
  /** 0 (straight) to 0.5: how late every second sixteenth lands, as a share of a step. */
  swing: number;
  tracks: Track[];
}

export interface Block {
  id: string;
  partId: string;
  /** Bars the block lasts; the part loops inside it. */
  bars: number;
}

export interface Beat {
  name: string;
  kitId: string;
  parts: Part[];
  /** The song: parts on the timeline, in order. */
  song: Block[];
  /** Per pad: level and tune, 0-1 with 0.5 meaning as the kit has it. */
  padLevel: number[];
  padTune: number[];
}

export interface MachineHit {
  beat: number;
  pad: number;
  velocity: number;
}

let nextId = 1;
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

export function emptyTrack(steps: number): Track {
  return { vel: new Array(steps).fill(0), roll: new Array(steps).fill(1), chance: new Array(steps).fill(1), length: steps, mute: false };
}

export function partSteps(part: Pick<Part, 'bars'>): number {
  return part.bars * STEPS_PER_BAR;
}

export function emptyPart(name = 'Loop', kind: PartKind = 'loop', bars: PartBars = 1): Part {
  const steps = bars * STEPS_PER_BAR;
  return { id: newId('part'), name, kind, bars, swing: 0, tracks: Array.from({ length: PAD_COUNT }, () => emptyTrack(steps)) };
}

function withHits(part: Part, hits: Record<number, Array<number | [number, number]>>): Part {
  for (const [pad, list] of Object.entries(hits)) {
    for (const h of list) {
      const [step, vel] = Array.isArray(h) ? h : [h, 0.85];
      part.tracks[Number(pad)].vel[step] = vel;
    }
  }
  return part;
}

/** A beat to start from: a loop, a fill and a break, already laid out as a short song. */
export function starterBeat(kitId: string): Beat {
  const loop = withHits(emptyPart('Loop', 'loop'), {
    0: [[0, 1], [10, 0.8]], 2: [4, 12], 4: [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, s % 4 === 2 ? 0.75 : 0.5] as [number, number]), 5: [[14, 0.6]],
  });
  const fill = withHits(emptyPart('Fill', 'fill'), {
    0: [[0, 1], [10, 0.8]], 2: [4, [10, 0.5], [13, 0.6], [14, 0.8], [15, 1]], 8: [[12, 0.8]], 9: [[13, 0.8]], 10: [[14, 0.9]], 14: [],
  });
  fill.tracks[2].roll[15] = 3;
  const brk = withHits(emptyPart('Break', 'break'), { 4: [0, 3, 6, 8, 11, 14].map((s) => [s, 0.6] as [number, number]), 6: [[4, 0.7], [12, 0.7]] });
  // Fixed ids, so two new projects are the same.
  loop.id = 'part-a';
  fill.id = 'part-b';
  brk.id = 'part-c';
  return {
    name: 'New beat',
    kitId,
    parts: [loop, fill, brk],
    song: [
      { id: 'blk-1', partId: loop.id, bars: 3 },
      { id: 'blk-2', partId: fill.id, bars: 1 },
      { id: 'blk-3', partId: brk.id, bars: 2 },
      { id: 'blk-4', partId: loop.id, bars: 4 },
    ],
    padLevel: new Array(PAD_COUNT).fill(0.5),
    padTune: new Array(PAD_COUNT).fill(0.5),
  };
}

// ── Editing (each returns a new part) ───────────────────────────────────

function mapTrack(part: Part, pad: number, fn: (t: Track) => Track): Part {
  if (pad < 0 || pad >= part.tracks.length) return part;
  return { ...part, tracks: part.tracks.map((t, i) => (i === pad ? fn(t) : t)) };
}

export function setStep(part: Part, pad: number, step: number, change: { vel?: number; roll?: number; chance?: number }): Part {
  if (step < 0 || step >= partSteps(part)) return part;
  return mapTrack(part, pad, (t) => {
    const next = { ...t, vel: [...t.vel], roll: [...t.roll], chance: [...t.chance] };
    if (change.vel !== undefined) next.vel[step] = clamp(change.vel, 0, 1);
    if (change.roll !== undefined) next.roll[step] = Math.round(clamp(change.roll, 1, 4));
    if (change.chance !== undefined) next.chance[step] = clamp(change.chance, 0, 1);
    return next;
  });
}

/** Off turns on at `vel`; on turns off. */
export function toggleStep(part: Part, pad: number, step: number, vel = 0.85): Part {
  const on = (part.tracks[pad]?.vel[step] ?? 0) > 0;
  return setStep(part, pad, step, on ? { vel: 0, roll: 1, chance: 1 } : { vel });
}

export function setTrackLength(part: Part, pad: number, length: number): Part {
  return mapTrack(part, pad, (t) => ({ ...t, length: Math.round(clamp(length, 1, partSteps(part))) }));
}

export function toggleMute(part: Part, pad: number): Part {
  return mapTrack(part, pad, (t) => ({ ...t, mute: !t.mute }));
}

export function clearTrack(part: Part, pad: number): Part {
  return mapTrack(part, pad, (t) => ({ ...emptyTrack(partSteps(part)), length: t.length, mute: t.mute }));
}

/** Change the length in bars, repeating a shorter part to fill the new one. */
export function resizePart(part: Part, bars: PartBars): Part {
  if (bars === part.bars) return part;
  const steps = bars * STEPS_PER_BAR;
  const old = partSteps(part);
  const fit = (row: number[], fill: number) => Array.from({ length: steps }, (_, i) => (bars > part.bars ? row[i % old] : row[i]) ?? fill);
  return {
    ...part,
    bars,
    tracks: part.tracks.map((t) => ({
      vel: fit(t.vel, 0),
      roll: fit(t.roll, 1),
      chance: fit(t.chance, 1),
      length: t.length === old ? steps : Math.min(t.length, steps),
      mute: t.mute,
    })),
  };
}

/** Shift a track's hits by `by` steps, wrapping within its length. */
export function nudgeTrack(part: Part, pad: number, by: number): Part {
  return mapTrack(part, pad, (t) => {
    const n = t.length;
    const rot = (row: number[]) => row.map((v, i) => (i < n ? row[(((i - by) % n) + n) % n] : v));
    return { ...t, vel: rot(t.vel), roll: rot(t.roll), chance: rot(t.chance) };
  });
}

/** Spread `hits` evenly over the track's length (the even-spacing rhythms of many traditions). */
export function spreadHits(part: Part, pad: number, hits: number, vel = 0.85): Part {
  return mapTrack(part, pad, (t) => {
    const n = t.length;
    const k = Math.round(clamp(hits, 0, n));
    const next = { ...t, vel: [...t.vel], roll: [...t.roll], chance: [...t.chance] };
    for (let i = 0; i < n; i++) {
      const on = k > 0 && (i * k) % n < k;
      next.vel[i] = on ? vel : 0;
      next.roll[i] = 1;
      next.chance[i] = 1;
    }
    return next;
  });
}

export function duplicatePart(part: Part, name?: string): Part {
  return { ...structuredCloneSafe(part), id: newId('part'), name: name ?? `${part.name} 2` };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── Song editing ────────────────────────────────────────────────────────

export function songBars(song: Block[]): number {
  return song.reduce((sum, b) => sum + b.bars, 0);
}

export function addBlock(song: Block[], partId: string, bars: number, at = song.length): Block[] {
  if (song.length >= MAX_BLOCKS) return song;
  const next = [...song];
  next.splice(Math.max(0, Math.min(song.length, at)), 0, { id: newId('blk'), partId, bars: Math.round(clamp(bars, 1, MAX_BLOCK_BARS)) });
  return next;
}

export function moveBlock(song: Block[], from: number, to: number): Block[] {
  if (from < 0 || from >= song.length) return song;
  const next = [...song];
  const [b] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, b);
  return next;
}

export function resizeBlock(song: Block[], id: string, bars: number): Block[] {
  return song.map((b) => (b.id === id ? { ...b, bars: Math.round(clamp(bars, 1, MAX_BLOCK_BARS)) } : b));
}

export function removeBlock(song: Block[], id: string): Block[] {
  return song.filter((b) => b.id !== id);
}

/** The block playing at `bar` of the song, and the bar it started on. Null past the end. */
export function blockAt(song: Block[], bar: number): { index: number; startBar: number } | null {
  let start = 0;
  for (let i = 0; i < song.length; i++) {
    if (bar < start + song[i].bars) return { index: i, startBar: start };
    start += song[i].bars;
  }
  return null;
}

// ── Playing ─────────────────────────────────────────────────────────────

/** A repeatable 0-1 number for a step's chance, so a recorded take and its replay agree. */
function dice(loop: number, step: number, pad: number): number {
  let h = (loop * 73856093) ^ (step * 19349663) ^ (pad * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Every hit of `part` whose beat is in [fromBeat, toBeat), with the part's
 * first step on `originBeat`. Hits come out in time order.
 */
export function partHitsBetween(part: Part, originBeat: number, fromBeat: number, toBeat: number, solo: number | null = null): MachineHit[] {
  if (!(toBeat > fromBeat)) return [];
  const out: MachineHit[] = [];
  const stepBeats = 1 / STEPS_PER_BEAT;
  const firstStep = Math.max(0, Math.floor((fromBeat - originBeat) / stepBeats) - 1);
  const lastStep = Math.ceil((toBeat - originBeat) / stepBeats);
  for (let g = firstStep; g <= lastStep; g++) {
    const straight = originBeat + g * stepBeats;
    const beat = g % 2 === 1 ? straight + part.swing * stepBeats : straight;
    for (let pad = 0; pad < part.tracks.length; pad++) {
      const t = part.tracks[pad];
      if (t.mute || (solo !== null && solo !== pad)) continue;
      const step = g % t.length;
      const vel = t.vel[step] ?? 0;
      if (vel <= 0) continue;
      if ((t.chance[step] ?? 1) < 1 && dice(Math.floor(g / t.length), step, pad) >= t.chance[step]) continue;
      const roll = t.roll[step] ?? 1;
      for (let r = 0; r < roll; r++) {
        const b = beat + (r * stepBeats) / roll;
        if (b >= fromBeat && b < toBeat) out.push({ beat: b, pad, velocity: r === 0 ? vel : vel * (0.7 + 0.3 * (r / roll)) });
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat || a.pad - b.pad);
}

/**
 * The song's hits in [fromBeat, toBeat), the song starting on `originBeat`.
 * Each block plays its part from the block's start; `loop` plays the song again from the top.
 */
export function songHitsBetween(beat: Pick<Beat, 'parts' | 'song'>, originBeat: number, fromBeat: number, toBeat: number, loop = true): MachineHit[] {
  const total = songBars(beat.song) * 4;
  if (!total || !(toBeat > fromBeat)) return [];
  const parts = new Map(beat.parts.map((p) => [p.id, p]));
  const out: MachineHit[] = [];
  const firstPass = Math.max(0, Math.floor((fromBeat - originBeat) / total));
  const lastPass = loop ? Math.floor((toBeat - originBeat) / total) : 0;
  for (let pass = firstPass; pass <= lastPass; pass++) {
    let start = originBeat + pass * total;
    for (const block of beat.song) {
      const end = start + block.bars * 4;
      const part = parts.get(block.partId);
      if (part && end > fromBeat && start < toBeat) {
        for (const h of partHitsBetween(part, start, Math.max(fromBeat, start), Math.min(toBeat, end))) out.push(h);
      }
      start = end;
    }
  }
  return out.sort((a, b) => a.beat - b.beat || a.pad - b.pad);
}

// ── Saving ──────────────────────────────────────────────────────────────

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

function normalizeTrack(raw: unknown, steps: number): Track {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Track, unknown>>;
  const row = (v: unknown, fallback: number, min: number, max: number) => {
    const list = Array.isArray(v) ? v : [];
    return Array.from({ length: steps }, (_, i) => num(list[i], fallback, min, max));
  };
  return {
    vel: row(t.vel, 0, 0, 1),
    roll: row(t.roll, 1, 1, 4).map(Math.round),
    chance: row(t.chance, 1, 0, 1),
    length: Math.round(num(t.length, steps, 1, steps)),
    mute: t.mute === true,
  };
}

export function normalizePart(raw: unknown): Part | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<Record<keyof Part, unknown>>;
  const bars = (PART_BARS as readonly number[]).includes(Number(p.bars)) ? (Number(p.bars) as PartBars) : 1;
  const steps = bars * STEPS_PER_BAR;
  const tracks = Array.isArray(p.tracks) ? p.tracks : [];
  return {
    id: typeof p.id === 'string' && p.id ? p.id : newId('part'),
    name: typeof p.name === 'string' ? p.name.slice(0, 40) : 'Part',
    kind: PART_KINDS.some((k) => k.id === p.kind) ? (p.kind as PartKind) : 'loop',
    bars,
    swing: num(p.swing, 0, 0, 0.5),
    tracks: Array.from({ length: PAD_COUNT }, (_, i) => normalizeTrack(tracks[i], steps)),
  };
}

export function normalizeBeat(raw: unknown, fallbackKit: string): Beat {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Beat, unknown>>;
  const parts = (Array.isArray(b.parts) ? b.parts : []).map(normalizePart).filter((p): p is Part => !!p).slice(0, MAX_PARTS);
  if (!parts.length) return starterBeat(typeof b.kitId === 'string' ? b.kitId : fallbackKit);
  const ids = new Set(parts.map((p) => p.id));
  const song = (Array.isArray(b.song) ? b.song : [])
    .map((x) => (x && typeof x === 'object' ? (x as Partial<Block>) : null))
    .filter((x): x is Partial<Block> => !!x && typeof x.partId === 'string' && ids.has(x.partId))
    .slice(0, MAX_BLOCKS)
    .map((x) => ({ id: typeof x.id === 'string' && x.id ? x.id : newId('blk'), partId: x.partId!, bars: Math.round(num(x.bars, 1, 1, MAX_BLOCK_BARS)) }));
  const pads = (v: unknown) => Array.from({ length: PAD_COUNT }, (_, i) => num(Array.isArray(v) ? v[i] : undefined, 0.5, 0, 1));
  return {
    name: typeof b.name === 'string' && b.name ? b.name.slice(0, 60) : 'Beat',
    kitId: typeof b.kitId === 'string' ? b.kitId : fallbackKit,
    parts,
    song,
    padLevel: pads(b.padLevel),
    padTune: pads(b.padTune),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
