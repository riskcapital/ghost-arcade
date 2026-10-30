import { describe, expect, it } from 'vitest';
import { KeyFinder } from './keyFinder';

const play = (finder: KeyFinder, notes: number[], times = 4) => {
  for (let i = 0; i < times; i++) for (const n of notes) finder.add(n, 0.8);
};

describe('KeyFinder', () => {
  it('waits until it has heard enough', () => {
    const f = new KeyFinder();
    f.add(60);
    expect(f.guess()).toBeNull();
  });

  it('hears a major key from its scale and chords', () => {
    const f = new KeyFinder();
    // G major: the scale, then I-IV-V-I with the tonic leaned on.
    play(f, [55, 57, 59, 60, 62, 64, 66, 67]);
    play(f, [55, 59, 62, 60, 64, 67, 62, 66, 69, 55, 59, 62]);
    expect(f.guess()).toMatchObject({ root: 7, mode: 'major' });
  });

  it('hears a minor key', () => {
    const f = new KeyFinder();
    // A minor: tonic triad, iv, V with its raised seventh.
    play(f, [57, 60, 64, 57, 62, 65, 69, 64, 68, 71, 57, 60, 64, 69]);
    expect(f.guess()).toMatchObject({ root: 9, mode: 'minor' });
  });

  it('is surer with more evidence', () => {
    const few = new KeyFinder();
    play(few, [60, 64, 67, 65, 69, 72, 67, 71, 74], 2);
    const many = new KeyFinder();
    play(many, [60, 64, 67, 65, 69, 72, 67, 71, 74], 8);
    expect(many.guess()!.confidence).toBeGreaterThanOrEqual(few.guess()!.confidence);
    expect(many.guess()).toMatchObject({ root: 0, mode: 'major' });
  });
});
