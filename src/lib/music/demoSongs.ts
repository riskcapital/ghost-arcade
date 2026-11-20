/**
 * The starter set: eight whole songs, not eight unrelated loops.
 *
 * A song is one key, one tempo, one kit and one sound per part. Its rows are
 * its sections (intro, verse, bridge, drop, chorus, break, second verse,
 * outro), every one cut from the same four bars of bass, chords and hook
 * (floorLibrary.ts), so any row is that song and moving down the rows is the
 * song unfolding. The order the sections play in, and for how many bars, is
 * the song's arrangement (songs.ts): the song timeline plays it through.
 *
 * Sections differ by what plays and how full it is: the intro is drums and
 * held chords, the verse brings the bass in, the bridge thins out and rolls
 * the snare up to the drop, the chorus adds the hook, the break takes the
 * drums away.
 *
 * Pure: the store turns these into the songs and set list of a new project.
 */

import { voiceItem, type ClipStack } from './clipStack';
import { changePatternGrid, createPattern, type DrumPattern, type PatternLength } from './drumPattern';
import { FLOOR_COLLECTIONS, floorFeel, floorMaterial, type FloorCollection } from './floorLibrary';
import { applyGroove } from './groove';
import { loopNotesBetween, type LoopNote, type LoopRole } from './loops';
import { DRUM_VOICES, type DrumVoice } from './noteEvents';
import type { MusicKey } from './studioSets';
import type { BeatClip, NotesClip, Session, TrackId } from './session';
import type { SongSection } from './songs';

/** The rows of a starter song, top to bottom. */
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

/**
 * A song's pictures, planned section by section (audio shader names, without "VX-" and ".fs").
 * A look comes in with the clip it is on and goes when the section changes, so the picture moves
 * through the song as the music does: something quiet for the intro, the verse's drum look, a new
 * one for the bridge, the drop's own pair, the hook's look in the chorus, a held one for the break.
 * No song shares a look with another.
 */
interface VisualPlan {
  /** With the held chords of the intro, and again in the outro. */
  intro: string;
  /** With the drums of both verses. */
  verse: string;
  /** With the hook's calls in the bridge. */
  bridge: string;
  /** With the drums of the drop and the chorus. */
  drop: string;
  /** With the bass in the drop. */
  dropBass: string;
  /** With the hook in the chorus. */
  chorus: string;
  /** With the held chords of the break. */
  rest: string;
  /** With the hook's answers in the second verse. */
  verse2: string;
}

interface DemoDef {
  /** The floor collection its parts come from. */
  collection: string;
  key: MusicKey;
  form: Form;
  visuals: VisualPlan;
}

