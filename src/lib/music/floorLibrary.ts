/** Original performance collections. A shared title joins compatible parts in
 * the existing browser. Pitches are scale degrees, never borrowed recordings.
 * Four-bar phrases use A/B/A/C: recognition, response, return, turnaround.
 * Each collection has its own rhythm, harmonic pace and register. */
import { EXTRA_COLLECTIONS } from './extraCollections';
import type { BeatLoop, LoopNote, LoopRole, MelodicLoop } from './loops';
import type { LoopStyle } from './loopLibrary';
import { applyGroove, voiceLead, FEELS } from './groove';

type Hit = [beat: number, dur: number, degree: number, velocity: number];
type Style = LoopStyle;
export interface FloorCollection {
  id: string; name: string; style: Style; bpm: number; kit: string;
  roots: number[]; bassTone: string; keysTone: string; leadTone: string;
  bass: Hit[]; hook: Hit[]; answer: Hit[];
  chords: Array<[number, number, number]>;
  drums: BeatLoop['rows']; swing: number;
  /** Octaves (seven degrees each) to move the hook by; a lowered hook also stays at or under C5 in every key. */
  leadOctave?: number;
}
// Drum strings are two independently written bars. o is a ghost, not another accent.
export const FLOOR_COLLECTIONS: FloorCollection[] = [
  ...EXTRA_COLLECTIONS,
  { id: 'kinetic', name: 'Kinetic Relay', style: 'dnb', bpm: 174, kit: 'kit.roller', roots: [0,0,0,6],
    bassTone: 'bass.roller-reese', keysTone: 'keys.liquid-tines', leadTone: 'lead.signal-pluck', swing: 0.02,
    bass: [[0,0.6,0,0.95],[0.75,0.2,0,0.42],[1.5,0.4,7,0.8],[2.25,0.6,0,0.9],[3.25,0.35,4,0.7]],
    hook: [[0.5,0.3,4,0.8],[1,0.3,4,0.65],[1.75,0.6,7,0.9],[3,0.5,6,0.7]],
    answer: [[0.5,0.3,4,0.8],[1,0.3,4,0.6],[1.75,0.6,9,0.85],[3,0.3,7,0.7],[3.5,0.3,6,0.6]],
    chords: [[0,1.25,0.7],[2.75,0.65,0.55]],
    drums: { kick:'x.........x.....x......x..x.....',snare:'....x..o....x.o.....x.o.....x..o',hatClosed:'x.o.x.o.x.o.x.oxx.o.x.o.x.o.x.o.',hatOpen:'..............o...............o.' } },
  { id: 'glass', name: 'Glass Current', style: 'dnb', bpm: 170, kit: 'kit.roller', roots: [0,5,3,4],
    bassTone: 'bass.liquid-sub', keysTone: 'keys.liquid-tines', leadTone: 'lead.signal-pluck', swing: 0.04,
    bass: [[0,1.2,0,0.9],[1.5,0.35,4,0.7],[2.5,0.6,7,0.85],[3.5,0.3,4,0.6]],
    hook: [[0,0.7,2,0.85],[1,0.35,4,0.7],[1.75,0.7,6,0.8],[3,0.7,4,0.65]],
    answer: [[0,0.7,2,0.8],[1,0.35,4,0.65],[2,0.8,7,0.85],[3.25,0.4,6,0.65]],
    chords: [[0,2.5,0.65],[3,0.7,0.45]],
    drums: { kick:'x.........x.....x.........x..o..',snare:'....x.......x..o....x..o....x...',hatClosed:'x.o.x.o.x.o.x.o.x.o.x.o.x.o.x.oo',rim:'.......o..................o.....',hatOpen:'..............o...............o.' } },
  { id: 'switchyard', name: 'Switchyard', style: 'dnb', bpm: 176, kit: 'kit.roller', roots: [0,0,3,4],
    bassTone: 'bass.roller-reese', keysTone: 'keys.rave-chop', leadTone: 'lead.signal-pluck', swing: 0,
    bass: [[0,0.4,0,1],[0.5,0.4,7,0.8],[1.75,0.2,0,0.55],[2.5,0.4,4,0.85],[3,0.25,2,0.7],[3.5,0.3,0,0.8]],
    hook: [[0.75,0.2,7,0.9],[1.25,0.2,7,0.6],[2,0.4,4,0.8],[3.5,0.3,2,0.7]],
    answer: [[0.75,0.2,7,0.9],[1.25,0.2,9,0.6],[2,0.4,7,0.8],[3,0.2,4,0.7],[3.5,0.3,2,0.6]],
    chords: [[0.75,0.2,0.8],[2.5,0.2,0.6]],
    drums: { kick:'x.x.......x.....x......x..x..o..',snare:'....x..o.o..x.o.....x.o..o..x.ox',hatClosed:'x.x.o.x.x.o.x.oxx.o.x.x.o.x.x.o.',tom:'.............................o.o' } },
  { id: 'magnet', name: 'Magnet Mouth', style: 'dubstep', bpm: 140, kit: 'kit.halfstep', roots: [0,0,5,4],
    bassTone: 'bass.vowel-crush', keysTone: 'keys.rave-chop', leadTone: 'lead.fat-saw', leadOctave: -1, swing: 0,
    bass: [[0,0.6,0,1],[0.75,0.2,7,0.65],[1.5,0.3,0,0.9],[2.75,0.6,4,0.85],[3.5,0.25,2,0.65]],
    hook: [[0,1.25,0,0.51],[1.5,0.5,1,0.36],[2,1,2,0.48],[3.25,0.5,1,0.36]],
    answer: [[0,1.25,4,0.51],[1.5,0.5,5,0.36],[2,1,4,0.45],[3.25,0.5,3,0.36]],
    chords: [[0,0.35,0.7],[3,0.3,0.5]],
    drums: { kick:'x.....x....o....x......x......x.',snare:'........x...............x.....o.',clap:'........o...............o.......',hatClosed:'x.x.o.xxx.x.o.x.x.x.o.x.x.x.oxox',rim:'.....o...............o..........' } },
  { id: 'substation', name: 'Substation', style: 'dubstep', bpm: 138, kit: 'kit.halfstep', roots: [0,6,0,4],
    bassTone: 'bass.halfstep-wobble', keysTone: 'keys.dub-skank', leadTone: 'lead.signal-pluck', swing: 0.06,
    bass: [[0,1.4,0,0.95],[1.75,0.3,4,0.65],[2.75,0.8,0,0.9]],
    hook: [[0.75,0.4,4,0.8],[1.5,0.4,6,0.65],[3,0.5,7,0.85]],
    answer: [[0.75,0.4,4,0.8],[1.5,0.4,6,0.65],[2.75,0.3,9,0.8],[3.5,0.3,7,0.7]],
    chords: [[1.5,0.12,0.75],[3.5,0.1,0.5]],
    drums: { kick:'x..........x....x.....x.........',snare:'........x...............x.......',hatClosed:'x...o.x.x...o.x.x.o...x.x...o.xx',hatOpen:'......o...............o.........',rim:'...o...............o.......o....' } },
  { id: 'ratchet', name: 'Ratchet Bloom', style: 'dubstep', bpm: 144, kit: 'kit.halfstep', roots: [0,3,0,5],
    bassTone: 'bass.vowel-crush', keysTone: 'keys.rave-chop', leadTone: 'lead.signal-pluck', swing: 0,
    bass: [[0,0.2,0,1],[0.25,0.2,0,0.55],[0.75,0.4,7,0.85],[1.5,0.25,4,0.7],[2.5,0.2,0,0.9],[2.75,0.2,0,0.5],[3.25,0.4,2,0.8]],
    hook: [[0,0.4,7,0.9],[1.5,0.3,4,0.75],[2.75,0.5,2,0.65]],
    answer: [[0,0.4,7,0.9],[1.5,0.3,9,0.7],[2.75,0.25,7,0.75],[3.25,0.4,4,0.65]],
    chords: [[0,0.25,0.75],[1.5,0.2,0.55]],
    drums: { kick:'x..o..x.........x....x....x.....',snare:'........x......o........x....o.o',hatClosed:'x.x.x.xxx.x.xxoxx.x.x.x.x.x.xxxx',clap:'........o...............o.......' } },
  { id: 'velvet', name: 'Velvet Elevator', style: 'house', bpm: 124, kit: 'kit.club-pocket', roots: [0,3,5,4],
    bassTone: 'bass.club-finger', keysTone: 'keys.liquid-tines', leadTone: 'keys.filter-disco', leadOctave: -1, swing: 0.12,
    bass: [[0.5,0.3,0,0.95],[1.25,0.18,7,0.5],[1.75,0.3,4,0.8],[2.5,0.3,0,0.9],[3.25,0.18,2,0.55],[3.5,0.3,4,0.8]],
    hook: [[0.5,0.5,4,0.85],[1.25,0.25,5,0.6],[1.5,0.75,4,0.8],[2.75,0.75,2,0.7]],
    answer: [[0.5,0.5,2,0.8],[1.25,0.25,3,0.6],[1.5,0.75,4,0.8],[2.75,0.75,3,0.7]],
    chords: [[0.5,0.25,0.8],[1.75,0.18,0.55],[2.5,0.3,0.75],[3.5,0.2,0.6]],
    drums: { kick:'x...x...x...x...x...x...x...x...',clap:'....x.......x.......x.......x...',hatClosed:'o..o..o.o..o..o.o..o..o.o..o.o..',hatOpen:'..x...x...x...x...x...x...x...x.',rim:'.......o.......o.......o.....o..' } },
  { id: 'copper', name: 'Copper Disco', style: 'house', bpm: 122, kit: 'kit.club-pocket', roots: [0,0,3,4],
    bassTone: 'bass.club-finger', keysTone: 'keys.rave-chop', leadTone: 'lead.signal-pluck', swing: 0.1,
    bass: [[0,0.3,0,0.95],[0.75,0.18,0,0.45],[1,0.3,7,0.85],[1.75,0.18,4,0.55],[2.5,0.3,0,0.9],[3,0.18,2,0.6],[3.5,0.3,4,0.8]],
    hook: [[0.25,0.2,2,0.7],[0.75,0.2,4,0.85],[1.5,0.4,7,0.9],[2.5,0.2,4,0.7],[3,0.5,2,0.65]],
    answer: [[0.25,0.2,2,0.7],[0.75,0.2,4,0.85],[1.5,0.4,9,0.85],[2.5,0.2,7,0.7],[3,0.5,4,0.65]],
    chords: [[0.75,0.2,0.75],[1.5,0.3,0.65],[2.75,0.2,0.8],[3.5,0.2,0.55]],
    drums: { kick:'x...x...x...x...x...x...x...x..o',clap:'....x.......x.......x.......x...',hatClosed:'x.oxx.oxx.oxx.oxx.oxx.oxx.oxx.o.',hatOpen:'......o.......o.......o.......o.',tom:'.............................o..' } },
  { id: 'jack', name: 'Jack Circuit', style: 'house', bpm: 128, kit: 'kit.club-pocket', roots: [0,6,3,4],
    bassTone: 'bass.club-finger', keysTone: 'keys.rave-chop', leadTone: 'lead.signal-pluck', swing: 0.16,
    bass: [[0.5,0.2,0,0.95],[1,0.18,0,0.5],[1.5,0.2,7,0.8],[2.5,0.2,0,0.9],[3.25,0.18,4,0.6],[3.5,0.25,2,0.8]],
    hook: [[0,0.2,7,0.9],[0.75,0.2,7,0.6],[1.5,0.4,4,0.8],[3,0.3,2,0.7]],
    answer: [[0,0.2,7,0.9],[0.75,0.2,7,0.6],[1.5,0.4,9,0.85],[2.75,0.2,6,0.7],[3.5,0.25,4,0.65]],
    chords: [[0.5,0.15,0.8],[1.5,0.15,0.6],[2.5,0.15,0.75],[3.25,0.12,0.5]],
    drums: { kick:'x...x...x...x...x...x...x...x...',clap:'....x.......x.......x.......x..o',hatClosed:'x.ox..o.x.ox..o.x.ox..o.x.ox..o.',hatOpen:'..x...x...x...x...x...x...x...x.',rim:'...o.....o.........o.....o....o.' } },
  { id: 'yard', name: 'Yard Lanterns', style: 'dub', bpm: 74, kit: 'kit.roots-session', roots: [0,0,3,4],
    bassTone: 'bass.yard-wood', keysTone: 'keys.dub-skank', leadTone: 'keys.bubble-organ', leadOctave: -1, swing: 0.06,
    bass: [[0.5,0.7,0,0.95],[1.5,0.3,2,0.65],[2,1,4,0.9],[3.5,0.3,2,0.7]],
    hook: [[0.5,0.75,2,0.4],[1.5,0.4,1,0.3],[2,1,0,0.38]],
    answer: [[0.5,0.75,2,0.4],[1.5,0.4,3,0.33],[2,0.75,4,0.4],[3,0.5,3,0.33]],
    chords: [[1,0.12,0.8],[3,0.1,0.6]],
    drums: { kick:'........x...............x.......',rim:'........x...............x.....o.',hatClosed:'o.x.o.x.o.x.o.x.o.x.o.x.o.x.o.x.',hatOpen:'..............o.................',tom:'.............................o.o' } },
  { id: 'tower', name: 'Tower Steppers', style: 'dub', bpm: 78, kit: 'kit.roots-session', roots: [0,3,0,4],
    bassTone: 'bass.yard-wood', keysTone: 'keys.bubble-organ', leadTone: 'lead.hollow', swing: 0.04,
    bass: [[0,0.45,0,1],[1,0.35,7,0.75],[2,0.65,0,0.9],[3,0.3,4,0.7],[3.5,0.3,2,0.6]],
    hook: [[0.75,0.4,0,0.8],[1.5,0.4,2,0.65],[2.5,0.7,4,0.85]],
    answer: [[0.75,0.4,0,0.8],[1.5,0.4,2,0.65],[2.5,0.4,7,0.85],[3.25,0.4,6,0.7]],
    chords: [[0.5,0.16,0.8],[0.75,0.1,0.4],[1.5,0.16,0.6],[2.5,0.16,0.75],[3.5,0.16,0.6]],
    drums: { kick:'x...x...x...x...x...x...x...x...',rim:'........x...............x.......',hatClosed:'o.x.o.x.o.x.o.x.o.x.o.x.o.x.o.x.',tom:'...............o.............o..',hatOpen:'......o...............o.........' } },
  { id: 'mango', name: 'Mango Wire', style: 'dub', bpm: 82, kit: 'kit.roots-session', roots: [0,4,3,0],
    bassTone: 'bass.yard-wood', keysTone: 'keys.skank-guitar', leadTone: 'lead.hollow', swing: 0.08,
    bass: [[0,0.3,0,0.95],[0.5,0.25,0,0.6],[1.5,0.6,4,0.85],[2.5,0.4,2,0.75],[3.5,0.3,4,0.8]],
    hook: [[0,0.35,0,0.85],[0.75,0.3,2,0.65],[1.5,0.5,4,0.8],[3,0.4,2,0.6]],
    answer: [[0,0.35,0,0.85],[0.75,0.3,2,0.65],[1.5,0.5,7,0.85],[3,0.4,4,0.7]],
    chords: [[0.5,0.12,0.8],[1.5,0.1,0.6],[2.5,0.12,0.75],[3.5,0.1,0.55]],
    drums: { kick:'x.......x.......x.....o.x.......',rim:'........x...............x.......',snare:'....o.......o.......o.......o...',hatClosed:'o.x.o.x.o.x.o.x.o.x.o.x.o.x.ox.o',tom:'..............................o.' } },
];

