import { describe, expect, it } from 'vitest';
import { changePatternGrid, clearPattern, createPattern, normalizePattern, patternBeats, resizePattern, starterPattern, stepAt, stepsBetween } from './drumPattern';
import { beatTick, nearestGridStep, swingBeat, type NoteGrid } from './grid';
import { PlayedNotes, patternLengthFor, quantizeBeats, quantizeDrumHit, stepForBeat, takeLoop, writeHits } from './loopRecorder';
import { importMidi, patternTrack } from './midiExport';
import { readMidiFile, writeMidiFile } from './midiFile';
import { normalizeClip } from './session';
import { changePartGrid, emptyPart, normalizePart, partHitsBetween, partSteps, resizePart, setStep, setTrackLength, songHitsBetween } from './drumMachine/machineBeat';

const times = (p: ReturnType<typeof createPattern>) => stepsBetween(p, 0, patternBeats(p)).map(({ beat, voice, velocity }) => ({ beat, voice, velocity }));

describe('fine drum grids', () => {
  it('keeps legacy timing and preserves a swung groove when refined and saved', () => {
    const original = starterPattern();
    original.swing = 0.4;
    original.tracks.snare[7] = 0.3;
    for (const grid of [32, 64] as const) {
      const finer = changePatternGrid(original, grid);
      expect(finer.steps).toBe(grid);
      expect(patternBeats(finer)).toBe(4);
      expect(times(finer)).toEqual(times(original));
      expect(times(normalizePattern(JSON.parse(JSON.stringify(finer))))).toEqual(times(original));
      expect(changePatternGrid(finer, 16)).toEqual(original);
    }
    expect(normalizePattern(original).grid ?? 16).toBe(16);
  });

  it.each([32, 64] as NoteGrid[])('plays adjacent 1/%i hits once across scheduler window boundaries', grid => {
    const p = createPattern(grid, grid);
    p.swing = 0.5;
    p.tracks.snare.fill(0.5);
    const all = stepsBetween(p, 0, 8);
    const windows = Array.from({ length: 160 }, (_, i) => stepsBetween(p, i / 20, (i + 1) / 20)).flat();
    expect(windows).toEqual(all);
    expect(all).toHaveLength(grid * 2);
    expect(new Set(all.map(h => beatTick(h.beat))).size).toBe(all.length);
    for (const h of all) {
      expect(stepAt(p, h.beat)).toBe(h.step);
      expect(stepForBeat(p, h.beat)).toBe(h.step);
    }
  });

  it('keeps the resolution when clearing, resizing, or saving a clip', () => {
    const p = createPattern(256, 64);
    p.tracks.kick[1] = 1;
    expect(patternBeats(resizePattern(p, 512))).toBe(32);
    expect(resizePattern(p, 512).tracks.kick[257]).toBe(1);
    expect(clearPattern(p).grid).toBe(64);
    const clip = normalizeClip(JSON.parse(JSON.stringify({ kind: 'beat', id: 'fine', name: 'Fine', pattern: p })));
    expect(clip?.kind === 'beat' && clip.pattern).toEqual(p);
    expect(patternLengthFor(64, 64)).toBe(1024);
  });

  it('records fine hits without collapsing them onto sixteenths', () => {
    const played = new PlayedNotes();
    played.hit('snare', 38, 0.6, 8.0625);
    played.hit('snare', 38, 0.9, 8.125);
    const take = takeLoop(played.all(), 8, 4, quantizeBeats('1/64'));
    const p = writeHits(createPattern(64, 64), take.hits, take.beats);
    expect(times(p).map(h => h.beat)).toEqual([0.0625, 0.125]);
    expect(p.tracks.snare.slice(1, 3)).toEqual([0.6, 0.9]);
    expect(quantizeBeats('1/32')).toBe(0.125);
  });

  it('round-trips fine MIDI hits across sixteen bars', () => {
    const p = createPattern(1024, 64);
    for (const i of [0, 1, 2, 65, 255, 511, 1023]) p.tracks.snare[i] = 1;
    const song = readMidiFile(writeMidiFile({ bpm: 170, tracks: [patternTrack(p)] }));
    const clip = importMidi(song, 'break.mid', [], () => 'fine')[0].clip;
    expect(clip.kind).toBe('beat');
    if (clip.kind !== 'beat') throw new Error('Expected a beat');
    expect(clip.pattern.grid).toBe(64);
    expect(patternBeats(clip.pattern)).toBe(64);
    expect(times(clip.pattern)).toEqual(times(p));
  });

  it('quantizes coarser grids, keeping the loudest collision', () => {
    const p = createPattern(64, 64);
    p.tracks.kick[3] = 0.5;
    p.tracks.kick[4] = 0.9;
    const coarse = changePatternGrid(p, 16);
    expect(times(coarse)).toEqual([{ beat: 0.25, voice: 'kick', velocity: 0.9 }]);
    expect(patternBeats(coarse)).toBe(4);
  });
});

