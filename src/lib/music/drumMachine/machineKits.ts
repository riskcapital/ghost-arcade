/**
 * The drum machine's kits: sixteen pads each, every sound synthesised from
 * the drum engine's models (nothing sampled). A pad also names the kit voice
 * it acts as for visuals (`role`), so a conga hit lights what a tom would.
 */

import type { DrumVoice } from '../noteEvents';
import type { DrumModel, DrumSound, ToneFx } from '../tone/toneTypes';
import { normalizeMacroFx, type MacroFxInstance } from '../macroFx';

/** Pads in a kit of its own. */
export const PAD_COUNT = 16;
/** Pad slots a beat starts with: the kit's sixteen and sixteen more from the other kits. */
export const BASE_PADS = 32;
/** The most pads a beat can have (MIDI notes 36 up). */
export const MAX_PADS = 92;

export type KitFamily = 'classic' | 'latin' | 'electronic' | 'weird';

export const KIT_FAMILY_LABELS: Record<KitFamily, string> = {
  classic: 'Classic',
  latin: 'Latin percussion',
  electronic: 'Electronic',
  weird: 'Weird',
};

export interface MachinePad {
  /** Short: fits a pad. */
  name: string;
  role: DrumVoice;
  sound: DrumSound;
}

export interface MachineKit {
  /** Stable: saved in beats, never renamed. */
  id: string;
  name: string;
  family: KitFamily;
  blurb: string;
  pads: MachinePad[];
  fx?: ToneFx;
  gain: number;
}

type Extra = Partial<DrumSound>;
const snd = (model: DrumModel, freq: number, decay: number, tone: number, level: number, extra: Extra = {}): DrumSound => ({ model, freq, decay, tone, level, ...extra });
const pad = (name: string, role: DrumVoice, sound: DrumSound): MachinePad => ({ name, role, sound });

// Sound makers, in the drum engine's terms.
const kick = (freq: number, decay: number, bend: number, click: number, e: Extra = {}) => snd('kick', freq, decay, 0.5, 1, { bend, click, ...e });
const snare = (freq: number, decay: number, tone: number, e: Extra = {}) => snd('snare', freq, decay, tone, 0.8, e);
const clap = (freq: number, decay: number, e: Extra = {}) => snd('clap', freq, decay, 0.5, 0.8, e);
const hat = (freq: number, decay: number, tone: number, e: Extra = {}) => snd('hat', freq, decay, tone, 0.5, { cuts: true, ...e });
const ohat = (freq: number, decay: number, tone: number, e: Extra = {}) => snd('hat', freq, decay, tone, 0.45, { choke: true, ...e });
const tom = (freq: number, decay: number, bend: number, e: Extra = {}) => snd('tom', freq, decay, 0.5, 0.8, { bend, ...e });
const rim = (freq: number, decay: number, e: Extra = {}) => snd('rim', freq, decay, 0.5, 0.6, e);
const bellc = (freq: number, decay: number) => snd('cowbell', freq, decay, 0.5, 0.45);
const cym = (freq: number, decay: number, tone: number, e: Extra = {}) => snd('cymbal', freq, decay, tone, 0.35, e);
const conga = (freq: number, decay: number, slap: number, e: Extra = {}) => snd('membrane', freq, decay, slap, 0.85, { bend: 0.12, ...e });
const shaker = (freq: number, decay: number, tone: number, e: Extra = {}) => snd('shaker', freq, decay, tone, 0.45, e);
const scrape = (freq: number, decay: number, rate: number, e: Extra = {}) => snd('scrape', freq, decay, 0.5, 0.5, { rate, ...e });
const bell = (freq: number, decay: number, tone: number, e: Extra = {}) => snd('bell', freq, decay, tone, 0.5, e);
const rise = (freq: number, decay: number, bend: number, e: Extra = {}) => snd('rise', freq, decay, 0.3, 0.6, { bend, ...e });
const glitch = (freq: number, decay: number, rate: number, tone: number, e: Extra = {}) => snd('glitch', freq, decay, tone, 0.5, { rate, ...e });
const fm = (freq: number, decay: number, ratio: number, tone: number, e: Extra = {}) => snd('fm', freq, decay, tone, 0.55, { rate: ratio, ...e });
const laser = (freq: number, decay: number, bend: number, tone: number, e: Extra = {}) => snd('laser', freq, decay, tone, 0.55, { bend, ...e });
const zap = (freq: number, decay: number, bend: number, e: Extra = {}) => snd('zap', freq, decay, 0.5, 0.7, { bend, ...e });
const blip = (freq: number, decay: number, bend: number, e: Extra = {}) => snd('blip', freq, decay, 0.5, 0.4, { bend, ...e });

