import { describe, expect, it } from 'vitest';
import { noteOff, noteOn } from './noteEvents';
import {
  DEFAULT_VISUAL_SETTINGS,
  NOTE_DRIVEN_INPUTS,
  NOTE_VOICE_SLOTS,
  NoteVisualState,
  buildEnvelope,
  fadeEnvelope,
  isNoteDrivenInput,
  type NoteVisualSettings,
} from './noteVisuals';

const fade: NoteVisualSettings = { mode: 'fade', attack: 0.1, decay: 0.5, sustain: 0.5, release: 1, linger: 10, growth: 0.1 };

function settings(mode: 'fade' | 'build') {
  return {
    synth: { ...fade, mode },
    keys: { ...fade, mode },
    drums: { ...DEFAULT_VISUAL_SETTINGS.drums, mode },
  };
}

describe('envelopes', () => {
  it('fade rises, settles to sustain while held and dies away after release', () => {
    expect(fadeEnvelope(fade, 0, null, 0)).toBe(0);
    expect(fadeEnvelope(fade, 0, null, 0.05)).toBeCloseTo(0.5);
    expect(fadeEnvelope(fade, 0, null, 0.1)).toBeCloseTo(1);
    expect(fadeEnvelope(fade, 0, null, 10)).toBeCloseTo(0.5, 3);
    const atRelease = fadeEnvelope(fade, 0, 10, 10);
    expect(atRelease).toBeCloseTo(0.5, 3);
    expect(fadeEnvelope(fade, 0, 10, 11)).toBeLessThan(atRelease * 0.06);
  });

  it('build holds while the note is down and lingers far longer after release', () => {
    expect(buildEnvelope(fade, 0, null, 30)).toBe(1);
    expect(buildEnvelope(fade, 0, 5, 6)).toBeGreaterThan(0.7);
    expect(buildEnvelope(fade, 0, 5, 6)).toBeGreaterThan(fadeEnvelope(fade, 0, 5, 6) * 10);
  });

  it('is silent before the note starts', () => {
    expect(fadeEnvelope(fade, 2, null, 1)).toBe(0);
    expect(buildEnvelope(fade, 2, null, 1)).toBe(0);
  });
});