describe('fine drum machine parts', () => {
  it('preserves swung triplet rolls and polymeter when refining a part', () => {
    let p = setStep(emptyPart(), 0, 1, { vel: 1, roll: 3 });
    p = setTrackLength(p, 0, 3);
    p.swing = 0.5;
    p.tracks[0].chance[1] = 0.65;
    const expected = partHitsBetween(p, 12, 12, 28);
    for (const grid of [32, 64] as const) {
      const finer = changePartGrid(p, grid);
      expect(finer.tracks[0].length).toBe(3 * grid / 16);
      expect(partHitsBetween(finer, 12, 12, 28)).toEqual(expected);
      expect(partHitsBetween(normalizePart(JSON.parse(JSON.stringify(finer)))!, 12, 12, 28)).toEqual(expected);
      expect(partSteps(resizePart(finer, 4))).toBe(grid * 4);
    }
  });

  it('does not spill swung rolls into the following step', () => {
    let p = setStep(emptyPart(), 0, 1, { vel: 1, roll: 4 });
    p = setStep(p, 0, 2, { vel: 0.5 });
    p.swing = 0.5;
    expect(partHitsBetween(p, 0, 0, 1).map(h => h.beat)).toEqual([0.375, 0.40625, 0.4375, 0.46875, 0.5]);
  });

  it('schedules mixed-resolution song parts and fine rolls in disjoint windows', () => {
    const a = setStep(emptyPart('A', 'loop', 1, 32), 0, 1, { vel: 1 });
    let b = setStep(emptyPart('B', 'fill', 1, 64), 1, 63, { vel: 1, roll: 4 });
    b.swing = 0.3;
    const song = { parts: [a, b], song: [{ id: 'a', partId: a.id, bars: 1 }, { id: 'b', partId: b.id, bars: 1 }] };
    const all = songHitsBetween(song, 0, 0, 16);
    const windows = Array.from({ length: 320 }, (_, i) => songHitsBetween(song, 0, i / 20, (i + 1) / 20)).flat();
    expect(windows).toEqual(all);
    expect(all).toHaveLength(10);
    expect(all[0].beat).toBe(0.125);
    expect(all[1].beat).toBeCloseTo(7.95625);
  });

  it('finds the nearest audible swung recording position', () => {
    for (const grid of [16, 32, 64] as const) {
      for (let i = 0; i < grid * 2; i++) {
        const at = swingBeat(i * 4 / grid, 0.5);
        expect(nearestGridStep(at + 0.001, grid, 0.5)).toBe(i);
      }
    }
  });
});


describe('recording quantize on a finer editing grid', () => {
  it('honors the selected recording division without changing the pattern resolution', () => {
    const p = createPattern(64, 64);
    expect(quantizeDrumHit(p, 0.07, '1/16')).toBe(0);
    expect(quantizeDrumHit(p, 0.07, '1/32')).toBe(0.125);
    expect(quantizeDrumHit(p, 0.07, '1/64')).toBe(0.0625);
    expect(quantizeDrumHit(p, 0.07, 'off')).toBe(0.07);
    p.swing = 0.5;
    expect(quantizeDrumHit(p, 0.36, '1/16')).toBe(0.375);
  });
});