export const MACHINE_KITS: MachineKit[] = [
  // ── Classic ──
  {
    id: 'mk.boom-box', name: 'Boom box', family: 'classic', blurb: 'The deep analog machine: long sub kick, snappy snare, cowbell and congas',
    pads: [
      pad('Kick', 'kick', kick(48, 1.6, 1.4, 0.2)), pad('Short kick', 'kick', kick(54, 0.6, 1.6, 0.4)),
      pad('Snare', 'snare', snare(185, 0.28, 0.6)), pad('Clap', 'clap', clap(1100, 0.35)),
      pad('Hat', 'hatClosed', hat(330, 0.12, 0.6)), pad('Open hat', 'hatOpen', ohat(330, 0.7, 0.6)),
      pad('Rim', 'rim', rim(1700, 0.08)), pad('Cowbell', 'rim', bellc(545, 0.35)),
      pad('Low tom', 'tom', tom(90, 0.7, 0.5)), pad('Mid tom', 'tom', tom(130, 0.6, 0.5)),
      pad('High tom', 'tom', tom(180, 0.5, 0.5)), pad('Conga', 'tom', conga(220, 0.35, 0.25)),
      pad('Clave', 'rim', rim(2500, 0.06, { level: 0.5 })), pad('Maraca', 'hatClosed', shaker(8000, 0.06, 0.6)),
      pad('Cymbal', 'crash', cym(360, 2.2, 0.5)), pad('Ride', 'crash', cym(480, 1.4, 0.8, { level: 0.25 })),
    ],
    gain: 0.95,
  },
  {
    id: 'mk.studio-acoustic', name: 'Studio kit', family: 'classic', blurb: 'A modeled acoustic kit: round kick, crack snare, brushes and toms',
    pads: [
      pad('Kick', 'kick', kick(62, 0.5, 0.9, 0.35)), pad('Kick soft', 'kick', kick(58, 0.4, 0.6, 0.1, { level: 0.75 })),
      pad('Snare', 'snare', snare(200, 0.32, 0.75)), pad('Side stick', 'rim', rim(1400, 0.07)),
      pad('Hat', 'hatClosed', hat(420, 0.07, 0.7)), pad('Open hat', 'hatOpen', ohat(420, 0.6, 0.7)),
      pad('Pedal hat', 'hatClosed', hat(420, 0.04, 0.5, { level: 0.35 })), pad('Brush', 'snare', shaker(4500, 0.18, 0.3, { level: 0.5 })),
      pad('Floor tom', 'tom', tom(85, 0.7, 0.3)), pad('Rack tom', 'tom', tom(125, 0.55, 0.3)),
      pad('High tom', 'tom', tom(170, 0.45, 0.3)), pad('Ghost', 'snare', snare(210, 0.12, 0.6, { level: 0.35 })),
      pad('Crash', 'crash', cym(400, 2.6, 0.6)), pad('Ride', 'crash', cym(520, 1.6, 0.85, { level: 0.25 })),
      pad('Bell', 'crash', bell(1450, 1.0, 0.7, { level: 0.35 })), pad('Splash', 'crash', cym(460, 0.8, 0.7)),
    ],
    gain: 0.95,
  },
  {
    id: 'mk.rhythm-box', name: 'Rhythm box', family: 'classic', blurb: 'A small, polite home rhythm machine: soft thumps, ticky hats, a wood block',
    pads: [
      pad('Kick', 'kick', kick(70, 0.45, 0.6, 0.05)), pad('Kick 2', 'kick', kick(64, 0.35, 0.4, 0.05)),
      pad('Snare', 'snare', snare(240, 0.18, 0.4)), pad('Clap', 'clap', clap(1500, 0.18, { level: 0.5 })),
      pad('Hat', 'hatClosed', hat(420, 0.05, 0.4, { level: 0.35 })), pad('Open hat', 'hatOpen', ohat(420, 0.3, 0.4, { level: 0.3 })),
      pad('Block', 'rim', rim(1200, 0.05)), pad('Clave', 'rim', rim(2500, 0.06, { level: 0.5 })),
      pad('Tom low', 'tom', tom(130, 0.3, 0.3)), pad('Tom high', 'tom', tom(190, 0.25, 0.3)),
      pad('Bongo', 'tom', conga(330, 0.18, 0.2)), pad('Conga', 'tom', conga(210, 0.25, 0.2)),
      pad('Guiro', 'hatClosed', scrape(3000, 0.2, 40)), pad('Maraca', 'hatClosed', shaker(7500, 0.05, 0.5)),
      pad('Cymbal', 'crash', cym(500, 1.1, 0.4)), pad('Bell', 'crash', bell(1800, 0.5, 0.4)),
    ],
    gain: 0.9,
  },
  // ── Latin percussion ──
  {
    id: 'mk.latin-hands', name: 'Hand drums', family: 'latin', blurb: 'Congas, bongos and timbales, open and slapped, with clave and shakers',
    pads: [
      pad('Tumba', 'kick', conga(150, 0.5, 0.15)), pad('Conga', 'tom', conga(205, 0.4, 0.2)),
      pad('Conga slap', 'snare', conga(215, 0.14, 0.9, { cuts: true })), pad('Quinto', 'tom', conga(270, 0.32, 0.25)),
      pad('Bongo low', 'tom', conga(330, 0.22, 0.3)), pad('Bongo high', 'tom', conga(440, 0.18, 0.35)),
      pad('Timbale', 'tom', conga(360, 0.4, 0.5, { bend: 0.05, model: 'membrane' })), pad('Timbale rim', 'rim', rim(2200, 0.1, { level: 0.6 })),
      pad('Clave', 'rim', rim(2500, 0.06, { level: 0.55 })), pad('Block', 'rim', rim(1100, 0.05)),
      pad('Cowbell', 'rim', bellc(600, 0.3)), pad('Agogo', 'crash', bell(880, 0.35, 0.6)),
      pad('Shaker', 'hatClosed', shaker(7000, 0.09, 0.5)), pad('Cabasa', 'hatClosed', shaker(9000, 0.07, 0.8)),
      pad('Guiro', 'hatOpen', scrape(2800, 0.28, 34)), pad('Cuica', 'tom', rise(380, 0.4, 1.1)),
    ],
    gain: 0.95,
  },
  {
    id: 'mk.carnival', name: 'Carnival', family: 'latin', blurb: 'A street parade: surdo booms, tight snare, agogo, whistle-like friction drum and shakers',
    pads: [
      pad('Surdo', 'kick', conga(70, 0.9, 0.1, { bend: 0.2, level: 1 })), pad('Surdo mute', 'kick', conga(72, 0.25, 0.2, { cuts: true })),
      pad('Caixa', 'snare', snare(330, 0.18, 0.85)), pad('Repique', 'snare', conga(300, 0.2, 0.7)),
      pad('Tamborim', 'rim', rim(1500, 0.07, { level: 0.7 })), pad('Pandeiro', 'hatClosed', shaker(6000, 0.1, 0.6, { level: 0.55 })),
      pad('Agogo low', 'rim', bell(660, 0.35, 0.6)), pad('Agogo high', 'rim', bell(990, 0.3, 0.6)),
      pad('Cuica up', 'tom', rise(420, 0.35, 1.2)), pad('Cuica down', 'tom', rise(560, 0.3, -0.8)),
      pad('Ganza', 'hatClosed', shaker(8000, 0.12, 0.7)), pad('Reco', 'hatOpen', scrape(3500, 0.25, 50)),
      pad('Triangle', 'crash', bell(2600, 0.7, 0.8, { level: 0.35 })), pad('Triangle mute', 'hatClosed', bell(2600, 0.06, 0.8, { level: 0.35 })),
      pad('Whistle', 'crash', snd('blip', 2400, 0.25, 0.5, 0.25, { bend: 0.1 })), pad('Crash', 'crash', cym(420, 1.6, 0.6)),
    ],
    gain: 0.9,
  },
  // ── Electronic ──
  {
    id: 'mk.electro-funk', name: 'Electro funk', family: 'electronic', blurb: 'Robot funk: zappy kicks, dry claps, blips and lasers',
    pads: [
      pad('Zap kick', 'kick', zap(50, 0.9, 2.6, { level: 1 })), pad('Kick', 'kick', kick(52, 0.7, 1.9, 0.75, { drive: 0.25 })),
      pad('Snare', 'snare', snare(230, 0.2, 0.85)), pad('Clap', 'clap', clap(1300, 0.22)),
      pad('Hat', 'hatClosed', hat(370, 0.06, 0.9)), pad('Open hat', 'hatOpen', ohat(370, 0.35, 0.9)),
      pad('Blip', 'rim', blip(600, 0.15, 0.8)), pad('Blip high', 'rim', blip(1200, 0.1, 1.2)),
      pad('Laser', 'tom', laser(300, 0.4, 2.5, 0.2)), pad('Pew', 'tom', laser(800, 0.2, 2, 0.4)),
      pad('Synth tom', 'tom', tom(140, 0.9, 1.6)), pad('Synth tom hi', 'tom', tom(220, 0.7, 1.6)),
      pad('Rim', 'rim', rim(2200, 0.05)), pad('Metal', 'crash', fm(420, 0.4, 1.41, 0.7)),
      pad('Cymbal', 'crash', cym(430, 1.2, 0.8)), pad('Noise hit', 'snare', snare(400, 0.4, 1, { level: 0.6 })),
    ],
    gain: 0.95,
  },
  {
    id: 'mk.warehouse', name: 'Warehouse', family: 'electronic', blurb: 'Driving techno: a round kick, rumble, clicky hats, rides and claps in a room',
    pads: [
      pad('Kick', 'kick', kick(50, 0.55, 1.7, 0.45)), pad('Rumble', 'kick', kick(42, 1.2, 0.8, 0, { drive: 0.5, level: 0.7 })),
      pad('Clap', 'clap', clap(1400, 0.4)), pad('Snare', 'snare', snare(220, 0.15, 0.7, { level: 0.6 })),
      pad('Hat', 'hatClosed', hat(400, 0.035, 0.9, { level: 0.4 })), pad('Open hat', 'hatOpen', ohat(400, 0.25, 0.85, { level: 0.35 })),
      pad('Ride', 'crash', cym(500, 1.2, 0.9, { level: 0.25 })), pad('Shaker', 'hatClosed', shaker(9000, 0.05, 0.7)),
      pad('Rim', 'rim', rim(1600, 0.04, { level: 0.55 })), pad('Perc', 'tom', fm(330, 0.15, 2.3, 0.5)),
      pad('Perc 2', 'tom', fm(510, 0.12, 3.1, 0.4)), pad('Tom', 'tom', tom(90, 0.35, 0.7)),
      pad('Stab', 'rim', fm(260, 0.3, 1.5, 0.9, { level: 0.45 })), pad('Zap', 'tom', zap(200, 0.25, 2)),
      pad('Crash', 'crash', cym(470, 0.9, 0.8)), pad('Noise', 'crash', shaker(5000, 0.8, 0.4, { level: 0.35 })),
    ],
    fx: { delay: { mix: 0.08, beats: 0.75, fb: 0.25, tone: 0.4 } }, gain: 0.95,
  },
  {
    id: 'mk.boom-bap', name: 'Dusty', family: 'electronic', blurb: 'Lo-fi hip-hop: crunchy kick and snare, shuffled hats, all through a bit crusher',
    pads: [
      pad('Kick', 'kick', kick(55, 0.6, 1.3, 0.3, { drive: 0.35 })), pad('Kick 2', 'kick', kick(60, 0.45, 1.0, 0.25, { drive: 0.3 })),
      pad('Snare', 'snare', snare(190, 0.25, 0.55, { drive: 0.3 })), pad('Snare 2', 'snare', snare(170, 0.3, 0.45, { drive: 0.4 })),
      pad('Hat', 'hatClosed', hat(340, 0.08, 0.5)), pad('Open hat', 'hatOpen', ohat(340, 0.4, 0.5)),
      pad('Rim', 'rim', rim(1500, 0.06)), pad('Clap', 'clap', clap(1100, 0.28)),
      pad('Shaker', 'hatClosed', shaker(6500, 0.08, 0.4)), pad('Tamb', 'hatClosed', shaker(8500, 0.12, 0.8, { level: 0.4 })),
      pad('Tom', 'tom', tom(115, 0.4, 0.6)), pad('Bongo', 'tom', conga(300, 0.2, 0.3)),
      pad('Snap', 'clap', clap(1800, 0.12, { level: 0.6 })), pad('Vinyl', 'crash', glitch(200, 0.3, 300, 0.9, { level: 0.2 })),
      pad('Cymbal', 'crash', cym(400, 1.3, 0.4)), pad('Bell', 'crash', bell(1200, 0.5, 0.5)),
    ],
    fx: { crush: { bits: 8, hold: 3 }, drive: 0.15 }, gain: 1,
  },
  {
    id: 'mk.big-room', name: 'Big room', family: 'electronic', blurb: 'Huge and bright: a long boom kick, layered claps, risers of noise and sharp hats',
    pads: [
      pad('Boom', 'kick', kick(46, 1.8, 2.0, 0.6, { drive: 0.2 })), pad('Kick', 'kick', kick(52, 0.6, 2.2, 0.8, { drive: 0.3 })),
      pad('Clap', 'clap', clap(1200, 0.5)), pad('Snare', 'snare', snare(240, 0.4, 0.9, { drive: 0.2 })),
      pad('Hat', 'hatClosed', hat(380, 0.05, 1)), pad('Open hat', 'hatOpen', ohat(380, 0.45, 1)),
      pad('Tom', 'tom', tom(110, 0.9, 1.2)), pad('Tom hi', 'tom', tom(160, 0.8, 1.2)),
      pad('Snap', 'clap', clap(1700, 0.15)), pad('Shaker', 'hatClosed', shaker(9000, 0.06, 0.9)),
      pad('Stab', 'rim', fm(330, 0.35, 2, 0.8)), pad('Zap', 'tom', zap(300, 0.3, 2.5)),
      pad('Crash', 'crash', cym(450, 2.5, 0.9)), pad('Ride', 'crash', cym(540, 1.4, 1, { level: 0.25 })),
      pad('Sweep down', 'crash', laser(1600, 1.2, 3, 0.1, { level: 0.4 })), pad('Impact', 'kick', kick(38, 2.2, 2.6, 1, { drive: 0.6 })),
    ],
    gain: 0.9,
  },
  // ── Weird ──
  {
    id: 'mk.circuit-bent', name: 'Circuit bent', family: 'weird', blurb: 'A broken toy: glitches, bit-crushed blips, stepped noise and wrong-way lasers',
    pads: [
      pad('Thud', 'kick', kick(45, 0.5, 3, 0.9, { drive: 0.7 })), pad('Glitch', 'snare', glitch(300, 0.25, 90, 0.6)),
      pad('Stutter', 'snare', glitch(180, 0.4, 24, 0.3)), pad('Byte', 'clap', glitch(900, 0.12, 400, 0.8)),
      pad('Tick', 'hatClosed', blip(4000, 0.02, 0.5)), pad('Fizz', 'hatOpen', glitch(4000, 0.3, 2000, 1, { choke: true })),
      pad('Up laser', 'tom', laser(200, 0.3, -2.5, 0.5)), pad('Down laser', 'tom', laser(1200, 0.4, 2.5, 0.5)),
      pad('Chirp', 'rim', blip(900, 0.08, 2.5)), pad('Bloop', 'tom', blip(220, 0.2, -1)),
      pad('Robot', 'snare', fm(140, 0.3, 0.5, 1)), pad('Wobble', 'tom', rise(150, 0.6, 2)),
      pad('Data', 'hatClosed', glitch(2500, 0.15, 800, 0.9)), pad('Buzz', 'clap', glitch(100, 0.3, 50, 0.1)),
      pad('Crunch', 'crash', snare(150, 0.6, 1, { drive: 1 })), pad('Melt', 'crash', laser(600, 2, 4, 0.2, { level: 0.4 })),
    ],
    fx: { crush: { bits: 7, hold: 4 } }, gain: 0.9,
  },
  {
    id: 'mk.metal-garden', name: 'Metal garden', family: 'weird', blurb: 'Struck metal and glass: FM gongs, bells, pipes and clanks over a deep thump',
    pads: [
      pad('Thump', 'kick', kick(44, 0.9, 1.2, 0.1)), pad('Pipe', 'snare', fm(180, 0.5, 3.5, 0.8)),
      pad('Clank', 'clap', fm(260, 0.25, 1.73, 1, { drive: 0.4 })), pad('Tin', 'hatClosed', fm(1800, 0.06, 2.4, 0.9)),
      pad('Chain', 'hatClosed', scrape(5000, 0.25, 60)), pad('Sizzle', 'hatOpen', cym(600, 1.2, 1, { choke: true })),
      pad('Gong', 'crash', fm(90, 3, 1.41, 0.6, { level: 0.6 })), pad('Glass', 'crash', bell(2200, 1.5, 0.9)),
      pad('Bell low', 'tom', bell(330, 1.4, 0.7)), pad('Bell mid', 'tom', bell(495, 1.2, 0.7)),
      pad('Bell high', 'rim', bell(740, 1.0, 0.7)), pad('Spring', 'tom', rise(220, 0.8, -1.5)),
      pad('Anvil', 'rim', fm(700, 0.3, 2.76, 1)), pad('Rattle', 'hatClosed', shaker(4500, 0.2, 0.9)),
      pad('Sheet', 'crash', cym(250, 2.5, 0.3)), pad('Drip', 'rim', blip(1500, 0.06, -1.5)),
    ],
    fx: { delay: { mix: 0.12, beats: 0.75, fb: 0.35, tone: 0.5 } }, gain: 0.85,
  },
  {
    id: 'mk.creatures', name: 'Creatures', family: 'weird', blurb: 'Croaks, chirps, squeaks and growls: drums that sound alive',
    pads: [
      pad('Growl', 'kick', rise(50, 0.6, 0.8, { level: 0.9 })), pad('Croak', 'snare', scrape(700, 0.25, 22)),
      pad('Squeak', 'clap', rise(900, 0.15, 1.5)), pad('Chirp', 'hatClosed', blip(3000, 0.04, 1.5)),
      pad('Cricket', 'hatClosed', scrape(5000, 0.12, 70)), pad('Hiss', 'hatOpen', shaker(6000, 0.5, 0.6, { choke: true })),
      pad('Whoop', 'tom', rise(300, 0.5, 2)), pad('Bubble', 'tom', blip(400, 0.08, 2)),
      pad('Pop', 'rim', conga(500, 0.05, 0.6)), pad('Gulp', 'tom', laser(500, 0.3, -1.5, 0)),
      pad('Purr', 'kick', glitch(60, 0.6, 30, 0.2)), pad('Tick', 'rim', rim(3000, 0.03)),
      pad('Wing', 'hatClosed', shaker(3000, 0.15, 0.3)), pad('Howl', 'crash', rise(250, 1.5, 1.2)),
      pad('Snap', 'clap', clap(2000, 0.1)), pad('Thump', 'kick', conga(80, 0.4, 0.1)),
    ],
    gain: 0.9,
  },
];

