/**
 * The lead loops: hooks written to stick. Each is a short, singable motif
 * said twice with one change, mostly stepwise with one leap, with space
 * between phrases, a call answered across two or four bars, and a tension
 * note (often a step above the root) that resolves on the next downbeat
 * when the loop comes round. They stay within about an octave and a fifth.
 * The dorian-flavoured ones lean on the sixth degree, the mixolydian ones on
 * the seventh. Every melody is written for this library.
 *
 * Each lead comes with the tone it was written for (tone/tones.ts); a clip
 * made from it plays on that tone until another is picked.
 */

import type { LoopNote, MelodicLoop } from './loops';
import type { LoopStyle } from './loopLibrary';

export type LeadLoop = MelodicLoop & { style: LoopStyle; tone: string };

/** [beat, duration, degree or chord degrees, velocity] */
type H = [number, number, number | number[], number?];

function lead(id: string, name: string, style: LeadLoop['style'], tone: string, beats: number, hits: H[]): LeadLoop {
  const notes: LoopNote[] = hits
    .map(([beat, dur, d, v]) => ({ beat, dur, degrees: Array.isArray(d) ? d : [d], velocity: v ?? 0.85 }))
    .sort((a, b) => a.beat - b.beat);
  return { id, name, role: 'lead', style, tone, beats, notes };
}

/** Sixteenth-note arpeggio: a degree per step from `start`. */
const arp = (start: number, seq: number[], dur = 0.22): H[] => seq.map((d, i): H => [start + i * 0.25, dur, d, i % 4 === 0 ? 0.95 : 0.72]);

