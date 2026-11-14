// Studio voices on the phone: the desktop's visual voice shaders (VX-*.fs),
// driven by what the phone hears.
//
// On the desktop each voice follows one sound of the music (the kick, the bass,
// the chords...) through signals the studio writes every frame: an envelope
// (vxEnv), a pulse per hit (vxHit), the latest note (vxPitch), up to four
// sounding notes (vxNote0-3 with their energies vxNoteE0-3), smooth motion
// signals (vxSwell, vxPulse, vxFlow, vxMorph, vxLevel), clocks (vxPhase,
// vxBeat, vxBar, vxBars) and more. The phone has no notes, only a spectrum, so
// this module listens for each sound in its part of the spectrum: a hit is a
// sudden rise of energy in that part (the kick low down, hats at the top), a
// held sound is its loudness against its own recent peak, and notes are the
// strongest peaks of the spectrum in the sound's range, held until that sound
// plays again. With no source listening it plays a slow, quiet groove so a
// voice is never a dead picture.
//
// One `VoiceSignals` serves every voice on screen: it is updated once a frame
// and each voice asks for the source it follows. Everything here is plain
// arithmetic on numbers, so it is tested without a GPU.

/** The sounds a voice can follow, in the order shaders see them (vxSource). */
export const VOICE_SOURCE_IDS = ['all', 'kick', 'snare', 'hats', 'perc', 'bass', 'lead', 'chords', 'pad', 'fx', 'played', 'bowls', 'drone', 'xy', 'analog', 'scan', 'echo', 'drop', 'siren', 'acid', 'dubbass'] as const;
export type VoiceSourceId = (typeof VOICE_SOURCE_IDS)[number];

/** Inputs the phone writes every frame; a voice's controls never show them. */
export const VOICE_DRIVEN_INPUTS: readonly string[] = [
  'vxEnv', 'vxHit', 'vxVel', 'vxPitch', 'vxGlide', 'vxPhase', 'vxCount', 'vxPresence',
  'vxNote0', 'vxNote1', 'vxNote2', 'vxNote3', 'vxNoteE0', 'vxNoteE1', 'vxNoteE2', 'vxNoteE3',
  'vxBeat', 'vxBar', 'vxBars', 'vxEnergy', 'vxSwell', 'vxPulse', 'vxFlow', 'vxMorph', 'vxLevel',
];
/** Inputs a voice has that the phone does not offer: its transparent background and lettering. */
const HIDDEN_INPUT = /^(vxClear|vxTxt\w*|vxText\w*)$/;
const DRIVEN = new Set(VOICE_DRIVEN_INPUTS);
/** True for a voice input the phone sets itself, so no control shows for it. */
export function isVoiceDrivenInput(name: string): boolean {
  return DRIVEN.has(name) || HIDDEN_INPUT.test(name);
}

/** Where in the spectrum the phone listens for a sound, in Hz. */
type Band = 'kick' | 'low' | 'body' | 'mid' | 'snap' | 'air' | 'full';
const BANDS: Record<Band, [number, number]> = {
  kick: [35, 130],
  low: [40, 260],
  body: [130, 600],
  mid: [260, 2400],
  snap: [1800, 6000],
  air: [7000, 16000],
  full: [35, 16000],
};
/** The shortest gap between two hits of a band, in seconds. */
const REFRACTORY: Record<Band, number> = { kick: 0.16, low: 0.16, body: 0.12, mid: 0.1, snap: 0.1, air: 0.06, full: 0.12 };
/**
 * Below this amplitude a band is silent whatever its peak. High bands carry far less
 * energy in a mix (hats sit about 25 dB under the kick), so their floor is lower.
 */
const SILENCE: Record<Band, number> = { kick: 0.0005, low: 0.0005, body: 0.0003, mid: 0.0002, snap: 0.00006, air: 0.00003, full: 0.0002 };
/**
 * How far above its usual frame-to-frame change a band must rise to count as a hit, in
 * deviations. The snap band also carries keys, leads and vocals, so it asks for more.
 */
const HIT_DEVIATIONS: Record<Band, number> = { kick: 2.2, low: 2.2, body: 2.4, mid: 2.4, snap: 3.2, air: 2.2, full: 2.4 };
/** On a frame where the excluded sound also hit, a hit must rise this many times its threshold. */
const CROWDED_FACTOR = 2;