const BY_ID = new Map(MACHINE_KITS.map((k) => [k.id, k]));

export const DEFAULT_MACHINE_KIT = MACHINE_KITS[0].id;

export function machineKitById(id: string | null | undefined): MachineKit {
  return (id && BY_ID.get(id)) || MACHINE_KITS[0];
}

/** The keys that play the pads, four rows of four, laid out like the pads. */
export const PAD_KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];

/** The pad a computer key plays, or -1. */
export function padForKey(key: string): number {
  return PAD_KEYS.indexOf(key.toLowerCase());
}

/** MIDI notes for the pads: a pad controller's usual sixteen from C1 (36). */
export const PAD_BASE_NOTE = 36;

export function padForNote(note: number, count = PAD_COUNT): number {
  const i = note - PAD_BASE_NOTE;
  return i >= 0 && i < count ? i : -1;
}

/**
 * A kit's pads, then more to fill `count` slots: sounds from the kits of the
 * same family first, then the rest, each name once. Always the same for a kit.
 */
export function extendedPads(kit: MachineKit, count = BASE_PADS): MachinePad[] {
  const out = kit.pads.slice(0, count);
  const names = new Set(out.map((p) => p.name));
  const pool = [...MACHINE_KITS.filter((k) => k.family === kit.family && k.id !== kit.id), ...MACHINE_KITS.filter((k) => k.family !== kit.family)];
  // Take one sound from each kit in turn, so the extra pads are a spread, not one kit's leftovers.
  for (let i = 0; out.length < count && i < PAD_COUNT; i++) {
    for (const k of pool) {
      const p = k.pads[i];
      if (!p || names.has(p.name)) continue;
      names.add(p.name);
      out.push(p);
      if (out.length >= count) break;
    }
  }
  return out;
}

