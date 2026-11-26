import { describe, it, expect } from 'vitest';
import { spawnWindowOffset, advanceSpawnCursor } from './particleSpawnRing';

/** Simulate the compute shader: slots die after `life` frames, dead slots
 *  inside the window respawn. Returns how many distinct slots ever spawned. */
function simulate(count: number, perFrame: number, life: number, frames: number): number {
  const remaining = new Int32Array(count);
  const everSpawned = new Uint8Array(count);
  let cursor = 0;
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < count; i++) {
      if (remaining[i] <= 0) {
        if (spawnWindowOffset(i, cursor, perFrame, count) >= 0) {
          remaining[i] = life;
          everSpawned[i] = 1;
        }
      } else {
        remaining[i]--;
      }
    }
    cursor = advanceSpawnCursor(cursor, perFrame, count);
  }
  return everSpawned.reduce((a, b) => a + b, 0);
}

describe('particle spawn ring', () => {
  it('window covers exactly perFrame slots starting at the cursor, wrapping', () => {
    const hits: number[] = [];
    for (let i = 0; i < 10; i++) if (spawnWindowOffset(i, 8, 4, 10) >= 0) hits.push(i);
    expect(hits).toEqual([0, 1, 8, 9]);
    expect(spawnWindowOffset(8, 8, 4, 10)).toBe(0);
    expect(spawnWindowOffset(1, 8, 4, 10)).toBe(3);
  });

  it('every slot in the pool eventually spawns while the pointer is held', () => {
    // 50k pool, 120/frame, 3 s life at 60 fps (the paint drip defaults).
    expect(simulate(50000, 120, 180, 600)).toBe(50000);
  });

  it('a pool smaller than perFrame still spawns every slot once', () => {
    expect(simulate(50, 120, 10, 2)).toBe(50);
  });
});
