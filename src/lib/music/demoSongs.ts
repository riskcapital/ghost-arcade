/**
 * The demo set: ten whole songs, each with a sound and a look of its own.
 *
 * Music. A song is one key, one tempo, one kit and one sound per part. Its
 * rows are its sections (intro, verse, bridge, drop, chorus, break, second
 * verse, outro), every one cut from the same four bars of bass, chords and
 * hook (floorLibrary.ts), so any row is that song and moving down the rows is
 * the song unfolding. The order the sections play in, and for how many bars,
 * is the song's arrangement (songs.ts): the song timeline plays it through.
 *
 * Sections differ by what plays and how full it is: the intro is hats, held
 * chords and a pad; the verse brings the bass in; the bridge rolls the snare
 * up under a rising swell; the drop is drums and bass; the chorus adds the
 * hook, doubled a third below on its second pass, and a high shimmer; the
 * break takes the drums away. Rows that run in eight-bar phrases have
 * eight-bar clips whose last bar fills, so a section breathes instead of
 * looping the same four bars.
 *
 * Pictures. Every clip that plays brings a composed look: a backdrop, a
 * subject drawn over it on a clear background, sometimes a light accent, and
 * effects over the lot, each layer following its own part. A song's looks
 * share one palette and one finish, and its visuals take turns one at a time
 * (the studio's auto-mix, "one at random"), so what is on screen is always
 * one finished picture, changing with the music. No two songs share a look.
 *
 * Pure: the store turns these into the songs and set list of the demo set.
 */

import { voiceItem, type ClipStack, type StackItem } from './clipStack';
import { changePatternGrid, createPattern, type DrumPattern, type PatternLength } from './drumPattern';
import { FLOOR_COLLECTIONS, floorFeel, floorMaterial, type FloorCollection } from './floorLibrary';
import { applyGroove } from './groove';
import { loopNotesBetween, type LoopNote, type LoopRole } from './loops';
import { DRUM_VOICES, type DrumVoice } from './noteEvents';
import type { MusicKey } from './studioSets';
import type { BeatClip, NotesClip, Session, TrackId } from './session';
import type { SongLook, SongSection } from './songs';
import type { StudioFinish, StudioGrade } from './studioFinish';
import type { BlendMode, Effect, EffectParams, EffectType } from '../types';

/** The rows of a demo song, top to bottom. */
const ROWS = ['Intro', 'Verse', 'Bridge', 'Drop', 'Chorus', 'Break', 'Verse 2', 'Outro'] as const;
type Row = (typeof ROWS)[number];

type Form = 'club' | 'bass' | 'breaks' | 'dub';

/** Bars each section plays for, in playing order. A bridge is as long as its drum roll (4 or 8 bars). */
const FORMS: Record<Form, { bridge: 4 | 8; order: Array<[Row, number]> }> = {
  club: { bridge: 8, order: [['Intro', 8], ['Verse', 16], ['Bridge', 8], ['Drop', 16], ['Chorus', 16], ['Break', 8], ['Verse 2', 16], ['Bridge', 8], ['Chorus', 16], ['Outro', 8]] },
  bass: { bridge: 4, order: [['Intro', 8], ['Verse', 16], ['Bridge', 4], ['Drop', 16], ['Chorus', 16], ['Break', 8], ['Verse 2', 8], ['Bridge', 4], ['Chorus', 16], ['Outro', 8]] },
  breaks: { bridge: 8, order: [['Intro', 16], ['Verse', 16], ['Bridge', 8], ['Drop', 16], ['Chorus', 16], ['Break', 8], ['Verse 2', 16], ['Bridge', 8], ['Chorus', 16], ['Outro', 16]] },
  // Dub has no build: the bridge is a short breath, and the "drop" is the dub itself, drums and bass alone.
  dub: { bridge: 4, order: [['Intro', 4], ['Verse', 16], ['Bridge', 4], ['Drop', 16], ['Chorus', 8], ['Break', 8], ['Verse 2', 16], ['Bridge', 4], ['Chorus', 8], ['Outro', 4]] },
};

// ── Looks ───────────────────────────────────────────────────────────────

/** An effect by type, with only the settings it changes from its defaults. */
type FxDef = [EffectType, EffectParams?];