interface SourceDef {
  band: Band;
  /** Envelope rise and fall in seconds (the desktop's shapes); one-shot sounds decay from the hit. */
  attack: number;
  release: number;
  oneShot: boolean;
  /** The note a drum sound reports (General MIDI), so pitch is steady. */
  drum?: number;
  /** A second band that must rise at the same moment: a snare's crack comes with its body, a lead's note does not. */
  with?: Band;
  /** A band whose hit at the same moment means it was another sound (a kick's click is not a snare). */
  not?: Band;
  /** Hit only when the whole mix surges after a quieter stretch (a drop), not on every beat. */
  surge?: boolean;
  /** Notes heard in this range of Hz, for melodic sounds. */
  notes?: [number, number];
}
const SOURCES: Record<VoiceSourceId, SourceDef> = {
  all: { band: 'full', attack: 0.004, release: 0.3, oneShot: false, notes: [80, 2000] },
  kick: { band: 'kick', attack: 0.002, release: 0.28, oneShot: true, drum: 36 },
  snare: { band: 'snap', attack: 0.002, release: 0.22, oneShot: true, drum: 38, with: 'body', not: 'kick' },
  hats: { band: 'air', attack: 0.001, release: 0.09, oneShot: true, drum: 42 },
  perc: { band: 'body', attack: 0.002, release: 0.45, oneShot: true, drum: 45 },
  bass: { band: 'low', attack: 0.008, release: 0.35, oneShot: false, notes: [40, 260] },
  lead: { band: 'mid', attack: 0.01, release: 0.3, oneShot: false, notes: [260, 2400] },
  chords: { band: 'mid', attack: 0.02, release: 0.7, oneShot: false, notes: [150, 1400] },
  pad: { band: 'mid', attack: 0.35, release: 1.8, oneShot: false, notes: [150, 1400] },
  fx: { band: 'snap', attack: 0.005, release: 0.8, oneShot: false, notes: [600, 6000] },
  played: { band: 'mid', attack: 0.006, release: 0.4, oneShot: false, notes: [260, 2400] },
  bowls: { band: 'mid', attack: 0.003, release: 2.2, oneShot: true, notes: [200, 1600] },
  drone: { band: 'body', attack: 0.4, release: 2, oneShot: false, notes: [60, 600] },
  xy: { band: 'mid', attack: 0.02, release: 0.5, oneShot: false, notes: [260, 2400] },
  analog: { band: 'body', attack: 0.006, release: 0.35, oneShot: false, notes: [80, 1200] },
  scan: { band: 'mid', attack: 0.05, release: 0.6, oneShot: false, notes: [150, 1400] },
  echo: { band: 'snap', attack: 0.002, release: 0.25, oneShot: true, drum: 76 },
  drop: { band: 'full', attack: 0.002, release: 1.2, oneShot: true, drum: 120, surge: true },
  siren: { band: 'snap', attack: 0.01, release: 0.5, oneShot: false, notes: [600, 4000] },
  acid: { band: 'body', attack: 0.004, release: 0.25, oneShot: false, notes: [80, 1200] },
  dubbass: { band: 'low', attack: 0.008, release: 0.35, oneShot: false, notes: [40, 260] },
};

/** What the phone's analyser gives each frame. */
export interface VoiceAudioFrame {
  /** Byte spectrum as the analyser gives it (-100..-30 dB over 0..255), lowest frequency first. */
  spectrum: ArrayLike<number>;
  /** Sample rate the spectrum was taken at; its bins are sampleRate / (2 * bins) wide. */
  sampleRate: number;
  /** Detected tempo, 0 when unsure. */
  bpm?: number;
  /** 0..1 through the beat, once a tempo is detected. */
  beatPhase?: number;
}

