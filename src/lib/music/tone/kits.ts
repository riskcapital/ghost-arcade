/**
 * Synthesised drum kits. Every sound is modelled (sine kicks with a pitch
 * sweep and a click, hats from six detuned square waves through band-passes,
 * noise-and-tone snares, multi-burst claps), never sampled. Sounds are in
 * the beat's slot order: kick, snare, clap, closed hat, open hat, tom, rim,
 * crash.
 */

import type { DrumKit, DrumSound } from './toneTypes';

const kick = (freq: number, decay: number, bend: number, click: number, extra: Partial<DrumSound> = {}): DrumSound => ({ model: 'kick', freq, decay, tone: 0.5, bend, click, level: 1, ...extra });
const snare = (freq: number, decay: number, tone: number, extra: Partial<DrumSound> = {}): DrumSound => ({ model: 'snare', freq, decay, tone, level: 0.8, ...extra });
const clap = (freq: number, decay: number, extra: Partial<DrumSound> = {}): DrumSound => ({ model: 'clap', freq, decay, tone: 0.5, level: 0.8, ...extra });
const hat = (freq: number, decay: number, tone: number, open = false, extra: Partial<DrumSound> = {}): DrumSound => ({ model: 'hat', freq, decay, tone, level: open ? 0.45 : 0.5, choke: open, ...extra });
const tom = (freq: number, decay: number, bend: number, extra: Partial<DrumSound> = {}): DrumSound => ({ model: 'tom', freq, decay, tone: 0.5, bend, level: 0.8, ...extra });
const rim = (freq: number, decay: number, extra: Partial<DrumSound> = {}): DrumSound => ({ model: 'rim', freq, decay, tone: 0.5, level: 0.6, ...extra });
const cowbell = (freq: number, decay: number): DrumSound => ({ model: 'cowbell', freq, decay, tone: 0.5, level: 0.45 });
const cymbal = (freq: number, decay: number, tone: number, extra: Partial<DrumSound> = {}): DrumSound => ({ model: 'cymbal', freq, decay, tone, level: 0.35, ...extra });