/** One layer of a look: a visual voice by name (its file without "VX-" and ".fs"). */
interface LayerDef {
  v: string;
  /** The sound it follows; the clip's own part when left out. */
  follow?: string;
  blend?: BlendMode;
  opacity?: number;
  /** Only its subject draws, over the layers under it. */
  clear?: boolean;
  params?: Record<string, number>;
  fx?: FxDef[];
  /** Its settings wander slowly on their own (backdrops mostly), so a look keeps moving. */
  drift?: number;
}

/** A composed look: layers bottom first, and effects over all of them. */
interface LookDef {
  layers: LayerDef[];
  fx?: FxDef[];
}

/**
 * What a look is for. calm: held chords (intro, break, outro). rest: the
 * break and the pads around it. groove: the verse drums. bass: the verse
 * bass. lift: the bridge's build. peak: the drop and chorus drums. drive: the
 * drop and chorus bass. hook: the lead, wherever it plays.
 */
type LookRole = 'calm' | 'rest' | 'groove' | 'bass' | 'lift' | 'peak' | 'drive' | 'hook';

/** Which look each part brings in each section; a part not listed brings none. */
const PLAN: Record<Row, Partial<Record<TrackId, LookRole>>> = {
  Intro: { chords: 'calm', texture: 'rest' },
  Verse: { beats: 'groove', bass: 'bass' },
  Bridge: { beats: 'lift', bass: 'bass', lead: 'hook', texture: 'lift' },
  Drop: { beats: 'peak', bass: 'drive', chords: 'groove' },
  Chorus: { beats: 'peak', bass: 'drive', lead: 'hook' },
  Break: { bass: 'rest', chords: 'calm', lead: 'hook', texture: 'rest' },
  'Verse 2': { beats: 'groove', bass: 'bass', lead: 'hook' },
  Outro: { chords: 'calm', bass: 'rest', texture: 'rest' },
};

/** The sound a layer follows when its look does not say. */
const TRACK_FOLLOW: Record<TrackId, string> = { beats: 'kick', bass: 'bass', lead: 'lead', chords: 'chords', texture: 'pad' };

interface DemoDef {
  /** The floor collection its parts come from. */
  collection: string;
  key: MusicKey;
  form: Form;
  /** The pad its texture track plays. */
  texture: string;
  /** The studio palette its looks draw in. */
  palette: string;
  grade: StudioGrade;
  /** Glow, trails, grain (0-1). */
  finish: [number, number, number];
  /** Bars between visual changes (the music speeds it up and slows it down). */
  turn: 0.5 | 1 | 2 | 4;
  notes: string;
  looks: Record<LookRole, LookDef>;
}