// The smooth signals, with the desktop's timings (its Music motion maths).
const SWELL_RISE = 0.06, SWELL_FALL = 0.45, KICK_DECAY = 0.45, PULSE_RISE = 0.035, MORPH_OMEGA = 7;
const ATT_SECONDS = 0.3, USUAL_SECONDS = 4, LEVEL_FLOOR = 0.04, WRAP = 1000, COUNT_WRAP = 64;
const HIT_SECONDS = 0.08, GLIDE_SECONDS = 0.12, ENERGY_SECONDS = 0.35;
const PRESENCE_HOLD_BEATS = 8, PRESENCE_IN = 0.25, PRESENCE_OUT_BEATS = 3;
/** A band's loudness is read against its own peak, which falls back over this long. */
const PEAK_FALL_SECONDS = 12;
/** The bands a drop shows in, and how many dB above their recent level together make one. */
const SURGE_BANDS: Band[] = ['low', 'mid', 'snap', 'air'];
const SURGE_DB = 18;
/** Its noise floor drops to any quieter moment at once and creeps up by a factor of e over this long. */
const FLOOR_RISE_SECONDS = 45;
/** Tempo assumed until one is detected, and for the quiet groove. */
const DEFAULT_BPM = 120;
const IDLE_BPM = 90;

interface BandState {
  level: number;
  smooth: number;
  peak: number;
  /** The quietest the band has been lately (room noise, hum): only sound above it counts. */
  floor: number;
  flux: number;
  /** The rise this frame had to beat to be a hit. */
  threshold: number;
  fluxAvg: number;
  fluxDev: number;
  lastHit: number;
  /** Strength of a hit found this frame (0 for none). */
  hit: number;
}

interface Note { midi: number; energy: number; age: number }

interface SourceState {
  env: number;
  /** One-shot sounds: the latest hits, decaying. */
  strikes: { velocity: number; age: number }[];
  hit: number;
  vel: number;
  pitch: number;
  glide: number;
  phase: number;
  count: number;
  presence: number;
  sinceActive: number;
  notes: Note[];
  swell: number;
  kick: number;
  pulse: number;
  flow: number;
  hits: number;
  morph: number;
  morphVel: number;
  att: number;
  usual: number;
}

const freshBand = (band: Band): BandState => ({ level: 0, smooth: 0, peak: SILENCE[band] * 4, floor: SILENCE[band], flux: 0, threshold: 0, fluxAvg: 0, fluxDev: 0, lastHit: -1e9, hit: 0 });
const freshSource = (id: VoiceSourceId): SourceState => ({ ...blankSource(), pitch: (SOURCES[id].drum ?? 0) / 127, glide: (SOURCES[id].drum ?? 0) / 127 });
const blankSource = (): SourceState => ({ env: 0, strikes: [], hit: 0, vel: 0, pitch: 0, glide: 0, phase: 0, count: 0, presence: 0, sinceActive: 1e9, notes: [], swell: 0, kick: 0, pulse: 0, flow: 0, hits: 0, morph: 0, morphVel: 0, att: 0, usual: 0 });
const approach = (dt: number, seconds: number) => 1 - Math.exp(-dt / Math.max(1e-4, seconds));
const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const fract = (x: number) => x - Math.floor(x);
const amplitude = (byte: number) => Math.pow(10, (-100 + (byte * 70) / 255) / 20);
const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/** The source a vxSource value names; anything unknown follows everything. */
export function voiceSourceAt(value: unknown): VoiceSourceId {
  const i = Math.round(Number(value));
  return VOICE_SOURCE_IDS[Number.isFinite(i) && i >= 0 && i < VOICE_SOURCE_IDS.length ? i : 0];
}

/**
 * Spectral peaks between `lo` and `hi` Hz as MIDI notes with their loudness
 * (amplitude), strongest first, at most `count`, at least a semitone apart.
 * Peak positions are refined between bins so notes are steadier than a bin.
 */
