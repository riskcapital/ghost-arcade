/**
 * The big loop library: basslines, chord progressions, leads and hooks,
 * drum grooves and textures, all original, written in scale degrees so they
 * play in the studio's key. Most are built from a small figure (a bar of
 * bass, a rhythm, a motif) over a progression, which keeps them in the
 * styles they come from and lets one figure serve several progressions.
 *
 * The hooks follow what makes a phrase stick: a short motif said twice, the
 * third time changed in one place, an answer that ends on a tension note and
 * resolves on the next downbeat; mostly stepwise, with one leap.
 *
 * Common progressions and genre rhythms are shared by everyone; melodies here
 * are written for this library.
 */

import type { DrumVoice } from './noteEvents';
import type { BeatLoop, LoopNote, LoopRole, MelodicLoop } from './loops';

export type LoopStyle = 'dub' | 'reggae' | 'techno' | 'house' | 'acid' | 'funk' | 'livetronica' | 'garage' | 'breaks' | 'ambient' | 'pop' | 'jazz';

export const LOOP_STYLE_LABELS: Record<LoopStyle, string> = {
  dub: 'Dub', reggae: 'Roots', techno: 'Techno', house: 'House', acid: 'Acid', funk: 'Funk',
  livetronica: 'Livetronica', garage: 'UK garage', breaks: 'Breaks', ambient: 'Ambient', pop: 'Anthem', jazz: 'Jazz',
};

/** Typical tempo for each style, in BPM. */
const STYLE_BPM: Record<LoopStyle, [number, number]> = {
  dub: [66, 80], reggae: [68, 84], techno: [124, 138], house: [118, 128], acid: [125, 140], funk: [95, 115],
  livetronica: [100, 128], garage: [128, 136], breaks: [120, 140], ambient: [60, 100], pop: [100, 128], jazz: [80, 120],
};

type LibMelodic = MelodicLoop & { style: LoopStyle; bpm: [number, number] };
type LibBeat = BeatLoop & { style: LoopStyle; bpm: [number, number] };

/** [beat, duration, degree offset (or chord degrees), velocity] */
type Hit = [number, number, number | number[], number?];

const note = (beat: number, dur: number, d: number | number[], v = 0.8): LoopNote => ({ beat, dur, degrees: Array.isArray(d) ? d : [d], velocity: v });

function melodic(id: string, name: string, role: LoopRole, style: LoopStyle, beats: number, notes: LoopNote[]): LibMelodic {
  return { id, name, role, style, bpm: STYLE_BPM[style], beats, notes: notes.sort((a, b) => a.beat - b.beat) };
}

// ── Bass ────────────────────────────────────────────────────────────────

/** A bar of bass: hits with degrees relative to the bar's root. */
interface BassFigure { id: string; style: LoopStyle; hits: Hit[] }