/** The set, in playing order: it climbs from house to jungle and comes down through three kinds of dub. */
const DEMOS: DemoDef[] = [
  {
    // Warm house: cloth, slats and light on water, in rose gold.
    collection: 'velvet', key: { root: 2, scale: 'dorian' }, form: 'club', texture: 'pad.shimmer',
    palette: 'rose-gold', grade: 'tungsten', finish: [0.6, 0.3, 0.25], turn: 2,
    notes: 'Warm house. Silk and glass in rose gold; the picture turns every couple of bars, faster as it fills up.',
    looks: {
      calm: { layers: [{ v: 'Silk', drift: 0.3 }, { v: 'Breath', clear: true }], fx: [['halation']] },
      rest: { layers: [{ v: 'Horizon', follow: 'pad', drift: 0.3 }, { v: 'Fireflies', clear: true }] },
      groove: { layers: [{ v: 'Louvers' }, { v: 'GlassSpheres', follow: 'hats', clear: true }] },
      bass: { layers: [{ v: 'Caustics', opacity: 0.7, drift: 0.3 }, { v: 'LiquidLight', clear: true }] },
      lift: { layers: [{ v: 'KineticLights', follow: 'all' }], fx: [['zoomBlur', { amount: 0.3 }]] },
      peak: { layers: [{ v: 'InfinityRoom' }, { v: 'PulseBars', follow: 'snare', blend: 'add', opacity: 0.55 }], fx: [['mirror']] },
      drive: { layers: [{ v: 'Riverlight', opacity: 0.7, drift: 0.3 }, { v: 'SoapFilm', clear: true }] },
      hook: { layers: [{ v: 'Contour', follow: 'all', opacity: 0.55, drift: 0.3 }, { v: 'BrokenMirror', clear: true }], fx: [['halation']] },
    },
  },
  {
    // French touch: chrome, op art and mirrors, cobalt and steel.
    collection: 'chrome', key: { root: 9, scale: 'minor' }, form: 'club', texture: 'pad.glass',
    palette: 'cobalt-chrome', grade: 'steel', finish: [0.5, 0.2, 0.15], turn: 1,
    notes: 'French touch. Liquid chrome and op art in cobalt; it cuts on the bar, like the filter house it is.',
    looks: {
      calm: { layers: [{ v: 'MoltenChrome', drift: 0.3 }], fx: [['anamorphicStreak']] },
      rest: { layers: [{ v: 'PrismBeam', opacity: 0.7, drift: 0.3 }, { v: 'Crystal', clear: true }] },
      groove: { layers: [{ v: 'OpBands' }], fx: [['mirror']] },
      bass: { layers: [{ v: 'TunnelLines', opacity: 0.6 }, { v: 'Quicksilver', clear: true }] },
      lift: { layers: [{ v: 'DrosteFrames', follow: 'all' }], fx: [['zoomBlur', { amount: 0.25 }]] },
      peak: { layers: [{ v: 'Stack' }, { v: 'OpDisc', follow: 'snare', clear: true }], fx: [['rgbShift', { rgbShiftAmount: 0.006 }]] },
      drive: { layers: [{ v: 'Ferrofluid' }], fx: [['chromaticAberration', { amount: 0.3 }]] },
      hook: { layers: [{ v: 'GlassBlocks', follow: 'all', opacity: 0.5, drift: 0.3 }, { v: 'Kaleidobloom', clear: true }] },
    },
  },
  {
    // Jam band lift: sky, horizon and stars, arctic blue at night.
    collection: 'aurora', key: { root: 4, scale: 'dorian' }, form: 'club', texture: 'pad.air',
    palette: 'arctic', grade: 'night', finish: [0.65, 0.45, 0.2], turn: 4,
    notes: 'Jam band lift. A night sky that opens up: slow turns, long trails, stars on the hats.',
    looks: {
      calm: { layers: [{ v: 'Aurora', drift: 0.3 }, { v: 'Starfield', follow: 'hats', blend: 'add', opacity: 0.7 }] },
      rest: { layers: [{ v: 'Ridgelines', drift: 0.3 }], fx: [['godRays']] },
      groove: { layers: [{ v: 'LightLines' }, { v: 'Armillary', follow: 'snare', clear: true }] },
      bass: { layers: [{ v: 'Waterfall' }] },
      lift: { layers: [{ v: 'Starburst', follow: 'all' }] },
      peak: { layers: [{ v: 'SpiralGalaxy', drift: 0.2 }, { v: 'MeteorShower', follow: 'snare', clear: true }] },
      drive: { layers: [{ v: 'Pulsar', opacity: 0.7 }, { v: 'RingedPlanet', clear: true }] },
      hook: { layers: [{ v: 'PointCloud', follow: 'all', opacity: 0.6, drift: 0.3 }, { v: 'Loom', clear: true }], fx: [['halation']] },
    },
  },
  {
    // Industrial: stone, beams and scopes, black and white with one red.
    collection: 'blacksteel', key: { root: 4, scale: 'minor' }, form: 'bass', texture: 'pad.dark-drone',
    palette: 'mono-accent', grade: 'neutral', finish: [0.35, 0.2, 0.55], turn: 1,
    notes: 'Industrial. Concrete, beams and engraving in black and white with one red; hard cuts on the bar.',
    looks: {
      calm: { layers: [{ v: 'HazeBeams', drift: 0.3 }, { v: 'Monolith', clear: true }] },
      rest: { layers: [{ v: 'Remnant', drift: 0.25 }] },
      groove: { layers: [{ v: 'Pillars' }, { v: 'LaserLattice', follow: 'snare', blend: 'add', opacity: 0.6 }] },
      bass: { layers: [{ v: 'SpeakerStack' }], fx: [['scanlines', { scanlinesIntensity: 0.35 }]] },
      lift: { layers: [{ v: 'TestPattern', follow: 'all' }], fx: [['zoomBlur', { amount: 0.35 }]] },
      peak: { layers: [{ v: 'Megastructure' }, { v: 'ScanHead', follow: 'snare', clear: true }], fx: [['rgbShift', { rgbShiftAmount: 0.004 }]] },
      drive: { layers: [{ v: 'Survey', drift: 0.2 }, { v: 'Oscillogram', blend: 'add', opacity: 0.8 }] },
      hook: { layers: [{ v: 'Automaton', follow: 'all', opacity: 0.6 }, { v: 'Engraving', clear: true }] },
    },
  },
  {
    // Dubstep: LED slabs, shock fronts and tearing signal, in neon.
    collection: 'magnet', key: { root: 5, scale: 'minor' }, form: 'bass', texture: 'pad.sweep',
    palette: 'neon-fault', grade: 'neutral', finish: [0.7, 0.25, 0.3], turn: 1,
    notes: 'Dubstep. Neon, shock waves and torn signal; the drop changes the picture on every bar.',
    looks: {
      calm: { layers: [{ v: 'NeonFault' }] },
      rest: { layers: [{ v: 'LiquidGlass', opacity: 0.6, drift: 0.3 }, { v: 'EventHorizon', clear: true }] },
      groove: { layers: [{ v: 'LedMonolith' }] },
      bass: { layers: [{ v: 'Maelstrom', drift: 0.2 }], fx: [['twirl', { amount: 0.25 }]] },
      lift: { layers: [{ v: 'SignalTear', follow: 'all' }], fx: [['glitch', { glitchIntensity: 0.3 }]] },
      peak: { layers: [{ v: 'Shockwave' }, { v: 'RadialTear', follow: 'snare', blend: 'add', opacity: 0.6 }], fx: [['rgbShift', { rgbShiftAmount: 0.01 }]] },
      drive: { layers: [{ v: 'WireCorrupt' }, { v: 'BeamBurn', blend: 'add', opacity: 0.6 }] },
      hook: { layers: [{ v: 'VideoSynth', follow: 'all', opacity: 0.5, drift: 0.3 }, { v: 'DitherStorm', clear: true }] },
    },
  },
  {
    // Chiptune: pixels, counters and memory, in lavender.
    collection: 'cobalt', key: { root: 0, scale: 'minor' }, form: 'club', texture: 'pad.glass',
    palette: 'lavender-lab', grade: 'neutral', finish: [0.4, 0.1, 0.1], turn: 1,
    notes: 'Chiptune. Pixels, memory and counters, crisp with no trails; quick cuts.',
    looks: {
      calm: { layers: [{ v: 'Bitplanes', drift: 0.3 }] },
      rest: { layers: [{ v: 'Circuit', drift: 0.25 }] },
      groove: { layers: [{ v: 'LedWall' }] },
      bass: { layers: [{ v: 'Stairs' }, { v: 'BitCounter', blend: 'add', opacity: 0.6 }] },
      lift: { layers: [{ v: 'BadSectors', follow: 'all' }] },
      peak: { layers: [{ v: 'TileWall' }, { v: 'PixelBurst', follow: 'snare', clear: true }] },
      drive: { layers: [{ v: 'PixelDrip' }] },
      hook: { layers: [{ v: 'TileFlip', follow: 'all', opacity: 0.6 }, { v: 'HexDump', clear: true }] },
    },
  },
  {
    // Jungle: bar codes, data and sorted pixels, blood orange under sodium light.
    collection: 'oxide', key: { root: 7, scale: 'minor' }, form: 'breaks', texture: 'pad.air',
    palette: 'blood-orange', grade: 'sodium', finish: [0.5, 0.3, 0.4], turn: 1,
    notes: 'Jungle. Bar codes, data and sorted pixels in blood orange; busy breaks make the cuts come faster.',
    looks: {
      calm: { layers: [{ v: 'Colorizer', drift: 0.3 }] },
      rest: { layers: [{ v: 'ScanField', drift: 0.3 }] },
      groove: { layers: [{ v: 'Barcode' }, { v: 'BarcodeVertical', follow: 'hats', blend: 'add', opacity: 0.5 }] },
      bass: { layers: [{ v: 'Datamosh' }, { v: 'DataStream', blend: 'add', opacity: 0.6 }] },
      lift: { layers: [{ v: 'Sorter', follow: 'all' }] },
      peak: { layers: [{ v: 'GlitchCollage' }, { v: 'WrongStride', follow: 'snare', blend: 'add', opacity: 0.6 }] },
      drive: { layers: [{ v: 'Databend' }] },
      hook: { layers: [{ v: 'Spectra', follow: 'all', opacity: 0.6 }, { v: 'DataPlot', clear: true }] },
    },
  },
  {
    // Psychedelic dub: deep water, living forms and jewels.
    collection: 'moss', key: { root: 2, scale: 'minor' }, form: 'dub', texture: 'pad.shimmer',
    palette: 'deep-sea', grade: 'neutral', finish: [0.6, 0.55, 0.25], turn: 4,
    notes: 'Psychedelic dub. Deep water and living forms; slow turns and long trails, kaleidoscope at the peak.',
    looks: {
      calm: { layers: [{ v: 'Nebula', drift: 0.3 }, { v: 'Medusa', clear: true }] },
      rest: { layers: [{ v: 'Shallows', drift: 0.3 }] },
      groove: { layers: [{ v: 'PlasmaCells', drift: 0.2 }] },
      bass: { layers: [{ v: 'Morphogen', opacity: 0.7, drift: 0.2 }, { v: 'BaitBall', clear: true }] },
      lift: { layers: [{ v: 'Hyperbolic', follow: 'all' }] },
      peak: { layers: [{ v: 'FractalCoral' }], fx: [['kaleidoscope', { kaleidoscopeSegments: 8 }]] },
      drive: { layers: [{ v: 'Swarm', drift: 0.2 }, { v: 'DoubleHelix', clear: true }] },
      hook: { layers: [{ v: 'Marbling', opacity: 0.45, drift: 0.3 }, { v: 'JuliaJewel', clear: true }] },
    },
  },
  {
    // Hard roots dub: the sound system itself, under a sodium street light.
    collection: 'current', key: { root: 9, scale: 'minor' }, form: 'dub', texture: 'pad.dark-drone',
    palette: 'sodium-street', grade: 'sodium', finish: [0.5, 0.4, 0.45], turn: 2,
    notes: 'Roots dub. The sound system itself: vinyl, speakers and tape, under a street light.',
    looks: {
      calm: { layers: [{ v: 'Vinyl' }] },
      rest: { layers: [{ v: 'Smoke', drift: 0.3 }] },
      groove: { layers: [{ v: 'EchoRings' }, { v: 'SpeakerCone', clear: true }] },
      bass: { layers: [{ v: 'Undertow', drift: 0.2 }] },
      lift: { layers: [{ v: 'Spring', follow: 'all' }] },
      peak: { layers: [{ v: 'VHSTracking' }, { v: 'Cymatics', follow: 'snare', blend: 'add', opacity: 0.5 }] },
      drive: { layers: [{ v: 'Clockwork' }] },
      hook: { layers: [{ v: 'Interlace', follow: 'all', opacity: 0.5 }, { v: 'OscBank', clear: true }] },
    },
  },
  {
    // Smoky studio dub: ink, paisley and feedback, bone and ink.
    collection: 'tinroof', key: { root: 7, scale: 'minor' }, form: 'dub', texture: 'pad.air',
    palette: 'bone-ink', grade: 'tungsten', finish: [0.45, 0.5, 0.5], turn: 4,
    notes: 'Studio dub. Ink, paisley and feedback on old paper; slow, smoky turns.',
    looks: {
      calm: { layers: [{ v: 'InkBloom', drift: 0.3 }] },
      rest: { layers: [{ v: 'Moon' }] },
      groove: { layers: [{ v: 'LiquidSignal' }] },
      bass: { layers: [{ v: 'Caustic', drift: 0.2 }] },
      lift: { layers: [{ v: 'Paisley', follow: 'all' }] },
      peak: { layers: [{ v: 'Feedback' }, { v: 'Mandala', follow: 'snare', clear: true }] },
      drive: { layers: [{ v: 'MeltBow' }] },
      hook: { layers: [{ v: 'Plotter', follow: 'all', drift: 0.3 }, { v: 'TimeSlice', clear: true }] },
    },
  },
];