export function spectrumPeaks(spectrum: ArrayLike<number>, sampleRate: number, lo: number, hi: number, count = 4): { midi: number; amp: number }[] {
  const hz = sampleRate / (2 * spectrum.length);
  const from = Math.max(1, Math.floor(lo / hz)), to = Math.min(spectrum.length - 2, Math.ceil(hi / hz));
  const peaks: { midi: number; amp: number }[] = [];
  let mean = 0;
  for (let i = from; i <= to; i++) mean += spectrum[i];
  mean /= Math.max(1, to - from + 1);
  for (let i = from; i <= to; i++) {
    const a = spectrum[i - 1], b = spectrum[i], c = spectrum[i + 1];
    // A peak stands clear of its neighbours and of the range's average (about 3 dB).
    if (b <= a || b < c || b < mean + 11 || b < 40) continue;
    const denom = a - 2 * b + c;
    const offset = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    const freq = (i + offset) * hz;
    if (freq < lo || freq > hi) continue;
    peaks.push({ midi: midiOf(freq), amp: amplitude(b) });
  }
  peaks.sort((x, y) => y.amp - x.amp);
  const kept: { midi: number; amp: number }[] = [];
  for (const p of peaks) {
    if (kept.some((k) => Math.abs(k.midi - p.midi) < 1)) continue;
    kept.push(p);
    if (kept.length >= count) break;
  }
  return kept;
}

export class VoiceSignals {
  private bands = Object.fromEntries((Object.keys(BANDS) as Band[]).map((b) => [b, freshBand(b)])) as Record<Band, BandState>;
  private sources = Object.fromEntries(VOICE_SOURCE_IDS.map((id) => [id, freshSource(id)])) as Record<VoiceSourceId, SourceState>;
  private previous = new Float32Array(0);
  private time = 0;
  private beat = 0;
  private energy = 0;
  private idleBeat = 0;
  /** Each band's loudness in dB over ~0.4 s and over ~8 s, and when the mix last surged, for the drop. */
  private surgeNow: Partial<Record<Band, number>> = {};
  private surgeUsual: Partial<Record<Band, number>> = {};
  private surge = 0;
  private lastSurge = -1e9;
  /** Seconds the current source has been heard. */
  private heard = 0;
  /** True while the signals come from a live source, false while the quiet groove plays. */
  live = false;

  /** Forget everything heard (a new source starts). */
  reset(): void {
    for (const b of Object.keys(this.bands) as Band[]) this.bands[b] = freshBand(b);
    for (const id of VOICE_SOURCE_IDS) this.sources[id] = freshSource(id);
    this.previous = new Float32Array(0);
    this.energy = 0;
    this.surgeNow = {};
    this.surgeUsual = {};
    this.surge = 0;
    this.lastSurge = -1e9;
    this.heard = 0;
  }

  /**
   * Advance by `dt` seconds. `frame` is this frame's analysis while a source
   * is listening, or null for none (then the quiet groove plays).
   */
  update(frame: VoiceAudioFrame | null, dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    if (frame && frame.spectrum.length > 8) {
      if (!this.live) this.reset();
      this.live = true;
      this.listen(frame, dt);
      const bpm = frame.bpm && frame.bpm > 0 ? frame.bpm : DEFAULT_BPM;
      this.advanceBeat(dt, bpm, frame.bpm && frame.bpm > 0 ? frame.beatPhase : undefined);
    } else {
      if (this.live) this.reset();
      this.live = false;
      this.groove(dt);
      this.advanceBeat(dt, IDLE_BPM);
    }
    for (const id of VOICE_SOURCE_IDS) this.integrate(id, dt);
    this.energy += (this.sources.all.env - this.energy) * approach(dt, ENERGY_SECONDS);
  }

  /** The inputs for a voice following `source` (a vxSource value or id). Without `auto` it always shows. */
  inputs(source: VoiceSourceId | number, auto = false, intensity = 1): Record<string, number> {
    const id = typeof source === 'number' ? voiceSourceAt(source) : source;
    const s = this.sources[id] ?? this.sources.all;
    const k = Math.max(0, Math.min(2, Number.isFinite(intensity) ? intensity : 1));
    const amount = (v: number) => Math.min(1.25, v * k);
    const notes = [...s.notes].sort((a, b) => b.energy - a.energy);
    const out: Record<string, number> = {
      vxEnv: amount(s.env),
      vxHit: amount(s.hit),
      vxVel: s.vel,
      vxPitch: s.pitch,
      vxGlide: s.glide,
      vxPhase: s.phase,
      vxCount: s.count,
      vxPresence: auto ? s.presence : 1,
      vxBeat: fract(this.beat),
      vxBar: fract(this.beat / 4),
      vxBars: Math.floor(this.beat / 4) % COUNT_WRAP,
      vxEnergy: amount(this.energy),
      vxSwell: amount(s.swell),
      vxPulse: amount(s.pulse),
      vxFlow: s.flow,
      vxMorph: ((s.morph % COUNT_WRAP) + COUNT_WRAP) % COUNT_WRAP,
      vxLevel: Math.min(3, (s.att + LEVEL_FLOOR) / (s.usual + LEVEL_FLOOR)),
    };
    for (let i = 0; i < 4; i++) {
      out[`vxNote${i}`] = notes[i] ? clamp01(notes[i].midi / 127) : 0;
      out[`vxNoteE${i}`] = notes[i] ? amount(notes[i].energy) : 0;
    }
    return out;
  }

