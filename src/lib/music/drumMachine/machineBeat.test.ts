import { describe, expect, it } from 'vitest';
import {
  addBlock, blockAt, emptyPart, moveBlock, normalizeBeat, partHitsBetween, resizeBlock, resizePart,
  setStep, setTrackLength, songBars, songHitsBetween, spreadHits, starterBeat, toggleStep,
} from './machineBeat';
import { MACHINE_KITS, PAD_COUNT, padForKey, padForNote } from './machineKits';

describe('machine kits', () => {
  it('every kit has sixteen pads with unique ids', () => {
    expect(new Set(MACHINE_KITS.map((k) => k.id)).size).toBe(MACHINE_KITS.length);
    for (const kit of MACHINE_KITS) expect(kit.pads).toHaveLength(PAD_COUNT);
  });
  it('has kits in every family', () => {
    expect(new Set(MACHINE_KITS.map((k) => k.family))).toEqual(new Set(['classic', 'latin', 'electronic', 'weird']));
  });
  it('maps keys and notes to pads', () => {
    expect(padForKey('1')).toBe(0);
    expect(padForKey('V')).toBe(15);
    expect(padForKey('p')).toBe(-1);
    expect(padForNote(36)).toBe(0);
    expect(padForNote(51)).toBe(15);
    expect(padForNote(52)).toBe(-1);
  });
});

describe('parts', () => {
  it('plays a step on its beat and loops', () => {
    const p = toggleStep(emptyPart(), 0, 4);
    const hits = partHitsBetween(p, 0, 0, 8);
    expect(hits.map((h) => h.beat)).toEqual([1, 5]);
  });
  it('rolls split a step and swing delays odd steps', () => {
    let p = setStep(emptyPart(), 1, 1, { vel: 1, roll: 2 });
    p = { ...p, swing: 0.5 };
    const hits = partHitsBetween(p, 0, 0, 1);
    expect(hits.map((h) => h.beat)).toEqual([0.25 + 0.125, 0.25 + 0.125 + 0.125]);
  });
  it('a short track loops on its own length', () => {
    let p = toggleStep(emptyPart(), 2, 0);
    p = setTrackLength(p, 2, 3);
    expect(partHitsBetween(p, 0, 0, 4).map((h) => h.beat)).toEqual([0, 0.75, 1.5, 2.25, 3, 3.75]);
  });
  it('chance is repeatable', () => {
    const p = setStep(toggleStep(emptyPart(), 0, 0), 0, 0, { chance: 0.5 });
    const a = partHitsBetween(p, 0, 0, 64).length;
    expect(a).toBeGreaterThan(3);
    expect(a).toBeLessThan(13);
    expect(partHitsBetween(p, 0, 0, 64).length).toBe(a);
  });
  it('spreads hits evenly', () => {
    const p = spreadHits(emptyPart(), 0, 3);
    expect(p.tracks[0].vel.map((v) => (v > 0 ? 1 : 0)).join('')).toBe('1000001000010000');
  });
  it('resizing repeats a short part', () => {
    const p = resizePart(toggleStep(emptyPart(), 0, 0), 2);
    expect(p.tracks[0].vel[16]).toBeGreaterThan(0);
    expect(p.tracks[0].length).toBe(32);
  });
});

describe('song', () => {
  it('lays parts end to end and loops', () => {
    const b = starterBeat('mk.boom-box');
    expect(songBars(b.song)).toBe(10);
    expect(blockAt(b.song, 3)).toEqual({ index: 1, startBar: 3 });
    expect(blockAt(b.song, 10)).toBeNull();
    const loopKicks = (from: number, to: number) => songHitsBetween(b, 0, from, to).filter((h) => h.pad === 0).map((h) => h.beat);
    expect(loopKicks(0, 4)).toEqual([0, 2.5]);
    // The break (bars 5-6) has no kick.
    expect(loopKicks(16, 24)).toEqual([]);
    // Past the end it starts again.
    expect(loopKicks(40, 41)).toEqual([40]);
  });
  it('edits blocks', () => {
    let song = starterBeat('x').song;
    const id = song[0].id;
    song = resizeBlock(song, id, 8);
    expect(songBars(song)).toBe(15);
    song = moveBlock(song, 0, 3);
    expect(song[3].id).toBe(id);
    song = addBlock(song, song[0].partId, 2, 0);
    expect(song).toHaveLength(5);
  });
  it('normalizes saved beats', () => {
    const b = starterBeat('mk.boom-box');
    const back = normalizeBeat(JSON.parse(JSON.stringify(b)), 'x');
    expect(back).toEqual(b);
    expect(normalizeBeat(null, 'k').parts.length).toBeGreaterThan(0);
  });
});
