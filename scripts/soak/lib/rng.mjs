// Seeded random numbers (mulberry32), so a soak run can be replayed: the
// same seed picks the same actions with the same arguments in the same order.

export function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    /** Float in [min, max). */
    float: (min = 0, max = 1) => min + next() * (max - min),
    /** Integer in [min, max] (inclusive). */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    bool: (p = 0.5) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
    /** Pick from [{ weight, ... }] by weight. */
    weighted(list, key = 'weight') {
      const total = list.reduce((s, x) => s + Math.max(0, x[key] ?? 0), 0);
      if (total <= 0) return null;
      let r = next() * total;
      for (const x of list) {
        r -= Math.max(0, x[key] ?? 0);
        if (r < 0) return x;
      }
      return list[list.length - 1];
    },
    /** A child generator for one step: its own stream, derived from this seed and the step. */
    fork: (salt) => makeRng(((Number(seed) >>> 0) ^ Math.imul((salt >>> 0) + 1, 0x9e3779b1)) >>> 0),
    seed: Number(seed) >>> 0,
  };
  return rng;
}

export function randomSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