// ── Your kits and swapped sounds ────────────────────────────────────────

/** A kit you made: its pads (sounds), each pad's tune and level, and each pad's insert effects. */
export interface UserKit extends MachineKit {
  padTune: number[];
  padLevel: number[];
  padFx: MacroFxInstance[][];
}

export const USER_FAMILY_LABEL = 'Your kits';

/** The engine's sound types, for building a pad's sound from scratch. */
export const SOUND_MODELS: { id: DrumModel; label: string; role: DrumVoice; sound: DrumSound }[] = [
  { id: 'kick', label: 'Kick', role: 'kick', sound: kick(52, 0.7, 1.6, 0.4) },
  { id: 'snare', label: 'Snare', role: 'snare', sound: snare(200, 0.28, 0.65) },
  { id: 'clap', label: 'Clap', role: 'clap', sound: clap(1200, 0.3) },
  { id: 'hat', label: 'Hat', role: 'hatClosed', sound: hat(380, 0.08, 0.7) },
  { id: 'cymbal', label: 'Cymbal', role: 'crash', sound: cym(430, 1.5, 0.6) },
  { id: 'tom', label: 'Tom', role: 'tom', sound: tom(130, 0.5, 0.6) },
  { id: 'rim', label: 'Rim', role: 'rim', sound: rim(1700, 0.07) },
  { id: 'cowbell', label: 'Cowbell', role: 'rim', sound: bellc(560, 0.3) },
  { id: 'membrane', label: 'Hand drum', role: 'tom', sound: conga(220, 0.35, 0.3) },
  { id: 'shaker', label: 'Shaker', role: 'hatClosed', sound: shaker(7500, 0.08, 0.6) },
  { id: 'scrape', label: 'Scrape', role: 'hatOpen', sound: scrape(3000, 0.25, 38) },
  { id: 'bell', label: 'Bell', role: 'crash', sound: bell(900, 0.6, 0.6) },
  { id: 'rise', label: 'Friction drum', role: 'tom', sound: rise(400, 0.4, 1.1) },
  { id: 'zap', label: 'Zap', role: 'kick', sound: zap(60, 0.6, 2.5) },
  { id: 'blip', label: 'Blip', role: 'rim', sound: blip(800, 0.12, 1) },
  { id: 'laser', label: 'Laser', role: 'tom', sound: laser(600, 0.4, 2.5, 0.3) },
  { id: 'fm', label: 'FM metal', role: 'crash', sound: fm(400, 0.4, 1.41, 0.7) },
  { id: 'glitch', label: 'Glitch', role: 'snare', sound: glitch(300, 0.3, 60, 0.5) },
  { id: 'rattle', label: 'Rattle', role: 'hatOpen', sound: snd('rattle', 2400, 1.2, 0.5, 0.6, { rate: 28 }) },
];