const BASS_FIGURES: BassFigure[] = [
  { id: 'onedrop', style: 'dub', hits: [[0, 1.3, 0, 1], [1.5, 0.4, 0, 0.7], [2, 1.2, 4], [3.5, 0.4, 2, 0.7]] },
  { id: 'heavy-one', style: 'dub', hits: [[0, 1.8, 0, 1], [2.5, 0.4, -1, 0.7], [3, 0.9, 0, 0.9]] },
  { id: 'steppers', style: 'dub', hits: [[0, 0.45, 0, 1], [1, 0.45, 0], [2, 0.45, 0, 1], [2.75, 0.2, 2, 0.7], [3, 0.45, 4]] },
  { id: 'rockers', style: 'reggae', hits: [[0, 0.4, 0, 1], [0.5, 0.3, 0, 0.6], [1, 0.4, 7, 0.8], [1.75, 0.2, 4, 0.6], [2, 0.4, 0, 0.9], [2.5, 0.3, 2], [3, 0.8, 4]] },
  { id: 'halfstep', style: 'dub', hits: [[0, 2.8, 0, 1], [3, 0.45, 4, 0.8], [3.5, 0.45, 5, 0.7]] },
  { id: 'rolling', style: 'techno', hits: [0, 1, 2, 3].flatMap((b): Hit[] => [[b, 0.2, 0, 1], [b + 0.25, 0.2, 0, 0.6], [b + 0.5, 0.2, 4, 0.7], [b + 0.75, 0.2, 0, 0.6]]) },
  { id: 'offbeat', style: 'techno', hits: [[0.5, 0.35, 0, 1], [1.5, 0.35, 0, 0.9], [2.5, 0.35, 0, 1], [3.5, 0.35, 0, 0.9]] },
  { id: 'gallop', style: 'techno', hits: [0, 1, 2, 3].flatMap((b): Hit[] => [[b + 0.25, 0.18, 0, 0.8], [b + 0.5, 0.2, 0, 1]]) },
  { id: 'acid-a', style: 'acid', hits: [[0, 0.2, 0, 1], [0.5, 0.2, 7], [0.75, 0.2, 0], [1.25, 0.2, 2], [1.5, 0.2, 0, 1], [2, 0.2, 9], [2.25, 0.2, 7], [2.75, 0.2, 0], [3, 0.2, 4, 1], [3.5, 0.2, 7], [3.75, 0.2, -1]] },
  { id: 'acid-b', style: 'acid', hits: [[0, 0.2, 0, 1], [0.25, 0.2, 0, 0.6], [0.75, 0.2, 7, 1], [1, 0.2, 0], [1.5, 0.2, 3], [2, 0.2, 0, 1], [2.25, 0.2, 7], [2.5, 0.2, 6], [3, 0.2, 0, 1], [3.25, 0.2, 2], [3.5, 0.2, 7, 1]] },
  { id: 'house-octave', style: 'house', hits: [[0.5, 0.3, 0, 1], [1, 0.2, 7, 0.7], [1.5, 0.3, 0, 0.9], [2.5, 0.3, 0, 1], [2.75, 0.2, 7, 0.7], [3.5, 0.3, 2, 0.8]] },
  { id: 'funk-slap', style: 'funk', hits: [[0, 0.3, 0, 1], [0.75, 0.15, 0, 0.5], [1, 0.2, 7, 0.9], [1.5, 0.15, 6, 0.5], [1.75, 0.3, 4], [2.5, 0.2, 0, 0.9], [3, 0.15, 0, 0.5], [3.25, 0.3, 2], [3.75, 0.2, 3, 0.7]] },
  { id: 'live-arp', style: 'livetronica', hits: [[0, 0.4, 0, 1], [0.5, 0.4, 4], [1, 0.4, 7], [1.5, 0.4, 4], [2, 0.4, 2, 0.9], [2.5, 0.4, 4], [3, 0.4, 9], [3.5, 0.4, 7]] },
  { id: 'twostep', style: 'garage', hits: [[0, 0.45, 0, 1], [0.75, 0.25, 0, 0.7], [1.75, 0.4, 4], [2.5, 0.3, 2], [3.25, 0.3, 0, 0.8]] },
  { id: 'sub-swell', style: 'ambient', hits: [[0, 3.8, 0, 0.85]] },
];

/** Root movements, as a degree per bar. */
const BASS_ROOTS: { id: string; roots: number[]; name: string }[] = [
  { id: 'one', roots: [0], name: 'one chord' },
  { id: 'i-iv', roots: [0, 0, 3, 3], name: 'one to four' },
  { id: 'i-vii', roots: [0, 0, -1, -1], name: 'one down a step' },
  { id: 'i-vi-vii', roots: [0, -2, -1, 0], name: 'climb home' },
  { id: 'i-v', roots: [0, 4, 0, 4], name: 'one and five' },
];

