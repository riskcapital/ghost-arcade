import { describe, expect, it } from 'vitest';
import { emptyPart } from './machineBeat';
import { shownPads } from './machineRows';

describe('the rows a step grid shows', () => {
  it('the sequencer\'s pads, then any pad with hits on the part', () => {
    const part = emptyPart('Loop');
    part.tracks[9].vel[4] = 0.8;
    part.tracks[2].vel[0] = 0.5;
    expect(shownPads([0, 2, 4], part, 16)).toEqual([0, 2, 4, 9]);
    // A pad past the beat's pads stays out.
    expect(shownPads([0], part, 8)).toEqual([0, 2]);
  });
});

describe('older projects: one beat in every set', async () => {
  const { withTabsBeat, TABS_PART_ID } = await import('../musicStudioStore');
  const { starterBeat } = await import('./machineBeat');
  const { createPattern, starterPattern } = await import('../drumPattern');
  it('keep the other sets\' own pattern as a part of the drum machine beat, once', () => {
    const p = createPattern(16);
    p.tracks.kick[0] = 1;
    p.tracks.snare[4] = 0.8;
    const b = starterBeat('mk.boom-box');
    const m = withTabsBeat(b, p, 1);
    expect(m.parts).toHaveLength(b.parts.length + 1);
    const tabs = m.parts.find((x) => x.id === TABS_PART_ID)!;
    expect(tabs.name).toBe('Tabs beat');
    expect(tabs.tracks.some((t) => t.vel[0] > 0)).toBe(true);
    // Saved again (schema 2), or nothing beyond the starter: no new part.
    expect(withTabsBeat(b, p, 2)).toBe(b);
    expect(withTabsBeat(b, starterPattern(), 1)).toBe(b);
    expect(withTabsBeat(m, p, 1)).toBe(m);
  });
});
