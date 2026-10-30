/**
 * Visual voices: every visual follows one sound.
 *
 * A visual voice is a shader on a deck row that declares the `vx` inputs.
 * Its `vxSource` input says which sound it follows (the kick, the hats, the
 * bass, the chords...), and every frame the studio works out that sound's
 * signals and writes them into the clip:
 *
 *   vxEnv       how strongly the sound is playing now, 0-1 (fast attack, its own release)
 *   vxHit       a flash on every note or hit, gone in about a tenth of a second
 *   vxVel       velocity of the latest note
 *   vxPitch     the latest note, MIDI / 127; vxGlide eases towards it
 *   vxPhase     a motion clock that only runs forward, faster while the sound plays
 *   vxCount     notes so far, wrapping at 64, for every-fourth-hit changes
 *   vxPresence  1 while the sound is part of the music, easing out over about a bar after it stops
 *   vxNote0-3   up to four of its sounding notes (MIDI / 127), with vxNoteE0-3 their energy
 *
 * and the clock every voice shares: vxBeat and vxBar (0-1 through the beat
 * and the bar), vxBars (bars, wrapping at 64) and vxEnergy (the whole band,
 * smoothed). Motion built from these stays locked to the music: hits are
 * exact, continuous movement comes from vxPhase rather than raw loudness,
 * and changes can wait for a bar line.
 *
 * With `vxAuto` on, a voice shows only while its sound plays (vxPresence),
 * so a scene builds and strips back with the track by itself.
 *
 * Everything here is pure and driven by the audio clock: the runtime pushes
 * note events (which may be scheduled a little ahead) and advances the time.
 */

import { type DrumVoice, type InstrumentId, type NoteEvent } from './noteEvents';
import type { LoopRole } from './loops';

export const VOICE_SOURCES = [
  { id: 'all', label: 'Everything' },
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare and clap' },
  { id: 'hats', label: 'Hats' },
  { id: 'perc', label: 'Toms and crash' },
  { id: 'bass', label: 'Bass' },
  { id: 'lead', label: 'Lead' },
  { id: 'chords', label: 'Chords' },
  { id: 'pad', label: 'Pads and textures' },
  { id: 'fx', label: 'Shots and siren' },
  { id: 'played', label: 'What you play' },
] as const;

export type VoiceSourceId = (typeof VOICE_SOURCES)[number]['id'];

export const VOICE_SOURCE_COUNT = VOICE_SOURCES.length;

/** The performer's inputs: which sound a voice follows, and whether it comes and goes with it. */
export const VOICE_SOURCE_INPUT = 'vxSource';
export const VOICE_AUTO_INPUT = 'vxAuto';

/** Notes of a source a shader can see at once. */
export const VOICE_NOTE_SLOTS = 4;

/** Inputs the studio writes every frame. Shaders declare any of them as float inputs. */
export const VOICE_DRIVEN_INPUTS: readonly string[] = [
  'vxEnv',
  'vxHit',
  'vxVel',
  'vxPitch',
  'vxGlide',
  'vxPhase',
  'vxCount',
  'vxPresence',
  ...Array.from({ length: VOICE_NOTE_SLOTS }, (_, i) => `vxNote${i}`),
  ...Array.from({ length: VOICE_NOTE_SLOTS }, (_, i) => `vxNoteE${i}`),
  'vxBeat',
  'vxBar',
  'vxBars',
  'vxEnergy',
];

const VOICE_DRIVEN_SET = new Set(VOICE_DRIVEN_INPUTS);

export function isVoiceDrivenInput(name: string): boolean {
  return VOICE_DRIVEN_SET.has(name);
}

/** How each source's envelope moves, in seconds. One-shot sources decay from the hit. */
interface SourceShape {
  attack: number;
  release: number;
  oneShot: boolean;
}

const SHAPES: Record<VoiceSourceId, SourceShape> = {
  all: { attack: 0.004, release: 0.3, oneShot: false },
  kick: { attack: 0.002, release: 0.28, oneShot: true },
  snare: { attack: 0.002, release: 0.22, oneShot: true },
  hats: { attack: 0.001, release: 0.09, oneShot: true },
  perc: { attack: 0.002, release: 0.45, oneShot: true },
  bass: { attack: 0.008, release: 0.35, oneShot: false },
  lead: { attack: 0.01, release: 0.3, oneShot: false },
  chords: { attack: 0.02, release: 0.7, oneShot: false },
  pad: { attack: 0.35, release: 1.8, oneShot: false },
  fx: { attack: 0.005, release: 0.8, oneShot: false },
  played: { attack: 0.006, release: 0.4, oneShot: false },
};

const HIT_SECONDS = 0.08;
const GLIDE_SECONDS = 0.12;
const ENERGY_SECONDS = 0.35;
const PHASE_WRAP = 1000;
const COUNT_WRAP = 64;
/** A sound counts as part of the music for this many beats after its last note. */
const PRESENCE_HOLD_BEATS = 8;
/** Presence comes in quickly and goes out over about a bar. */
const PRESENCE_IN_SECONDS = 0.25;
const PRESENCE_OUT_BEATS = 3;

