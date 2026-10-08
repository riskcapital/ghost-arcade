// Pure modulation contract and range math, shared by desktop and mobile controls.
// Modulation source types
export type ModSource =
  | 'manual'     // No modulation, manual slider only
  | 'sub'        // 20-60 Hz sub bass
  | 'bass'       // 60-250 Hz bass
  | 'lowMid'     // 250-500 Hz
  | 'mid'        // 500-2000 Hz
  | 'highMid'    // 2000-4000 Hz
  | 'treble'     // 4000-8000 Hz hihat / cymbal body
  | 'air'        // 8000-16000 Hz cymbal sparkle / sibilance
  | 'presence'   // 16000-22000 Hz reverb tail / shimmer
  | 'high'       // legacy: synthetic average of treble+air+presence
  | 'amplitude'  // Overall volume
  | 'beatPhase'  // 0-1 ramp synced to beat
  // Onset-based one-shots — pulse to 1 on hit, decay back to 0 over ~150ms.
  // Use these when you want a flash on the kick or snare specifically.
  | 'kick'
  | 'snare'
  | 'lfo-sine'   // Sine wave LFO
  | 'lfo-saw'    // Sawtooth LFO
  | 'lfo-square' // Square wave LFO
  | 'lfo-tri'    // Triangle wave LFO
  // Per-param playhead automation. Independent of audio entirely —
  // each param has its own speed, loop/pingpong mode, and sub-range
  // clippers (autoMin / autoMax). play/pause via mod.autoPlaying.
  // See AutomationState below.
  | 'auto';

/** Every ModSource whose value comes out of the audio analyser. The
 *  remainder ('manual', 'auto', free-running LFOs) is independent of what
 *  the analyser hears — an offline render reproduces those exactly. */
const AUDIO_DRIVEN_MOD_SOURCES: ReadonlySet<string> = new Set<ModSource>([
  'sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble', 'air', 'presence', 'high',
  'amplitude', 'beatPhase', 'kick', 'snare',
]);

/** True when this modulation's value depends on incoming audio. BPM-synced
 *  LFOs count: their rate comes from the detected tempo, so they drift with
 *  whatever the analyser is hearing. */
export function isAudioDrivenMod(mod: Pick<ParamModulation, 'source' | 'bpmSync'>): boolean {
  if (AUDIO_DRIVEN_MOD_SOURCES.has(mod.source)) return true;
  return !!mod.bpmSync && mod.source.startsWith('lfo-');
}

/** Modulation target — which side of the app's render graph the
 *  engine should write modulated values to. Independent of which UI
 *  panel is currently open: a 'vj' modulation keeps driving the VJ
 *  deck's active clip even while the user is browsing mapping mode,
 *  and vice versa. Previously the engine routed based on a global
 *  `project.vjMode.enabled` flag which made VJ and mapping mods
 *  mutually exclusive — switching modes silently re-routed the same
 *  modulation entries to the wrong side, producing the "params work
 *  in mapping but not VJ" bug. */
export type ModTarget = 'vj' | 'mapping';

// A single parameter modulation assignment
export interface ParamModulation {
  /** Clip-effect baseline/range survive save/reopen without relying on an open panel. */
  clipEffect?: { base: number; min: number; max: number };
  compositionEffect?: { base: number; min: number; max: number };
  source: ModSource;
  /** Which render-graph side this modulation drives. Optional for
   *  back-compat with old project saves; when absent the engine
   *  falls back to the legacy global-mode routing. New code paths
   *  (UI panels creating modulations) always set this explicitly. */
  target?: ModTarget;
  amount: number;    // 0-1 how much the source affects the parameter
  speed: number;     // LFO speed multiplier (only for LFO sources)
                     // - bpmSync=false: cycles per second (Hz). speed=1 → 1Hz → 60 BPM
                     // - bpmSync=true:  beat divisions. speed=1 → 1 cycle per beat,
                     //                  speed=0.25 → 1 cycle per 4 beats (slow),
                     //                  speed=4 → 4 cycles per beat (sixteenths)
  invert: boolean;   // Invert the modulation signal
  /** When true and source is an LFO, the LFO syncs to the detected/manual
   *  BPM instead of running at a free Hz rate. Effective cycle rate becomes
   *  `speed × (bpm / 60)` cycles per second, so speed acts as a beat-division
   *  multiplier rather than a Hz value. Ignored for non-LFO sources. */
  bpmSync?: boolean;

  // ─── Per-param automation (source === 'auto') ─────────────────
  /** Internal phase counter for the auto playhead, 0..1. Advanced by
   *  `autoSpeedHz × dt` each frame when autoPlaying is true.
   *  Persisted with the modulation so pause/resume continues from
   *  where the user paused, not from now mod cycle. */
  autoPhase?: number;
  /** Loop = saw (0→1, wrap), pingpong = triangle (0→1→0). */
  autoMode?: 'loop' | 'pingpong';
  /** Cycles per second. Range 0.05 - 4.0 in the UI; the engine
   *  doesn't clamp so MIDI / keyframe automation can push beyond. */
  autoSpeedHz?: number;
  /** Lower clip of the param's range, expressed as 0..1 fraction.
   *  0 = the param's natural min, 1 = the natural max. Default 0. */
  autoMin?: number;
  /** Upper clip, same scale. Default 1. Always >= autoMin in the
   *  UI (we swap if user inverts), but the engine handles either. */
  autoMax?: number;
  /** Play/pause. When false, the param sits at whatever value the
   *  last frame published — the playhead doesn't advance. */
  autoPlaying?: boolean;