/** The set, in playing order: it climbs from house to jungle and comes down through three kinds of dub. */
const DEMOS: DemoDef[] = [
  // Warm house: cloth, slats and light on water.
  { collection: 'velvet', key: { root: 2, scale: 'dorian' }, form: 'club',
    visuals: { intro: 'Silk', verse: 'Louvers', bridge: 'KineticLights', drop: 'PulseBars', dropBass: 'SpeakerCone', chorus: 'LiquidLight', rest: 'Caustics', verse2: 'RoseCurves' } },
  // French touch: chrome, op art and mirrors.
  { collection: 'chrome', key: { root: 9, scale: 'minor' }, form: 'club',
    visuals: { intro: 'MoltenChrome', verse: 'OpBands', bridge: 'TunnelLines', drop: 'Stack', dropBass: 'Quicksilver', chorus: 'Kaleidobloom', rest: 'SoapFilm', verse2: 'OpDisc' } },
  // Jam band lift: sky, horizon and stars.
  { collection: 'aurora', key: { root: 4, scale: 'dorian' }, form: 'club',
    visuals: { intro: 'Aurora', verse: 'LightLines', bridge: 'Ridgelines', drop: 'Starburst', dropBass: 'Horizon', chorus: 'SpiralGalaxy', rest: 'Riverlight', verse2: 'Fireflies' } },
  // Industrial: stone, beams and scopes.
  { collection: 'blacksteel', key: { root: 4, scale: 'minor' }, form: 'bass',
    visuals: { intro: 'HazeBeams', verse: 'Pillars', bridge: 'Scanner', drop: 'Monolith', dropBass: 'SpeakerStack', chorus: 'Oscillogram', rest: 'Remnant', verse2: 'WireCorrupt' } },
  // Dubstep: LED slabs, shock fronts and tearing signal.
  { collection: 'magnet', key: { root: 5, scale: 'minor' }, form: 'bass',
    visuals: { intro: 'Ferrofluid', verse: 'LedMonolith', bridge: 'SignalTear', drop: 'Shockwave', dropBass: 'Maelstrom', chorus: 'NeonFault', rest: 'EventHorizon', verse2: 'RadialTear' } },
  // Chiptune: pixels, counters and memory.
  { collection: 'cobalt', key: { root: 0, scale: 'minor' }, form: 'club',
    visuals: { intro: 'Glyphs', verse: 'LedGrid', bridge: 'BitCounter', drop: 'PixelBurst', dropBass: 'Stairs', chorus: 'PixelDrip', rest: 'Automaton', verse2: 'HexDump' } },
  // Jungle: bar codes, data and sorted pixels.
  { collection: 'oxide', key: { root: 7, scale: 'minor' }, form: 'breaks',
    visuals: { intro: 'Moire', verse: 'Barcode', bridge: 'DataPlot', drop: 'Sorter', dropBass: 'Datamosh', chorus: 'DataStream', rest: 'ScanField', verse2: 'GlitchCollage' } },
  // Psychedelic dub: deep water, living forms and jewels.
  { collection: 'moss', key: { root: 2, scale: 'minor' }, form: 'dub',
    visuals: { intro: 'Nebula', verse: 'Shallows', bridge: 'Medusa', drop: 'PlasmaCells', dropBass: 'FractalCoral', chorus: 'JuliaJewel', rest: 'RingedPlanet', verse2: 'BaitBall' } },
  // Hard roots dub: the sound system itself.
  { collection: 'current', key: { root: 9, scale: 'minor' }, form: 'dub',
    visuals: { intro: 'Vinyl', verse: 'EchoRings', bridge: 'Spring', drop: 'TapeLoop', dropBass: 'Undertow', chorus: 'Cymatics', rest: 'Smoke', verse2: 'Knotwork' } },
  // Smoky studio dub: ink, paisley and feedback.
  { collection: 'tinroof', key: { root: 7, scale: 'minor' }, form: 'dub',
    visuals: { intro: 'Inkwell', verse: 'RippleTank', bridge: 'Paisley', drop: 'Feedback', dropBass: 'Marbling', chorus: 'Mandala', rest: 'Moon', verse2: 'MeltBow' } },
];

/** Every look the starter set uses, as shader file names (for checking them against the library). */
export function demoLooks(): string[] {
  return DEMOS.flatMap((d) => Object.values(d.visuals).map((name) => `VX-${name}.fs`));
}