  /** Each band's loudness and hits from this frame's spectrum. */
  private listen(frame: VoiceAudioFrame, dt: number): void {
    const spec = frame.spectrum, bins = spec.length, hz = frame.sampleRate / (2 * bins);
    if (this.previous.length !== bins) this.previous = Float32Array.from({ length: bins }, (_, i) => spec[i]);
    for (const band of Object.keys(BANDS) as Band[]) {
      const [lo, hi] = BANDS[band];
      const from = Math.max(1, Math.floor(lo / hz)), to = Math.min(bins - 1, Math.max(from, Math.round(hi / hz)));
      let power = 0, rise = 0;
      for (let i = from; i <= to; i++) {
        const a = amplitude(spec[i]);
        power += a * a;
        rise += Math.max(0, spec[i] - this.previous[i]);
      }
      const n = to - from + 1;
      const b = this.bands[band];
      b.level = Math.sqrt(power / n);
      b.smooth += (b.level - b.smooth) * approach(dt, 0.05);
      b.peak = Math.max(b.level, SILENCE[band] * 4, b.peak * Math.exp(-dt / PEAK_FALL_SECONDS));
      b.floor = Math.max(SILENCE[band] * 0.25, Math.min(b.level, b.floor * Math.exp(dt / FLOOR_RISE_SECONDS)));
      // A hit: the band's energy jumps well above its usual frame-to-frame change (spectral flux).
      b.flux = rise / n;
      const threshold = b.fluxAvg + HIT_DEVIATIONS[band] * b.fluxDev + 1.5;
      b.threshold = threshold;
      b.hit = 0;
      if (b.flux > threshold && b.level > Math.max(SILENCE[band], 1.5 * b.floor) && this.time - b.lastHit > REFRACTORY[band]) {
        b.hit = clamp01(0.6 + 0.4 * Math.min(1, (b.flux - threshold) / (threshold + 4)) * Math.sqrt(b.level / b.peak));
        b.lastHit = this.time;
      }
      const k = approach(dt, 0.6);
      b.fluxAvg += (b.flux - b.fluxAvg) * k;
      b.fluxDev += (Math.abs(b.flux - b.fluxAvg) - b.fluxDev) * k;
    }
    for (let i = 0; i < bins; i++) this.previous[i] = spec[i];
    // A drop: several parts of the spectrum come in at once, well above where they have been for
    // the last several seconds (mastered music barely gets louder; its hats, bass and lead return).
    this.surge = 0;
    for (const band of SURGE_BANDS) {
      const db = 20 * Math.log10(Math.max(this.bands[band].level, SILENCE[band]));
      const now = (this.surgeNow[band] ??= db), usual = (this.surgeUsual[band] ??= db);
      this.surgeNow[band] = now + (db - now) * approach(dt, 0.4);
      // The usual level learns quickly while a source is new, so a song's opening is not a surge.
      this.surgeUsual[band] = usual + (this.surgeNow[band]! - usual) * approach(dt, this.heard < 8 ? 1 : 8);
      this.surge += Math.max(0, this.surgeNow[band]! - this.surgeUsual[band]!);
    }
    this.heard += dt;
    const surged = this.surge > SURGE_DB && this.time - this.lastSurge > 8 && this.heard > 10;
    if (surged) this.lastSurge = this.time;
    for (const id of VOICE_SOURCE_IDS) {
      const def = SOURCES[id], s = this.sources[id], b = this.bands[def.band];
      // A held sound's envelope is its band's loudness against its recent peak, past a floor.
      const quiet = Math.max(SILENCE[def.band], 1.5 * b.floor);
      const loud = b.smooth > quiet ? clamp01(((b.smooth - quiet) / Math.max(1e-9, b.peak - quiet) - 0.08) / 0.8) : 0;
      const also = def.with ? this.bands[def.with] : null;
      // With the other sound hitting too (a clap on a four-on-the-floor kick), only a clearly bigger rise counts.
      const other = def.not ? this.bands[def.not] : null;
      const crowded = !!other && this.time - other.lastHit <= 0.05;
      const struck = def.surge ? surged : b.hit > 0 && (!also || also.flux > also.fluxAvg + 1.2 * also.fluxDev + 1) && (!crowded || b.flux > b.threshold * CROWDED_FACTOR);
      if (struck) this.strike(id, def.surge ? clamp01(0.5 + this.surge / (4 * SURGE_DB)) : b.hit, frame);
      if (!def.oneShot) s.env += (loud - s.env) * approach(dt, loud > s.env ? def.attack : def.release);
      if (loud > 0.2) s.sinceActive = 0;
      if (def.notes) this.hearNotes(id, frame, dt, struck);
    }
  }