describe('note visual state', () => {
  it('exposes pitch, energy and instrument per voice', () => {
    const v = new NoteVisualState(settings('fade'));
    v.push(noteOn('keys', 64, 0.8, 'screen', 0));
    v.advance(0.1);
    const out = v.inputs();
    expect(out.notePitch0).toBeCloseTo(64 / 127);
    expect(out.noteEnergy0).toBeCloseTo(0.8);
    expect(out.noteVoice0).toBe(1);
    expect(out.noteLast).toBeCloseTo(64 / 127);
    expect(out.noteCount).toBe(1);
    expect(out.noteHit).toBeGreaterThan(0);
  });

  it('writes every driven input, and only those', () => {
    const v = new NoteVisualState();
    const out = v.inputs();
    expect(Object.keys(out).sort()).toEqual([...NOTE_DRIVEN_INPUTS].sort());
    expect(isNoteDrivenInput('noteEnergy3')).toBe(true);
    expect(isNoteDrivenInput('noteMode')).toBe(false);
  });

  it('waits for a scheduled note until the clock reaches it', () => {
    const v = new NoteVisualState(settings('fade'));
    v.push(noteOn('synth', 60, 1, 'sequencer', 1));
    v.advance(0.5);
    expect(v.inputs().noteEnergy0).toBe(0);
    v.advance(1.1);
    expect(v.inputs().noteEnergy0).toBeCloseTo(1);
  });

  it('fade clears after release; build keeps the voice and grows', () => {
    const play = (mode: 'fade' | 'build') => {
      const v = new NoteVisualState(settings(mode));
      for (let i = 0; i < 6; i++) {
        v.push(noteOn('synth', 60 + i, 1, 'keyboard', i * 0.5));
        v.push(noteOff('synth', 60 + i, 'keyboard', i * 0.5 + 0.25));
      }
      v.advance(5);
      return v;
    };
    const faded = play('fade').inputs();
    const built = play('build').inputs();
    expect(faded.noteLevel).toBeLessThan(0.05);
    expect(built.noteLevel).toBeGreaterThan(1 - 0.001);
    // The first note, released 4.75 s ago, is still well lit in build mode.
    expect(built.noteEnergy0).toBeGreaterThan(0.2);
    expect(faded.noteEnergy0).toBeLessThan(0.001);
    // Evolve only advances while something is sounding: it is past the idle start.
    expect(built.noteEvolve).toBeGreaterThan(1);
    expect(built.noteBuild).toBeGreaterThan(0.2);
  });

  it('lets a clip override the instrument mode', () => {
    const v = new NoteVisualState(settings('fade'));
    v.push(noteOn('synth', 60, 1, 'keyboard', 0));
    v.push(noteOff('synth', 60, 'keyboard', 0.2));
    v.advance(3);
    expect(v.inputs(0).noteEnergy0).toBeLessThan(0.01);
    expect(v.inputs(1).noteEnergy0).toBeLessThan(0.01);
    expect(v.inputs(2).noteEnergy0).toBeGreaterThan(0.4);
    expect(v.inputs(0).noteBuilding).toBe(0);
    expect(v.inputs(2).noteBuilding).toBe(1);
  });

  it('keeps each instrument on its own mode', () => {
    const s = settings('fade');
    s.keys.mode = 'build';
    const v = new NoteVisualState(s);
    v.push(noteOn('synth', 60, 1, 'keyboard', 0));
    v.push(noteOn('keys', 72, 1, 'keyboard', 0));
    v.push(noteOff('synth', 60, 'keyboard', 0.2));
    v.push(noteOff('keys', 72, 'keyboard', 0.2));
    v.advance(3);
    const out = v.inputs();
    expect(out.noteEnergy0).toBeLessThan(0.01);
    expect(out.noteEnergy1).toBeGreaterThan(0.4);
  });

  it('sends drums to their groups without taking a melodic voice', () => {
    const v = new NoteVisualState(settings('fade'));
    v.push(noteOn('drums', 36, 1, 'sequencer', 0));
    v.push(noteOn('drums', 42, 0.5, 'sequencer', 0));
    v.advance(0.01);
    const out = v.inputs();
    expect(out.drumKick).toBeGreaterThan(0.9);
    expect(out.drumHat).toBeGreaterThan(0.3);
    expect(out.drumSnare).toBe(0);
    expect(out.noteEnergy0).toBe(0);
    v.advance(3);
    expect(v.inputs().drumKick).toBeLessThan(0.01);
  });

  it('steals the quietest released voice when every slot is used', () => {
    const v = new NoteVisualState(settings('fade'));
    for (let i = 0; i < NOTE_VOICE_SLOTS; i++) v.push(noteOn('synth', 40 + i, 1, 'keyboard', 0));
    v.push(noteOff('synth', 43, 'keyboard', 0.1));
    v.advance(2);
    v.push(noteOn('synth', 90, 1, 'keyboard', 2));
    v.advance(2.2);
    const out = v.inputs();
    expect(out.notePitch3).toBeCloseTo(90 / 127);
    expect(out.notePitch0).toBeCloseTo(40 / 127);
  });

  it('reuses the slot when a note is retriggered', () => {
    const v = new NoteVisualState(settings('fade'));
    v.push(noteOn('synth', 60, 1, 'keyboard', 0));
    v.push(noteOff('synth', 60, 'keyboard', 0.1));
    v.push(noteOn('synth', 60, 1, 'keyboard', 0.2));
    v.advance(0.4);
    const out = v.inputs();
    expect(out.noteEnergy0).toBeGreaterThan(0.5);
    expect(out.noteEnergy1).toBe(0);
  });

  it('gives the same picture for the same events, live or replayed', () => {
    const events = [
      noteOn('synth', 60, 0.9, 'keyboard', 0.1),
      noteOn('drums', 36, 1, 'sequencer', 0.25),
      noteOff('synth', 60, 'keyboard', 0.6),
      noteOn('keys', 67, 0.5, 'midi', 0.8),
    ];
    const live = new NoteVisualState();
    for (const e of events) {
      live.advance(e.time);
      live.push(e);
    }
    live.advance(1.5);
    const replayed = new NoteVisualState();
    for (const e of events) replayed.push({ ...e, source: 'replay' });
    replayed.advance(1.5);
    const a = live.inputs();
    const b = replayed.inputs();
    for (const name of NOTE_DRIVEN_INPUTS) expect(b[name]).toBeCloseTo(a[name], 6);
  });

  it('goes idle once everything has faded', () => {
    const v = new NoteVisualState(settings('fade'));
    expect(v.isActive()).toBe(false);
    v.push(noteOn('synth', 60, 1, 'keyboard', 0));
    v.push(noteOff('synth', 60, 'keyboard', 0.1));
    v.advance(0.2);
    expect(v.isActive()).toBe(true);
    v.advance(200);
    expect(v.isActive()).toBe(false);
  });

  it('releaseAll lets held notes fade instead of cutting them', () => {
    const v = new NoteVisualState(settings('fade'));
    v.push(noteOn('synth', 60, 1, 'keyboard', 0));
    v.advance(1);
    v.releaseAll();
    expect(v.inputs().noteCount).toBe(0);
    expect(v.inputs().noteEnergy0).toBeGreaterThan(0.4);
    v.advance(5);
    expect(v.inputs().noteEnergy0).toBeLessThan(0.01);
  });
});