export interface DemoSong {
  name: string;
  bpm: number;
  key: MusicKey;
  session: Session;
  sections: SongSection[];
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

function drumsFor(c: FloorCollection, row: Row, bridgeBars: number): DrumPattern | null {
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
  return changePatternGrid(p, 32);
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

  const none = { bass: null, lead: null, chords: null, texture: null };
  switch (row) {
    case 'Intro': return { ...none, chords: pad(0.5) };
    case 'Verse': return { ...none, bass: skeleton, chords: scale(m.chords, 0.8) };
    case 'Bridge': return { ...none, bass: dub ? held(0.8) : pulse, chords: pad(0.55), lead: scale(calls, 0.85) };
    case 'Drop': return { ...none, bass: m.bass, chords: dub ? null : m.chords };
    case 'Chorus': return { ...none, bass: m.bass, chords: m.chords, lead: m.hook };
    case 'Break': return { ...none, bass: held(0.6), chords: pad(0.55), lead: scale(calls, 0.9) };
    case 'Verse 2': return { ...none, bass: m.bass, chords: scale(m.chords, 0.85), lead: scale(answers, 0.9) };
    case 'Outro': return { ...none, bass: held(0.7), chords: pad(0.45) };
  }
}

const TRACK_LABEL: Record<TrackId, string> = { beats: 'Drums', bass: 'Bass', lead: 'Hook', chords: 'Chords', texture: 'Texture' };

function look(id: string, file: string, follow: string, opacity = 1): ClipStack {
  return { items: [voiceItem(`${id}:look`, file, follow)], blend: 'screen', opacity, effects: [] };
}

/** One starter song: its rows and the order they play in. */
export function buildDemoSong(def: DemoDef, makeId: () => string): DemoSong {
  const c = FLOOR_COLLECTIONS.find((x) => x.id === def.collection)!;
  const form = FORMS[def.form];
  const dub = def.form === 'dub';
  const feel = floorFeel(c);
  const ceiling = floorMaterial(c).ceiling;
  const tones: Record<LoopRole, string | undefined> = { bass: c.bassTone, chords: c.keysTone, lead: c.leadTone, texture: undefined };
  const session = Object.fromEntries((['beats', 'bass', 'lead', 'chords', 'texture'] as TrackId[]).map((t) => [t, ROWS.map(() => null)])) as Session;
  const rowName = (row: Row) => (dub && row === 'Drop' ? 'Dub' : row);
  const plan = def.visuals;
  const file = (name: string) => `VX-${name}.fs`;

  ROWS.forEach((row, index) => {
    const name = rowName(row);
    const pattern = drumsFor(c, row, form.bridge);
    if (pattern) {
      const id = makeId();
      const beat: BeatClip = { kind: 'beat', id, name: `${name} / ${TRACK_LABEL.beats}`, pattern, kit: c.kit };
      // The drums carry the verse's look, and the drop's from the drop through the chorus.
      if (row === 'Verse' || row === 'Verse 2') beat.stack = look(id, file(plan.verse), 'kick', 0.9);
      if (row === 'Drop' || row === 'Chorus') beat.stack = look(id, file(plan.drop), 'kick', 0.95);
      session.beats[index] = beat;
    }
    const parts = partsFor(c, row, dub);
    for (const role of ['bass', 'lead', 'chords'] as const) {
      const written = parts[role];
      if (!written?.length) continue;
      const id = makeId();
      const loop = { id, name: '', role, beats: BARS * 4, notes: applyGroove(written, feel).sort((a, b) => a.beat - b.beat), ...(role === 'lead' && ceiling ? { ceiling } : {}) };
      const notes = loopNotesBetween(loop, def.key, 0, 0, loop.beats).map((n) => ({ beat: n.beat, dur: n.dur, note: n.note, velocity: n.velocity }));
      const clip: NotesClip = { kind: 'notes', id, name: `${name} / ${TRACK_LABEL[role]}`, beats: loop.beats, notes, key: { ...def.key }, instrument: null, ...(tones[role] ? { tone: tones[role] } : {}) };
      if (role === 'lead' && row === 'Bridge') clip.stack = look(id, file(plan.bridge), 'lead', 0.9);
      if (role === 'lead' && row === 'Chorus') clip.stack = look(id, file(plan.chorus), 'lead');
      if (role === 'lead' && row === 'Verse 2') clip.stack = look(id, file(plan.verse2), 'lead', 0.85);
      if (role === 'bass' && row === 'Drop') clip.stack = look(id, file(plan.dropBass), 'bass', 0.85);
      if (role === 'chords' && (row === 'Intro' || row === 'Outro')) clip.stack = look(id, file(plan.intro), 'chords', 0.85);
      if (role === 'chords' && row === 'Break') clip.stack = look(id, file(plan.rest), 'chords', 0.85);
      session[role][index] = clip;
    }
  });

  const sections: SongSection[] = form.order.map(([row, bars]) => ({ name: rowName(row), row: ROWS.indexOf(row), bars }));
  return { name: c.name, bpm: c.bpm, key: { ...def.key }, session, sections };
}

/** The starter songs, in set order. */
export function buildDemoSongs(makeId: () => string): DemoSong[] {
  return DEMOS.map((def) => buildDemoSong(def, makeId));
}