/** Names that fit each figure: one for each root movement it is paired with. */
const BASS_NAMES: Record<string, string[]> = {
  'onedrop': ['Basement Drop', 'Ghost Town Walk', 'Rain on Zinc'],
  'heavy-one': ['Heavy Weight', 'Tower of Sound', 'Low Cloud'],
  'steppers': ['Steppers Parade', 'Marching Through', 'Iron Road'],
  'rockers': ['Rockers Shuffle', 'Hillside Bounce', 'Corner Shop Skank'],
  'halfstep': ['Slow Tide', 'Pressure Valve', 'Deep Harbour'],
  'rolling': ['Rolling Engine', 'Night Freight', 'Turbine Hall'],
  'offbeat': ['Offbeat Pump', 'Warehouse Pulse', 'Strobe Lungs'],
  'gallop': ['Gallop Line', 'Machine Horse', 'Tunnel Run'],
  'acid-a': ['Squelch Garden', 'Rubber Wire', 'Chrome Snake'],
  'acid-b': ['Acid Rain Line', 'Bent Resistor', 'Silver Worm'],
  'house-octave': ['Octave Jack', 'Sunday Pump', 'Disco Lungs'],
  'funk-slap': ['Slap Happy', 'Grease Pocket', 'Strut Line'],
  'live-arp': ['Glow Stick Arp', 'Festival Climb', 'Late Set Runner'],
  'twostep': ['Two Step Shuffle', 'Bus Stop Swing', 'Skippy Low End'],
  'sub-swell': ['Sub Swell', 'Floor Hum', 'Distant Thunder'],
};

const BASS_PAIRS: Record<string, string[]> = {
  'onedrop': ['one', 'i-iv', 'i-vii'], 'heavy-one': ['one', 'i-vi-vii', 'i-iv'], 'steppers': ['one', 'i-iv', 'i-v'],
  'rockers': ['i-iv', 'i-v', 'i-vii'], 'halfstep': ['one', 'i-vii', 'i-vi-vii'], 'rolling': ['one', 'i-vii', 'i-iv'],
  'offbeat': ['one', 'i-iv', 'i-vi-vii'], 'gallop': ['one', 'i-vii', 'i-v'], 'acid-a': ['one', 'i-iv', 'i-vii'],
  'acid-b': ['one', 'i-vi-vii', 'i-v'], 'house-octave': ['one', 'i-iv', 'i-vi-vii'], 'funk-slap': ['one', 'i-iv', 'i-v'],
  'live-arp': ['i-vi-vii', 'i-iv', 'i-v'], 'twostep': ['one', 'i-vii', 'i-iv'], 'sub-swell': ['one', 'i-vi-vii', 'i-iv'],
};

function bassLoops(): LibMelodic[] {
  const out: LibMelodic[] = [];
  for (const fig of BASS_FIGURES) {
    BASS_PAIRS[fig.id].forEach((rootId, i) => {
      const roots = BASS_ROOTS.find((r) => r.id === rootId)!.roots;
      const notes = roots.flatMap((root, bar) => fig.hits.map(([b, dur, d, v]) => note(bar * 4 + b, dur, (d as number) + root, v)));
      out.push(melodic(`lib-bass-${fig.id}-${rootId}`, BASS_NAMES[fig.id][i], 'bass', fig.style, roots.length * 4, notes));
    });
  }
  return out;
}

// ── Chords ──────────────────────────────────────────────────────────────

/** A chord on scale degree `d`: three notes stacked in thirds, or four. */
const chord = (d: number, seventh = false) => (seventh ? [d, d + 2, d + 4, d + 6] : [d, d + 2, d + 4]);