  // ─── Min / Max output range (audio, LFO and beat sources) ─────
  /** Ableton-style output range, as 0..1 fractions of the param's
   *  natural range (0 = the param's min, 1 = its max). When BOTH are
   *  set the param follows `lerp(rangeMin, rangeMax, s)` where s is the
   *  source's own 0..1 value (audio level, LFO wave, kick envelope):
   *  silence / trough → rangeMin, loud / peak → rangeMax. `invert`
   *  swaps the direction. `amount` (Depth) is not used in range mode.
   *  Absent on modulations saved before ranges existed — those keep the
   *  legacy slider-relative formula exactly. */
  rangeMin?: number;
  rangeMax?: number;
}

/** True when this modulation uses the Min / Max output range. */
export function hasModRange(mod: Pick<ParamModulation, 'rangeMin' | 'rangeMax'> | undefined | null): boolean {
  return !!mod && typeof mod.rangeMin === 'number' && Number.isFinite(mod.rangeMin)
    && typeof mod.rangeMax === 'number' && Number.isFinite(mod.rangeMax);
}

/** Sources whose legacy (no-range) signal was lifted to 0.5..1 so audio
 *  only pushes up from the slider. Beat phase and LFOs were centred. */
const LEGACY_ADDITIVE_SOURCES: ReadonlySet<string> = new Set<ModSource>([
  'sub', 'bass', 'lowMid', 'mid', 'highMid', 'treble', 'air', 'presence', 'high',
  'amplitude', 'kick', 'snare',
]);

export const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** The pre-range signal shape: audio lifted to 0.5..1, then inverted. */
export function legacySignal(mod: Pick<ParamModulation, 'source' | 'invert'>, unit: number): number {
  const signal = LEGACY_ADDITIVE_SOURCES.has(mod.source) ? 0.5 + unit * 0.5 : unit;
  return mod.invert ? 1 - signal : signal;
}

/**
 * Map a source's raw 0..1 value onto a param.
 *
 *  - Range mode (`rangeMin`/`rangeMax` set): `min + lerp(rangeMin,
 *    rangeMax, s) × (max − min)`, s = unit (or 1 − unit when inverted).
 *    The slider base and Depth play no part.
 *  - Legacy mode (saved before ranges): `base + (signal − 0.5) × amount ×
 *    (max − min)` where audio sources lift the signal to 0.5..1, clamped
 *    to min..max unless `clampOutput` is false. Unchanged from 2.0.12.
 */
export function computeModulatedValue(
  mod: Pick<ParamModulation, 'source' | 'amount' | 'invert' | 'rangeMin' | 'rangeMax'>,
  unit: number,
  base: number,
  min: number,
  max: number,
  clampOutput = true,
): number {
  const u = clamp01(Number.isFinite(unit) ? unit : 0);
  if (hasModRange(mod)) {
    const s = mod.invert ? 1 - u : u;
    const frac = clamp01(mod.rangeMin! + s * (mod.rangeMax! - mod.rangeMin!));
    return min + frac * (max - min);
  }
  const raw = base + (legacySignal(mod, u) - 0.5) * mod.amount * (max - min);
  return clampOutput ? Math.max(min, Math.min(max, raw)) : raw;
}

/**
 * Default Min / Max for a brand-new modulation: Min at the slider's
 * current value, Max at the top of the param — the same "slider is the
 * floor, audio pushes up" feel as before, but visible and editable. A
 * slider already at the top would leave no room to move, so then the
 * range runs from the bottom up to the slider instead.
 */
export function defaultModRange(value: number, min: number, max: number): { rangeMin: number; rangeMax: number } {
  const span = max - min;
  const frac = span > 0 && Number.isFinite(value) ? clamp01((value - min) / span) : 0;
  return frac >= 0.95 ? { rangeMin: 0, rangeMax: frac } : { rangeMin: frac, rangeMax: 1 };
}

// Default modulation values for new assignments
export const DEFAULT_MOD: Omit<ParamModulation, 'source'> = {
  amount: 0.5,
  speed: 1,
  invert: false,
  bpmSync: false,
  // Automation defaults — only consulted when source === 'auto'.
  // 0.15Hz = ~6.7s for a full cycle (≈13s ping-pong round-trip);
  // first-test feedback was that 0.5Hz felt frantic. Users can
  // crank it up via the slider for stutter effects but the
  // calm-starting-point matches typical "slow swirl" VJ pacing.
  autoPhase: 0,
  autoMode: 'loop',
  autoSpeedHz: 0.15,
  autoMin: 0,
  autoMax: 1,
  autoPlaying: true,
};