/** Which drum source each kit voice belongs to. */
const DRUM_SOURCE: Record<DrumVoice, VoiceSourceId> = {
  kick: 'kick',
  snare: 'snare',
  clap: 'snare',
  rim: 'snare',
  hatClosed: 'hats',
  hatOpen: 'hats',
  tom: 'perc',
  crash: 'perc',
};

/** Parts an instrument plays whatever the set. */
const FIXED_SOURCES: Partial<Record<InstrumentId, VoiceSourceId[]>> = {
  dubbass: ['bass'],
  acid: ['bass'],
  drone: ['pad', 'chords'],
  bowls: ['pad'],
  siren: ['fx'],
  shots: ['fx'],
  xy: ['lead'],
  scan: ['pad'],
};

const ROLE_SOURCE: Record<LoopRole, VoiceSourceId> = { bass: 'bass', lead: 'lead', chords: 'chords', texture: 'pad' };

/** What decides an event's sources besides the event itself. */
export interface SourceContext {
  /** The instrument on the keys. */
  played: InstrumentId;
  /** Which instrument plays each part now: the set's, or a recorded loop's in that slot. */
  roles: Partial<Record<LoopRole, InstrumentId[]>>;
}

/** Every source a note belongs to. */
export function sourcesForEvent(event: Pick<NoteEvent, 'instrument' | 'note' | 'drum'>, ctx: SourceContext): VoiceSourceId[] {
  const out = new Set<VoiceSourceId>(['all']);
  if (event.instrument === 'drums') {
    if (event.drum) out.add(DRUM_SOURCE[event.drum]);
    return [...out];
  }
  for (const s of FIXED_SOURCES[event.instrument] ?? []) out.add(s);
  for (const [role, instruments] of Object.entries(ctx.roles) as [LoopRole, InstrumentId[]][]) {
    if (instruments?.includes(event.instrument)) out.add(ROLE_SOURCE[role]);
  }
  // The keyboards and synths count as bass low down.
  if ((event.instrument === 'synth' || event.instrument === 'keys' || event.instrument === 'analog') && event.note < 48) out.add('bass');
  if (event.instrument === ctx.played) out.add('played');
  return [...out];
}

interface Sounding {
  note: number;
  velocity: number;
  onTime: number;
  offTime: number | null;
  /** Drum hits decay from the hit whatever the source. */
  oneShot: boolean;
}

interface SourceState {
  notes: Sounding[];
  hit: number;
  vel: number;
  pitch: number;
  glide: number;
  phase: number;
  count: number;
  lastOn: number;
  presence: number;
}

function freshState(): SourceState {
  return { notes: [], hit: 0, vel: 0, pitch: 0, glide: 0, phase: 0, count: 0, lastOn: -Infinity, presence: 0 };
}

/** One note's envelope at `time`. */
export function noteEnvelope(shape: SourceShape, n: Sounding, time: number): number {
  const oneShot = shape.oneShot || n.oneShot;
  const level = (t: number) => {
    const age = t - n.onTime;
    if (age < 0) return 0;
    const rise = Math.min(1, age / Math.max(0.001, shape.attack));
    const after = Math.max(0, age - shape.attack);
    if (oneShot) return rise * Math.exp((-3 * after) / Math.max(0.001, shape.release));
    // Held notes settle a little below their peak.
    return rise * (0.75 + 0.25 * Math.exp(-after / 0.6));
  };
  if (oneShot || n.offTime === null || time < n.offTime) return n.velocity * level(time);
  return n.velocity * level(n.offTime) * Math.exp((-3 * (time - n.offTime)) / Math.max(0.001, shape.release));
}

export interface VoiceClock {
  /** Launch-clock beats, and seconds per beat. */
  beat: number;
  beatSeconds: number;
}

export class VoiceSignals {
  private states = Object.fromEntries(VOICE_SOURCES.map((s) => [s.id, freshState()])) as Record<VoiceSourceId, SourceState>;
  private pending: Array<{ event: NoteEvent; sources: VoiceSourceId[] }> = [];
  private clock = 0;
  private energy = 0;
  private beat = 0;
  private beatSeconds = 0.5;

  /** Queue an event for the sources it belongs to; it takes effect when the clock reaches it. */
  push(event: NoteEvent, sources: VoiceSourceId[]): void {
    const time = Number.isFinite(event.time) ? Math.max(event.time, this.clock) : this.clock;
    const queued = { event: { ...event, time }, sources };
    let i = this.pending.length;
    while (i > 0 && this.pending[i - 1].event.time > time) i--;
    this.pending.splice(i, 0, queued);
  }

  /** Move to `time` on the audio clock. */
  advance(time: number, clock: VoiceClock): void {
    this.beat = clock.beat;
    this.beatSeconds = Math.max(0.05, clock.beatSeconds);
    if (!(time > this.clock)) return;
    while (this.pending.length && this.pending[0].event.time <= time) {
      const { event, sources } = this.pending.shift()!;
      this.integrate(event.time);
      for (const id of sources) this.apply(this.states[id], event);
    }
    this.integrate(time);
  }