export const LEADS: LeadLoop[] = [
  // ── Techno ──
  lead('lead-signal-flare', 'Signal Flare', 'techno', 'lead.pluck-delay', 8, [
    [0, 0.25, 7, 1], [0.75, 0.25, 7], [1.5, 0.5, 9], [2.5, 0.25, 7], [3, 0.75, 4],
    [4, 0.25, 7, 1], [4.75, 0.25, 7], [5.5, 0.5, 10], [6.5, 0.25, 9], [7, 0.75, 8],
  ]),
  lead('lead-stamp-press', 'Stamp Press', 'techno', 'lead.hollow', 8, [
    [0, 0.2, 0, 1], [0.75, 0.2, 7], [1.5, 0.2, 0], [2, 0.2, 6], [2.75, 0.2, 7], [3.5, 0.2, 4],
    [4, 0.2, 0, 1], [4.75, 0.2, 7], [5.5, 0.2, 0], [6, 0.2, 6], [6.75, 0.2, 9], [7.5, 0.3, 6],
  ]),
  lead('lead-cold-lights', 'Cold Lights', 'techno', 'lead.pwm', 16, [
    [0, 1.5, 4], [1.5, 0.5, 5], [2, 2, 4],
    [4, 1.5, 4], [5.5, 0.5, 5], [6, 1.5, 7], [7.5, 0.5, 6],
    [8, 1.5, 4], [9.5, 0.5, 5], [10, 2, 2],
    [12, 1, 1], [13, 1, 2], [14, 2, 1],
  ]),
  lead('lead-relay', 'Relay', 'techno', 'lead.pluck-delay', 8, [
    [0, 0.25, 0, 1], [0.5, 0.25, 2], [1, 0.25, 4], [1.5, 0.5, 7], [2.5, 0.25, 6], [3, 0.5, 4],
    [4, 0.25, 0, 1], [4.5, 0.25, 2], [5, 0.25, 4], [5.5, 0.5, 9], [6.5, 0.25, 7], [7, 0.75, 6],
  ]),

  // ── Acid ──
  lead('lead-wet-circuit', 'Wet Circuit', 'acid', 'lead.acid', 8, [
    [0, 0.2, 0, 1], [0.25, 0.2, 0, 0.6], [0.75, 0.2, 7, 1], [1, 0.2, 0], [1.5, 0.2, 3], [2, 0.2, 0, 1], [2.5, 0.2, 10], [2.75, 0.2, 7], [3.25, 0.2, 3], [3.5, 0.2, 4],
    [4, 0.2, 0, 1], [4.25, 0.2, 0, 0.6], [4.75, 0.2, 7, 1], [5, 0.2, 0], [5.5, 0.2, 3], [6, 0.2, 0, 1], [6.5, 0.2, 10], [6.75, 0.2, 9], [7.25, 0.2, 7], [7.5, 0.4, 6],
  ]),
  lead('lead-neon-eel', 'Neon Eel', 'acid', 'lead.acid', 8, [
    [0, 0.2, 7, 1], [0.5, 0.2, 0], [0.75, 0.2, 0], [1.25, 0.2, 6], [1.5, 0.2, 7, 1], [2, 0.2, 0], [2.5, 0.2, 3], [3, 0.2, 4], [3.5, 0.2, 3],
    [4, 0.2, 7, 1], [4.5, 0.2, 0], [4.75, 0.2, 0], [5.25, 0.2, 6], [5.5, 0.2, 7, 1], [6, 0.45, 9], [7, 0.2, 7], [7.5, 0.2, 6],
  ]),
  lead('lead-chrome-bite', 'Chrome Bite', 'acid', 'lead.acid', 8, [
    [0, 0.4, 0, 1], [0.75, 0.2, 0], [1, 0.2, 7, 1], [1.5, 0.2, 0], [2.25, 0.2, 3], [2.5, 0.2, 4], [3, 0.4, 6], [3.75, 0.2, 4],
    [4, 0.4, 0, 1], [4.75, 0.2, 0], [5, 0.2, 7, 1], [5.5, 0.2, 9], [6.25, 0.2, 7], [6.5, 0.2, 6], [7, 0.8, 1],
  ]),
  lead('lead-lab-coat', 'Lab Coat', 'acid', 'lead.acid', 8, [
    [0, 0.2, 0], [0.25, 0.2, 3], [0.5, 0.2, 4], [1, 0.2, 7, 1], [1.75, 0.2, 6], [2, 0.2, 4], [2.5, 0.2, 3], [3, 0.4, 0, 1],
    [4, 0.2, 0], [4.25, 0.2, 3], [4.5, 0.2, 4], [5, 0.2, 7, 1], [5.75, 0.2, 9], [6, 0.2, 7], [6.5, 0.2, 6], [7, 0.6, 1],
  ]),

  // ── House piano and stabs ──
  lead('lead-sunday-keys', 'Sunday Keys', 'house', 'keys.tine', 8, [
    [0.5, 0.4, [4, 7]], [1, 0.25, [4, 7], 0.7], [1.75, 0.5, [5, 9]], [2.5, 0.4, [4, 7]], [3.5, 0.4, [2, 4]],
    [4.5, 0.4, [4, 7]], [5, 0.25, [4, 7], 0.7], [5.75, 0.5, [5, 9]], [6.5, 0.4, [7, 11]], [7.5, 0.4, [6, 8]],
  ]),
  lead('lead-lift-off', 'Lift Off Piano', 'house', 'keys.stab', 8, [
    [0, 0.3, [0, 4]], [0.75, 0.3, [0, 4], 0.75], [1.5, 0.5, [2, 5]], [2.5, 0.3, [0, 4]], [3.25, 0.5, [-1, 4]],
    [4, 0.3, [0, 4]], [4.75, 0.3, [0, 4], 0.75], [5.5, 0.5, [2, 5]], [6.5, 0.3, [4, 7]], [7.25, 0.6, [3, 6]],
  ]),
  lead('lead-hands-up', 'Hands Up', 'house', 'keys.tine', 16, [
    [0, 0.5, 4], [0.5, 0.5, 4], [1, 1, 5], [2, 0.5, 4], [2.5, 1.5, 2],
    [4, 0.5, 4], [4.5, 0.5, 4], [5, 1, 5], [6, 0.5, 7], [6.5, 1.5, 5],
    [8, 0.5, 4], [8.5, 0.5, 4], [9, 1, 5], [10, 0.5, 4], [10.5, 1.5, 2],
    [12, 0.5, 1], [12.5, 0.5, 2], [13, 1, 4], [14, 2, 1],
  ]),
  lead('lead-glass-elevator', 'Glass Elevator', 'house', 'lead.fm-bell', 8, [
    [0, 0.25, 7], [0.5, 0.25, 9], [0.75, 0.5, 7], [1.5, 0.5, 4], [2.5, 0.25, 5], [3, 1, 4],
    [4, 0.25, 7], [4.5, 0.25, 9], [4.75, 0.5, 7], [5.5, 0.5, 4], [6.5, 0.25, 5], [7, 1, 6],
  ]),

  // ── Trance arps ──
  lead('lead-starboard', 'Starboard Arp', 'trance', 'lead.pluck-delay', 8, [
    ...arp(0, [0, 4, 7, 4, 0, 4, 7, 9, 0, 4, 7, 4, 0, 4, 7, 9]),
    ...arp(4, [5, 9, 12, 9, 5, 9, 12, 11, 5, 9, 12, 9, 5, 9, 7, 6]),
  ]),
  lead('lead-euphoria', 'Euphoria Spiral', 'trance', 'lead.pluck-delay', 16, [
    ...arp(0, [0, 2, 4, 7, 0, 2, 4, 7, 0, 2, 4, 7, 0, 2, 4, 9]),
    ...arp(4, [5, 7, 9, 12, 5, 7, 9, 12, 5, 7, 9, 12, 5, 7, 9, 11]),
    ...arp(8, [3, 5, 7, 10, 3, 5, 7, 10, 3, 5, 7, 10, 3, 5, 7, 9]),
    ...arp(12, [4, 6, 8, 11, 4, 6, 8, 11, 4, 6, 8, 11, 8, 7, 6, 8]),
  ]),
  lead('lead-blue-laser', 'Blue Laser', 'trance', 'lead.fat-saw', 8, [
    [0, 0.5, 0], [0.5, 0.5, 7], [1, 0.5, 4], [1.5, 0.5, 7], [2, 0.5, 9], [2.5, 0.5, 7], [3, 0.5, 4], [3.5, 0.5, 7],
    [4, 0.5, 0], [4.5, 0.5, 7], [5, 0.5, 4], [5.5, 0.5, 7], [6, 0.5, 11], [6.5, 0.5, 9], [7, 1, 8],
  ]),
  lead('lead-peak-time', 'Peak Time', 'trance', 'lead.fat-saw', 16, [
    [0, 1.5, 7], [1.5, 0.5, 6], [2, 2, 4],
    [4, 1.5, 7], [5.5, 0.5, 9], [6, 2, 7],
    [8, 1.5, 7], [9.5, 0.5, 6], [10, 1, 4], [11, 1, 5],
    [12, 3, 8], [15, 1, 7],
  ]),

  // ── Dub melodica ──
  lead('lead-rooftop-melodica', 'Rooftop Melodica', 'dub', 'lead.hollow', 16, [
    [0, 1, 4], [1, 0.5, 5], [1.5, 1.5, 4], [3, 1, 2],
    [4, 1, 4], [5, 0.5, 5], [5.5, 1, 7], [6.5, 1.5, 5],
    [8, 1, 4], [9, 0.5, 5], [9.5, 1.5, 4], [11, 1, 2],
    [12, 0.5, 1], [12.5, 0.5, 2], [13, 1, 0], [14, 2, -1],
  ]),
  lead('lead-lantern-smoke', 'Lantern Smoke', 'dub', 'lead.hollow', 16, [
    [0, 2, 7], [2.5, 0.5, 6], [3, 1, 4],
    [6, 1.5, 5], [7.5, 0.5, 4],
    [8, 2, 7], [10.5, 0.5, 9], [11, 1, 7],
    [14, 2, 6],
  ]),
  lead('lead-concrete-hymn', 'Concrete Hymn', 'dub', 'lead.hollow', 16, [
    [0.5, 0.5, 0], [1, 1, 2], [2, 1, 4], [3.5, 0.5, 5],
    [4, 2, 4],
    [8.5, 0.5, 0], [9, 1, 2], [10, 1, 4], [11.5, 0.5, 7],
    [12, 1.5, 6], [13.5, 2, 5],
  ]),
  lead('lead-echo-answer', 'Echo Answer', 'dub', 'lead.fm-bell', 8, [
    [0, 0.5, 4], [0.5, 0.5, 4], [1, 1, 2], [2.5, 0.5, 4], [3, 0.5, 5],
    [4, 0.5, 1], [4.5, 0.5, 1], [5, 1.5, 0], [7, 1, -1],
  ]),

  // ── Livetronica and jam leads ──
  lead('lead-canyon-soar', 'Canyon Soar', 'livetronica', 'lead.fat-saw', 16, [
    [0, 2, 4], [2, 1, 5], [3, 1, 7],
    [4, 3, 9], [7, 1, 7],
    [8, 2, 4], [10, 1, 5], [11, 1, 4],
    [12, 2, 2], [14, 2, 1],
  ]),
  lead('lead-bonfire-climb', 'Bonfire Climb', 'livetronica', 'lead.fat-saw', 16, [
    [0, 0.5, 0], [0.5, 0.5, 2], [1, 1, 4], [2, 2, 7],
    [4, 1, 6], [5, 1, 4], [6, 2, 5],
    [8, 0.5, 0], [8.5, 0.5, 2], [9, 1, 4], [10, 2, 9],
    [12, 1, 7], [13, 1, 6], [14, 2, 4],
  ]),
  lead('lead-glow-ribbon', 'Glow Ribbon', 'livetronica', 'lead.pwm', 8, [
    [0, 1.5, 7], [1.5, 0.5, 6], [2, 1, 4], [3, 1, 5],
    [4, 1.5, 7], [5.5, 0.5, 9], [6, 2, 8],
  ]),
  lead('lead-night-bloom', 'Night Bloom', 'livetronica', 'lead.fat-saw', 16, [
    [0, 1, 4], [1, 1, 6], [2, 2, 7],
    [4, 1, 6], [5, 1, 4], [6, 2, 2],
    [8, 1, 4], [9, 1, 6], [10, 1, 7], [11, 1, 9],
    [12, 2, 6], [14, 2, 4],
  ]),

  // ── Funk ──
  lead('lead-pocket-lick', 'Pocket Lick', 'funk', 'keys.funk-clav', 8, [
    [0, 0.2, 4], [0.25, 0.2, 4, 0.6], [0.75, 0.3, 6], [1.5, 0.2, 4], [2, 0.2, 2], [2.25, 0.2, 4, 0.6], [3, 0.4, 0],
    [4, 0.2, 4], [4.25, 0.2, 4, 0.6], [4.75, 0.3, 6], [5.5, 0.2, 7], [6, 0.2, 6], [6.25, 0.2, 4, 0.6], [7, 0.6, 5],
  ]),
  lead('lead-grease-fire', 'Grease Fire', 'funk', 'lead.hollow', 8, [
    [0, 0.25, 0], [0.5, 0.25, 2], [0.75, 0.25, 3], [1, 0.5, 4], [2, 0.25, 4], [2.5, 0.25, 6], [3, 0.5, 4],
    [4, 0.25, 0], [4.5, 0.25, 2], [4.75, 0.25, 3], [5, 0.5, 4], [6, 0.25, 7], [6.5, 0.25, 6], [7, 0.75, 5],
  ]),
  lead('lead-talk-strut', 'Talk Strut', 'funk', 'lead.pwm', 8, [
    [0, 0.5, 7], [1, 0.25, 6], [1.5, 0.5, 4], [2.5, 0.25, 4], [3, 1, 5],
    [4, 0.5, 7], [5, 0.25, 9], [5.5, 0.5, 7], [6.5, 0.25, 6], [7, 1, 4],
  ]),

  // ── Synthwave ──
  lead('lead-chrome-sunset', 'Chrome Sunset', 'synthwave', 'lead.pwm', 16, [
    [0, 1, 7], [1, 0.5, 6], [1.5, 1, 4], [2.5, 1.5, 5],
    [4, 1, 7], [5, 0.5, 9], [5.5, 2.5, 7],
    [8, 1, 7], [9, 0.5, 6], [9.5, 1, 4], [10.5, 1.5, 2],
    [12, 1, 1], [13, 1, 2], [14, 2, 4],
  ]),
  lead('lead-arcade-highway', 'Arcade Highway', 'synthwave', 'lead.fat-saw', 8, [
    [0, 0.5, 0], [0.5, 0.5, 4], [1, 0.5, 7], [1.5, 0.5, 11], [2, 1, 9], [3, 1, 7],
    [4, 0.5, 0], [4.5, 0.5, 4], [5, 0.5, 7], [5.5, 0.5, 11], [6, 1, 12], [7, 1, 10],
  ]),
  lead('lead-palm-static', 'Palm Static', 'synthwave', 'lead.pwm', 16, [
    [0, 2, 9], [2, 1, 7], [3, 1, 4],
    [4, 3, 5], [7, 1, 4],
    [8, 2, 9], [10, 1, 11], [11, 1, 9],
    [12, 4, 8],
  ]),

  // ── Minimal plucks ──
  lead('lead-drop-of-glass', 'Drop of Glass', 'minimal', 'lead.pluck-delay', 8, [
    [0, 0.25, 7], [1.5, 0.25, 7], [2.25, 0.25, 9], [3, 0.25, 7],
    [4, 0.25, 7], [5.5, 0.25, 4], [6.25, 0.25, 6], [7, 0.25, 5],
  ]),
  lead('lead-click-garden', 'Click Garden', 'minimal', 'lead.pluck-delay', 8, [
    [0.5, 0.2, 0], [1.25, 0.2, 4], [2, 0.2, 0], [2.75, 0.2, 6], [3.5, 0.2, 4],
    [4.5, 0.2, 0], [5.25, 0.2, 4], [6, 0.2, 7], [6.75, 0.2, 6], [7.5, 0.2, 1],
  ]),
  lead('lead-morse-bell', 'Morse Bell', 'minimal', 'lead.fm-bell', 8, [
    [0, 0.5, 9], [1.5, 0.5, 7], [3, 0.5, 9],
    [4, 0.5, 9], [5.5, 0.5, 11], [6.5, 1, 7],
  ]),
];

