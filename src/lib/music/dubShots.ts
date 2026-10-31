/**
 * Dub shots: the Dub set's grid of one-shot sounds, each thrown into its
 * own echo, timed to the studio's tempo. A pad's settings are plain data,
 * saved with the project and songs; dubShotAudio.ts plays them.
 */

export type DubShotSource = 'rim' | 'clap' | 'snare' | 'hat' | 'stab' | 'blip' | 'zap' | 'gun' | 'hey' | 'crash' | 'horn' | 'melodica';
export type DubEcho = 'tape' | 'digital' | 'pingpong' | 'spring' | 'swell';
export type DubDivision = '1/16' | '1/8t' | '1/8' | '1/8.' | '1/4' | '1/4.' | '1/2' | '1 bar';

export interface DubShot {
  name: string;
  source: DubShotSource;
  /** Semitones up or down. */
  pitch: number;
  echo: DubEcho;
  division: DubDivision;
  /** 0 one repeat, 1 near-endless. */
  feedback: number;
  /** While the pad is held, the echo keeps going (a limiter keeps it safe). */
  hold: boolean;
  /** Dark to bright repeats. */
  tone: number;
  /** How much of the echo against the dry hit. */
  mix: number;
  level: number;
  /** How long the tail lasts before it fades: a quick clap-back to a long fade-out. */
  fade: number;
}

export const DUB_SOURCES: { id: DubShotSource; label: string; pitched?: boolean }[] = [
  { id: 'rim', label: 'Rimshot' },
  { id: 'clap', label: 'Clap' },
  { id: 'snare', label: 'Snare crack' },
  { id: 'hat', label: 'Hi-hat' },
  { id: 'stab', label: 'Chord stab', pitched: true },
  { id: 'blip', label: 'Siren blip' },
  { id: 'zap', label: 'Laser' },
  { id: 'gun', label: 'Gunshot' },
  { id: 'hey', label: 'Hey', pitched: true },
  { id: 'crash', label: 'Spring crash' },
  { id: 'horn', label: 'Horn stab', pitched: true },
  { id: 'melodica', label: 'Melodica', pitched: true },
];

export const DUB_ECHOES: { id: DubEcho; label: string }[] = [
  { id: 'tape', label: 'Tape echo' },
  { id: 'digital', label: 'Digital' },
  { id: 'pingpong', label: 'Ping-pong' },
  { id: 'spring', label: 'Spring and echo' },
  { id: 'swell', label: 'Swell' },
];

/** Each division in beats. */
export const DUB_DIVISIONS: { id: DubDivision; beats: number }[] = [
  { id: '1/16', beats: 0.25 },
  { id: '1/8t', beats: 1 / 3 },
  { id: '1/8', beats: 0.5 },
  { id: '1/8.', beats: 0.75 },
  { id: '1/4', beats: 1 },
  { id: '1/4.', beats: 1.5 },
  { id: '1/2', beats: 2 },
  { id: '1 bar', beats: 4 },
];

export const DUB_SHOT_COUNT = 12;
/** Notes the shots send for visuals, on the Shots instrument above its FX pads (they make no sound there). */
export const DUB_SHOT_NOTE = 76;

const shot = (name: string, source: DubShotSource, echo: DubEcho, division: DubDivision, feedback: number, fade: number, extra: Partial<DubShot> = {}): DubShot => ({
  name, source, pitch: 0, echo, division, feedback, hold: false, tone: 0.5, mix: 0.6, level: 0.8, fade, ...extra,
});

export function defaultDubShots(): DubShot[] {
  return [
    shot('Clap back', 'clap', 'digital', '1/16', 0.12, 0.08, { mix: 0.5 }),
    shot('Rim skank', 'rim', 'pingpong', '1/8.', 0.45, 0.4),
    shot('Siren drift', 'blip', 'tape', '1/4.', 0.72, 0.8, { tone: 0.4 }),
    shot('Forever stab', 'stab', 'tape', '1/4', 0.6, 0.6, { hold: true }),
    shot('Big fade', 'snare', 'tape', '1/2', 0.78, 1, { tone: 0.45 }),
    shot('Spring crash', 'crash', 'spring', '1/8', 0.35, 0.5, { mix: 0.7 }),
    shot('Hat slap', 'hat', 'digital', '1/8t', 0.3, 0.25),
    shot('Laser', 'zap', 'pingpong', '1/16', 0.55, 0.45, { tone: 0.6 }),
    shot('Gun echo', 'gun', 'tape', '1/4', 0.55, 0.7, { tone: 0.35 }),
    shot('Hey!', 'hey', 'tape', '1/8.', 0.5, 0.55),
    shot('Horn call', 'horn', 'spring', '1/4.', 0.45, 0.6),
    shot('Melodica swell', 'melodica', 'swell', '1/2', 0.6, 0.85, { mix: 0.75 }),
  ];
}

export function divisionBeats(division: DubDivision): number {
  return DUB_DIVISIONS.find((d) => d.id === division)?.beats ?? 0.5;
}

const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

/** Saved pads, checked and filled out to the full grid. */
export function normalizeDubShots(raw: unknown): DubShot[] {
  const d = defaultDubShots();
  const list = Array.isArray(raw) ? raw : [];
  return d.map((def, i) => {
    const r = list[i] as Partial<Record<keyof DubShot, unknown>> | undefined;
    if (!r || typeof r !== 'object') return def;
    return {
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : def.name,
      source: DUB_SOURCES.some((s) => s.id === r.source) ? (r.source as DubShotSource) : def.source,
      pitch: typeof r.pitch === 'number' && Number.isFinite(r.pitch) ? Math.max(-24, Math.min(24, Math.round(r.pitch))) : 0,
      echo: DUB_ECHOES.some((e) => e.id === r.echo) ? (r.echo as DubEcho) : def.echo,
      division: DUB_DIVISIONS.some((x) => x.id === r.division) ? (r.division as DubDivision) : def.division,
      feedback: unit(r.feedback, def.feedback),
      hold: typeof r.hold === 'boolean' ? r.hold : def.hold,
      tone: unit(r.tone, def.tone),
      mix: unit(r.mix, def.mix),
      level: unit(r.level, def.level),
      fade: unit(r.fade, def.fade),
    };
  });
}
