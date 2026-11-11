import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { ReelRehearsal } from './stageReelRender';

vi.mock('../stores/settings', async () => {
  const { writable } = await import('svelte/store');
  return { settings: writable({}) };
});

const { stageReelRender } = await import('./stageReelRender');
const { DEFAULT_REEL_SETTINGS } = await import('../stage3d/demoReel');

describe('a render rehearsal that cannot start', () => {
  it('still ends the take (the editor stops collecting its sound and gets Loop back)', async () => {
    const end = vi.fn();
    const rehearsal = { durationSeconds: 10, end } as unknown as ReelRehearsal;
    // No Stage 3D renderer registered: it stops before filming anything.
    expect(await stageReelRender.start([], DEFAULT_REEL_SETTINGS, rehearsal)).toBe(false);
    expect(get(stageReelRender).status).toBe('error');
    expect(end).toHaveBeenCalledTimes(1);
  });
});
