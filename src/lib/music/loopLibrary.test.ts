import { describe, expect, it } from 'vitest';
import { LIBRARY_BEATS, LIBRARY_MELODIC, LOOP_STYLE_LABELS } from './loopLibrary';
import { BEAT_LOOPS, MELODIC_LOOPS, loopById, loopNotesBetween } from './loops';
import { LEADS, LEAD_ALIASES } from './leadLibrary';
import { toneById } from './tone/tones';

describe('the loop library', () => {
  it('has a good spread: fewer, better loops in every part', () => {
    expect(LIBRARY_MELODIC.length + LIBRARY_BEATS.length + LEADS.length).toBeGreaterThanOrEqual(60);
    expect(LIBRARY_MELODIC.filter((l) => l.role === 'bass').length).toBeGreaterThanOrEqual(12);
    expect(LIBRARY_MELODIC.filter((l) => l.role === 'chords').length).toBeGreaterThanOrEqual(10);
    expect(LIBRARY_MELODIC.filter((l) => l.role === 'texture').length).toBeGreaterThanOrEqual(5);
    expect(LEADS.length).toBeGreaterThanOrEqual(30);
    expect(LIBRARY_BEATS.length).toBeGreaterThanOrEqual(20);
  });

  it('has unique ids and names, and is part of the studio presets', () => {
    const all = [...MELODIC_LOOPS, ...BEAT_LOOPS];
    expect(new Set(all.map((l) => l.id)).size).toBe(all.length);
    const names = [...LIBRARY_MELODIC, ...LIBRARY_BEATS].map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    for (const l of LIBRARY_MELODIC) expect(loopById(l.id)).toBe(l);
  });

  it('keeps every note inside its loop, in whole bars, with sane degrees', () => {
    for (const l of LIBRARY_MELODIC) {
      expect(l.beats % 4, l.id).toBe(0);
      expect(l.notes.length, l.id).toBeGreaterThan(0);
      for (const n of l.notes) {
        expect(n.beat, l.id).toBeGreaterThanOrEqual(0);
        expect(n.beat, l.id).toBeLessThan(l.beats);
        expect(n.dur, l.id).toBeGreaterThan(0);
        expect(n.velocity, l.id).toBeGreaterThan(0);
        expect(n.velocity, l.id).toBeLessThanOrEqual(1);
        for (const d of n.degrees) expect(Math.abs(d), l.id).toBeLessThanOrEqual(16);
      }
      expect(l.style in LOOP_STYLE_LABELS, l.id).toBe(true);
      expect(l.bpm[0]).toBeLessThan(l.bpm[1]);
    }
  });

  it('writes drum rows the grid can read', () => {
    for (const b of LIBRARY_BEATS) {
      for (const row of Object.values(b.rows)) {
        expect(row!.length, b.id).toBe(b.steps);
        expect(/^[xo.]+$/.test(row!), b.id).toBe(true);
      }
    }
  });

  it('names no real artists or studios', () => {
    const banned = /perry|scratch|tubby|ott\b|black ark|marley|sly|robbie|aphex|daft|disco biscuits|new deal|pressure drop/i;
    for (const l of [...LIBRARY_MELODIC, ...LIBRARY_BEATS]) expect(banned.test(l.name), l.name).toBe(false);
  });
});

describe('the leads', () => {
  it('replace the old ones, each with a tone, in range, and every old id still plays', () => {
    expect(MELODIC_LOOPS.filter((l) => l.role === 'lead')).toEqual(LEADS);
    for (const l of LEADS) {
      expect(toneById(l.tone), l.id).toBeTruthy();
      expect(l.beats % 4, l.id).toBe(0);
      const degrees = l.notes.flatMap((n) => n.degrees);
      // About an octave and a fifth at most.
      expect(Math.max(...degrees) - Math.min(...degrees), l.id).toBeLessThanOrEqual(13);
      for (const n of l.notes) expect(n.beat, l.id).toBeLessThan(l.beats);
    }
    for (const [old, now] of Object.entries(LEAD_ALIASES)) expect(loopById(old)?.id, old).toBe(now);
    expect(loopById('lib-lead-melodica-twice')?.id).toBe('lead-rooftop-melodica');
  });
});

