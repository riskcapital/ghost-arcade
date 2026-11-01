import { describe, expect, it } from 'vitest';
import { dbToGain, dbToPosition, formatDb, gainToDb, positionToDb } from './faderScale';

describe('the desk fader taper', () => {
  it('puts unity three quarters up, +10 at the top and silence at the bottom', () => {
    expect(positionToDb(0.75)).toBeCloseTo(0);
    expect(positionToDb(1)).toBe(10);
    expect(positionToDb(0)).toBe(-Infinity);
    expect(dbToPosition(0)).toBeCloseTo(0.75);
  });

  it('goes there and back', () => {
    for (let p = 0.01; p <= 1; p += 0.03) expect(dbToPosition(positionToDb(p))).toBeCloseTo(p, 5);
    for (const db of [-60, -40, -20, -6, 0, 3, 10]) expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 6);
  });

  it('rises all the way up', () => {
    let last = -Infinity;
    for (let p = 0.001; p <= 1; p += 0.01) {
      const db = positionToDb(p);
      expect(db).toBeGreaterThan(last);
      last = db;
    }
    expect(formatDb(-Infinity)).toBe('-∞');
    expect(formatDb(2.5)).toBe('+2.5');
  });
});