  /** Let every held note go (stop, panic); what is showing still fades. */
  releaseAll(): void {
    this.pending = this.pending.filter((p) => p.event.type === 'off');
    for (const state of Object.values(this.states)) {
      for (const n of state.notes) if (n.offTime === null) n.offTime = this.clock;
    }
  }

  get time(): number {
    return this.clock;
  }

  /** True while anything is moving that a voice would show. */
  isActive(): boolean {
    return Object.values(this.states).some((s) => s.notes.length > 0 || s.hit > 0.001 || s.presence > 0.001) || this.energy > 0.001;
  }

  /** The inputs for a voice following `source`. Without `auto` it is always present. */
  inputs(source: VoiceSourceId, auto: boolean): Record<string, number> {
    const state = this.states[source];
    const shape = SHAPES[source];
    let env = 0;
    const sounding = state.notes
      .map((n) => ({ note: n.note, energy: noteEnvelope(shape, n, this.clock) }))
      .sort((a, b) => b.energy - a.energy);
    for (const n of sounding) env = Math.max(env, n.energy);
    const out: Record<string, number> = {
      vxEnv: env,
      vxHit: state.hit,
      vxVel: state.vel,
      vxPitch: state.pitch,
      vxGlide: state.glide,
      vxPhase: state.phase,
      vxCount: state.count,
      vxPresence: auto ? state.presence : 1,
      vxBeat: fract(this.beat),
      vxBar: fract(this.beat / 4),
      vxBars: Math.floor(this.beat / 4) % COUNT_WRAP,
      vxEnergy: this.energy,
    };
    for (let i = 0; i < VOICE_NOTE_SLOTS; i++) {
      out[`vxNote${i}`] = sounding[i] ? sounding[i].note / 127 : 0;
      out[`vxNoteE${i}`] = sounding[i] ? sounding[i].energy : 0;
    }
    return out;
  }

  private apply(state: SourceState, event: NoteEvent): void {
    if (event.type === 'off') {
      const n = state.notes.find((x) => x.note === event.note && x.offTime === null);
      if (n) n.offTime = event.time;
      return;
    }
    // A retriggered pitch replaces its old note.
    state.notes = state.notes.filter((x) => x.note !== event.note || x.offTime !== null);
    const oneShot = event.instrument === 'drums';
    state.notes.push({ note: event.note, velocity: event.velocity, onTime: event.time, offTime: oneShot ? event.time : null, oneShot });
    if (state.notes.length > 16) state.notes.splice(0, state.notes.length - 16);
    state.hit = Math.max(state.hit, event.velocity);
    state.vel = event.velocity;
    state.pitch = event.note / 127;
    if (state.count === 0 && state.lastOn === -Infinity) state.glide = state.pitch;
    state.count = (state.count + 1) % COUNT_WRAP;
    state.lastOn = event.time;
  }

  private integrate(time: number): void {
    const dt = time - this.clock;
    if (!(dt > 0)) return;
    this.clock = time;
    const hitDecay = Math.exp(-dt / HIT_SECONDS);
    const glideStep = 1 - Math.exp(-dt / GLIDE_SECONDS);
    const presenceIn = 1 - Math.exp(-dt / PRESENCE_IN_SECONDS);
    const presenceOut = 1 - Math.exp(-dt / (PRESENCE_OUT_BEATS * this.beatSeconds));
    const holdSeconds = PRESENCE_HOLD_BEATS * this.beatSeconds;
    for (const id of Object.keys(this.states) as VoiceSourceId[]) {
      const state = this.states[id];
      const shape = SHAPES[id];
      let env = 0;
      for (const n of state.notes) env = Math.max(env, noteEnvelope(shape, n, time));
      state.notes = state.notes.filter((n) => n.offTime === null || noteEnvelope(shape, n, time) > 0.001);
      state.hit *= hitDecay;
      state.glide += (state.pitch - state.glide) * glideStep;
      state.phase = (state.phase + dt * (0.2 + 1.8 * env)) % PHASE_WRAP;
      const held = state.notes.some((n) => n.offTime === null);
      const active = held || time - state.lastOn < holdSeconds;
      state.presence += ((active ? 1 : 0) - state.presence) * (active ? presenceIn : presenceOut);
      if (id === 'all') this.energy += (env - this.energy) * (1 - Math.exp(-dt / ENERGY_SECONDS));
    }
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** The source a `vxSource` input value names. */
export function voiceSourceAt(value: unknown): VoiceSourceId {
  const i = Math.round(Number(value));
  return VOICE_SOURCES[Number.isFinite(i) && i >= 0 && i < VOICE_SOURCE_COUNT ? i : 0].id;
}

export function voiceSourceIndex(id: VoiceSourceId): number {
  return VOICE_SOURCES.findIndex((s) => s.id === id);
}