describe('every written loop holds up', () => {
  const dDorian = { root: 2, scale: 'dorian' as const };
  const melodic = [...LIBRARY_MELODIC, ...LEADS];

  it('plays every note in the key', () => {
    for (const l of melodic) {
      for (const n of loopNotesBetween(l, dDorian, 0, 0, l.beats)) {
        expect([0, 2, 3, 5, 7, 9, 10], l.id).toContain(((n.note - 2) % 12 + 12) % 12);
      }
      for (const n of l.notes) for (const d of n.degrees) expect(Number.isInteger(d), l.id).toBe(true);
    }
  });

  it('has feel: velocities that move, ghosts and accents', () => {
    for (const l of melodic) {
      const v = l.notes.map((n) => n.velocity);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const spread = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      expect(spread, l.id).toBeGreaterThan(0.02);
    }
  });

  it('voices its chords instead of stacking root-position blocks, with no seconds down low', () => {
    for (const l of LIBRARY_MELODIC.filter((x) => x.role === 'chords')) {
      const chords = l.notes.filter((n) => n.degrees.length >= 3);
      const blocks = chords.filter((n) => {
        const d = [...n.degrees].sort((a, b) => a - b);
        return d[1] - d[0] === 2 && d[2] - d[1] === 2 && (d.length === 3 || d[3] - d[2] === 2);
      });
      expect(blocks.length / chords.length, l.id).toBeLessThan(0.5);
      for (const n of loopNotesBetween(l, dDorian, 0, 0, l.beats)) void n;
      // Played in D, no two neighbouring voices under G3 a second apart.
      const byBeat = new Map<number, number[]>();
      for (const n of loopNotesBetween(l, dDorian, 0, 0, l.beats)) byBeat.set(n.beat, [...(byBeat.get(n.beat) ?? []), n.note]);
      for (const notes of byBeat.values()) {
        const s = notes.sort((a, b) => a - b);
        for (let i = 1; i < s.length; i++) if (s[i] < 55) expect(s[i] - s[i - 1], l.id).toBeGreaterThan(2);
      }
    }
  });

  it('keeps the bass down where it belongs, about E1 to G3', () => {
    for (const l of LIBRARY_MELODIC.filter((x) => x.role === 'bass')) {
      for (const n of loopNotesBetween(l, dDorian, 0, 0, l.beats)) {
        expect(n.note, l.id).toBeGreaterThanOrEqual(24);
        expect(n.note, l.id).toBeLessThanOrEqual(55);
      }
    }
  });

  it('swings where the style swings', () => {
    const swung = LIBRARY_MELODIC.filter((l) => l.style === 'house' || l.style === 'funk');
    for (const l of swung) {
      const offSixteenths = l.notes.filter((n) => { const f = (n.beat % 0.5); return f > 0.27 && f < 0.32; });
      const straight = l.notes.filter((n) => Math.abs((n.beat % 0.5) - 0.25) < 0.001);
      expect(straight.length, l.id).toBe(0);
      void offSixteenths;
    }
  });

  it('comes with a tone for every loop', () => {
    for (const l of [...LIBRARY_MELODIC, ...LEADS]) expect(toneById(l.tone), l.id).toBeTruthy();
  });
});

describe('the reggae and dub family', () => {
  const dDorian = { root: 2, scale: 'dorian' as const };
  const reggae = LIBRARY_MELODIC.filter((l) => l.family);
  const bass = reggae.filter((l) => l.role === 'bass');
  const keys = reggae.filter((l) => l.role === 'chords');
  // Notes sit a hair late (laid back); undo that before reading where they fall.
  const at = (b: number) => Math.round(b * 8) / 8;

  it('has enough of each, each locked to a groove the library has', () => {
    expect(bass.length).toBeGreaterThanOrEqual(12);
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const fam of ['onedrop', 'rockers', 'steppers', 'rubadub', 'meditation'] as const) expect(bass.some((l) => l.family === fam), fam).toBe(true);
    for (const l of reggae) expect(LIBRARY_BEATS.some((b) => b.id === l.groove), l.id).toBe(true);
  });

  it('plays the one drop with kick and rim together on 3', () => {
    const od = LIBRARY_BEATS.find((b) => b.id === 'lib-beat-onedrop-deep')!;
    expect(od.rows.kick!.indexOf('x')).toBe(8);
    expect(od.rows.rim![8]).toBe('x');
  });

  it('leaves space in the bass: a fifth of every bar silent, no runs of sixteenths', () => {
    for (const l of bass) {
      for (let bar = 0; bar < l.beats / 4; bar++) {
        let sounding = 0;
        for (let t = bar * 4; t < bar * 4 + 4; t += 0.0625) if (l.notes.some((n) => n.beat <= t && t < n.beat + n.dur)) sounding += 0.0625;
        expect(sounding, `${l.id} bar ${bar + 1}`).toBeLessThanOrEqual(3.2);
      }
      const starts = l.notes.map((n) => at(n.beat)).sort((a, b) => a - b);
      let run = 1;
      for (let i = 1; i < starts.length; i++) {
        run = starts[i] - starts[i - 1] <= 0.25 + 1e-6 ? run + 1 : 1;
        expect(run, l.id).toBeLessThanOrEqual(4);
      }
    }
  });

  it('keeps the bass between the bottom of the key and C3, and varies the phrase end', () => {
    for (const l of bass) {
      for (const n of loopNotesBetween(l, dDorian, 0, 0, l.beats)) {
        expect(n.note, l.id).toBeGreaterThanOrEqual(24);
        expect(n.note, l.id).toBeLessThanOrEqual(48);
      }
      const bar = (i: number) => l.notes.filter((n) => n.beat >= i * 4 && n.beat < i * 4 + 4).map((n) => `${at(n.beat - i * 4)}:${n.degrees[0]}`).join(' ');
      expect(bar(l.beats / 4 - 1), l.id).not.toBe(bar(0));
    }
  });

  it('voices the keys above C3, chokes the skanks and puts them where the groove wants them', () => {
    for (const l of keys) {
      for (const n of loopNotesBetween(l, dDorian, 0, 0, l.beats)) expect(n.note, l.id).toBeGreaterThanOrEqual(48);
      if (l.kind !== 'skank') continue;
      for (const n of l.notes) {
        expect(n.dur, l.id).toBeLessThanOrEqual(0.15);
        const inBar = at(n.beat) % 4;
        const inBeat = inBar % 1;
        if (l.family === 'onedrop' || l.family === 'meditation') expect([1, 1.25, 3, 3.25, 3.75], `${l.id} ${inBar}`).toContain(inBar);
        else if (l.family === 'rubadub') expect([0.5, 0.75, 1, 1.25, 3, 3.25].includes(inBar) || inBeat === 0.5, `${l.id} ${inBar}`).toBe(true);
        else expect([0.5, 0.75], `${l.id} ${inBar}`).toContain(inBeat);
      }
    }
  });
});