const PROGRESSIONS: { id: string; degrees: number[]; seventh?: boolean; style: LoopStyle; names: string[] }[] = [
  { id: 'anthem', degrees: [0, 4, 5, 3], style: 'pop', names: ['Stadium Lights', 'Open Road', 'Golden Hour', 'Hands Up'] },
  { id: 'heartbreak', degrees: [5, 3, 0, 4], style: 'pop', names: ['Last Train Home', 'Paper Hearts', 'Neon Rain', 'Summer Ends'] },
  { id: 'aeolian', degrees: [0, 6, 5, 6], style: 'livetronica', names: ['Canyon Echo', 'Night Drive', 'Smoke Signals', 'Dust Devil'] },
  { id: 'two-five-one', degrees: [1, 4, 0, 0], seventh: true, style: 'jazz', names: ['Velvet Lounge', 'Late Bar', 'Blue Hour', 'Soft Landing'] },
  { id: 'minor-blues', degrees: [0, 3, 4, 0], style: 'funk', names: ['Back Alley', 'Hot Pavement', 'Dirty Window', 'Smoke Room'] },
  { id: 'dub-vamp', degrees: [0, 0, 3, 3], style: 'dub', names: ['Echo Chamber', 'Concrete Yard', 'Midnight Studio', 'Tape Room'] },
  { id: 'dub-drift', degrees: [0, 6, 0, 6], style: 'dub', names: ['Drifting Smoke', 'Lantern Shade', 'Tin Roof Rain', 'Hilltop Fog'] },
  { id: 'dorian', degrees: [0, 1, 0, 1], seventh: true, style: 'house', names: ['Dorian Glide', 'Mirror Ball', 'After Hours', 'Silk Floor'] },
  { id: 'mixolydian', degrees: [0, 6, 3, 0], style: 'livetronica', names: ['Sun Bleached', 'Bonfire Jam', 'Porch Swing', 'Desert Bloom'] },
  { id: 'deep', degrees: [0, 5, 3, 4], seventh: true, style: 'house', names: ['Deep Water', 'Late Shift', 'Glass Tower', 'Low Tide'] },
  { id: 'tension', degrees: [0, 5, 1, 4], style: 'techno', names: ['Steel Sky', 'Pylon Song', 'Grey Dawn', 'Rail Yard'] },
];

/** Rhythms a progression can be played in: hits in a bar, with the chord's shape. */
const CHORD_RHYTHMS: { id: string; label: string; hits: Array<[number, number, number?]>; arp?: boolean }[] = [
  { id: 'pad', label: 'pad', hits: [[0, 3.9, 0.7]] },
  { id: 'skank', label: 'skank', hits: [[1, 0.22, 0.85], [3, 0.22, 0.85]] },
  { id: 'double', label: 'double skank', hits: [[1, 0.18, 0.85], [1.5, 0.15, 0.6], [3, 0.18, 0.85], [3.5, 0.15, 0.6]] },
  { id: 'bubble', label: 'organ bubble', hits: [[0.5, 0.2, 0.7], [0.75, 0.2, 0.5], [1.5, 0.2, 0.7], [2.5, 0.2, 0.7], [2.75, 0.2, 0.5], [3.5, 0.2, 0.7]] },
  { id: 'stab', label: 'stabs', hits: [[0, 0.2, 1], [0.75, 0.2, 0.8], [2.5, 0.2, 0.9]] },
  { id: 'house', label: 'house offbeats', hits: [[0.5, 0.25, 0.85], [1.5, 0.25, 0.8], [2.5, 0.25, 0.85], [3.5, 0.25, 0.8]] },
  { id: 'arp', label: 'arp', hits: [], arp: true },
  { id: 'broken', label: 'broken', hits: [[0, 0.9, 0.8], [1.5, 0.4, 0.6], [2.25, 0.9, 0.7], [3.5, 0.4, 0.5]] },
];

const RHYTHMS_FOR: Record<string, string[]> = {
  anthem: ['pad', 'stab', 'arp', 'house'], heartbreak: ['pad', 'broken', 'arp', 'stab'], aeolian: ['pad', 'arp', 'stab', 'broken'],
  'two-five-one': ['pad', 'broken', 'house', 'stab'], 'minor-blues': ['stab', 'broken', 'skank', 'pad'], 'dub-vamp': ['skank', 'double', 'bubble', 'pad'],
  'dub-drift': ['skank', 'bubble', 'pad', 'double'], dorian: ['house', 'pad', 'stab', 'arp'], mixolydian: ['pad', 'skank', 'arp', 'broken'],
  deep: ['house', 'pad', 'broken', 'stab'], tension: ['pad', 'stab', 'arp', 'house'],
};