/** Every look the demo set uses, as shader file names (for checking them against the library). */
export function demoLooks(): string[] {
  return DEMOS.flatMap((d) => Object.values(d.looks).flatMap((look) => look.layers.map((l) => `VX-${l.v}.fs`)));
}

/** A small stable number from a string, for each layer's own drift. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483647;
}

function effects(id: string, defs: FxDef[] | undefined): Effect[] {
  return (defs ?? []).map(([type, params], i) => ({ id: `${id}:fx${i}`, type, enabled: true, params: { ...(params ?? {}) } }));
}

/** A clip's visuals from a look, each layer following its sound. A stack lists its top layer first. */
function stackFrom(id: string, look: LookDef, track: TrackId): ClipStack {
  const items = look.layers.map((layer, i): StackItem => {
    const item = voiceItem(`${id}:${i}`, `VX-${layer.v}.fs`, layer.follow ?? TRACK_FOLLOW[track]);
    return {
      ...item,
      voice: { ...item.voice!, ...(layer.clear ? { clear: true } : {}) },
      blend: layer.blend ?? 'normal',
      opacity: layer.opacity ?? 1,
      params: { ...(layer.params ?? {}) },
      effects: effects(`${id}:${i}`, layer.fx),
      ...(layer.drift ? { drift: { on: true, amount: layer.drift, speed: 0.25, seed: seedOf(`${id}:${i}`) } } : {}),
    };
  });
  return { items: items.reverse(), blend: 'screen', opacity: 1, effects: effects(id, look.fx) };
}