  /** A hit of `id`'s sound with strength `velocity`. */
  private strike(id: VoiceSourceId, velocity: number, frame?: VoiceAudioFrame): void {
    const def = SOURCES[id], s = this.sources[id];
    s.hit = Math.max(s.hit, velocity);
    s.vel = velocity;
    s.count = (s.count + 1) % COUNT_WRAP;
    s.sinceActive = 0;
    if (def.oneShot) {
      s.strikes.push({ velocity, age: 0 });
      if (s.strikes.length > 6) s.strikes.shift();
    }
    if (def.drum !== undefined) s.pitch = def.drum / 127;
    else if (frame && def.notes) {
      const top = spectrumPeaks(frame.spectrum, frame.sampleRate, def.notes[0], def.notes[1], 1)[0];
      if (top) s.pitch = clamp01(Math.round(top.midi) / 127);
    }
    if (s.count === 1 && s.glide === 0) s.glide = s.pitch;
    // The surge the smooth signals ride on: stacks on a busy part without running away.
    s.kick = Math.min(1.25, s.kick + velocity * (1 - 0.5 * Math.min(1, s.kick)));
    s.hits += 1;
  }

  /** Up to four notes of a melodic sound: spectral peaks in its range, kept while they sound. */
  private hearNotes(id: VoiceSourceId, frame: VoiceAudioFrame, dt: number, struck: boolean): void {
    const def = SOURCES[id], s = this.sources[id], band = this.bands[def.band];
    const peaks = spectrumPeaks(frame.spectrum, frame.sampleRate, def.notes![0], def.notes![1], 4);
    const top = peaks[0]?.amp ?? 0;
    for (const n of s.notes) n.age += dt;
    for (const p of peaks) {
      const midi = Math.round(p.midi);
      const target = clamp01(Math.sqrt(p.amp / Math.max(band.peak, top, SILENCE[def.band])));
      const held = s.notes.find((n) => n.midi === midi);
      if (held) { held.energy += (target - held.energy) * approach(dt, target > held.energy ? def.attack + 0.03 : def.release); held.age = 0; }
      // A new note joins on a hit, or once it has rung for a moment.
      else if (struck || target > 0.55) s.notes.push({ midi, energy: target * 0.6, age: 0 });
    }
    for (const n of s.notes) if (n.age > 0) n.energy *= Math.exp(-dt * 3 / Math.max(0.05, def.release));
    s.notes = s.notes.filter((n) => n.energy > 0.02).sort((a, b) => b.energy - a.energy).slice(0, 6);
    // Without hits of its own (pads, drones), the strongest note is the pitch, changing only when it clearly moves.
    const lead = s.notes[0];
    if (lead && (struck || Math.abs(lead.midi / 127 - s.pitch) > 2.5 / 127 || s.pitch === 0)) {
      if (!struck || def.drum === undefined) s.pitch = clamp01(lead.midi / 127);
      if (s.glide === 0) s.glide = s.pitch;
    }
  }