const MODEL_IDS = new Set(SOUND_MODELS.map((m) => m.id));
const ROLES: DrumVoice[] = ['kick', 'snare', 'clap', 'hatClosed', 'hatOpen', 'tom', 'rim', 'crash'];

function n(v: unknown, fallback: number, min: number, max: number): number {
  const x = Number(v);
  return Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : fallback;
}

export function normalizeSound(raw: unknown): DrumSound | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<DrumSound>;
  if (!MODEL_IDS.has(s.model as DrumModel)) return null;
  const out: DrumSound = {
    model: s.model as DrumModel,
    freq: n(s.freq, 200, 20, 16000),
    decay: n(s.decay, 0.3, 0.005, 6),
    tone: n(s.tone, 0.5, 0, 1),
    level: n(s.level, 0.7, 0, 1.5),
  };
  if (s.bend !== undefined) out.bend = n(s.bend, 1, -6, 6);
  if (s.click !== undefined) out.click = n(s.click, 0, 0, 1);
  if (s.drive !== undefined) out.drive = n(s.drive, 0, 0, 1);
  if (s.rate !== undefined) out.rate = n(s.rate, 40, 0.1, 4000);
  if (s.choke) out.choke = true;
  if (s.cuts) out.cuts = true;
  return out;
}

export function normalizePad(raw: unknown): MachinePad | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<MachinePad>;
  const sound = normalizeSound(p.sound);
  if (!sound) return null;
  return { name: typeof p.name === 'string' && p.name ? p.name.slice(0, 24) : 'Pad', role: ROLES.includes(p.role as DrumVoice) ? (p.role as DrumVoice) : 'tom', sound };
}