export const DRUM_KITS: DrumKit[] = [
  {
    id: 'kit.boom', name: 'Boom', blurb: 'The deep analog kit: a long sub kick, snappy snare, cowbell in the rim slot',
    sounds: [kick(48, 1.6, 1.4, 0.2), snare(185, 0.28, 0.6), clap(1100, 0.35), hat(330, 0.12, 0.6), hat(330, 0.7, 0.6, true), tom(110, 0.6, 0.5), cowbell(545, 0.35), cymbal(360, 2.2, 0.5)],
    gain: 0.95,
  },
  {
    id: 'kit.punch', name: 'Punch', blurb: 'The punchy analog kit: a short, driven kick with a hard click and bright hats',
    sounds: [kick(52, 0.7, 1.9, 0.75, { drive: 0.25 }), snare(200, 0.32, 0.75), clap(1250, 0.32), hat(360, 0.09, 0.8), hat(360, 0.55, 0.8, true), tom(120, 0.45, 0.8), rim(1700, 0.08), cymbal(420, 1.8, 0.7)],
    fx: { drive: 0.08 }, gain: 0.95,
  },
  {
    id: 'kit.parlour', name: 'Parlour', blurb: 'A small, polite rhythm-box kit: soft thumps, ticky hats and a clave',
    sounds: [kick(70, 0.45, 0.6, 0.05), snare(240, 0.18, 0.4), clap(1500, 0.18, { level: 0.5 }), hat(420, 0.05, 0.4, false, { level: 0.35 }), hat(420, 0.3, 0.4, true, { level: 0.3 }), tom(160, 0.3, 0.3), rim(2500, 0.06, { level: 0.5 }), cymbal(500, 1.1, 0.4)],
    gain: 0.9,
  },
  {
    id: 'kit.memory', name: 'Memory chip', blurb: 'An early digital drum-machine sound: tight, crunchy, a little grainy',
    sounds: [kick(58, 0.5, 1.2, 0.5), snare(210, 0.22, 0.65), clap(1350, 0.25), hat(390, 0.07, 0.7), hat(390, 0.45, 0.7, true), tom(140, 0.35, 0.6), rim(1900, 0.05), cymbal(450, 1.4, 0.6)],
    fx: { crush: { bits: 9, hold: 2 } }, gain: 1,
  },
  {
    id: 'kit.hex', name: 'Hex', blurb: 'Electronic toms and pads: big pitch sweeps, the zaps of a hexagonal kit',
    sounds: [kick(55, 0.8, 1.6, 0.3), snare(260, 0.35, 0.5, { drive: 0.2 }), clap(1000, 0.4), hat(310, 0.1, 0.5), hat(310, 0.6, 0.5, true), tom(140, 0.9, 1.6), { model: 'zap', freq: 300, decay: 0.3, tone: 0.5, bend: 2, level: 0.7 }, cymbal(380, 1.6, 0.5)],
    fx: { chorus: { mix: 0.3, mode: 2 } }, gain: 0.95,
  },
  {
    id: 'kit.electro', name: 'Electro', blurb: 'Robot funk: zappy kicks, dry claps and blips',
    sounds: [kick(50, 0.9, 2.6, 0.4, { model: 'zap' }), snare(230, 0.2, 0.85), clap(1300, 0.22), hat(370, 0.06, 0.9), hat(370, 0.35, 0.9, true), { model: 'blip', freq: 600, decay: 0.15, tone: 0.5, bend: 0.8, level: 0.4 }, rim(2200, 0.05), cymbal(430, 1.2, 0.8)],
    gain: 0.95,
  },
  {
    id: 'kit.minimal', name: 'Minimal', blurb: 'Clean techno: a tight, round kick, clicky hats and a dry rim',
    sounds: [kick(50, 0.55, 1.7, 0.45), snare(220, 0.15, 0.7, { level: 0.6 }), clap(1400, 0.2, { level: 0.6 }), hat(400, 0.035, 0.9, false, { level: 0.4 }), hat(400, 0.25, 0.85, true, { level: 0.35 }), tom(90, 0.35, 0.7), rim(1600, 0.04, { level: 0.55 }), cymbal(470, 0.9, 0.8)],
    fx: { delay: { mix: 0.08, beats: 0.75, fb: 0.25, tone: 0.4 } }, gain: 0.95,
  },
  {
    id: 'kit.crushed', name: 'Crushed', blurb: 'Lo-fi: sample-rate drop and bit crush over a dusty kit',
    sounds: [kick(55, 0.6, 1.3, 0.3, { drive: 0.35 }), snare(190, 0.25, 0.55, { drive: 0.3 }), clap(1100, 0.28), hat(340, 0.08, 0.5), hat(340, 0.4, 0.5, true), tom(115, 0.4, 0.6), rim(1500, 0.06), cymbal(400, 1.3, 0.4)],
    fx: { crush: { bits: 6, hold: 5 }, drive: 0.15 }, gain: 1,
  },
  {
    id: 'kit.breaks', name: 'Breaks', blurb: 'A breakbeat kit pushed hard: fat snare, ringing toms, everything squashed together',
    sounds: [kick(60, 0.6, 1.1, 0.35, { drive: 0.3 }), snare(180, 0.35, 0.55, { drive: 0.4, level: 0.9 }), clap(1200, 0.3), hat(350, 0.1, 0.55), hat(350, 0.6, 0.55, true), tom(100, 0.6, 0.4), rim(1400, 0.08), cymbal(390, 1.8, 0.5)],
    fx: { drive: 0.35 }, gain: 0.85,
  },
  {
    id: 'kit.foundry', name: 'Foundry', blurb: 'Industrial: distorted kicks, metal clangs and noise',
    sounds: [kick(45, 0.9, 2.2, 0.8, { drive: 0.8 }), snare(150, 0.35, 0.9, { drive: 0.7 }), clap(900, 0.45, { drive: 0.5 }), hat(260, 0.1, 0.4, false, { drive: 0.4 }), hat(260, 0.7, 0.4, true, { drive: 0.4 }), tom(80, 0.6, 1.2, { drive: 0.5 }), cowbell(380, 0.5), cymbal(300, 2.5, 0.3, { drive: 0.4 })],
    fx: { drive: 0.4, phaser: { mix: 0.2, rate: 0.2, depth: 0.5, fb: 0.5 } }, gain: 0.8,
  },
];

const BY_ID = new Map(DRUM_KITS.map((k) => [k.id, k]));

export function kitById(id: string | null | undefined): DrumKit | undefined {
  return id ? BY_ID.get(id) : undefined;
}