/**
 * The old leads, by the new lead nearest in feel, so saved scenes and
 * projects that name an old one still play.
 */
export const LEAD_ALIASES: Record<string, string> = {
  'lead-arp': 'lead-starboard',
  'lead-call': 'lead-echo-answer',
  'lead-hypnotic': 'lead-stamp-press',
  'lead-melodica': 'lead-rooftop-melodica',
  'lead-bells': 'lead-morse-bell',
  'lead-run': 'lead-relay',
  'lead-pluck': 'lead-drop-of-glass',
  'lead-detroit': 'lead-cold-lights',
  'lead-whistle': 'lead-glass-elevator',
  'lead-wander': 'lead-bonfire-climb',
};

/** The hooks a short-lived library had, by motif, to the new lead nearest them. */
const OLD_HOOKS: Record<string, string> = {
  lantern: 'lead-hands-up', swallow: 'lead-chrome-sunset', kite: 'lead-glow-ribbon', harbour: 'lead-lantern-smoke',
  melodica: 'lead-rooftop-melodica', rebel: 'lead-concrete-hymn', circuit: 'lead-signal-flare', sonar: 'lead-stamp-press',
  firefly: 'lead-sunday-keys', diva: 'lead-glass-elevator', rubber: 'lead-wet-circuit', strut: 'lead-pocket-lick',
  sunrise: 'lead-bonfire-climb', glass: 'lead-morse-bell', skip: 'lead-talk-strut', chime: 'lead-drop-of-glass',
  echo: 'lead-echo-answer', breaker: 'lead-grease-fire', lullaby: 'lead-palm-static', jam: 'lead-canyon-soar',
};

/** The id to play for `id`: itself, or the new lead an old one became. */
export function leadAlias(id: string): string {
  if (LEAD_ALIASES[id]) return LEAD_ALIASES[id];
  const m = /^lib-lead-([a-z]+)-(twice|call)$/.exec(id);
  return m && OLD_HOOKS[m[1]] ? OLD_HOOKS[m[1]] : id;
}