export function normalizeUserKit(raw: unknown): UserKit | null {
  if (!raw || typeof raw !== 'object') return null;
  const k = raw as Partial<UserKit>;
  if (typeof k.id !== 'string' || !k.id.startsWith('user.')) return null;
  const pads = (Array.isArray(k.pads) ? k.pads : []).map(normalizePad);
  if (pads.length < PAD_COUNT || pads.length > MAX_PADS || pads.some((p) => !p)) return null;
  const count = pads.length;
  const per = (v: unknown) => Array.from({ length: count }, (_, i) => n(Array.isArray(v) ? v[i] : undefined, 0.5, 0, 1));
  const fx = Array.isArray(k.padFx) ? k.padFx : [];
  return {
    id: k.id,
    name: typeof k.name === 'string' && k.name ? k.name.slice(0, 40) : 'My kit',
    family: k.family && k.family in KIT_FAMILY_LABELS ? k.family : 'classic',
    blurb: typeof k.blurb === 'string' ? k.blurb.slice(0, 200) : 'Your kit',
    pads: pads as MachinePad[],
    fx: k.fx && typeof k.fx === 'object' ? (JSON.parse(JSON.stringify(k.fx)) as ToneFx) : undefined,
    gain: n(k.gain, 0.95, 0.1, 2),
    padTune: per(k.padTune),
    padLevel: per(k.padLevel),
    padFx: Array.from({ length: count }, (_, i) => normalizeMacroFx({ x: fx[i] }).x ?? []),
  };
}