function chordLoops(): LibMelodic[] {
  const out: LibMelodic[] = [];
  for (const prog of PROGRESSIONS) {
    RHYTHMS_FOR[prog.id].forEach((rid, i) => {
      const rhythm = CHORD_RHYTHMS.find((r) => r.id === rid)!;
      const notes: LoopNote[] = [];
      prog.degrees.forEach((d, bar) => {
        const tones = chord(d, prog.seventh);
        if (rhythm.arp) {
          // Up the chord and back, in eighths, the top note an octave up on the third beat.
          const order = [0, 1, 2, 1, 0, 1, 2, 3].map((k) => (k === 3 ? tones[0] + 7 : tones[Math.min(k, tones.length - 1)]));
          order.forEach((deg, s) => notes.push(note(bar * 4 + s * 0.5, 0.45, deg, s % 4 === 0 ? 0.9 : 0.7)));
        } else for (const [b, dur, v] of rhythm.hits) notes.push(note(bar * 4 + b, dur, tones, v ?? 0.8));
      });
      const style = rid === 'skank' || rid === 'double' || rid === 'bubble' ? (prog.style === 'dub' ? 'dub' : 'reggae') : prog.style;
      out.push(melodic(`lib-chords-${prog.id}-${rid}`, `${prog.names[i]} (${rhythm.label})`, 'chords', style, prog.degrees.length * 4, notes));
    });
  }
  return out;
}

// ── Leads and hooks ─────────────────────────────────────────────────────

/** A one-bar motif: [beat, duration, degree]. Each is original to this library. */
const MOTIFS: { id: string; style: LoopStyle; name: string; bar: Hit[] }[] = [
  { id: 'lantern', style: 'pop', name: 'Lantern', bar: [[0, 0.5, 4], [0.5, 0.5, 5], [1, 1, 4], [2.5, 0.5, 2], [3, 1, 4]] },
  { id: 'swallow', style: 'pop', name: 'Swallow', bar: [[0, 0.75, 7], [0.75, 0.25, 6], [1, 0.5, 4], [1.5, 1.5, 5], [3.5, 0.5, 4]] },
  { id: 'kite', style: 'livetronica', name: 'Kite String', bar: [[0, 0.5, 2], [0.5, 0.5, 4], [1, 0.5, 2], [1.5, 0.5, 4], [2, 1.5, 7]] },
  { id: 'harbour', style: 'dub', name: 'Harbour Bell', bar: [[0, 1.5, 4], [1.5, 0.5, 2], [2, 1, 0], [3.5, 0.5, 2]] },
  { id: 'melodica', style: 'dub', name: 'Melodica Smoke', bar: [[0, 0.5, 0], [0.5, 1, 2], [1.5, 0.5, 3], [2, 1.5, 4], [3.5, 0.5, 3]] },
  { id: 'rebel', style: 'reggae', name: 'Rebel Horn', bar: [[0.5, 0.4, 4], [1, 0.4, 4], [1.5, 0.9, 5], [2.5, 0.4, 4], [3, 0.9, 2]] },
  { id: 'circuit', style: 'techno', name: 'Circuit Call', bar: [[0, 0.2, 7], [0.5, 0.2, 7], [0.75, 0.2, 6], [1.5, 0.2, 4], [2, 0.2, 7], [2.75, 0.2, 9], [3.5, 0.2, 7]] },
  { id: 'sonar', style: 'techno', name: 'Sonar', bar: [[0, 0.3, 0], [0.75, 0.3, 0], [1.5, 0.3, 4], [2.25, 0.3, 0], [3, 0.3, 6]] },
  { id: 'firefly', style: 'house', name: 'Firefly', bar: [[0.5, 0.4, 4], [1, 0.4, 5], [1.5, 0.4, 7], [2.5, 0.4, 5], [3, 0.9, 4]] },
  { id: 'diva', style: 'house', name: 'Diva Whistle', bar: [[0, 1, 7], [1, 0.5, 9], [1.5, 0.5, 7], [2, 1.5, 4], [3.5, 0.5, 5]] },
  { id: 'rubber', style: 'acid', name: 'Rubber Riff', bar: [[0, 0.2, 0], [0.25, 0.2, 7], [0.75, 0.2, 0], [1, 0.2, 3], [1.5, 0.2, 7], [2.25, 0.2, 6], [2.5, 0.2, 7], [3, 0.4, 10]] },
  { id: 'strut', style: 'funk', name: 'Strut Hook', bar: [[0, 0.25, 4], [0.5, 0.25, 4], [0.75, 0.5, 6], [1.5, 0.5, 4], [2.5, 0.25, 2], [3, 0.75, 0]] },
  { id: 'sunrise', style: 'livetronica', name: 'Sunrise Climb', bar: [[0, 0.5, 0], [0.5, 0.5, 2], [1, 0.5, 4], [1.5, 0.5, 5], [2, 1, 7], [3, 1, 6]] },
  { id: 'glass', style: 'ambient', name: 'Glass Steps', bar: [[0, 1.5, 9], [1.5, 1, 7], [2.5, 1.5, 4]] },
  { id: 'skip', style: 'garage', name: 'Skip Vocal', bar: [[0, 0.4, 4], [0.75, 0.4, 5], [1.25, 0.6, 4], [2.25, 0.4, 2], [2.75, 0.8, 4]] },
  { id: 'chime', style: 'pop', name: 'Pocket Chime', bar: [[0, 0.5, 9], [0.5, 0.5, 7], [1, 0.5, 4], [1.5, 0.5, 7], [2, 2, 5]] },
  { id: 'echo', style: 'dub', name: 'Echo Question', bar: [[0, 0.75, 7], [1, 0.5, 6], [1.5, 0.5, 4], [2, 2, 2]] },
  { id: 'breaker', style: 'breaks', name: 'Breaker Stab', bar: [[0, 0.25, 4], [0.75, 0.25, 4], [1.5, 0.25, 6], [2, 0.5, 7], [3.25, 0.5, 4]] },
  { id: 'lullaby', style: 'ambient', name: 'Moon Lullaby', bar: [[0, 1, 2], [1, 1, 4], [2, 1, 5], [3, 1, 4]] },
  { id: 'jam', style: 'livetronica', name: 'Jam Band Lift', bar: [[0, 0.5, 4], [0.5, 0.5, 7], [1, 0.5, 9], [1.5, 0.5, 7], [2, 0.5, 4], [2.5, 0.5, 5], [3, 1, 4]] },
];