type StyledMelodic = MelodicLoop & { style: LoopStyle; bpm: [number, number]; tone: string };
/** The feel a collection's written notes are played with. */
export const floorFeel = (c: FloorCollection) => (c.style === 'house' || c.style === 'french') ? FEELS.house : c.style === 'dub' ? FEELS.roots : FEELS.straight;
/** A collection's four bars as written, before the feel: the song builder (demoSongs.ts) cuts its sections from these. */
export function floorMaterial(c: FloorCollection): { bass: LoopNote[]; chords: LoopNote[]; hook: LoopNote[]; voicings: number[][]; ceiling?: number } {
  const phrase = (hits: Hit[], bar: number, root: number): LoopNote[] => hits.map(([beat,dur,d,velocity]) => ({
    beat: bar*4+beat, dur, degrees: [root+d], velocity: bar === 1 ? velocity*0.92 : velocity,
  }));
  const bass = c.roots.flatMap((r,b) => phrase(c.bass,b,r));
  // End on the home fifth, then a short root pickup; leave an audible breath.
  const last = bass[bass.length-1]; last.dur = Math.min(last.dur, 15.5-last.beat);
  if (last.dur <= 0) bass.pop();
  bass.push({beat:15.5,dur:0.18,degrees:[4],velocity:0.7},{beat:15.75,dur:0.16,degrees:[0],velocity:0.55});
  // Open voicings keep the chord root out of the bass register. Adjacent
  // chords share upper tones; sevenths provide colour without a low cluster.
  const voicings = voiceLead(c.roots.map(r => [r,r+2,r+4,r+6]), [2,4,6,7]);
  const chords = c.roots.flatMap((_r,b) => c.chords.map(([beat,dur,velocity]): LoopNote => ({
    beat:b*4+beat,dur,velocity:velocity*[1,.82,.94,.88][b],degrees:voicings[b],
  })));
  const shift = (c.leadOctave ?? 0)*7;
  const hook = c.roots.flatMap((r,b) => phrase(b === 1 || b === 3 ? c.answer : c.hook,b,r+shift));
  hook[hook.length-1].degrees = [7+shift]; // return to the tonic above the next bass root
  return { bass, chords, hook, voicings, ...(shift < 0 ? { ceiling: 72 } : {}) };
}
function parts(c: FloorCollection): StyledMelodic[] {
  const feel = floorFeel(c);
  const build = (role: LoopRole, tone: string, notes: LoopNote[], ceiling?: number): StyledMelodic => ({
    id: `floor-${c.id}-${role}`, name: `${c.name} / ${role === 'lead' ? 'Hook' : role === 'bass' ? 'Bass' : 'Chords'}`,
    role, tone, style: c.style, bpm: [c.bpm-4,c.bpm+4], beats: 16, groove: `floor-${c.id}-beat`,
    notes: applyGroove(notes, feel).sort((a,b) => a.beat-b.beat), ...(ceiling ? { ceiling } : {}),
  });
  const { bass, chords, hook, ceiling } = floorMaterial(c);
  return [build('bass',c.bassTone,bass), build('chords',c.keysTone,chords), build('lead',c.leadTone,hook,ceiling)];
}
const ALL_PARTS = FLOOR_COLLECTIONS.flatMap(parts);
export const FLOOR_MELODIC = ALL_PARTS.filter(l => l.role !== 'lead');
export const FLOOR_LEADS = ALL_PARTS.filter(l => l.role === 'lead');
export const FLOOR_BEATS: Array<BeatLoop & { style: LoopStyle; bpm: [number,number] }> = FLOOR_COLLECTIONS.map(c => ({
  id:`floor-${c.id}-beat`, name:`${c.name} / Drums`, steps:(c.drums.kick!.length as 32 | 64), kit:c.kit, swing:c.swing, rows:c.drums,
  style:c.style,bpm:[c.bpm-4,c.bpm+4],
}));