/** The kit by id, among the factory kits and `mine`; the first factory kit when it is not there. */
export function findKit(id: string | null | undefined, mine: readonly MachineKit[]): MachineKit {
  return mine.find((k) => k.id === id) ?? machineKitById(id);
}

// ── The sound library ───────────────────────────────────────────────────

const rattle = (freq: number, decay: number, rate: number, tone = 0.5, e: Extra = {}) => snd('rattle', freq, decay, tone, 0.6, { rate, ...e });

/** Sounds that live only in the library, not in a kit: lasers, the vibraslap and other hits. */
export const EXTRA_SOUNDS: MachinePad[] = [
  pad('Pew', 'tom', laser(1400, 0.18, 2.2, 0.3)),
  pad('Pew pew', 'tom', laser(2200, 0.12, 1.6, 0.6)),
  pad('Blaster', 'snare', laser(900, 0.35, 3, 0.8, { drive: 0.4 })),
  pad('Ray', 'tom', fm(1200, 0.5, 0.51, 1)),
  pad('Sweep down', 'crash', laser(3000, 1.4, 4, 0.1, { level: 0.45 })),
  pad('Sweep up', 'crash', laser(150, 0.9, -4, 0.2, { level: 0.45 })),
  pad('Zap up', 'tom', laser(300, 0.25, -2.5, 0.5)),
  pad('Ricochet', 'rim', laser(4000, 0.3, 1.2, 0.2, { level: 0.4 })),
  pad('Phaser shot', 'snare', fm(700, 0.3, 3.3, 0.8)),
  pad('Ion burst', 'clap', glitch(1200, 0.25, 900, 0.8)),
  pad('Vibraslap', 'hatOpen', rattle(2400, 1.4, 26)),
  pad('Short slap', 'hatClosed', rattle(2800, 0.6, 34, 0.6)),
  pad('Low rattle', 'hatOpen', rattle(1400, 1.6, 18, 0.4)),
  pad('Boing', 'tom', snd('membrane', 160, 0.8, 0.1, 0.8, { bend: -1.2 })),
  pad('Coin', 'rim', blip(1400, 0.25, 0.6)),
  pad('Drop', 'tom', laser(900, 0.2, 1.2, 0)),
  pad('Pop', 'rim', conga(700, 0.04, 0.8)),
  pad('Whip', 'clap', shaker(5500, 0.07, 0.9, { level: 0.6 })),
  pad('Air horn hit', 'crash', fm(440, 0.6, 1.005, 0.9, { drive: 0.5 })),
  pad('Clang', 'crash', fm(320, 0.8, 2.76, 1)),
];