/**
 * Two ways to grow a motif into a four-bar hook:
 * "said twice": A A A' B, where A' changes its last note by a step and B
 * answers, ending a step above the root (the tension the loop resolves);
 * "call and answer": A B A B', the answer a third lower, the last ending on
 * the fifth.
 */
function hookLoops(): LibMelodic[] {
  const out: LibMelodic[] = [];
  for (const m of MOTIFS) {
    const shift = (hits: Hit[], by: number, bar: number): LoopNote[] => hits.map(([b, dur, d, v]) => note(bar * 4 + b, dur, (d as number) + by, v ?? 0.85));
    const lastStep = (hits: Hit[], by: number): Hit[] => hits.map((h, i) => (i === hits.length - 1 ? [h[0], h[1], (h[2] as number) + by, h[3]] : h));
    const endOn = (hits: Hit[], deg: number): Hit[] => hits.map((h, i) => (i === hits.length - 1 ? [h[0], Math.max(h[1], 1), deg, h[3]] : h));
    const answer = (by: number) => m.bar.map(([b, dur, d, v]): Hit => [b, dur, (d as number) + by, v]);
    const twice = [...shift(m.bar, 0, 0), ...shift(m.bar, 0, 1), ...shift(lastStep(m.bar, 1), 0, 2), ...shift(endOn(answer(-2), 1), 0, 3)];
    const call = [...shift(m.bar, 0, 0), ...shift(answer(-2), 0, 1), ...shift(m.bar, 0, 2), ...shift(endOn(answer(-2), 4), 0, 3)];
    out.push(melodic(`lib-lead-${m.id}-twice`, m.name, 'lead', m.style, 16, twice));
    out.push(melodic(`lib-lead-${m.id}-call`, `${m.name} (call and answer)`, 'lead', m.style, 16, call));
  }
  return out;
}