// ── Music ───────────────────────────────────────────────────────────────

export interface DemoSong {
  name: string;
  bpm: number;
  key: MusicKey;
  session: Session;
  sections: SongSection[];
  /** For the performer: what the song is and how it moves. */
  notes: string;
  /** How its visuals take turns, the palette they draw in and the finish over them. */
  look: SongLook;
}

const BARS = 4;
const STEPS = 64; // four bars of sixteenths

/** A written drum row over four bars: x a hit, o a soft one. */
function rowSteps(row: string | undefined): number[] {
  const out = new Array<number>(STEPS).fill(0);
  if (!row) return out;
  for (let i = 0; i < STEPS; i++) {
    const ch = row[i % row.length];
    out[i] = ch === 'x' ? 0.9 : ch === 'o' ? 0.5 : 0;
  }
  return out;
}

/** True when the kick is on every beat: the bridge and intro keep it there. */
const fourOnFloor = (c: FloorCollection) => [0, 4, 8, 12].every((i) => (c.drums.kick ?? '')[i] === 'x');

/**
 * Bars a row's clips run for: eight where every section on that row is a
 * whole number of eight-bar phrases (so a phrase can end in a fill), else four.
 * The bridge is its own drum roll and keeps its length.
 */
function rowBars(form: Form, row: Row): 4 | 8 {
  if (row === 'Bridge') return 4;
  return FORMS[form].order.filter(([r]) => r === row).every(([, bars]) => bars % 8 === 0) ? 8 : 4;
}

