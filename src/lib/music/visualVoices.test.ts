import { describe, expect, it } from 'vitest';
import { VOICE_DRIVEN_INPUTS, VoiceSignals, sourcesForEvent, voiceSourceAt, voiceSourceIndex, type SourceContext } from './visualVoices';
import { noteOff, noteOn, type NoteEvent } from './noteEvents';

const ctx: SourceContext = { played: 'dubbass', roles: { bass: ['dubbass'], lead: ['keys'], chords: ['keys'], texture: ['siren'] } };
const clock = (beat: number) => ({ beat, beatSeconds: 0.5 });

function drum(voice: 'kick' | 'snare' | 'hatClosed', time: number, velocity = 1): NoteEvent {
  return { ...noteOn('drums', 36, velocity, 'sequencer', time), drum: voice };
}

function feed(signals: VoiceSignals, event: NoteEvent) {
  signals.push(event, sourcesForEvent(event, ctx));
}

describe('sourcesForEvent', () => {
  it('splits the kit into kick, snare, hats and perc', () => {
    expect(sourcesForEvent({ instrument: 'drums', note: 36, drum: 'kick' }, ctx)).toEqual(['all', 'kick']);
    expect(sourcesForEvent({ instrument: 'drums', note: 39, drum: 'clap' }, ctx)).toEqual(['all', 'snare']);
    expect(sourcesForEvent({ instrument: 'drums', note: 46, drum: 'hatOpen' }, ctx)).toEqual(['all', 'hats']);
  });

  it('follows the parts each instrument plays, and what is on the keys', () => {
    expect(sourcesForEvent({ instrument: 'dubbass', note: 36 }, ctx).sort()).toEqual(['all', 'bass', 'played']);
    expect(sourcesForEvent({ instrument: 'keys', note: 64 }, ctx).sort()).toEqual(['all', 'chords', 'lead']);
    expect(sourcesForEvent({ instrument: 'keys', note: 40 }, ctx)).toContain('bass');
    expect(sourcesForEvent({ instrument: 'shots', note: 60 }, ctx)).toContain('fx');
  });
});

describe('VoiceSignals', () => {
  it('lists every driven input', () => {
    const v = new VoiceSignals();
    expect(Object.keys(v.inputs('kick', true)).sort()).toEqual([...VOICE_DRIVEN_INPUTS].sort());
  });

  it('flashes and decays on a kick, and only for the kick', () => {
    const v = new VoiceSignals();
    feed(v, drum('kick', 1));
    v.advance(1.006, clock(2));
    expect(v.inputs('kick', true).vxHit).toBeGreaterThan(0.9);
    expect(v.inputs('kick', true).vxEnv).toBeGreaterThan(0.4);
    expect(v.inputs('snare', true).vxHit).toBe(0);
    expect(v.inputs('all', true).vxEnv).toBeGreaterThan(0.4);
    v.advance(1.5, clock(3));
    expect(v.inputs('kick', true).vxHit).toBeLessThan(0.01);
    expect(v.inputs('kick', true).vxEnv).toBeLessThan(0.05);
  });

  it('applies events scheduled ahead only when the clock reaches them', () => {
    const v = new VoiceSignals();
    feed(v, drum('snare', 2));
    v.advance(1.9, clock(0));
    expect(v.inputs('snare', true).vxHit).toBe(0);
    v.advance(2.01, clock(0));
    expect(v.inputs('snare', true).vxHit).toBeGreaterThan(0.8);
  });

  it('holds held notes, reports the chord, and glides between pitches', () => {
    const v = new VoiceSignals();
    for (const n of [60, 64, 67]) feed(v, noteOn('keys', n, 0.8, 'screen', 1));
    v.advance(1.2, clock(0));
    const chord = v.inputs('chords', true);
    expect([chord.vxNote0, chord.vxNote1, chord.vxNote2].map((x) => Math.round(x * 127)).sort()).toEqual([60, 64, 67]);
    expect(chord.vxNote3).toBe(0);
    expect(chord.vxEnv).toBeGreaterThan(0.5);
    feed(v, noteOn('keys', 72, 0.8, 'screen', 1.3));
    v.advance(1.31, clock(0));
    const lead = v.inputs('lead', true);
    expect(lead.vxPitch).toBeCloseTo(72 / 127);
    expect(lead.vxGlide).toBeLessThan(lead.vxPitch);
    v.advance(2, clock(0));
    expect(v.inputs('lead', true).vxGlide).toBeCloseTo(72 / 127, 2);
    for (const n of [60, 64, 67, 72]) feed(v, noteOff('keys', n, 'screen', 2.1));
    v.advance(5, clock(0));
    expect(v.inputs('chords', true).vxEnv).toBeLessThan(0.01);
  });

  it('runs the motion clock faster while the sound plays, never backwards', () => {
    const quiet = new VoiceSignals();
    quiet.advance(2, clock(0));
    const busy = new VoiceSignals();
    feed(busy, noteOn('dubbass', 36, 1, 'screen', 0.001));
    busy.advance(2, clock(0));
    expect(busy.inputs('bass', true).vxPhase).toBeGreaterThan(quiet.inputs('bass', true).vxPhase * 3);
    expect(quiet.inputs('bass', true).vxPhase).toBeGreaterThan(0);
  });

  it('is present while its sound plays, then eases out, unless it is always on', () => {
    const v = new VoiceSignals();
    expect(v.inputs('hats', true).vxPresence).toBe(0);
    expect(v.inputs('hats', false).vxPresence).toBe(1);
    for (let i = 0; i < 8; i++) feed(v, drum('hatClosed', 1 + i * 0.25, 0.6));
    v.advance(3, clock(0));
    expect(v.inputs('hats', true).vxPresence).toBeGreaterThan(0.95);
    // Eight beats after the last hat (four seconds at 120), it starts to go.
    v.advance(12, clock(0));
    expect(v.inputs('hats', true).vxPresence).toBeLessThan(0.1);
  });

  it('counts notes for every-fourth-hit changes and reports the clock', () => {
    const v = new VoiceSignals();
    for (let i = 0; i < 5; i++) feed(v, drum('kick', 1 + i * 0.5));
    v.advance(4, clock(9.25));
    const k = v.inputs('kick', true);
    expect(k.vxCount).toBe(5);
    expect(k.vxBeat).toBeCloseTo(0.25);
    expect(k.vxBar).toBeCloseTo(9.25 / 4 - 2);
    expect(k.vxBars).toBe(2);
  });
});

describe('vxSource values', () => {
  it('maps the input to a source and back', () => {
    expect(voiceSourceAt(1)).toBe('kick');
    expect(voiceSourceAt(99)).toBe('all');
    expect(voiceSourceAt('x')).toBe('all');
    expect(voiceSourceIndex('played')).toBe(10);
  });
});
