/**
 * A mixing-desk fader's taper: where a dB value sits along the throw. Unity
 * (0 dB) at three quarters of the way up, +10 dB at the top, finer steps near
 * unity where they matter and wider ones down towards silence.
 */

/** [position 0-1, dB] from the top down; the bottom is silence. */
const TAPER: Array<[number, number]> = [
  [1, 10], [0.88, 5], [0.75, 0], [0.64, -5], [0.54, -10], [0.4, -20], [0.28, -30], [0.18, -40], [0.07, -60],
];

/** The scale printed beside the fader. */
export const FADER_MARKS: Array<{ db: number; label: string }> = [
  { db: 10, label: '+10' }, { db: 5, label: '+5' }, { db: 0, label: '0' }, { db: -5, label: '5' }, { db: -10, label: '10' },
  { db: -20, label: '20' }, { db: -30, label: '30' }, { db: -40, label: '40' }, { db: -60, label: '60' }, { db: -Infinity, label: '∞' },
];

export function positionToDb(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return 10;
  for (let i = 0; i < TAPER.length - 1; i++) {
    const [p0, d0] = TAPER[i];
    const [p1, d1] = TAPER[i + 1];
    if (p <= p0 && p >= p1) return d1 + ((p - p1) / (p0 - p1)) * (d0 - d1);
  }
  // Below -60 dB, down to silence at the bottom.
  const [pLow, dLow] = TAPER[TAPER.length - 1];
  return dLow - (1 - p / pLow) * 40;
}

export function dbToPosition(db: number): number {
  if (!Number.isFinite(db) || db <= -100) return 0;
  if (db >= 10) return 1;
  for (let i = 0; i < TAPER.length - 1; i++) {
    const [p0, d0] = TAPER[i];
    const [p1, d1] = TAPER[i + 1];
    if (db <= d0 && db >= d1) return p1 + ((db - d1) / (d0 - d1)) * (p0 - p1);
  }
  const [pLow, dLow] = TAPER[TAPER.length - 1];
  return Math.max(0, pLow * (1 - (dLow - db) / 40));
}

export const gainToDb = (g: number) => (g <= 0.00001 ? -Infinity : 20 * Math.log10(g));
export const dbToGain = (db: number) => (Number.isFinite(db) ? Math.pow(10, db / 20) : 0);

export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db < -99) return '-∞';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
}