  /** No source: a slow, quiet groove at 90 BPM so every voice keeps moving gently. */
  private groove(dt: number): void {
    const beatLen = 60 / IDLE_BPM;
    const before = this.idleBeat;
    this.idleBeat += dt / beatLen;
    const crossed = (every: number, offset = 0) => Math.floor((this.idleBeat - offset) / every) > Math.floor((before - offset) / every);
    const bar = Math.floor(this.idleBeat / 4);
    // A soft kick each bar, a snare on the third beat of every other bar, a light hat each beat.
    if (crossed(4)) this.strike('kick', 0.45), this.strike('all', 0.35), this.strike('drop', 0.3 * Number(bar % 8 === 0));
    if (crossed(8, 2)) this.strike('snare', 0.35), this.strike('echo', 0.3);
    if (crossed(1)) this.strike('hats', 0.2);
    if (crossed(4, 1)) this.strike('perc', 0.25);
    // A minor progression (A, F, C, G) changing every two bars; notes breathe in and out.
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 60], [55, 59, 62, 67]];
    const chord = chords[Math.floor(this.idleBeat / 8) % chords.length];
    const swell = 0.35 + 0.15 * Math.sin((this.idleBeat / 16) * Math.PI * 2);
    const changed = crossed(8);
    for (const id of VOICE_SOURCE_IDS) {
      const def = SOURCES[id], s = this.sources[id];
      if (!def.oneShot) s.env += (swell - s.env) * approach(dt, Math.max(0.3, def.attack));
      if (!def.notes) continue;
      const [lo, hi] = def.notes;
      // The chord folded by octaves into the sound's own range.
      const hzOf = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
      let wanted = [...new Set(chord.map((m) => { let n = m; while (hzOf(n) < lo) n += 12; while (hzOf(n) > hi && n > 12) n -= 12; return n; }))];
      if (id === 'bass' || id === 'dubbass') wanted = wanted.slice(0, 1);
      if (id === 'lead' || id === 'played' || id === 'xy' || id === 'acid' || id === 'siren') wanted = [wanted[Math.floor(this.idleBeat) % wanted.length]];
      for (const n of s.notes) n.age += dt;
      for (const midi of wanted) {
        const held = s.notes.find((n) => n.midi === midi);
        if (held) { held.energy += (swell + 0.15 - held.energy) * approach(dt, 0.5); held.age = 0; }
        else s.notes.push({ midi, energy: 0.05, age: 0 });
      }
      for (const n of s.notes) if (n.age > 0) n.energy *= Math.exp(-dt / 0.8);
      s.notes = s.notes.filter((n) => n.energy > 0.02).slice(0, 6);
      const top = s.notes.find((n) => wanted.includes(n.midi));
      if (top && (changed || s.pitch === 0 || id === 'lead' || id === 'played')) s.pitch = clamp01(top.midi / 127);
      if (s.glide === 0) s.glide = s.pitch;
      s.sinceActive = 0;
    }
  }

  /** The beat clock: runs at the tempo, nudged toward the detected beat, never backwards. */
  private advanceBeat(dt: number, bpm: number, phase?: number): void {
    let step = (dt * bpm) / 60;
    if (phase !== undefined && Number.isFinite(phase)) {
      let gap = fract(phase) - fract(this.beat);
      if (gap > 0.5) gap -= 1;
      if (gap < -0.5) gap += 1;
      step = Math.max(step * 0.5, step + gap * approach(dt, 0.4));
    }
    this.beat = (this.beat + step) % (4 * COUNT_WRAP * 1000);
  }

  /** Every signal of one source moves on by `dt`. */
  private integrate(id: VoiceSourceId, dt: number): void {
    const def = SOURCES[id], s = this.sources[id];
    if (def.oneShot) {
      let env = 0;
      for (const strike of s.strikes) {
        strike.age += dt;
        const rise = Math.min(1, strike.age / Math.max(0.001, def.attack));
        env = Math.max(env, strike.velocity * rise * Math.exp((-3 * Math.max(0, strike.age - def.attack)) / def.release));
      }
      s.strikes = s.strikes.filter((x) => x.age < def.release * 4);
      s.env = env;
    }
    s.hit *= Math.exp(-dt / HIT_SECONDS);
    s.glide += (s.pitch - s.glide) * approach(dt, GLIDE_SECONDS);
    s.phase = (s.phase + dt * (0.2 + 1.8 * s.env)) % WRAP;
    // The desktop's smooth signals: swell, pulse, flow, morph, level.
    s.swell += (s.env - s.swell) * approach(dt, s.env > s.swell ? SWELL_RISE : SWELL_FALL);
    s.kick *= Math.exp(-dt / KICK_DECAY);
    s.pulse += (Math.min(1, s.kick) - s.pulse) * approach(dt, PULSE_RISE);
    s.flow = (s.flow + dt * (0.25 + 1.4 * s.swell + 0.9 * s.pulse)) % WRAP;
    s.att += (s.env - s.att) * approach(dt, ATT_SECONDS);
    s.usual += (s.att - s.usual) * approach(dt, USUAL_SECONDS);
    let left = dt;
    while (left > 0) {
      const h = Math.min(left, 1 / 120);
      const accel = MORPH_OMEGA * MORPH_OMEGA * (s.hits - s.morph) - 2 * MORPH_OMEGA * s.morphVel;
      s.morphVel += accel * h;
      s.morph += s.morphVel * h;
      left -= h;
    }
    if (s.hits > 1e6) { s.hits -= 1e6; s.morph -= 1e6; }
    // Present while it sounds or within eight beats of its last hit; it leaves over about three beats.
    s.sinceActive += dt;
    const beatSeconds = 60 / DEFAULT_BPM;
    const active = s.env > 0.08 || s.sinceActive < PRESENCE_HOLD_BEATS * beatSeconds;
    s.presence += ((active ? 1 : 0) - s.presence) * approach(dt, active ? PRESENCE_IN : PRESENCE_OUT_BEATS * beatSeconds);
  }
}