// ── Textures ────────────────────────────────────────────────────────────

const TEXTURES: LibMelodic[] = [
  melodic('lib-tex-fog', 'Harbour Fog', 'texture', 'ambient', 16, [note(0, 7.8, [0, 4, 9], 0.6), note(8, 7.8, [-2, 2, 7], 0.6)]),
  melodic('lib-tex-halo', 'Halo', 'texture', 'ambient', 8, [note(0, 7.8, [7, 11, 14], 0.5)]),
  melodic('lib-tex-drips', 'Cave Drips', 'texture', 'dub', 8, [note(0.5, 0.3, 9, 0.5), note(2.75, 0.3, 11, 0.4), note(4.25, 0.3, 7, 0.5), note(6.5, 0.3, 12, 0.4)]),
  melodic('lib-tex-swell', 'Slow Swell', 'texture', 'ambient', 16, [note(0, 15.8, [0, 2, 4, 6], 0.55)]),
  melodic('lib-tex-sirens', 'Distant Sirens', 'texture', 'dub', 8, [note(0, 2, 7, 0.5), note(2, 2, 8, 0.45), note(4, 2, 7, 0.5), note(6, 2, 6, 0.45)]),
  melodic('lib-tex-shimmer', 'Shimmer Bed', 'texture', 'livetronica', 8, [0, 1, 2, 3, 4, 5, 6, 7].map((b) => note(b, 0.9, [7, 9, 11][b % 3], 0.4))),
  melodic('lib-tex-pulse', 'Tape Pulse', 'texture', 'techno', 4, [0, 1, 2, 3].map((b) => note(b + 0.5, 0.4, [0, 7], 0.45))),
  melodic('lib-tex-choir', 'Empty Choir', 'texture', 'ambient', 16, [note(0, 7.8, [2, 4, 7], 0.5), note(8, 7.8, [0, 3, 5], 0.5)]),
  melodic('lib-tex-gamelan', 'Bronze Rain', 'texture', 'livetronica', 8, [0, 0.75, 1.5, 2.5, 3.25, 4, 5.5, 6.75].map((b, i) => note(b, 0.5, [7, 9, 11, 12][i % 4], 0.45))),
  melodic('lib-tex-wind', 'Rooftop Wind', 'texture', 'dub', 16, [note(0, 3.8, [0, 7], 0.4), note(6, 3.8, [3, 10], 0.4), note(12, 3.8, [-1, 6], 0.4)]),
];

// ── Drum grooves ────────────────────────────────────────────────────────

function groove(id: string, name: string, style: LoopStyle, swing: number, rows: Partial<Record<DrumVoice, string>>, steps: 16 | 32 = 16): LibBeat {
  return { id, name, style, bpm: STYLE_BPM[style], steps, swing, rows };
}