export type LibraryGroup = 'kicks' | 'snares' | 'hats' | 'toms' | 'perc' | 'latin' | 'lasers' | 'weird';

export const LIBRARY_GROUPS: { id: LibraryGroup; label: string }[] = [
  { id: 'kicks', label: 'Kicks' },
  { id: 'snares', label: 'Snares and claps' },
  { id: 'hats', label: 'Hats and cymbals' },
  { id: 'toms', label: 'Toms' },
  { id: 'perc', label: 'Percussion' },
  { id: 'latin', label: 'Latin' },
  { id: 'lasers', label: 'Lasers and FX' },
  { id: 'weird', label: 'Weird' },
];

export interface LibrarySound {
  id: string;
  pad: MachinePad;
  group: LibraryGroup;
  /** Where it is from: a kit's name, or "Library". */
  from: string;
}

const FX_MODELS = new Set<DrumModel>(['laser', 'zap', 'blip', 'glitch']);

function groupOf(p: MachinePad, family: KitFamily | null): LibraryGroup {
  if (FX_MODELS.has(p.sound.model) || /laser|pew|zap|ray|sweep/i.test(p.name)) return 'lasers';
  if (family === 'latin') return 'latin';
  if (family === 'weird') return 'weird';
  if (p.role === 'kick') return 'kicks';
  if (p.role === 'snare' || p.role === 'clap') return 'snares';
  if (p.role === 'hatClosed' || p.role === 'hatOpen' || p.role === 'crash') return 'hats';
  if (p.role === 'tom') return p.sound.model === 'tom' ? 'toms' : 'perc';
  return 'perc';
}

/** Every sound: each kit's pads and the library's own, grouped. */
export function soundLibrary(mine: readonly MachineKit[] = []): LibrarySound[] {
  const out: LibrarySound[] = [];
  for (const kit of [...mine, ...MACHINE_KITS]) {
    kit.pads.forEach((p, i) => out.push({ id: `${kit.id}#${i}`, pad: p, group: groupOf(p, kit.family), from: kit.name }));
  }
  EXTRA_SOUNDS.forEach((p, i) => out.push({ id: `lib#${i}`, pad: p, group: p.sound.model === 'rattle' ? 'perc' : groupOf(p, null), from: 'Library' }));
  return out;
}