/** Words WebGL 1 keeps for itself that desktop GLSL lets a shader use as names. */
const RESERVED_NAMES = /\b(packed|input|output|half|fixed|flat|cast|interface|union|template|sizeof|inline|noinline|volatile|public|static|extern|external|superp|namespace|using|goto|class|enum|typedef|asm|unsigned|double|short|long)\b/g;

/**
 * A voice's code made ready for the phone's WebGL 1 compiler. The desktop
 * compiles voices as desktop GLSL, which has functions the phone lacks
 * (hyperbolic tangent, matrix transpose) and lets a shader name things with
 * words WebGL 1 reserves. The functions are provided and the names given a
 * prefix, in the code only (the header stays as it is). Nothing else changes.
 */
export function prepareVoiceSource(source: string): string {
  const header = source.match(/\/\*\s*\{[\s\S]*?\}\s*\*\//);
  const at = header ? header.index! + header[0].length : 0;
  let code = source.slice(at).replace(RESERVED_NAMES, 'ga_$1');
  let helpers = '';
  if (/\btanh\s*\(/.test(code)) {
    helpers += `
float ga_tanh(float x) { float e = exp(2.0 * clamp(x, -10.0, 10.0)); return (e - 1.0) / (e + 1.0); }
vec2 ga_tanh(vec2 x) { vec2 e = exp(2.0 * clamp(x, -10.0, 10.0)); return (e - 1.0) / (e + 1.0); }
vec3 ga_tanh(vec3 x) { vec3 e = exp(2.0 * clamp(x, -10.0, 10.0)); return (e - 1.0) / (e + 1.0); }
vec4 ga_tanh(vec4 x) { vec4 e = exp(2.0 * clamp(x, -10.0, 10.0)); return (e - 1.0) / (e + 1.0); }
`;
    code = code.replace(/\btanh\s*\(/g, 'ga_tanh(');
  }
  if (/\btranspose\s*\(/.test(code)) {
    helpers += `
mat2 ga_transpose(mat2 m) { return mat2(m[0][0], m[1][0], m[0][1], m[1][1]); }
mat3 ga_transpose(mat3 m) { return mat3(m[0][0], m[1][0], m[2][0], m[0][1], m[1][1], m[2][1], m[0][2], m[1][2], m[2][2]); }
`;
    code = code.replace(/\btranspose\s*\(/g, 'ga_transpose(');
  }
  const out = source.slice(0, at) + helpers + code;
  return out === source ? source : out;
}