function drumsFor(c: FloorCollection, row: Row, bridgeBars: number, bars: 4 | 8): DrumPattern | null {
  if (row === 'Break') return null;
  const floor = fourOnFloor(c);
  if (row === 'Bridge') return rollUp(c, bridgeBars, floor);
  const p = createPattern(STEPS);
  p.swing = c.swing;
  const take = (voices: DrumVoice[], gain = 1) => {
    for (const v of voices) p.tracks[v] = rowSteps(c.drums[v]).map((x) => x * gain);
  };
  const written = DRUM_VOICES.filter((v) => c.drums[v]);
  if (row === 'Intro' || row === 'Outro') {
    // Time-keeping only: hats and rim, and the kick where it carries the pulse.
    take(written.filter((v) => v === 'hatClosed' || v === 'rim' || (v === 'hatOpen' && row === 'Outro')), 0.9);
    if (floor) take(['kick'], 0.85);
    else for (const bar of [0, 2]) p.tracks.kick[bar * 16] = 0.75;
    if (row === 'Outro') p.tracks.crash[0] = 0.6;
  } else if (row === 'Verse') {
    // The groove without its fills and open hats, so the drop has somewhere to go.
    take(written.filter((v) => v !== 'tom' && v !== 'hatOpen' && v !== 'crash'), 0.92);
  } else {
    take(written.filter((v) => v !== 'crash'));
    if (row === 'Drop' || row === 'Chorus') p.tracks.crash[0] = 0.7;
  }
  return changePatternGrid(bars === 8 ? phrase(p, c, row) : p, 32);
}

/**
 * Four bars of groove played twice as one eight-bar phrase: the second half
 * opens up a little (open hats on the off-beats in the drop and chorus, a
 * softer crash at its top) and the last bar ends in a fill into the next.
 */
function phrase(four: DrumPattern, c: FloorCollection, row: Row): DrumPattern {
  const p = createPattern((STEPS * 2) as PatternLength);
  p.swing = four.swing;
  for (const v of DRUM_VOICES) p.tracks[v] = [...four.tracks[v], ...four.tracks[v]];
  const big = row === 'Drop' || row === 'Chorus';
  if (big) {
    p.tracks.crash[STEPS] = 0.45;
    for (let s = STEPS; s < STEPS * 2 - 16; s += 4) if (!p.tracks.hatOpen[s + 2]) p.tracks.hatOpen[s + 2] = 0.35;
  }
  // The fill: the last beat (verses) or the last two (drop and chorus), the hats making room.
  const end = STEPS * 2;
  const from = end - (big ? 8 : 4);
  for (let s = from; s < end; s++) {
    p.tracks.hatClosed[s] = 0;
    p.tracks.hatOpen[s] = 0;
    if (s > from) p.tracks.kick[s] = 0;
  }
  const toms = !!c.drums.tom;
  for (let s = from; s < end; s++) {
    const t = (s - from) / (end - from);
    if (big && toms && s < end - 4) {
      if (s % 2 === 0) p.tracks.tom[s] = 0.55 + 0.3 * t;
    } else {
      p.tracks.snare[s] = 0.35 + 0.55 * t;
    }
  }
  return p;
}

