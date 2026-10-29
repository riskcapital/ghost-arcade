import { describe, expect, it } from 'vitest';
import {
  ACID_STEPS,
  bowlNotes,
  canConnect,
  chordName,
  chordNotes,
  connect,
  defaultCables,
  defaultParams,
  disconnect,
  instrumentsThroughFx,
  normalizeAcidSteps,
  normalizeCables,
  normalizeParams,
  scaleNote,
  snapToScale,
  type MusicKey,
} from './studioSets';

const D_DORIAN: MusicKey = { root: 2, scale: 'dorian' };

describe('knobs', () => {
  it('keeps known knobs in range and fills in the rest', () => {
    const p = normalizeParams({ 'drone.tone': 3, 'acid.reso': -1, 'fx.reverb.mix': 0.2, 'not.a.knob': 0.5 });
    expect(p['drone.tone']).toBe(1);
    expect(p['acid.reso']).toBe(0);
    expect(p['fx.reverb.mix']).toBe(0.2);
    expect(p['not.a.knob']).toBeUndefined();
    expect(p['drone.motion']).toBe(defaultParams()['drone.motion']);
    expect(p['mix.kick.level']).toBe(0.8);
  });
});

describe('keys and chords', () => {
  it('walks the scale across octaves', () => {
    expect(scaleNote(D_DORIAN, 0, 48)).toBe(50);
    expect(scaleNote(D_DORIAN, 2, 48)).toBe(53);
    expect(scaleNote(D_DORIAN, 7, 48)).toBe(62);
    expect(scaleNote(D_DORIAN, -1, 48)).toBe(48);
  });

  it('snaps a wrong note to the nearest one in the key', () => {
    expect(snapToScale(51, D_DORIAN)).toBe(50); // D# -> D
    expect(snapToScale(52, D_DORIAN)).toBe(52); // E is in D dorian
    expect(snapToScale(54, { root: 0, scale: 'pentatonic' })).toBe(53); // F# -> F
  });

  it('stacks scale-locked chords and names them', () => {
    expect(chordNotes(D_DORIAN, 0)).toEqual([50, 53, 57, 60]);
    expect(chordName(chordNotes(D_DORIAN, 0))).toBe('Dm7');
    expect(chordName(chordNotes(D_DORIAN, 2))).toBe('Fmaj7');
    expect(chordName(chordNotes(D_DORIAN, 5))).toBe('Bm7b5');
    expect(chordName(chordNotes({ root: 0, scale: 'major' }, 4))).toBe('G7');
    expect(chordName([60, 62, 67])).toBe('Csus2');
  });

  it('tunes the bowls to the key', () => {
    expect(bowlNotes(D_DORIAN)).toEqual([50, 53, 57, 60, 64]);
  });
});

describe('acid row', () => {
  it('reads a saved row back, clamping notes and filling missing steps', () => {
    const steps = normalizeAcidSteps([{ note: 40, accent: true }, { note: null }, { note: 'x' }]);
    expect(steps).toHaveLength(ACID_STEPS);
    expect(steps[0]).toEqual({ note: 24, accent: true, glide: false });
    expect(steps[1].note).toBeNull();
    expect(steps[2].note).toBeNull();
    expect(normalizeAcidSteps(undefined)[0].note).toBe(0);
  });
});

describe('cables', () => {
  it('only joins an output to an input of the same kind', () => {
    expect(canConnect('audio:drone', 'fx:in')).toBe(true);
    expect(canConnect('cv:xy.x', 'dest:macro:energy')).toBe(true);
    expect(canConnect('cv:xy.x', 'fx:in')).toBe(false);
    expect(canConnect('audio:drone', 'dest:layer:0')).toBe(false);
    expect(canConnect('fx:in', 'audio:drone')).toBe(false);
  });

  it('gives a control input one cable, the effects rack any number', () => {
    let cables = connect([], { id: 'a', from: 'cv:drum.kick', to: 'dest:layer:0' });
    cables = connect(cables, { id: 'b', from: 'cv:drum.hatClosed', to: 'dest:layer:0' });
    expect(cables.map((c) => c.id)).toEqual(['b']);
    cables = connect(cables, { id: 'c', from: 'cv:drum.hatClosed', to: 'dest:layer:1' });
    expect(cables).toHaveLength(2);
    let audio = connect([], { id: 'd', from: 'audio:drone', to: 'fx:in' });
    audio = connect(audio, { id: 'e', from: 'audio:bowls', to: 'fx:in' });
    audio = connect(audio, { id: 'f', from: 'audio:drone', to: 'fx:in' });
    expect(audio.map((c) => c.id)).toEqual(['d', 'e']);
    expect([...instrumentsThroughFx(audio)]).toEqual(['drone', 'bowls']);
    expect(disconnect(audio, 'd').map((c) => c.id)).toEqual(['e']);
  });

  it('reads saved cables back, dropping ones that do not fit', () => {
    const saved = { bath: [{ id: 'x', from: 'cv:xy.x', to: 'fx:in' }, { id: 'y', from: 'audio:drone', to: 'fx:in' }], berlin: 'nope' };
    expect(normalizeCables(saved)).toEqual({ bath: [{ id: 'y', from: 'audio:drone', to: 'fx:in' }], berlin: [] });
    expect(normalizeCables(null)).toEqual(defaultCables());
  });
});
