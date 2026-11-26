import { describe, it, expect } from 'vitest';
import { BrushSpriteCache } from './brushSpriteCache';

describe('BrushSpriteCache.variantIndex', () => {
  it('random per-stamp brushes reach every pre-rendered variant', () => {
    const cache = new BrushSpriteCache();
    const n = cache.variantsFor('smoke');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(cache.variantIndex('smoke', i, 0, 1));
    expect(seen.size).toBe(n);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(n);
    }
  });
});