/** The bridge's drums: the snare rolls up from quarters to sixteenths and the kick drops out for the last bar. */
function rollUp(c: FloorCollection, bars: number, floor: boolean): DrumPattern {
  const steps = (bars * 16) as PatternLength;
  const p = createPattern(steps);
  p.swing = 0;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    // Quarters for the first half, eighths, then sixteenths for the last bar.
    const every = t < 0.5 ? 4 : i < steps - 16 ? 2 : 1;
    if (i % every === 0) p.tracks.snare[i] = 0.28 + 0.7 * t;
    if (i < steps - 16 && i % (floor ? 4 : 8) === 0) p.tracks.kick[i] = 0.85;
    if (i % 4 === 2 && t < 0.5) p.tracks.hatClosed[i] = 0.5;
  }
  void c;
  return changePatternGrid(p, 32);
}

type Part = LoopNote[] | null;

function partsFor(c: FloorCollection, row: Row, dub: boolean): Record<LoopRole, Part> {
  const m = floorMaterial(c);
  const bar = (n: LoopNote) => Math.min(BARS - 1, Math.floor(n.beat / 4));
  const scale = (notes: LoopNote[], gain: number): LoopNote[] => notes.map((n) => ({ ...n, velocity: n.velocity * gain }));

  // Bass: the riff, its skeleton (the accents only), a held root, or a pulse on the root.
  const held = (velocity: number): LoopNote[] => c.roots.map((r, b) => ({ beat: b * 4, dur: 3.6, degrees: [r], velocity }));
  const skeleton = m.bass.filter((n) => n.velocity >= 0.75);
  const pulse: LoopNote[] = c.roots.flatMap((r, b) => Array.from({ length: 8 }, (_x, i) => ({ beat: b * 4 + i / 2, dur: 0.4, degrees: [r], velocity: 0.5 + 0.4 * ((b * 8 + i) / 32) })));

  // Chords: the written rhythm, or one held chord a bar.
  const pad = (velocity: number): LoopNote[] => m.voicings.map((degrees, b) => ({ beat: b * 4, dur: 3.8, degrees, velocity }));

  // Lead: the whole hook, its calls (bars 1 and 3) or its answers (bars 2 and 4).
  const calls = m.hook.filter((n) => bar(n) % 2 === 0);
  const answers = m.hook.filter((n) => bar(n) % 2 === 1);

  // Texture: a held pad on the chord's upper tones, a swell, a high shimmer or a drone.
  const upper = (velocity: number, dur = 3.9): LoopNote[] => m.voicings.map((v, b) => ({ beat: b * 4, dur, degrees: v.slice(1), velocity }));
  const swell: LoopNote[] = m.voicings.map((v, b) => ({ beat: b * 4, dur: 3.95, degrees: v.slice(1), velocity: 0.22 + 0.12 * b }));
  const shimmer: LoopNote[] = [0, 2].map((b) => ({ beat: b * 4, dur: 7.8, degrees: m.voicings[b].slice(2).map((d) => d + 7), velocity: 0.26 }));
  const drone: LoopNote[] = [{ beat: 0, dur: 15.9, degrees: [c.roots[0], c.roots[0] + 4], velocity: 0.34 }];

  const none = { bass: null, lead: null, chords: null, texture: null };
  switch (row) {
    case 'Intro': return { ...none, chords: pad(0.5), texture: upper(0.3) };
    case 'Verse': return { ...none, bass: skeleton, chords: scale(m.chords, 0.8) };
    case 'Bridge': return { ...none, bass: dub ? held(0.8) : pulse, chords: pad(0.55), lead: scale(calls, 0.85), texture: swell };
    case 'Drop': return { ...none, bass: m.bass, chords: dub ? null : m.chords };
    case 'Chorus': return { ...none, bass: m.bass, chords: m.chords, lead: m.hook, texture: shimmer };
    case 'Break': return { ...none, bass: held(0.6), chords: pad(0.55), lead: scale(calls, 0.9), texture: drone };
    case 'Verse 2': return { ...none, bass: m.bass, chords: scale(m.chords, 0.85), lead: scale(answers, 0.9) };
    case 'Outro': return { ...none, bass: held(0.7), chords: pad(0.45), texture: upper(0.26) };
  }
}