export const LIBRARY_BEATS: LibBeat[] = [
  groove('lib-beat-onedrop-deep', 'Deep One Drop', 'dub', 0.08, { kick: '........x.......', snare: '........x.......', rim: '..o.......o.....', hatClosed: 'x.o.x.o.x.o.x.o.' }),
  groove('lib-beat-onedrop-rim', 'Rim Drop', 'dub', 0.1, { kick: '........x.......', rim: '....x.......x...', hatClosed: '..x...x...x...x.', hatOpen: '..............o.' }),
  groove('lib-beat-steppers-heavy', 'Heavy Steppers', 'dub', 0.04, { kick: 'x...x...x...x...', snare: '........x.......', hatClosed: 'o.x.o.x.o.x.o.x.', crash: 'x...............' }),
  groove('lib-beat-rockers', 'Rockers Groove', 'reggae', 0.06, { kick: 'x.....x.x.......', snare: '....x.......x...', hatClosed: 'x.xxx.xxx.xxx.xx', rim: '......o.......o.' }),
  groove('lib-beat-rockers-flying', 'Flying Cymbal', 'reggae', 0.05, { kick: 'x.......x.......', snare: '....x.......x...', hatOpen: '..x...x...x...x.', hatClosed: 'x...x...x...x...' }),
  groove('lib-beat-four-deep', 'Deep Four', 'house', 0.1, { kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: '..x...x...x...x.', hatOpen: '..o.......o.....' }),
  groove('lib-beat-four-shuffle', 'Shuffle House', 'house', 0.18, { kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: 'x.xxx.xxx.xxx.xx', rim: '...o.....o......' }),
  groove('lib-beat-techno-drive', 'Motor Drive', 'techno', 0.02, { kick: 'x...x...x...x...', hatClosed: 'xxxxxxxxxxxxxxxx', hatOpen: '..x...x...x...x.', clap: '....x.......x...' }),
  groove('lib-beat-techno-hollow', 'Hollow Room', 'techno', 0.05, { kick: 'x...x...x...x...', rim: '...x..x....x..x.', hatOpen: '..o...o...o...o.', tom: '.......o.......o' }),
  groove('lib-beat-techno-roll', 'Rolling Toms', 'techno', 0.03, { kick: 'x...x...x...x...', tom: '..o..o..o..o.o.o', hatClosed: '..x...x...x...x.', clap: '............x...' }),
  groove('lib-beat-acid', 'Acid Floor', 'acid', 0.06, { kick: 'x...x...x...x...', clap: '....x.......x...', hatClosed: 'o.x.o.x.o.x.o.x.', hatOpen: '......x.......x.' }),
  groove('lib-beat-broken', 'Broken Beat', 'breaks', 0.14, { kick: 'x......x..x.....', snare: '....x.......x..o', hatClosed: 'x.x.xx.xx.x.xx.x', rim: '.o.....o........' }),
  groove('lib-beat-breaks-amen', 'Chopped Break', 'breaks', 0.08, { kick: 'x.x.......xx....', snare: '....x..x.x..x..x', hatClosed: 'x.x.x.x.x.x.x.x.' }),
  groove('lib-beat-breaks-slow', 'Slow Funk Break', 'funk', 0.16, { kick: 'x......xx.......', snare: '....x.......x...', hatClosed: 'xxxxxxxxxxxxxxxx', hatOpen: '.......o........' }),
  groove('lib-beat-funk-ghost', 'Ghost Notes', 'funk', 0.12, { kick: 'x..x..x...x.....', snare: '....x.o.o..ox.o.', hatClosed: 'x.x.x.x.x.x.x.x.' }),
  groove('lib-beat-garage', 'Two Step', 'garage', 0.22, { kick: 'x.....x...x.....', snare: '....x.......x...', hatClosed: '..x.x.x...x.x.x.', rim: '.......o.......o' }),
  groove('lib-beat-livetronica', 'Festival Groove', 'livetronica', 0.07, { kick: 'x...x...x..xx...', snare: '....x.......x...', hatClosed: 'x.xxx.xxx.xxx.xx', hatOpen: '......o.......o.', crash: 'x...............' }),
  groove('lib-beat-halftime', 'Halftime Weight', 'dub', 0.06, { kick: 'x.........x.....', snare: '........x.......', hatClosed: 'x.x.x.x.x.x.x.x.', rim: '...o.......o....' }),
  groove('lib-beat-trap', 'Trap Rattle', 'breaks', 0, { kick: 'x......x..x.....', snare: '........x.......', hatClosed: 'x.x.x.xxx.x.xxxx', clap: '........x.......' }),
  groove('lib-beat-ambient', 'Pulse Only', 'ambient', 0, { kick: 'x.......x.......', hatClosed: '....o.......o...', rim: '..........o.....' }),
];

export const LIBRARY_MELODIC: LibMelodic[] = [...bassLoops(), ...chordLoops(), ...hookLoops(), ...TEXTURES];

/** The library's style for a loop id, if it is one of its loops. */
const STYLE_BY_ID = new Map<string, LoopStyle>([...LIBRARY_MELODIC, ...LIBRARY_BEATS].map((l) => [l.id, l.style]));
export function loopStyle(id: string): LoopStyle | undefined {
  return STYLE_BY_ID.get(id);
}