/**
 * Four bars of a part as an eight-bar phrase: played twice, the chorus hook
 * doubled a third below on its second pass, a held pad left as it is.
 */
function phraseNotes(notes: LoopNote[], role: LoopRole, row: Row): LoopNote[] {
  const second = notes.map((n) => ({
    ...n,
    beat: n.beat + 16,
    ...(role === 'lead' && row === 'Chorus' ? { degrees: [...n.degrees, ...n.degrees.map((d) => d - 2)] } : {}),
  }));
  return [...notes, ...second];
}

const TRACK_LABEL: Record<TrackId, string> = { beats: 'Drums', bass: 'Bass', lead: 'Hook', chords: 'Chords', texture: 'Pad' };

/** One demo song: its rows, the order they play in, and its look. */
export function buildDemoSong(def: DemoDef, makeId: () => string): DemoSong {
  const c = FLOOR_COLLECTIONS.find((x) => x.id === def.collection)!;
  const form = FORMS[def.form];
  const dub = def.form === 'dub';
  const feel = floorFeel(c);
  const ceiling = floorMaterial(c).ceiling;
  const tones: Record<LoopRole, string | undefined> = { bass: c.bassTone, chords: c.keysTone, lead: c.leadTone, texture: def.texture };
  const session = Object.fromEntries((['beats', 'bass', 'lead', 'chords', 'texture'] as TrackId[]).map((t) => [t, ROWS.map(() => null)])) as Session;
  const rowName = (row: Row) => (dub && row === 'Drop' ? 'Dub' : row);

  ROWS.forEach((row, index) => {
    const name = rowName(row);
    const bars = rowBars(def.form, row);
    const plan = PLAN[row];
    const pattern = drumsFor(c, row, form.bridge, bars);
    if (pattern) {
      const id = makeId();
      const beat: BeatClip = { kind: 'beat', id, name: `${name} / ${TRACK_LABEL.beats}`, pattern, kit: c.kit };
      if (plan.beats) beat.stack = stackFrom(id, def.looks[plan.beats], 'beats');
      session.beats[index] = beat;
    }
    const parts = partsFor(c, row, dub);
    for (const role of ['bass', 'lead', 'chords', 'texture'] as const) {
      const written = parts[role];
      if (!written?.length) continue;
      const id = makeId();
      const grooved = applyGroove(written, feel);
      const notesIn = bars === 8 ? phraseNotes(grooved, role, row) : grooved;
      const loop = { id, name: '', role, beats: bars * 4, notes: notesIn.sort((a, b) => a.beat - b.beat), ...(role === 'lead' && ceiling ? { ceiling } : {}) };
      const notes = loopNotesBetween(loop, def.key, 0, 0, loop.beats)
        .map((n) => ({ beat: n.beat, dur: n.dur, note: n.note, velocity: n.velocity }))
        .sort((a, b) => a.beat - b.beat || a.note - b.note);
      const clip: NotesClip = { kind: 'notes', id, name: `${name} / ${TRACK_LABEL[role]}`, beats: loop.beats, notes, key: { ...def.key }, instrument: null, ...(tones[role] ? { tone: tones[role] } : {}) };
      const lookRole = plan[role];
      if (lookRole) clip.stack = stackFrom(id, def.looks[lookRole], role);
      session[role][index] = clip;
    }
  });

  const sections: SongSection[] = form.order.map(([row, bars]) => ({ name: rowName(row), row: ROWS.indexOf(row), bars }));
  const finish: StudioFinish = { glow: def.finish[0], trails: def.finish[1], grade: def.grade, grain: def.finish[2] };
  const look: SongLook = { mix: { mode: 'random', bars: def.turn, follow: true }, palette: def.palette, finish };
  return { name: c.name, bpm: c.bpm, key: { ...def.key }, session, sections, notes: def.notes, look };
}

/** The demo songs, in set order. */
export function buildDemoSongs(makeId: () => string): DemoSong[] {
  return DEMOS.map((def) => buildDemoSong(def, makeId));
}
